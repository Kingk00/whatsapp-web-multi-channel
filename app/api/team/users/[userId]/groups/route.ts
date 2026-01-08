import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { logAuditEvent } from '@/lib/audit'

/**
 * PUT /api/team/users/[userId]/groups
 *
 * Replace a user's group memberships (admin only).
 * Accepts an array of group IDs.
 * Warning: Removing all groups = user loses all channel access (unless main_admin)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId: targetUserId } = await params
    const body = await request.json()
    const { group_ids } = body

    if (!Array.isArray(group_ids)) {
      return NextResponse.json(
        { error: 'group_ids must be an array' },
        { status: 400 }
      )
    }

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

    // Only admins can manage group memberships
    if (!['main_admin', 'admin'].includes(adminProfile.role)) {
      return NextResponse.json(
        { error: 'Only admins can manage group memberships' },
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

    // Verify all group_ids belong to the same workspace
    if (group_ids.length > 0) {
      const { data: validGroups, error: groupsError } = await supabase
        .from('groups')
        .select('id')
        .eq('workspace_id', adminProfile.workspace_id)
        .in('id', group_ids)

      if (groupsError) {
        console.error('Error validating groups:', groupsError)
        return NextResponse.json(
          { error: 'Failed to validate groups' },
          { status: 500 }
        )
      }

      const validGroupIds = new Set(validGroups?.map(g => g.id) || [])
      const invalidGroupIds = group_ids.filter(id => !validGroupIds.has(id))

      if (invalidGroupIds.length > 0) {
        return NextResponse.json(
          { error: `Invalid group IDs: ${invalidGroupIds.join(', ')}` },
          { status: 400 }
        )
      }
    }

    // Get current group memberships
    const { data: currentMemberships } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', targetUserId)

    const currentGroupIds = currentMemberships?.map(m => m.group_id) || []

    // Calculate changes
    const groupsToAdd = group_ids.filter((id: string) => !currentGroupIds.includes(id))
    const groupsToRemove = currentGroupIds.filter(id => !group_ids.includes(id))

    // Start transaction-like operations
    // Remove old memberships
    if (groupsToRemove.length > 0) {
      const { error: removeError } = await serviceSupabase
        .from('group_members')
        .delete()
        .eq('user_id', targetUserId)
        .in('group_id', groupsToRemove)

      if (removeError) {
        console.error('Error removing group memberships:', removeError)
        return NextResponse.json(
          { error: 'Failed to update group memberships' },
          { status: 500 }
        )
      }
    }

    // Add new memberships
    if (groupsToAdd.length > 0) {
      const newMemberships = groupsToAdd.map((groupId: string) => ({
        user_id: targetUserId,
        group_id: groupId,
      }))

      const { error: addError } = await serviceSupabase
        .from('group_members')
        .insert(newMemberships)

      if (addError) {
        console.error('Error adding group memberships:', addError)
        return NextResponse.json(
          { error: 'Failed to update group memberships' },
          { status: 500 }
        )
      }
    }

    // Get updated memberships with group details
    const { data: updatedMemberships } = await serviceSupabase
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

    // Log audit event
    await logAuditEvent(request, {
      action: 'user.groups_changed',
      resourceType: 'user',
      resourceId: targetUserId,
      metadata: {
        previous_groups: currentGroupIds,
        new_groups: group_ids,
        added: groupsToAdd,
        removed: groupsToRemove,
        updated_by: user.id,
      },
      workspaceId: adminProfile.workspace_id,
    })

    // Warning if removing all groups
    const warning = group_ids.length === 0 && targetProfile.role !== 'main_admin'
      ? 'User has been removed from all groups and will lose access to all channels.'
      : null

    return NextResponse.json({
      success: true,
      groups: updatedMemberships?.map(gm => gm.groups).filter(Boolean) || [],
      changes: {
        added: groupsToAdd.length,
        removed: groupsToRemove.length,
      },
      warning,
    })
  } catch (error) {
    console.error('Update groups error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
