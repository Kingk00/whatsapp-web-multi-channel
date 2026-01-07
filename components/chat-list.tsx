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

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useUIStore } from '@/store/ui-store'
import { queryKeys } from '@/lib/query-client'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from '@/lib/date-utils'
import { ChatListSkeleton } from '@/components/ui/skeleton'
import { ChatListItemMenu } from '@/components/chat-list-item-menu'
import { useToast } from '@/components/ui/toast'
import { getDisplayName } from '@/lib/chat-helpers'

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

interface ChatListProps {
  channelId: string | null
  searchQuery?: string
}

export function ChatList({ channelId, searchQuery = '' }: ChatListProps) {
  const { selectedChatId, selectChat } = useUIStore()
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

  const allChats: Chat[] = data?.chats || []
  const archivedChats: Chat[] = archivedData?.chats || []

  // Filter chats based on search query
  const filterChats = (chats: Chat[]) => {
    if (!searchQuery.trim()) return chats
    const query = searchQuery.toLowerCase()
    return chats.filter((chat) => {
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
    <div className="divide-y divide-gray-100">
      {/* Active chats */}
      {chats.map((chat) => (
        <ChatListItem
          key={chat.id}
          chat={chat}
          isSelected={selectedChatId === chat.id}
          showChannelBadge={!channelId}
          onSelect={() => selectChat(chat.id, chat.channel_id)}
          onArchive={() => archiveMutation.mutate({ chatId: chat.id, archive: !chat.is_archived })}
          onMute={(duration) => muteMutation.mutate({ chatId: chat.id, duration })}
          onUnmute={() => muteMutation.mutate({ chatId: chat.id })}
          onDelete={() => deleteMutation.mutate(chat.id)}
        />
      ))}

      {/* Archived section */}
      {(filteredArchivedChats.length > 0 || archivedChats.length > 0) && (
        <>
          <button
            onClick={() => setShowArchived(!showArchived)}
            className="flex w-full items-center justify-between bg-gray-50 px-4 py-2 text-sm text-gray-600 hover:bg-gray-100"
          >
            <span className="flex items-center gap-2">
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
                  d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
                />
              </svg>
              Archived ({archivedChats.length})
            </span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={cn('h-4 w-4 transition-transform', showArchived && 'rotate-180')}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showArchived && (
            <div className="bg-gray-50">
              {filteredArchivedChats.map((chat) => (
                <ChatListItem
                  key={chat.id}
                  chat={chat}
                  isSelected={selectedChatId === chat.id}
                  showChannelBadge={!channelId}
                  onSelect={() => selectChat(chat.id, chat.channel_id)}
                  onArchive={() => archiveMutation.mutate({ chatId: chat.id, archive: false })}
                  onMute={(duration) => muteMutation.mutate({ chatId: chat.id, duration })}
                  onUnmute={() => muteMutation.mutate({ chatId: chat.id })}
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
  onDelete,
}: ChatListItemProps) {
  const [isHovered, setIsHovered] = useState(false)
  // Use getDisplayName for proper priority: contact name > phone > WA name
  const displayName = getDisplayName(chat)
  const initials = getInitials(displayName)
  const timeAgo = chat.last_message_at
    ? formatDistanceToNow(new Date(chat.last_message_at))
    : ''

  return (
    <div
      className={cn(
        'group relative flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50',
        isSelected && 'bg-gray-100'
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Main clickable area */}
      <button onClick={onSelect} className="flex flex-1 items-start gap-3">
        {/* Avatar */}
        <div className="relative flex-shrink-0">
          {chat.profile_photo_url ? (
            <img
              src={chat.profile_photo_url}
              alt={displayName}
              className="h-12 w-12 rounded-full object-cover"
            />
          ) : (
            <div
              className={cn(
                'flex h-12 w-12 items-center justify-center rounded-full text-white',
                chat.is_group ? 'bg-blue-500' : 'bg-gray-400'
              )}
            >
              {chat.is_group ? (
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
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                  />
                </svg>
              ) : (
                <span className="text-lg font-medium">{initials}</span>
              )}
            </div>
          )}

          {/* Channel badge (in unified inbox) */}
          {showChannelBadge && (
            <div
              className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-white"
              style={{ backgroundColor: chat.channel.color || '#10b981' }}
              title={chat.channel.name}
            />
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="truncate font-medium text-gray-900">{displayName}</h3>
              {/* Muted indicator */}
              {chat.is_muted && (
                <span title="Muted">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4 flex-shrink-0 text-gray-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
                    />
                  </svg>
                </span>
              )}
            </div>
            <span className="flex-shrink-0 text-xs text-gray-500">{timeAgo}</span>
          </div>

          <div className="mt-1 flex items-center justify-between">
            <p className="truncate text-sm text-gray-500">
              {chat.last_message_preview || 'No messages yet'}
            </p>

            {/* Unread badge */}
            {chat.unread_count > 0 && (
              <span className="ml-2 flex-shrink-0 rounded-full bg-green-500 px-2 py-0.5 text-xs font-medium text-white">
                {chat.unread_count > 99 ? '99+' : chat.unread_count}
              </span>
            )}
          </div>

          {/* Channel name (in unified inbox) */}
          {showChannelBadge && (
            <p
              className="mt-1 truncate text-xs"
              style={{ color: chat.channel.color || '#10b981' }}
            >
              {chat.channel.name}
            </p>
          )}
        </div>
      </button>

      {/* Hover menu */}
      <div
        className={cn(
          'absolute right-2 top-1/2 -translate-y-1/2 transition-opacity',
          isHovered || isSelected ? 'opacity-100' : 'opacity-0'
        )}
      >
        <ChatListItemMenu
          chatId={chat.id}
          isArchived={chat.is_archived}
          isMuted={chat.is_muted}
          onArchive={onArchive}
          onMute={onMute}
          onUnmute={onUnmute}
          onDelete={onDelete}
        />
      </div>
    </div>
  )
}

/**
 * Get initials from a name
 */
function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2)
}
