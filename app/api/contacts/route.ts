import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { createHash } from 'crypto'
import { pushNewContactToWhapi } from '@/lib/whapi-contacts-sync'

/**
 * GET /api/contacts
 *
 * List all contacts for the user's workspace.
 * Supports search and filtering.
 *
 * Query params:
 * - search: Search by name or phone
 * - source: Filter by source (manual, google, csv_import)
 * - limit: Max results (default 50)
 * - offset: Pagination offset
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's workspace from profiles
    const { data: profile } = await supabase
      .from('profiles')
      .select('workspace_id')
      .eq('user_id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    }

    // Parse query params
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search')
    const source = searchParams.get('source')
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    const offset = parseInt(searchParams.get('offset') || '0', 10)

    // Build query
    let query = supabase
      .from('contacts')
      .select('*', { count: 'exact' })
      .eq('workspace_id', profile.workspace_id)
      .order('display_name', { ascending: true })

    // Apply search filter
    if (search) {
      query = query.or(`display_name.ilike.%${search}%,phone_numbers.cs.${JSON.stringify([{ number: search }])}`)
    }

    // Apply source filter
    if (source) {
      query = query.eq('source', source)
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1)

    const { data: contacts, error, count } = await query

    if (error) {
      console.error('Error fetching contacts:', error)
      return NextResponse.json(
        { error: 'Failed to fetch contacts' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      contacts: contacts || [],
      total: count || 0,
      limit,
      offset,
    })
  } catch (error) {
    console.error('Contacts GET error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/contacts
 *
 * Create a new manual contact.
 *
 * Body:
 * - display_name: Contact name (required)
 * - phone_numbers: Array of { number, type } (optional)
 * - email_addresses: Array of { email, type } (optional)
 * - tags: Array of strings (optional)
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's workspace from profiles
    const { data: profile } = await supabase
      .from('profiles')
      .select('workspace_id')
      .eq('user_id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    }

    const body = await request.json()
    const { display_name, phone_numbers, email_addresses, tags, link_chat_id } = body

    if (!display_name?.trim()) {
      return NextResponse.json(
        { error: 'Display name is required' },
        { status: 400 }
      )
    }

    // Normalize phone numbers
    const normalizedPhones = (phone_numbers || []).map((p: { number: string; type?: string }) => ({
      number: p.number,
      type: p.type || 'mobile',
      normalized: normalizePhoneNumber(p.number),
    }))

    // Create contact
    const { data: contact, error: createError } = await supabase
      .from('contacts')
      .insert({
        workspace_id: profile.workspace_id,
        display_name: display_name.trim(),
        phone_numbers: normalizedPhones,
        email_addresses: email_addresses || [],
        tags: tags || [],
        source: 'manual',
        source_metadata: {
          created_by: user.id,
          created_at: new Date().toISOString(),
        },
      })
      .select()
      .single()

    if (createError) {
      console.error('Error creating contact:', createError)
      return NextResponse.json(
        { error: 'Failed to create contact' },
        { status: 500 }
      )
    }

    // Create phone lookup entries
    if (normalizedPhones.length > 0) {
      const phoneEntries = normalizedPhones
        .filter((p: { normalized: string | null }) => p.normalized)
        .map((p: { normalized: string; type: string }) => ({
          contact_id: contact.id,
          phone_e164: p.normalized,
          phone_e164_hash: hashPhone(p.normalized),
          phone_type: p.type,
        }))

      if (phoneEntries.length > 0) {
        await supabase.from('contact_phone_lookup').insert(phoneEntries)
      }
    }

    // Link contact to chat if requested
    if (link_chat_id) {
      const { error: linkError } = await supabase
        .from('chats')
        .update({ contact_id: contact.id })
        .eq('id', link_chat_id)
        .eq('workspace_id', profile.workspace_id) // Security: only link chats in same workspace

      if (linkError) {
        console.error('Error linking contact to chat:', linkError)
        // Don't fail the request, contact was still created
      }
    }

    // Push to Whapi if sync channel is configured (async, don't block)
    pushNewContactToWhapi(
      {
        id: contact.id,
        workspace_id: profile.workspace_id,
        display_name: contact.display_name,
        phone_numbers: contact.phone_numbers,
        whapi_contact_id: null,
        whapi_synced_at: null,
        source: 'manual',
      },
      profile.workspace_id
    ).then(async (whapiContactId) => {
      if (whapiContactId) {
        // Update contact with Whapi ID
        const serviceClient = createServiceRoleClient()
        await serviceClient
          .from('contacts')
          .update({
            whapi_contact_id: whapiContactId,
            whapi_synced_at: new Date().toISOString(),
          })
          .eq('id', contact.id)
      }
    }).catch((err) => {
      console.error('Failed to push contact to Whapi:', err)
    })

    return NextResponse.json({ contact }, { status: 201 })
  } catch (error) {
    console.error('Contacts POST error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Normalize phone number to E.164 format
 */
function normalizePhoneNumber(phone: string): string | null {
  if (!phone) return null
  // Remove all non-digit characters except leading +
  let cleaned = phone.replace(/[^\d+]/g, '')
  // If no leading +, try to add country code
  if (!cleaned.startsWith('+')) {
    // Assume US if 10 digits
    if (cleaned.length === 10) {
      cleaned = '+1' + cleaned
    } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
      cleaned = '+' + cleaned
    } else {
      cleaned = '+' + cleaned
    }
  }
  return cleaned
}

/**
 * Hash phone number for lookups
 */
function hashPhone(phone: string): string {
  return createHash('sha256').update(phone).digest('hex')
}

/**
 * DELETE /api/contacts
 *
 * Bulk delete contacts.
 *
 * Body:
 * - ids: Array of contact IDs to delete (optional - if empty, deletes all)
 * - delete_all: Boolean to delete all contacts
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's workspace and role
    const { data: profile } = await supabase
      .from('profiles')
      .select('workspace_id, role')
      .eq('user_id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    }

    // Only admins can bulk delete
    if (!['main_admin', 'admin'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { ids, delete_all } = body

    const serviceClient = createServiceRoleClient()

    if (delete_all) {
      // Delete all contacts in workspace
      // First delete phone lookups
      const { data: allContacts } = await serviceClient
        .from('contacts')
        .select('id')
        .eq('workspace_id', profile.workspace_id)

      if (allContacts && allContacts.length > 0) {
        const contactIds = allContacts.map(c => c.id)

        await serviceClient
          .from('contact_phone_lookup')
          .delete()
          .in('contact_id', contactIds)

        const { error: deleteError, count } = await serviceClient
          .from('contacts')
          .delete({ count: 'exact' })
          .eq('workspace_id', profile.workspace_id)

        if (deleteError) {
          console.error('Error deleting all contacts:', deleteError)
          return NextResponse.json(
            { error: 'Failed to delete contacts' },
            { status: 500 }
          )
        }

        return NextResponse.json({ deleted: count || 0 })
      }

      return NextResponse.json({ deleted: 0 })
    }

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { error: 'No contact IDs provided' },
        { status: 400 }
      )
    }

    // Delete phone lookups first
    await serviceClient
      .from('contact_phone_lookup')
      .delete()
      .in('contact_id', ids)

    // Delete contacts (only from user's workspace)
    const { error: deleteError, count } = await serviceClient
      .from('contacts')
      .delete({ count: 'exact' })
      .in('id', ids)
      .eq('workspace_id', profile.workspace_id)

    if (deleteError) {
      console.error('Error deleting contacts:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete contacts' },
        { status: 500 }
      )
    }

    return NextResponse.json({ deleted: count || 0 })
  } catch (error) {
    console.error('Contacts DELETE error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
