import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { validateApiAuth } from '@/lib/auth-helpers'
import { createHash, createDecipheriv } from 'crypto'

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

    return NextResponse.json({
      configured: isConfigured,
      connected: hasToken && integration?.is_active,
      last_synced: integration?.updated_at,
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
 * Sync contacts from Google using stored refresh token
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

    // Decrypt refresh token
    const refreshToken = decryptToken(integration.config.encrypted_refresh_token)
    if (!refreshToken) {
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
      return NextResponse.json(
        { error: 'Failed to refresh Google token. Please reconnect Google.' },
        { status: 400 }
      )
    }

    const tokens = await tokenResponse.json()

    // Fetch contacts from Google
    const contacts = await fetchGoogleContacts(tokens.access_token)

    // Sync contacts to database
    let created = 0
    let updated = 0
    let skipped = 0
    const errors: string[] = []

    for (const contact of contacts) {
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

        const emailAddresses = (contact.emailAddresses || [])
          .filter((e) => e.value)
          .map((e) => ({
            email: e.value!,
            type: e.type || 'personal',
          }))

        // Skip contacts without phone numbers
        if (phoneNumbers.length === 0) {
          skipped++
          continue
        }

        // Check if contact exists by Google resource name
        const { data: existingByGoogle } = await supabase
          .from('contacts')
          .select('id, display_name')
          .eq('workspace_id', profile.workspace_id)
          .eq('source_metadata->>google_resource_name', contact.resourceName)
          .single()

        if (existingByGoogle) {
          // Update if name changed
          if (existingByGoogle.display_name !== displayName) {
            await supabase
              .from('contacts')
              .update({ display_name: displayName })
              .eq('id', existingByGoogle.id)
            updated++
          } else {
            skipped++
          }
          continue
        }

        // Check if contact exists by phone number
        const normalizedPhones = phoneNumbers
          .map((p) => p.normalized)
          .filter(Boolean) as string[]

        if (normalizedPhones.length > 0) {
          const hashes = normalizedPhones.map(hashPhone)
          const { data: existingByPhone } = await supabase
            .from('contact_phone_lookup')
            .select('contact_id, contacts!inner(workspace_id)')
            .in('phone_e164_hash', hashes)
            .eq('contacts.workspace_id', profile.workspace_id)
            .limit(1)

          if (existingByPhone && existingByPhone.length > 0) {
            skipped++
            continue
          }
        }

        // Create new contact
        const { data: newContact, error: createError } = await supabase
          .from('contacts')
          .insert({
            workspace_id: profile.workspace_id,
            display_name: displayName,
            phone_numbers: phoneNumbers,
            email_addresses: emailAddresses,
            source: 'google',
            source_metadata: {
              google_resource_name: contact.resourceName,
              synced_at: new Date().toISOString(),
            },
          })
          .select('id')
          .single()

        if (createError) {
          errors.push(`Failed to create ${displayName}: ${createError.message}`)
          continue
        }

        // Create phone lookup entries
        if (newContact && normalizedPhones.length > 0) {
          const phoneEntries = phoneNumbers
            .filter((p) => p.normalized)
            .map((p) => ({
              contact_id: newContact.id,
              phone_e164: p.normalized,
              phone_e164_hash: hashPhone(p.normalized!),
              phone_type: p.type,
            }))

          await supabase.from('contact_phone_lookup').insert(phoneEntries)
        }

        created++
      } catch (err: any) {
        errors.push(`Error: ${err?.message || 'Unknown error'}`)
      }
    }

    // Update last sync time
    await supabase
      .from('workspace_integrations')
      .update({ updated_at: new Date().toISOString() })
      .eq('workspace_id', profile.workspace_id)
      .eq('provider', 'google_contacts')

    return NextResponse.json({
      success: true,
      result: { created, updated, skipped, errors: errors.length > 0 ? errors : undefined },
    })
  } catch (error) {
    if (error instanceof Response) {
      return error
    }
    console.error('Google contacts sync error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
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
 * Normalize phone number to E.164 format
 */
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

/**
 * Hash phone number for lookups
 */
function hashPhone(phone: string): string {
  return createHash('sha256').update(phone).digest('hex')
}
