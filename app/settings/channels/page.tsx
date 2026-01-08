'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { ChannelList } from '@/components/channel-list'
import { AddChannelDialog } from '@/components/add-channel-dialog'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

interface Channel {
  id: string
  name: string
  phone_number: string | null
}

interface SyncSettings {
  sync_channel_id: string | null
  last_synced_at: string | null
  google_contacts_token: string | null
}

export default function ChannelSettingsPage() {
  const router = useRouter()
  const supabase = createClient()
  const queryClient = useQueryClient()
  const [isMainAdmin, setIsMainAdmin] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    checkUserRole()
  }, [])

  const checkUserRole = async () => {
    setLoading(true)
    try {
      // Get current user
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push('/login')
        return
      }

      // Get user profile to check role
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('user_id', user.id)
        .single()

      setIsMainAdmin(profile?.role === 'main_admin')
      setIsAdmin(['main_admin', 'admin'].includes(profile?.role || ''))
    } catch (error) {
      // Error checking user role - redirect to login
    } finally {
      setLoading(false)
    }
  }

  const handleChannelAdded = () => {
    // Refresh the channel list by incrementing the key
    setRefreshKey((prev) => prev + 1)
  }

  // Fetch channels for sync dropdown
  const { data: channels } = useQuery({
    queryKey: ['channels'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('channels')
        .select('id, name, phone_number')
        .order('name')
      if (error) throw error
      return data as Channel[]
    },
    enabled: !loading,
  })

  // Fetch sync settings
  const { data: syncSettings, isLoading: syncLoading } = useQuery({
    queryKey: ['workspace-sync-settings'],
    queryFn: async () => {
      const response = await fetch('/api/workspaces/sync-settings')
      if (!response.ok) throw new Error('Failed to fetch sync settings')
      const data = await response.json()
      return data.sync_settings as SyncSettings
    },
    enabled: !loading && isAdmin,
  })

  // Update sync channel mutation
  const updateSyncChannel = useMutation({
    mutationFn: async (channelId: string | null) => {
      const response = await fetch('/api/workspaces/sync-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sync_channel_id: channelId }),
      })
      if (!response.ok) throw new Error('Failed to update sync settings')
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-sync-settings'] })
    },
  })

  // Google Contacts token state
  const [googleToken, setGoogleToken] = useState('')
  const [showTokenInput, setShowTokenInput] = useState(false)

  // Update Google Contacts token mutation
  const updateGoogleToken = useMutation({
    mutationFn: async (token: string) => {
      const response = await fetch('/api/workspaces/sync-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ google_contacts_token: token }),
      })
      if (!response.ok) throw new Error('Failed to save token')
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-sync-settings'] })
      setShowTokenInput(false)
      setGoogleToken('')
    },
  })

  // Sync contacts mutation
  const [syncResult, setSyncResult] = useState<{ created: number; updated: number; skipped: number } | null>(null)
  const syncContacts = useMutation({
    mutationFn: async (channelId: string) => {
      const response = await fetch(`/api/channels/${channelId}/whapi-contacts/sync`, {
        method: 'POST',
      })
      if (!response.ok) throw new Error('Failed to sync contacts')
      return response.json()
    },
    onSuccess: (data) => {
      setSyncResult(data.result)
      queryClient.invalidateQueries({ queryKey: ['workspace-sync-settings'] })
    },
  })

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-pulse text-sm text-muted-foreground">
          Loading...
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1">
      {/* Header */}
      <div className="border-b bg-white">
        <div className="px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Channels</h1>
              <p className="mt-1 text-sm text-gray-500">
                Manage your WhatsApp Business channels
              </p>
            </div>
            {isMainAdmin && (
              <Button onClick={() => setShowAddDialog(true)}>
                Add Channel
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-8">
        <div className="max-w-4xl">
          <ChannelList key={refreshKey} />

          {/* WhatsApp Contacts Sync Section */}
          {isAdmin && (
            <div className="mt-8 border-t pt-8">
              <h2 className="text-lg font-semibold text-gray-900 mb-2">
                WhatsApp Contacts Sync
              </h2>
              <p className="text-sm text-gray-500 mb-4">
                Sync contacts from WhatsApp to your workspace. Choose a channel to use for syncing contacts.
                All contacts will be shared across all channels in your workspace.
              </p>

              <div className="space-y-4 bg-gray-50 rounded-lg p-4">
                {/* Sync Channel Selector */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Sync Channel
                  </label>
                  <select
                    value={syncSettings?.sync_channel_id || ''}
                    onChange={(e) => updateSyncChannel.mutate(e.target.value || null)}
                    disabled={updateSyncChannel.isPending || syncLoading}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500 disabled:bg-gray-100"
                  >
                    <option value="">None (Sync disabled)</option>
                    {channels?.map((channel) => (
                      <option key={channel.id} value={channel.id}>
                        {channel.name} {channel.phone_number ? `(${channel.phone_number})` : ''}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    Contacts will be synced from this channel&apos;s WhatsApp. New contacts you create will also be pushed to this channel.
                  </p>
                </div>

                {/* Google Contacts Token */}
                {syncSettings?.sync_channel_id && (
                  <div className="border-t pt-4 mt-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Google Contacts Connection Token
                    </label>
                    {syncSettings?.google_contacts_token ? (
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-green-600 flex items-center gap-1">
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Token configured
                        </span>
                        <button
                          onClick={() => setShowTokenInput(true)}
                          className="text-sm text-gray-500 hover:text-gray-700 underline"
                        >
                          Update
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowTokenInput(true)}
                        className="text-sm text-blue-600 hover:text-blue-700"
                      >
                        + Add Google Contacts Token
                      </button>
                    )}
                    {showTokenInput && (
                      <div className="mt-2 space-y-2">
                        <input
                          type="text"
                          value={googleToken}
                          onChange={(e) => setGoogleToken(e.target.value)}
                          placeholder="Paste your Google Contacts connection token here..."
                          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                        />
                        <div className="flex gap-2">
                          <Button
                            onClick={() => updateGoogleToken.mutate(googleToken)}
                            disabled={!googleToken.trim() || updateGoogleToken.isPending}
                            size="sm"
                          >
                            {updateGoogleToken.isPending ? 'Saving...' : 'Save Token'}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setShowTokenInput(false)
                              setGoogleToken('')
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                    <p className="mt-1 text-xs text-gray-500">
                      Get this token from Whapi&apos;s Google Contacts integration panel. Required for syncing contacts.
                    </p>
                  </div>
                )}

                {/* Last Synced */}
                {syncSettings?.last_synced_at && (
                  <p className="text-sm text-gray-600">
                    Last synced: {new Date(syncSettings.last_synced_at).toLocaleString()}
                  </p>
                )}

                {/* Sync Button */}
                {syncSettings?.sync_channel_id && syncSettings?.google_contacts_token && (
                  <div className="flex items-center gap-4">
                    <Button
                      onClick={() => syncContacts.mutate(syncSettings.sync_channel_id!)}
                      disabled={syncContacts.isPending}
                      variant="outline"
                    >
                      {syncContacts.isPending ? 'Syncing...' : 'Sync Now'}
                    </Button>

                    {/* Sync Result */}
                    {syncResult && (
                      <div className="text-sm text-gray-600">
                        <span className="text-green-600 font-medium">{syncResult.created} created</span>
                        {' / '}
                        <span className="text-blue-600 font-medium">{syncResult.updated} updated</span>
                        {' / '}
                        <span className="text-gray-500">{syncResult.skipped} skipped</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Error */}
                {(updateSyncChannel.isError || syncContacts.isError) && (
                  <p className="text-sm text-red-600">
                    {updateSyncChannel.error?.message || syncContacts.error?.message || 'An error occurred'}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add Channel Dialog */}
      <AddChannelDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onSuccess={handleChannelAdded}
      />
    </div>
  )
}
