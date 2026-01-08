import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/groups/[id]
 *
 * Get group details including members and channels.
 * Requires admin role.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { id: groupId } = await params

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's profile and verify admin role
    const { data: profile } = await supabase
      .from('profiles')
      .select('workspace_id, role')
      .eq('user_id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Only admins can view group details
    if (!['main_admin', 'admin'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Fetch group with members and channels
    const { data: group, error: groupError } = await supabase
      .from('groups')
      .select('id, name, created_at')
      .eq('id', groupId)
      .eq('workspace_id', profile.workspace_id)
      .single()

    if (groupError || !group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 })
    }

    // Fetch members
    const { data: members } = await supabase
      .from('group_members')
      .select(`
        user_id,
        profiles!inner(user_id, display_name, username, role)
      `)
      .eq('group_id', groupId)

    // Fetch channels
    const { data: channels } = await supabase
      .from('group_channels')
      .select(`
        channel_id,
        channels!inner(id, name, phone_number, status)
      `)
      .eq('group_id', groupId)

    // Format response
    const formattedMembers = members?.map((m) => {
      const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
      return {
        user_id: p?.user_id,
        display_name: p?.display_name,
        username: p?.username,
        role: p?.role,
      }
    }) || []

    const formattedChannels = channels?.map((c) => {
      const ch = Array.isArray(c.channels) ? c.channels[0] : c.channels
      return {
        id: ch?.id,
        name: ch?.name,
        phone_number: ch?.phone_number,
        status: ch?.status,
      }
    }) || []

    return NextResponse.json({
      group: {
        ...group,
        members: formattedMembers,
        channels: formattedChannels,
      },
    })
  } catch (error) {
    console.error('Group GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/groups/[id]
 *
 * Update group name.
 * Requires admin role.
 *
 * Body:
 * - name: New group name (required)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { id: groupId } = await params

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's profile and verify admin role
    const { data: profile } = await supabase
      .from('profiles')
      .select('workspace_id, role')
      .eq('user_id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Only admins can update groups
    if (!['main_admin', 'admin'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { name } = body

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Group name is required' }, { status: 400 })
    }

    // Check if group exists and belongs to workspace
    const { data: existingGroup } = await supabase
      .from('groups')
      .select('id')
      .eq('id', groupId)
      .eq('workspace_id', profile.workspace_id)
      .single()

    if (!existingGroup) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 })
    }

    // Check if new name conflicts with another group
    const { data: conflictingGroup } = await supabase
      .from('groups')
      .select('id')
      .eq('workspace_id', profile.workspace_id)
      .eq('name', name.trim())
      .neq('id', groupId)
      .single()

    if (conflictingGroup) {
      return NextResponse.json(
        { error: 'A group with this name already exists' },
        { status: 409 }
      )
    }

    // Update group
    const { data: group, error } = await supabase
      .from('groups')
      .update({ name: name.trim() })
      .eq('id', groupId)
      .select()
      .single()

    if (error) {
      console.error('Error updating group:', error)
      return NextResponse.json({ error: 'Failed to update group' }, { status: 500 })
    }

    return NextResponse.json({ group })
  } catch (error) {
    console.error('Group PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/groups/[id]
 *
 * Delete a group (cascades to members and channels).
 * Requires admin role.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { id: groupId } = await params

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's profile and verify admin role
    const { data: profile } = await supabase
      .from('profiles')
      .select('workspace_id, role')
      .eq('user_id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Only admins can delete groups
    if (!['main_admin', 'admin'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Check if group exists and belongs to workspace
    const { data: existingGroup } = await supabase
      .from('groups')
      .select('id')
      .eq('id', groupId)
      .eq('workspace_id', profile.workspace_id)
      .single()

    if (!existingGroup) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 })
    }

    // Delete group (cascades to group_members and group_channels via FK)
    const { error } = await supabase
      .from('groups')
      .delete()
      .eq('id', groupId)

    if (error) {
      console.error('Error deleting group:', error)
      return NextResponse.json({ error: 'Failed to delete group' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Group DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
