import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

/**
 * POST /api/chats/[id]/read
 *
 * Mark all messages in a chat as read and reset unread count.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: chatId } = await params
    const supabase = await createClient()
    const serviceClient = createServiceRoleClient()

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify user has access to this chat
    const { data: chat, error: chatError } = await supabase
      .from('chats')
      .select('id, unread_count')
      .eq('id', chatId)
      .single()

    if (chatError || !chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    // Reset unread count to 0
    const { error: updateError } = await serviceClient
      .from('chats')
      .update({
        unread_count: 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', chatId)

    if (updateError) {
      console.error('Failed to reset unread count:', updateError)
      return NextResponse.json(
        { error: 'Failed to mark chat as read' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      chat_id: chatId,
      previous_unread_count: chat.unread_count,
    })
  } catch (error) {
    console.error('Chat read error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
