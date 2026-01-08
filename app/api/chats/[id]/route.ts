import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

/**
 * PATCH /api/chats/[id]
 *
 * Update chat properties (archive, mute, pin)
 *
 * Body:
 * - action: 'archive' | 'unarchive' | 'mute' | 'unmute' | 'pin' | 'unpin'
 * - duration?: '8h' | '1w' | 'always' (for mute action)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: chatId } = await params
    const supabase = await createClient()

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
      .select('id, channel_id, is_archived, muted_until, is_pinned')
      .eq('id', chatId)
      .single()

    if (chatError || !chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    const body = await request.json()
    const { action, duration } = body

    let updateData: Record<string, unknown> = {}
    let responseData: Record<string, unknown> = {}

    switch (action) {
      case 'archive':
        updateData = { is_archived: true, updated_at: new Date().toISOString() }
        responseData = { is_archived: true }
        break

      case 'unarchive':
        updateData = { is_archived: false, updated_at: new Date().toISOString() }
        responseData = { is_archived: false }
        break

      case 'mute':
        if (!duration || !['8h', '1w', 'always'].includes(duration)) {
          return NextResponse.json(
            { error: 'Invalid duration. Must be 8h, 1w, or always' },
            { status: 400 }
          )
        }

        let mutedUntil: Date | string
        if (duration === '8h') {
          mutedUntil = new Date(Date.now() + 8 * 60 * 60 * 1000)
        } else if (duration === '1w') {
          mutedUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        } else {
          // 'always' - set to year 9999
          mutedUntil = new Date('9999-12-31T23:59:59Z')
        }

        updateData = {
          muted_until: mutedUntil.toISOString(),
          updated_at: new Date().toISOString(),
        }
        responseData = { muted_until: mutedUntil.toISOString(), duration }
        break

      case 'unmute':
        updateData = { muted_until: null, updated_at: new Date().toISOString() }
        responseData = { muted_until: null }
        break

      case 'pin':
        updateData = {
          is_pinned: true,
          pinned_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        responseData = { is_pinned: true }
        break

      case 'unpin':
        updateData = {
          is_pinned: false,
          pinned_at: null,
          updated_at: new Date().toISOString(),
        }
        responseData = { is_pinned: false }
        break

      default:
        return NextResponse.json(
          { error: 'Invalid action. Must be archive, unarchive, mute, unmute, pin, or unpin' },
          { status: 400 }
        )
    }

    // Update the chat
    const { error: updateError } = await supabase
      .from('chats')
      .update(updateData)
      .eq('id', chatId)

    if (updateError) {
      console.error('Chat update error:', updateError)
      return NextResponse.json(
        { error: 'Failed to update chat' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      chat_id: chatId,
      action,
      ...responseData,
    })
  } catch (error) {
    console.error('Chat PATCH error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/chats/[id]
 *
 * Hard delete chat and all messages.
 * Also attempts to delete recent messages from WhatsApp via Whapi (delete for everyone).
 *
 * Note: Only deletes up to MAX_WHAPI_DELETES most recent sent messages to avoid
 * serverless timeouts and Whapi rate limits. Uses parallel requests with batching.
 */
const MAX_WHAPI_DELETES = 50 // Cap to avoid timeout/rate limit
const WHAPI_BATCH_SIZE = 5 // Parallel requests per batch
const WHAPI_BATCH_DELAY_MS = 200 // Delay between batches

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: chatId } = await params
    const supabase = await createClient()
    const serviceClient = createServiceRoleClient()

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get chat with channel info for Whapi token
    const { data: chat, error: chatError } = await supabase
      .from('chats')
      .select('id, channel_id, wa_chat_id')
      .eq('id', chatId)
      .single()

    if (chatError || !chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    // Get the channel's API token
    const { data: channelData, error: channelError } = await serviceClient
      .from('channels')
      .select('api_token')
      .eq('id', chat.channel_id)
      .single()

    if (channelError || !channelData?.api_token) {
      console.error('Failed to get channel token:', channelError)
      // Continue with local delete even if we can't delete from WhatsApp
    }

    // Get recent outbound messages that were ACTUALLY SENT to delete from WhatsApp
    // Filter: only 'sent', 'delivered', 'read' status (exclude 'pending', 'failed')
    // Limit to MAX_WHAPI_DELETES most recent to avoid timeout
    const { data: outboundMessages, error: messagesError } = await supabase
      .from('messages')
      .select('id, wa_message_id')
      .eq('chat_id', chatId)
      .eq('direction', 'outbound')
      .not('wa_message_id', 'is', null)
      .in('status', ['sent', 'delivered', 'read'])
      .order('created_at', { ascending: false })
      .limit(MAX_WHAPI_DELETES)

    if (messagesError) {
      console.error('Failed to fetch messages:', messagesError)
    }

    // Try to delete messages from WhatsApp via Whapi (parallel batched)
    const deleteResults: { messageId: string; success: boolean; error?: string }[] = []

    if (channelData?.api_token && outboundMessages && outboundMessages.length > 0) {
      // Process in batches to avoid rate limits
      for (let i = 0; i < outboundMessages.length; i += WHAPI_BATCH_SIZE) {
        const batch = outboundMessages.slice(i, i + WHAPI_BATCH_SIZE)

        const batchResults = await Promise.allSettled(
          batch.map(async (message) => {
            const whapiResponse = await fetch(
              `https://gate.whapi.cloud/messages/${message.wa_message_id}`,
              {
                method: 'DELETE',
                headers: {
                  Authorization: `Bearer ${channelData.api_token}`,
                  'Content-Type': 'application/json',
                },
              }
            )

            if (!whapiResponse.ok) {
              const errorText = await whapiResponse.text()
              throw new Error(errorText)
            }
            return message.wa_message_id
          })
        )

        // Process batch results
        batchResults.forEach((result, idx) => {
          const messageId = batch[idx].wa_message_id
          if (result.status === 'fulfilled') {
            deleteResults.push({ messageId, success: true })
          } else {
            console.warn(`Failed to delete message ${messageId} from WhatsApp:`, result.reason)
            deleteResults.push({
              messageId,
              success: false,
              error: result.reason?.message || 'Unknown error',
            })
          }
        })

        // Small delay between batches to respect rate limits
        if (i + WHAPI_BATCH_SIZE < outboundMessages.length) {
          await new Promise((resolve) => setTimeout(resolve, WHAPI_BATCH_DELAY_MS))
        }
      }
    }

    // Delete all messages from database
    const { error: deleteMessagesError } = await serviceClient
      .from('messages')
      .delete()
      .eq('chat_id', chatId)

    if (deleteMessagesError) {
      console.error('Failed to delete messages from DB:', deleteMessagesError)
      return NextResponse.json(
        { error: 'Failed to delete messages' },
        { status: 500 }
      )
    }

    // Delete the chat from database
    const { error: deleteChatError } = await serviceClient
      .from('chats')
      .delete()
      .eq('id', chatId)

    if (deleteChatError) {
      console.error('Failed to delete chat from DB:', deleteChatError)
      return NextResponse.json(
        { error: 'Failed to delete chat' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      chat_id: chatId,
      messages_deleted_from_whapi: deleteResults.filter(r => r.success).length,
      messages_attempted: outboundMessages?.length || 0,
      whapi_results: deleteResults,
    })
  } catch (error) {
    console.error('Chat DELETE error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/chats/[id]
 *
 * Get a single chat by ID with optional contact info
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: chatId } = await params
    const supabase = await createClient()

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch chat with channel info
    const { data: chat, error: chatError } = await supabase
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
        muted_until,
        contact_id,
        created_at,
        updated_at,
        channel:channels (
          id,
          name,
          color,
          status
        )
      `
      )
      .eq('id', chatId)
      .single()

    if (chatError || !chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    // Fetch linked contact if exists
    let contact = null
    if (chat.contact_id) {
      const { data: contactData } = await supabase
        .from('contacts')
        .select('id, display_name, phone_numbers, email_addresses, tags')
        .eq('id', chat.contact_id)
        .single()

      contact = contactData
    }

    // Get message count
    const { count: messageCount } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('chat_id', chatId)

    // Check if muted
    const isMuted = chat.muted_until
      ? new Date(chat.muted_until) > new Date()
      : false

    return NextResponse.json({
      ...chat,
      contact,
      message_count: messageCount || 0,
      is_muted: isMuted,
    })
  } catch (error) {
    console.error('Chat GET error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
