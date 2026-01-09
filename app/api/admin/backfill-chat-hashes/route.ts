import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { createHash } from 'crypto'
import { normalizePhoneNumber } from '@/lib/phone-utils'

/**
 * POST /api/admin/backfill-chat-hashes
 *
 * Backfills phone_e164_hash for existing chats that have phone_number but no hash.
 * This triggers the auto_link_chat_to_contact trigger for each updated chat.
 *
 * Requires admin role.
 */
export async function POST(request: NextRequest) {
  try {
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

    // Get user's profile and verify admin role
    const { data: profile } = await supabase
      .from('profiles')
      .select('workspace_id, role')
      .eq('user_id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Only admins can run backfill
    if (!['main_admin', 'admin'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Find all chats with phone_number but no phone_e164_hash
    const { data: chats, error: fetchError } = await serviceSupabase
      .from('chats')
      .select('id, phone_number')
      .eq('workspace_id', profile.workspace_id)
      .not('phone_number', 'is', null)
      .is('phone_e164_hash', null)

    if (fetchError) {
      console.error('Error fetching chats:', fetchError)
      return NextResponse.json({ error: 'Failed to fetch chats' }, { status: 500 })
    }

    if (!chats || chats.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No chats need backfilling',
        updated: 0,
        linked: 0,
      })
    }

    let updated = 0
    let linked = 0

    // Process in batches to avoid timeout
    const batchSize = 100
    for (let i = 0; i < chats.length; i += batchSize) {
      const batch = chats.slice(i, i + batchSize)

      for (const chat of batch) {
        const normalizedPhone = normalizePhoneNumber(chat.phone_number!)
        if (!normalizedPhone) continue

        const phoneHash = createHash('sha256').update(normalizedPhone).digest('hex')

        // Update chat with hash - this will trigger auto_link_chat_to_contact
        const { data: updatedChat, error: updateError } = await serviceSupabase
          .from('chats')
          .update({ phone_e164_hash: phoneHash })
          .eq('id', chat.id)
          .select('contact_id')
          .single()

        if (!updateError) {
          updated++
          if (updatedChat?.contact_id) {
            linked++
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `Backfill complete`,
      total: chats.length,
      updated,
      linked,
    })
  } catch (error) {
    console.error('Backfill error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
