/**
 * Webhook Processor
 *
 * Handles processing of Whapi.cloud webhook events with idempotent operations.
 * CRITICAL: Uses (channel_id, wa_message_id) for deduplication, NOT event.id
 *
 * Supported event types:
 * - message (inbound/outbound): New message received/sent
 * - message.status: Status update (sent, delivered, read, failed)
 * - message.edit: Message was edited
 * - message.revoked / message.delete: Message was deleted
 * - chat: Chat events (archive, etc.)
 * - channel.status: Channel connection status changes
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getOrCreateChat, updateChatLastMessage, markChatAsRead } from '@/lib/chat-helpers'
import { processThroughBotIfConfigured } from '@/lib/bot-router'

// ============================================================================
// Types
// ============================================================================

export interface WebhookEvent {
  event?: string | { type: string; event?: string; method?: string }
  type?: string
  method?: string
  data?: any
  messages?: any[]
  // Whapi event structures vary, so we keep this flexible
  [key: string]: any
}

export interface ProcessingResult {
  success: boolean
  action: string
  details?: Record<string, any>
  error?: string
}

export interface ChannelInfo {
  id: string
  workspace_id: string
  status: string
}

// ============================================================================
// Main Processor
// ============================================================================

/**
 * Process a webhook event from Whapi.cloud
 *
 * @param channel - Channel information
 * @param event - The webhook event payload
 * @returns Processing result
 */
export async function processWebhookEvent(
  channel: ChannelInfo,
  event: WebhookEvent
): Promise<ProcessingResult> {
  const supabase = createServiceRoleClient()

  // Handle Whapi format where event can be an object like {"type": "messages", "method": "post"}
  // or {"type": "messages", "event": "post"}
  let eventType: string = 'unknown'
  let eventMethod: string | undefined = undefined

  if (typeof event.event === 'object' && event.event?.type) {
    eventType = event.event.type
    eventMethod = event.event.method || event.event.event
  } else if (typeof event.event === 'string') {
    eventType = event.event
  } else if (event.type) {
    eventType = event.type
    eventMethod = event.method
  }

  console.log('[Webhook Processor] Event type:', eventType, 'method:', eventMethod, 'Full event keys:', Object.keys(event))

  try {
    // Handle Whapi's event format where type=messages and method=patch/delete
    // indicates edit/delete operations rather than new messages
    if ((eventType === 'message' || eventType === 'messages') && eventMethod) {
      const method = eventMethod.toLowerCase()
      if (method === 'patch' || method === 'put') {
        console.log('[Webhook Processor] Detected message edit via method:', method)
        return await processEditEvent(supabase, channel, event)
      }
      if (method === 'delete') {
        console.log('[Webhook Processor] Detected message delete via method:', method)
        return await processDeleteEvent(supabase, channel, event)
      }
      // method === 'post' or any other method falls through to processMessageEvent
    }

    // IMPORTANT: Check for "action" type messages which Whapi uses for edits/deletes/revokes
    // These come as type: "messages", event: "post" but with message.type = "action"
    // Format: { messages: [{ type: "action", action: { type: "edit"|"revoke", target: "msg_id", edited_content: {...} } }] }
    const messages = event.messages || []
    if (messages.length > 0 && messages[0]?.type === 'action') {
      console.log('[Webhook Processor] Detected action message, processing action events')
      return await processActionMessages(supabase, channel, event)
    }

    switch (eventType) {
      case 'message':
      case 'messages':
        return await processMessageEvent(supabase, channel, event)

      case 'message.status':
      case 'ack':
      case 'acks':
      case 'statuses':
        return await processStatusEvent(supabase, channel, event)

      case 'message.edit':
        return await processEditEvent(supabase, channel, event)

      case 'message.revoked':
      case 'message.delete':
        return await processDeleteEvent(supabase, channel, event)

      case 'chat':
      case 'chats':
        return await processChatEvent(supabase, channel, event)

      case 'channel.status':
      case 'status':
        return await processChannelStatusEvent(supabase, channel, event)

      default:
        // Unknown event type - log but don't fail
        return {
          success: true,
          action: 'ignored',
          details: { reason: `Unknown event type: ${eventType}, method: ${eventMethod}` },
        }
    }
  } catch (error) {
    console.error('Webhook processing error:', error)
    return {
      success: false,
      action: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

// ============================================================================
// Message Event Processing
// ============================================================================

/**
 * Process incoming/outgoing message events
 * Uses upsert with (channel_id, wa_message_id) for idempotency
 */
async function processMessageEvent(
  supabase: SupabaseClient,
  channel: ChannelInfo,
  event: WebhookEvent
): Promise<ProcessingResult> {
  // Handle both single message and batch formats
  const messages = event.messages || (event.data ? [event.data] : [event])

  const results: ProcessingResult[] = []

  for (const messageData of messages) {
    const result = await processSingleMessage(supabase, channel, messageData)
    results.push(result)
  }

  const successCount = results.filter((r) => r.success).length
  const failCount = results.length - successCount

  return {
    success: failCount === 0,
    action: 'process_messages',
    details: {
      total: results.length,
      success: successCount,
      failed: failCount,
      results: results,
    },
  }
}

/**
 * Process a single message
 */
async function processSingleMessage(
  supabase: SupabaseClient,
  channel: ChannelInfo,
  messageData: any
): Promise<ProcessingResult> {
  try {
    // Extract message ID - Whapi uses 'id' field
    const waMessageId = messageData.id
    if (!waMessageId) {
      return {
        success: false,
        action: 'skip',
        error: 'Missing message ID',
      }
    }

    // Extract chat ID - Whapi uses 'chat_id' or 'from'/'to' depending on direction
    const waChatId = messageData.chat_id || messageData.chatId || extractChatId(messageData)
    if (!waChatId) {
      return {
        success: false,
        action: 'skip',
        error: 'Missing chat ID',
      }
    }

    // Determine message direction
    const fromMe = messageData.from_me ?? messageData.fromMe ?? false
    const direction = fromMe ? 'outbound' : 'inbound'

    // Log outbound messages for debugging ID matching
    if (fromMe) {
      console.log('[Webhook Processor] Received OUTBOUND message webhook:')
      console.log('[Webhook Processor] Webhook wa_message_id:', waMessageId)
      console.log('[Webhook Processor] Chat ID:', waChatId)
      console.log('[Webhook Processor] Message status:', messageData.status)
    }

    // Try to extract and update channel phone number if not set
    // For inbound messages, 'to' contains the channel's WhatsApp number
    // For outbound messages, 'from' contains the channel's WhatsApp number
    await updateChannelPhoneIfNeeded(supabase, channel, messageData, fromMe)

    // Get or create the chat
    const chat = await getOrCreateChat(supabase, channel, waChatId, messageData)
    if (!chat) {
      return {
        success: false,
        action: 'error',
        error: 'Failed to get or create chat',
      }
    }

    // Determine message type
    const messageType = extractMessageType(messageData)

    // Extract text content
    const textContent = extractTextContent(messageData)

    // Check if this is a view-once message
    const isViewOnce = messageData.is_view_once ?? messageData.viewOnce ?? false

    // Extract media info if present - handle various Whapi formats
    // Also fetch from Whapi if link not present but media ID is
    // As a last resort, downloads and stores media in Supabase Storage
    // For view-once messages, we MUST download and store immediately as the URL expires quickly
    const mediaInfo = await extractMediaInfoWithFetch(supabase, channel.id, messageData, messageType, isViewOnce)
    let mediaUrl = mediaInfo?.url || null
    let mediaMetadata = mediaInfo?.metadata || null
    let storagePath = mediaInfo?.storagePath || null

    // For view-once messages, if we got a URL but didn't store it, force download now
    if (isViewOnce && mediaUrl && !storagePath) {
      console.log('[Webhook Processor] View-once message - forcing download and storage')
      const forceDownload = await forceDownloadAndStore(supabase, channel.id, channel.workspace_id, mediaUrl, messageType, mediaMetadata)
      if (forceDownload) {
        mediaUrl = forceDownload.url
        storagePath = forceDownload.storagePath
        mediaMetadata = { ...mediaMetadata, ...forceDownload.metadata, stored: true }
      }
    }

    // Extract sender info
    const senderWaId = messageData.from || messageData.sender?.id
    const senderName =
      messageData.sender?.name ||
      messageData.sender?.pushname ||
      messageData.pushname ||
      messageData.notifyName

    // Determine timestamp
    const timestamp = messageData.timestamp
      ? new Date(messageData.timestamp * 1000).toISOString()
      : new Date().toISOString()

    // Prepare message record for upsert
    const messageRecord: Record<string, any> = {
      workspace_id: channel.workspace_id,
      channel_id: channel.id,
      chat_id: chat.id,
      wa_message_id: waMessageId,
      direction: direction,
      message_type: messageType,
      text: textContent,
      media_url: mediaUrl,
      media_metadata: mediaMetadata,
      is_view_once: isViewOnce,
      status: direction === 'outbound' ? (messageData.status || 'sent') : null,
      sender_wa_id: senderWaId,
      sender_name: senderName,
      created_at: timestamp,
    }

    // Add storage_path if media was stored in Supabase Storage
    if (storagePath) {
      messageRecord.storage_path = storagePath
    }

    // Upsert message using (channel_id, wa_message_id) constraint
    // This ensures idempotency - duplicate webhooks won't create duplicate messages
    const { data: message, error: messageError } = await supabase
      .from('messages')
      .upsert(messageRecord, {
        onConflict: 'channel_id,wa_message_id',
        ignoreDuplicates: false, // Update existing record if it exists
      })
      .select()
      .single()

    if (messageError) {
      console.error('Message upsert error:', messageError)
      return {
        success: false,
        action: 'error',
        error: messageError.message,
      }
    }

    // Update chat's last message info and unread count
    const messageStatus = direction === 'outbound' ? (messageData.status || 'sent') : null
    await updateChatLastMessage(supabase, chat.id, {
      text: textContent,
      timestamp: timestamp,
      incrementUnread: direction === 'inbound',
      direction: direction,
      status: messageStatus,
    })

    // Mark chat as read when an outbound message is sent
    // (from phone, WhatsApp web, or another user in the system)
    if (direction === 'outbound') {
      await markChatAsRead(supabase, chat.id)
    }

    // Route inbound text messages through bot if configured
    // Bot processing happens asynchronously after message is saved
    if (direction === 'inbound' && messageType === 'text' && textContent) {
      try {
        const botResult = await processThroughBotIfConfigured(
          supabase,
          channel.id,
          channel.workspace_id,
          chat.id,
          waMessageId,
          textContent,
          messageType,
          senderWaId || waChatId,  // contactId
          timestamp
        )

        if (botResult.handled) {
          console.log('[Webhook Processor] Bot processed message:', botResult.response?.action || 'handled')
        }
      } catch (botError) {
        // Bot processing errors should not fail the webhook
        console.error('[Webhook Processor] Bot processing error (non-fatal):', botError)
      }
    }

    return {
      success: true,
      action: 'message_upserted',
      details: {
        message_id: message?.id,
        wa_message_id: waMessageId,
        chat_id: chat.id,
        direction: direction,
        type: messageType,
      },
    }
  } catch (error) {
    console.error('Process single message error:', error)
    return {
      success: false,
      action: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

// ============================================================================
// Status Event Processing
// ============================================================================

/**
 * Process message status updates (sent, delivered, read, failed)
 * Status progression: pending -> sent -> delivered -> read
 * Only update if new status is "higher" than current status
 */
async function processStatusEvent(
  supabase: SupabaseClient,
  channel: ChannelInfo,
  event: WebhookEvent
): Promise<ProcessingResult> {
  const statusData = event.data || event
  const waMessageId = statusData.id || statusData.message_id || statusData.messageId

  if (!waMessageId) {
    return {
      success: false,
      action: 'skip',
      error: 'Missing message ID in status event',
    }
  }

  // Map Whapi status to our status enum
  const newStatus = mapWhapiStatus(statusData.status || statusData.ack)

  if (!newStatus) {
    return {
      success: true,
      action: 'ignored',
      details: { reason: 'Unknown status value' },
    }
  }

  // Update message status only if it's a progression
  // Use a conditional update to ensure we don't downgrade status
  const statusOrder = ['pending', 'sent', 'delivered', 'read', 'failed']
  const statusOrderClause = statusOrder
    .slice(0, statusOrder.indexOf(newStatus))
    .map((s) => `'${s}'`)
    .join(', ')

  // Update the message status
  const { data, error } = await supabase
    .from('messages')
    .update({
      status: newStatus,
    })
    .eq('channel_id', channel.id)
    .eq('wa_message_id', waMessageId)
    .eq('direction', 'outbound')
    .select('id, chat_id, created_at')

  if (error) {
    console.error('Status update error:', error)
    return {
      success: false,
      action: 'error',
      error: error.message,
    }
  }

  // If message was updated, also update chat's last_message_status if this is the latest message
  if (data && data.length > 0) {
    const message = data[0]
    // Check if this message is the chat's last message by comparing timestamps
    const { data: chat } = await supabase
      .from('chats')
      .select('last_message_at')
      .eq('id', message.chat_id)
      .single()

    // Only update chat status if this is the most recent message (within 1 second tolerance)
    if (chat?.last_message_at) {
      const chatLastMessageTime = new Date(chat.last_message_at).getTime()
      const messageTime = new Date(message.created_at).getTime()
      const timeDiff = Math.abs(chatLastMessageTime - messageTime)

      if (timeDiff < 1000) {
        await supabase
          .from('chats')
          .update({ last_message_status: newStatus })
          .eq('id', message.chat_id)
      }
    }
  }

  return {
    success: true,
    action: 'status_updated',
    details: {
      wa_message_id: waMessageId,
      new_status: newStatus,
      updated: data?.length > 0,
    },
  }
}

// ============================================================================
// Edit Event Processing
// ============================================================================

/**
 * Process message edit events
 * WhatsApp allows editing within 15 minutes of sending
 * Whapi sends edits via type=messages, method=patch with message data in 'messages' array
 */
async function processEditEvent(
  supabase: SupabaseClient,
  channel: ChannelInfo,
  event: WebhookEvent
): Promise<ProcessingResult> {
  // Handle both single message and batch formats from Whapi
  // Whapi sends message data in 'messages' array for patch/delete events
  const messages = event.messages || (event.data ? [event.data] : [event])

  console.log('[Webhook Processor] Processing edit event, messages count:', messages.length)

  const results: ProcessingResult[] = []

  for (const editData of messages) {
    const waMessageId = editData.id || editData.message_id || editData.messageId
    const newText = editData.body || editData.text?.body || editData.text || editData.newBody

    console.log('[Webhook Processor] Edit data - waMessageId:', waMessageId, 'newText:', newText?.substring(0, 50))

    if (!waMessageId) {
      results.push({
        success: false,
        action: 'skip',
        error: 'Missing message ID in edit event',
      })
      continue
    }

    const { data, error } = await supabase
      .from('messages')
      .update({
        text: newText,
        edited_at: new Date().toISOString(),
      })
      .eq('channel_id', channel.id)
      .eq('wa_message_id', waMessageId)
      .select()

    if (error) {
      console.error('Edit update error:', error)
      results.push({
        success: false,
        action: 'error',
        error: error.message,
      })
      continue
    }

    console.log('[Webhook Processor] Edit successful, updated:', data?.length, 'records')

    results.push({
      success: true,
      action: 'message_edited',
      details: {
        wa_message_id: waMessageId,
        updated: data?.length > 0,
      },
    })
  }

  const successCount = results.filter((r) => r.success).length
  const failCount = results.length - successCount

  return {
    success: failCount === 0,
    action: 'process_edits',
    details: {
      total: results.length,
      success: successCount,
      failed: failCount,
      results: results,
    },
  }
}

// ============================================================================
// Delete Event Processing
// ============================================================================

/**
 * Process message deletion events
 * Sets deleted_at timestamp instead of actually deleting
 * Whapi sends deletes via type=messages, method=delete with message data in 'messages' array
 */
async function processDeleteEvent(
  supabase: SupabaseClient,
  channel: ChannelInfo,
  event: WebhookEvent
): Promise<ProcessingResult> {
  // Handle both single message and batch formats from Whapi
  // Whapi sends message data in 'messages' array for patch/delete events
  const messages = event.messages || (event.data ? [event.data] : [event])

  console.log('[Webhook Processor] Processing delete event, messages count:', messages.length)

  const results: ProcessingResult[] = []

  for (const deleteData of messages) {
    const waMessageId = deleteData.id || deleteData.message_id || deleteData.messageId

    console.log('[Webhook Processor] Delete data - waMessageId:', waMessageId)

    if (!waMessageId) {
      results.push({
        success: false,
        action: 'skip',
        error: 'Missing message ID in delete event',
      })
      continue
    }

    // Only set deleted_at if not already set (idempotency)
    const { data, error } = await supabase
      .from('messages')
      .update({
        deleted_at: new Date().toISOString(),
      })
      .eq('channel_id', channel.id)
      .eq('wa_message_id', waMessageId)
      .is('deleted_at', null)
      .select()

    if (error) {
      console.error('Delete update error:', error)
      results.push({
        success: false,
        action: 'error',
        error: error.message,
      })
      continue
    }

    console.log('[Webhook Processor] Delete successful, updated:', data?.length, 'records')

    results.push({
      success: true,
      action: 'message_deleted',
      details: {
        wa_message_id: waMessageId,
        updated: data?.length > 0,
      },
    })
  }

  const successCount = results.filter((r) => r.success).length
  const failCount = results.length - successCount

  return {
    success: failCount === 0,
    action: 'process_deletes',
    details: {
      total: results.length,
      success: successCount,
      failed: failCount,
      results: results,
    },
  }
}

// ============================================================================
// Action Message Processing (Whapi's format for edits/deletes)
// ============================================================================

/**
 * Process "action" type messages from Whapi
 * Whapi sends edits and deletes as type: "action" messages with:
 * - action.type: "edit" | "revoke" | "delete"
 * - action.target: the original message ID being modified
 * - action.edited_content: { body: "new text" } for edits
 *
 * Example payload:
 * {
 *   "messages": [{
 *     "id": "new_action_msg_id",
 *     "type": "action",
 *     "action": {
 *       "target": "original_msg_id",
 *       "type": "edit",
 *       "edited_type": "text",
 *       "edited_content": { "body": "new text" }
 *     }
 *   }]
 * }
 */
async function processActionMessages(
  supabase: SupabaseClient,
  channel: ChannelInfo,
  event: WebhookEvent
): Promise<ProcessingResult> {
  const messages = event.messages || []

  console.log('[Webhook Processor] Processing action messages, count:', messages.length)

  const results: ProcessingResult[] = []

  for (const actionMsg of messages) {
    if (actionMsg.type !== 'action' || !actionMsg.action) {
      console.log('[Webhook Processor] Skipping non-action message')
      continue
    }

    const action = actionMsg.action
    const targetMessageId = action.target
    const actionType = action.type

    console.log('[Webhook Processor] Action type:', actionType, 'target:', targetMessageId)

    if (!targetMessageId) {
      results.push({
        success: false,
        action: 'skip',
        error: 'Missing target message ID in action',
      })
      continue
    }

    if (actionType === 'edit') {
      // Handle edit action
      const newText = action.edited_content?.body || action.edited_content?.caption

      console.log('[Webhook Processor] Processing edit action - target:', targetMessageId, 'newText:', newText?.substring(0, 50))

      if (!newText) {
        results.push({
          success: false,
          action: 'skip',
          error: 'Missing edited content in edit action',
        })
        continue
      }

      const { data, error } = await supabase
        .from('messages')
        .update({
          text: newText,
          edited_at: new Date().toISOString(),
        })
        .eq('channel_id', channel.id)
        .eq('wa_message_id', targetMessageId)
        .select()

      if (error) {
        console.error('[Webhook Processor] Edit action error:', error)
        results.push({
          success: false,
          action: 'error',
          error: error.message,
        })
        continue
      }

      console.log('[Webhook Processor] Edit action successful, updated:', data?.length, 'records')

      results.push({
        success: true,
        action: 'message_edited_via_action',
        details: {
          wa_message_id: targetMessageId,
          updated: data?.length > 0,
        },
      })
    } else if (actionType === 'revoke' || actionType === 'delete') {
      // Handle delete/revoke action
      console.log('[Webhook Processor] Processing delete/revoke action - target:', targetMessageId)

      const { data, error } = await supabase
        .from('messages')
        .update({
          deleted_at: new Date().toISOString(),
        })
        .eq('channel_id', channel.id)
        .eq('wa_message_id', targetMessageId)
        .is('deleted_at', null)
        .select()

      if (error) {
        console.error('[Webhook Processor] Delete action error:', error)
        results.push({
          success: false,
          action: 'error',
          error: error.message,
        })
        continue
      }

      console.log('[Webhook Processor] Delete action successful, updated:', data?.length, 'records')

      results.push({
        success: true,
        action: 'message_deleted_via_action',
        details: {
          wa_message_id: targetMessageId,
          updated: data?.length > 0,
        },
      })
    } else {
      console.log('[Webhook Processor] Unknown action type:', actionType)
      results.push({
        success: true,
        action: 'ignored',
        details: { reason: `Unknown action type: ${actionType}` },
      })
    }
  }

  const successCount = results.filter((r) => r.success).length
  const failCount = results.length - successCount

  return {
    success: failCount === 0,
    action: 'process_actions',
    details: {
      total: results.length,
      success: successCount,
      failed: failCount,
      results: results,
    },
  }
}

// ============================================================================
// Chat Event Processing
// ============================================================================

/**
 * Process chat-level events (archive, etc.)
 */
async function processChatEvent(
  supabase: SupabaseClient,
  channel: ChannelInfo,
  event: WebhookEvent
): Promise<ProcessingResult> {
  const chatData = event.data || event
  const waChatId = chatData.id || chatData.chat_id || chatData.chatId

  if (!waChatId) {
    return {
      success: false,
      action: 'skip',
      error: 'Missing chat ID in chat event',
    }
  }

  // Handle archive/unarchive events
  if (chatData.archive !== undefined || chatData.isArchived !== undefined) {
    const isArchived = chatData.archive ?? chatData.isArchived ?? false

    const { error } = await supabase
      .from('chats')
      .update({
        is_archived: isArchived,
        updated_at: new Date().toISOString(),
      })
      .eq('channel_id', channel.id)
      .eq('wa_chat_id', waChatId)

    if (error) {
      console.error('Chat archive update error:', error)
      return {
        success: false,
        action: 'error',
        error: error.message,
      }
    }

    return {
      success: true,
      action: 'chat_archived',
      details: {
        wa_chat_id: waChatId,
        is_archived: isArchived,
      },
    }
  }

  return {
    success: true,
    action: 'ignored',
    details: { reason: 'Unhandled chat event type' },
  }
}

// ============================================================================
// Channel Status Event Processing
// ============================================================================

/**
 * Process channel status events
 */
async function processChannelStatusEvent(
  supabase: SupabaseClient,
  channel: ChannelInfo,
  event: WebhookEvent
): Promise<ProcessingResult> {
  const statusData = event.data || event
  const newStatus = mapChannelStatus(statusData.status || statusData.state)

  if (!newStatus) {
    return {
      success: true,
      action: 'ignored',
      details: { reason: 'Unknown channel status' },
    }
  }

  const { error } = await supabase
    .from('channels')
    .update({
      status: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', channel.id)

  if (error) {
    console.error('Channel status update error:', error)
    return {
      success: false,
      action: 'error',
      error: error.message,
    }
  }

  return {
    success: true,
    action: 'channel_status_updated',
    details: {
      channel_id: channel.id,
      new_status: newStatus,
    },
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Update channel phone number if not already set
 * Extracts the channel's WhatsApp number from message data or fetches from Whapi API
 */
async function updateChannelPhoneIfNeeded(
  supabase: SupabaseClient,
  channel: ChannelInfo,
  messageData: any,
  fromMe: boolean
): Promise<void> {
  try {
    // First check if channel already has a phone number
    const { data: existingChannel } = await supabase
      .from('channels')
      .select('phone_number, status')
      .eq('id', channel.id)
      .single()

    if (existingChannel?.phone_number) {
      // Already has phone number, skip
      return
    }

    console.log('[Webhook Processor] Channel missing phone, attempting to extract. messageData keys:', Object.keys(messageData))
    console.log('[Webhook Processor] from:', messageData.from, 'to:', messageData.to, 'chat_id:', messageData.chat_id)

    // Extract channel's WhatsApp ID from various possible locations
    let channelWaId: string | null = null

    // Method 1: Direct to/from fields
    if (!fromMe && messageData.to) {
      channelWaId = messageData.to
    } else if (fromMe && messageData.from) {
      channelWaId = messageData.from
    }

    // Method 2: If no direct field, try to get from Whapi settings API
    if (!channelWaId) {
      console.log('[Webhook Processor] No to/from field, trying Whapi settings API')
      channelWaId = await fetchChannelPhoneFromWhapi(supabase, channel.id)
    }

    if (!channelWaId) {
      console.log('[Webhook Processor] Could not extract channel phone number from any source')
      return
    }

    // Extract phone number from WhatsApp ID
    const phoneNumber = extractPhoneFromWaId(channelWaId)
    if (!phoneNumber) {
      return
    }

    console.log('[Webhook Processor] Updating channel phone number:', phoneNumber)

    // Update channel with phone number and set status to active
    const { error } = await supabase
      .from('channels')
      .update({
        phone_number: phoneNumber,
        status: 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('id', channel.id)

    if (error) {
      console.error('[Webhook Processor] Failed to update channel phone number:', error)
    } else {
      console.log('[Webhook Processor] Channel phone number updated successfully')
    }
  } catch (error) {
    console.error('[Webhook Processor] Error updating channel phone:', error)
  }
}

/**
 * Fetch channel phone number from Whapi settings API
 */
async function fetchChannelPhoneFromWhapi(
  supabase: SupabaseClient,
  channelId: string
): Promise<string | null> {
  try {
    // Import decrypt function
    const { decrypt } = await import('@/lib/encryption')

    // Get the Whapi token for this channel
    const { data: tokenData } = await supabase
      .from('channel_tokens')
      .select('encrypted_token')
      .eq('channel_id', channelId)
      .eq('token_type', 'whapi')
      .single()

    if (!tokenData?.encrypted_token) {
      console.log('[Webhook Processor] No token found for channel')
      return null
    }

    const whapiToken = decrypt(tokenData.encrypted_token)

    // Fetch settings from Whapi
    const response = await fetch('https://gate.whapi.cloud/settings', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${whapiToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      console.error('[Webhook Processor] Failed to fetch Whapi settings:', response.status)
      return null
    }

    const settings = await response.json()
    console.log('[Webhook Processor] Whapi settings wid:', settings.wid)

    // wid is in format "1234567890@s.whatsapp.net"
    return settings.wid || null
  } catch (error) {
    console.error('[Webhook Processor] Error fetching Whapi settings:', error)
    return null
  }
}

/**
 * Extract phone number from WhatsApp ID
 */
function extractPhoneFromWaId(waId: string): string | null {
  if (!waId) return null
  // Remove the @c.us or @s.whatsapp.net suffix
  const cleaned = waId.replace(/@(c\.us|s\.whatsapp\.net|g\.us)$/, '')
  // Return as E.164 format (with + prefix)
  if (cleaned && /^\d+$/.test(cleaned)) {
    return `+${cleaned}`
  }
  return cleaned || null
}

/**
 * Extract chat ID from message data
 */
function extractChatId(messageData: any): string | null {
  // Direct chat_id field
  if (messageData.chat_id) return messageData.chat_id
  if (messageData.chatId) return messageData.chatId

  // For individual chats, use the remote party's ID
  const fromMe = messageData.from_me ?? messageData.fromMe ?? false
  if (fromMe) {
    // Outbound message - chat ID is the recipient
    return messageData.to
  } else {
    // Inbound message - chat ID is the sender
    return messageData.from
  }
}

/**
 * Extract message type from message data
 */
function extractMessageType(messageData: any): string {
  if (messageData.type) return messageData.type.toLowerCase()

  // Infer from content - order matters (more specific first)
  if (messageData.text || messageData.body) return 'text'
  if (messageData.image) return 'image'
  if (messageData.video) return 'video'
  // Distinguish voice/ptt from regular audio
  if (messageData.ptt) return 'ptt'
  if (messageData.voice) return 'voice'
  if (messageData.audio) return 'audio'
  if (messageData.document || messageData.file) return 'document'
  if (messageData.sticker) return 'sticker'
  if (messageData.location) return 'location'
  if (messageData.contact || messageData.vcard) return 'contact'

  return 'text'
}

/**
 * Extract text content from message data
 */
function extractTextContent(messageData: any): string | null {
  return (
    messageData.text?.body ||
    messageData.text ||
    messageData.body ||
    messageData.caption ||
    // Also check for caption in media objects
    messageData.image?.caption ||
    messageData.video?.caption ||
    messageData.document?.caption ||
    null
  )
}

/**
 * Extract media information from message data with Whapi API fallback
 * If link is not present but media ID is, fetches from Whapi
 * As a last resort, downloads the media and stores in Supabase Storage
 */
async function extractMediaInfoWithFetch(
  supabase: SupabaseClient,
  channelId: string,
  messageData: any,
  messageType: string,
  isViewOnce: boolean = false
): Promise<{ url: string; metadata: Record<string, any>; storagePath?: string } | null> {
  // First try direct extraction
  const directMedia = extractMediaInfo(messageData, messageType)
  if (directMedia?.url) {
    console.log('[Webhook Processor] Media URL found directly:', directMedia.url.slice(0, 100))
    return directMedia
  }

  // If no direct URL, check for media ID and fetch from Whapi
  const mediaObject =
    messageData.image ||
    messageData.video ||
    messageData.audio ||
    messageData.voice ||
    messageData.ptt ||
    messageData.document ||
    messageData.sticker

  const mediaId = mediaObject?.id
  const waMessageId = messageData.id

  if (!mediaId && !waMessageId) {
    console.log('[Webhook Processor] No media ID or message ID found, cannot fetch')
    return null
  }

  console.log('[Webhook Processor] Attempting to fetch media. Media ID:', mediaId, 'Message ID:', waMessageId)

  try {
    // Import decrypt function
    const { decrypt } = await import('@/lib/encryption')

    // Get the Whapi token and channel info for this channel
    const { data: tokenData } = await supabase
      .from('channel_tokens')
      .select('encrypted_token')
      .eq('channel_id', channelId)
      .eq('token_type', 'whapi')
      .single()

    if (!tokenData?.encrypted_token) {
      console.log('[Webhook Processor] No token found for media fetch')
      return null
    }

    const whapiToken = decrypt(tokenData.encrypted_token)

    // Strategy 1: Try /media/{mediaId} endpoint
    if (mediaId) {
      const mediaResult = await tryFetchMediaInfo(whapiToken, mediaId, mediaObject)
      if (mediaResult) return mediaResult
    }

    // Strategy 2: Try /messages/{messageId} endpoint to get full message with media
    if (waMessageId) {
      console.log('[Webhook Processor] Trying /messages endpoint for:', waMessageId)
      const messageResult = await tryFetchMessageWithMedia(whapiToken, waMessageId, messageType)
      if (messageResult) return messageResult
    }

    // Strategy 3: Download media directly and upload to Supabase Storage
    if (mediaId) {
      console.log('[Webhook Processor] Attempting direct media download for:', mediaId)
      const downloadResult = await downloadAndStoreMedia(
        supabase,
        whapiToken,
        channelId,
        mediaId,
        messageType,
        mediaObject
      )
      if (downloadResult) return downloadResult
    }

    console.log('[Webhook Processor] All media fetch strategies failed')
    return null
  } catch (error) {
    console.error('[Webhook Processor] Error fetching media from Whapi:', error)
    return null
  }
}

/**
 * Try to fetch media info from /media/{mediaId} endpoint
 */
async function tryFetchMediaInfo(
  whapiToken: string,
  mediaId: string,
  mediaObject: any
): Promise<{ url: string; metadata: Record<string, any> } | null> {
  try {
    const response = await fetch(`https://gate.whapi.cloud/media/${mediaId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${whapiToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      console.log('[Webhook Processor] /media endpoint failed:', response.status)
      return null
    }

    const mediaData = await response.json()
    console.log('[Webhook Processor] /media response:', JSON.stringify(mediaData).slice(0, 500))

    const url = mediaData.link || mediaData.url || mediaData.file?.link || mediaData.file?.url
    if (url) {
      return {
        url,
        metadata: {
          mime_type: mediaData.mime_type || mediaData.mimetype || mediaObject?.mime_type,
          size: mediaData.file_size || mediaData.size || mediaObject?.file_size,
          filename: mediaData.filename || mediaObject?.filename,
          width: mediaData.width || mediaObject?.width,
          height: mediaData.height || mediaObject?.height,
          duration: mediaData.seconds || mediaData.duration || mediaObject?.seconds,
          id: mediaId,
        },
      }
    }

    return null
  } catch (error) {
    console.error('[Webhook Processor] Error in tryFetchMediaInfo:', error)
    return null
  }
}

/**
 * Try to fetch full message to get media with link
 */
async function tryFetchMessageWithMedia(
  whapiToken: string,
  waMessageId: string,
  messageType: string
): Promise<{ url: string; metadata: Record<string, any> } | null> {
  try {
    const response = await fetch(`https://gate.whapi.cloud/messages/${waMessageId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${whapiToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      console.log('[Webhook Processor] /messages endpoint failed:', response.status)
      return null
    }

    const messageData = await response.json()
    console.log('[Webhook Processor] /messages response keys:', Object.keys(messageData))

    // Try to extract media info from the full message
    const mediaInfo = extractMediaInfo(messageData, messageType)
    if (mediaInfo?.url) {
      console.log('[Webhook Processor] Found media URL from /messages endpoint')
      return mediaInfo
    }

    return null
  } catch (error) {
    console.error('[Webhook Processor] Error in tryFetchMessageWithMedia:', error)
    return null
  }
}

/**
 * Download media from Whapi and upload to Supabase Storage
 */
async function downloadAndStoreMedia(
  supabase: SupabaseClient,
  whapiToken: string,
  channelId: string,
  mediaId: string,
  messageType: string,
  mediaObject: any
): Promise<{ url: string; metadata: Record<string, any>; storagePath: string } | null> {
  try {
    // Download the media file
    const downloadResponse = await fetch(`https://gate.whapi.cloud/media/${mediaId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${whapiToken}`,
        'Accept': '*/*',
      },
    })

    if (!downloadResponse.ok) {
      console.log('[Webhook Processor] Media download failed:', downloadResponse.status)
      return null
    }

    const contentType = downloadResponse.headers.get('content-type') || 'application/octet-stream'

    // Check if response is JSON (media info) or binary (actual file)
    if (contentType.includes('application/json')) {
      // It returned JSON info, try to get the link from it
      const jsonData = await downloadResponse.json()
      if (jsonData.link || jsonData.url) {
        return {
          url: jsonData.link || jsonData.url,
          metadata: {
            mime_type: jsonData.mime_type || mediaObject?.mime_type,
            size: jsonData.file_size || mediaObject?.file_size,
            filename: jsonData.filename || mediaObject?.filename,
            duration: jsonData.seconds || jsonData.duration || mediaObject?.seconds,
            id: mediaId,
          },
          storagePath: '',
        }
      }
      return null
    }

    // It's binary data, upload to Supabase Storage
    const blob = await downloadResponse.blob()
    const arrayBuffer = await blob.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Get workspace ID for storage path
    const { data: channel } = await supabase
      .from('channels')
      .select('workspace_id')
      .eq('id', channelId)
      .single()

    if (!channel) {
      console.log('[Webhook Processor] Channel not found for storage upload')
      return null
    }

    // Generate filename and path
    const extension = getExtensionFromMimeType(contentType)
    const filename = `${mediaId}${extension}`
    const storagePath = `workspaces/${channel.workspace_id}/${messageType}/${filename}`

    console.log('[Webhook Processor] Uploading media to storage:', storagePath)

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('media')
      .upload(storagePath, buffer, {
        contentType,
        upsert: true,
      })

    if (uploadError) {
      console.error('[Webhook Processor] Storage upload failed:', uploadError)
      return null
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('media')
      .getPublicUrl(storagePath)

    console.log('[Webhook Processor] Media stored successfully:', urlData.publicUrl)

    return {
      url: urlData.publicUrl,
      metadata: {
        mime_type: contentType,
        size: buffer.length,
        filename: mediaObject?.filename || filename,
        duration: mediaObject?.seconds || mediaObject?.duration,
        width: mediaObject?.width,
        height: mediaObject?.height,
        id: mediaId,
        stored: true,
      },
      storagePath,
    }
  } catch (error) {
    console.error('[Webhook Processor] Error in downloadAndStoreMedia:', error)
    return null
  }
}

/**
 * Force download media from a URL and store in Supabase Storage
 * Used for view-once messages where the URL expires quickly
 */
async function forceDownloadAndStore(
  supabase: SupabaseClient,
  channelId: string,
  workspaceId: string,
  mediaUrl: string,
  messageType: string,
  existingMetadata: Record<string, any> | null
): Promise<{ url: string; metadata: Record<string, any>; storagePath: string } | null> {
  try {
    console.log('[Webhook Processor] Force downloading view-once media from:', mediaUrl.slice(0, 100))

    // Download the media from the URL
    const downloadResponse = await fetch(mediaUrl, {
      method: 'GET',
      headers: {
        'Accept': '*/*',
      },
    })

    if (!downloadResponse.ok) {
      console.log('[Webhook Processor] View-once media download failed:', downloadResponse.status)
      return null
    }

    const contentType = downloadResponse.headers.get('content-type') || existingMetadata?.mime_type || 'application/octet-stream'

    // Get the binary data
    const blob = await downloadResponse.blob()
    const arrayBuffer = await blob.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    if (buffer.length === 0) {
      console.log('[Webhook Processor] Downloaded view-once media is empty')
      return null
    }

    // Generate unique filename using timestamp and random string
    const timestamp = Date.now()
    const randomStr = Math.random().toString(36).substring(2, 10)
    const extension = getExtensionFromMimeType(contentType)
    const filename = `viewonce_${timestamp}_${randomStr}${extension}`
    const storagePath = `workspaces/${workspaceId}/viewonce/${filename}`

    console.log('[Webhook Processor] Uploading view-once media to storage:', storagePath, 'Size:', buffer.length)

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('media')
      .upload(storagePath, buffer, {
        contentType,
        upsert: true,
      })

    if (uploadError) {
      console.error('[Webhook Processor] View-once storage upload failed:', uploadError)
      return null
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('media')
      .getPublicUrl(storagePath)

    console.log('[Webhook Processor] View-once media stored successfully:', urlData.publicUrl)

    return {
      url: urlData.publicUrl,
      metadata: {
        ...existingMetadata,
        mime_type: contentType,
        size: buffer.length,
        stored: true,
        is_view_once: true,
        original_url: mediaUrl,
      },
      storagePath,
    }
  } catch (error) {
    console.error('[Webhook Processor] Error in forceDownloadAndStore:', error)
    return null
  }
}

/**
 * Get file extension from MIME type
 */
function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/3gpp': '.3gp',
    'audio/ogg': '.ogg',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/amr': '.amr',
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  }
  return mimeToExt[mimeType] || ''
}

/**
 * Extract media information from message data
 * Handles various Whapi formats for images, videos, audio, documents
 */
function extractMediaInfo(
  messageData: any,
  messageType: string
): { url: string; metadata: Record<string, any> } | null {
  // Debug logging for media extraction
  const mediaRelatedKeys = ['media', 'mediaUrl', 'image', 'video', 'audio', 'voice', 'ptt', 'document', 'sticker']
  const foundKeys = mediaRelatedKeys.filter(key => messageData[key])
  if (foundKeys.length > 0) {
    console.log('[Webhook Processor] Media extraction - found keys:', foundKeys)
    console.log('[Webhook Processor] Media extraction - messageType:', messageType)
    foundKeys.forEach(key => {
      const obj = messageData[key]
      if (typeof obj === 'object') {
        console.log(`[Webhook Processor] ${key} object:`, JSON.stringify(obj).slice(0, 500))
      } else {
        console.log(`[Webhook Processor] ${key} value:`, obj)
      }
    })
  }

  // First check for generic media object
  if (messageData.media?.url || messageData.media?.link) {
    return {
      url: messageData.media.url || messageData.media.link,
      metadata: {
        mime_type: messageData.media.mime_type || messageData.media.mimetype,
        size: messageData.media.size || messageData.media.filesize,
        filename: messageData.media.filename,
        width: messageData.media.width,
        height: messageData.media.height,
        duration: messageData.media.duration,
      },
    }
  }

  // Check for mediaUrl directly
  if (messageData.mediaUrl) {
    return {
      url: messageData.mediaUrl,
      metadata: {
        mime_type: messageData.mime_type || messageData.mimetype,
      },
    }
  }

  // Check type-specific media objects (Whapi format)
  const mediaObject =
    messageData.image ||
    messageData.video ||
    messageData.audio ||
    messageData.voice ||
    messageData.ptt ||
    messageData.document ||
    messageData.sticker

  if (mediaObject) {
    // Whapi can send URL in various fields
    const url =
      mediaObject.link ||
      mediaObject.url ||
      mediaObject.media_url ||
      mediaObject.file_url

    if (url) {
      return {
        url,
        metadata: {
          mime_type: mediaObject.mime_type || mediaObject.mimetype,
          size: mediaObject.size || mediaObject.filesize || mediaObject.file_size,
          filename: mediaObject.filename || mediaObject.file_name,
          width: mediaObject.width,
          height: mediaObject.height,
          duration: mediaObject.duration || mediaObject.seconds,
          id: mediaObject.id,
        },
      }
    }
  }

  // For view-once messages, the media might be in a nested structure
  if (messageData.is_view_once || messageData.viewOnce) {
    const viewOnceMedia =
      messageData.viewOnceMessage?.image ||
      messageData.viewOnceMessage?.video ||
      messageData.ephemeral?.image ||
      messageData.ephemeral?.video

    if (viewOnceMedia) {
      const url = viewOnceMedia.link || viewOnceMedia.url
      if (url) {
        return {
          url,
          metadata: {
            mime_type: viewOnceMedia.mime_type || viewOnceMedia.mimetype,
            size: viewOnceMedia.size,
            width: viewOnceMedia.width,
            height: viewOnceMedia.height,
            is_view_once: true,
          },
        }
      }
    }
  }

  return null
}

/**
 * Map Whapi message status to our status enum
 */
function mapWhapiStatus(status: string | number | undefined): string | null {
  if (status === undefined || status === null) return null

  // Handle numeric ack values
  if (typeof status === 'number') {
    switch (status) {
      case 0:
        return 'pending'
      case 1:
        return 'sent'
      case 2:
        return 'delivered'
      case 3:
        return 'read'
      case 4:
        return 'read' // played (for audio)
      default:
        return null
    }
  }

  // Handle string status values
  const statusStr = String(status).toLowerCase()
  switch (statusStr) {
    case 'pending':
    case 'clock':
      return 'pending'
    case 'sent':
    case 'server':
      return 'sent'
    case 'delivered':
    case 'device':
      return 'delivered'
    case 'read':
    case 'seen':
    case 'played':
      return 'read'
    case 'failed':
    case 'error':
      return 'failed'
    default:
      return null
  }
}

/**
 * Map Whapi channel status to our status enum
 */
function mapChannelStatus(status: string | undefined): string | null {
  if (!status) return null

  const statusStr = String(status).toLowerCase()
  switch (statusStr) {
    case 'connected':
    case 'open':
    case 'ready':
      return 'active'
    case 'disconnected':
    case 'closed':
      return 'disconnected'
    case 'qr':
    case 'scan':
      return 'needs_reauth'
    case 'loading':
    case 'connecting':
      return 'active'
    default:
      return null
  }
}
