import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { createHash, randomBytes, createCipheriv } from 'crypto'
import { normalizePhoneNumber } from '@/lib/phone-utils'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes for large contact imports

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI ||
  (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000') + '/api/contacts/import/google/callback'
const ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY

interface GoogleTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
  scope: string
}

interface GoogleContact {
  resourceName: string
  names?: { displayName?: string; givenName?: string; familyName?: string }[]
  phoneNumbers?: { value?: string; type?: string }[]
  emailAddresses?: { value?: string; type?: string }[]
  photos?: { url?: string }[]
}

interface GoogleContactsResponse {
  connections?: GoogleContact[]
  totalItems?: number
  nextPageToken?: string
}

/**
 * GET /api/contacts/import/google/callback
 *
 * Handle Google OAuth callback.
 * Exchange code for tokens, fetch contacts, and import them.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    // Handle OAuth errors
    if (error) {
      console.error('Google OAuth error:', error)
      return NextResponse.redirect(
        new URL(`/settings/contacts?error=oauth_denied`, request.url)
      )
    }

    if (!code || !state) {
      return NextResponse.redirect(
        new URL(`/settings/contacts?error=missing_params`, request.url)
      )
    }

    // Decode state
    let stateData: { workspace_id: string; user_id: string; timestamp: number }
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64url').toString())
    } catch {
      return NextResponse.redirect(
        new URL(`/settings/contacts?error=invalid_state`, request.url)
      )
    }

    // Verify state timestamp (max 10 minutes)
    if (Date.now() - stateData.timestamp > 10 * 60 * 1000) {
      return NextResponse.redirect(
        new URL(`/settings/contacts?error=state_expired`, request.url)
      )
    }

    // Check configuration
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return NextResponse.redirect(
        new URL(`/settings/contacts?error=not_configured`, request.url)
      )
    }

    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: GOOGLE_REDIRECT_URI,
      }),
    })

    if (!tokenResponse.ok) {
      console.error('Token exchange failed:', await tokenResponse.text())
      return NextResponse.redirect(
        new URL(`/settings/contacts?error=token_exchange_failed`, request.url)
      )
    }

    const tokens: GoogleTokenResponse = await tokenResponse.json()

    // Fetch user's email for display purposes
    let connectedEmail: string | null = null
    try {
      const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      })
      if (userInfoResponse.ok) {
        const userInfo = await userInfoResponse.json()
        connectedEmail = userInfo.email || null
      }
    } catch (e) {
      console.error('Failed to fetch user info:', e)
    }

    // Fetch contacts from Google People API
    const contacts = await fetchGoogleContacts(tokens.access_token)

    // Import contacts into database
    const supabase = createServiceRoleClient()
    let importedCount = 0
    let skippedCount = 0

    for (const contact of contacts) {
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
        skippedCount++
        continue
      }

      // Check if contact already exists (by phone number)
      const existingContact = await findExistingContact(
        supabase,
        stateData.workspace_id,
        phoneNumbers.map((p) => p.normalized).filter(Boolean) as string[]
      )

      if (existingContact) {
        skippedCount++
        continue
      }

      // Create contact
      const { data: newContact, error: createError } = await supabase
        .from('contacts')
        .insert({
          workspace_id: stateData.workspace_id,
          display_name: displayName,
          phone_numbers: phoneNumbers,
          email_addresses: emailAddresses,
          source: 'google',
          source_metadata: {
            google_resource_name: contact.resourceName,
            imported_by: stateData.user_id,
            imported_at: new Date().toISOString(),
          },
        })
        .select()
        .single()

      if (createError) {
        console.error('Error creating contact:', createError)
        continue
      }

      // Create phone lookup entries
      if (newContact && phoneNumbers.length > 0) {
        const phoneEntries = phoneNumbers
          .filter((p) => p.normalized)
          .map((p) => ({
            contact_id: newContact.id,
            phone_e164: p.normalized,
            phone_e164_hash: hashPhone(p.normalized!),
            phone_type: p.type,
          }))

        if (phoneEntries.length > 0) {
          await supabase.from('contact_phone_lookup').insert(phoneEntries)
        }
      }

      importedCount++
    }

    // Store refresh token if available (for future sync)
    if (tokens.refresh_token && ENCRYPTION_KEY) {
      await storeRefreshToken(
        supabase,
        stateData.workspace_id,
        tokens.refresh_token,
        connectedEmail
      )
    }

    // Redirect back to contacts page with success message
    return NextResponse.redirect(
      new URL(
        `/settings/contacts?google_import=success&imported=${importedCount}&skipped=${skippedCount}`,
        request.url
      )
    )
  } catch (error) {
    console.error('Google OAuth callback error:', error)
    return NextResponse.redirect(
      new URL(`/settings/contacts?error=internal_error`, request.url)
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
    url.searchParams.set('personFields', 'names,phoneNumbers,emailAddresses,photos')
    url.searchParams.set('pageSize', '1000')
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken)
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
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
 * Find existing contact by phone numbers
 */
async function findExistingContact(
  supabase: ReturnType<typeof createServiceRoleClient>,
  workspaceId: string,
  phoneNumbers: string[]
): Promise<boolean> {
  if (phoneNumbers.length === 0) return false

  const hashes = phoneNumbers.map(hashPhone)

  const { data } = await supabase
    .from('contact_phone_lookup')
    .select('contact_id, contacts!inner(workspace_id)')
    .in('phone_e164_hash', hashes)
    .eq('contacts.workspace_id', workspaceId)
    .limit(1)

  return (data?.length || 0) > 0
}

/**
 * Store encrypted refresh token for workspace
 */
async function storeRefreshToken(
  supabase: ReturnType<typeof createServiceRoleClient>,
  workspaceId: string,
  refreshToken: string,
  connectedEmail: string | null
): Promise<void> {
  if (!ENCRYPTION_KEY) return

  const encrypted = encryptToken(refreshToken)

  await supabase
    .from('workspace_integrations')
    .upsert({
      workspace_id: workspaceId,
      provider: 'google_contacts',
      config: {
        encrypted_refresh_token: encrypted,
        connected_email: connectedEmail,
      },
      is_active: true,
    }, {
      onConflict: 'workspace_id,provider',
    })
}

/**
 * Encrypt token using AES-256-GCM
 */
function encryptToken(token: string): string {
  if (!ENCRYPTION_KEY) throw new Error('Encryption key not set')

  const key = createHash('sha256').update(ENCRYPTION_KEY).digest()
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-gcm', key, iv)

  let encrypted = cipher.update(token, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag()

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`
}

/**
 * Hash phone number for lookups
 */
function hashPhone(phone: string): string {
  return createHash('sha256').update(phone).digest('hex')
}
