import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createHash } from 'crypto'

/**
 * GET /api/contacts/[id]
 *
 * Get a single contact by ID.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const contactId = params.id

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
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const contactId = params.id

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
      .select('id, workspace_id')
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
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const contactId = params.id

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get contact to find workspace
    const { data: contact, error: fetchError } = await supabase
      .from('contacts')
      .select('id, workspace_id')
      .eq('id', contactId)
      .single()

    if (fetchError || !contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    }

    // Verify user is admin
    const { data: membership } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', contact.workspace_id)
      .eq('user_id', user.id)
      .single()

    if (!membership || membership.role !== 'admin') {
      return NextResponse.json(
        { error: 'Only admins can delete contacts' },
        { status: 403 }
      )
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
