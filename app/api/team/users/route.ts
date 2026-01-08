import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

/**
 * POST /api/team/users
 *
 * Create a new user directly (admin only).
 *
 * Body:
 * - username: Username (required)
 * - displayName: Display name (required)
 * - email: Email address (optional - auto-generated if not provided)
 * - password: Password (required, min 8 chars)
 * - role: Role - 'agent' | 'admin' | 'main_admin' (default: 'agent')
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

    // Get admin's profile and verify admin role
    const { data: adminProfile } = await supabase
      .from('profiles')
      .select('workspace_id, role')
      .eq('user_id', user.id)
      .single()

    if (!adminProfile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Only admins can create users
    if (!['main_admin', 'admin'].includes(adminProfile.role)) {
      return NextResponse.json(
        { error: 'Only admins can create users' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { username, displayName, email, password, role = 'agent' } = body

    // Validate required fields
    if (!username?.trim()) {
      return NextResponse.json({ error: 'Username is required' }, { status: 400 })
    }
    if (!displayName?.trim()) {
      return NextResponse.json({ error: 'Display name is required' }, { status: 400 })
    }
    if (!password || password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 }
      )
    }

    // Generate placeholder email if not provided (Supabase Auth requires email)
    const userEmail = email?.trim() || `${username.toLowerCase().trim()}@workspace.internal`

    // Validate role - only main_admin can create main_admin users
    const validRoles = ['agent', 'admin', 'main_admin']
    if (!validRoles.includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }
    if (role === 'main_admin' && adminProfile.role !== 'main_admin') {
      return NextResponse.json(
        { error: 'Only main admin can create main admin users' },
        { status: 403 }
      )
    }

    // Check if email already exists (only if a real email was provided)
    if (email?.trim()) {
      const { data: existingUser } = await serviceSupabase.auth.admin.listUsers()
      const emailExists = existingUser?.users?.some(
        (u) => u.email?.toLowerCase() === userEmail.toLowerCase()
      )
      if (emailExists) {
        return NextResponse.json(
          { error: 'A user with this email already exists' },
          { status: 409 }
        )
      }
    }

    // Check if username already exists in workspace
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('workspace_id', adminProfile.workspace_id)
      .eq('username', username.toLowerCase())
      .single()

    if (existingProfile) {
      return NextResponse.json(
        { error: 'Username already taken in this workspace' },
        { status: 409 }
      )
    }

    // Create Supabase Auth user
    const { data: authData, error: createUserError } = await serviceSupabase.auth.admin.createUser({
      email: userEmail,
      password,
      email_confirm: true, // Auto-confirm email
      user_metadata: {
        full_name: displayName,
      },
    })

    if (createUserError || !authData.user) {
      console.error('Error creating auth user:', createUserError)
      return NextResponse.json(
        { error: createUserError?.message || 'Failed to create user' },
        { status: 500 }
      )
    }

    // Create profile record
    const { data: profile, error: profileError } = await serviceSupabase
      .from('profiles')
      .insert({
        user_id: authData.user.id,
        workspace_id: adminProfile.workspace_id,
        display_name: displayName.trim(),
        username: username.toLowerCase().trim(),
        role,
      })
      .select()
      .single()

    if (profileError) {
      console.error('Error creating profile:', profileError)
      // Rollback: delete the auth user
      await serviceSupabase.auth.admin.deleteUser(authData.user.id)
      return NextResponse.json(
        { error: 'Failed to create user profile' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      user: {
        id: authData.user.id,
        email: authData.user.email,
        ...profile,
      },
    }, { status: 201 })
  } catch (error) {
    console.error('Create user error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
