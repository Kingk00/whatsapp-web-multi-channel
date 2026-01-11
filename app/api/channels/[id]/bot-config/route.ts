import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { validateApiAuth } from '@/lib/auth-helpers'
import { encrypt, decrypt } from '@/lib/encryption'

/**
 * GET /api/channels/[id]/bot-config
 * Fetch bot configuration for a channel
 * Never returns the actual API key - only a boolean indicating if it's set
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Authenticate user and verify channel access
    await validateApiAuth({ channelId: id })

    const supabase = await createClient()

    // Get config (excluding the encrypted API key)
    const { data: config, error } = await supabase
      .from('channel_bot_config')
      .select(`
        id,
        channel_id,
        bot_mode,
        bloe_api_url,
        bloe_provider_id,
        auto_reply_start_minutes,
        auto_reply_end_minutes,
        auto_reply_timezone,
        auto_pause_on_escalate,
        reply_delay_ms,
        created_at,
        updated_at
      `)
      .eq('channel_id', id)
      .single()

    // Check if API key is set (without returning it)
    const { data: keyCheck } = await supabase
      .from('channel_bot_config')
      .select('bloe_api_key_encrypted')
      .eq('channel_id', id)
      .single()

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows returned, which is fine for unconfigured channels
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    // Return config with boolean indicator for API key
    return NextResponse.json({
      config: config ? {
        ...config,
        bloe_api_key_set: !!keyCheck?.bloe_api_key_encrypted,
      } : null,
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

/**
 * PUT /api/channels/[id]/bot-config
 * Create or update bot configuration for a channel
 * Only admins can update bot config
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Authenticate user and require admin + channel access
    await validateApiAuth({ requireMainAdmin: true, channelId: id })

    const body = await request.json()
    const {
      bot_mode,
      bloe_api_url,
      bloe_api_key, // Only sent if user is updating the key
      bloe_provider_id,
      auto_reply_start_minutes,
      auto_reply_end_minutes,
      auto_reply_timezone,
      auto_pause_on_escalate,
      reply_delay_ms,
    } = body

    // Validate bot_mode
    if (bot_mode && !['full', 'semi', 'watching', 'off'].includes(bot_mode)) {
      return NextResponse.json(
        { error: 'Invalid bot_mode. Must be: full, semi, watching, or off' },
        { status: 400 }
      )
    }

    // Validate auto_reply minutes (0-1439)
    if (auto_reply_start_minutes != null && (auto_reply_start_minutes < 0 || auto_reply_start_minutes >= 1440)) {
      return NextResponse.json(
        { error: 'Invalid auto_reply_start_minutes. Must be 0-1439' },
        { status: 400 }
      )
    }
    if (auto_reply_end_minutes != null && (auto_reply_end_minutes < 0 || auto_reply_end_minutes >= 1440)) {
      return NextResponse.json(
        { error: 'Invalid auto_reply_end_minutes. Must be 0-1439' },
        { status: 400 }
      )
    }

    const supabase = createServiceRoleClient()

    // Prepare upsert data
    const configData: Record<string, any> = {
      channel_id: id,
    }

    if (bot_mode !== undefined) configData.bot_mode = bot_mode
    if (bloe_api_url !== undefined) configData.bloe_api_url = bloe_api_url
    if (bloe_provider_id !== undefined) configData.bloe_provider_id = bloe_provider_id
    if (auto_reply_start_minutes !== undefined) configData.auto_reply_start_minutes = auto_reply_start_minutes
    if (auto_reply_end_minutes !== undefined) configData.auto_reply_end_minutes = auto_reply_end_minutes
    if (auto_reply_timezone !== undefined) configData.auto_reply_timezone = auto_reply_timezone
    if (auto_pause_on_escalate !== undefined) configData.auto_pause_on_escalate = auto_pause_on_escalate
    if (reply_delay_ms !== undefined) configData.reply_delay_ms = reply_delay_ms

    // Encrypt and store API key if provided
    if (bloe_api_key) {
      configData.bloe_api_key_encrypted = encrypt(bloe_api_key)
    }

    // Upsert config
    const { data: config, error } = await supabase
      .from('channel_bot_config')
      .upsert(configData, { onConflict: 'channel_id' })
      .select(`
        id,
        channel_id,
        bot_mode,
        bloe_api_url,
        bloe_provider_id,
        auto_reply_start_minutes,
        auto_reply_end_minutes,
        auto_reply_timezone,
        auto_pause_on_escalate,
        reply_delay_ms,
        created_at,
        updated_at
      `)
      .single()

    if (error) {
      console.error('Bot config upsert error:', error)
      return NextResponse.json(
        { error: 'Failed to update bot configuration' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      config: {
        ...config,
        bloe_api_key_set: !!bloe_api_key || !!configData.bloe_api_key_encrypted,
      },
    })
  } catch (error) {
    if (error instanceof Response) {
      return error
    }
    console.error('Bot config error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/channels/[id]/bot-config
 * Remove bot configuration for a channel (set to off)
 * Only admins can delete bot config
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Authenticate user and require admin + channel access
    await validateApiAuth({ requireMainAdmin: true, channelId: id })

    const supabase = createServiceRoleClient()

    const { error } = await supabase
      .from('channel_bot_config')
      .delete()
      .eq('channel_id', id)

    if (error) {
      return NextResponse.json(
        { error: 'Failed to delete bot configuration' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Bot configuration removed',
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
