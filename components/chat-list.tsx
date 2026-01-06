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
 */

import { useQuery } from '@tanstack/react-query'
import { useUIStore } from '@/store/ui-store'
import { queryKeys } from '@/lib/query-client'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from '@/lib/date-utils'

interface Chat {
  id: string
  workspace_id: string
  channel_id: string
  wa_chat_id: string
  is_group: boolean
  display_name: string | null
  phone_number: string | null
  profile_photo_url: string | null
  last_message_at: string | null
  last_message_preview: string | null
  unread_count: number
  is_archived: boolean
  channel: {
    id: string
    name: string
    color: string | null
    status: string
  }
}

interface ChatListProps {
  channelId: string | null
}

export function ChatList({ channelId }: ChatListProps) {
  const { selectedChatId, selectChat } = useUIStore()

  // Fetch chats
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.chats.list(channelId || undefined),
    queryFn: async () => {
      const params = new URLSearchParams()
      if (channelId) params.set('channel_id', channelId)
      params.set('limit', '50')

      const response = await fetch(`/api/chats?${params.toString()}`)
      if (!response.ok) {
        throw new Error('Failed to fetch chats')
      }
      return response.json()
    },
    refetchInterval: 30000, // Refetch every 30 seconds
  })

  const chats: Chat[] = data?.chats || []

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 p-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex animate-pulse gap-3">
            <div className="h-12 w-12 rounded-full bg-gray-200" />
            <div className="flex-1">
              <div className="mb-2 h-4 w-32 rounded bg-gray-200" />
              <div className="h-3 w-48 rounded bg-gray-200" />
            </div>
          </div>
        ))}
      </div>
    )
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
  if (chats.length === 0) {
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
      {chats.map((chat) => (
        <ChatListItem
          key={chat.id}
          chat={chat}
          isSelected={selectedChatId === chat.id}
          showChannelBadge={!channelId} // Show badge in unified inbox
          onSelect={() => selectChat(chat.id, chat.channel_id)}
        />
      ))}
    </div>
  )
}

interface ChatListItemProps {
  chat: Chat
  isSelected: boolean
  showChannelBadge: boolean
  onSelect: () => void
}

function ChatListItem({
  chat,
  isSelected,
  showChannelBadge,
  onSelect,
}: ChatListItemProps) {
  const displayName = chat.display_name || chat.phone_number || 'Unknown'
  const initials = getInitials(displayName)
  const timeAgo = chat.last_message_at
    ? formatDistanceToNow(new Date(chat.last_message_at))
    : ''

  return (
    <button
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50',
        isSelected && 'bg-gray-100'
      )}
    >
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
          <h3 className="truncate font-medium text-gray-900">{displayName}</h3>
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
