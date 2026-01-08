import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/chats
 *
 * Fetch chats for the current user's accessible channels.
 * Supports filtering by channel and pagination.
 *
 * Query params:
 * - channel_id: Filter to specific channel (optional)
 * - archived: 'only' | 'include' | 'exclude' (default: 'exclude')
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
    const archived = searchParams.get('archived') || 'exclude' // 'only' | 'include' | 'exclude'
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    const cursor = searchParams.get('cursor')

    // Build query - include contact info for display name priority
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
        wa_display_name,
        phone_number,
        profile_photo_url,
        last_message_at,
        last_message_preview,
        unread_count,
        is_archived,
        muted_until,
        contact_id,
        created_at,
        updated_at,
        channels!inner (
          id,
          name,
          color,
          status
        ),
        contacts (
          id,
          display_name
        )
      `
      )

    // Apply archived filter
    if (archived === 'only') {
      query = query.eq('is_archived', true)
    } else if (archived === 'exclude') {
      query = query.eq('is_archived', false)
    }
    // 'include' = no filter, return all

    query = query
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

    // Transform the response to flatten channel/contact data and add computed fields
    const transformedChats = (chats || []).map((chat: any) => ({
      ...chat,
      channel: chat.channels,
      channels: undefined,
      contact: chat.contacts || null,
      contacts: undefined,
      // Computed: is the chat currently muted?
      is_muted: chat.muted_until ? new Date(chat.muted_until) > new Date() : false,
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
