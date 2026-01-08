import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { createHash } from 'crypto'
import { pushContactUpdateToWhapi, pushContactDeleteToWhapi } from '@/lib/whapi-contacts-sync'

/**
 * GET /api/contacts/[id]
 *
 * Get a single contact by ID.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: contactId } = await params
    const supabase = await createClient()

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get contact (RLS will ensure workspace access)
    const { data: contact, error } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', contactId)
      .single()

    if (error || !contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    }

    return NextResponse.json({ contact })
  } catch (error) {
    console.error('Contact GET error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/contacts/[id]
 *
 * Update a contact. Any workspace member can edit.
 *
 * Body:
 * - display_name: Updated name
 * - phone_numbers: Updated phone numbers
 * - email_addresses: Updated emails
 * - tags: Updated tags
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: contactId } = await params
    const supabase = await createClient()

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify contact exists and user has access
    const { data: existingContact, error: fetchError } = await supabase
      .from('contacts')
      .select('id, workspace_id, whapi_contact_id')
      .eq('id', contactId)
      .single()

    if (fetchError || !existingContact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    }

    const body = await request.json()
    const { display_name, phone_numbers, email_addresses, tags } = body

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    if (display_name !== undefined) {
      if (!display_name?.trim()) {
        return NextResponse.json(
          { error: 'Display name cannot be empty' },
          { status: 400 }
        )
      }
      updateData.display_name = display_name.trim()
    }

    if (phone_numbers !== undefined) {
      const normalizedPhones = (phone_numbers || []).map((p: { number: string; type?: string }) => ({
        number: p.number,
        type: p.type || 'mobile',
        normalized: normalizePhoneNumber(p.number),
      }))
      updateData.phone_numbers = normalizedPhones

      // Update phone lookup entries
      await supabase
        .from('contact_phone_lookup')
        .delete()
        .eq('contact_id', contactId)

      const phoneEntries = normalizedPhones
        .filter((p: { normalized: string | null }) => p.normalized)
        .map((p: { normalized: string; type: string }) => ({
          contact_id: contactId,
          phone_e164: p.normalized,
          phone_e164_hash: hashPhone(p.normalized),
          phone_type: p.type,
        }))

      if (phoneEntries.length > 0) {
        await supabase.from('contact_phone_lookup').insert(phoneEntries)
      }
    }

    if (email_addresses !== undefined) {
      updateData.email_addresses = email_addresses
    }

    if (tags !== undefined) {
      updateData.tags = tags
    }

    // Update contact
    const { data: contact, error: updateError } = await supabase
      .from('contacts')
      .update(updateData)
      .eq('id', contactId)
      .select()
      .single()

    if (updateError) {
      console.error('Error updating contact:', updateError)
      return NextResponse.json(
        { error: 'Failed to update contact' },
        { status: 500 }
      )
    }

    // Push update to Whapi if contact has whapi_contact_id (async, don't block)
    if (existingContact.whapi_contact_id && display_name !== undefined) {
      pushContactUpdateToWhapi(
        {
          id: contact.id,
          workspace_id: existingContact.workspace_id,
          display_name: contact.display_name,
          phone_numbers: contact.phone_numbers,
          whapi_contact_id: existingContact.whapi_contact_id,
          whapi_synced_at: null,
          source: contact.source,
        },
        existingContact.workspace_id
      ).then(async (success) => {
        if (success) {
          // Update sync timestamp
          const serviceClient = createServiceRoleClient()
          await serviceClient
            .from('contacts')
            .update({ whapi_synced_at: new Date().toISOString() })
            .eq('id', contact.id)
        }
      }).catch((err) => {
        console.error('Failed to push contact update to Whapi:', err)
      })
    }

    return NextResponse.json({ contact })
  } catch (error) {
    console.error('Contact PATCH error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/contacts/[id]
 *
 * Delete a contact. Admin only.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: contactId } = await params
    const supabase = await createClient()

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get contact to find workspace and whapi_contact_id
    const { data: contact, error: fetchError } = await supabase
      .from('contacts')
      .select('id, workspace_id, whapi_contact_id')
      .eq('id', contactId)
      .single()

    if (fetchError || !contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    }

    // Verify user is admin (main_admin or admin)
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('workspace_id', contact.workspace_id)
      .eq('user_id', user.id)
      .single()

    if (!profile || !['main_admin', 'admin'].includes(profile.role)) {
      return NextResponse.json(
        { error: 'Only admins can delete contacts' },
        { status: 403 }
      )
    }

    // Delete from Whapi first if contact has whapi_contact_id
    if (contact.whapi_contact_id) {
      try {
        await pushContactDeleteToWhapi(contact.whapi_contact_id, contact.workspace_id)
      } catch (err) {
        console.error('Failed to delete contact from Whapi:', err)
        // Continue with local delete even if Whapi delete fails
      }
    }

    // Delete contact (phone lookup will cascade)
    const { error: deleteError } = await supabase
      .from('contacts')
      .delete()
      .eq('id', contactId)

    if (deleteError) {
      console.error('Error deleting contact:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete contact' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Contact DELETE error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

function normalizePhoneNumber(phone: string): string | null {
  if (!phone) return null
  let cleaned = phone.replace(/[^\d+]/g, '')
  if (!cleaned.startsWith('+')) {
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

function hashPhone(phone: string): string {
  return createHash('sha256').update(phone).digest('hex')
}
