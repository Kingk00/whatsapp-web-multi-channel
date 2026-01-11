import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { validateApiAuth } from '@/lib/auth-helpers'

/**
 * GET /api/chats/[id]/draft
 * Fetch bot draft for a chat (semi mode)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Authenticate user - will verify chat access via workspace membership
    const supabase = await createClient()

    // Get draft
    const { data: draft, error } = await supabase
      .from('chat_drafts')
      .select(`
        id,
        chat_id,
        learning_log_id,
        draft_text,
        intent,
        confidence,
        source_message_id,
        created_at,
        expires_at
      `)
      .eq('chat_id', id)
      .gt('expires_at', new Date().toISOString())
      .single()

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows returned, which is expected for chats without drafts
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ draft: draft || null })
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
 * POST /api/chats/[id]/draft
 * Called when sending after applying a draft - logs the edit for learning
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Authenticate user
    const supabase = await createClient()

    const body = await request.json()
    const { final_text } = body

    if (!final_text) {
      return NextResponse.json(
        { error: 'final_text is required' },
        { status: 400 }
      )
    }

    // Get current draft
    const { data: draft } = await supabase
      .from('chat_drafts')
      .select('*')
      .eq('chat_id', id)
      .single()

    if (!draft) {
      return NextResponse.json({ had_draft: false, was_edited: false })
    }

    const wasEdited = draft.draft_text !== final_text

    // Update learning log if there's a linked log entry
    if (draft.learning_log_id) {
      const editDelta = {
        original_length: draft.draft_text.length,
        final_length: final_text.length,
        was_modified: wasEdited,
        kept_original: !wasEdited,
      }

      const responseTimeMs = Date.now() - new Date(draft.created_at).getTime()

      const serviceSupabase = createServiceRoleClient()
      await serviceSupabase
        .from('bot_learning_log')
        .update({
          actual_reply_text: final_text,
          was_edited: wasEdited,
          edit_delta: editDelta,
          was_approved: true,
          responded_at: new Date().toISOString(),
          response_time_ms: responseTimeMs,
        })
        .eq('id', draft.learning_log_id)
    }

    // Clear the draft
    await supabase.from('chat_drafts').delete().eq('chat_id', id)

    return NextResponse.json({
      had_draft: true,
      was_edited: wasEdited,
    })
  } catch (error) {
    if (error instanceof Response) {
      return error
    }
    console.error('Draft send error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/chats/[id]/draft
 * Dismiss/clear a draft without sending
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Authenticate user
    const supabase = await createClient()

    // Get draft to update learning log
    const { data: draft } = await supabase
      .from('chat_drafts')
      .select('learning_log_id')
      .eq('chat_id', id)
      .single()

    if (draft?.learning_log_id) {
      // Mark as not approved in learning log
      const serviceSupabase = createServiceRoleClient()
      await serviceSupabase
        .from('bot_learning_log')
        .update({ was_approved: false })
        .eq('id', draft.learning_log_id)
    }

    // Delete the draft
    await supabase.from('chat_drafts').delete().eq('chat_id', id)

    return NextResponse.json({ success: true })
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
