'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ChannelStatusBadge } from '@/components/channel-status-badge'

interface Channel {
  id: string
  name: string
  phone_number: string | null
  status: 'pending_qr' | 'active' | 'needs_reauth' | 'sync_error' | 'degraded' | 'stopped'
  created_at: string
  last_synced_at: string | null
}

interface ChannelListProps {
  onChannelSelect?: (channelId: string) => void
}

export function ChannelList({ onChannelSelect }: ChannelListProps) {
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

  useEffect(() => {
    fetchChannels()
  }, [])

  const fetchChannels = async () => {
    setLoading(true)
    setError(null)

    try {
      const { data, error: fetchError } = await supabase
        .from('channels')
        .select('id, name, phone_number, status, created_at, last_synced_at')
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
          className="rounded-lg border bg-card p-4 hover:bg-accent/50 transition-colors cursor-pointer"
          onClick={() => onChannelSelect?.(channel.id)}
        >
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h3 className="font-semibold">{channel.name}</h3>
                <ChannelStatusBadge status={channel.status} />
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
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
