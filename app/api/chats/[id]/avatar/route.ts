import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/encryption'
import { createWhapiClient } from '@/lib/whapi-client'

export const dynamic = 'force-dynamic'

/**
 * GET /api/chats/[id]/avatar
 *
 * Fetch profile photo from WhatsApp for a chat.
 * Returns the avatar URL and caches it in the database.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const serviceClient = createServiceRoleClient()
    const { id: chatId } = await params

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get the chat with channel info
    const { data: chat, error: chatError } = await supabase
      .from('chats')
      .select(`
        id,
        channel_id,
        wa_chat_id,
        profile_photo_url
      `)
      .eq('id', chatId)
      .single()

    if (chatError || !chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    // If we already have a profile photo, return it
    if (chat.profile_photo_url) {
      return NextResponse.json({ avatar_url: chat.profile_photo_url })
    }

    // Get the Whapi token for this channel
    const { data: tokenData } = await serviceClient
      .from('channel_tokens')
      .select('encrypted_token')
      .eq('channel_id', chat.channel_id)
      .eq('token_type', 'whapi')
      .single()

    if (!tokenData?.encrypted_token) {
      return NextResponse.json(
        { error: 'No token found for this channel' },
        { status: 500 }
      )
    }

    const whapiToken = decrypt(tokenData.encrypted_token)
    const whapiClient = createWhapiClient(whapiToken)

    try {
      // Fetch profile from WhatsApp
      const profile = await whapiClient.getProfilePhoto(chat.wa_chat_id)
      const avatarUrl = profile.avatar || profile.icon

      if (avatarUrl) {
        // Cache the profile photo URL in the database
        await serviceClient
          .from('chats')
          .update({ profile_photo_url: avatarUrl })
          .eq('id', chatId)

        return NextResponse.json({ avatar_url: avatarUrl })
      }

      return NextResponse.json({ avatar_url: null })
    } catch (whapiError) {
      console.error('[Avatar] Whapi error:', whapiError)
      // Don't fail - just return null avatar
      return NextResponse.json({ avatar_url: null })
    }
  } catch (error) {
    console.error('Avatar API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
