import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import {
  verifyWebhookSecret,
  extractWebhookSecret,
  validateWebhookPayload,
} from '@/lib/webhook-verification'
import { processWebhookEvent } from '@/lib/webhook-processor'

/**
 * POST /api/webhooks/whapi/[channelId]
 *
 * Webhook endpoint to receive events from Whapi.cloud
 *
 * Security:
 * - Each channel has a unique webhook_secret (UUID)
 * - Secret must be provided via query param (?secret=xxx) or header (X-Webhook-Secret)
 * - Whapi.cloud should be configured to include the secret in webhook URL
 *
 * Event Processing:
 * - All webhook events are logged to webhook_events table for debugging
 * - Idempotent message processing will be implemented in webhook-processor.ts
 * - Uses (channel_id, wa_message_id) for deduplication, NOT event.id
 *
 * Example webhook URL to configure in Whapi.cloud:
 * https://your-app.vercel.app/api/webhooks/whapi/{channelId}?secret={webhook_secret}
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  const startTime = Date.now()

  try {
    const { channelId } = await params

    // Debug logging
    console.log('[Webhook] Received POST request')
    console.log('[Webhook] Channel ID:', channelId)
    console.log('[Webhook] URL:', request.url)

    // Extract webhook secret from request
    const providedSecret = extractWebhookSecret(request)
    console.log('[Webhook] Secret provided:', providedSecret ? 'Yes' : 'No')

    // Verify webhook secret
    const verification = await verifyWebhookSecret(channelId, providedSecret)
    console.log('[Webhook] Verification result:', verification.valid ? 'Valid' : verification.error)

    if (!verification.valid) {
      console.error('[Webhook] Verification failed:', verification.error)
      return NextResponse.json(
        { error: verification.error || 'Webhook verification failed' },
        { status: 401 }
      )
    }

    // Parse webhook payload
    let payload: any
    try {
      payload = await request.json()
      console.log('[Webhook] Payload received:', JSON.stringify(payload).substring(0, 500))
    } catch (error) {
      console.error('[Webhook] JSON parse error:', error)
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

    // Log webhook event for debugging
    // All events are stored regardless of processing outcome
    const supabase = createServiceRoleClient()

    const eventType = payload.event || payload.type || 'unknown'

    const { error: logError } = await supabase
      .from('webhook_events')
      .insert({
        channel_id: channelId,
        event_type: eventType,
        payload: payload,
        created_at: new Date().toISOString(),
      })

    if (logError) {
      // Don't fail the webhook if logging fails
      // But we should be aware of it
      console.error('Failed to log webhook event:', logError)
    }

    // Process webhook event with idempotent message handling
    // Uses (channel_id, wa_message_id) for deduplication, NOT event.id
    const processingResult = await processWebhookEvent(
      verification.channel!,
      payload
    )

    // Update webhook event record with processing result
    if (!logError) {
      await supabase
        .from('webhook_events')
        .update({
          processed_at: new Date().toISOString(),
          error: processingResult.success ? null : processingResult.error,
        })
        .eq('channel_id', channelId)
        .eq('payload', payload)
        .order('created_at', { ascending: false })
        .limit(1)
    }

    const processingTime = Date.now() - startTime

    return NextResponse.json(
      {
        success: processingResult.success,
        message: 'Webhook processed',
        channel_id: channelId,
        event_type: eventType,
        action: processingResult.action,
        details: processingResult.details,
        processing_time_ms: processingTime,
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('Webhook processing error:', error)

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
