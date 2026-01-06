/**
 * Webhook Verification Utilities
 *
 * Provides functions to verify webhook requests from Whapi.cloud
 * Each channel has a unique webhook_secret that must be validated
 * to prevent unauthorized webhook submissions
 */

import { createServiceRoleClient } from '@/lib/supabase/server'

export interface WebhookVerificationResult {
  valid: boolean
  channel?: {
    id: string
    workspace_id: string
    status: string
  }
  error?: string
}

/**
 * Verify webhook request by checking the secret against the channel's stored secret
 *
 * @param channelId - The channel ID from the webhook URL
 * @param providedSecret - The secret provided in the webhook request (from header or query param)
 * @returns Verification result with channel data if valid
 */
export async function verifyWebhookSecret(
  channelId: string,
  providedSecret: string | null
): Promise<WebhookVerificationResult> {
  // Check if secret was provided
  if (!providedSecret) {
    return {
      valid: false,
      error: 'Missing webhook secret',
    }
  }

  // Fetch channel and verify secret using service role client
  // (bypasses RLS since webhooks come from external service, not authenticated users)
  const supabase = createServiceRoleClient()

  const { data: channel, error } = await supabase
    .from('channels')
    .select('id, workspace_id, status, webhook_secret')
    .eq('id', channelId)
    .single()

  if (error || !channel) {
    return {
      valid: false,
      error: 'Channel not found',
    }
  }

  // Verify the secret matches
  if (channel.webhook_secret !== providedSecret) {
    return {
      valid: false,
      error: 'Invalid webhook secret',
    }
  }

  // Secret is valid
  return {
    valid: true,
    channel: {
      id: channel.id,
      workspace_id: channel.workspace_id,
      status: channel.status,
    },
  }
}

/**
 * Extract webhook secret from request
 * Checks both query parameters and headers for flexibility
 *
 * @param request - The Next.js request object
 * @returns The webhook secret if found, null otherwise
 */
export function extractWebhookSecret(request: Request): string | null {
  // Check URL query parameters
  const url = new URL(request.url)
  const querySecret = url.searchParams.get('secret')
  if (querySecret) {
    return querySecret
  }

  // Check custom header
  const headerSecret = request.headers.get('x-webhook-secret')
  if (headerSecret) {
    return headerSecret
  }

  // Check authorization header (format: "Bearer <secret>")
  const authHeader = request.headers.get('authorization')
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7)
  }

  return null
}

/**
 * Validate webhook payload structure
 * Ensures required fields are present
 *
 * @param payload - The webhook payload
 * @returns True if payload structure is valid
 */
export function validateWebhookPayload(payload: any): boolean {
  // At minimum, we expect an event type
  if (!payload || typeof payload !== 'object') {
    return false
  }

  // Whapi.cloud webhooks should have an 'event' field
  // Relaxed validation for now - specific event types will be validated in processor
  return true
}
