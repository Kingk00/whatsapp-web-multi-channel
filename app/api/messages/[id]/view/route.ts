import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

/**
 * POST /api/messages/[id]/view
 *
 * Record that the current user has viewed a view-once message.
 * Returns the media URL if this is the first view, or a "viewed" status if already viewed.
 *
 * For inbound view-once messages: each agent can view once
 * For outbound view-once messages: just return the current status (agent always sees their own)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const serviceClient = createServiceRoleClient()
    const messageId = params.id

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get the message with channel info
    const { data: message, error: messageError } = await supabase
      .from('messages')
      .select(`
        id,
        channel_id,
        chat_id,
        direction,
        message_type,
        is_view_once,
        media_url,
        storage_path,
        media_metadata,
        viewed_at
      `)
      .eq('id', messageId)
      .single()

    if (messageError || !message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    // Verify this is a view-once message
    if (!message.is_view_once) {
      return NextResponse.json(
        { error: 'This is not a view-once message' },
        { status: 400 }
      )
    }

    // For outbound messages, agents can always see their own sent messages
    if (message.direction === 'outbound') {
      return NextResponse.json({
        can_view: true,
        is_own_message: true,
        media_url: message.storage_path
          ? await getSignedUrl(serviceClient, message.storage_path)
          : message.media_url,
        media_metadata: message.media_metadata,
      })
    }

    // For inbound view-once messages, check if user has already viewed
    const { data: existingView } = await supabase
      .from('message_views')
      .select('id, viewed_at')
      .eq('message_id', messageId)
      .eq('user_id', user.id)
      .single()

    if (existingView) {
      // User has already viewed this message
      return NextResponse.json({
        can_view: false,
        already_viewed: true,
        viewed_at: existingView.viewed_at,
        message: 'You have already viewed this message',
      })
    }

    // Record the view
    const { error: insertError } = await supabase
      .from('message_views')
      .insert({
        message_id: messageId,
        user_id: user.id,
      })

    if (insertError) {
      console.error('Failed to record view:', insertError)
      // If unique constraint error, user already viewed
      if (insertError.code === '23505') {
        return NextResponse.json({
          can_view: false,
          already_viewed: true,
          message: 'You have already viewed this message',
        })
      }
      return NextResponse.json(
        { error: 'Failed to record view' },
        { status: 500 }
      )
    }

    // Get the media URL (either from storage or original)
    let mediaUrl = message.media_url
    if (message.storage_path) {
      mediaUrl = await getSignedUrl(serviceClient, message.storage_path)
    }

    return NextResponse.json({
      can_view: true,
      first_view: true,
      media_url: mediaUrl,
      media_metadata: message.media_metadata,
    })
  } catch (error) {
    console.error('Message view error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/messages/[id]/view
 *
 * Check if the current user can view a view-once message.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const messageId = params.id

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get the message
    const { data: message, error: messageError } = await supabase
      .from('messages')
      .select('id, direction, is_view_once')
      .eq('id', messageId)
      .single()

    if (messageError || !message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    if (!message.is_view_once) {
      return NextResponse.json({
        is_view_once: false,
        can_view: true,
      })
    }

    // For outbound, always can view own messages
    if (message.direction === 'outbound') {
      return NextResponse.json({
        is_view_once: true,
        can_view: true,
        is_own_message: true,
      })
    }

    // Check if already viewed
    const { data: existingView } = await supabase
      .from('message_views')
      .select('id, viewed_at')
      .eq('message_id', messageId)
      .eq('user_id', user.id)
      .single()

    return NextResponse.json({
      is_view_once: true,
      can_view: !existingView,
      already_viewed: !!existingView,
      viewed_at: existingView?.viewed_at || null,
    })
  } catch (error) {
    console.error('Message view check error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Helper to get signed URL from Supabase Storage
async function getSignedUrl(
  serviceClient: ReturnType<typeof createServiceRoleClient>,
  storagePath: string
): Promise<string | null> {
  try {
    const { data, error } = await serviceClient.storage
      .from('media')
      .createSignedUrl(storagePath, 60) // 60 second expiry for view-once

    if (error) {
      console.error('Failed to create signed URL:', error)
      return null
    }

    return data.signedUrl
  } catch (error) {
    console.error('Error creating signed URL:', error)
    return null
  }
}
