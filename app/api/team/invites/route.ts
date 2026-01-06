import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

/**
 * GET /api/team/invites
 * List all pending invites for the workspace (admin only)
 */
export async function GET() {
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

    // Check if user is admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, workspace_id')
      .eq('user_id', user.id)
      .single()

    if (!profile || !['main_admin', 'admin'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get invites for this workspace
    const serviceClient = createServiceRoleClient()
    const { data: invites, error } = await serviceClient
      .from('invite_tokens')
      .select('id, email, role, expires_at, used, created_at')
      .eq('workspace_id', profile.workspace_id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching invites:', error)
      return NextResponse.json({ error: 'Failed to fetch invites' }, { status: 500 })
    }

    return NextResponse.json({ invites })
  } catch (error) {
    console.error('Invites API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/team/invites
 * Create a new invite (admin only)
 *
 * Body:
 * - email: Email to invite
 * - role: Role to assign (agent, admin)
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

    // Check if user is admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, workspace_id')
      .eq('user_id', user.id)
      .single()

    if (!profile || !['main_admin', 'admin'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Parse body
    const body = await request.json()
    const { email, role = 'agent' } = body

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    // Validate role
    const allowedRoles = ['agent', 'admin']
    if (profile.role === 'main_admin') {
      allowedRoles.push('main_admin')
    }
    if (!allowedRoles.includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }

    // Check if email already has a pending invite
    const serviceClient = createServiceRoleClient()
    const { data: existingInvite } = await serviceClient
      .from('invite_tokens')
      .select('id')
      .eq('email', email.toLowerCase())
      .eq('workspace_id', profile.workspace_id)
      .eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .single()

    if (existingInvite) {
      return NextResponse.json(
        { error: 'An invite for this email already exists' },
        { status: 400 }
      )
    }

    // Check if user already exists
    const { data: existingProfile } = await serviceClient
      .from('profiles')
      .select('user_id')
      .eq('workspace_id', profile.workspace_id)
      .ilike('email', email)
      .single()

    if (existingProfile) {
      return NextResponse.json(
        { error: 'A user with this email already exists in the workspace' },
        { status: 400 }
      )
    }

    // Generate token
    const token = crypto.randomUUID()
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7) // 7 days expiry

    // Create invite
    const { data: invite, error: insertError } = await serviceClient
      .from('invite_tokens')
      .insert({
        token,
        email: email.toLowerCase(),
        role,
        workspace_id: profile.workspace_id,
        expires_at: expiresAt.toISOString(),
        created_by: user.id,
      })
      .select('id, email, role, expires_at, created_at')
      .single()

    if (insertError) {
      console.error('Error creating invite:', insertError)
      return NextResponse.json({ error: 'Failed to create invite' }, { status: 500 })
    }

    // Generate invite URL
    const baseUrl = request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || ''
    const inviteUrl = `${baseUrl}/invite/${token}`

    return NextResponse.json({
      success: true,
      invite,
      inviteUrl,
    })
  } catch (error) {
    console.error('Create invite API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/team/invites
 * Delete/revoke an invite (admin only)
 *
 * Query params:
 * - id: Invite ID to delete
 */
export async function DELETE(request: NextRequest) {
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

    // Check if user is admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, workspace_id')
      .eq('user_id', user.id)
      .single()

    if (!profile || !['main_admin', 'admin'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get invite ID
    const { searchParams } = new URL(request.url)
    const inviteId = searchParams.get('id')

    if (!inviteId) {
      return NextResponse.json({ error: 'Invite ID is required' }, { status: 400 })
    }

    // Delete invite (only for this workspace)
    const serviceClient = createServiceRoleClient()
    const { error: deleteError } = await serviceClient
      .from('invite_tokens')
      .delete()
      .eq('id', inviteId)
      .eq('workspace_id', profile.workspace_id)

    if (deleteError) {
      console.error('Error deleting invite:', deleteError)
      return NextResponse.json({ error: 'Failed to delete invite' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete invite API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
