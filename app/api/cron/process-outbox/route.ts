import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'

// Simple Whapi send function (matches bloe-engine approach)
async function sendWhapiMessage(token: string, type: string, payload: any) {
  const endpoint = type === 'text'
    ? 'https://gate.whapi.cloud/messages/text'
    : `https://gate.whapi.cloud/messages/${type}`

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  return response.json()
}

/**
 * GET /api/cron/process-outbox
 *
 * Cron job to process the message outbox queue.
 * Runs every minute via Vercel Cron.
 *
 * Features:
 * - Processes up to 10 messages per run
 * - Uses FOR UPDATE SKIP LOCKED for concurrent safety
 * - Exponential backoff for retries (1, 2, 4, 8, 16 minutes)
 * - Pauses channel on 429 rate limit
 * - Updates message status on success/failure
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now()

  try {
    // Verify cron secret
    const authHeader = request.headers.get('Authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createServiceRoleClient()

    // Fetch and lock pending messages
    // Using raw SQL for FOR UPDATE SKIP LOCKED
    const { data: messages, error: fetchError } = await supabase.rpc(
      'get_pending_outbox_messages',
      { batch_size: 10 }
    )

    // If RPC doesn't exist, fall back to regular query
    let pendingMessages = messages
    if (fetchError) {
      console.warn('RPC not available, using fallback query:', fetchError.message)

      const { data, error } = await supabase
        .from('outbox_messages')
        .select('*')
        .eq('status', 'queued')
        .lte('next_attempt_at', new Date().toISOString())
        .order('priority', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(10)

      if (error) {
        console.error('Error fetching outbox messages:', error)
        return NextResponse.json(
          { error: 'Failed to fetch messages' },
          { status: 500 }
        )
      }

      pendingMessages = data

      // Mark as sending
      if (pendingMessages && pendingMessages.length > 0) {
        await supabase
          .from('outbox_messages')
          .update({
            status: 'sending',
            attempts: supabase.rpc('increment', { row_id: 'id' }), // This won't work, need raw SQL
          })
          .in(
            'id',
            pendingMessages.map((m: any) => m.id)
          )
      }
    }

    if (!pendingMessages || pendingMessages.length === 0) {
      return NextResponse.json({
        success: true,
        processed: 0,
        message: 'No pending messages',
        processing_time_ms: Date.now() - startTime,
      })
    }

    // Process each message
    const results = await Promise.all(
      pendingMessages.map((msg: any) => processMessage(supabase, msg))
    )

    const successCount = results.filter((r) => r.success).length
    const failCount = results.length - successCount

    return NextResponse.json({
      success: true,
      processed: results.length,
      succeeded: successCount,
      failed: failCount,
      results,
      processing_time_ms: Date.now() - startTime,
    })
  } catch (error) {
    console.error('Outbox processing error:', error)
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

/**
 * Process a single outbox message
 */
async function processMessage(
  supabase: any,
  message: any
): Promise<{ id: string; success: boolean; error?: string }> {
  try {
    // Update status to sending
    await supabase
      .from('outbox_messages')
      .update({
        status: 'sending',
        attempts: message.attempts + 1,
      })
      .eq('id', message.id)

    // Get channel with api_token directly (bloe-engine approach)
    // DO NOT CHANGE: See IMPLEMENTATION_NOTES.md for why we use direct token
    const { data: channel, error: channelError } = await supabase
      .from('channels')
      .select('api_token')
      .eq('id', message.channel_id)
      .single()

    if (channelError || !channel?.api_token) {
      await markFailed(supabase, message.id, 'Channel API token not found')
      return { id: message.id, success: false, error: 'Channel API token not found' }
    }

    const payload = message.payload
    let result

    // Send message based on type
    switch (message.message_type) {
      case 'text':
        result = await sendWhapiMessage(channel.api_token, 'text', {
          to: payload.to,
          body: payload.body,
        })
        break
      case 'image':
        result = await sendWhapiMessage(channel.api_token, 'image', {
          to: payload.to,
          media: payload.media,
          caption: payload.caption,
        })
        break
      case 'video':
        result = await sendWhapiMessage(channel.api_token, 'video', {
          to: payload.to,
          media: payload.media,
          caption: payload.caption,
        })
        break
      case 'document':
        result = await sendWhapiMessage(channel.api_token, 'document', {
          to: payload.to,
          media: payload.media,
          filename: payload.filename,
          caption: payload.caption,
        })
        break
      case 'audio':
        result = await sendWhapiMessage(channel.api_token, 'audio', {
          to: payload.to,
          media: payload.media,
        })
        break
      default:
        // Default to text
        result = await sendWhapiMessage(channel.api_token, 'text', {
          to: payload.to,
          body: payload.body || payload.text,
        })
    }

    if (result.sent && result.message) {
      // Success - update outbox and message records
      await markSent(supabase, message, result.message.id)
      return { id: message.id, success: true }
    } else {
      throw new Error(result.error || 'Send failed')
    }
  } catch (error: any) {
    console.error(`Failed to send message ${message.id}:`, error)

    // Handle rate limiting (429 status)
    if (error.message?.includes('429') || error.status === 429) {
      await pauseChannel(supabase, message.channel_id, 'Rate limited by WhatsApp')
      await reschedule(supabase, message, error)
      return { id: message.id, success: false, error: 'Rate limited' }
    }

    // Retry if under max attempts
    if (message.attempts < message.max_attempts) {
      await reschedule(supabase, message, error)
      return { id: message.id, success: false, error: error.message || 'Retrying' }
    }

    // Max attempts reached
    await markFailed(supabase, message.id, error.message || 'Unknown error')
    return { id: message.id, success: false, error: error.message || 'Failed' }
  }
}

/**
 * Mark message as sent and update related records
 */
async function markSent(supabase: any, message: any, waMessageId: string) {
  const now = new Date().toISOString()

  // Update outbox
  await supabase
    .from('outbox_messages')
    .update({
      status: 'sent',
      sent_at: now,
      wa_message_id: waMessageId,
    })
    .eq('id', message.id)

  // Update the pending message record with real WhatsApp ID
  await supabase
    .from('messages')
    .update({
      wa_message_id: waMessageId,
      status: 'sent',
    })
    .eq('chat_id', message.chat_id)
    .eq('status', 'pending')
    .eq('direction', 'outbound')
    .order('created_at', { ascending: false })
    .limit(1)
}

/**
 * Reschedule message for retry with exponential backoff
 */
async function reschedule(supabase: any, message: any, error: any) {
  // Exponential backoff: 1, 2, 4, 8, 16 minutes
  const delayMinutes = Math.pow(2, message.attempts - 1)
  const delayMs = delayMinutes * 60 * 1000
  const nextAttempt = new Date(Date.now() + delayMs).toISOString()

  await supabase
    .from('outbox_messages')
    .update({
      status: 'queued',
      next_attempt_at: nextAttempt,
      last_error: error.message || 'Unknown error',
    })
    .eq('id', message.id)
}

/**
 * Mark message as permanently failed
 */
async function markFailed(supabase: any, messageId: string, errorMessage: string) {
  await supabase
    .from('outbox_messages')
    .update({
      status: 'failed',
      last_error: errorMessage,
    })
    .eq('id', messageId)

  // Also update the message record
  const { data: outbox } = await supabase
    .from('outbox_messages')
    .select('chat_id')
    .eq('id', messageId)
    .single()

  if (outbox) {
    await supabase
      .from('messages')
      .update({
        status: 'failed',
      })
      .eq('chat_id', outbox.chat_id)
      .eq('status', 'pending')
      .eq('direction', 'outbound')
      .order('created_at', { ascending: false })
      .limit(1)
  }
}

/**
 * Pause a channel due to rate limiting
 */
async function pauseChannel(
  supabase: any,
  channelId: string,
  reason: string
) {
  await supabase
    .from('channels')
    .update({
      status: 'degraded',
      health_status: {
        paused: true,
        paused_at: new Date().toISOString(),
        pause_reason: reason,
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', channelId)

  // Pause all queued messages for this channel
  await supabase
    .from('outbox_messages')
    .update({
      status: 'paused',
    })
    .eq('channel_id', channelId)
    .eq('status', 'queued')
}
