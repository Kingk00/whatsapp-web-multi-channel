'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ChannelStatusBadge } from '@/components/channel-status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'

interface Channel {
  id: string
  name: string
  phone_number: string | null
  status: 'pending_qr' | 'active' | 'needs_reauth' | 'sync_error' | 'degraded' | 'stopped'
  created_at: string
  last_synced_at: string | null
  webhook_secret: string | null
}

interface ChannelListProps {
  onChannelSelect?: (channelId: string) => void
}

export function ChannelList({ onChannelSelect }: ChannelListProps) {
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [saving, setSaving] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const supabase = createClient()
  const { addToast } = useToast()

  useEffect(() => {
    fetchChannels()
  }, [])

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingId])

  const fetchChannels = async () => {
    setLoading(true)
    setError(null)

    try {
      const { data, error: fetchError } = await supabase
        .from('channels')
        .select('id, name, phone_number, status, created_at, last_synced_at, webhook_secret')
        .order('created_at', { ascending: false })

      if (fetchError) {
        setError(fetchError.message)
        return
      }

      setChannels(data || [])
    } catch (err) {
      setError('Failed to load channels')
    } finally {
      setLoading(false)
    }
  }

  const startEditing = (channel: Channel) => {
    setEditingId(channel.id)
    setEditName(channel.name)
  }

  const cancelEditing = () => {
    setEditingId(null)
    setEditName('')
  }

  const saveChannelName = async (channelId: string) => {
    if (!editName.trim()) {
      addToast('Channel name cannot be empty', 'error')
      return
    }

    setSaving(true)
    try {
      const response = await fetch(`/api/channels/${channelId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim() }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to rename channel')
      }

      // Update local state
      setChannels((prev) =>
        prev.map((ch) =>
          ch.id === channelId ? { ...ch, name: editName.trim() } : ch
        )
      )
      addToast('Channel renamed successfully', 'success')
      cancelEditing()
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to rename channel', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent, channelId: string) => {
    if (e.key === 'Enter') {
      saveChannelName(channelId)
    } else if (e.key === 'Escape') {
      cancelEditing()
    }
  }

  const copyWebhookUrl = async (channel: Channel) => {
    if (!channel.webhook_secret) {
      addToast('Webhook secret not available', 'error')
      return
    }
    const webhookUrl = `${window.location.origin}/api/webhooks/whapi/${channel.id}?secret=${channel.webhook_secret}`
    await navigator.clipboard.writeText(webhookUrl)
    setCopiedId(channel.id)
    addToast('Webhook URL copied! Configure this in Whapi.cloud', 'success')
    setTimeout(() => setCopiedId(null), 2000)
  }

  const [configuringWebhook, setConfiguringWebhook] = useState<string | null>(null)
  const [deletingChannelId, setDeletingChannelId] = useState<string | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const configureWebhook = async (channelId: string) => {
    setConfiguringWebhook(channelId)
    try {
      const response = await fetch(`/api/channels/${channelId}/webhook`, {
        method: 'POST',
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to configure webhook')
      }

      addToast('Webhook configured successfully in Whapi.cloud!', 'success')
      fetchChannels() // Refresh to show updated status
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to configure webhook', 'error')
    } finally {
      setConfiguringWebhook(null)
    }
  }

  const deleteChannel = async (channelId: string) => {
    setDeleteLoading(true)
    try {
      const response = await fetch(`/api/channels/${channelId}`, {
        method: 'DELETE',
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete channel')
      }

      addToast('Channel deleted successfully', 'success')
      setDeletingChannelId(null)
      fetchChannels()
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to delete channel', 'error')
    } finally {
      setDeleteLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-pulse text-sm text-muted-foreground">
          Loading channels...
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-md bg-destructive/10 p-4 text-sm text-destructive">
        Error: {error}
      </div>
    )
  }

  if (channels.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="rounded-full bg-muted p-6 mb-4">
          <svg
            className="h-12 w-12 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
        </div>
        <h3 className="text-lg font-semibold mb-2">No channels connected</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          Get started by adding your first WhatsApp Business channel using a Whapi.cloud token.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {channels.map((channel) => (
        <div
          key={channel.id}
          className="rounded-lg border bg-card p-4 hover:bg-accent/50 transition-colors"
        >
          <div className="flex items-start justify-between">
            <div className="flex-1" onClick={() => !editingId && onChannelSelect?.(channel.id)}>
              <div className="flex items-center gap-3 mb-2">
                {editingId === channel.id ? (
                  <div className="flex items-center gap-2 flex-1">
                    <Input
                      ref={inputRef}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => handleKeyDown(e, channel.id)}
                      className="h-8 max-w-[200px]"
                      disabled={saving}
                    />
                    <Button
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        saveChannelName(channel.id)
                      }}
                      disabled={saving}
                    >
                      {saving ? 'Saving...' : 'Save'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation()
                        cancelEditing()
                      }}
                      disabled={saving}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <>
                    <h3 className="font-semibold">{channel.name}</h3>
                    <ChannelStatusBadge status={channel.status} />
                  </>
                )}
              </div>
              {channel.phone_number && (
                <p className="text-sm text-muted-foreground">
                  {channel.phone_number}
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-2">
                Added {new Date(channel.created_at).toLocaleDateString()}
                {channel.last_synced_at && (
                  <>
                    {' '}· Last sync{' '}
                    {new Date(channel.last_synced_at).toLocaleString()}
                  </>
                )}
              </p>
              {/* Webhook Configuration */}
              <div className="mt-3 p-2 rounded bg-muted/50 border">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Webhook:</span>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="default"
                      onClick={(e) => {
                        e.stopPropagation()
                        configureWebhook(channel.id)
                      }}
                      disabled={configuringWebhook === channel.id}
                      className="h-6 text-xs bg-green-600 hover:bg-green-700"
                    >
                      {configuringWebhook === channel.id ? (
                        <>
                          <svg className="h-3 w-3 mr-1 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Configuring...
                        </>
                      ) : (
                        <>
                          <svg className="h-3 w-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          Configure Webhook
                        </>
                      )}
                    </Button>
                    {channel.webhook_secret && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation()
                          copyWebhookUrl(channel)
                        }}
                        className="h-6 text-xs"
                      >
                        {copiedId === channel.id ? (
                          <>
                            <svg className="h-3 w-3 mr-1 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            Copied!
                          </>
                        ) : (
                          <>
                            <svg className="h-3 w-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                            Copy URL
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Click "Configure Webhook" to automatically set up message receiving in Whapi.cloud
                </p>
              </div>
            </div>
            {editingId !== channel.id && (
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation()
                    startEditing(channel)
                  }}
                  className="text-muted-foreground hover:text-foreground"
                  title="Rename channel"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                    />
                  </svg>
                </Button>
                {deletingChannelId === channel.id ? (
                  <div className="flex items-center gap-1 ml-2">
                    <span className="text-xs text-muted-foreground">Delete?</span>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteChannel(channel.id)
                      }}
                      disabled={deleteLoading}
                      className="h-6 text-xs"
                    >
                      {deleteLoading ? '...' : 'Yes'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeletingChannelId(null)
                      }}
                      disabled={deleteLoading}
                      className="h-6 text-xs"
                    >
                      No
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeletingChannelId(channel.id)
                    }}
                    className="text-destructive hover:text-destructive"
                    title="Delete channel"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
