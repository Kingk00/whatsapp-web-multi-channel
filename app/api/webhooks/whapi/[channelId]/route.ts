import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import {
  verifyWebhookSecret,
  extractWebhookSecret,
  validateWebhookPayload,
} from '@/lib/webhook-verification'
import { processWebhookEvent } from '@/lib/webhook-processor'

// Conditional logging - only log when WEBHOOK_DEBUG=true
const DEBUG = process.env.WEBHOOK_DEBUG === 'true'
const log = DEBUG ? (...args: any[]) => console.log('[Webhook]', ...args) : () => {}

/**
 * Process webhook in background and update the log entry
 */
async function processWebhookInBackground(
  channel: any,
  payload: any,
  channelId: string,
  logEntryId: string | null
) {
  const supabase = createServiceRoleClient()

  try {
    log('Background processing started for channel:', channelId)

    const processingResult = await processWebhookEvent(channel, payload)

    // Update webhook event record with processing result (by ID, not JSONB)
    if (logEntryId) {
      await supabase
        .from('webhook_events')
        .update({
          processed_at: new Date().toISOString(),
          error: processingResult.success ? null : processingResult.error,
        })
        .eq('id', logEntryId)
    }

    log('Background processing completed:', processingResult.success ? 'success' : 'failed')
  } catch (error) {
    console.error('[Webhook] Background processing error:', error)

    // Update webhook event with error
    if (logEntryId) {
      await supabase
        .from('webhook_events')
        .update({
          processed_at: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Unknown error',
        })
        .eq('id', logEntryId)
    }
  }
}

/**
 * POST /api/webhooks/whapi/[channelId]
 *
 * Webhook endpoint to receive events from Whapi.cloud
 *
 * PERFORMANCE OPTIMIZED:
 * - Returns 200 immediately after validation
 * - Processes webhook in background (non-blocking)
 * - Uses ID-based updates instead of JSONB comparison
 *
 * Security:
 * - Each channel has a unique webhook_secret (UUID)
 * - Secret must be provided via query param (?secret=xxx) or header (X-Webhook-Secret)
 * - Whapi.cloud should be configured to include the secret in webhook URL
 *
 * Event Processing:
 * - All webhook events are logged to webhook_events table for debugging
 * - Idempotent message processing in webhook-processor.ts
 * - Uses (channel_id, wa_message_id) for deduplication, NOT event.id
 *
 * Example webhook URL to configure in Whapi.cloud:
 * https://your-app.vercel.app/api/webhooks/whapi/{channelId}?secret={webhook_secret}
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  try {
    const { channelId } = await params

    log('Received POST request, channel:', channelId)

    // Extract webhook secret from request
    const providedSecret = extractWebhookSecret(request)

    // Verify webhook secret
    const verification = await verifyWebhookSecret(channelId, providedSecret)

    if (!verification.valid) {
      log('Verification failed:', verification.error)
      return NextResponse.json(
        { error: verification.error || 'Webhook verification failed' },
        { status: 401 }
      )
    }

    // Parse webhook payload
    let payload: any
    try {
      payload = await request.json()
      log('Payload received, size:', JSON.stringify(payload).length)
    } catch (error) {
      log('JSON parse error:', error)
      return NextResponse.json(
        { error: 'Invalid JSON payload' },
        { status: 400 }
      )
    }

    // Validate payload structure
    if (!validateWebhookPayload(payload)) {
      return NextResponse.json(
        { error: 'Invalid webhook payload structure' },
        { status: 400 }
      )
    }

    // Log webhook event for debugging - get ID for background update
    const supabase = createServiceRoleClient()
    const eventType = payload.event || payload.type || 'unknown'
    let logEntryId: string | null = null

    const { data: logEntry, error: logError } = await supabase
      .from('webhook_events')
      .insert({
        channel_id: channelId,
        event_type: eventType,
        payload: payload,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (logError) {
      // Don't fail the webhook if logging fails
      log('Failed to log webhook event:', logError.message)
    } else {
      logEntryId = logEntry?.id || null
    }

    // PERFORMANCE: Return 200 immediately, process in background
    // Use setImmediate to defer processing to next tick
    setImmediate(() => {
      processWebhookInBackground(
        verification.channel!,
        payload,
        channelId,
        logEntryId
      )
    })

    // Return immediately - processing continues in background
    return NextResponse.json(
      {
        status: 'accepted',
        message: 'Webhook queued for processing',
        channel_id: channelId,
        event_type: eventType,
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('[Webhook] Request handling error:', error)

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
 * GET /api/webhooks/whapi/[channelId]
 *
 * Health check endpoint for webhook configuration
 * Returns channel info if secret is valid
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  try {
    const { channelId } = await params

    // Extract webhook secret from request
    const providedSecret = extractWebhookSecret(request)

    // Verify webhook secret
    const verification = await verifyWebhookSecret(channelId, providedSecret)

    if (!verification.valid) {
      return NextResponse.json(
        { error: verification.error || 'Webhook verification failed' },
        { status: 401 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Webhook endpoint is configured correctly',
      channel: verification.channel,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
