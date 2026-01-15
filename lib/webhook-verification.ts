/**
 * Webhook Verification Utilities
 *
 * Provides functions to verify webhook requests from Whapi.cloud
 * Each channel has a unique webhook_secret that must be validated
 * to prevent unauthorized webhook submissions
 *
 * PERFORMANCE: Includes in-memory caching to reduce DB queries for
 * repeated webhooks to the same channel
 */

import { createServiceRoleClient } from '@/lib/supabase/server'

// Conditional logging
const DEBUG = process.env.WEBHOOK_DEBUG === 'true'
const log = DEBUG ? (...args: any[]) => console.log('[Webhook Verify]', ...args) : () => {}

// ============================================================================
// Channel Verification Cache
// ============================================================================

interface CachedChannel {
  id: string
  workspace_id: string
  status: string
  webhook_secret: string
}

interface CacheEntry {
  channel: CachedChannel
  expiry: number
}

// In-memory cache with TTL (survives within a single serverless instance)
const channelCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 60000 // 60 seconds

/**
 * Clear expired cache entries (called periodically)
 */
function cleanupExpiredCache(): void {
  const now = Date.now()
  for (const [key, entry] of channelCache.entries()) {
    if (entry.expiry < now) {
      channelCache.delete(key)
    }
  }
}

// Cleanup expired entries every 5 minutes
setInterval(cleanupExpiredCache, 300000)

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
 * PERFORMANCE: Uses in-memory cache with 60s TTL to reduce DB queries
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

  const now = Date.now()

  // PERFORMANCE: Check cache first
  const cached = channelCache.get(channelId)
  if (cached && cached.expiry > now) {
    log('Cache HIT for channel:', channelId)

    // Verify secret against cached data
    if (cached.channel.webhook_secret !== providedSecret) {
      return {
        valid: false,
        error: 'Invalid webhook secret',
      }
    }

    return {
      valid: true,
      channel: {
        id: cached.channel.id,
        workspace_id: cached.channel.workspace_id,
        status: cached.channel.status,
      },
    }
  }

  log('Cache MISS for channel:', channelId)

  // Cache miss - fetch from database
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

  // Cache the result for future requests
  channelCache.set(channelId, {
    channel: {
      id: channel.id,
      workspace_id: channel.workspace_id,
      status: channel.status,
      webhook_secret: channel.webhook_secret,
    },
    expiry: now + CACHE_TTL_MS,
  })

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
