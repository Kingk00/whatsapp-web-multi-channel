/**
 * Bot Router
 *
 * Routes inbound messages through Bloe Engine AI bot based on channel configuration.
 * Supports four modes: full, semi, watching, off
 *
 * - full: Bot auto-sends replies
 * - semi: Bot pre-generates drafts for admin approval
 * - watching: Bot observes and learns (no action)
 * - off: Bot disabled
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/encryption'

// ============================================================================
// Types
// ============================================================================

export interface BotConfig {
  bot_mode: 'full' | 'semi' | 'watching' | 'off'
  bloe_api_url: string
  bloe_api_key_encrypted: string | null
  bloe_provider_id: string | null
  auto_reply_start_minutes: number | null
  auto_reply_end_minutes: number | null
  auto_reply_timezone: string
  auto_pause_on_escalate: boolean
  reply_delay_ms: number
}

export interface BotResponse {
  action: 'REPLY' | 'ESCALATE' | 'IGNORE' | 'WAIT'
  reply_text?: string
  intent?: string
  confidence?: number
  reply_delay_ms?: number
  escalate_reason?: string
}

export interface MessageContext {
  channelId: string
  workspaceId: string
  chatId: string
  contactId: string
  messageId: string
  messageText: string
  messageType: string
  timestamp?: string
}

export interface BotRoutingResult {
  handled: boolean
  response?: BotResponse
  error?: string
}

// ============================================================================
// API Key Decryption
// ============================================================================

async function decryptApiKey(encrypted: string): Promise<string> {
  console.log('[Bot Router] decryptApiKey input:', {
    exists: !!encrypted,
    length: encrypted?.length,
    hasColons: encrypted?.includes(':'),
    colonCount: encrypted?.split(':').length,
    preview: encrypted?.substring(0, 20) + '...',
  })

  // If it looks like an encrypted string (contains colons from our format), decrypt it
  // Format: salt:iv:authTag:encryptedData
  if (encrypted && encrypted.includes(':') && encrypted.split(':').length === 4) {
    try {
      const decrypted = decrypt(encrypted)
      console.log('[Bot Router] Decrypted API key:', {
        length: decrypted.length,
        preview: decrypted.substring(0, 8) + '***',
      })
      return decrypted
    } catch (error) {
      console.error('[Bot Router] Failed to decrypt API key, using as-is:', error)
      return encrypted
    }
  }
  // Otherwise return as-is (plaintext key for development)
  console.log('[Bot Router] Using plaintext API key (not encrypted format)')
  return encrypted
}

// ============================================================================
// Time Range Check
// ============================================================================

function isWithinAutoReplyHours(config: BotConfig): boolean {
  if (config.auto_reply_start_minutes == null || config.auto_reply_end_minutes == null) {
    return true // No hours configured = 24/7
  }

  const now = new Date()
  const tz = config.auto_reply_timezone || 'America/Sao_Paulo'

  // Get current time in configured timezone as minutes since midnight
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  })
  const parts = formatter.formatToParts(now)
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0')
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0')
  const currentMinutes = hour * 60 + minute

  const start = config.auto_reply_start_minutes
  const end = config.auto_reply_end_minutes

  // Handle overnight ranges (e.g., 22:00 - 06:00)
  const inRange =
    start <= end
      ? currentMinutes >= start && currentMinutes <= end
      : currentMinutes >= start || currentMinutes <= end

  return inRange
}

// ============================================================================
// Should Bot Process
// ============================================================================

/**
 * Check if bot should process this message based on channel config and chat state
 */
export async function shouldBotProcess(
  supabase: SupabaseClient,
  channelId: string,
  chatId: string
): Promise<{ should: boolean; config: BotConfig | null }> {
  // Get bot config for channel
  const { data: config, error: configError } = await supabase
    .from('channel_bot_config')
    .select('*')
    .eq('channel_id', channelId)
    .single()

  if (configError || !config || config.bot_mode === 'off') {
    console.log('[Bot Router] shouldBotProcess: No config or bot off', {
      hasConfig: !!config,
      mode: config?.bot_mode,
      error: configError?.message
    })
    return { should: false, config: null }
  }

  console.log('[Bot Router] shouldBotProcess: Config found', {
    mode: config.bot_mode,
    provider_id: config.bloe_provider_id,
    api_url: config.bloe_api_url,
    has_api_key: !!config.bloe_api_key_encrypted,
  })

  // Check chat-level pause
  const { data: chat } = await supabase
    .from('chats')
    .select('bot_paused')
    .eq('id', chatId)
    .single()

  if (chat?.bot_paused) {
    return { should: false, config }
  }

  // Check auto-reply hours
  if (!isWithinAutoReplyHours(config)) {
    console.log('[Bot Router] Outside auto-reply hours, skipping')
    return { should: false, config }
  }

  return { should: true, config }
}

// ============================================================================
// Idempotency
// ============================================================================

/**
 * Check and mark message as being processed (idempotency with TTL)
 */
async function checkAndMarkProcessing(
  supabase: SupabaseClient,
  channelId: string,
  messageId: string
): Promise<boolean> {
  // Clean up expired 'processing' entries (allows retry after TTL)
  await supabase
    .from('bot_processed_messages')
    .delete()
    .eq('channel_id', channelId)
    .eq('wa_message_id', messageId)
    .eq('status', 'processing')
    .lt('expires_at', new Date().toISOString())

  // Try to insert with 'processing' status and 5-minute TTL
  const { error } = await supabase.from('bot_processed_messages').insert({
    channel_id: channelId,
    wa_message_id: messageId,
    status: 'processing',
    expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  })

  // If insert fails (duplicate), message already being processed or completed
  return !error
}

async function markCompleted(supabase: SupabaseClient, channelId: string, messageId: string) {
  await supabase
    .from('bot_processed_messages')
    .update({ status: 'completed' })
    .eq('channel_id', channelId)
    .eq('wa_message_id', messageId)
}

async function markFailed(supabase: SupabaseClient, channelId: string, messageId: string) {
  // Delete the entry to allow retry
  await supabase
    .from('bot_processed_messages')
    .delete()
    .eq('channel_id', channelId)
    .eq('wa_message_id', messageId)
}

// ============================================================================
// Learning Log
// ============================================================================

/**
 * Log bot interaction for learning (all active modes)
 */
async function logBotInteraction(
  supabase: SupabaseClient,
  context: MessageContext,
  response: BotResponse
): Promise<string | null> {
  const { data } = await supabase
    .from('bot_learning_log')
    .insert({
      channel_id: context.channelId,
      chat_id: context.chatId,
      inbound_message_id: context.messageId,
      inbound_text: context.messageText,
      detected_intent: response.intent,
      confidence: response.confidence,
      suggested_action: response.action,
      suggested_reply: response.reply_text,
      escalate_reason: response.escalate_reason,
    })
    .select('id')
    .single()

  return data?.id || null
}

// ============================================================================
// Response Handling
// ============================================================================

/**
 * Handle bot response based on mode
 */
async function handleBotResponse(
  supabase: SupabaseClient,
  context: MessageContext,
  config: BotConfig,
  response: BotResponse,
  learningLogId: string | null
) {
  // WATCHING mode: just log, no action
  if (config.bot_mode === 'watching') {
    console.log('[Bot Router] Watching mode - logged only, no action')
    return
  }

  switch (response.action) {
    case 'REPLY':
      if (!response.reply_text) return

      if (config.bot_mode === 'full') {
        // Re-check bot_paused before queueing (race condition protection)
        const { data: chat } = await supabase
          .from('chats')
          .select('bot_paused')
          .eq('id', context.chatId)
          .single()

        if (chat?.bot_paused) {
          console.log('[Bot Router] Bot paused during processing, skipping auto-reply')
          return
        }

        // Queue to outbox_messages
        const delay = response.reply_delay_ms || config.reply_delay_ms || 1500

        await supabase.from('outbox_messages').insert({
          workspace_id: context.workspaceId,
          channel_id: context.channelId,
          chat_id: context.chatId,
          message_type: 'text',
          payload: { body: response.reply_text },
          status: 'queued',
          next_attempt_at: new Date(Date.now() + delay).toISOString(),
          metadata: {
            bot_generated: true,
            intent: response.intent,
            confidence: response.confidence,
            learning_log_id: learningLogId,
          },
        })

        console.log('[Bot Router] Full mode - queued reply to outbox')
      } else if (config.bot_mode === 'semi') {
        // Store draft for admin approval
        await supabase.from('chat_drafts').upsert(
          {
            chat_id: context.chatId,
            learning_log_id: learningLogId,
            draft_text: response.reply_text,
            intent: response.intent,
            confidence: response.confidence,
            source_message_id: context.messageId,
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          },
          { onConflict: 'chat_id' }
        )

        console.log('[Bot Router] Semi mode - stored draft for approval')
      }
      break

    case 'ESCALATE':
      // Pause bot for this chat if configured
      if (config.auto_pause_on_escalate) {
        await supabase.from('chats').update({ bot_paused: true }).eq('id', context.chatId)

        console.log('[Bot Router] Escalated - paused bot for this chat')
      }
      break

    case 'IGNORE':
    case 'WAIT':
      console.log(`[Bot Router] ${response.action} - no action taken`)
      break
  }
}

// ============================================================================
// Main Router Function
// ============================================================================

/**
 * Route message through bot
 */
export async function routeThroughBot(
  supabase: SupabaseClient,
  context: MessageContext,
  config: BotConfig
): Promise<BotRoutingResult> {
  // Only text messages for now
  if (context.messageType !== 'text') {
    console.log('[Bot Router] Non-text message, skipping')
    return { handled: false }
  }

  if (!config.bloe_api_key_encrypted || !config.bloe_provider_id) {
    console.error('[Bot Router] Missing API key or provider ID in config')
    return { handled: false, error: 'Bot config incomplete' }
  }

  // Idempotency check
  const canProcess = await checkAndMarkProcessing(supabase, context.channelId, context.messageId)
  if (!canProcess) {
    console.log('[Bot Router] Message already being processed, skipping')
    return { handled: true }
  }

  try {
    console.log('[Bot Router] Calling bot API:', {
      url: config.bloe_api_url,
      provider_id: config.bloe_provider_id,
      mode: config.bot_mode,
      message_preview: context.messageText.substring(0, 50),
    })

    // Decrypt API key
    const apiKey = await decryptApiKey(config.bloe_api_key_encrypted)

    // Call Bloe Engine with 10s timeout
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    const response = await fetch(`${config.bloe_api_url}/api/bot/handle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bot-API-Key': apiKey,
      },
      body: JSON.stringify({
        channel_id: context.channelId,
        chat_id: context.chatId,
        contact_id: context.contactId,
        message_id: context.messageId,
        message_text: context.messageText,
        message_type: context.messageType,
        timestamp: context.timestamp,
        provider_id: config.bloe_provider_id,
      }),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[Bot Router] Bot API error:', response.status, errorText)
      throw new Error(`Bot API error: ${response.status} - ${errorText}`)
    }

    const botResponse: BotResponse = await response.json()

    console.log('[Bot Router] Bot response:', JSON.stringify(botResponse))

    // Log for learning (all modes except off)
    const learningLogId = await logBotInteraction(supabase, context, botResponse)

    // Handle based on mode
    await handleBotResponse(supabase, context, config, botResponse, learningLogId)

    await markCompleted(supabase, context.channelId, context.messageId)

    return { handled: true, response: botResponse }
  } catch (error) {
    console.error('[Bot Router] Error:', error)
    await markFailed(supabase, context.channelId, context.messageId)

    return {
      handled: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

// ============================================================================
// Convenience Function for Webhook Processor
// ============================================================================

/**
 * Process message through bot if configured
 * Call this from webhook-processor after saving inbound message
 */
export async function processThroughBotIfConfigured(
  supabase: SupabaseClient,
  channelId: string,
  workspaceId: string,
  chatId: string,
  messageId: string,
  messageText: string,
  messageType: string,
  contactId: string,
  timestamp?: string
): Promise<BotRoutingResult> {
  // Check if bot should process
  const { should, config } = await shouldBotProcess(supabase, channelId, chatId)

  if (!should || !config) {
    return { handled: false }
  }

  console.log('[Bot Router] Processing message, mode:', config.bot_mode)

  // Route through bot
  return routeThroughBot(
    supabase,
    {
      channelId,
      workspaceId,
      chatId,
      messageId,
      messageText,
      messageType,
      contactId,
      timestamp,
    },
    config
  )
}
