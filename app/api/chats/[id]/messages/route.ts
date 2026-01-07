import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/encryption'

/**
 * GET /api/chats/[id]/messages
 *
 * Fetch messages for a specific chat with pagination.
 *
 * Query params:
 * - limit: Max messages to return (default 50)
 * - cursor: Message created_at for pagination (older messages)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { id: chatId } = await params

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify user has access to this chat
    const { data: chat, error: chatError } = await supabase
      .from('chats')
      .select('id, channel_id')
      .eq('id', chatId)
      .single()

    if (chatError || !chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    // Parse query params
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    const cursor = searchParams.get('cursor')

    // Fetch messages
    let query = supabase
      .from('messages')
      .select(
        `
        id,
        workspace_id,
        channel_id,
        chat_id,
        wa_message_id,
        direction,
        message_type,
        text,
        media_url,
        storage_path,
        media_metadata,
        is_view_once,
        viewed_at,
        edited_at,
        deleted_at,
        status,
        sender_user_id,
        sender_wa_id,
        sender_name,
        created_at
      `
      )
      .eq('chat_id', chatId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(limit)

    // Apply cursor for pagination (get older messages)
    if (cursor) {
      query = query.lt('created_at', cursor)
    }

    const { data: messages, error } = await query

    if (error) {
      console.error('Error fetching messages:', error)
      return NextResponse.json(
        { error: 'Failed to fetch messages' },
        { status: 500 }
      )
    }

    // Reverse to get chronological order (oldest first)
    const chronologicalMessages = (messages || []).reverse()

    return NextResponse.json({
      messages: chronologicalMessages,
      // For "load more" pagination (loading older messages)
      nextCursor:
        messages && messages.length === limit
          ? messages[messages.length - 1]?.created_at
          : null,
    })
  } catch (error) {
    console.error('Messages API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/chats/[id]/messages
 *
 * Send a new message. Creates entry in outbox for reliable delivery.
 *
 * Body:
 * - text: Message text (required for text messages)
 * - type: Message type (default 'text')
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { id: chatId } = await params

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse body
    const body = await request.json()
    const { text, type = 'text' } = body

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return NextResponse.json(
        { error: 'Message text is required' },
        { status: 400 }
      )
    }

    // Get chat and verify access
    const { data: chat, error: chatError } = await supabase
      .from('chats')
      .select('id, workspace_id, channel_id, wa_chat_id')
      .eq('id', chatId)
      .single()

    if (chatError || !chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    // Get user's profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('user_id, workspace_id')
      .eq('user_id', user.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Create outbox message for reliable delivery
    const { data: outboxMessage, error: outboxError } = await supabase
      .from('outbox_messages')
      .insert({
        workspace_id: chat.workspace_id,
        channel_id: chat.channel_id,
        chat_id: chat.id,
        message_type: type,
        payload: {
          to: chat.wa_chat_id,
          body: text.trim(),
        },
        status: 'queued',
        priority: 0,
        created_by: user.id,
      })
      .select()
      .single()

    if (outboxError) {
      console.error('Error creating outbox message:', outboxError)
      return NextResponse.json(
        { error: 'Failed to queue message' },
        { status: 500 }
      )
    }

    // Also create a pending message record for immediate UI feedback
    const tempWaMessageId = `pending_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    const { data: message, error: messageError } = await supabase
      .from('messages')
      .insert({
        workspace_id: chat.workspace_id,
        channel_id: chat.channel_id,
        chat_id: chat.id,
        wa_message_id: tempWaMessageId,
        direction: 'outbound',
        message_type: type,
        text: text.trim(),
        status: 'pending',
        sender_user_id: user.id,
        created_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (messageError) {
      console.error('Error creating message record:', messageError)
      // Don't fail - outbox message was created, it will be processed
    }

    // Update chat's last message
    await supabase
      .from('chats')
      .update({
        last_message_at: new Date().toISOString(),
        last_message_preview: text.trim().slice(0, 100),
        updated_at: new Date().toISOString(),
      })
      .eq('id', chatId)

    // Immediately attempt to send via Whapi
    try {
      const serviceClient = createServiceRoleClient()

      // Get encrypted token from channel_tokens table
      const { data: tokenData } = await serviceClient
        .from('channel_tokens')
        .select('encrypted_token')
        .eq('channel_id', chat.channel_id)
        .eq('token_type', 'whapi')
        .single()

      if (tokenData?.encrypted_token) {
        // Decrypt the token
        const whapiToken = decrypt(tokenData.encrypted_token)

        console.log('[Send Message] Sending to:', chat.wa_chat_id)

        const whapiResponse = await fetch('https://gate.whapi.cloud/messages/text', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${whapiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to: chat.wa_chat_id,
            body: text.trim(),
          }),
        })

        const whapiResult = await whapiResponse.json()
        console.log('[Send Message] Whapi response:', JSON.stringify(whapiResult))

        // Whapi returns { sent: true, message: { id: "...", ... } } on success
        // Or can return directly { id: "...", ... } in some cases
        const waMessageId = whapiResult.message?.id || whapiResult.id
        const isSent = whapiResult.sent === true || whapiResponse.ok

        if (isSent && waMessageId) {
          console.log('[Send Message] Message sent successfully, wa_message_id:', waMessageId)
          // Update outbox and message with real WhatsApp message ID
          await serviceClient
            .from('outbox_messages')
            .update({ status: 'sent', sent_at: new Date().toISOString(), wa_message_id: waMessageId })
            .eq('id', outboxMessage.id)

          if (message) {
            await serviceClient
              .from('messages')
              .update({ wa_message_id: waMessageId, status: 'sent' })
              .eq('id', message.id)
          }
        } else {
          console.error('[Send Message] Whapi send failed:', whapiResult)
          // Update status to failed
          if (message) {
            await serviceClient
              .from('messages')
              .update({ status: 'failed' })
              .eq('id', message.id)
          }
        }
      } else {
        console.error('[Send Message] No token found for channel:', chat.channel_id)
      }
    } catch (sendError) {
      // Log but don't fail - message is in outbox for retry
      console.error('[Send Message] Immediate send failed:', sendError)
    }

    return NextResponse.json(
      {
        success: true,
        message: message || { id: outboxMessage.id },
        outbox_id: outboxMessage.id,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Send message API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
