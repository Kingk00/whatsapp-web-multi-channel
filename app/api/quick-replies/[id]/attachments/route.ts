import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

/**
 * POST /api/quick-replies/[id]/attachments
 *
 * Upload an attachment to a quick reply.
 * Accepts FormData with:
 * - file: The file to upload
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: quickReplyId } = await params
    const supabase = await createClient()
    const serviceSupabase = createServiceRoleClient()

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's workspace
    const { data: profile } = await supabase
      .from('profiles')
      .select('workspace_id')
      .eq('user_id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Verify quick reply exists and belongs to workspace
    const { data: quickReply, error: qrError } = await supabase
      .from('quick_replies')
      .select('id, workspace_id')
      .eq('id', quickReplyId)
      .eq('workspace_id', profile.workspace_id)
      .single()

    if (qrError || !quickReply) {
      return NextResponse.json({ error: 'Quick reply not found' }, { status: 404 })
    }

    // Parse form data
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'File size must be less than 10MB' },
        { status: 400 }
      )
    }

    // Determine attachment kind
    const mimeType = file.type
    let kind: 'image' | 'video' | 'audio' | 'document' = 'document'
    if (mimeType.startsWith('image/')) kind = 'image'
    else if (mimeType.startsWith('video/')) kind = 'video'
    else if (mimeType.startsWith('audio/')) kind = 'audio'

    // Generate storage path
    const timestamp = Date.now()
    const sanitizedFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
    const storagePath = `quick-replies/${quickReplyId}/${timestamp}-${sanitizedFilename}`

    // Upload to Supabase Storage
    const fileBuffer = await file.arrayBuffer()
    const { error: uploadError } = await serviceSupabase.storage
      .from('attachments')
      .upload(storagePath, fileBuffer, {
        contentType: mimeType,
        upsert: false,
      })

    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      return NextResponse.json(
        { error: 'Failed to upload file' },
        { status: 500 }
      )
    }

    // Get current max sort order
    const { data: existingAttachments } = await supabase
      .from('quick_reply_attachments')
      .select('sort_order')
      .eq('quick_reply_id', quickReplyId)
      .order('sort_order', { ascending: false })
      .limit(1)

    const sortOrder = existingAttachments?.[0]?.sort_order
      ? existingAttachments[0].sort_order + 1
      : 0

    // Create attachment record
    const { data: attachment, error: insertError } = await serviceSupabase
      .from('quick_reply_attachments')
      .insert({
        quick_reply_id: quickReplyId,
        kind,
        storage_path: storagePath,
        filename: file.name,
        mime_type: mimeType,
        sort_order: sortOrder,
      })
      .select()
      .single()

    if (insertError) {
      console.error('Attachment insert error:', insertError)
      // Try to clean up uploaded file
      await serviceSupabase.storage.from('attachments').remove([storagePath])
      return NextResponse.json(
        { error: 'Failed to create attachment record' },
        { status: 500 }
      )
    }

    // Get public URL for the attachment
    const { data: urlData } = serviceSupabase.storage
      .from('attachments')
      .getPublicUrl(storagePath)

    return NextResponse.json({
      attachment: {
        ...attachment,
        url: urlData?.publicUrl,
      },
    }, { status: 201 })
  } catch (error) {
    console.error('Attachment upload error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/quick-replies/[id]/attachments
 *
 * Delete an attachment from a quick reply.
 * Query params:
 * - attachment_id: The ID of the attachment to delete
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: quickReplyId } = await params
    const supabase = await createClient()
    const serviceSupabase = createServiceRoleClient()

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's workspace
    const { data: profile } = await supabase
      .from('profiles')
      .select('workspace_id')
      .eq('user_id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Get attachment ID from query params
    const { searchParams } = new URL(request.url)
    const attachmentId = searchParams.get('attachment_id')

    if (!attachmentId) {
      return NextResponse.json(
        { error: 'Attachment ID is required' },
        { status: 400 }
      )
    }

    // Verify quick reply and attachment exist
    const { data: quickReply } = await supabase
      .from('quick_replies')
      .select('id, workspace_id')
      .eq('id', quickReplyId)
      .eq('workspace_id', profile.workspace_id)
      .single()

    if (!quickReply) {
      return NextResponse.json({ error: 'Quick reply not found' }, { status: 404 })
    }

    // Get attachment
    const { data: attachment } = await supabase
      .from('quick_reply_attachments')
      .select('id, storage_path')
      .eq('id', attachmentId)
      .eq('quick_reply_id', quickReplyId)
      .single()

    if (!attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
    }

    // Delete from storage
    if (attachment.storage_path) {
      await serviceSupabase.storage
        .from('attachments')
        .remove([attachment.storage_path])
    }

    // Delete attachment record
    const { error: deleteError } = await serviceSupabase
      .from('quick_reply_attachments')
      .delete()
      .eq('id', attachmentId)

    if (deleteError) {
      console.error('Attachment delete error:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete attachment' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Attachment delete error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
