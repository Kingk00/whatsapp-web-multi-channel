import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/encryption'

/**
 * GET /api/chats/[id]/presence
 *
 * Fetch last seen / presence info for a chat contact from Whapi.
 * Returns the contact's online status and last seen timestamp.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { id: chatId } = await params

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get chat details including channel and wa_chat_id
    const { data: chat, error: chatError } = await supabase
      .from('chats')
      .select('id, channel_id, wa_chat_id, is_group')
      .eq('id', chatId)
      .single()

    if (chatError || !chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    // Don't fetch presence for groups
    if (chat.is_group) {
      return NextResponse.json({
        online: null,
        last_seen: null,
        is_group: true,
      })
    }

    // Get encrypted token from channel_tokens table
    const serviceClient = createServiceRoleClient()
    const { data: tokenData } = await serviceClient
      .from('channel_tokens')
      .select('encrypted_token')
      .eq('channel_id', chat.channel_id)
      .eq('token_type', 'whapi')
      .single()

    if (!tokenData?.encrypted_token) {
      return NextResponse.json({ error: 'Channel not configured' }, { status: 400 })
    }

    // Decrypt the token
    const whapiToken = decrypt(tokenData.encrypted_token)

    // Fetch contact info from Whapi - contacts endpoint includes presence
    // The wa_chat_id is in format "1234567890@c.us" for individual chats
    const contactId = chat.wa_chat_id

    console.log('[Presence API] Fetching presence for:', contactId)

    const response = await fetch(`https://gate.whapi.cloud/contacts/${contactId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${whapiToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      console.error('[Presence API] Whapi request failed:', response.status)
      return NextResponse.json({
        online: null,
        last_seen: null,
        error: 'Failed to fetch presence',
      })
    }

    const contactData = await response.json()
    console.log('[Presence API] Contact data:', JSON.stringify(contactData).slice(0, 500))

    // Whapi returns presence info in the contact object
    // presence can be: "available", "unavailable", "composing", "recording"
    // last_seen is a Unix timestamp
    const isOnline = contactData.presence === 'available'
    const lastSeen = contactData.last_seen
      ? new Date(contactData.last_seen * 1000).toISOString()
      : null

    return NextResponse.json({
      online: isOnline,
      last_seen: lastSeen,
      presence: contactData.presence,
      is_typing: contactData.presence === 'composing',
      is_recording: contactData.presence === 'recording',
    })
  } catch (error) {
    console.error('Presence API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
