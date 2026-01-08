import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/groups/[id]/channels
 *
 * Add a channel to a group.
 * Requires admin role.
 *
 * Body:
 * - channel_id: Channel ID to add (required)
 */
export async function POST(
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

    // Only admins can manage group channels
    if (!['main_admin', 'admin'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { channel_id } = body

    if (!channel_id) {
      return NextResponse.json({ error: 'Channel ID is required' }, { status: 400 })
    }

    // Verify group exists and belongs to workspace
    const { data: group } = await supabase
      .from('groups')
      .select('id')
      .eq('id', groupId)
      .eq('workspace_id', profile.workspace_id)
      .single()

    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 })
    }

    // Verify channel exists and belongs to same workspace
    const { data: channel } = await supabase
      .from('channels')
      .select('id')
      .eq('id', channel_id)
      .eq('workspace_id', profile.workspace_id)
      .single()

    if (!channel) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
    }

    // Check if already added
    const { data: existingChannel } = await supabase
      .from('group_channels')
      .select('channel_id')
      .eq('group_id', groupId)
      .eq('channel_id', channel_id)
      .single()

    if (existingChannel) {
      return NextResponse.json({ error: 'Channel is already in this group' }, { status: 409 })
    }

    // Add channel to group
    const { error } = await supabase
      .from('group_channels')
      .insert({
        group_id: groupId,
        channel_id: channel_id,
      })

    if (error) {
      console.error('Error adding channel:', error)
      return NextResponse.json({ error: 'Failed to add channel' }, { status: 500 })
    }

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (error) {
    console.error('Group channels POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
