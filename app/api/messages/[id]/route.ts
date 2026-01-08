import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/encryption'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/messages/[id]
 *
 * Edit an outbound text message.
 * - Calls WhatsApp API to edit the message
 * - Updates local database with new text and edited_at timestamp
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const serviceClient = createServiceRoleClient()
    const { id: messageId } = await params
    const body = await request.json()
    const { action, text } = body

    if (action !== 'edit') {
      return NextResponse.json(
        { error: 'Invalid action. Only "edit" is supported.' },
        { status: 400 }
      )
    }

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return NextResponse.json(
        { error: 'Text is required and cannot be empty' },
        { status: 400 }
      )
    }

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get the message with channel and chat info
    const { data: message, error: messageError } = await supabase
      .from('messages')
      .select(`
        id,
        channel_id,
        chat_id,
        wa_message_id,
        direction,
        message_type,
        text,
        deleted_at,
        channels!inner (
          id,
          workspace_id
        ),
        chats!inner (
          wa_chat_id
        )
      `)
      .eq('id', messageId)
      .single()

    if (messageError || !message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    // Validate edit permissions
    if (message.direction !== 'outbound') {
      return NextResponse.json(
        { error: 'Cannot edit inbound messages' },
        { status: 403 }
      )
    }

    if (message.message_type !== 'text') {
      return NextResponse.json(
        { error: 'Can only edit text messages' },
        { status: 400 }
      )
    }

    if (message.deleted_at) {
      return NextResponse.json(
        { error: 'Cannot edit a deleted message' },
        { status: 400 }
      )
    }

    // If the message is still pending (not yet sent to WhatsApp), just update locally
    const isPending = message.wa_message_id.startsWith('pending_')

    if (!isPending) {
      // Get the Whapi token for this channel
      const { data: tokenData } = await serviceClient
        .from('channel_tokens')
        .select('encrypted_token')
        .eq('channel_id', message.channel_id)
        .eq('token_type', 'whapi')
        .single()

      if (!tokenData?.encrypted_token) {
        return NextResponse.json(
          { error: 'No token found for this channel' },
          { status: 500 }
        )
      }

      const whapiToken = decrypt(tokenData.encrypted_token)

      // Get the chat's WhatsApp ID (phone number or group ID)
      const waChatId = (message.chats as { wa_chat_id: string }).wa_chat_id

      // Call WhatsApp API to edit the message
      // Whapi uses POST /messages/text with an "edit" parameter
      console.log('[Message Edit] Editing message:', message.wa_message_id, 'in chat:', waChatId)

      const requestBody = {
        to: waChatId,
        body: text.trim(),
        edit: message.wa_message_id,
      }
      console.log('[Message Edit] Request body:', JSON.stringify(requestBody))

      const whapiResponse = await fetch(
        'https://gate.whapi.cloud/messages/text',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${whapiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        }
      )

      const responseText = await whapiResponse.text()
      console.log('[Message Edit] WhatsApp API response status:', whapiResponse.status, 'body:', responseText)

      if (!whapiResponse.ok) {
        let errorData: Record<string, unknown> = {}
        try {
          errorData = JSON.parse(responseText)
        } catch {
          // Response was not JSON
        }
        console.error('[Message Edit] WhatsApp API error:', errorData)

        // Check for common error cases
        const errorObj = errorData?.error as Record<string, unknown> | undefined
        const errorMessage = String(errorObj?.message || errorData?.message || '')
        if (
          errorMessage.toLowerCase().includes('time') ||
          errorMessage.toLowerCase().includes('expired') ||
          errorMessage.toLowerCase().includes('edit') ||
          errorMessage.toLowerCase().includes('15')
        ) {
          return NextResponse.json(
            { error: 'This message can no longer be edited. WhatsApp allows editing within 15 minutes of sending.' },
            { status: 400 }
          )
        }

        return NextResponse.json(
          { error: 'Failed to edit message on WhatsApp' },
          { status: 500 }
        )
      }
    }

    // Update local database
    const { data: updatedMessage, error: updateError } = await serviceClient
      .from('messages')
      .update({
        text: text.trim(),
        edited_at: new Date().toISOString(),
      })
      .eq('id', messageId)
      .select('id, text, edited_at')
      .single()

    if (updateError) {
      console.error('[Message Edit] Database update error:', updateError)
      return NextResponse.json(
        { error: 'Failed to update message in database' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: updatedMessage,
    })
  } catch (error) {
    console.error('Message edit error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/messages/[id]
 *
 * Delete a message.
 * - For outbound messages with ?for_everyone=true: Delete from WhatsApp + soft delete locally
 * - For inbound or for_everyone=false: Soft delete locally only
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const serviceClient = createServiceRoleClient()
    const { id: messageId } = await params

    // Check for for_everyone query param
    const { searchParams } = new URL(request.url)
    const forEveryone = searchParams.get('for_everyone') === 'true'

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get the message with channel info
    const { data: message, error: messageError } = await supabase
      .from('messages')
      .select(`
        id,
        channel_id,
        wa_message_id,
        direction,
        deleted_at,
        channels!inner (
          id,
          workspace_id
        )
      `)
      .eq('id', messageId)
      .single()

    if (messageError || !message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    // Already deleted?
    if (message.deleted_at) {
      return NextResponse.json({ error: 'Message already deleted' }, { status: 400 })
    }

    // For outbound messages with for_everyone, call WhatsApp API
    const isPending = message.wa_message_id.startsWith('pending_')

    if (message.direction === 'outbound' && forEveryone && !isPending) {
      // Get the Whapi token for this channel
      const { data: tokenData } = await serviceClient
        .from('channel_tokens')
        .select('encrypted_token')
        .eq('channel_id', message.channel_id)
        .eq('token_type', 'whapi')
        .single()

      if (!tokenData?.encrypted_token) {
        return NextResponse.json(
          { error: 'No token found for this channel' },
          { status: 500 }
        )
      }

      const whapiToken = decrypt(tokenData.encrypted_token)

      // Call WhatsApp API to delete the message
      // URL encode the message ID in case it contains special characters
      const encodedMessageId = encodeURIComponent(message.wa_message_id)
      console.log('[Message Delete] Deleting message from WhatsApp:', message.wa_message_id, '(encoded:', encodedMessageId, ')')

      const whapiResponse = await fetch(
        `https://gate.whapi.cloud/messages/${encodedMessageId}`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${whapiToken}`,
          },
        }
      )

      const responseText = await whapiResponse.text()
      console.log('[Message Delete] WhatsApp API response status:', whapiResponse.status, 'body:', responseText)

      if (!whapiResponse.ok) {
        let errorData = {}
        try {
          errorData = JSON.parse(responseText)
        } catch {
          // Response was not JSON
        }
        console.error('[Message Delete] WhatsApp API error:', errorData)
        // Continue with local delete even if WhatsApp deletion fails
        // This handles cases where message is already deleted on WhatsApp
      }
    }

    // Soft delete locally
    const { data: deletedMessage, error: deleteError } = await serviceClient
      .from('messages')
      .update({
        deleted_at: new Date().toISOString(),
      })
      .eq('id', messageId)
      .select('id, deleted_at')
      .single()

    if (deleteError) {
      console.error('[Message Delete] Database update error:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete message' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: deletedMessage,
    })
  } catch (error) {
    console.error('Message delete error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
