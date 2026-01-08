/**
 * Whapi Contacts Sync Helper
 *
 * Utilities for syncing contacts between Whapi (WhatsApp) and the workspace.
 * Provides functions to get the sync channel client and push contact changes to Whapi.
 */

import { createServiceRoleClient } from '@/lib/supabase/server'
import { decrypt, normalizePhoneE164, hashPhoneE164 } from '@/lib/encryption'
import { WhapiClient, WhapiContact } from '@/lib/whapi-client'

// Types
export interface WorkspaceSyncSettings {
  sync_channel_id: string | null
  last_synced_at: string | null
  google_contacts_token: string | null
}

export interface SyncResult {
  created: number
  updated: number
  skipped: number
  errors: string[]
}

export interface Contact {
  id: string
  workspace_id: string
  display_name: string
  phone_numbers: Array<{
    number: string
    type?: string
    normalized?: string
  }> | null
  whapi_contact_id: string | null
  whapi_synced_at: string | null
  source: string
}

/**
 * Get the workspace's sync settings from the workspaces table
 */
export async function getWorkspaceSyncSettings(
  workspaceId: string
): Promise<WorkspaceSyncSettings | null> {
  const supabase = createServiceRoleClient()

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('settings')
    .eq('id', workspaceId)
    .single()

  if (!workspace?.settings?.whapi_contacts_sync) {
    return null
  }

  return workspace.settings.whapi_contacts_sync as WorkspaceSyncSettings
}

/**
 * Get the WhapiClient for the workspace's designated sync channel
 * Returns null if no sync channel is configured or token is not found
 */
export async function getSyncChannelClient(
  workspaceId: string
): Promise<{ client: WhapiClient; channelId: string } | null> {
  const supabase = createServiceRoleClient()

  // Get workspace settings to find sync channel
  const syncSettings = await getWorkspaceSyncSettings(workspaceId)
  if (!syncSettings?.sync_channel_id) {
    return null
  }

  const syncChannelId = syncSettings.sync_channel_id

  // Get channel token
  const { data: tokenRow } = await supabase
    .from('channel_tokens')
    .select('encrypted_token')
    .eq('channel_id', syncChannelId)
    .eq('token_type', 'whapi')
    .single()

  if (!tokenRow?.encrypted_token) {
    console.error(`No token found for sync channel ${syncChannelId}`)
    return null
  }

  try {
    const token = decrypt(tokenRow.encrypted_token)
    return {
      client: new WhapiClient({ token }),
      channelId: syncChannelId,
    }
  } catch (error) {
    console.error('Failed to decrypt sync channel token:', error)
    return null
  }
}

/**
 * Push a new contact to Whapi
 * Called after creating a contact locally
 * Uses Google Contacts integration if token is configured
 */
export async function pushNewContactToWhapi(
  contact: Contact,
  workspaceId: string
): Promise<string | null> {
  const syncClient = await getSyncChannelClient(workspaceId)
  if (!syncClient) {
    // No sync channel configured, skip silently
    return null
  }

  // Get the primary phone number
  const phoneNumber = contact.phone_numbers?.[0]?.normalized || contact.phone_numbers?.[0]?.number
  if (!phoneNumber) {
    console.log('Contact has no phone number, skipping Whapi push')
    return null
  }

  // Normalize phone number
  const normalizedPhone = normalizePhoneE164(phoneNumber)
  if (!normalizedPhone) {
    console.log('Invalid phone number format, skipping Whapi push')
    return null
  }

  // Check for Google Contacts token
  const syncSettings = await getWorkspaceSyncSettings(workspaceId)
  const googleContactsToken = syncSettings?.google_contacts_token

  try {
    if (googleContactsToken) {
      // Use Google Contacts integration to add contact
      await syncClient.client.addGoogleContacts(googleContactsToken, [
        {
          phone: normalizedPhone.replace('+', ''),
          name: contact.display_name,
        },
      ])
      // Google Contacts doesn't return an ID, so we generate one from the phone
      return `${normalizedPhone.replace('+', '')}@s.whatsapp.net`
    } else {
      // Use direct Whapi API
      const whapiContact = await syncClient.client.createContact({
        phone: normalizedPhone.replace('+', ''), // Whapi expects phone without +
        name: contact.display_name,
      })
      return whapiContact.id
    }
  } catch (error: any) {
    // If contact already exists (409), try to find and return its ID
    if (error?.status === 409) {
      console.log('Contact already exists in Whapi')
    } else {
      console.error('Failed to push contact to Whapi:', error?.message || error)
    }
    return null
  }
}

/**
 * Push contact update to Whapi
 * Called after updating a contact locally
 */
export async function pushContactUpdateToWhapi(
  contact: Contact,
  workspaceId: string
): Promise<boolean> {
  if (!contact.whapi_contact_id) {
    // Contact not synced to Whapi, nothing to update
    return false
  }

  const syncClient = await getSyncChannelClient(workspaceId)
  if (!syncClient) {
    return false
  }

  try {
    await syncClient.client.updateContact(contact.whapi_contact_id, {
      name: contact.display_name,
    })
    return true
  } catch (error: any) {
    console.error('Failed to update contact in Whapi:', error?.message || error)
    return false
  }
}

/**
 * Delete contact from Whapi
 * Called before/after deleting a contact locally
 */
export async function pushContactDeleteToWhapi(
  whapiContactId: string,
  workspaceId: string
): Promise<boolean> {
  const syncClient = await getSyncChannelClient(workspaceId)
  if (!syncClient) {
    return false
  }

  try {
    await syncClient.client.deleteContact(whapiContactId)
    return true
  } catch (error: any) {
    console.error('Failed to delete contact from Whapi:', error?.message || error)
    return false
  }
}

/**
 * Sync contacts from Whapi to the workspace
 * Main sync function that pulls contacts and upserts them
 * Uses Google Contacts integration if token is configured
 */
export async function syncContactsFromWhapi(
  workspaceId: string,
  syncChannelId: string
): Promise<SyncResult> {
  const result: SyncResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  }

  const supabase = createServiceRoleClient()

  // Get workspace settings to check for Google Contacts token
  const syncSettings = await getWorkspaceSyncSettings(workspaceId)
  const googleContactsToken = syncSettings?.google_contacts_token

  // Get channel token
  const { data: tokenRow } = await supabase
    .from('channel_tokens')
    .select('encrypted_token')
    .eq('channel_id', syncChannelId)
    .eq('token_type', 'whapi')
    .single()

  if (!tokenRow?.encrypted_token) {
    result.errors.push('Channel token not found')
    return result
  }

  let whapiClient: WhapiClient
  try {
    const token = decrypt(tokenRow.encrypted_token)
    whapiClient = new WhapiClient({ token })
  } catch (error) {
    result.errors.push('Failed to decrypt channel token')
    return result
  }

  // Fetch contacts from Whapi (using Google Contacts if token available)
  let whapiContacts: WhapiContact[]
  try {
    if (googleContactsToken) {
      // Use Google Contacts integration
      whapiContacts = await whapiClient.getGoogleContacts(googleContactsToken)
    } else {
      // Fall back to direct Whapi contacts API
      whapiContacts = await whapiClient.getContacts()
    }
  } catch (error: any) {
    result.errors.push(`Failed to fetch contacts from Whapi: ${error?.message || 'Unknown error'}`)
    return result
  }

  // Get existing contacts with whapi_contact_id in this workspace
  const { data: existingContacts } = await supabase
    .from('contacts')
    .select('id, whapi_contact_id, display_name')
    .eq('workspace_id', workspaceId)
    .not('whapi_contact_id', 'is', null)

  const existingByWhapiId = new Map(
    (existingContacts || []).map((c) => [c.whapi_contact_id, c])
  )

  // Get phone lookup for matching
  const { data: phoneLookups } = await supabase
    .from('contact_phone_lookup')
    .select('contact_id, phone_e164_hash')
    .in(
      'contact_id',
      (
        await supabase
          .from('contacts')
          .select('id')
          .eq('workspace_id', workspaceId)
      ).data?.map((c) => c.id) || []
    )

  const contactByPhoneHash = new Map(
    (phoneLookups || []).map((p) => [p.phone_e164_hash, p.contact_id])
  )

  // Process each Whapi contact
  for (const whapiContact of whapiContacts) {
    try {
      // Skip contacts without name or id
      if (!whapiContact.id || !whapiContact.name) {
        result.skipped++
        continue
      }

      // A. Check if we already have this Whapi contact
      const existingByWhapi = existingByWhapiId.get(whapiContact.id)
      if (existingByWhapi) {
        // Update name if changed
        if (existingByWhapi.display_name !== whapiContact.name) {
          await supabase
            .from('contacts')
            .update({
              display_name: whapiContact.name,
              whapi_synced_at: new Date().toISOString(),
            })
            .eq('id', existingByWhapi.id)
          result.updated++
        } else {
          result.skipped++
        }
        continue
      }

      // B. Try to find by phone number match
      // The Whapi contact ID format is typically phone@s.whatsapp.net
      const phoneFromId = whapiContact.id.split('@')[0]
      const normalizedPhone = normalizePhoneE164(phoneFromId)
      const phoneHash = normalizedPhone ? hashPhoneE164(normalizedPhone) : null

      if (phoneHash && contactByPhoneHash.has(phoneHash)) {
        const existingContactId = contactByPhoneHash.get(phoneHash)
        // Link existing contact to Whapi
        await supabase
          .from('contacts')
          .update({
            whapi_contact_id: whapiContact.id,
            whapi_synced_at: new Date().toISOString(),
            // Update name only if contact has no name or is phone number only
          })
          .eq('id', existingContactId)
        result.updated++
        continue
      }

      // C. Create new contact
      if (normalizedPhone) {
        const { data: newContact, error: insertError } = await supabase
          .from('contacts')
          .insert({
            workspace_id: workspaceId,
            display_name: whapiContact.name,
            phone_numbers: [
              {
                number: normalizedPhone,
                type: 'mobile',
                normalized: normalizedPhone,
              },
            ],
            source: 'whapi_sync',
            whapi_contact_id: whapiContact.id,
            whapi_synced_at: new Date().toISOString(),
          })
          .select('id')
          .single()

        if (insertError) {
          result.errors.push(`Failed to create contact ${whapiContact.name}: ${insertError.message}`)
        } else if (newContact) {
          // Create phone lookup entry
          const phoneHashForLookup = hashPhoneE164(normalizedPhone)
          if (phoneHashForLookup) {
            await supabase.from('contact_phone_lookup').insert({
              contact_id: newContact.id,
              phone_e164: normalizedPhone,
              phone_e164_hash: phoneHashForLookup,
              phone_type: 'mobile',
            })
          }
          result.created++
        }
      } else {
        result.skipped++
      }
    } catch (err: any) {
      result.errors.push(`Error processing contact ${whapiContact.name}: ${err?.message || 'Unknown error'}`)
    }
  }

  // Update last_synced_at in workspace settings
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('settings')
    .eq('id', workspaceId)
    .single()

  const currentSettings = workspace?.settings || {}
  await supabase
    .from('workspaces')
    .update({
      settings: {
        ...currentSettings,
        whapi_contacts_sync: {
          ...currentSettings.whapi_contacts_sync,
          sync_channel_id: syncChannelId,
          last_synced_at: new Date().toISOString(),
        },
      },
    })
    .eq('id', workspaceId)

  return result
}
