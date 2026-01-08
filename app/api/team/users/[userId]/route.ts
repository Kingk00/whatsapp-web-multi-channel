import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { logAuditEvent, getLoginActivity } from '@/lib/audit'

/**
 * GET /api/team/users/[userId]
 *
 * Get detailed user information including profile, groups, and login activity.
 * Only admins can view other users' details.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId: targetUserId } = await params
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

    // Get admin's profile
    const { data: adminProfile } = await supabase
      .from('profiles')
      .select('workspace_id, role')
      .eq('user_id', user.id)
      .single()

    if (!adminProfile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Only admins can view user details (or users viewing their own profile)
    const isAdmin = ['main_admin', 'admin'].includes(adminProfile.role)
    const isOwnProfile = user.id === targetUserId

    if (!isAdmin && !isOwnProfile) {
      return NextResponse.json(
        { error: 'Only admins can view user details' },
        { status: 403 }
      )
    }

    // Get target user's profile with auth user info
    const { data: targetProfile, error: profileError } = await serviceSupabase
      .from('profiles')
      .select('*')
      .eq('user_id', targetUserId)
      .single()

    if (profileError || !targetProfile) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify same workspace
    if (targetProfile.workspace_id !== adminProfile.workspace_id) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Get auth user info (email)
    const { data: authUser } = await serviceSupabase.auth.admin.getUserById(targetUserId)

    // Get user's group memberships
    const { data: groupMemberships } = await serviceSupabase
      .from('group_members')
      .select(`
        group_id,
        groups (
          id,
          name,
          description
        )
      `)
      .eq('user_id', targetUserId)

    // Get login activity (only for admins viewing other users)
    let loginActivity: Awaited<ReturnType<typeof getLoginActivity>> = []
    if (isAdmin) {
      loginActivity = await getLoginActivity(targetUserId, 20)
    }

    return NextResponse.json({
      profile: {
        ...targetProfile,
        email: authUser?.user?.email || null,
        email_confirmed_at: authUser?.user?.email_confirmed_at || null,
        last_sign_in_at: authUser?.user?.last_sign_in_at || null,
      },
      groups: groupMemberships?.map(gm => gm.groups).filter(Boolean) || [],
      loginActivity,
    })
  } catch (error) {
    console.error('Get user error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/team/users/[userId]
 *
 * Update user profile (admin only).
 * Can update: display_name, username, role
 * Only main_admin can change role to main_admin or change another admin's role.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId: targetUserId } = await params
    const body = await request.json()
    const { display_name, username, role } = body

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

    // Get admin's profile
    const { data: adminProfile } = await supabase
      .from('profiles')
      .select('workspace_id, role')
      .eq('user_id', user.id)
      .single()

    if (!adminProfile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Only admins can update user profiles
    if (!['main_admin', 'admin'].includes(adminProfile.role)) {
      return NextResponse.json(
        { error: 'Only admins can update user profiles' },
        { status: 403 }
      )
    }

    // Get target user's current profile
    const { data: targetProfile } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', targetUserId)
      .single()

    if (!targetProfile) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify same workspace
    if (targetProfile.workspace_id !== adminProfile.workspace_id) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Role change restrictions
    if (role && role !== targetProfile.role) {
      // Only main_admin can change roles
      if (adminProfile.role !== 'main_admin') {
        return NextResponse.json(
          { error: 'Only main admin can change user roles' },
          { status: 403 }
        )
      }

      // Cannot change your own role (to prevent accidental demotion)
      if (user.id === targetUserId) {
        return NextResponse.json(
          { error: 'Cannot change your own role' },
          { status: 400 }
        )
      }

      // Validate role value
      const validRoles = ['main_admin', 'admin', 'agent', 'viewer']
      if (!validRoles.includes(role)) {
        return NextResponse.json(
          { error: 'Invalid role' },
          { status: 400 }
        )
      }
    }

    // Check username uniqueness if changing
    if (username && username !== targetProfile.username) {
      const { data: existingUser } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('workspace_id', adminProfile.workspace_id)
        .eq('username', username)
        .neq('user_id', targetUserId)
        .single()

      if (existingUser) {
        return NextResponse.json(
          { error: 'Username already taken' },
          { status: 400 }
        )
      }
    }

    // Build update object
    const updates: Record<string, string> = {}
    const changes: Record<string, { from: string; to: string }> = {}

    if (display_name !== undefined && display_name !== targetProfile.display_name) {
      updates.display_name = display_name
      changes.display_name = { from: targetProfile.display_name, to: display_name }
    }
    if (username !== undefined && username !== targetProfile.username) {
      updates.username = username
      changes.username = { from: targetProfile.username, to: username }
    }
    if (role !== undefined && role !== targetProfile.role) {
      updates.role = role
      changes.role = { from: targetProfile.role, to: role }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No changes provided' }, { status: 400 })
    }

    // Update profile
    const { data: updatedProfile, error: updateError } = await serviceSupabase
      .from('profiles')
      .update(updates)
      .eq('user_id', targetUserId)
      .select()
      .single()

    if (updateError) {
      console.error('Error updating profile:', updateError)
      return NextResponse.json(
        { error: 'Failed to update profile' },
        { status: 500 }
      )
    }

    // Log audit event
    const auditAction = role && changes.role ? 'user.role_changed' : 'user.profile_updated'
    await logAuditEvent(request, {
      action: auditAction,
      resourceType: 'user',
      resourceId: targetUserId,
      metadata: {
        changes,
        updated_by: user.id,
      },
      workspaceId: adminProfile.workspace_id,
    })

    return NextResponse.json({ profile: updatedProfile })
  } catch (error) {
    console.error('Update user error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/team/users/[userId]
 *
 * Delete a user (admin only).
 * Cannot delete yourself or main_admin users (unless you're main_admin).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId: targetUserId } = await params
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

    // Cannot delete yourself
    if (user.id === targetUserId) {
      return NextResponse.json(
        { error: 'Cannot delete your own account' },
        { status: 400 }
      )
    }

    // Get admin's profile
    const { data: adminProfile } = await supabase
      .from('profiles')
      .select('workspace_id, role')
      .eq('user_id', user.id)
      .single()

    if (!adminProfile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Only admins can delete users
    if (!['main_admin', 'admin'].includes(adminProfile.role)) {
      return NextResponse.json(
        { error: 'Only admins can delete users' },
        { status: 403 }
      )
    }

    // Get target user's profile
    const { data: targetProfile } = await supabase
      .from('profiles')
      .select('workspace_id, role, display_name')
      .eq('user_id', targetUserId)
      .single()

    if (!targetProfile) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify same workspace
    if (targetProfile.workspace_id !== adminProfile.workspace_id) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Only main_admin can delete other admins
    if (
      ['main_admin', 'admin'].includes(targetProfile.role) &&
      adminProfile.role !== 'main_admin'
    ) {
      return NextResponse.json(
        { error: 'Only main admin can delete admin users' },
        { status: 403 }
      )
    }

    // Cannot delete main_admin (there must be at least one)
    if (targetProfile.role === 'main_admin') {
      // Count main admins in workspace
      const { count } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', adminProfile.workspace_id)
        .eq('role', 'main_admin')

      if (count && count <= 1) {
        return NextResponse.json(
          { error: 'Cannot delete the only main admin' },
          { status: 400 }
        )
      }
    }

    // Delete profile first (cascade will handle related data)
    const { error: profileDeleteError } = await serviceSupabase
      .from('profiles')
      .delete()
      .eq('user_id', targetUserId)

    if (profileDeleteError) {
      console.error('Error deleting profile:', profileDeleteError)
      return NextResponse.json(
        { error: 'Failed to delete user profile' },
        { status: 500 }
      )
    }

    // Delete auth user
    const { error: authDeleteError } = await serviceSupabase.auth.admin.deleteUser(targetUserId)

    if (authDeleteError) {
      console.error('Error deleting auth user:', authDeleteError)
      // Profile already deleted, log error but return success
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete user error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
