'use client'

/**
 * Chat List Component
 *
 * Displays a list of chats for the selected channel or unified inbox.
 * Features:
 * - Channel badge (in unified inbox mode)
 * - Unread count badge
 * - Last message preview
 * - Relative timestamps
 * - Hover menu for actions (archive, mute, delete)
 * - Archived chats section
 */

import React, { useState, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useUIStore } from '@/store/ui-store'
import { queryKeys } from '@/lib/query-client'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from '@/lib/date-utils'
import { ChatListSkeleton } from '@/components/ui/skeleton'
import { ChatListItemMenu } from '@/components/chat-list-item-menu'
import { ActionSheet } from '@/components/ui/bottom-sheet'
import { useToast } from '@/components/ui/toast'
import { getDisplayName } from '@/lib/chat-helpers'
import { ChatAvatar } from '@/components/chat-avatar'
import { Badge, ChannelBadge } from '@/components/ui/badge'

interface Chat {
  id: string
  workspace_id: string
  channel_id: string
  wa_chat_id: string
  is_group: boolean
  display_name: string | null
  wa_display_name: string | null
  phone_number: string | null
  profile_photo_url: string | null
  last_message_at: string | null
  last_message_preview: string | null
  unread_count: number
  is_archived: boolean
  muted_until: string | null
  is_muted: boolean
  is_pinned?: boolean
  pinned_at?: string | null
  channel: {
    id: string
    name: string
    color: string | null
    status: string
  }
  contact?: {
    id: string
    display_name: string
  } | null
}

type ChatFilter = 'all' | 'unread' | 'groups'

interface ChatListProps {
  channelId: string | null
  searchQuery?: string
  filter?: ChatFilter
  onSelectChat?: (chatId: string | null, channelId?: string) => void
}

export function ChatList({
  channelId,
  searchQuery = '',
  filter = 'all',
  onSelectChat,
}: ChatListProps) {
  const { selectedChatId, selectChat } = useUIStore()

  // Use custom handler or default
  const handleSelectChat = onSelectChat || selectChat
  const [showArchived, setShowArchived] = useState(false)
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  // Fetch active chats
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.chats.list(channelId || undefined),
    queryFn: async () => {
      const params = new URLSearchParams()
      if (channelId) params.set('channel_id', channelId)
      params.set('limit', '50')
      params.set('archived', 'exclude')

      const response = await fetch(`/api/chats?${params.toString()}`)
      if (!response.ok) {
        throw new Error('Failed to fetch chats')
      }
      return response.json()
    },
    refetchInterval: 30000,
  })

  // Fetch archived chats
  const { data: archivedData } = useQuery({
    queryKey: [...queryKeys.chats.list(channelId || undefined), 'archived'],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (channelId) params.set('channel_id', channelId)
      params.set('limit', '50')
      params.set('archived', 'only')

      const response = await fetch(`/api/chats?${params.toString()}`)
      if (!response.ok) {
        throw new Error('Failed to fetch archived chats')
      }
      return response.json()
    },
    refetchInterval: 60000,
  })

  // Archive mutation
  const archiveMutation = useMutation({
    mutationFn: async ({ chatId, archive }: { chatId: string; archive: boolean }) => {
      const response = await fetch(`/api/chats/${chatId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: archive ? 'archive' : 'unarchive' }),
      })
      if (!response.ok) throw new Error('Failed to update chat')
      return response.json()
    },
    onSuccess: (_, { archive }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.chats.list(channelId || undefined) })
      addToast(archive ? 'Chat archived' : 'Chat unarchived', 'success')
    },
    onError: () => {
      addToast('Failed to update chat', 'error')
    },
  })

  // Mute mutation
  const muteMutation = useMutation({
    mutationFn: async ({ chatId, duration }: { chatId: string; duration?: '8h' | '1w' | 'always' }) => {
      const response = await fetch(`/api/chats/${chatId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: duration ? 'mute' : 'unmute', duration }),
      })
      if (!response.ok) throw new Error('Failed to update chat')
      return response.json()
    },
    onSuccess: (_, { duration }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.chats.list(channelId || undefined) })
      addToast(duration ? 'Chat muted' : 'Chat unmuted', 'success')
    },
    onError: () => {
      addToast('Failed to update chat', 'error')
    },
  })

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (chatId: string) => {
      const response = await fetch(`/api/chats/${chatId}`, {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error('Failed to delete chat')
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.chats.list(channelId || undefined) })
      selectChat(null)
      addToast('Chat deleted', 'success')
    },
    onError: () => {
      addToast('Failed to delete chat', 'error')
    },
  })

  // Pin mutation
  const pinMutation = useMutation({
    mutationFn: async ({ chatId, pin }: { chatId: string; pin: boolean }) => {
      const response = await fetch(`/api/chats/${chatId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: pin ? 'pin' : 'unpin' }),
      })
      if (!response.ok) throw new Error('Failed to update chat')
      return response.json()
    },
    onSuccess: (_, { pin }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.chats.list(channelId || undefined) })
      addToast(pin ? 'Chat pinned' : 'Chat unpinned', 'success')
    },
    onError: () => {
      addToast('Failed to update chat', 'error')
    },
  })

  const allChats: Chat[] = data?.chats || []
  const archivedChats: Chat[] = archivedData?.chats || []

  // Filter chats based on search query and filter type
  const filterChats = (chats: Chat[]) => {
    let filtered = chats

    // Apply filter type (unread/groups)
    if (filter === 'unread') {
      filtered = filtered.filter((chat) => chat.unread_count > 0)
    } else if (filter === 'groups') {
      filtered = filtered.filter((chat) => chat.is_group)
    }

    // Apply search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter((chat) => {
        // Use getDisplayName for consistent name matching
        const name = getDisplayName(chat).toLowerCase()
        const phone = (chat.phone_number || '').toLowerCase()
        const preview = (chat.last_message_preview || '').toLowerCase()
        const channelName = (chat.channel?.name || '').toLowerCase()
        // Also search in contact name if linked
        const contactName = (chat.contact?.display_name || '').toLowerCase()
        return (
          name.includes(query) ||
          phone.includes(query) ||
          preview.includes(query) ||
          channelName.includes(query) ||
          contactName.includes(query)
        )
      })
    }

    return filtered
  }

  const chats = filterChats(allChats)
  const filteredArchivedChats = filterChats(archivedChats)

  // Loading state
  if (isLoading) {
    return <ChatListSkeleton />
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <div className="mb-4 rounded-full bg-red-100 p-3">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6 text-red-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <p className="text-sm text-gray-500">Failed to load chats</p>
      </div>
    )
  }

  // Empty state
  if (chats.length === 0 && filteredArchivedChats.length === 0) {
    if (searchQuery.trim() && (allChats.length > 0 || archivedChats.length > 0)) {
      return (
        <div className="flex flex-col items-center justify-center p-8 text-center">
          <div className="mb-4 rounded-full bg-gray-100 p-3">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          <p className="text-sm font-medium text-gray-700">No results found</p>
          <p className="mt-1 text-xs text-gray-500">
            No chats match &quot;{searchQuery}&quot;
          </p>
        </div>
      )
    }

    return (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <div className="mb-4 rounded-full bg-gray-100 p-3">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
        </div>
        <p className="text-sm font-medium text-gray-700">No chats yet</p>
        <p className="mt-1 text-xs text-gray-500">
          {channelId
            ? 'Messages will appear here when received'
            : 'Connect a channel to start messaging'}
        </p>
      </div>
    )
  }

  return (
    <div className="divide-y divide-border">
      {/* Active chats */}
      {chats.map((chat) => (
        <ChatListItem
          key={chat.id}
          chat={chat}
          isSelected={selectedChatId === chat.id}
          showChannelBadge={!channelId}
          onSelect={() => handleSelectChat(chat.id, chat.channel_id)}
          onArchive={() => archiveMutation.mutate({ chatId: chat.id, archive: !chat.is_archived })}
          onMute={(duration) => muteMutation.mutate({ chatId: chat.id, duration })}
          onUnmute={() => muteMutation.mutate({ chatId: chat.id })}
          onPin={() => pinMutation.mutate({ chatId: chat.id, pin: !chat.is_pinned })}
          onDelete={() => deleteMutation.mutate(chat.id)}
        />
      ))}

      {/* Archived section */}
      {(filteredArchivedChats.length > 0 || archivedChats.length > 0) && (
        <>
          <button
            onClick={() => setShowArchived(!showArchived)}
            className="flex w-full items-center justify-between bg-muted/50 px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted transition-colors"
          >
            <span className="flex items-center gap-2">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
              Archived ({archivedChats.length})
            </span>
            <svg
              className={cn('h-4 w-4 transition-transform duration-normal', showArchived && 'rotate-180')}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showArchived && (
            <div className="bg-muted/30">
              {filteredArchivedChats.map((chat) => (
                <ChatListItem
                  key={chat.id}
                  chat={chat}
                  isSelected={selectedChatId === chat.id}
                  showChannelBadge={!channelId}
                  onSelect={() => handleSelectChat(chat.id, chat.channel_id)}
                  onArchive={() => archiveMutation.mutate({ chatId: chat.id, archive: false })}
                  onMute={(duration) => muteMutation.mutate({ chatId: chat.id, duration })}
                  onUnmute={() => muteMutation.mutate({ chatId: chat.id })}
                  onPin={() => pinMutation.mutate({ chatId: chat.id, pin: !chat.is_pinned })}
                  onDelete={() => deleteMutation.mutate(chat.id)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

interface ChatListItemProps {
  chat: Chat
  isSelected: boolean
  showChannelBadge: boolean
  onSelect: () => void
  onArchive: () => void
  onMute: (duration: '8h' | '1w' | 'always') => void
  onUnmute: () => void
  onPin: () => void
  onDelete: () => void
}

function ChatListItem({
  chat,
  isSelected,
  showChannelBadge,
  onSelect,
  onArchive,
  onMute,
  onUnmute,
  onPin,
  onDelete,
}: ChatListItemProps) {
  const [showMenu, setShowMenu] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const itemRef = useRef<HTMLDivElement>(null)
  const longPressTimer = useRef<NodeJS.Timeout | null>(null)
  const isLongPress = useRef(false)

  // Use getDisplayName for proper priority: contact name > phone > WA name
  const displayName = getDisplayName(chat)
  const timeAgo = chat.last_message_at
    ? formatDistanceToNow(new Date(chat.last_message_at))
    : ''

  // Track mouse position to show menu only on right side hover
  const handleMouseMove = (e: React.MouseEvent) => {
    if (menuOpen) return // Keep showing if menu is open

    const rect = itemRef.current?.getBoundingClientRect()
    if (!rect) return

    const mouseX = e.clientX - rect.left
    const rightEdgeThreshold = 60 // px from right edge

    // Show menu when hovering on the right side
    setShowMenu(mouseX > rect.width - rightEdgeThreshold)
  }

  const handleMouseLeave = () => {
    if (!menuOpen) {
      setShowMenu(false)
    }
  }

  // Long press handlers for mobile
  const handleTouchStart = useCallback(() => {
    isLongPress.current = false
    longPressTimer.current = setTimeout(() => {
      isLongPress.current = true
      setShowMobileMenu(true)
    }, 500) // 500ms for long press
  }, [])

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  const handleTouchMove = useCallback(() => {
    // Cancel long press if user moves finger
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  const handleClick = useCallback(() => {
    // Only trigger select if it wasn't a long press
    if (!isLongPress.current) {
      onSelect()
    }
    isLongPress.current = false
  }, [onSelect])

  // Mobile action sheet actions
  const mobileActions = [
    {
      label: chat.is_pinned ? 'Unpin' : 'Pin',
      icon: <PinIcon className="h-5 w-5" />,
      onClick: onPin,
    },
    {
      label: chat.is_archived ? 'Unarchive' : 'Archive',
      icon: <ArchiveIcon className="h-5 w-5" />,
      onClick: onArchive,
    },
    {
      label: chat.is_muted ? 'Unmute' : 'Mute',
      icon: <MuteIcon className="h-5 w-5" />,
      onClick: chat.is_muted ? onUnmute : () => onMute('always'),
    },
    {
      label: 'Delete',
      icon: <DeleteIcon className="h-5 w-5" />,
      onClick: onDelete,
      variant: 'destructive' as const,
    },
  ]

  return (
    <>
      {/* Mobile action sheet */}
      <ActionSheet
        open={showMobileMenu}
        onClose={() => setShowMobileMenu(false)}
        actions={mobileActions}
        title={displayName}
      />
      <div
        ref={itemRef}
        className={cn(
          'group relative flex w-full items-center gap-3 px-4 min-h-[72px] py-3 text-left transition-colors duration-fast',
          'hover:bg-muted/50 active:bg-muted touch-target select-none',
          isSelected && 'bg-whatsapp-50 dark:bg-whatsapp-900/20 border-l-4 border-l-whatsapp-500',
          chat.is_pinned && 'bg-whatsapp-50/50 dark:bg-whatsapp-900/10'
        )}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
      >
        {/* Pin indicator and unpin button */}
        {chat.is_pinned && (
          <div className="absolute top-2 right-2 flex items-center gap-1">
            {/* Pin icon - always visible */}
            <span className="text-whatsapp-600" title="Pinned">
              <PinFilledIcon className="h-4 w-4" />
            </span>
            {/* Unpin button - shows on hover (desktop) or always visible on mobile */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                onPin()
              }}
              className={cn(
                'p-1 rounded-full bg-muted/80 hover:bg-muted text-muted-foreground hover:text-foreground',
                'transition-all duration-fast',
                'md:opacity-0 md:group-hover:opacity-100', // Hidden on desktop until hover
                'active:scale-95'
              )}
              title="Unpin"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Main clickable area */}
        <button onClick={handleClick} className="flex flex-1 items-center gap-3 min-w-0">
        {/* Avatar with channel indicator */}
        <div className="relative flex-shrink-0">
          <ChatAvatar
            chatId={chat.id}
            src={chat.profile_photo_url}
            fallback={displayName}
            size="lg"
          />

          {/* Channel color indicator (in unified inbox) */}
          {showChannelBadge && (
            <div
              className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full border-2 border-background shadow-sm"
              style={{ backgroundColor: chat.channel.color || '#25D366' }}
              title={chat.channel.name}
            />
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          {/* Top row: Name + Time */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <h3 className={cn(
                'truncate text-[15px] font-medium',
                chat.unread_count > 0 ? 'text-foreground' : 'text-foreground/90'
              )}>
                {displayName}
              </h3>

              {/* Group icon */}
              {chat.is_group && (
                <svg className="h-4 w-4 flex-shrink-0 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              )}

              {/* Muted indicator */}
              {chat.is_muted && (
                <span title="Muted">
                  <svg className="h-4 w-4 flex-shrink-0 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                  </svg>
                </span>
              )}
            </div>

            <span className={cn(
              'flex-shrink-0 text-xs',
              chat.unread_count > 0 ? 'text-whatsapp-600 font-medium' : 'text-muted-foreground'
            )}>
              {timeAgo}
            </span>
          </div>

          {/* Bottom row: Message preview + Unread badge */}
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className={cn(
              'truncate text-sm',
              chat.unread_count > 0 ? 'text-foreground/80' : 'text-muted-foreground'
            )}>
              {chat.last_message_preview || 'No messages yet'}
            </p>

            {/* Unread badge */}
            {chat.unread_count > 0 && (
              <Badge variant="primary" className="flex-shrink-0 animate-in fade-in zoom-in duration-200">
                {chat.unread_count > 99 ? '99+' : chat.unread_count}
              </Badge>
            )}
          </div>

          {/* Channel name (in unified inbox) */}
          {showChannelBadge && (
            <ChannelBadge
              name={chat.channel.name}
              color={chat.channel.color || '#25D366'}
              size="md"
              className="mt-1.5"
            />
          )}
        </div>
      </button>

        {/* Hover menu - only shows on right side hover (desktop) */}
        <div
          className={cn(
            'absolute right-3 top-1/2 -translate-y-1/2 transition-all duration-fast hidden md:block',
            showMenu || menuOpen ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'
          )}
        >
          <ChatListItemMenu
            chatId={chat.id}
            isArchived={chat.is_archived}
            isMuted={chat.is_muted}
            isPinned={chat.is_pinned}
            onArchive={onArchive}
            onMute={onMute}
            onUnmute={onUnmute}
            onPin={onPin}
            onDelete={onDelete}
            onOpenChange={setMenuOpen}
          />
        </div>
      </div>
    </>
  )
}

// Icon components for mobile menu
function PinIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
    </svg>
  )
}

// Filled pin icon for pinned indicator (more visible)
function PinFilledIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
    </svg>
  )
}

function ArchiveIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
    </svg>
  )
}

function MuteIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
    </svg>
  )
}

function DeleteIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  )
}

