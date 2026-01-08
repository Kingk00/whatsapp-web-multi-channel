import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { validateApiAuth } from '@/lib/auth-helpers'
import { createHash, createDecipheriv } from 'crypto'
import { normalizePhoneNumber } from '@/lib/phone-utils'

// Extend timeout for large contact lists
export const maxDuration = 300 // 5 minutes (requires Vercel Pro, otherwise max 60s)

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY

interface GoogleContact {
  resourceName: string
  names?: { displayName?: string; givenName?: string; familyName?: string }[]
  phoneNumbers?: { value?: string; type?: string }[]
  emailAddresses?: { value?: string; type?: string }[]
}

interface GoogleContactsResponse {
  connections?: GoogleContact[]
  totalItems?: number
  nextPageToken?: string
}

/**
 * GET /api/contacts/sync/google
 *
 * Check if Google sync is configured and available
 */
export async function GET() {
  try {
    const { profile } = await validateApiAuth()

    if (!['main_admin', 'admin'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const supabase = createServiceRoleClient()

    // Check if we have a stored refresh token
    const { data: integration } = await supabase
      .from('workspace_integrations')
      .select('config, is_active, updated_at')
      .eq('workspace_id', profile.workspace_id)
      .eq('provider', 'google_contacts')
      .single()

    const hasToken = !!integration?.config?.encrypted_refresh_token
    const isConfigured = !!GOOGLE_CLIENT_ID && !!GOOGLE_CLIENT_SECRET
    const connectedEmail = integration?.config?.connected_email || null
    const syncStatus = integration?.config?.sync_status || null
    const syncStartedAt = integration?.config?.sync_started_at || null
    const syncCompletedAt = integration?.config?.sync_completed_at || null
    const syncError = integration?.config?.sync_error || null
    const lastSyncResult = integration?.config?.last_sync_result || null

    return NextResponse.json({
      configured: isConfigured,
      connected: hasToken && integration?.is_active,
      last_synced: integration?.updated_at,
      connected_email: connectedEmail,
      sync_status: syncStatus,
      sync_started_at: syncStartedAt,
      sync_completed_at: syncCompletedAt,
      sync_error: syncError,
      last_sync_result: lastSyncResult,
    })
  } catch (error) {
    if (error instanceof Response) {
      return error
    }
    console.error('Google sync status error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/contacts/sync/google
 *
 * Two-way sync:
 * 1. PULL: Fetch new contacts from Google → Database
 * 2. PUSH: Send non-Google contacts from Database → Google
 */
export async function POST(request: NextRequest) {
  try {
    const { profile } = await validateApiAuth()

    if (!['main_admin', 'admin'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return NextResponse.json(
        { error: 'Google OAuth not configured' },
        { status: 503 }
      )
    }

    const supabase = createServiceRoleClient()

    // Get stored refresh token
    const { data: integration } = await supabase
      .from('workspace_integrations')
      .select('config')
      .eq('workspace_id', profile.workspace_id)
      .eq('provider', 'google_contacts')
      .single()

    if (!integration?.config?.encrypted_refresh_token) {
      return NextResponse.json(
        { error: 'Google Contacts not connected. Please import from Google first.' },
        { status: 400 }
      )
    }

    // Check if already syncing
    if (integration.config.sync_status === 'syncing') {
      return NextResponse.json(
        { error: 'Sync already in progress', syncing: true },
        { status: 409 }
      )
    }

    // Set sync status to 'syncing'
    await supabase
      .from('workspace_integrations')
      .update({
        config: {
          ...integration.config,
          sync_status: 'syncing',
          sync_started_at: new Date().toISOString(),
        },
      })
      .eq('workspace_id', profile.workspace_id)
      .eq('provider', 'google_contacts')

    // Decrypt refresh token
    const refreshToken = decryptToken(integration.config.encrypted_refresh_token)
    if (!refreshToken) {
      // Reset sync status on error
      await supabase
        .from('workspace_integrations')
        .update({
          config: {
            ...integration.config,
            sync_status: 'error',
            sync_error: 'Failed to decrypt token',
            sync_completed_at: new Date().toISOString(),
          },
        })
        .eq('workspace_id', profile.workspace_id)
        .eq('provider', 'google_contacts')
      return NextResponse.json(
        { error: 'Failed to decrypt token. Please reconnect Google.' },
        { status: 400 }
      )
    }

    // Exchange refresh token for access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    })

    if (!tokenResponse.ok) {
      console.error('Token refresh failed:', await tokenResponse.text())
      // Reset sync status on error
      await supabase
        .from('workspace_integrations')
        .update({
          config: {
            ...integration.config,
            sync_status: 'error',
            sync_error: 'Failed to refresh Google token',
            sync_completed_at: new Date().toISOString(),
          },
        })
        .eq('workspace_id', profile.workspace_id)
        .eq('provider', 'google_contacts')
      return NextResponse.json(
        { error: 'Failed to refresh Google token. Please reconnect Google.' },
        { status: 400 }
      )
    }

    const tokens = await tokenResponse.json()

    // ========================================
    // PART 1: PULL - Fetch contacts FROM Google
    // ========================================
    const googleContacts = await fetchGoogleContacts(tokens.access_token)

    // Pre-fetch all existing Google resource names for this workspace
    const { data: existingGoogleContacts } = await supabase
      .from('contacts')
      .select('id, display_name, source_metadata')
      .eq('workspace_id', profile.workspace_id)
      .eq('source', 'google')

    const existingByResourceName = new Map<string, { id: string; display_name: string }>()
    for (const c of existingGoogleContacts || []) {
      const resourceName = (c.source_metadata as any)?.google_resource_name
      if (resourceName) {
        existingByResourceName.set(resourceName, { id: c.id, display_name: c.display_name })
      }
    }

    // Pre-fetch all existing phone hashes for this workspace
    const { data: allContacts } = await supabase
      .from('contacts')
      .select('id')
      .eq('workspace_id', profile.workspace_id)

    const contactIds = (allContacts || []).map(c => c.id)

    const existingPhoneHashes = new Set<string>()
    if (contactIds.length > 0) {
      // Fetch in batches to avoid query limits
      for (let i = 0; i < contactIds.length; i += 500) {
        const batch = contactIds.slice(i, i + 500)
        const { data: phoneLookups } = await supabase
          .from('contact_phone_lookup')
          .select('phone_e164_hash')
          .in('contact_id', batch)

        for (const p of phoneLookups || []) {
          existingPhoneHashes.add(p.phone_e164_hash)
        }
      }
    }

    // Process contacts from Google (PULL)
    let pulled = 0
    let updated = 0
    let skippedPull = 0
    const errors: string[] = []

    const BATCH_SIZE = 50
    const contactsToCreate: any[] = []
    const phoneLookupEntries: any[] = []

    for (const contact of googleContacts) {
      try {
        const displayName = contact.names?.[0]?.displayName ||
          contact.names?.[0]?.givenName ||
          'Unnamed Contact'

        const phoneNumbers = (contact.phoneNumbers || [])
          .filter((p) => p.value)
          .map((p) => ({
            number: p.value!,
            type: p.type || 'mobile',
            normalized: normalizePhoneNumber(p.value!),
          }))

        // Skip contacts without phone numbers
        if (phoneNumbers.length === 0) {
          skippedPull++
          continue
        }

        // Check if already exists by Google resource name
        const existingByGoogle = existingByResourceName.get(contact.resourceName)
        if (existingByGoogle) {
          if (existingByGoogle.display_name !== displayName) {
            await supabase
              .from('contacts')
              .update({ display_name: displayName })
              .eq('id', existingByGoogle.id)
            updated++
          } else {
            skippedPull++
          }
          continue
        }

        // Check if exists by phone number
        const normalizedPhones = phoneNumbers
          .map((p) => p.normalized)
          .filter(Boolean) as string[]

        const phoneHashes = normalizedPhones.map(hashPhone)
        const hasExistingPhone = phoneHashes.some(h => existingPhoneHashes.has(h))

        if (hasExistingPhone) {
          skippedPull++
          continue
        }

        // Add to batch for creation
        const contactId = crypto.randomUUID()
        contactsToCreate.push({
          id: contactId,
          workspace_id: profile.workspace_id,
          display_name: displayName,
          phone_numbers: phoneNumbers,
          email_addresses: (contact.emailAddresses || [])
            .filter((e) => e.value)
            .map((e) => ({ email: e.value!, type: e.type || 'personal' })),
          source: 'google',
          source_metadata: {
            google_resource_name: contact.resourceName,
            synced_at: new Date().toISOString(),
          },
        })

        // Prepare phone lookup entries
        for (const p of phoneNumbers) {
          if (p.normalized) {
            const hash = hashPhone(p.normalized)
            phoneLookupEntries.push({
              contact_id: contactId,
              phone_e164: p.normalized,
              phone_e164_hash: hash,
              phone_type: p.type,
            })
            existingPhoneHashes.add(hash)
          }
        }

        existingByResourceName.set(contact.resourceName, { id: contactId, display_name: displayName })

        // Insert batch when full
        if (contactsToCreate.length >= BATCH_SIZE) {
          const { error: batchError } = await supabase
            .from('contacts')
            .insert(contactsToCreate)

          if (batchError) {
            errors.push(`Pull batch failed: ${batchError.message}`)
          } else {
            pulled += contactsToCreate.length
          }

          if (phoneLookupEntries.length > 0) {
            await supabase.from('contact_phone_lookup').insert(phoneLookupEntries)
          }

          contactsToCreate.length = 0
          phoneLookupEntries.length = 0
        }
      } catch (err: any) {
        errors.push(`Pull error: ${err?.message || 'Unknown error'}`)
      }
    }

    // Insert remaining pulled contacts
    if (contactsToCreate.length > 0) {
      const { error: batchError } = await supabase
        .from('contacts')
        .insert(contactsToCreate)

      if (batchError) {
        errors.push(`Pull final batch failed: ${batchError.message}`)
      } else {
        pulled += contactsToCreate.length
      }

      if (phoneLookupEntries.length > 0) {
        await supabase.from('contact_phone_lookup').insert(phoneLookupEntries)
      }
    }

    // ========================================
    // PART 2: PUSH - Send non-Google contacts TO Google
    // ========================================
    let pushed = 0
    let skippedPush = 0

    // Get all non-Google contacts that haven't been pushed yet
    const { data: nonGoogleContacts } = await supabase
      .from('contacts')
      .select('id, display_name, phone_numbers, email_addresses, source_metadata')
      .eq('workspace_id', profile.workspace_id)
      .neq('source', 'google')

    // Build set of Google resource names we already know about
    const googleResourceNames = new Set(existingByResourceName.keys())

    for (const contact of nonGoogleContacts || []) {
      try {
        // Skip if already pushed to Google (has google_resource_name in metadata)
        const existingResourceName = (contact.source_metadata as any)?.google_resource_name
        if (existingResourceName) {
          skippedPush++
          continue
        }

        // Get phone numbers
        const phones = contact.phone_numbers as Array<{ number: string; normalized?: string }> | null
        if (!phones || phones.length === 0) {
          skippedPush++
          continue
        }

        // Push to Google
        const resourceName = await pushContactToGoogle(tokens.access_token, {
          displayName: contact.display_name,
          phoneNumbers: phones.map(p => ({ value: p.number, type: (p as any).type || 'mobile' })),
          emailAddresses: ((contact.email_addresses as any[]) || []).map(e => ({
            value: e.email,
            type: e.type || 'personal',
          })),
        })

        if (resourceName) {
          // Update contact with Google resource name
          await supabase
            .from('contacts')
            .update({
              source_metadata: {
                ...(contact.source_metadata as object || {}),
                google_resource_name: resourceName,
                pushed_to_google_at: new Date().toISOString(),
              },
            })
            .eq('id', contact.id)

          pushed++
        } else {
          skippedPush++
        }
      } catch (err: any) {
        errors.push(`Push error: ${err?.message || 'Unknown error'}`)
      }
    }

    // Update sync status to completed
    const syncResult = {
      pulled,
      pushed,
      updated,
      skipped: skippedPull + skippedPush,
      errors: errors.length > 0 ? errors : undefined,
    }

    await supabase
      .from('workspace_integrations')
      .update({
        updated_at: new Date().toISOString(),
        config: {
          ...integration.config,
          sync_status: 'completed',
          sync_completed_at: new Date().toISOString(),
          last_sync_result: syncResult,
        },
      })
      .eq('workspace_id', profile.workspace_id)
      .eq('provider', 'google_contacts')

    return NextResponse.json({
      success: true,
      result: syncResult,
    })
  } catch (error) {
    if (error instanceof Response) {
      return error
    }
    console.error('Google contacts sync error:', error)

    // Try to update sync status to error
    try {
      const supabase = createServiceRoleClient()
      const { profile } = await validateApiAuth()
      const { data: integration } = await supabase
        .from('workspace_integrations')
        .select('config')
        .eq('workspace_id', profile.workspace_id)
        .eq('provider', 'google_contacts')
        .single()

      if (integration) {
        await supabase
          .from('workspace_integrations')
          .update({
            config: {
              ...integration.config,
              sync_status: 'error',
              sync_error: error instanceof Error ? error.message : 'Unknown error',
              sync_completed_at: new Date().toISOString(),
            },
          })
          .eq('workspace_id', profile.workspace_id)
          .eq('provider', 'google_contacts')
      }
    } catch (e) {
      // Ignore status update errors
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/contacts/sync/google
 *
 * Disconnect Google integration (removes stored token but keeps imported contacts)
 */
export async function DELETE() {
  try {
    const { profile } = await validateApiAuth()

    if (!['main_admin', 'admin'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const supabase = createServiceRoleClient()

    // Delete the integration record (contacts are kept)
    const { error } = await supabase
      .from('workspace_integrations')
      .delete()
      .eq('workspace_id', profile.workspace_id)
      .eq('provider', 'google_contacts')

    if (error) {
      console.error('Failed to disconnect Google:', error)
      return NextResponse.json(
        { error: 'Failed to disconnect Google' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Response) {
      return error
    }
    console.error('Disconnect Google error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Push a contact to Google People API
 */
async function pushContactToGoogle(
  accessToken: string,
  contact: {
    displayName: string
    phoneNumbers: Array<{ value: string; type?: string }>
    emailAddresses?: Array<{ value: string; type?: string }>
  }
): Promise<string | null> {
  try {
    const response = await fetch('https://people.googleapis.com/v1/people:createContact', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        names: [{ givenName: contact.displayName }],
        phoneNumbers: contact.phoneNumbers.map(p => ({
          value: p.value,
          type: p.type || 'mobile',
        })),
        emailAddresses: contact.emailAddresses?.map(e => ({
          value: e.value,
          type: e.type || 'other',
        })) || [],
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Failed to push contact to Google:', errorText)
      return null
    }

    const data = await response.json()
    return data.resourceName || null
  } catch (error) {
    console.error('Error pushing contact to Google:', error)
    return null
  }
}

/**
 * Fetch all contacts from Google People API
 */
async function fetchGoogleContacts(accessToken: string): Promise<GoogleContact[]> {
  const contacts: GoogleContact[] = []
  let pageToken: string | undefined

  do {
    const url = new URL('https://people.googleapis.com/v1/people/me/connections')
    url.searchParams.set('personFields', 'names,phoneNumbers,emailAddresses')
    url.searchParams.set('pageSize', '1000')
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken)
    }

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!response.ok) {
      console.error('Google People API error:', await response.text())
      break
    }

    const data: GoogleContactsResponse = await response.json()
    if (data.connections) {
      contacts.push(...data.connections)
    }
    pageToken = data.nextPageToken
  } while (pageToken)

  return contacts
}

/**
 * Decrypt token using AES-256-GCM
 */
function decryptToken(encrypted: string): string | null {
  if (!ENCRYPTION_KEY) return null

  try {
    const [ivHex, authTagHex, encryptedHex] = encrypted.split(':')
    const key = createHash('sha256').update(ENCRYPTION_KEY).digest()
    const iv = Buffer.from(ivHex, 'hex')
    const authTag = Buffer.from(authTagHex, 'hex')
    const encryptedData = Buffer.from(encryptedHex, 'hex')

    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)

    let decrypted = decipher.update(encryptedData, undefined, 'utf8')
    decrypted += decipher.final('utf8')

    return decrypted
  } catch (error) {
    console.error('Token decryption failed:', error)
    return null
  }
}

/**
 * Hash phone number for lookups
 */
function hashPhone(phone: string): string {
  return createHash('sha256').update(phone).digest('hex')
}
