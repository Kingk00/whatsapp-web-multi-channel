import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logLoginActivity } from '@/lib/audit'

/**
 * POST /api/auth/track-login
 *
 * Track login events (success, failed, logout)
 * Called after authentication attempts to record activity
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { event_type, user_id, workspace_id } = body

    // Validate event type
    const validEventTypes = ['login_success', 'login_failed', 'logout']
    if (!validEventTypes.includes(event_type)) {
      return NextResponse.json(
        { error: 'Invalid event type' },
        { status: 400 }
      )
    }

    // For login_success and logout, verify user is authenticated
    // and get their info from the session
    if (event_type === 'login_success' || event_type === 'logout') {
      const supabase = await createClient()
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser()

      if (authError || !user) {
        // If logout but no session, that's fine
        if (event_type === 'logout') {
          return NextResponse.json({ success: true })
        }
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        )
      }

      // Get user's profile to get workspace_id
      const { data: profile } = await supabase
        .from('profiles')
        .select('workspace_id')
        .eq('user_id', user.id)
        .single()

      if (!profile) {
        return NextResponse.json(
          { error: 'Profile not found' },
          { status: 404 }
        )
      }

      // Log the activity
      await logLoginActivity(request, {
        userId: user.id,
        workspaceId: profile.workspace_id,
        eventType: event_type,
      })

      return NextResponse.json({ success: true })
    }

    // For login_failed, we need user_id and workspace_id from the request
    // (since the user isn't authenticated)
    if (event_type === 'login_failed') {
      if (!user_id || !workspace_id) {
        // If we don't have user info for failed login, just return success
        // (we can't log it without knowing who it was)
        return NextResponse.json({ success: true })
      }

      await logLoginActivity(request, {
        userId: user_id,
        workspaceId: workspace_id,
        eventType: 'login_failed',
      })

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Track login error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
