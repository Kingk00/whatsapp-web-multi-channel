import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

/**
 * POST /api/chats/[id]/messages/media
 *
 * Send a media message (image, video, audio, document)
 * Supports two modes:
 * 1. File upload: Uses base64 encoding for immediate sending
 * 2. URL: Sends media from an existing URL (for quick replies)
 *
 * FormData (file upload):
 * - file: The media file
 * - caption: Optional caption text
 * - view_once: Optional boolean for view-once media
 *
 * JSON (URL mode):
 * - media_url: URL of the media to send
 * - media_type: Type of media (image, video, audio, document)
 * - caption: Optional caption text
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const chatId = params.id

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check content type to determine if it's a file upload or URL mode
    const contentType = request.headers.get('content-type') || ''
    const isJsonRequest = contentType.includes('application/json')

    let file: File | null = null
    let caption: string | null = null
    let viewOnce = false
    let mediaUrl: string | null = null
    let mediaTypeOverride: string | null = null

    if (isJsonRequest) {
      // URL mode - parse JSON body
      const body = await request.json()
      mediaUrl = body.media_url
      caption = body.caption
      mediaTypeOverride = body.media_type
      viewOnce = body.view_once === true

      if (!mediaUrl) {
        return NextResponse.json({ error: 'media_url is required' }, { status: 400 })
      }
    } else {
      // File upload mode - parse FormData
      const formData = await request.formData()
      file = formData.get('file') as File | null
      caption = formData.get('caption') as string | null
      viewOnce = formData.get('view_once') === 'true'

      if (!file) {
        return NextResponse.json({ error: 'File is required' }, { status: 400 })
      }
    }

    // Validate file size (50MB max) - only for file uploads
    if (file && file.size > 50 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'File size must be less than 50MB' },
        { status: 400 }
      )
    }

    // Get chat and verify access
    const { data: chat, error: chatError } = await supabase
      .from('chats')
      .select('id, workspace_id, channel_id, wa_chat_id')
      .eq('id', chatId)
      .single()

    if (chatError || !chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    // Determine media type
    let mediaType: string | null
    let mediaData: string // Either base64 or URL
    let filename: string = 'media'

    if (file) {
      // File upload mode
      mediaType = getMediaType(file.type)
      if (!mediaType) {
        return NextResponse.json(
          { error: 'Unsupported file type' },
          { status: 400 }
        )
      }
      filename = file.name

      // Convert file to base64
      const arrayBuffer = await file.arrayBuffer()
      const base64 = Buffer.from(arrayBuffer).toString('base64')
      mediaData = `data:${file.type};base64,${base64}`
    } else if (mediaUrl) {
      // URL mode
      mediaType = mediaTypeOverride || inferMediaTypeFromUrl(mediaUrl)
      if (!mediaType) {
        return NextResponse.json(
          { error: 'Could not determine media type. Please provide media_type.' },
          { status: 400 }
        )
      }
      mediaData = mediaUrl
      // Extract filename from URL if possible
      try {
        const urlPath = new URL(mediaUrl).pathname
        filename = urlPath.split('/').pop() || 'media'
      } catch {
        filename = 'media'
      }
    } else {
      return NextResponse.json({ error: 'No media provided' }, { status: 400 })
    }

    // Get API token directly from channels table (bloe-engine approach)
    // DO NOT CHANGE: See IMPLEMENTATION_NOTES.md
    const serviceClient = createServiceRoleClient()
    const { data: channelData } = await serviceClient
      .from('channels')
      .select('api_token')
      .eq('id', chat.channel_id)
      .single()

    if (!channelData?.api_token) {
      return NextResponse.json(
        { error: 'Channel API token not found' },
        { status: 500 }
      )
    }

    // Create pending message for immediate UI feedback
    const tempWaMessageId = `pending_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    // View-once only allowed for images and videos
    const isViewOnce = viewOnce && (mediaType === 'image' || mediaType === 'video')

    const { data: message, error: messageError } = await supabase
      .from('messages')
      .insert({
        workspace_id: chat.workspace_id,
        channel_id: chat.channel_id,
        chat_id: chat.id,
        wa_message_id: tempWaMessageId,
        direction: 'outbound',
        message_type: mediaType,
        text: caption?.trim() || null,
        status: 'pending',
        sender_user_id: user.id,
        is_view_once: isViewOnce,
        media_url: mediaUrl || null, // Store original URL if provided
        media_metadata: file ? {
          filename: file.name,
          size: file.size,
          mime_type: file.type,
        } : {
          filename: filename,
          source: 'quick_reply',
        },
        created_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (messageError) {
      console.error('Error creating message record:', messageError)
    }

    // Send media via Whapi API
    const whapiEndpoint = getWhapiEndpoint(mediaType)
    const whapiPayload = buildWhapiPayload(mediaType, chat.wa_chat_id, mediaData, caption, filename, isViewOnce)

    const whapiResponse = await fetch(whapiEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${channelData.api_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(whapiPayload),
    })

    const whapiResult = await whapiResponse.json()

    if (whapiResult.sent && whapiResult.message?.id) {
      // Update message with real WhatsApp ID
      if (message) {
        await serviceClient
          .from('messages')
          .update({
            wa_message_id: whapiResult.message.id,
            status: 'sent',
            media_url: whapiResult.message.media?.url || null,
          })
          .eq('id', message.id)
      }

      // Update chat's last message
      await supabase
        .from('chats')
        .update({
          last_message_at: new Date().toISOString(),
          last_message_preview: caption?.trim() || `[${mediaType}]`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', chatId)

      return NextResponse.json(
        {
          success: true,
          message: message,
          wa_message_id: whapiResult.message.id,
        },
        { status: 201 }
      )
    } else {
      // Mark message as failed
      if (message) {
        await serviceClient
          .from('messages')
          .update({ status: 'failed' })
          .eq('id', message.id)
      }

      console.error('Whapi media send failed:', whapiResult)
      return NextResponse.json(
        { error: whapiResult.error || 'Failed to send media' },
        { status: 500 }
      )
    }
  } catch (error) {
    console.error('Send media API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Determine media type from MIME type
 */
function getMediaType(mimeType: string): string | null {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  if (
    mimeType === 'application/pdf' ||
    mimeType.startsWith('application/msword') ||
    mimeType.startsWith('application/vnd.') ||
    mimeType === 'text/plain'
  ) {
    return 'document'
  }
  return null
}

/**
 * Infer media type from URL extension
 */
function inferMediaTypeFromUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname.toLowerCase()
    // Image extensions
    if (/\.(jpg|jpeg|png|gif|webp|bmp)$/.test(pathname)) return 'image'
    // Video extensions
    if (/\.(mp4|webm|mov|avi|mkv)$/.test(pathname)) return 'video'
    // Audio extensions
    if (/\.(mp3|wav|ogg|m4a|aac|flac)$/.test(pathname)) return 'audio'
    // Document extensions
    if (/\.(pdf|doc|docx|xls|xlsx|txt|csv)$/.test(pathname)) return 'document'
    return null
  } catch {
    return null
  }
}

/**
 * Get Whapi endpoint for media type
 */
function getWhapiEndpoint(mediaType: string): string {
  const base = 'https://gate.whapi.cloud/messages'
  switch (mediaType) {
    case 'image':
      return `${base}/image`
    case 'video':
      return `${base}/video`
    case 'audio':
      return `${base}/audio`
    case 'document':
      return `${base}/document`
    default:
      return `${base}/document`
  }
}

/**
 * Build Whapi payload for media type
 */
function buildWhapiPayload(
  mediaType: string,
  to: string,
  mediaBase64: string,
  caption: string | null,
  filename: string,
  viewOnce: boolean = false
): Record<string, any> {
  const payload: Record<string, any> = {
    to,
    media: mediaBase64,
  }

  if (caption?.trim()) {
    payload.caption = caption.trim()
  }

  if (mediaType === 'document') {
    payload.filename = filename
  }

  // Whapi supports view_once for images and videos
  if (viewOnce && (mediaType === 'image' || mediaType === 'video')) {
    payload.view_once = true
  }

  return payload
}
