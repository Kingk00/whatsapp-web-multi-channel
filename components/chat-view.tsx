'use client'

/**
 * Chat View Component
 *
 * Displays the active chat with:
 * - Chat header with contact info
 * - Message history
 * - Message composer
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useUIStore } from '@/store/ui-store'
import { queryKeys } from '@/lib/query-client'
import { formatMessageTime, formatMessageDateHeader, isSameDay } from '@/lib/date-utils'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { MessagesSkeleton, ChatHeaderSkeleton } from '@/components/ui/skeleton'
import { getDisplayName } from '@/lib/chat-helpers'
import { MessageActionMenu, MessageActionSheet } from '@/components/message-action-menu'
import { MessageEditModal } from '@/components/message-edit-modal'

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
  wa_display_name?: string | null
  phone_number: string | null
  profile_photo_url: string | null
  is_group: boolean
  channel: {
    id: string
    name: string
    color: string | null
  }
  contact?: {
    id: string
    display_name: string
  } | null
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
  onBack?: () => void // Mobile back button handler
}

export function ChatView({ chatId, onBack }: ChatViewProps) {
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
          wa_display_name,
          phone_number,
          profile_photo_url,
          is_group,
          channels!inner (
            id,
            name,
            color
          ),
          contacts (
            id,
            display_name
          )
        `
        )
        .eq('id', chatId)
        .single()

      if (error) throw error
      // Handle both array and object responses from Supabase join
      const channelData = Array.isArray(data.channels)
        ? data.channels[0]
        : data.channels
      // Handle contact relation (can be null if not linked)
      const contactData = Array.isArray(data.contacts)
        ? data.contacts[0]
        : data.contacts
      return {
        ...data,
        channel: channelData || null,
        contact: contactData || null,
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

  const { addToast } = useToast()

  // Edit message mutation
  const editMessageMutation = useMutation({
    mutationFn: async ({ messageId, text }: { messageId: string; text: string }) => {
      const response = await fetch(`/api/messages/${messageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'edit', text }),
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to edit message')
      }
      return response.json()
    },
    onMutate: async ({ messageId, text }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.messages.list(chatId) })
      const previousMessages = queryClient.getQueryData(queryKeys.messages.list(chatId))

      // Optimistic update
      queryClient.setQueryData(
        queryKeys.messages.list(chatId),
        (old: { messages: Message[] } | undefined) => {
          if (!old) return old
          return {
            ...old,
            messages: old.messages.map(m =>
              m.id === messageId
                ? { ...m, text, edited_at: new Date().toISOString() }
                : m
            ),
          }
        }
      )
      return { previousMessages }
    },
    onError: (err, _variables, context) => {
      // Rollback on error
      if (context?.previousMessages) {
        queryClient.setQueryData(
          queryKeys.messages.list(chatId),
          context.previousMessages
        )
      }
      addToast(err.message, 'error')
    },
    onSuccess: () => {
      addToast('Message edited', 'success')
    },
  })

  // Delete message mutation
  const deleteMessageMutation = useMutation({
    mutationFn: async ({ messageId, forEveryone }: { messageId: string; forEveryone: boolean }) => {
      const url = forEveryone
        ? `/api/messages/${messageId}?for_everyone=true`
        : `/api/messages/${messageId}`
      const response = await fetch(url, { method: 'DELETE' })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to delete message')
      }
      return response.json()
    },
    onMutate: async ({ messageId }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.messages.list(chatId) })
      const previousMessages = queryClient.getQueryData(queryKeys.messages.list(chatId))

      // Optimistic update
      queryClient.setQueryData(
        queryKeys.messages.list(chatId),
        (old: { messages: Message[] } | undefined) => {
          if (!old) return old
          return {
            ...old,
            messages: old.messages.map(m =>
              m.id === messageId
                ? { ...m, deleted_at: new Date().toISOString() }
                : m
            ),
          }
        }
      )
      return { previousMessages }
    },
    onError: (err, _variables, context) => {
      if (context?.previousMessages) {
        queryClient.setQueryData(
          queryKeys.messages.list(chatId),
          context.previousMessages
        )
      }
      addToast(err.message, 'error')
    },
    onSuccess: () => {
      addToast('Message deleted', 'success')
    },
  })

  // Callbacks for MessageBubble
  const handleEditMessage = useCallback((messageId: string, text: string) => {
    editMessageMutation.mutate({ messageId, text })
  }, [editMessageMutation])

  const handleDeleteMessage = useCallback((messageId: string, forEveryone: boolean) => {
    deleteMessageMutation.mutate({ messageId, forEveryone })
  }, [deleteMessageMutation])

  const handleCopyMessage = useCallback((text: string) => {
    navigator.clipboard.writeText(text)
    addToast('Copied to clipboard', 'success')
  }, [addToast])

  const displayName = chat ? getDisplayName(chat) : 'Loading...'

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <ChatHeader chat={chat} displayName={displayName} presence={presence} onBack={onBack} />

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 md:px-4 py-2 chat-pattern scrollbar-thin">
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
                  <MessageBubble
                    message={message}
                    onEdit={handleEditMessage}
                    onDelete={handleDeleteMessage}
                    onCopy={handleCopyMessage}
                    isEditPending={editMessageMutation.isPending && editMessageMutation.variables?.messageId === message.id}
                  />
                </div>
              )
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Composer */}
      <MessageComposer chatId={chatId} channelId={chat?.channel?.id} channelColor={chat?.channel?.color} />
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
  onBack,
}: {
  chat: Chat | undefined
  displayName: string
  presence: Presence | null | undefined
  onBack?: () => void
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
    <header className="flex h-16 items-center justify-between border-b border-border bg-card px-4">
      <div className="flex items-center gap-3">
        {/* Back button (mobile only) */}
        {onBack && (
          <button
            onClick={onBack}
            className="btn-icon -ml-2"
            aria-label="Back to chats"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}

        {/* Avatar */}
        <div className="relative">
          {chat?.profile_photo_url ? (
            <img
              src={chat.profile_photo_url}
              alt={displayName}
              className="h-12 w-12 rounded-full object-cover bg-muted"
            />
          ) : (
            <div
              className={cn(
                'flex h-12 w-12 items-center justify-center rounded-full text-white font-medium',
                chat?.is_group ? 'bg-blue-500' : 'bg-gradient-to-br from-whatsapp-400 to-whatsapp-600'
              )}
            >
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
          {/* Online indicator */}
          {presence?.online && (
            <div className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full bg-status-online border-2 border-card" />
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
    <div className="flex justify-center py-3">
      <span className="rounded-lg bg-white/90 dark:bg-card/90 backdrop-blur-sm px-4 py-1.5 text-xs font-medium text-muted-foreground shadow-sm">
        {formatMessageDateHeader(date)}
      </span>
    </div>
  )
}

interface MessageBubbleProps {
  message: Message
  onEdit: (messageId: string, text: string) => void
  onDelete: (messageId: string, forEveryone: boolean) => void
  onCopy: (text: string) => void
  isEditPending?: boolean
}

function MessageBubble({ message, onEdit, onDelete, onCopy, isEditPending }: MessageBubbleProps) {
  const isOutbound = message.direction === 'outbound'
  // Include voice/ptt messages in media check - also show for media types without URL (shows "Tap to load" button)
  const mediaTypes = ['image', 'video', 'audio', 'voice', 'ptt', 'document', 'sticker']
  const isMediaType = mediaTypes.includes(message.message_type)
  const hasMedia = isMediaType // Show MediaContent for all media types (it handles missing URLs with "Tap to load")

  // State for hover menu (desktop)
  const [isHovered, setIsHovered] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 })
  const menuButtonRef = useRef<HTMLButtonElement>(null)

  // State for mobile action sheet
  const [showMobileSheet, setShowMobileSheet] = useState(false)

  // State for edit modal
  const [showEditModal, setShowEditModal] = useState(false)

  // Long press handling for mobile
  const longPressTimer = useRef<NodeJS.Timeout | null>(null)
  const isLongPress = useRef(false)

  const handleTouchStart = useCallback(() => {
    // Don't trigger long press for deleted messages
    if (message.deleted_at) return

    isLongPress.current = false
    longPressTimer.current = setTimeout(() => {
      isLongPress.current = true
      if (navigator.vibrate) navigator.vibrate(50)
      setShowMobileSheet(true)
    }, 500)
  }, [message.deleted_at])

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  const handleTouchMove = useCallback(() => {
    // Cancel long press if finger moves (prevents conflict with scrolling)
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  const openDesktopMenu = useCallback(() => {
    if (menuButtonRef.current) {
      const rect = menuButtonRef.current.getBoundingClientRect()
      setMenuPosition({
        top: rect.bottom + 4,
        left: isOutbound ? rect.right - 192 : rect.left, // 192px = w-48 menu width
      })
    }
    setShowMenu(true)
  }, [isOutbound])

  const handleEdit = useCallback(() => {
    setShowEditModal(true)
    setShowMenu(false)
    setShowMobileSheet(false)
  }, [])

  const handleDelete = useCallback((forEveryone: boolean) => {
    onDelete(message.id, forEveryone)
    setShowMenu(false)
    setShowMobileSheet(false)
  }, [message.id, onDelete])

  const handleCopy = useCallback(() => {
    if (message.text) {
      onCopy(message.text)
    }
    setShowMenu(false)
    setShowMobileSheet(false)
  }, [message.text, onCopy])

  const handleSaveEdit = useCallback((newText: string) => {
    onEdit(message.id, newText)
    setShowEditModal(false)
  }, [message.id, onEdit])

  // Don't show menu for deleted messages
  const canShowMenu = !message.deleted_at

  return (
    <>
      <div
        className={cn(
          'flex animate-in fade-in slide-in-from-bottom-2 duration-200 group',
          isOutbound ? 'justify-end' : 'justify-start'
        )}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => {
          setIsHovered(false)
          if (!showMenu) setShowMenu(false)
        }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
      >
        <div
          className={cn(
            'relative max-w-[75%] md:max-w-[65%] overflow-hidden',
            // Bubble shape with tail
            isOutbound
              ? 'bg-bubble-outbound dark:bg-bubble-outbound-dark rounded-2xl rounded-tr-sm'
              : 'bg-bubble-inbound dark:bg-bubble-inbound-dark rounded-2xl rounded-tl-sm',
            // Shadow
            'shadow-message',
            // Padding
            hasMedia ? 'p-1' : 'px-3 py-2'
          )}
        >
          {/* Menu button (desktop hover) */}
          {canShowMenu && (
            <button
              ref={menuButtonRef}
              onClick={(e) => {
                e.stopPropagation()
                if (showMenu) {
                  setShowMenu(false)
                } else {
                  openDesktopMenu()
                }
              }}
              className={cn(
                'absolute top-1 z-10 rounded-full p-1 transition-all duration-150 hidden md:flex',
                'bg-white/80 dark:bg-gray-800/80 hover:bg-white dark:hover:bg-gray-800',
                'text-muted-foreground hover:text-foreground',
                isOutbound ? 'right-1' : 'left-1',
                (isHovered || showMenu) ? 'opacity-100' : 'opacity-0'
              )}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
              </svg>
            </button>
          )}

          {/* Sender name (for group chats) */}
          {!isOutbound && message.sender_name && (
            <p className={cn(
              "text-xs font-semibold text-whatsapp-600",
              hasMedia ? "px-2 pt-1 mb-1" : "mb-1"
            )}>
              {message.sender_name}
            </p>
          )}

          {/* Message content */}
          {message.deleted_at ? (
            <p className="italic text-muted-foreground px-2 py-1 flex items-center gap-1.5">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
              This message was deleted
            </p>
          ) : (
            <>
              {/* Media content */}
              {hasMedia && <MediaContent message={message} />}

              {/* Text content */}
              {message.text && (
                <p className={cn(
                  "whitespace-pre-wrap break-words text-[15px] leading-relaxed text-foreground select-text",
                  hasMedia ? "px-2 py-1" : ""
                )}>
                  {message.text}
                </p>
              )}

              {/* Text-only message */}
              {!hasMedia && !message.text && (
                <p className="text-sm text-muted-foreground italic">
                  [{message.message_type} message]
                </p>
              )}
            </>
          )}

          {/* Footer with time and status */}
          <div
            className={cn(
              'flex items-center gap-1 select-none',
              hasMedia ? 'px-2 pb-1' : 'mt-1',
              isOutbound ? 'justify-end' : 'justify-start'
            )}
          >
            {message.edited_at && (
              <span className="text-[10px] text-muted-foreground/70 italic">edited</span>
            )}
            <span className="text-[10px] text-muted-foreground/70">
              {formatMessageTime(new Date(message.created_at))}
            </span>
            {isOutbound && <MessageStatus status={message.status} />}
          </div>
        </div>
      </div>

      {/* Desktop action menu */}
      {showMenu && (
        <MessageActionMenu
          message={message}
          position={menuPosition}
          onClose={() => setShowMenu(false)}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onCopy={handleCopy}
        />
      )}

      {/* Mobile action sheet */}
      <MessageActionSheet
        message={message}
        isOpen={showMobileSheet}
        onClose={() => setShowMobileSheet(false)}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onCopy={handleCopy}
      />

      {/* Edit modal */}
      <MessageEditModal
        isOpen={showEditModal}
        initialText={message.text || ''}
        onClose={() => setShowEditModal(false)}
        onSave={handleSaveEdit}
        isSaving={isEditPending}
      />
    </>
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

interface QuickReplyAttachment {
  id: string
  kind: string
  filename: string
  url?: string
  storage_path?: string
}

interface QuickReply {
  id: string
  shortcut: string
  title: string | null
  text_body: string | null
  attachments?: QuickReplyAttachment[]
}

function MessageComposer({
  chatId,
  channelId,
  channelColor,
}: {
  chatId: string
  channelId: string | undefined
  channelColor: string | null | undefined
}) {
  const [text, setText] = useState('')
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null)
  const [isViewOnce, setIsViewOnce] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [showQuickReplies, setShowQuickReplies] = useState(false)
  const [quickReplyFilter, setQuickReplyFilter] = useState('')
  const [selectedQuickReplyIndex, setSelectedQuickReplyIndex] = useState(0)
  const [quickReplyAttachments, setQuickReplyAttachments] = useState<QuickReplyAttachment[]>([])
  const [quickReplyViewOnce, setQuickReplyViewOnce] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const quickReplyRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const { getDraft, setDraft, clearDraft } = useUIStore()
  const { addToast } = useToast()

  // Fetch quick replies for this channel
  const { data: quickRepliesData } = useQuery({
    queryKey: ['quick-replies', channelId],
    queryFn: async () => {
      if (!channelId) return { quickReplies: [] }
      const response = await fetch(`/api/quick-replies?channel_id=${channelId}`)
      if (!response.ok) return { quickReplies: [] }
      return response.json()
    },
    enabled: !!channelId,
    staleTime: 60000, // Cache for 1 minute
  })

  const quickReplies: QuickReply[] = quickRepliesData?.quickReplies || []

  // Filter quick replies based on what user types after /
  const filteredQuickReplies = quickReplies.filter((qr) =>
    qr.shortcut.toLowerCase().includes(quickReplyFilter.toLowerCase())
  )

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

  // Send quick reply media by URL
  const sendQuickReplyMediaMutation = useMutation({
    mutationFn: async ({ mediaUrl, caption, mediaType, viewOnce }: { mediaUrl: string; caption: string; mediaType: string; viewOnce?: boolean }) => {
      const response = await fetch(`/api/chats/${chatId}/messages/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          media_url: mediaUrl,
          caption: caption || undefined,
          media_type: mediaType,
          view_once: viewOnce || false,
        }),
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to send media')
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.messages.list(chatId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.chats.all })
    },
    onError: (error: Error) => {
      addToast(error.message || 'Failed to send media', 'error')
    },
  })

  const handleSend = async () => {
    if (sendTextMutation.isPending || sendMediaMutation.isPending || sendQuickReplyMediaMutation.isPending) return

    const trimmedText = text.trim()

    // Handle quick reply attachments
    if (quickReplyAttachments.length > 0) {
      // Send text first if any
      if (trimmedText) {
        sendTextMutation.mutate(trimmedText)
      }
      // Check if view once is enabled and applicable (only for images/videos)
      const canUseViewOnce = quickReplyAttachments.some(
        (att) => att.kind === 'image' || att.kind === 'video'
      )
      // Send each attachment
      for (const attachment of quickReplyAttachments) {
        if (attachment.url) {
          const isViewOnceEligible = attachment.kind === 'image' || attachment.kind === 'video'
          await sendQuickReplyMediaMutation.mutateAsync({
            mediaUrl: attachment.url,
            caption: '', // Caption already sent as text
            mediaType: attachment.kind,
            viewOnce: quickReplyViewOnce && isViewOnceEligible,
          })
        }
      }
      setText('')
      clearDraft(chatId)
      clearQuickReplyAttachments()
      addToast('Quick reply sent', 'success')
      return
    }

    if (selectedFile) {
      sendMediaMutation.mutate({
        file: selectedFile.file,
        caption: trimmedText,
        viewOnce: isViewOnce && (selectedFile.type === 'image' || selectedFile.type === 'video'),
      })
    } else {
      if (!trimmedText) return
      sendTextMutation.mutate(trimmedText)
    }
  }

  // Check if view-once is available for selected file
  const canBeViewOnce = selectedFile && (selectedFile.type === 'image' || selectedFile.type === 'video')

  // Handle text change - detect "/" for quick replies
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value
    setText(newText)

    // Check if text starts with "/" for quick reply mode
    if (newText.startsWith('/')) {
      setShowQuickReplies(true)
      setQuickReplyFilter(newText.slice(1)) // Remove the "/" from filter
      setSelectedQuickReplyIndex(0)
    } else {
      setShowQuickReplies(false)
      setQuickReplyFilter('')
    }
  }

  // Select a quick reply
  const selectQuickReply = (qr: QuickReply) => {
    // Insert the quick reply text
    setText(qr.text_body || '')
    // Set quick reply attachments if any
    if (qr.attachments && qr.attachments.length > 0) {
      setQuickReplyAttachments(qr.attachments)
      // Clear any manually selected file
      if (selectedFile?.preview) {
        URL.revokeObjectURL(selectedFile.preview)
      }
      setSelectedFile(null)
    }
    setShowQuickReplies(false)
    setQuickReplyFilter('')
    inputRef.current?.focus()
  }

  // Clear quick reply attachments
  const clearQuickReplyAttachments = () => {
    setQuickReplyAttachments([])
    setQuickReplyViewOnce(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Handle quick reply navigation
    if (showQuickReplies && filteredQuickReplies.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedQuickReplyIndex((prev) =>
          prev < filteredQuickReplies.length - 1 ? prev + 1 : 0
        )
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedQuickReplyIndex((prev) =>
          prev > 0 ? prev - 1 : filteredQuickReplies.length - 1
        )
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        selectQuickReply(filteredQuickReplies[selectedQuickReplyIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowQuickReplies(false)
        setText('')
        return
      }
    }

    // Normal send behavior
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

  const isPending = sendTextMutation.isPending || sendMediaMutation.isPending || sendQuickReplyMediaMutation.isPending
  const canSend = selectedFile || text.trim() || quickReplyAttachments.length > 0

  return (
    <div className="border-t border-border bg-card p-3 md:p-4">
      {/* Channel indicator */}
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <div
          className="h-2 w-2 rounded-full animate-pulse"
          style={{ backgroundColor: channelColor || '#25D366' }}
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

      {/* Quick reply attachments preview */}
      {quickReplyAttachments.length > 0 && (
        <div className="mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            {quickReplyAttachments.map((attachment) => (
              <div key={attachment.id} className="relative">
                {attachment.kind === 'image' && attachment.url && (
                  <img
                    src={attachment.url}
                    alt={attachment.filename}
                    className={cn(
                      "h-20 w-20 object-cover rounded-lg border",
                      quickReplyViewOnce
                        ? "border-purple-400 ring-2 ring-purple-200"
                        : "border-green-300 ring-2 ring-green-100"
                    )}
                  />
                )}
                {attachment.kind === 'video' && attachment.url && (
                  <div className={cn(
                    "h-20 w-20 rounded-lg border bg-gray-100 flex items-center justify-center",
                    quickReplyViewOnce
                      ? "border-purple-400 ring-2 ring-purple-200"
                      : "border-green-300 ring-2 ring-green-100"
                  )}>
                    <svg className={cn("h-8 w-8", quickReplyViewOnce ? "text-purple-600" : "text-green-600")} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                )}
                {attachment.kind === 'audio' && (
                  <div className="h-20 px-3 rounded-lg border border-green-300 ring-2 ring-green-100 bg-gray-100 flex items-center gap-2">
                    <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                    </svg>
                    <span className="text-xs text-gray-600 truncate max-w-[80px]">{attachment.filename}</span>
                  </div>
                )}
                {attachment.kind === 'document' && (
                  <div className="h-20 px-3 rounded-lg border border-green-300 ring-2 ring-green-100 bg-gray-100 flex items-center gap-2">
                    <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    <span className="text-xs text-gray-600 truncate max-w-[80px]">{attachment.filename}</span>
                  </div>
                )}
                {/* View once indicator on image/video */}
                {quickReplyViewOnce && (attachment.kind === 'image' || attachment.kind === 'video') && (
                  <div className="absolute bottom-1 left-1 bg-purple-600 text-white text-xs px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span>1</span>
                  </div>
                )}
              </div>
            ))}
            {/* Remove all button */}
            <button
              onClick={clearQuickReplyAttachments}
              className="h-8 px-2 bg-red-100 text-red-600 rounded-lg text-xs font-medium hover:bg-red-200 flex items-center gap-1"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Clear
            </button>
          </div>
          {/* View once toggle for images/videos */}
          {quickReplyAttachments.some((att) => att.kind === 'image' || att.kind === 'video') && (
            <div className="mt-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={quickReplyViewOnce}
                  onChange={(e) => setQuickReplyViewOnce(e.target.checked)}
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
          <p className={cn("text-xs mt-1", quickReplyViewOnce ? "text-purple-600" : "text-green-600")}>
            Quick reply: {quickReplyAttachments.length} attachment{quickReplyAttachments.length > 1 ? 's' : ''}
            {quickReplyViewOnce && ' (view once)'}
          </p>
        </div>
      )}

      {/* Input area */}
      <div className="flex items-end gap-2">
        {/* File attachment button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="btn-icon flex-shrink-0"
          title="Attach file"
          disabled={isPending}
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
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
        <button className="btn-icon flex-shrink-0 hidden md:flex">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>

        {/* Text input with quick reply dropdown */}
        <div className="flex-1 min-w-0 relative">
          {/* Quick reply suggestions dropdown */}
          {showQuickReplies && filteredQuickReplies.length > 0 && (
            <div
              ref={quickReplyRef}
              className="absolute bottom-full left-0 right-0 mb-2 max-h-48 overflow-y-auto rounded-lg border border-border bg-card shadow-lg z-10"
            >
              {filteredQuickReplies.map((qr, index) => (
                <button
                  key={qr.id}
                  type="button"
                  onClick={() => selectQuickReply(qr)}
                  className={cn(
                    'w-full px-3 py-2 text-left hover:bg-muted/50 transition-colors',
                    'flex items-center justify-between gap-2',
                    index === selectedQuickReplyIndex && 'bg-muted/50'
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-mono text-whatsapp-600">/{qr.shortcut}</code>
                      {qr.attachments && qr.attachments.length > 0 && (
                        <span className="text-xs text-blue-500 flex items-center gap-0.5">
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                          </svg>
                          {qr.attachments.length}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground truncate">
                      {qr.text_body || '(media only)'}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
          {showQuickReplies && filteredQuickReplies.length === 0 && quickReplyFilter && quickReplies.length > 0 && (
            <div className="absolute bottom-full left-0 right-0 mb-2 rounded-lg border border-border bg-card shadow-lg p-3 z-10">
              <p className="text-sm text-muted-foreground text-center">
                No quick replies match &quot;/{quickReplyFilter}&quot;
              </p>
            </div>
          )}
          {showQuickReplies && quickReplies.length === 0 && (
            <div className="absolute bottom-full left-0 right-0 mb-2 rounded-lg border border-border bg-card shadow-lg p-3 z-10">
              <p className="text-sm text-muted-foreground text-center">
                No quick replies for this channel
              </p>
            </div>
          )}
          <textarea
            ref={inputRef}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            placeholder={selectedFile ? "Add a caption..." : "Type a message or / for quick replies"}
            className={cn(
              "w-full resize-none rounded-full bg-muted/50 px-4 py-2.5 text-[15px]",
              "placeholder:text-muted-foreground/60",
              "focus:outline-none focus:ring-2 focus:ring-whatsapp-500/50 focus:bg-muted",
              "transition-all duration-fast"
            )}
            rows={1}
            disabled={isPending}
          />
        </div>

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!canSend || isPending}
          className={cn(
            'flex-shrink-0 rounded-full p-2.5 transition-all duration-fast touch-target',
            canSend && !isPending
              ? 'bg-gradient-to-r from-whatsapp-500 to-whatsapp-teal text-white shadow-sm hover:shadow-md active:scale-95'
              : 'text-muted-foreground bg-muted/30'
          )}
        >
          {isPending ? (
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
          ) : (
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          )}
        </button>
      </div>
    </div>
  )
}
