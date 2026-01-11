import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/encryption'

/**
 * POST /api/cron/channel-health
 * Cron job to monitor channel health status
 * Checks each channel's connection status via Whapi.cloud API
 * Updates channel status based on response
 *
 * This endpoint should be called periodically (e.g., every 5 minutes) by Vercel Cron
 */
export async function POST(request: NextRequest) {
  try {
    // Verify cron secret to prevent unauthorized access
    const authHeader = request.headers.get('authorization')
    const expectedAuth = `Bearer ${process.env.CRON_SECRET}`

    if (!authHeader || authHeader !== expectedAuth) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const supabase = createServiceRoleClient()

    // Get all channels that are not in stopped status
    const { data: channels, error: fetchError } = await supabase
      .from('channels')
      .select('id, name, status')
      .neq('status', 'stopped')

    if (fetchError) {
      return NextResponse.json(
        { error: 'Failed to fetch channels', details: fetchError.message },
        { status: 500 }
      )
    }

    if (!channels || channels.length === 0) {
      return NextResponse.json({
        message: 'No active channels to monitor',
        checked: 0,
        updated: 0,
      })
    }

    const results = {
      checked: 0,
      updated: 0,
      errors: [] as { channel_id: string; error: string }[],
    }

    // Check health for each channel
    for (const channel of channels) {
      results.checked++

      try {
        // Get the encrypted token for this channel
        const { data: tokenData, error: tokenError } = await supabase
          .from('channel_tokens')
          .select('encrypted_token')
          .eq('channel_id', channel.id)
          .eq('token_type', 'whapi')
          .single()

        if (tokenError || !tokenData) {
          results.errors.push({
            channel_id: channel.id,
            error: 'Token not found',
          })
          continue
        }

        // Decrypt the Whapi token
        let whapiToken: string
        try {
          whapiToken = decrypt(tokenData.encrypted_token)
        } catch (error) {
          results.errors.push({
            channel_id: channel.id,
            error: 'Failed to decrypt token',
          })
          continue
        }

        // Check channel status via Whapi.cloud API
        // Using the /settings endpoint to get channel info
        const whapiResponse = await fetch('https://gate.whapi.cloud/settings', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${whapiToken}`,
            'Accept': 'application/json',
          },
        })

        let newStatus = channel.status
        let healthMetrics = {}

        if (whapiResponse.ok) {
          const data = await whapiResponse.json()

          // Determine status based on Whapi response
          if (data.status === 'active' || data.status === 'authenticated') {
            newStatus = 'active'
          } else if (data.status === 'qr') {
            newStatus = 'needs_reauth'
          } else if (data.status === 'disconnected' || data.status === 'closed') {
            newStatus = 'disconnected'
          } else {
            newStatus = 'degraded'
          }

          // Store health metrics
          healthMetrics = {
            whapi_status: data.status,
            phone_number: data.phoneNumber || null,
            last_check: new Date().toISOString(),
          }
        } else if (whapiResponse.status === 401) {
          // Invalid token
          newStatus = 'needs_reauth'
          healthMetrics = {
            error: 'Invalid token',
            last_check: new Date().toISOString(),
          }
        } else if (whapiResponse.status === 429) {
          // Rate limited
          newStatus = 'degraded'
          healthMetrics = {
            error: 'Rate limited',
            last_check: new Date().toISOString(),
          }
        } else {
          // Other errors
          newStatus = 'sync_error'
          healthMetrics = {
            error: `HTTP ${whapiResponse.status}`,
            last_check: new Date().toISOString(),
          }
        }

        // Update channel status if changed
        if (newStatus !== channel.status) {
          const { error: updateError } = await supabase
            .from('channels')
            .update({
              status: newStatus,
              health_status: healthMetrics,
              last_synced_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', channel.id)

          if (updateError) {
            results.errors.push({
              channel_id: channel.id,
              error: `Failed to update: ${updateError.message}`,
            })
          } else {
            results.updated++
          }
        } else {
          // Update health metrics even if status hasn't changed
          await supabase
            .from('channels')
            .update({
              health_status: healthMetrics,
              last_synced_at: new Date().toISOString(),
            })
            .eq('id', channel.id)
        }
      } catch (error) {
        results.errors.push({
          channel_id: channel.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    return NextResponse.json({
      message: 'Channel health check completed',
      ...results,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Channel health check failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

/**
 * GET /api/cron/channel-health
 * Manual trigger endpoint for testing (requires authentication)
 * In production, use POST with cron secret
 */
export async function GET(request: NextRequest) {
  // Allow manual trigger for testing in development
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json(
      { error: 'This endpoint is only available in development mode. Use POST with cron secret in production.' },
      { status: 403 }
    )
  }

  // Forward to POST handler
  return POST(request)
}
