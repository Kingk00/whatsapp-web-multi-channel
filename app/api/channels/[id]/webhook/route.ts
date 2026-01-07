import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { validateApiAuth } from '@/lib/auth-helpers'
import { decrypt } from '@/lib/encryption'

/**
 * POST /api/channels/[id]/webhook
 * Configure or reconfigure the webhook URL in Whapi.cloud for this channel
 * This is useful for existing channels that weren't auto-configured
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    console.log('[Webhook Config] Starting for channel:', id)

    // Check if ENCRYPTION_KEY is set
    if (!process.env.ENCRYPTION_KEY) {
      console.error('[Webhook Config] ENCRYPTION_KEY not set!')
      return NextResponse.json(
        { error: 'Server configuration error: ENCRYPTION_KEY not set' },
        { status: 500 }
      )
    }

    // Authenticate user and require main_admin
    console.log('[Webhook Config] Authenticating user...')
    await validateApiAuth({ requireMainAdmin: true })
    console.log('[Webhook Config] User authenticated')

    const supabase = createServiceRoleClient()

    // Get channel details including webhook_secret
    console.log('[Webhook Config] Fetching channel details...')
    const { data: channel, error: channelError } = await supabase
      .from('channels')
      .select('id, name, webhook_secret, workspace_id')
      .eq('id', id)
      .single()

    if (channelError || !channel) {
      console.error('[Webhook Config] Channel not found:', channelError)
      return NextResponse.json(
        { error: 'Channel not found' },
        { status: 404 }
      )
    }
    console.log('[Webhook Config] Channel found:', channel.name)

    if (!channel.webhook_secret) {
      // Generate a new webhook secret if none exists
      console.log('[Webhook Config] Generating new webhook secret...')
      const newSecret = crypto.randomUUID()
      await supabase
        .from('channels')
        .update({ webhook_secret: newSecret })
        .eq('id', id)
      channel.webhook_secret = newSecret
    }

    // Get the Whapi token
    console.log('[Webhook Config] Fetching Whapi token...')
    const { data: tokenData, error: tokenError } = await supabase
      .from('channel_tokens')
      .select('encrypted_token')
      .eq('channel_id', id)
      .eq('token_type', 'whapi')
      .single()

    if (tokenError || !tokenData) {
      console.error('[Webhook Config] Token not found:', tokenError)
      return NextResponse.json(
        { error: 'Channel token not found' },
        { status: 404 }
      )
    }
    console.log('[Webhook Config] Token found, decrypting...')

    // Decrypt the token
    const whapiToken = decrypt(tokenData.encrypted_token)
    console.log('[Webhook Config] Token decrypted successfully')

    // Build webhook URL
    const baseUrl = request.headers.get('origin') || request.headers.get('host')
    const protocol = baseUrl?.includes('localhost') ? 'http' : 'https'
    const webhookUrl = `${protocol}://${baseUrl?.replace(/^https?:\/\//, '')}/api/webhooks/whapi/${channel.id}?secret=${channel.webhook_secret}`

    console.log('[Webhook Config] Configuring webhook URL:', webhookUrl)

    // Configure webhook in Whapi.cloud
    const webhookConfigResponse = await fetch('https://gate.whapi.cloud/settings', {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${whapiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        webhooks: [{
          url: webhookUrl,
          events: [
            { type: 'messages', method: 'post' },
            { type: 'acks', method: 'post' },
            { type: 'chats', method: 'post' },
            { type: 'statuses', method: 'post' },
          ],
          mode: 'body',
        }],
      }),
    })

    if (!webhookConfigResponse.ok) {
      const errorText = await webhookConfigResponse.text()
      console.error('[Webhook Config] Failed to configure webhook:', errorText)
      return NextResponse.json(
        { error: 'Failed to configure webhook in Whapi.cloud', details: errorText },
        { status: 500 }
      )
    }

    const responseData = await webhookConfigResponse.json()
    console.log('[Webhook Config] Webhook configured successfully:', responseData)

    // Update channel status
    await supabase
      .from('channels')
      .update({
        health_status: {
          status: 'webhook_configured',
          configured_at: new Date().toISOString(),
          webhook_url: webhookUrl
        },
        updated_at: new Date().toISOString()
      })
      .eq('id', id)

    return NextResponse.json({
      success: true,
      message: 'Webhook configured successfully',
      webhook_url: webhookUrl,
    })
  } catch (error) {
    console.error('[Webhook Config] Error:', error)
    console.error('[Webhook Config] Error stack:', error instanceof Error ? error.stack : 'No stack')
    if (error instanceof Response) {
      return error
    }
    return NextResponse.json(
      {
        error: 'An unexpected error occurred',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

/**
 * GET /api/channels/[id]/webhook
 * Check the current webhook configuration in Whapi.cloud
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Authenticate user + channel access
    await validateApiAuth({ channelId: id })

    const supabase = createServiceRoleClient()

    // Get channel details
    const { data: channel, error: channelError } = await supabase
      .from('channels')
      .select('id, name, webhook_secret')
      .eq('id', id)
      .single()

    if (channelError || !channel) {
      return NextResponse.json(
        { error: 'Channel not found' },
        { status: 404 }
      )
    }

    // Get the Whapi token
    const { data: tokenData, error: tokenError } = await supabase
      .from('channel_tokens')
      .select('encrypted_token')
      .eq('channel_id', id)
      .eq('token_type', 'whapi')
      .single()

    if (tokenError || !tokenData) {
      return NextResponse.json(
        { error: 'Channel token not found' },
        { status: 404 }
      )
    }

    // Decrypt the token
    const whapiToken = decrypt(tokenData.encrypted_token)

    // Fetch current settings from Whapi.cloud
    const settingsResponse = await fetch('https://gate.whapi.cloud/settings', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${whapiToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!settingsResponse.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch settings from Whapi.cloud' },
        { status: 500 }
      )
    }

    const settings = await settingsResponse.json()

    // Build expected webhook URL
    const baseUrl = request.headers.get('origin') || request.headers.get('host')
    const protocol = baseUrl?.includes('localhost') ? 'http' : 'https'
    const expectedWebhookUrl = channel.webhook_secret
      ? `${protocol}://${baseUrl?.replace(/^https?:\/\//, '')}/api/webhooks/whapi/${channel.id}?secret=${channel.webhook_secret}`
      : null

    return NextResponse.json({
      channel_id: channel.id,
      channel_name: channel.name,
      current_webhooks: settings.webhooks || [],
      expected_webhook_url: expectedWebhookUrl,
      is_configured: settings.webhooks?.some((w: any) => w.url?.includes(channel.id)) || false,
    })
  } catch (error) {
    if (error instanceof Response) {
      return error
    }
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
