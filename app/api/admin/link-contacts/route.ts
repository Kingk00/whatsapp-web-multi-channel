import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { createHash } from 'crypto'
import { normalizePhoneNumber } from '@/lib/phone-utils'

/**
 * POST /api/admin/link-contacts
 *
 * Comprehensive endpoint to link contacts to chats.
 *
 * This does three things:
 * 1. Ensures all contacts have phone_lookup entries
 * 2. Ensures all chats have phone_e164_hash
 * 3. Directly links chats to contacts by matching phone numbers
 *
 * Requires admin role.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const serviceSupabase = createServiceRoleClient()

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's profile and verify admin role
    const { data: profile } = await supabase
      .from('profiles')
      .select('workspace_id, role')
      .eq('user_id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Only admins can run this
    if (!['main_admin', 'admin'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const workspaceId = profile.workspace_id
    const stats = {
      contactsProcessed: 0,
      phoneLookupCreated: 0,
      chatsProcessed: 0,
      chatsHashUpdated: 0,
      chatsLinked: 0,
      errors: [] as string[],
    }

    // =================================================================
    // STEP 1: Ensure all contacts have phone lookup entries
    // =================================================================
    console.log('[Link Contacts] Step 1: Processing contact phone lookups')

    const { data: contacts } = await serviceSupabase
      .from('contacts')
      .select('id, phone_numbers')
      .eq('workspace_id', workspaceId)

    for (const contact of contacts || []) {
      stats.contactsProcessed++

      if (!contact.phone_numbers || !Array.isArray(contact.phone_numbers)) {
        continue
      }

      for (const phone of contact.phone_numbers) {
        const phoneNumber = phone.normalized || phone.number
        if (!phoneNumber) continue

        const normalizedPhone = normalizePhoneNumber(phoneNumber)
        if (!normalizedPhone) continue

        const phoneHash = createHash('sha256').update(normalizedPhone).digest('hex')

        // Check if lookup entry exists
        const { data: existing } = await serviceSupabase
          .from('contact_phone_lookup')
          .select('id')
          .eq('contact_id', contact.id)
          .eq('phone_e164_hash', phoneHash)
          .single()

        if (!existing) {
          // Create lookup entry
          const { error: insertError } = await serviceSupabase
            .from('contact_phone_lookup')
            .insert({
              contact_id: contact.id,
              phone_e164: normalizedPhone,
              phone_e164_hash: phoneHash,
              phone_type: phone.type || 'mobile',
            })

          if (!insertError) {
            stats.phoneLookupCreated++
          } else if (!insertError.message?.includes('duplicate')) {
            stats.errors.push(`Contact ${contact.id}: ${insertError.message}`)
          }
        }
      }
    }

    console.log(`[Link Contacts] Created ${stats.phoneLookupCreated} phone lookup entries`)

    // =================================================================
    // STEP 2: Build a map of phone hash -> contact ID
    // =================================================================
    console.log('[Link Contacts] Step 2: Building phone hash map')

    const { data: phoneLookups } = await serviceSupabase
      .from('contact_phone_lookup')
      .select(`
        phone_e164_hash,
        contact_id,
        contacts!inner (
          workspace_id
        )
      `)
      .eq('contacts.workspace_id', workspaceId)

    const phoneHashToContact = new Map<string, string>()
    for (const lookup of phoneLookups || []) {
      phoneHashToContact.set(lookup.phone_e164_hash, lookup.contact_id)
    }

    console.log(`[Link Contacts] Found ${phoneHashToContact.size} phone hashes for contacts`)

    // =================================================================
    // STEP 3: Process all chats - update hash and link to contacts
    // =================================================================
    console.log('[Link Contacts] Step 3: Processing chats')

    const { data: chats } = await serviceSupabase
      .from('chats')
      .select('id, phone_number, phone_e164_hash, contact_id')
      .eq('workspace_id', workspaceId)
      .eq('is_group', false) // Only individual chats have phone numbers

    for (const chat of chats || []) {
      stats.chatsProcessed++

      if (!chat.phone_number) continue

      const normalizedPhone = normalizePhoneNumber(chat.phone_number)
      if (!normalizedPhone) continue

      const phoneHash = createHash('sha256').update(normalizedPhone).digest('hex')

      // Check if we need to update the hash
      const needsHashUpdate = chat.phone_e164_hash !== phoneHash

      // Check if we can link to a contact
      const matchingContactId = phoneHashToContact.get(phoneHash)
      const needsContactLink = matchingContactId && chat.contact_id !== matchingContactId

      if (needsHashUpdate || needsContactLink) {
        const updateData: Record<string, any> = {
          updated_at: new Date().toISOString(),
        }

        if (needsHashUpdate) {
          updateData.phone_e164_hash = phoneHash
          stats.chatsHashUpdated++
        }

        if (needsContactLink) {
          updateData.contact_id = matchingContactId
          stats.chatsLinked++
        }

        const { error: updateError } = await serviceSupabase
          .from('chats')
          .update(updateData)
          .eq('id', chat.id)

        if (updateError) {
          stats.errors.push(`Chat ${chat.id}: ${updateError.message}`)
        }
      }
    }

    console.log(`[Link Contacts] Updated ${stats.chatsHashUpdated} chat hashes, linked ${stats.chatsLinked} chats`)

    return NextResponse.json({
      success: true,
      message: 'Contact linking complete',
      stats,
    })
  } catch (error) {
    console.error('Link contacts error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
