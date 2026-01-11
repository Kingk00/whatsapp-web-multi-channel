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
  status: string
  color: string | null
}

interface SyncSettings {
  sync_channel_id: string | null
  last_synced_at: string | null
  google_contacts_token: string | null
}

interface GoogleSyncStatus {
  configured: boolean
  connected: boolean
  last_synced?: string
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

  // Fetch channels for sync section
  const { data: channels } = useQuery({
    queryKey: ['channels'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('channels')
        .select('id, name, phone_number, status, color')
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

  // Sync contacts mutation (Whapi) - per channel
  const [syncResults, setSyncResults] = useState<Record<string, { created: number; updated: number; skipped: number }>>({})
  const [syncingChannelId, setSyncingChannelId] = useState<string | null>(null)
  const syncContacts = useMutation({
    mutationFn: async (channelId: string) => {
      setSyncingChannelId(channelId)
      const response = await fetch(`/api/channels/${channelId}/whapi-contacts/sync`, {
        method: 'POST',
      })
      if (!response.ok) throw new Error('Failed to sync contacts')
      return { channelId, ...(await response.json()) }
    },
    onSuccess: (data) => {
      setSyncResults((prev) => ({ ...prev, [data.channelId]: data.result }))
      setSyncingChannelId(null)
      queryClient.invalidateQueries({ queryKey: ['workspace-sync-settings'] })
    },
    onError: () => {
      setSyncingChannelId(null)
    },
  })

  // Google sync status query
  const { data: googleSyncStatus } = useQuery({
    queryKey: ['google-sync-status'],
    queryFn: async () => {
      const response = await fetch('/api/contacts/sync/google')
      if (!response.ok) return { configured: false, connected: false }
      return response.json() as Promise<GoogleSyncStatus>
    },
    enabled: !loading && isAdmin,
  })

  // Google sync mutation
  const [googleSyncResult, setGoogleSyncResult] = useState<{ created: number; updated: number; skipped: number } | null>(null)
  const syncGoogleContacts = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/contacts/sync/google', {
        method: 'POST',
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to sync Google contacts')
      }
      return response.json()
    },
    onSuccess: (data) => {
      setGoogleSyncResult(data.result)
      queryClient.invalidateQueries({ queryKey: ['google-sync-status'] })
    },
  })

  // Start Google OAuth flow
  const [googleConnecting, setGoogleConnecting] = useState(false)
  const connectGoogle = async () => {
    setGoogleConnecting(true)
    try {
      const response = await fetch('/api/contacts/import/google', {
        method: 'POST',
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to start Google import')
      }
      window.location.href = data.authUrl
    } catch (error) {
      console.error('Google connect error:', error)
      setGoogleConnecting(false)
    }
  }

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
                Sync contacts from any WhatsApp channel to your workspace.
                All contacts will be shared across all channels in your workspace.
              </p>

              {/* Channel List for Sync */}
              <div className="space-y-3">
                {channels && channels.length > 0 ? (
                  channels.map((channel) => {
                    const isActive = channel.status === 'active'
                    const isSyncing = syncingChannelId === channel.id
                    const result = syncResults[channel.id]

                    return (
                      <div
                        key={channel.id}
                        className="flex items-center justify-between bg-gray-50 rounded-lg p-4 border border-gray-200"
                      >
                        <div className="flex items-center gap-3">
                          {/* Channel color indicator */}
                          <div
                            className="h-10 w-10 rounded-full flex items-center justify-center text-white font-medium text-sm"
                            style={{ backgroundColor: channel.color || '#25D366' }}
                          >
                            {channel.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-gray-900">{channel.name}</span>
                              {/* Status indicator */}
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                                  isActive
                                    ? 'bg-green-100 text-green-700'
                                    : 'bg-gray-100 text-gray-600'
                                }`}
                              >
                                <span
                                  className={`h-1.5 w-1.5 rounded-full ${
                                    isActive ? 'bg-green-500' : 'bg-gray-400'
                                  }`}
                                />
                                {channel.status}
                              </span>
                            </div>
                            {channel.phone_number && (
                              <span className="text-sm text-gray-500">{channel.phone_number}</span>
                            )}
                            {/* Sync result for this channel */}
                            {result && (
                              <div className="text-xs text-gray-600 mt-1">
                                <span className="text-green-600 font-medium">{result.created} created</span>
                                {' / '}
                                <span className="text-blue-600 font-medium">{result.updated} updated</span>
                                {' / '}
                                <span className="text-gray-500">{result.skipped} skipped</span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Sync button */}
                        <Button
                          onClick={() => syncContacts.mutate(channel.id)}
                          disabled={!isActive || isSyncing || syncContacts.isPending}
                          variant="outline"
                          size="sm"
                          title={!isActive ? 'Channel must be active to sync' : 'Sync contacts from this channel'}
                        >
                          {isSyncing ? (
                            <>
                              <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                              </svg>
                              Syncing...
                            </>
                          ) : (
                            <>
                              <svg className="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                              Sync
                            </>
                          )}
                        </Button>
                      </div>
                    )
                  })
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <p>No channels available. Add a channel to sync contacts.</p>
                  </div>
                )}
              </div>

              {/* Error */}
              {syncContacts.isError && (
                <p className="text-sm text-red-600 mt-3">
                  {syncContacts.error?.message || 'An error occurred while syncing'}
                </p>
              )}

              {/* Google Contacts Token - now separate section */}
              <div className="mt-6 border-t pt-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Google Contacts Connection Token (Optional)
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
                  Get this token from Whapi&apos;s Google Contacts integration panel. Required for pushing new contacts to Google Contacts.
                </p>
              </div>
            </div>
          )}

          {/* Google Contacts Sync Section */}
          {isAdmin && googleSyncStatus?.configured && (
            <div className="mt-8 border-t pt-8">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">
                    Google Contacts Sync
                  </h2>
                  <p className="text-sm text-gray-500">
                    Sync contacts directly from your Google account
                  </p>
                </div>
                {googleSyncStatus.connected && (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-green-100 rounded-full">
                    <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-sm font-medium text-green-700">Linked</span>
                  </div>
                )}
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                {/* Connection Status */}
                {googleSyncStatus.connected ? (
                  <div className="space-y-4">
                    {/* Status Card */}
                    <div className="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-200">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-white border border-gray-200 flex items-center justify-center">
                          <svg className="h-5 w-5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                          </svg>
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">Google Contacts</p>
                          <p className="text-xs text-gray-500">
                            {googleSyncStatus.last_synced ? (
                              <>Last synced: {new Date(googleSyncStatus.last_synced).toLocaleString()}</>
                            ) : (
                              'Never synced'
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          onClick={() => syncGoogleContacts.mutate()}
                          disabled={syncGoogleContacts.isPending}
                          size="sm"
                        >
                          {syncGoogleContacts.isPending ? (
                            <>
                              <div className="h-3 w-3 mr-2 animate-spin rounded-full border-2 border-white border-t-transparent" />
                              Syncing...
                            </>
                          ) : (
                            'Sync Now'
                          )}
                        </Button>
                      </div>
                    </div>

                    {/* Sync Result */}
                    {googleSyncResult && (
                      <div className="flex items-center gap-4 text-sm p-3 bg-white rounded-lg border border-gray-200">
                        <span className="text-gray-500">Last sync result:</span>
                        <span className="text-green-600 font-medium">{googleSyncResult.created} created</span>
                        <span className="text-blue-600 font-medium">{googleSyncResult.updated} updated</span>
                        <span className="text-gray-500">{googleSyncResult.skipped} skipped</span>
                      </div>
                    )}

                    {/* Error */}
                    {syncGoogleContacts.isError && (
                      <div className="p-3 bg-red-50 rounded-lg border border-red-200">
                        <p className="text-sm text-red-600">
                          {syncGoogleContacts.error?.message || 'An error occurred'}
                        </p>
                      </div>
                    )}

                    {/* Reconnect option */}
                    <div className="pt-2 border-t border-gray-200">
                      <button
                        onClick={connectGoogle}
                        disabled={googleConnecting}
                        className="text-sm text-gray-500 hover:text-gray-700"
                      >
                        {googleConnecting ? 'Connecting...' : 'Reconnect Google account'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <div className="h-12 w-12 mx-auto mb-3 rounded-full bg-gray-100 flex items-center justify-center">
                      <svg className="h-6 w-6 text-gray-400" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                        <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                      </svg>
                    </div>
                    <p className="text-sm text-gray-600 mb-4">
                      Connect your Google account to sync contacts. You only need to do this once.
                    </p>
                    <Button
                      onClick={connectGoogle}
                      disabled={googleConnecting}
                      className="flex items-center gap-2 mx-auto"
                    >
                      {googleConnecting ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      ) : (
                        <svg className="h-4 w-4" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                          <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                          <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                          <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                          <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                        </svg>
                      )}
                      Connect Google Account
                    </Button>
                  </div>
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
