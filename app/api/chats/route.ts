import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/chats
 *
 * Fetch chats for the current user's accessible channels.
 * Supports filtering by channel and pagination.
 *
 * Query params:
 * - channel_id: Filter to specific channel (optional)
 * - limit: Max chats to return (default 50)
 * - cursor: Last chat's last_message_at for pagination
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

    // Parse query params
    const { searchParams } = new URL(request.url)
    const channelId = searchParams.get('channel_id')
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    const cursor = searchParams.get('cursor')

    // Build query
    let query = supabase
      .from('chats')
      .select(
        `
        id,
        workspace_id,
        channel_id,
        wa_chat_id,
        is_group,
        display_name,
        phone_number,
        profile_photo_url,
        last_message_at,
        last_message_preview,
        unread_count,
        is_archived,
        created_at,
        updated_at,
        channels!inner (
          id,
          name,
          color,
          status
        )
      `
      )
      .eq('is_archived', false)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(limit)

    // Filter by channel if specified
    if (channelId) {
      query = query.eq('channel_id', channelId)
    }

    // Apply cursor for pagination
    if (cursor) {
      query = query.lt('last_message_at', cursor)
    }

    const { data: chats, error } = await query

    if (error) {
      console.error('Error fetching chats:', error)
      return NextResponse.json(
        { error: 'Failed to fetch chats' },
        { status: 500 }
      )
    }

    // Transform the response to flatten channel data
    const transformedChats = (chats || []).map((chat: any) => ({
      ...chat,
      channel: chat.channels,
      channels: undefined,
    }))

    return NextResponse.json({
      chats: transformedChats,
      nextCursor:
        transformedChats.length === limit
          ? transformedChats[transformedChats.length - 1]?.last_message_at
          : null,
    })
  } catch (error) {
    console.error('Chats API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
