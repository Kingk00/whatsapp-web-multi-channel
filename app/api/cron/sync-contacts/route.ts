import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { createHash, createDecipheriv } from 'crypto'
import { normalizePhoneNumber } from '@/lib/phone-utils'

// Extend timeout for large contact lists
export const maxDuration = 300 // 5 minutes

const CRON_SECRET = process.env.CRON_SECRET
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

interface SyncResult {
  workspace_id: string
  pulled: number
  pushed: number
  updated: number
  skipped: number
  deduped: number
  errors: string[]
}

interface DuplicateGroup {
  phone: string
  original: { id: string; display_name: string; created_at: string }
  duplicates: { id: string; display_name: string; created_at: string }[]
}

/**
 * GET /api/cron/sync-contacts
 *
 * Automated cron job to sync Google contacts for all workspaces every 1 hour.
 * Two-way sync:
 * 1. PULL: Fetch new contacts from Google → Database
 * 2. PUSH: Send non-Google contacts from Database → Google
 */
export async function GET(request: NextRequest) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization')
    if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return NextResponse.json({
        error: 'Google OAuth not configured',
        skipped: true
      })
    }

    const supabase = createServiceRoleClient()

    // Get all workspaces with active Google contacts integration
    const { data: integrations, error: intError } = await supabase
      .from('workspace_integrations')
      .select('workspace_id, config')
      .eq('provider', 'google_contacts')
      .eq('is_active', true)

    if (intError) {
      console.error('Error fetching integrations:', intError)
      return NextResponse.json({ error: 'Failed to fetch integrations' }, { status: 500 })
    }

    if (!integrations || integrations.length === 0) {
      return NextResponse.json({
        message: 'No Google contacts integrations found',
        synced: 0
      })
    }

    console.log(`[Cron] Starting Google contacts sync for ${integrations.length} workspace(s)`)

    const results: SyncResult[] = []

    for (const integration of integrations) {
      // Skip if no refresh token
      if (!integration.config?.encrypted_refresh_token) {
        console.log(`[Cron] Workspace ${integration.workspace_id}: No refresh token, skipping`)
        continue
      }

      // Skip if already syncing
      if (integration.config.sync_status === 'syncing') {
        console.log(`[Cron] Workspace ${integration.workspace_id}: Already syncing, skipping`)
        continue
      }

      try {
        const result = await syncWorkspaceContacts(
          supabase,
          integration.workspace_id,
          integration.config
        )
        results.push(result)
        console.log(`[Cron] Workspace ${integration.workspace_id}: Synced - pulled ${result.pulled}, pushed ${result.pushed}, updated ${result.updated}`)
      } catch (error) {
        console.error(`[Cron] Workspace ${integration.workspace_id}: Sync failed`, error)
        results.push({
          workspace_id: integration.workspace_id,
          pulled: 0,
          pushed: 0,
          updated: 0,
          skipped: 0,
          deduped: 0,
          errors: [error instanceof Error ? error.message : 'Unknown error'],
        })
      }
    }

    const totalPulled = results.reduce((sum, r) => sum + r.pulled, 0)
    const totalPushed = results.reduce((sum, r) => sum + r.pushed, 0)
    const totalUpdated = results.reduce((sum, r) => sum + r.updated, 0)
    const totalDeduped = results.reduce((sum, r) => sum + r.deduped, 0)
    const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0)

    console.log(`[Cron] Google contacts sync completed: ${results.length} workspaces, ${totalPulled} pulled, ${totalPushed} pushed, ${totalUpdated} updated, ${totalDeduped} deduped, ${totalErrors} errors`)

    return NextResponse.json({
      success: true,
      workspaces_synced: results.length,
      total_pulled: totalPulled,
      total_pushed: totalPushed,
      total_updated: totalUpdated,
      total_deduped: totalDeduped,
      total_errors: totalErrors,
      results,
    })
  } catch (error) {
    console.error('[Cron] Google contacts sync error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Sync contacts for a single workspace
 */
async function syncWorkspaceContacts(
  supabase: ReturnType<typeof createServiceRoleClient>,
  workspaceId: string,
  config: any
): Promise<SyncResult> {
  const errors: string[] = []

  // Set sync status to 'syncing'
  await supabase
    .from('workspace_integrations')
    .update({
      config: {
        ...config,
        sync_status: 'syncing',
        sync_started_at: new Date().toISOString(),
      },
    })
    .eq('workspace_id', workspaceId)
    .eq('provider', 'google_contacts')

  // Decrypt refresh token
  const refreshToken = decryptToken(config.encrypted_refresh_token)
  if (!refreshToken) {
    await updateSyncStatus(supabase, workspaceId, config, 'error', 'Failed to decrypt token')
    throw new Error('Failed to decrypt token')
  }

  // Exchange refresh token for access token
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID!,
      client_secret: GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text()
    console.error(`Token refresh failed for workspace ${workspaceId}:`, errorText)
    await updateSyncStatus(supabase, workspaceId, config, 'error', 'Failed to refresh Google token')
    throw new Error('Failed to refresh Google token')
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
    .eq('workspace_id', workspaceId)
    .eq('source', 'google')

  const existingByResourceName = new Map<string, { id: string; display_name: string }>()
  for (const c of existingGoogleContacts || []) {
    const resourceName = (c.source_metadata as any)?.google_resource_name
    if (resourceName) {
      existingByResourceName.set(resourceName, { id: c.id, display_name: c.display_name })
    }
  }

  // Pre-fetch all existing contacts for this workspace (for name + phone matching)
  const { data: allContacts } = await supabase
    .from('contacts')
    .select('id, display_name')
    .eq('workspace_id', workspaceId)

  const contactIds = (allContacts || []).map(c => c.id)

  // Normalize name for duplicate detection (lowercase, remove extra spaces/special chars)
  const normalizeName = (name: string): string => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '') // Remove special characters
      .replace(/\s+/g, ' ')         // Collapse multiple spaces
      .trim()
  }

  // Build a set of normalized display names for duplicate detection
  const existingDisplayNames = new Set<string>(
    (allContacts || []).map(c => c.display_name ? normalizeName(c.display_name) : '').filter(Boolean)
  )

  // Also build a set of phone number suffixes (last 7 digits) for fuzzy phone matching
  const existingPhoneSuffixes = new Set<string>()

  const existingPhoneHashes = new Set<string>()
  if (contactIds.length > 0) {
    for (let i = 0; i < contactIds.length; i += 500) {
      const batch = contactIds.slice(i, i + 500)
      const { data: phoneLookups } = await supabase
        .from('contact_phone_lookup')
        .select('phone_e164_hash, phone_e164')
        .in('contact_id', batch)

      for (const p of phoneLookups || []) {
        existingPhoneHashes.add(p.phone_e164_hash)
        // Also store last 7 digits for fuzzy matching
        if (p.phone_e164) {
          const digits = p.phone_e164.replace(/\D/g, '')
          if (digits.length >= 7) {
            existingPhoneSuffixes.add(digits.slice(-7))
          }
        }
      }
    }
  }

  // Process contacts from Google (PULL)
  let pulled = 0
  let updated = 0
  let skippedPull = 0

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

      if (phoneNumbers.length === 0) {
        skippedPull++
        continue
      }

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

      const normalizedPhones = phoneNumbers
        .map((p) => p.normalized)
        .filter(Boolean) as string[]

      const phoneHashes = normalizedPhones.map(hashPhone)
      const hasExistingPhone = phoneHashes.some(h => existingPhoneHashes.has(h))

      if (hasExistingPhone) {
        skippedPull++
        continue
      }

      // Check by phone suffix (last 7 digits) for fuzzy phone matching
      const phoneSuffixes = phoneNumbers
        .map(p => {
          const digits = (p.normalized || p.number).replace(/\D/g, '')
          return digits.length >= 7 ? digits.slice(-7) : null
        })
        .filter(Boolean) as string[]

      const hasExistingPhoneSuffix = phoneSuffixes.some(s => existingPhoneSuffixes.has(s))
      if (hasExistingPhoneSuffix) {
        skippedPull++
        continue
      }

      // Also check by normalized display name to catch duplicates with different phone formats
      const normalizedName = normalizeName(displayName)
      if (existingDisplayNames.has(normalizedName)) {
        skippedPull++
        continue
      }

      const contactId = crypto.randomUUID()
      contactsToCreate.push({
        id: contactId,
        workspace_id: workspaceId,
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
      existingDisplayNames.add(normalizedName)
      // Add phone suffixes to prevent duplicates within same batch
      for (const suffix of phoneSuffixes) {
        existingPhoneSuffixes.add(suffix)
      }

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

  const { data: nonGoogleContacts } = await supabase
    .from('contacts')
    .select('id, display_name, phone_numbers, email_addresses, source_metadata')
    .eq('workspace_id', workspaceId)
    .neq('source', 'google')

  for (const contact of nonGoogleContacts || []) {
    try {
      const existingResourceName = (contact.source_metadata as any)?.google_resource_name
      if (existingResourceName) {
        skippedPush++
        continue
      }

      const phones = contact.phone_numbers as Array<{ number: string; normalized?: string }> | null
      if (!phones || phones.length === 0) {
        skippedPush++
        continue
      }

      const resourceName = await pushContactToGoogle(tokens.access_token, {
        displayName: contact.display_name,
        phoneNumbers: phones.map(p => ({ value: p.number, type: (p as any).type || 'mobile' })),
        emailAddresses: ((contact.email_addresses as any[]) || []).map(e => ({
          value: e.email,
          type: e.type || 'personal',
        })),
      })

      if (resourceName) {
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
        console.log(`[Cron] Pushed contact "${contact.display_name}" to Google`)
      } else {
        errors.push(`Push failed for "${contact.display_name}" - no resource name returned`)
      }
    } catch (err: any) {
      errors.push(`Push error for "${contact.display_name}": ${err?.message || 'Unknown error'}`)
    }
  }

  // ========================================
  // PART 3: DEDUPE - Remove any duplicates created during sync
  // ========================================
  let deduped = 0

  try {
    console.log(`[Cron] Running dedupe for workspace ${workspaceId}`)
    const duplicateGroups = await findDuplicates(supabase, workspaceId)

    if (duplicateGroups.length > 0) {
      const idsToRemove: string[] = []
      for (const group of duplicateGroups) {
        idsToRemove.push(...group.duplicates.map(d => d.id))
      }

      if (idsToRemove.length > 0) {
        // Delete phone lookups first
        for (let i = 0; i < idsToRemove.length; i += 500) {
          const batch = idsToRemove.slice(i, i + 500)
          await supabase
            .from('contact_phone_lookup')
            .delete()
            .in('contact_id', batch)
        }

        // Delete contacts in batches
        for (let i = 0; i < idsToRemove.length; i += 500) {
          const batch = idsToRemove.slice(i, i + 500)
          await supabase
            .from('contacts')
            .delete()
            .in('id', batch)
            .eq('workspace_id', workspaceId)
        }

        deduped = idsToRemove.length
        console.log(`[Cron] Removed ${deduped} duplicate contacts from workspace ${workspaceId}`)
      }
    }
  } catch (err: any) {
    errors.push(`Dedupe error: ${err?.message || 'Unknown error'}`)
    console.error(`[Cron] Dedupe failed for workspace ${workspaceId}:`, err)
  }

  // Update sync status to completed
  const syncResult = {
    pulled,
    pushed,
    updated,
    skipped: skippedPull + skippedPush,
    deduped,
    errors: errors.length > 0 ? errors : undefined,
  }

  await supabase
    .from('workspace_integrations')
    .update({
      updated_at: new Date().toISOString(),
      config: {
        ...config,
        sync_status: 'completed',
        sync_completed_at: new Date().toISOString(),
        last_sync_result: syncResult,
      },
    })
    .eq('workspace_id', workspaceId)
    .eq('provider', 'google_contacts')

  return {
    workspace_id: workspaceId,
    pulled,
    pushed,
    updated,
    skipped: skippedPull + skippedPush,
    deduped,
    errors,
  }
}

/**
 * Update sync status in database
 */
async function updateSyncStatus(
  supabase: ReturnType<typeof createServiceRoleClient>,
  workspaceId: string,
  config: any,
  status: 'error' | 'completed',
  errorMessage?: string
) {
  await supabase
    .from('workspace_integrations')
    .update({
      config: {
        ...config,
        sync_status: status,
        sync_error: errorMessage,
        sync_completed_at: new Date().toISOString(),
      },
    })
    .eq('workspace_id', workspaceId)
    .eq('provider', 'google_contacts')
}

/**
 * Push a contact to Google People API
 * Returns resourceName on success, throws on error
 */
async function pushContactToGoogle(
  accessToken: string,
  contact: {
    displayName: string
    phoneNumbers: Array<{ value: string; type?: string }>
    emailAddresses?: Array<{ value: string; type?: string }>
  }
): Promise<string | null> {
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
    const errorData = await response.json().catch(() => ({ error: { message: response.statusText } }))
    const errorMessage = errorData?.error?.message || response.statusText
    console.error(`[Cron] Push API error (${response.status}): ${errorMessage}`)

    if (response.status === 403) {
      throw new Error(`Permission denied - need to reconnect Google with write access`)
    }
    throw new Error(`Google API error: ${errorMessage}`)
  }

  const data = await response.json()
  return data.resourceName || null
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

/**
 * Find duplicate contacts by phone number
 * Returns groups where each group has an original (oldest) and duplicates (newer)
 */
async function findDuplicates(
  supabase: ReturnType<typeof createServiceRoleClient>,
  workspaceId: string
): Promise<DuplicateGroup[]> {
  // Get ALL contacts with their phone numbers (handle Supabase 1000 row default limit)
  const allContacts: Array<{
    id: string
    display_name: string
    phone_numbers: any
    created_at: string
  }> = []

  const PAGE_SIZE = 1000
  let offset = 0
  let hasMore = true

  while (hasMore) {
    const { data: batch, error } = await supabase
      .from('contacts')
      .select('id, display_name, phone_numbers, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) {
      console.error('Error fetching contacts batch:', error)
      break
    }

    if (batch && batch.length > 0) {
      allContacts.push(...batch)
      offset += batch.length
      hasMore = batch.length === PAGE_SIZE
    } else {
      hasMore = false
    }
  }

  if (allContacts.length === 0) {
    return []
  }

  const contacts = allContacts

  // Group contacts by normalized phone number
  const phoneMap = new Map<string, typeof contacts>()

  for (const contact of contacts) {
    // Handle different phone_numbers formats (array, string, null)
    let phones: Array<{ number: string; normalized?: string }> = []

    if (Array.isArray(contact.phone_numbers)) {
      phones = contact.phone_numbers
    } else if (typeof contact.phone_numbers === 'string') {
      phones = [{ number: contact.phone_numbers }]
    } else if (contact.phone_numbers && typeof contact.phone_numbers === 'object') {
      phones = [contact.phone_numbers as { number: string; normalized?: string }]
    }

    if (phones.length === 0) continue

    for (const phone of phones) {
      const phoneNumber = phone.number || (phone as any).value || (phone as any).phone || String(phone)
      if (!phoneNumber || typeof phoneNumber !== 'string') continue

      const normalized = normalizePhoneNumber(phoneNumber)
      if (!normalized) continue

      const existing = phoneMap.get(normalized) || []
      if (!existing.some(c => c.id === contact.id)) {
        existing.push(contact)
        phoneMap.set(normalized, existing)
      }
    }
  }

  // Find groups with more than one contact
  const duplicateGroups: DuplicateGroup[] = []

  for (const [phone, group] of phoneMap.entries()) {
    if (group.length > 1) {
      // Sort by created_at to keep the oldest
      group.sort((a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )

      const [original, ...duplicates] = group

      // Only add if we haven't already processed this original
      const alreadyProcessed = duplicateGroups.some(
        dg => dg.original.id === original.id ||
              dg.duplicates.some(d => d.id === original.id)
      )

      if (!alreadyProcessed) {
        duplicateGroups.push({
          phone,
          original: {
            id: original.id,
            display_name: original.display_name,
            created_at: original.created_at,
          },
          duplicates: duplicates.map(d => ({
            id: d.id,
            display_name: d.display_name,
            created_at: d.created_at,
          })),
        })
      }
    }
  }

  return duplicateGroups
}
