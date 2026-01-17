/**
 * Learning Module
 *
 * Tracks bot draft edits and approvals for training/learning purposes.
 * Used in semi mode to capture how admins modify bot suggestions.
 * Sends corrections to bloe-engine so the bot learns from edits.
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/encryption'

// ============================================================================
// Types
// ============================================================================

export interface ChatDraft {
  id: string
  chat_id: string
  learning_log_id: string | null
  draft_text: string
  intent: string | null
  confidence: number | null
  source_message_id: string
  created_at: string
  expires_at: string
}

export interface EditDelta {
  original_length: number
  final_length: number
  was_modified: boolean
  kept_original: boolean
}

// ============================================================================
// Draft Operations
// ============================================================================

/**
 * Get the current draft for a chat
 */
export async function getChatDraft(
  supabase: SupabaseClient,
  chatId: string
): Promise<ChatDraft | null> {
  const { data, error } = await supabase
    .from('chat_drafts')
    .select('*')
    .eq('chat_id', chatId)
    .single()

  if (error || !data) {
    return null
  }

  return data as ChatDraft
}

/**
 * Clear/dismiss a draft without sending
 */
export async function dismissDraft(
  supabase: SupabaseClient,
  chatId: string
): Promise<void> {
  // Get draft to update learning log
  const draft = await getChatDraft(supabase, chatId)

  if (draft?.learning_log_id) {
    // Mark as not approved in learning log
    await supabase
      .from('bot_learning_log')
      .update({ was_approved: false })
      .eq('id', draft.learning_log_id)
  }

  // Delete the draft
  await supabase.from('chat_drafts').delete().eq('chat_id', chatId)
}

// ============================================================================
// Edit Tracking
// ============================================================================

/**
 * Decrypt API key if encrypted
 */
async function decryptApiKey(encrypted: string): Promise<string> {
  if (encrypted && encrypted.includes(':') && encrypted.split(':').length === 4) {
    try {
      return decrypt(encrypted)
    } catch {
      return encrypted
    }
  }
  return encrypted
}

/**
 * Send correction to bloe-engine so it learns from the edit
 */
async function sendCorrectionToBloe(
  supabase: SupabaseClient,
  channelId: string,
  providerId: string,
  originalMessage: string,
  wrongResponse: string,
  correctResponse: string
): Promise<boolean> {
  try {
    // Get bot config for this channel
    const { data: config } = await supabase
      .from('channel_bot_config')
      .select('bloe_api_url, bloe_api_key_encrypted')
      .eq('channel_id', channelId)
      .single()

    if (!config?.bloe_api_url || !config?.bloe_api_key_encrypted) {
      console.log('[Learning] No bot config, skipping correction sync')
      return false
    }

    const apiKey = await decryptApiKey(config.bloe_api_key_encrypted)

    // Send correction to bloe-engine
    const response = await fetch(`${config.bloe_api_url}/api/bot/learn`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bot-API-Key': apiKey,
      },
      body: JSON.stringify({
        provider_id: providerId,
        original_message: originalMessage,
        wrong_response: wrongResponse,
        correct_response: correctResponse,
      }),
    })

    if (response.ok) {
      const result = await response.json()
      console.log('[Learning] Correction sent to bloe-engine:', result.correction_id)
      return true
    } else {
      console.error('[Learning] Failed to send correction:', response.status)
      return false
    }
  } catch (error) {
    console.error('[Learning] Error sending correction:', error)
    return false
  }
}

/**
 * Log when a draft is edited before sending
 * This captures training data for improving bot responses
 */
export async function logDraftEdit(
  supabase: SupabaseClient,
  learningLogId: string,
  originalText: string,
  finalText: string,
  draftCreatedAt: string
): Promise<void> {
  // Calculate edit delta
  const editDelta: EditDelta = {
    original_length: originalText.length,
    final_length: finalText.length,
    was_modified: originalText !== finalText,
    kept_original: originalText === finalText,
  }

  // Calculate response time
  const createdAt = new Date(draftCreatedAt)
  const responseTimeMs = Date.now() - createdAt.getTime()

  // Update learning log by ID (direct link, not text matching)
  await supabase
    .from('bot_learning_log')
    .update({
      actual_reply_text: finalText,
      was_edited: originalText !== finalText,
      edit_delta: editDelta,
      was_approved: true,
      responded_at: new Date().toISOString(),
      response_time_ms: responseTimeMs,
    })
    .eq('id', learningLogId)
}

/**
 * Process sending a message when a draft was applied
 * Call this when user sends a message after applying a bot draft
 * If the draft was edited, sends correction to bloe-engine so it learns
 */
export async function processDraftSend(
  supabase: SupabaseClient,
  chatId: string,
  finalText: string
): Promise<{ hadDraft: boolean; wasEdited: boolean; correctionSent: boolean }> {
  // Get current draft
  const draft = await getChatDraft(supabase, chatId)

  if (!draft) {
    return { hadDraft: false, wasEdited: false, correctionSent: false }
  }

  const wasEdited = draft.draft_text !== finalText

  // Log the edit if there's a learning log ID
  if (draft.learning_log_id) {
    await logDraftEdit(
      supabase,
      draft.learning_log_id,
      draft.draft_text,
      finalText,
      draft.created_at
    )
  }

  // If edited, send correction to bloe-engine so it learns
  let correctionSent = false
  if (wasEdited && draft.learning_log_id) {
    try {
      // Get learning log to find original message and provider
      const { data: learningLog } = await supabase
        .from('bot_learning_log')
        .select('channel_id, inbound_text')
        .eq('id', draft.learning_log_id)
        .single()

      if (learningLog?.channel_id && learningLog?.inbound_text) {
        // Get provider ID from bot config
        const { data: botConfig } = await supabase
          .from('channel_bot_config')
          .select('bloe_provider_id')
          .eq('channel_id', learningLog.channel_id)
          .single()

        if (botConfig?.bloe_provider_id) {
          correctionSent = await sendCorrectionToBloe(
            supabase,
            learningLog.channel_id,
            botConfig.bloe_provider_id,
            learningLog.inbound_text,  // Original customer message
            draft.draft_text,          // Bot's wrong suggestion
            finalText                  // Admin's corrected response
          )
        }
      }
    } catch (error) {
      console.error('[Learning] Failed to send correction:', error)
    }
  }

  // Clear the draft
  await supabase.from('chat_drafts').delete().eq('chat_id', chatId)

  return {
    hadDraft: true,
    wasEdited,
    correctionSent,
  }
}

// ============================================================================
// Analytics Queries
// ============================================================================

/**
 * Get learning statistics for a channel
 */
export async function getChannelLearningStats(
  supabase: SupabaseClient,
  channelId: string
): Promise<{
  totalInteractions: number
  approvedCount: number
  editedCount: number
  escalatedCount: number
  avgConfidence: number
  topIntents: { intent: string; count: number }[]
}> {
  // Get all learning log entries for this channel
  const { data: logs } = await supabase
    .from('bot_learning_log')
    .select('*')
    .eq('channel_id', channelId)

  if (!logs || logs.length === 0) {
    return {
      totalInteractions: 0,
      approvedCount: 0,
      editedCount: 0,
      escalatedCount: 0,
      avgConfidence: 0,
      topIntents: [],
    }
  }

  // Calculate stats
  const totalInteractions = logs.length
  const approvedCount = logs.filter((l) => l.was_approved === true).length
  const editedCount = logs.filter((l) => l.was_edited === true).length
  const escalatedCount = logs.filter((l) => l.was_escalated === true).length

  // Average confidence (only for entries with confidence)
  const withConfidence = logs.filter((l) => l.confidence != null)
  const avgConfidence =
    withConfidence.length > 0
      ? withConfidence.reduce((sum, l) => sum + l.confidence, 0) / withConfidence.length
      : 0

  // Count intents
  const intentCounts: Record<string, number> = {}
  logs.forEach((l) => {
    if (l.detected_intent) {
      intentCounts[l.detected_intent] = (intentCounts[l.detected_intent] || 0) + 1
    }
  })

  const topIntents = Object.entries(intentCounts)
    .map(([intent, count]) => ({ intent, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  return {
    totalInteractions,
    approvedCount,
    editedCount,
    escalatedCount,
    avgConfidence,
    topIntents,
  }
}

/**
 * Get edit patterns to understand where bot suggestions need improvement
 */
export async function getEditPatterns(
  supabase: SupabaseClient,
  channelId: string,
  limit: number = 50
): Promise<
  {
    intent: string
    original: string
    edited: string
    confidence: number
  }[]
> {
  const { data } = await supabase
    .from('bot_learning_log')
    .select('detected_intent, suggested_reply, actual_reply_text, confidence')
    .eq('channel_id', channelId)
    .eq('was_edited', true)
    .not('actual_reply_text', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (!data) return []

  return data.map((row) => ({
    intent: row.detected_intent || 'unknown',
    original: row.suggested_reply || '',
    edited: row.actual_reply_text || '',
    confidence: row.confidence || 0,
  }))
}
