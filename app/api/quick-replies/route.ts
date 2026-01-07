import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/quick-replies
 * Fetches quick replies for the user's workspace
 *
 * Query params:
 * - channel_id: (optional) Filter by channel, or 'global' for global replies
 * - scope: 'global' | 'channel' | 'all' (default: 'all')
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user profile and workspace
    const { data: profile } = await supabase
      .from('profiles')
      .select('workspace_id')
      .eq('user_id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const { searchParams } = new URL(request.url)
    const channelId = searchParams.get('channel_id')
    const scope = searchParams.get('scope') || 'all'

    // Build query - include attachments
    let query = supabase
      .from('quick_replies')
      .select(`
        *,
        channel:channels(id, name, color),
        creator:profiles!created_by(user_id, display_name),
        attachments:quick_reply_attachments(id, kind, storage_path, filename, mime_type, sort_order)
      `)
      .eq('workspace_id', profile.workspace_id)
      .order('created_at', { ascending: false })

    // Filter by scope
    if (scope === 'global') {
      query = query.is('channel_id', null)
    } else if (scope === 'channel' && channelId) {
      query = query.eq('channel_id', channelId)
    } else if (channelId && channelId !== 'all') {
      // Return both global and channel-specific
      query = query.or(`channel_id.is.null,channel_id.eq.${channelId}`)
    }

    const { data: quickReplies, error } = await query

    if (error) {
      console.error('Error fetching quick replies:', error)
      return NextResponse.json({ error: 'Failed to fetch quick replies' }, { status: 500 })
    }

    return NextResponse.json({ quickReplies })
  } catch (error) {
    console.error('Quick replies GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/quick-replies
 * Creates a new quick reply
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user profile and workspace
    const { data: profile } = await supabase
      .from('profiles')
      .select('workspace_id')
      .eq('user_id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const body = await request.json()
    const { shortcut, title, text_body, channel_id, scope = 'global' } = body

    if (!shortcut || !text_body) {
      return NextResponse.json(
        { error: 'Shortcut and text body are required' },
        { status: 400 }
      )
    }

    // Validate shortcut format (alphanumeric, no spaces)
    if (!/^[a-zA-Z0-9_-]+$/.test(shortcut)) {
      return NextResponse.json(
        { error: 'Shortcut must contain only letters, numbers, underscores, and hyphens' },
        { status: 400 }
      )
    }

    const { data: quickReply, error } = await supabase
      .from('quick_replies')
      .insert({
        workspace_id: profile.workspace_id,
        shortcut: shortcut.toLowerCase(),
        title: title || shortcut,
        text_body,
        reply_type: 'text',
        scope: channel_id ? 'channel' : scope,
        channel_id: channel_id || null,
        created_by: user.id,
      })
      .select(`
        *,
        channel:channels(id, name, color),
        creator:profiles!created_by(user_id, display_name)
      `)
      .single()

    if (error) {
      console.error('Error creating quick reply:', error)
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'A quick reply with this shortcut already exists' },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: 'Failed to create quick reply' }, { status: 500 })
    }

    return NextResponse.json({ quickReply }, { status: 201 })
  } catch (error) {
    console.error('Quick replies POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
