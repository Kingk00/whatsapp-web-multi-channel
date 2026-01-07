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
import { getOrCreateChat, updateChatLastMessage } from '@/lib/chat-helpers'

// ============================================================================
// Types
// ============================================================================

export interface WebhookEvent {
  event?: string | { type: string; event?: string }
  type?: string
  data?: any
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

  // Handle Whapi format where event can be an object like {"type": "messages", "event": "post"}
  let eventType: string = 'unknown'
  if (typeof event.event === 'object' && event.event?.type) {
    eventType = event.event.type
  } else if (typeof event.event === 'string') {
    eventType = event.event
  } else if (event.type) {
    eventType = event.type
  }

  console.log('[Webhook Processor] Event type:', eventType, 'Full event keys:', Object.keys(event))

  try {
    switch (eventType) {
      case 'message':
      case 'messages':
        return await processMessageEvent(supabase, channel, event)

      case 'message.status':
      case 'ack':
      case 'acks':
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
          details: { reason: `Unknown event type: ${eventType}` },
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

    // Extract media info if present - handle various Whapi formats
    const mediaInfo = extractMediaInfo(messageData, messageType)
    const mediaUrl = mediaInfo?.url || null
    const mediaMetadata = mediaInfo?.metadata || null

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
    const messageRecord = {
      workspace_id: channel.workspace_id,
      channel_id: channel.id,
      chat_id: chat.id,
      wa_message_id: waMessageId,
      direction: direction,
      message_type: messageType,
      text: textContent,
      media_url: mediaUrl,
      media_metadata: mediaMetadata,
      is_view_once: messageData.is_view_once ?? messageData.viewOnce ?? false,
      status: direction === 'outbound' ? (messageData.status || 'sent') : null,
      sender_wa_id: senderWaId,
      sender_name: senderName,
      created_at: timestamp,
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
    await updateChatLastMessage(supabase, chat.id, {
      text: textContent,
      timestamp: timestamp,
      incrementUnread: direction === 'inbound',
    })

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
    .select()

  if (error) {
    console.error('Status update error:', error)
    return {
      success: false,
      action: 'error',
      error: error.message,
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
 */
async function processEditEvent(
  supabase: SupabaseClient,
  channel: ChannelInfo,
  event: WebhookEvent
): Promise<ProcessingResult> {
  const editData = event.data || event
  const waMessageId = editData.id || editData.message_id || editData.messageId
  const newText = editData.body || editData.text || editData.newBody

  if (!waMessageId) {
    return {
      success: false,
      action: 'skip',
      error: 'Missing message ID in edit event',
    }
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
    return {
      success: false,
      action: 'error',
      error: error.message,
    }
  }

  return {
    success: true,
    action: 'message_edited',
    details: {
      wa_message_id: waMessageId,
      updated: data?.length > 0,
    },
  }
}

// ============================================================================
// Delete Event Processing
// ============================================================================

/**
 * Process message deletion events
 * Sets deleted_at timestamp instead of actually deleting
 */
async function processDeleteEvent(
  supabase: SupabaseClient,
  channel: ChannelInfo,
  event: WebhookEvent
): Promise<ProcessingResult> {
  const deleteData = event.data || event
  const waMessageId = deleteData.id || deleteData.message_id || deleteData.messageId

  if (!waMessageId) {
    return {
      success: false,
      action: 'skip',
      error: 'Missing message ID in delete event',
    }
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
    return {
      success: false,
      action: 'error',
      error: error.message,
    }
  }

  return {
    success: true,
    action: 'message_deleted',
    details: {
      wa_message_id: waMessageId,
      updated: data?.length > 0,
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
 * Extracts the channel's WhatsApp number from message data
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

    // Extract channel's WhatsApp ID
    // For inbound messages (from_me=false): 'to' is the channel's number
    // For outbound messages (from_me=true): 'from' is the channel's number
    let channelWaId: string | null = null

    if (!fromMe && messageData.to) {
      channelWaId = messageData.to
    } else if (fromMe && messageData.from) {
      channelWaId = messageData.from
    }

    if (!channelWaId) {
      console.log('[Webhook Processor] Could not extract channel phone number')
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

  // Infer from content
  if (messageData.text || messageData.body) return 'text'
  if (messageData.image) return 'image'
  if (messageData.video) return 'video'
  if (messageData.audio || messageData.voice || messageData.ptt) return 'audio'
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
 * Extract media information from message data
 * Handles various Whapi formats for images, videos, audio, documents
 */
function extractMediaInfo(
  messageData: any,
  messageType: string
): { url: string; metadata: Record<string, any> } | null {
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
      return 'stopped'
    case 'qr':
    case 'scan':
      return 'needs_reauth'
    case 'loading':
    case 'connecting':
      return 'pending_qr'
    default:
      return null
  }
}
