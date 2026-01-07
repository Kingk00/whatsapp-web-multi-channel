import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI ||
  (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000') + '/api/contacts/import/google/callback'

const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')

/**
 * GET /api/contacts/import/google
 *
 * Check if Google OAuth is configured
 */
export async function GET() {
  const configured = !!GOOGLE_CLIENT_ID

  return NextResponse.json({
    configured,
    message: configured
      ? 'Google Contacts import is available'
      : 'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.',
  })
}

/**
 * POST /api/contacts/import/google
 *
 * Start Google OAuth flow for contacts import.
 * Returns the OAuth authorization URL to redirect to.
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

    // Get user's profile to verify admin status
    const { data: profile } = await supabase
      .from('profiles')
      .select('workspace_id, role')
      .eq('user_id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Only admins can import Google Contacts
    if (!['main_admin', 'admin'].includes(profile.role)) {
      return NextResponse.json(
        { error: 'Only admins can import Google Contacts' },
        { status: 403 }
      )
    }

    // Check if Google OAuth is configured
    if (!GOOGLE_CLIENT_ID) {
      return NextResponse.json(
        {
          error: 'Google OAuth is not configured',
          message: 'Please configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.',
        },
        { status: 503 }
      )
    }

    // Generate state parameter to prevent CSRF attacks
    // Store workspace_id and user_id in state for callback
    const state = Buffer.from(JSON.stringify({
      workspace_id: profile.workspace_id,
      user_id: user.id,
      timestamp: Date.now(),
    })).toString('base64url')

    // Build Google OAuth authorization URL
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID)
    authUrl.searchParams.set('redirect_uri', GOOGLE_REDIRECT_URI)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('scope', GOOGLE_OAUTH_SCOPES)
    authUrl.searchParams.set('access_type', 'offline')
    authUrl.searchParams.set('prompt', 'consent')
    authUrl.searchParams.set('state', state)

    return NextResponse.json({
      authUrl: authUrl.toString(),
    })
  } catch (error) {
    console.error('Google OAuth start error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
