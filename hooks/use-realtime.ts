'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'
import { RealtimeChannel, RealtimePostgresChangesPayload, REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js'

// ============================================================================
// Types
// ============================================================================

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting'

interface RealtimeState {
  status: ConnectionStatus
  lastConnected: Date | null
  reconnectAttempts: number
  error: Error | null
}

interface UseRealtimeOptions {
  onStatusChange?: (status: ConnectionStatus) => void
  onError?: (error: Error) => void
  maxReconnectAttempts?: number
  baseReconnectDelay?: number
}

interface SubscriptionConfig {
  event: 'INSERT' | 'UPDATE' | 'DELETE' | '*'
  schema?: string
  table: string
  filter?: string
  callback: (payload: RealtimePostgresChangesPayload<any>) => void
}

// ============================================================================
// Connection Status Hook
// ============================================================================

/**
 * Hook to monitor and manage realtime connection status
 */
export function useConnectionStatus(options: UseRealtimeOptions = {}) {
  const {
    onStatusChange,
    onError,
    maxReconnectAttempts = 10,
    baseReconnectDelay = 1000,
  } = options

  const [state, setState] = useState<RealtimeState>({
    status: 'connecting',
    lastConnected: null,
    reconnectAttempts: 0,
    error: null,
  })

  const supabaseRef = useRef(createBrowserClient())
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const updateStatus = useCallback(
    (status: ConnectionStatus, error?: Error) => {
      setState((prev) => ({
        ...prev,
        status,
        error: error || null,
        lastConnected: status === 'connected' ? new Date() : prev.lastConnected,
        reconnectAttempts:
          status === 'connected' ? 0 : status === 'reconnecting' ? prev.reconnectAttempts + 1 : prev.reconnectAttempts,
      }))
      onStatusChange?.(status)
      if (error) {
        onError?.(error)
      }
    },
    [onStatusChange, onError]
  )

  const attemptReconnect = useCallback(() => {
    const currentAttempts = state.reconnectAttempts

    if (currentAttempts >= maxReconnectAttempts) {
      updateStatus('disconnected', new Error('Max reconnection attempts reached'))
      return
    }

    // Exponential backoff with jitter
    const delay = Math.min(
      baseReconnectDelay * Math.pow(2, currentAttempts) + Math.random() * 1000,
      30000 // Max 30 seconds
    )

    updateStatus('reconnecting')

    reconnectTimeoutRef.current = setTimeout(async () => {
      try {
        // Force reconnect by removing and re-adding all channels
        const channels = supabaseRef.current.getChannels()
        for (const channel of channels) {
          await supabaseRef.current.removeChannel(channel)
        }

        // Re-initialize connection
        const testChannel = supabaseRef.current.channel('connection-test')
        testChannel
          .on('system', { event: '*' }, (payload: { type: string }) => {
            if (payload.type === 'connected') {
              updateStatus('connected')
              supabaseRef.current.removeChannel(testChannel)
            }
          })
          .subscribe((status: `${REALTIME_SUBSCRIBE_STATES}`) => {
            if (status === 'SUBSCRIBED') {
              updateStatus('connected')
            } else if (status === 'CHANNEL_ERROR') {
              attemptReconnect()
            }
          })
      } catch (error) {
        attemptReconnect()
      }
    }, delay)
  }, [state.reconnectAttempts, maxReconnectAttempts, baseReconnectDelay, updateStatus])

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => {
      if (state.status === 'disconnected') {
        attemptReconnect()
      }
    }

    const handleOffline = () => {
      updateStatus('disconnected')
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [state.status, attemptReconnect, updateStatus])

  // Heartbeat to detect silent disconnections
  useEffect(() => {
    heartbeatIntervalRef.current = setInterval(() => {
      // Check if we have any active subscriptions
      const channels = supabaseRef.current.getChannels()
      const hasActiveChannels = channels.some(
        (ch: RealtimeChannel) => ch.state === 'joined' || ch.state === 'joining'
      )

      if (state.status === 'connected' && !hasActiveChannels && channels.length > 0) {
        // We think we're connected but have no active channels
        updateStatus('disconnected')
        attemptReconnect()
      }
    }, 30000) // Check every 30 seconds

    return () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current)
      }
    }
  }, [state.status, attemptReconnect, updateStatus])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current)
      }
    }
  }, [])

  return {
    ...state,
    supabase: supabaseRef.current,
    reconnect: attemptReconnect,
  }
}

// ============================================================================
// Subscription Hook
// ============================================================================

/**
 * Hook to subscribe to realtime changes with automatic reconnection
 */
export function useRealtimeSubscription(
  channelName: string,
  subscriptions: SubscriptionConfig[],
  options: {
    enabled?: boolean
    onSubscribed?: () => void
    onError?: (error: Error) => void
  } = {}
) {
  const { enabled = true, onSubscribed, onError } = options

  const supabaseRef = useRef(createBrowserClient())
  const channelRef = useRef<RealtimeChannel | null>(null)
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!enabled || subscriptions.length === 0) {
      return
    }

    const supabase = supabaseRef.current
    let channel = supabase.channel(channelName)

    // Add all subscriptions
    for (const sub of subscriptions) {
      channel = channel.on(
        'postgres_changes' as any,
        {
          event: sub.event,
          schema: sub.schema || 'public',
          table: sub.table,
          filter: sub.filter,
        },
        sub.callback
      )
    }

    // Subscribe with status handling
    channel.subscribe((status: `${REALTIME_SUBSCRIBE_STATES}`, err?: Error) => {
      if (status === 'SUBSCRIBED') {
        setIsSubscribed(true)
        setError(null)
        onSubscribed?.()
      } else if (status === 'CHANNEL_ERROR') {
        setIsSubscribed(false)
        const error = new Error(err?.message || 'Subscription error')
        setError(error)
        onError?.(error)
      } else if (status === 'CLOSED') {
        setIsSubscribed(false)
      }
    })

    channelRef.current = channel

    // Cleanup
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
      setIsSubscribed(false)
    }
  }, [channelName, enabled, subscriptions, onSubscribed, onError])

  return {
    isSubscribed,
    error,
    channel: channelRef.current,
  }
}

// ============================================================================
// Chat-specific Realtime Hook
// ============================================================================

/**
 * Hook for subscribing to chat messages with reconnection support
 */
export function useChatRealtime(
  chatId: string | null,
  onNewMessage: (message: any) => void,
  onMessageUpdate?: (message: any) => void
) {
  const subscriptions: SubscriptionConfig[] = chatId
    ? [
        {
          event: 'INSERT',
          table: 'messages',
          filter: `chat_id=eq.${chatId}`,
          callback: (payload: RealtimePostgresChangesPayload<any>) => onNewMessage(payload.new),
        },
        ...(onMessageUpdate
          ? [
              {
                event: 'UPDATE' as const,
                table: 'messages',
                filter: `chat_id=eq.${chatId}`,
                callback: (payload: RealtimePostgresChangesPayload<any>) => onMessageUpdate(payload.new),
              },
            ]
          : []),
      ]
    : []

  return useRealtimeSubscription(`chat:${chatId}`, subscriptions, {
    enabled: !!chatId,
  })
}

// ============================================================================
// Channel Status Hook
// ============================================================================

/**
 * Hook for subscribing to channel status changes
 */
export function useChannelStatusRealtime(
  channelId: string | null,
  onStatusChange: (channel: any) => void
) {
  const subscriptions: SubscriptionConfig[] = channelId
    ? [
        {
          event: 'UPDATE',
          table: 'channels',
          filter: `id=eq.${channelId}`,
          callback: (payload: RealtimePostgresChangesPayload<any>) => onStatusChange(payload.new),
        },
      ]
    : []

  return useRealtimeSubscription(`channel-status:${channelId}`, subscriptions, {
    enabled: !!channelId,
  })
}

// ============================================================================
// Inbox Realtime Hook
// ============================================================================

/**
 * Hook for subscribing to inbox updates (new chats, chat updates)
 */
export function useInboxRealtime(
  channelIds: string[],
  onChatUpdate: (chat: any) => void,
  onNewChat?: (chat: any) => void
) {
  const filter = channelIds.length > 0 ? `channel_id=in.(${channelIds.join(',')})` : undefined

  const subscriptions: SubscriptionConfig[] = channelIds.length > 0
    ? [
        {
          event: 'UPDATE',
          table: 'chats',
          filter,
          callback: (payload: RealtimePostgresChangesPayload<any>) => onChatUpdate(payload.new),
        },
        ...(onNewChat
          ? [
              {
                event: 'INSERT' as const,
                table: 'chats',
                filter,
                callback: (payload: RealtimePostgresChangesPayload<any>) => onNewChat(payload.new),
              },
            ]
          : []),
      ]
    : []

  return useRealtimeSubscription('inbox', subscriptions, {
    enabled: channelIds.length > 0,
  })
}
