import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { createHash, randomBytes, createCipheriv } from 'crypto'

export const dynamic = 'force-dynamic'

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

    // Store refresh token for background sync (don't import synchronously)
    const supabase = createServiceRoleClient()

    if (tokens.refresh_token && ENCRYPTION_KEY) {
      await storeRefreshToken(
        supabase,
        stateData.workspace_id,
        tokens.refresh_token,
        connectedEmail
      )
    }

    // Redirect immediately - UI will trigger background sync
    return NextResponse.redirect(
      new URL(
        `/settings/contacts?google_connected=true`,
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
