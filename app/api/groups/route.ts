import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/groups
 *
 * List all groups in the workspace with member and channel counts.
 * Requires admin role.
 */
export async function GET(request: NextRequest) {
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

    // Get user's profile and verify admin role
    const { data: profile } = await supabase
      .from('profiles')
      .select('workspace_id, role')
      .eq('user_id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Only admins can view groups management
    if (!['main_admin', 'admin'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Fetch groups with member and channel counts
    const { data: groups, error } = await supabase
      .from('groups')
      .select(`
        id,
        name,
        created_at,
        group_members(count),
        group_channels(count)
      `)
      .eq('workspace_id', profile.workspace_id)
      .order('name')

    if (error) {
      console.error('Error fetching groups:', error)
      return NextResponse.json({ error: 'Failed to fetch groups' }, { status: 500 })
    }

    // Transform to include counts properly
    const groupsWithCounts = groups?.map((g) => ({
      id: g.id,
      name: g.name,
      created_at: g.created_at,
      member_count: g.group_members?.[0]?.count || 0,
      channel_count: g.group_channels?.[0]?.count || 0,
    }))

    return NextResponse.json({ groups: groupsWithCounts })
  } catch (error) {
    console.error('Groups GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/groups
 *
 * Create a new group.
 * Requires admin role.
 *
 * Body:
 * - name: Group name (required)
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

    // Get user's profile and verify admin role
    const { data: profile } = await supabase
      .from('profiles')
      .select('workspace_id, role')
      .eq('user_id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Only admins can create groups
    if (!['main_admin', 'admin'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { name } = body

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Group name is required' }, { status: 400 })
    }

    // Check if group name already exists in workspace
    const { data: existingGroup } = await supabase
      .from('groups')
      .select('id')
      .eq('workspace_id', profile.workspace_id)
      .eq('name', name.trim())
      .single()

    if (existingGroup) {
      return NextResponse.json(
        { error: 'A group with this name already exists' },
        { status: 409 }
      )
    }

    // Create the group
    const { data: group, error } = await supabase
      .from('groups')
      .insert({
        name: name.trim(),
        workspace_id: profile.workspace_id,
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating group:', error)
      return NextResponse.json({ error: 'Failed to create group' }, { status: 500 })
    }

    return NextResponse.json({ group }, { status: 201 })
  } catch (error) {
    console.error('Groups POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
