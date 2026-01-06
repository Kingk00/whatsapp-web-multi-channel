import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { validateApiAuth } from '@/lib/auth-helpers'
import { encrypt, decrypt } from '@/lib/encryption'

/**
 * GET /api/channels/[id]
 * Fetch a single channel by ID
 * RLS policies automatically enforce access control
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

    const { data: channel, error } = await supabase
      .from('channels')
      .select('id, name, phone_number, status, health_status, last_synced_at, created_at, updated_at, workspace_id')
      .eq('id', id)
      .single()

    if (error || !channel) {
      return NextResponse.json(
        { error: 'Channel not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ channel })
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
 * PATCH /api/channels/[id]
 * Update a channel's settings
 * Only main_admin can update channels
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Authenticate user and require main_admin + channel access
    await validateApiAuth({ requireMainAdmin: true, channelId: id })

    const body = await request.json()
    const { name, whapi_token, status, health_status } = body

    // Prepare update object with allowed fields
    const updates: any = {}

    if (name !== undefined) {
      if (!name || name.trim().length === 0) {
        return NextResponse.json(
          { error: 'Channel name cannot be empty' },
          { status: 400 }
        )
      }
      updates.name = name.trim()
    }

    if (status !== undefined) {
      const validStatuses = ['ACTIVE', 'INITIALIZING', 'NEEDS_REAUTH', 'STOPPED']
      if (!validStatuses.includes(status)) {
        return NextResponse.json(
          { error: 'Invalid status value' },
          { status: 400 }
        )
      }
      updates.status = status
    }

    if (health_status !== undefined) {
      const validHealthStatuses = ['HEALTHY', 'DEGRADED', 'SYNC_ERROR', 'UNKNOWN']
      if (!validHealthStatuses.includes(health_status)) {
        return NextResponse.json(
          { error: 'Invalid health_status value' },
          { status: 400 }
        )
      }
      updates.health_status = health_status
    }

    updates.updated_at = new Date().toISOString()

    const supabase = createServiceRoleClient()

    // Update channel
    const { data: channel, error: channelError } = await supabase
      .from('channels')
      .update(updates)
      .eq('id', id)
      .select('id, name, phone_number, status, health_status, last_synced_at, created_at, updated_at, workspace_id')
      .single()

    if (channelError || !channel) {
      return NextResponse.json(
        { error: 'Failed to update channel' },
        { status: 500 }
      )
    }

    // If whapi_token is being updated, update the encrypted token
    if (whapi_token !== undefined) {
      if (!whapi_token || whapi_token.length < 10) {
        return NextResponse.json(
          { error: 'Invalid Whapi token: too short' },
          { status: 400 }
        )
      }

      const encryptedToken = encrypt(whapi_token)

      const { error: tokenError } = await supabase
        .from('channel_tokens')
        .update({
          encrypted_token: encryptedToken,
          updated_at: new Date().toISOString(),
        })
        .eq('channel_id', id)
        .eq('token_type', 'whapi')

      if (tokenError) {
        return NextResponse.json(
          { error: 'Failed to update channel token' },
          { status: 500 }
        )
      }

      // Verify the new token with Whapi.cloud
      try {
        const whapiResponse = await fetch('https://gate.whapi.cloud/settings', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${whapi_token}`,
            'Content-Type': 'application/json',
          },
        })

        if (!whapiResponse.ok) {
          return NextResponse.json(
            { error: 'Invalid Whapi token: Unable to verify with Whapi.cloud' },
            { status: 400 }
          )
        }

        const settings = await whapiResponse.json()

        // Update channel with phone number if available
        if (settings.wid) {
          const phoneNumber = settings.wid.split('@')[0]
          await supabase
            .from('channels')
            .update({
              phone_number: phoneNumber,
              status: 'ACTIVE',
              health_status: 'HEALTHY',
            })
            .eq('id', id)
        }
      } catch (error) {
        return NextResponse.json(
          { error: 'Failed to verify token with Whapi.cloud' },
          { status: 400 }
        )
      }
    }

    return NextResponse.json({
      success: true,
      channel,
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
 * DELETE /api/channels/[id]
 * Delete a channel and all associated data
 * Only main_admin can delete channels
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Authenticate user and require main_admin + channel access
    await validateApiAuth({ requireMainAdmin: true, channelId: id })

    const supabase = createServiceRoleClient()

    // Delete channel (cascade will handle related records)
    const { error } = await supabase
      .from('channels')
      .delete()
      .eq('id', id)

    if (error) {
      return NextResponse.json(
        { error: 'Failed to delete channel' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Channel deleted successfully',
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
