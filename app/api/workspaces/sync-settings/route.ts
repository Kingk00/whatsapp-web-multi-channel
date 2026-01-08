import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { validateApiAuth } from '@/lib/auth-helpers'

/**
 * GET /api/workspaces/sync-settings
 *
 * Get the current workspace's sync settings.
 * Returns the sync channel and last sync time.
 */
export async function GET(request: NextRequest) {
  try {
    // Authenticate user
    const { profile } = await validateApiAuth()

    const supabase = await createClient()

    // Get workspace settings
    const { data: workspace, error } = await supabase
      .from('workspaces')
      .select('settings')
      .eq('id', profile.workspace_id)
      .single()

    if (error || !workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      )
    }

    const syncSettings = workspace.settings?.whapi_contacts_sync || {
      sync_channel_id: null,
      last_synced_at: null,
    }

    return NextResponse.json({ sync_settings: syncSettings })
  } catch (error) {
    if (error instanceof Response) {
      return error
    }
    console.error('Workspace sync settings GET error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/workspaces/sync-settings
 *
 * Update the workspace's sync settings.
 * Allows setting the sync channel ID.
 * Requires admin role.
 */
export async function PATCH(request: NextRequest) {
  try {
    // Authenticate user and require admin role
    const { profile } = await validateApiAuth()

    // Only admins can update sync settings
    if (!['main_admin', 'admin'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { sync_channel_id } = body

    const supabase = createServiceRoleClient()

    // If sync_channel_id provided, verify it exists and belongs to workspace
    if (sync_channel_id) {
      const { data: channel } = await supabase
        .from('channels')
        .select('id')
        .eq('id', sync_channel_id)
        .eq('workspace_id', profile.workspace_id)
        .single()

      if (!channel) {
        return NextResponse.json(
          { error: 'Channel not found or does not belong to this workspace' },
          { status: 404 }
        )
      }
    }

    // Get current workspace settings
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('settings')
      .eq('id', profile.workspace_id)
      .single()

    const currentSettings = workspace?.settings || {}

    // Update workspace settings
    const newSyncSettings = {
      ...currentSettings.whapi_contacts_sync,
      sync_channel_id: sync_channel_id || null,
    }

    const { error: updateError } = await supabase
      .from('workspaces')
      .update({
        settings: {
          ...currentSettings,
          whapi_contacts_sync: newSyncSettings,
        },
      })
      .eq('id', profile.workspace_id)

    if (updateError) {
      console.error('Error updating sync settings:', updateError)
      return NextResponse.json(
        { error: 'Failed to update sync settings' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      sync_settings: newSyncSettings,
    })
  } catch (error) {
    if (error instanceof Response) {
      return error
    }
    console.error('Workspace sync settings PATCH error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
