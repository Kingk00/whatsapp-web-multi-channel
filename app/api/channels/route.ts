import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { validateApiAuth, getUserWorkspaceId } from '@/lib/auth-helpers'
import { encrypt } from '@/lib/encryption'

/**
 * GET /api/channels
 * List all channels accessible to the current user
 * RLS policies automatically filter based on user permissions
 */
export async function GET(request: NextRequest) {
  try {
    // Authenticate user
    const { user, profile } = await validateApiAuth()

    const supabase = await createClient()

    // Fetch channels (RLS will automatically filter based on user access)
    const { data: channels, error } = await supabase
      .from('channels')
      .select('id, name, phone_number, status, health_status, last_synced_at, created_at, updated_at, workspace_id')
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch channels' },
        { status: 500 }
      )
    }

    return NextResponse.json({ channels })
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

/**
 * POST /api/channels
 * Create a new WhatsApp Business channel with Whapi token
 * Only main_admin can create channels
 */
export async function POST(request: NextRequest) {
  try {
    // Authenticate user and require main_admin role
    const { user, profile } = await validateApiAuth({ requireMainAdmin: true })

    const { name, whapi_token } = await request.json()

    // Validate required fields
    if (!name || !whapi_token) {
      return NextResponse.json(
        { error: 'Missing required fields: name and whapi_token' },
        { status: 400 }
      )
    }

    // Validate token length
    if (whapi_token.length < 10) {
      return NextResponse.json(
        { error: 'Invalid Whapi token: too short' },
        { status: 400 }
      )
    }

    const workspaceId = await getUserWorkspaceId()
    if (!workspaceId) {
      return NextResponse.json(
        { error: 'User workspace not found' },
        { status: 404 }
      )
    }

    // Encrypt the Whapi token
    const encryptedToken = encrypt(whapi_token)

    // Create channel using service role client to insert encrypted token
    const supabase = createServiceRoleClient()

    // Generate webhook secret for this channel
    const webhookSecret = crypto.randomUUID()

    // First, create the channel
    const { data: channel, error: channelError } = await supabase
      .from('channels')
      .insert({
        name,
        workspace_id: workspaceId,
        status: 'INITIALIZING',
        health_status: { status: 'unknown' },
        webhook_secret: webhookSecret,
      })
      .select('id, name, status, health_status, created_at, workspace_id')
      .single()

    if (channelError || !channel) {
      return NextResponse.json(
        { error: 'Failed to create channel' },
        { status: 500 }
      )
    }

    // Store encrypted token in channel_tokens table
    const { error: tokenError } = await supabase
      .from('channel_tokens')
      .insert({
        channel_id: channel.id,
        encrypted_token: encryptedToken,
        token_type: 'whapi',
      })

    if (tokenError) {
      // Rollback: delete the channel if token storage fails
      await supabase.from('channels').delete().eq('id', channel.id)
      return NextResponse.json(
        { error: 'Failed to store channel token' },
        { status: 500 }
      )
    }

    // Verify the token with Whapi.cloud by fetching settings
    try {
      const whapiResponse = await fetch('https://gate.whapi.cloud/settings', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${whapi_token}`,
          'Content-Type': 'application/json',
        },
      })

      if (!whapiResponse.ok) {
        // Token is invalid - rollback
        await supabase.from('channels').delete().eq('id', channel.id)
        return NextResponse.json(
          { error: 'Invalid Whapi token: Unable to verify with Whapi.cloud' },
          { status: 400 }
        )
      }

      const settings = await whapiResponse.json()

      // Update channel with phone number if available
      if (settings.wid) {
        // Extract phone number from wid (format: "1234567890@s.whatsapp.net")
        const phoneNumber = settings.wid.split('@')[0]
        await supabase
          .from('channels')
          .update({ phone_number: phoneNumber })
          .eq('id', channel.id)
      }

      // Configure webhook URL in Whapi.cloud
      const baseUrl = request.headers.get('origin') || request.headers.get('host')
      const protocol = baseUrl?.includes('localhost') ? 'http' : 'https'
      const webhookUrl = `${protocol}://${baseUrl?.replace(/^https?:\/\//, '')}/api/webhooks/whapi/${channel.id}?secret=${webhookSecret}`

      console.log('[Channel Creation] Configuring webhook URL:', webhookUrl)

      const webhookConfigResponse = await fetch('https://gate.whapi.cloud/settings', {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${whapi_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          webhooks: [{
            url: webhookUrl,
            events: [
              // New messages
              { type: 'messages', method: 'post' },
              // Edited messages (PATCH = partial update)
              { type: 'messages', method: 'patch' },
              // Deleted messages
              { type: 'messages', method: 'delete' },
              // Message status updates (sent, delivered, read)
              { type: 'statuses', method: 'post' },
              { type: 'statuses', method: 'put' },
              // Chat updates
              { type: 'chats', method: 'post' },
              { type: 'chats', method: 'patch' },
            ],
            mode: 'body',
          }],
        }),
      })

      if (!webhookConfigResponse.ok) {
        const errorText = await webhookConfigResponse.text()
        console.error('[Channel Creation] Failed to configure webhook:', errorText)
        // Don't fail the channel creation, just log the error
        // User can manually configure the webhook
      } else {
        console.log('[Channel Creation] Webhook configured successfully')
        // Update channel status to indicate webhook is configured
        await supabase
          .from('channels')
          .update({
            status: 'pending_qr',
            health_status: { status: 'webhook_configured', configured_at: new Date().toISOString() }
          })
          .eq('id', channel.id)
      }
    } catch (error) {
      console.error('[Channel Creation] Whapi verification/webhook config error:', error)
      // If verification fails, keep the channel but leave status as INITIALIZING
      // The user can try to connect via QR code
    }

    return NextResponse.json(
      {
        success: true,
        channel: {
          id: channel.id,
          name: channel.name,
          status: channel.status,
          health_status: channel.health_status,
          created_at: channel.created_at,
          workspace_id: channel.workspace_id,
          webhook_secret: webhookSecret,
        },
      },
      { status: 201 }
    )
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
