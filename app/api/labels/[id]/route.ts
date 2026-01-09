import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/labels/[id]
 *
 * Get a single label with usage count.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { id: labelId } = await params

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('workspace_id')
      .eq('user_id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Fetch label
    const { data: label, error: labelError } = await supabase
      .from('chat_labels')
      .select('id, name, color, created_at')
      .eq('id', labelId)
      .eq('workspace_id', profile.workspace_id)
      .single()

    if (labelError || !label) {
      return NextResponse.json({ error: 'Label not found' }, { status: 404 })
    }

    // Count chats using this label
    const { count } = await supabase
      .from('chat_label_assignments')
      .select('*', { count: 'exact', head: true })
      .eq('label_id', labelId)

    return NextResponse.json({
      label: {
        ...label,
        chat_count: count || 0,
      },
    })
  } catch (error) {
    console.error('Label GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/labels/[id]
 *
 * Update a label.
 *
 * Body:
 * - name: New label name (optional)
 * - color: New hex color (optional)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { id: labelId } = await params

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('workspace_id')
      .eq('user_id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Check label exists and belongs to workspace
    const { data: existing } = await supabase
      .from('chat_labels')
      .select('id')
      .eq('id', labelId)
      .eq('workspace_id', profile.workspace_id)
      .single()

    if (!existing) {
      return NextResponse.json({ error: 'Label not found' }, { status: 404 })
    }

    const body = await request.json()
    const { name, color } = body

    const updateData: Record<string, any> = {
      updated_at: new Date().toISOString(),
    }

    if (name?.trim()) {
      // Check for duplicate name
      const { data: conflict } = await supabase
        .from('chat_labels')
        .select('id')
        .eq('workspace_id', profile.workspace_id)
        .eq('name', name.trim())
        .neq('id', labelId)
        .single()

      if (conflict) {
        return NextResponse.json(
          { error: 'A label with this name already exists' },
          { status: 409 }
        )
      }

      updateData.name = name.trim()
    }

    if (color && /^#[0-9a-fA-F]{6}$/.test(color)) {
      updateData.color = color
    }

    // Update label
    const { data: label, error: updateError } = await supabase
      .from('chat_labels')
      .update(updateData)
      .eq('id', labelId)
      .select()
      .single()

    if (updateError) {
      console.error('Error updating label:', updateError)
      return NextResponse.json({ error: 'Failed to update label' }, { status: 500 })
    }

    return NextResponse.json({ label })
  } catch (error) {
    console.error('Label PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/labels/[id]
 *
 * Delete a label.
 * Requires admin role.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { id: labelId } = await params

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

    // Only admins can delete labels
    if (!['main_admin', 'admin'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Check label exists and belongs to workspace
    const { data: existing } = await supabase
      .from('chat_labels')
      .select('id')
      .eq('id', labelId)
      .eq('workspace_id', profile.workspace_id)
      .single()

    if (!existing) {
      return NextResponse.json({ error: 'Label not found' }, { status: 404 })
    }

    // Delete label (cascades to assignments)
    const { error: deleteError } = await supabase
      .from('chat_labels')
      .delete()
      .eq('id', labelId)

    if (deleteError) {
      console.error('Error deleting label:', deleteError)
      return NextResponse.json({ error: 'Failed to delete label' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Label DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
