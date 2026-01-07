import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

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
