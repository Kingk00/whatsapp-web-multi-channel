'use client'

/**
 * Chat View Component
 *
 * Displays the active chat with:
 * - Chat header with contact info
 * - Message history
 * - Message composer
 */

import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useUIStore } from '@/store/ui-store'
import { queryKeys } from '@/lib/query-client'
import { formatMessageTime, formatMessageDateHeader, isSameDay } from '@/lib/date-utils'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { MessagesSkeleton, ChatHeaderSkeleton } from '@/components/ui/skeleton'

interface Message {
  id: string
  workspace_id: string
  channel_id: string
  chat_id: string
  wa_message_id: string
  direction: 'inbound' | 'outbound'
  message_type: string
  text: string | null
  media_url: string | null
  storage_path: string | null
  media_metadata: any
  is_view_once: boolean
  viewed_at: string | null
  edited_at: string | null
  deleted_at: string | null
  status: string | null
  sender_user_id: string | null
  sender_wa_id: string | null
  sender_name: string | null
  created_at: string
}

interface Chat {
  id: string
  display_name: string | null
  phone_number: string | null
  profile_photo_url: string | null
  is_group: boolean
  channel: {
    id: string
    name: string
    color: string | null
  }
}

interface Presence {
  online: boolean | null
  last_seen: string | null
  presence?: string
  is_typing?: boolean
  is_recording?: boolean
  is_group?: boolean
}

interface ChatViewProps {
  chatId: string
}

export function ChatView({ chatId }: ChatViewProps) {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [shouldScrollToBottom, setShouldScrollToBottom] = useState(true)

  // Fetch chat details
  const { data: chat } = useQuery({
    queryKey: queryKeys.chats.detail(chatId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chats')
        .select(
          `
          id,
          display_name,
          phone_number,
          profile_photo_url,
          is_group,
          channels!inner (
            id,
            name,
            color
          )
        `
        )
        .eq('id', chatId)
        .single()

      if (error) throw error
      return {
        ...data,
        channel: data.channels?.[0] || null,
      } as Chat
    },
  })

  // Fetch presence / last seen
  const { data: presence } = useQuery({
    queryKey: ['presence', chatId],
    queryFn: async () => {
      const response = await fetch(`/api/chats/${chatId}/presence`)
      if (!response.ok) return null
      return response.json() as Promise<Presence>
    },
    refetchInterval: 30000, // Refresh every 30 seconds
    staleTime: 10000, // Consider data stale after 10 seconds
    enabled: !!chat && !chat.is_group, // Only fetch for individual chats
  })

  // Fetch messages
  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: queryKeys.messages.list(chatId),
    queryFn: async () => {
      const response = await fetch(`/api/chats/${chatId}/messages?limit=100`)
      if (!response.ok) throw new Error('Failed to fetch messages')
      return response.json()
    },
    refetchInterval: 5000, // Poll every 5 seconds (will be replaced with realtime)
  })

  const messages: Message[] = messagesData?.messages || []

  // Scroll to bottom on new messages
  useEffect(() => {
    if (shouldScrollToBottom && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, shouldScrollToBottom])

  // Subscribe to realtime updates
  useEffect(() => {
    const channel = supabase
      .channel(`chat:${chatId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `chat_id=eq.${chatId}`,
        },
        () => {
          // Invalidate messages query to refetch
          queryClient.invalidateQueries({
            queryKey: queryKeys.messages.list(chatId),
          })
          setShouldScrollToBottom(true)
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `chat_id=eq.${chatId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: queryKeys.messages.list(chatId),
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [chatId, supabase, queryClient])

  const displayName = chat?.display_name || chat?.phone_number || 'Loading...'

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <ChatHeader chat={chat} displayName={displayName} presence={presence} />

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto px-4 py-2"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23d5d1c9' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}
      >
        {messagesLoading ? (
          <MessagesSkeleton />
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-gray-500">No messages yet. Start the conversation!</p>
          </div>
        ) : (
          <div className="space-y-1">
            {messages.map((message, index) => {
              const prevMessage = messages[index - 1]
              const showDateHeader =
                !prevMessage ||
                !isSameDay(
                  new Date(message.created_at),
                  new Date(prevMessage.created_at)
                )

              return (
                <div key={message.id}>
                  {showDateHeader && (
                    <DateHeader date={new Date(message.created_at)} />
                  )}
                  <MessageBubble message={message} />
                </div>
              )
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Composer */}
      <MessageComposer chatId={chatId} channelColor={chat?.channel?.color} />
    </div>
  )
}

// ============================================================================
// Sub-components
// ============================================================================

function ChatHeader({
  chat,
  displayName,
  presence,
}: {
  chat: Chat | undefined
  displayName: string
  presence: Presence | null | undefined
}) {
  const { toggleDetailsPanel } = useUIStore()

  // Format last seen time
  const getLastSeenText = () => {
    if (!presence) return null
    if (presence.is_group) return null

    if (presence.is_typing) return 'typing...'
    if (presence.is_recording) return 'recording audio...'
    if (presence.online) return 'online'

    if (presence.last_seen) {
      const lastSeenDate = new Date(presence.last_seen)
      const now = new Date()
      const diffMs = now.getTime() - lastSeenDate.getTime()
      const diffMins = Math.floor(diffMs / 60000)
      const diffHours = Math.floor(diffMs / 3600000)
      const diffDays = Math.floor(diffMs / 86400000)

      if (diffMins < 1) return 'last seen just now'
      if (diffMins < 60) return `last seen ${diffMins} min${diffMins > 1 ? 's' : ''} ago`
      if (diffHours < 24) return `last seen ${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
      if (diffDays === 1) return 'last seen yesterday'
      if (diffDays < 7) return `last seen ${diffDays} days ago`

      // Format as date
      return `last seen ${lastSeenDate.toLocaleDateString()}`
    }

    return null
  }

  const lastSeenText = getLastSeenText()

  return (
    <header className="flex h-16 items-center justify-between border-b border-gray-200 bg-gray-50 px-4">
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <div className="relative">
          {chat?.profile_photo_url ? (
            <img
              src={chat.profile_photo_url}
              alt={displayName}
              className="h-10 w-10 rounded-full object-cover"
            />
          ) : (
            <div
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-full text-white',
                chat?.is_group ? 'bg-blue-500' : 'bg-gray-400'
              )}
            >
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
          {/* Online indicator */}
          {presence?.online && (
            <div className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-green-500 border-2 border-gray-50" />
          )}
        </div>

        {/* Info */}
        <div>
          <h2 className="font-medium text-gray-900">{displayName}</h2>
          {lastSeenText ? (
            <p className={cn(
              "text-xs",
              presence?.online ? "text-green-600" :
              presence?.is_typing || presence?.is_recording ? "text-green-600" :
              "text-gray-500"
            )}>
              {lastSeenText}
            </p>
          ) : chat?.channel && (
            <p
              className="text-xs"
              style={{ color: chat.channel.color || '#10b981' }}
            >
              Replying as: {chat.channel.name}
            </p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggleDetailsPanel}
          className="rounded-full p-2 text-gray-500 hover:bg-gray-200"
          title="Contact info"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </button>
      </div>
    </header>
  )
}

function DateHeader({ date }: { date: Date }) {
  return (
    <div className="flex justify-center py-2">
      <span className="rounded-lg bg-white px-3 py-1 text-xs text-gray-500 shadow-sm">
        {formatMessageDateHeader(date)}
      </span>
    </div>
  )
}

function MessageBubble({ message }: { message: Message }) {
  const isOutbound = message.direction === 'outbound'
  // Include voice/ptt messages in media check - also show for media types without URL (shows "Tap to load" button)
  const mediaTypes = ['image', 'video', 'audio', 'voice', 'ptt', 'document', 'sticker']
  const isMediaType = mediaTypes.includes(message.message_type)
  const hasMedia = isMediaType // Show MediaContent for all media types (it handles missing URLs with "Tap to load")

  return (
    <div
      className={cn('flex', isOutbound ? 'justify-end' : 'justify-start')}
    >
      <div
        className={cn(
          'max-w-[65%] rounded-lg shadow-sm overflow-hidden',
          isOutbound ? 'bg-[#d9fdd3]' : 'bg-white',
          hasMedia ? 'p-1' : 'px-3 py-2'
        )}
      >
        {/* Sender name (for group chats) */}
        {!isOutbound && message.sender_name && (
          <p className={cn("text-xs font-medium text-green-600", hasMedia ? "px-2 pt-1 mb-1" : "mb-1")}>
            {message.sender_name}
          </p>
        )}

        {/* Message content */}
        {message.deleted_at ? (
          <p className="italic text-gray-400 px-2 py-1">This message was deleted</p>
        ) : (
          <>
            {/* Media content */}
            {hasMedia && <MediaContent message={message} />}

            {/* Text content */}
            {message.text && (
              <p className={cn(
                "whitespace-pre-wrap break-words text-sm text-gray-900",
                hasMedia ? "px-2 py-1" : ""
              )}>
                {message.text}
              </p>
            )}

            {/* Text-only message */}
            {!hasMedia && !message.text && (
              <p className="text-sm text-gray-500 italic">
                [{message.message_type} message]
              </p>
            )}
          </>
        )}

        {/* Footer with time and status */}
        <div
          className={cn(
            'flex items-center gap-1',
            hasMedia ? 'px-2 pb-1' : 'mt-1',
            isOutbound ? 'justify-end' : 'justify-start'
          )}
        >
          {message.edited_at && (
            <span className="text-[10px] text-gray-400">edited</span>
          )}
          <span className="text-[10px] text-gray-400">
            {formatMessageTime(new Date(message.created_at))}
          </span>
          {isOutbound && <MessageStatus status={message.status} />}
        </div>
      </div>
    </div>
  )
}

function MediaContent({ message }: { message: Message }) {
  const [imageError, setImageError] = useState(false)
  const [viewOnceState, setViewOnceState] = useState<{
    loading: boolean
    viewed: boolean
    mediaUrl: string | null
    error: string | null
  }>({ loading: false, viewed: false, mediaUrl: null, error: null })

  // State for lazy loading media that wasn't fetched initially
  const [lazyMediaState, setLazyMediaState] = useState<{
    loading: boolean
    mediaUrl: string | null
    error: string | null
  }>({ loading: false, mediaUrl: null, error: null })

  // Handle lazy loading media for messages without media_url
  const handleLoadMedia = async () => {
    if (lazyMediaState.loading) return

    setLazyMediaState({ loading: true, mediaUrl: null, error: null })

    try {
      const response = await fetch(`/api/messages/${message.id}/media`)
      const data = await response.json()

      if (data.success && data.media_url) {
        setLazyMediaState({
          loading: false,
          mediaUrl: data.media_url,
          error: null,
        })
      } else {
        setLazyMediaState({
          loading: false,
          mediaUrl: null,
          error: data.error || 'Could not load media',
        })
      }
    } catch (error) {
      setLazyMediaState({
        loading: false,
        mediaUrl: null,
        error: 'Failed to load media',
      })
    }
  }

  // Handle view-once inbound messages
  const handleViewOnceClick = async () => {
    if (viewOnceState.loading || viewOnceState.viewed) return

    setViewOnceState({ ...viewOnceState, loading: true, error: null })

    try {
      const response = await fetch(`/api/messages/${message.id}/view`, {
        method: 'POST',
      })
      const data = await response.json()

      if (data.can_view && data.media_url) {
        setViewOnceState({
          loading: false,
          viewed: false,
          mediaUrl: data.media_url,
          error: null,
        })
      } else if (data.already_viewed) {
        setViewOnceState({
          loading: false,
          viewed: true,
          mediaUrl: null,
          error: null,
        })
      } else {
        setViewOnceState({
          loading: false,
          viewed: false,
          mediaUrl: null,
          error: data.error || 'Failed to view message',
        })
      }
    } catch (error) {
      setViewOnceState({
        loading: false,
        viewed: false,
        mediaUrl: null,
        error: 'Failed to view message',
      })
    }
  }

  // For view-once inbound messages that haven't been viewed yet
  if (message.is_view_once && message.direction === 'inbound' && !viewOnceState.mediaUrl) {
    // Already viewed
    if (viewOnceState.viewed || message.viewed_at) {
      return (
        <div className="flex flex-col items-center justify-center bg-gray-100 rounded-lg p-6 min-h-[120px] min-w-[180px]">
          <svg className="h-10 w-10 text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          <span className="text-sm text-gray-500">View once photo</span>
          <span className="text-xs text-gray-400 mt-1">Opened</span>
        </div>
      )
    }

    // Click to view
    return (
      <button
        onClick={handleViewOnceClick}
        disabled={viewOnceState.loading}
        className="flex flex-col items-center justify-center bg-gradient-to-br from-purple-100 to-purple-50 rounded-lg p-6 min-h-[120px] min-w-[180px] hover:from-purple-200 hover:to-purple-100 transition-colors cursor-pointer border border-purple-200"
      >
        {viewOnceState.loading ? (
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-purple-500 border-t-transparent mb-2" />
        ) : (
          <svg className="h-10 w-10 text-purple-500 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        )}
        <span className="text-sm text-purple-600 font-medium">View once photo</span>
        <span className="text-xs text-purple-400 mt-1">Click to view</span>
        {viewOnceState.error && (
          <span className="text-xs text-red-500 mt-1">{viewOnceState.error}</span>
        )}
      </button>
    )
  }

  // Get the media URL to display (use lazy-loaded URL, view-once URL, or original)
  const displayMediaUrl = lazyMediaState.mediaUrl || viewOnceState.mediaUrl || message.media_url

  // If no media URL, show a "Load media" button
  if (!displayMediaUrl) {
    const mediaTypeLabels: Record<string, string> = {
      image: 'Image',
      video: 'Video',
      audio: 'Audio',
      voice: 'Voice message',
      ptt: 'Voice message',
      document: 'Document',
      sticker: 'Sticker',
    }
    const label = mediaTypeLabels[message.message_type] || 'Media'

    return (
      <button
        onClick={handleLoadMedia}
        disabled={lazyMediaState.loading}
        className="flex flex-col items-center justify-center bg-gray-100 rounded-lg p-4 min-h-[100px] min-w-[180px] hover:bg-gray-200 transition-colors cursor-pointer border border-gray-200"
      >
        {lazyMediaState.loading ? (
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-green-500 border-t-transparent mb-2" />
        ) : lazyMediaState.error ? (
          <>
            <svg className="h-8 w-8 text-red-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="text-xs text-red-500">{lazyMediaState.error}</span>
            <span className="text-xs text-gray-400 mt-1">Tap to retry</span>
          </>
        ) : (
          <>
            {message.message_type === 'image' || message.message_type === 'sticker' ? (
              <svg className="h-8 w-8 text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            ) : message.message_type === 'video' ? (
              <svg className="h-8 w-8 text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            ) : message.message_type === 'voice' || message.message_type === 'ptt' || message.message_type === 'audio' ? (
              <svg className="h-8 w-8 text-gray-400 mb-2" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
              </svg>
            ) : (
              <svg className="h-8 w-8 text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            )}
            <span className="text-sm text-gray-500">{label}</span>
            <span className="text-xs text-green-600 mt-1">Tap to load</span>
          </>
        )}
      </button>
    )
  }

  const metadata = message.media_metadata || {}

  switch (message.message_type) {
    case 'image':
    case 'sticker':
      return (
        <div className="relative">
          {imageError ? (
            <div className="flex items-center justify-center bg-gray-100 rounded-lg p-4 min-h-[100px]">
              <span className="text-gray-400 text-sm">Image unavailable</span>
            </div>
          ) : (
            <>
              <img
                src={displayMediaUrl}
                alt="Image"
                className={cn(
                  "max-w-full rounded-lg cursor-pointer hover:opacity-95",
                  message.message_type === 'sticker' ? "max-h-32" : "max-h-80"
                )}
                onError={() => setImageError(true)}
                onClick={() => window.open(displayMediaUrl!, '_blank')}
              />
              {/* View-once indicator for outbound */}
              {message.is_view_once && message.direction === 'outbound' && (
                <div className="absolute bottom-2 left-2 bg-purple-600/80 text-white text-xs px-2 py-0.5 rounded-full flex items-center gap-1">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span>1</span>
                </div>
              )}
            </>
          )}
        </div>
      )

    case 'video':
      return (
        <div className="relative">
          <video
            src={displayMediaUrl}
            controls
            className="max-w-full max-h-80 rounded-lg"
            preload="metadata"
          />
          {metadata.duration && (
            <span className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-1 rounded">
              {formatDuration(metadata.duration)}
            </span>
          )}
          {/* View-once indicator for outbound */}
          {message.is_view_once && message.direction === 'outbound' && (
            <div className="absolute bottom-2 left-2 bg-purple-600/80 text-white text-xs px-2 py-0.5 rounded-full flex items-center gap-1">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>1</span>
            </div>
          )}
        </div>
      )

    case 'audio':
    case 'voice':
    case 'ptt':
      return (
        <div className="flex items-center gap-3 p-3 min-w-[250px] bg-opacity-50 rounded-lg">
          {/* Microphone icon for voice messages */}
          {(message.message_type === 'voice' || message.message_type === 'ptt') && (
            <div className="flex-shrink-0">
              <svg className="h-8 w-8 text-green-600" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
              </svg>
            </div>
          )}
          <audio
            src={displayMediaUrl}
            controls
            className="flex-1 h-10"
            preload="metadata"
          />
          {metadata.duration && (
            <span className="text-xs text-gray-500 flex-shrink-0">
              {formatDuration(metadata.duration)}
            </span>
          )}
        </div>
      )

    case 'document':
      return (
        <a
          href={displayMediaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors min-w-[200px]"
        >
          <div className="flex-shrink-0">
            <svg className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">
              {metadata.filename || 'Document'}
            </p>
            {metadata.size && (
              <p className="text-xs text-gray-500">
                {formatFileSize(metadata.size)}
              </p>
            )}
          </div>
          <svg className="h-5 w-5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </a>
      )

    default:
      return null
  }
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function MessageStatus({ status }: { status: string | null }) {
  if (!status) return null

  const getStatusIcon = () => {
    switch (status) {
      case 'pending':
      case 'sent':
        // Single tick for sent
        return (
          <svg className="h-4 w-4 text-gray-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 8l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )
      case 'delivered':
        // Double tick (gray) for delivered
        return (
          <svg className="h-4 w-4 text-gray-400" viewBox="0 0 20 16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2 8l3 3 6-6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M7 8l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )
      case 'read':
        // Double tick (blue) for read
        return (
          <svg className="h-4 w-4 text-blue-500" viewBox="0 0 20 16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2 8l3 3 6-6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M7 8l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )
      case 'failed':
        return (
          <svg className="h-3.5 w-3.5 text-red-500" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z" />
            <path d="M7.002 11a1 1 0 1 1 2 0 1 1 0 0 1-2 0zM7.1 4.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 4.995z" />
          </svg>
        )
      default:
        return null
    }
  }

  return <span className="flex-shrink-0">{getStatusIcon()}</span>
}

interface SelectedFile {
  file: File
  preview: string
  type: 'image' | 'video' | 'audio' | 'document'
}

// View status for view-once messages
interface ViewOnceState {
  [messageId: string]: {
    loading: boolean
    viewed: boolean
    mediaUrl: string | null
    error: string | null
  }
}

function MessageComposer({
  chatId,
  channelColor,
}: {
  chatId: string
  channelColor: string | null | undefined
}) {
  const [text, setText] = useState('')
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null)
  const [isViewOnce, setIsViewOnce] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const { getDraft, setDraft, clearDraft } = useUIStore()
  const { addToast } = useToast()

  // Load draft on mount
  useEffect(() => {
    const draft = getDraft(chatId)
    if (draft?.text) {
      setText(draft.text)
    }
    // Focus input
    inputRef.current?.focus()
  }, [chatId, getDraft])

  // Save draft on text change
  useEffect(() => {
    if (text) {
      setDraft(chatId, text)
    }
  }, [text, chatId, setDraft])

  // Cleanup file preview URL on unmount
  useEffect(() => {
    return () => {
      if (selectedFile?.preview) {
        URL.revokeObjectURL(selectedFile.preview)
      }
    }
  }, [selectedFile])

  // Determine file type
  const getFileType = (file: File): SelectedFile['type'] => {
    if (file.type.startsWith('image/')) return 'image'
    if (file.type.startsWith('video/')) return 'video'
    if (file.type.startsWith('audio/')) return 'audio'
    return 'document'
  }

  // Handle file selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Check file size (max 50MB for media)
    if (file.size > 50 * 1024 * 1024) {
      alert('File size must be less than 50MB')
      return
    }

    const fileType = getFileType(file)
    const preview = file.type.startsWith('image/') || file.type.startsWith('video/')
      ? URL.createObjectURL(file)
      : ''

    setSelectedFile({ file, preview, type: fileType })
    e.target.value = '' // Reset input
  }

  // Clear selected file
  const clearFile = () => {
    if (selectedFile?.preview) {
      URL.revokeObjectURL(selectedFile.preview)
    }
    setSelectedFile(null)
    setIsViewOnce(false)
    setUploadProgress(0)
  }

  // Send mutation for text messages
  const sendTextMutation = useMutation({
    mutationFn: async (messageText: string) => {
      const response = await fetch(`/api/chats/${chatId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: messageText }),
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to send message')
      }
      return response.json()
    },
    onSuccess: (data) => {
      setText('')
      clearDraft(chatId)

      // Update the message in cache with the correct status from API response
      if (data.message) {
        queryClient.setQueryData(
          queryKeys.messages.list(chatId),
          (old: { messages: Message[]; nextCursor?: string } | undefined) => {
            if (!old?.messages) return old

            // Check if message already exists (from realtime INSERT)
            const existingIndex = old.messages.findIndex(
              (m) => m.id === data.message.id || m.wa_message_id === data.message.wa_message_id
            )

            if (existingIndex >= 0) {
              // Update existing message with correct status
              const newMessages = [...old.messages]
              newMessages[existingIndex] = { ...newMessages[existingIndex], ...data.message }
              return { ...old, messages: newMessages }
            } else {
              // Add new message to the end
              return { ...old, messages: [...old.messages, data.message] }
            }
          }
        )
      }

      queryClient.invalidateQueries({ queryKey: queryKeys.chats.all })
    },
    onError: (error: Error) => {
      addToast(error.message || 'Failed to send message', 'error')
    },
  })

  // Send mutation for media messages
  const sendMediaMutation = useMutation({
    mutationFn: async ({ file, caption, viewOnce }: { file: File; caption: string; viewOnce: boolean }) => {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('caption', caption)
      if (viewOnce) {
        formData.append('view_once', 'true')
      }

      const response = await fetch(`/api/chats/${chatId}/messages/media`, {
        method: 'POST',
        body: formData,
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to send media')
      }
      return response.json()
    },
    onSuccess: (data) => {
      setText('')
      clearFile()
      clearDraft(chatId)

      // Update the message in cache with the correct status from API response
      if (data.message) {
        queryClient.setQueryData(
          queryKeys.messages.list(chatId),
          (old: { messages: Message[]; nextCursor?: string } | undefined) => {
            if (!old?.messages) return old

            // Check if message already exists (from realtime INSERT)
            const existingIndex = old.messages.findIndex(
              (m) => m.id === data.message.id || m.wa_message_id === data.message.wa_message_id
            )

            if (existingIndex >= 0) {
              // Update existing message with correct status
              const newMessages = [...old.messages]
              newMessages[existingIndex] = { ...newMessages[existingIndex], ...data.message }
              return { ...old, messages: newMessages }
            } else {
              // Add new message to the end
              return { ...old, messages: [...old.messages, data.message] }
            }
          }
        )
      }

      queryClient.invalidateQueries({ queryKey: queryKeys.chats.all })
      addToast('Media sent successfully', 'success')
    },
    onError: (error: Error) => {
      addToast(error.message || 'Failed to send media', 'error')
    },
  })

  const handleSend = () => {
    if (sendTextMutation.isPending || sendMediaMutation.isPending) return

    if (selectedFile) {
      sendMediaMutation.mutate({
        file: selectedFile.file,
        caption: text.trim(),
        viewOnce: isViewOnce && (selectedFile.type === 'image' || selectedFile.type === 'video'),
      })
    } else {
      const trimmedText = text.trim()
      if (!trimmedText) return
      sendTextMutation.mutate(trimmedText)
    }
  }

  // Check if view-once is available for selected file
  const canBeViewOnce = selectedFile && (selectedFile.type === 'image' || selectedFile.type === 'video')

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`
    }
  }, [text])

  const isPending = sendTextMutation.isPending || sendMediaMutation.isPending
  const canSend = selectedFile || text.trim()

  return (
    <div className="border-t border-gray-200 bg-gray-50 p-3">
      {/* Channel indicator */}
      <div className="mb-2 flex items-center gap-2 text-xs text-gray-500">
        <div
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: channelColor || '#10b981' }}
        />
        <span>Sending as this channel</span>
      </div>

      {/* Selected file preview */}
      {selectedFile && (
        <div className="mb-2">
          <div className="relative inline-block">
            {selectedFile.type === 'image' && selectedFile.preview && (
              <img
                src={selectedFile.preview}
                alt="Preview"
                className={cn(
                  "max-h-32 rounded-lg border",
                  isViewOnce ? "border-purple-400 ring-2 ring-purple-200" : "border-gray-200"
                )}
              />
            )}
            {selectedFile.type === 'video' && selectedFile.preview && (
              <video
                src={selectedFile.preview}
                className={cn(
                  "max-h-32 rounded-lg border",
                  isViewOnce ? "border-purple-400 ring-2 ring-purple-200" : "border-gray-200"
                )}
              />
            )}
            {selectedFile.type === 'audio' && (
              <div className="flex items-center gap-2 bg-white rounded-lg border border-gray-200 px-3 py-2">
                <svg className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
                <span className="text-sm text-gray-600 truncate max-w-[150px]">{selectedFile.file.name}</span>
              </div>
            )}
            {selectedFile.type === 'document' && (
              <div className="flex items-center gap-2 bg-white rounded-lg border border-gray-200 px-3 py-2">
                <svg className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                <span className="text-sm text-gray-600 truncate max-w-[150px]">{selectedFile.file.name}</span>
              </div>
            )}
            {/* View-once indicator on image/video */}
            {isViewOnce && canBeViewOnce && (
              <div className="absolute bottom-1 left-1 bg-purple-600 text-white text-xs px-2 py-0.5 rounded-full flex items-center gap-1">
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                <span>1</span>
              </div>
            )}
            {/* Remove button */}
            <button
              onClick={clearFile}
              className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {/* View-once toggle for images/videos */}
          {canBeViewOnce && (
            <div className="mt-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isViewOnce}
                  onChange={(e) => setIsViewOnce(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                />
                <span className="text-sm text-gray-600 flex items-center gap-1">
                  <svg className="h-4 w-4 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  View once
                </span>
                <span className="text-xs text-gray-400">(recipients can only view this once)</span>
              </label>
            </div>
          )}
        </div>
      )}

      {/* Input area */}
      <div className="flex items-end gap-2">
        {/* File attachment button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="rounded-full p-2 text-gray-500 hover:bg-gray-200"
          title="Attach file"
          disabled={isPending}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
            />
          </svg>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileSelect}
          className="hidden"
          accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
        />

        {/* Emoji button (placeholder) */}
        <button className="rounded-full p-2 text-gray-500 hover:bg-gray-200">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </button>

        {/* Text input */}
        <div className="flex-1">
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={selectedFile ? "Add a caption..." : "Type a message"}
            className="w-full resize-none rounded-lg bg-white px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            rows={1}
            disabled={isPending}
          />
        </div>

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!canSend || isPending}
          className={cn(
            'rounded-full p-2 transition-colors',
            canSend && !isPending
              ? 'bg-green-500 text-white hover:bg-green-600'
              : 'text-gray-400'
          )}
        >
          {isPending ? (
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
              />
            </svg>
          )}
        </button>
      </div>

    </div>
  )
}
