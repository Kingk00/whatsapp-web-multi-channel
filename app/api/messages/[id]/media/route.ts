import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/encryption'

/**
 * GET /api/messages/[id]/media
 *
 * Fetch media for a message that doesn't have a media URL.
 * This endpoint will:
 * 1. Try to get the media URL from Whapi using the message ID
 * 2. Download and store the media in Supabase Storage
 * 3. Update the message record with the new media URL
 *
 * Useful for:
 * - Messages saved before media fetching was implemented
 * - Messages where initial media fetch failed
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const serviceClient = createServiceRoleClient()
    const { id: messageId } = await params

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
        message_type,
        media_url,
        storage_path,
        media_metadata,
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

    // Check if message already has media URL
    if (message.media_url) {
      return NextResponse.json({
        success: true,
        already_has_media: true,
        media_url: message.media_url,
        storage_path: message.storage_path,
      })
    }

    // Check if this is a media type message
    const mediaTypes = ['image', 'video', 'audio', 'voice', 'ptt', 'document', 'sticker']
    if (!mediaTypes.includes(message.message_type)) {
      return NextResponse.json({
        error: 'This message type does not have media',
      }, { status: 400 })
    }

    // Get the Whapi token for this channel
    const { data: tokenData } = await serviceClient
      .from('channel_tokens')
      .select('encrypted_token')
      .eq('channel_id', message.channel_id)
      .eq('token_type', 'whapi')
      .single()

    if (!tokenData?.encrypted_token) {
      return NextResponse.json({
        error: 'No token found for this channel',
      }, { status: 500 })
    }

    const whapiToken = decrypt(tokenData.encrypted_token)

    // Try to fetch media using the message ID
    console.log('[Media Fetch] Fetching media for message:', message.wa_message_id)

    // Strategy 1: Fetch full message to get media with link
    let mediaUrl: string | null = null
    let mediaMetadata: Record<string, any> = message.media_metadata || {}
    let storagePath: string | null = null

    try {
      const messageResponse = await fetch(
        `https://gate.whapi.cloud/messages/${message.wa_message_id}`,
        {
          headers: {
            'Authorization': `Bearer ${whapiToken}`,
            'Content-Type': 'application/json',
          },
        }
      )

      if (messageResponse.ok) {
        const messageData = await messageResponse.json()
        console.log('[Media Fetch] Got message data, keys:', Object.keys(messageData))

        // Try to extract media URL from various locations
        const mediaObject =
          messageData.image ||
          messageData.video ||
          messageData.audio ||
          messageData.voice ||
          messageData.ptt ||
          messageData.document ||
          messageData.sticker

        if (mediaObject) {
          mediaUrl = mediaObject.link || mediaObject.url || mediaObject.media_url
          mediaMetadata = {
            ...mediaMetadata,
            mime_type: mediaObject.mime_type || mediaObject.mimetype,
            size: mediaObject.size || mediaObject.file_size,
            filename: mediaObject.filename,
            width: mediaObject.width,
            height: mediaObject.height,
            duration: mediaObject.duration || mediaObject.seconds,
            id: mediaObject.id,
          }
        }
      }
    } catch (error) {
      console.error('[Media Fetch] Error fetching message:', error)
    }

    // Strategy 2: If we got a media ID but no URL, try downloading
    const mediaId = mediaMetadata?.id || message.media_metadata?.id
    if (!mediaUrl && mediaId) {
      console.log('[Media Fetch] Trying to download media:', mediaId)

      try {
        const downloadResponse = await fetch(
          `https://gate.whapi.cloud/media/${mediaId}`,
          {
            headers: {
              'Authorization': `Bearer ${whapiToken}`,
              'Accept': '*/*',
            },
          }
        )

        if (downloadResponse.ok) {
          const contentType = downloadResponse.headers.get('content-type') || 'application/octet-stream'

          // Check if response is JSON or binary
          if (contentType.includes('application/json')) {
            const jsonData = await downloadResponse.json()
            mediaUrl = jsonData.link || jsonData.url
          } else {
            // It's binary, upload to Supabase Storage
            const blob = await downloadResponse.blob()
            const arrayBuffer = await blob.arrayBuffer()
            const buffer = Buffer.from(arrayBuffer)

            const channels = message.channels as unknown as { id: string; workspace_id: string }[]
            const channel = channels[0]
            const extension = getExtensionFromMimeType(contentType)
            const filename = `${mediaId}${extension}`
            storagePath = `workspaces/${channel.workspace_id}/${message.message_type}/${filename}`

            console.log('[Media Fetch] Uploading to storage:', storagePath)

            const { error: uploadError } = await serviceClient.storage
              .from('media')
              .upload(storagePath, buffer, {
                contentType,
                upsert: true,
              })

            if (!uploadError) {
              const { data: urlData } = serviceClient.storage
                .from('media')
                .getPublicUrl(storagePath)

              mediaUrl = urlData.publicUrl
              mediaMetadata = {
                ...mediaMetadata,
                mime_type: contentType,
                size: buffer.length,
                stored: true,
              }
            } else {
              console.error('[Media Fetch] Upload error:', uploadError)
            }
          }
        }
      } catch (error) {
        console.error('[Media Fetch] Error downloading media:', error)
      }
    }

    if (!mediaUrl) {
      return NextResponse.json({
        success: false,
        error: 'Could not fetch media for this message',
      }, { status: 404 })
    }

    // Update the message with the new media URL
    const updateData: Record<string, any> = {
      media_url: mediaUrl,
      media_metadata: mediaMetadata,
    }
    if (storagePath) {
      updateData.storage_path = storagePath
    }

    const { error: updateError } = await serviceClient
      .from('messages')
      .update(updateData)
      .eq('id', messageId)

    if (updateError) {
      console.error('[Media Fetch] Update error:', updateError)
    }

    return NextResponse.json({
      success: true,
      media_url: mediaUrl,
      storage_path: storagePath,
      media_metadata: mediaMetadata,
    })
  } catch (error) {
    console.error('Message media fetch error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/3gpp': '.3gp',
    'audio/ogg': '.ogg',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/amr': '.amr',
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  }
  return mimeToExt[mimeType] || ''
}
