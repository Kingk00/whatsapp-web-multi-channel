import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { validateApiAuth } from '@/lib/auth-helpers'
import { syncContactsFromWhapi } from '@/lib/whapi-contacts-sync'

/**
 * POST /api/channels/[id]/whapi-contacts/sync
 *
 * Sync contacts from Whapi to the workspace.
 * This sets the channel as the sync channel and pulls contacts.
 * Requires admin role.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: channelId } = await params

    // Authenticate user and verify admin role
    const { profile } = await validateApiAuth({ channelId })

    // Only admins can sync contacts
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

    // Perform the sync
    const result = await syncContactsFromWhapi(profile.workspace_id, channelId)

    // Return sync results
    return NextResponse.json({
      success: true,
      result: {
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        errors: result.errors.length > 0 ? result.errors : undefined,
      },
    })
  } catch (error) {
    if (error instanceof Response) {
      return error
    }
    console.error('Whapi contacts sync error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
