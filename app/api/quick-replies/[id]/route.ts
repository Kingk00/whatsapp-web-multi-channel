import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * PATCH /api/quick-replies/[id]
 * Updates a quick reply
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { shortcut, title, text_body, channel_id, scope } = body

    // Validate shortcut format if provided
    if (shortcut && !/^[a-zA-Z0-9_-]+$/.test(shortcut)) {
      return NextResponse.json(
        { error: 'Shortcut must contain only letters, numbers, underscores, and hyphens' },
        { status: 400 }
      )
    }

    const updateData: Record<string, unknown> = {}
    if (shortcut !== undefined) updateData.shortcut = shortcut.toLowerCase()
    if (title !== undefined) updateData.title = title
    if (text_body !== undefined) updateData.text_body = text_body
    if (scope !== undefined) updateData.scope = scope
    if (channel_id !== undefined) {
      updateData.channel_id = channel_id || null
      updateData.scope = channel_id ? 'channel' : 'global'
    }

    const { data: quickReply, error } = await supabase
      .from('quick_replies')
      .update(updateData)
      .eq('id', id)
      .select(`
        *,
        channel:channels(id, name, color),
        creator:profiles!created_by(user_id, display_name)
      `)
      .single()

    if (error) {
      console.error('Error updating quick reply:', error)
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'A quick reply with this shortcut already exists' },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: 'Failed to update quick reply' }, { status: 500 })
    }

    return NextResponse.json({ quickReply })
  } catch (error) {
    console.error('Quick replies PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/quick-replies/[id]
 * Deletes a quick reply
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { error } = await supabase
      .from('quick_replies')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting quick reply:', error)
      return NextResponse.json({ error: 'Failed to delete quick reply' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Quick replies DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
