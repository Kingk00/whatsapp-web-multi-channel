import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { validateApiAuth } from '@/lib/auth-helpers'
import { decrypt } from '@/lib/encryption'
import { WhapiClient } from '@/lib/whapi-client'

/**
 * GET /api/channels/[id]/whapi-contacts
 *
 * Fetch contacts directly from Whapi for this channel.
 * Used to preview contacts before syncing.
 * Requires admin role.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: channelId } = await params

    // Authenticate user and verify admin role
    const { profile } = await validateApiAuth({ channelId })

    // Only admins can access Whapi contacts
    if (!['main_admin', 'admin'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const supabase = createServiceRoleClient()

    // Verify channel exists and belongs to workspace
    const { data: channel } = await supabase
      .from('channels')
      .select('id, workspace_id')
      .eq('id', channelId)
      .eq('workspace_id', profile.workspace_id)
      .single()

    if (!channel) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
    }

    // Get channel token
    const { data: tokenData, error: tokenError } = await supabase
      .from('channel_tokens')
      .select('encrypted_token')
      .eq('channel_id', channelId)
      .eq('token_type', 'whapi')
      .single()

    if (tokenError || !tokenData?.encrypted_token) {
      return NextResponse.json(
        { error: 'Channel API token not found' },
        { status: 404 }
      )
    }

    // Decrypt token
    let whapiToken: string
    try {
      whapiToken = decrypt(tokenData.encrypted_token)
    } catch (error) {
      return NextResponse.json(
        { error: 'Failed to decrypt channel token' },
        { status: 500 }
      )
    }

    // Fetch contacts from Whapi
    const whapiClient = new WhapiClient({ token: whapiToken })

    try {
      const contacts = await whapiClient.getContacts()
      return NextResponse.json({
        contacts,
        count: contacts.length,
      })
    } catch (error: any) {
      console.error('Error fetching Whapi contacts:', error)
      return NextResponse.json(
        { error: error?.message || 'Failed to fetch contacts from Whapi' },
        { status: error?.status || 500 }
      )
    }
  } catch (error) {
    if (error instanceof Response) {
      return error
    }
    console.error('Whapi contacts GET error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
