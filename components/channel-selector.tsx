'use client'

/**
 * Channel Selector
 *
 * Dropdown to select which channel to view in the chat list.
 * Options include individual channels and "Unified Inbox" (all channels).
 * Shows number of chats with unread messages per channel (not total message count).
 */

import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useUIStore } from '@/store/ui-store'
import { queryKeys } from '@/lib/query-client'
import { cn } from '@/lib/utils'

interface Channel {
  id: string
  name: string
  phone_number: string | null
  status: string
  color: string | null
}

interface ChannelUnreadChats {
  channel_id: string
  unread_chats: number
}

export function ChannelSelector() {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()

  const { selectedChannelId, selectChannel, hiddenChannelIds, toggleChannelVisibility } = useUIStore()

  // Fetch channels
  const { data: channels = [], isLoading } = useQuery({
    queryKey: queryKeys.channels.list(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('channels')
        .select('id, name, phone_number, status, color')
        .order('name')

      if (error) throw error
      return data as Channel[]
    },
  })

  // Fetch number of chats with unread messages per channel
  const { data: unreadChatCounts = [] } = useQuery({
    queryKey: ['channel-unread-chats'],
    queryFn: async () => {
      // Get chats with unread messages
      const { data, error } = await supabase
        .from('chats')
        .select('channel_id')
        .gt('unread_count', 0)
        .eq('is_archived', false)

      if (error) throw error

      // Count number of chats with unreads per channel
      const chatsByChannel: Record<string, number> = {}
      for (const chat of data || []) {
        if (chat.channel_id) {
          chatsByChannel[chat.channel_id] = (chatsByChannel[chat.channel_id] || 0) + 1
        }
      }

      return Object.entries(chatsByChannel).map(([channel_id, unread_chats]) => ({
        channel_id,
        unread_chats,
      })) as ChannelUnreadChats[]
    },
    refetchInterval: 10000, // Refetch every 10 seconds
  })

  // Helper to get number of chats with unreads for a channel
  const getUnreadChats = (channelId: string) => {
    const found = unreadChatCounts.find((c) => c.channel_id === channelId)
    return found?.unread_chats || 0
  }

  // Check if a channel is visible (not hidden)
  const isChannelVisible = (channelId: string) => !hiddenChannelIds.includes(channelId)

  // Count of visible channels
  const visibleChannelCount = channels.filter((c) => isChannelVisible(c.id)).length

  // Total chats with unreads across visible channels only
  const totalUnreadChats = unreadChatCounts
    .filter((c) => isChannelVisible(c.channel_id))
    .reduce((sum, c) => sum + c.unread_chats, 0)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Get selected channel info
  const selectedChannel = channels.find((c) => c.id === selectedChannelId)
  const displayName = selectedChannel?.name || 'Unified Inbox'
  const hiddenCount = channels.length - visibleChannelCount

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-gray-100"
      >
        {/* Channel indicator */}
        {selectedChannel ? (
          <div
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: selectedChannel.color || '#10b981' }}
          />
        ) : (
          <div className="flex h-3 w-3 items-center justify-center">
            <div className="h-2 w-2 rounded-full bg-gray-400" />
            <div className="absolute h-3 w-3 rounded-full border-2 border-gray-400" />
          </div>
        )}

        <span className="font-medium text-gray-900">{displayName}</span>

        {/* Unread chats badge */}
        {totalUnreadChats > 0 && (
          <span className="rounded-full bg-green-500 px-2 py-0.5 text-xs font-medium text-white">
            {totalUnreadChats}
          </span>
        )}

        {/* Dropdown arrow */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={cn(
            'h-4 w-4 text-gray-500 transition-transform',
            isOpen && 'rotate-180'
          )}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          {/* Unified Inbox option */}
          <button
            onClick={() => {
              selectChannel(null)
              setIsOpen(false)
            }}
            className={cn(
              'flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-gray-50',
              !selectedChannelId && 'bg-green-50'
            )}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4 text-gray-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                />
              </svg>
            </div>
            <div className="flex-1">
              <p className="font-medium text-gray-900">Unified Inbox</p>
              <p className="text-xs text-gray-500">
                {hiddenCount > 0
                  ? `${visibleChannelCount} of ${channels.length} channels`
                  : 'All channels'}
              </p>
            </div>
          </button>

          {/* Divider */}
          {channels.length > 0 && <hr className="my-1 border-gray-200" />}

          {/* Channel options */}
          {isLoading ? (
            <div className="px-4 py-2 text-sm text-gray-500">Loading...</div>
          ) : channels.length === 0 ? (
            <div className="px-4 py-2 text-sm text-gray-500">
              No channels connected
            </div>
          ) : (
            channels.map((channel) => {
              const visible = isChannelVisible(channel.id)
              return (
                <div
                  key={channel.id}
                  className={cn(
                    'flex w-full items-center gap-3 px-4 py-2 hover:bg-gray-50',
                    selectedChannelId === channel.id && 'bg-green-50'
                  )}
                >
                  {/* Checkbox for unified inbox visibility */}
                  {!selectedChannelId && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleChannelVisibility(channel.id)
                      }}
                      className={cn(
                        'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 transition-colors',
                        visible
                          ? 'border-green-500 bg-green-500 text-white'
                          : 'border-gray-300 bg-white hover:border-gray-400'
                      )}
                      title={visible ? 'Hide from inbox' : 'Show in inbox'}
                    >
                      {visible && (
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  )}

                  {/* Channel button */}
                  <button
                    onClick={() => {
                      selectChannel(channel.id)
                      setIsOpen(false)
                    }}
                    className="flex flex-1 items-center gap-3 text-left min-w-0"
                  >
                    <div
                      className={cn(
                        'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-white transition-opacity',
                        !selectedChannelId && !visible && 'opacity-50'
                      )}
                      style={{ backgroundColor: channel.color || '#10b981' }}
                    >
                      {channel.name.charAt(0).toUpperCase()}
                    </div>
                    <div className={cn(
                      'flex-1 min-w-0 transition-opacity',
                      !selectedChannelId && !visible && 'opacity-50'
                    )}>
                      <p className="font-medium text-gray-900 truncate">
                        {channel.name}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {channel.phone_number || 'No phone number'}
                      </p>
                    </div>
                  </button>

                  {/* Unread chats badge */}
                  {getUnreadChats(channel.id) > 0 ? (
                    <span className={cn(
                      'flex h-5 min-w-[20px] items-center justify-center rounded-full bg-green-500 px-1.5 text-xs font-medium text-white transition-opacity',
                      !selectedChannelId && !visible && 'opacity-50'
                    )}>
                      {getUnreadChats(channel.id) > 99 ? '99+' : getUnreadChats(channel.id)}
                    </span>
                  ) : (
                    /* Show status dot only when no unreads */
                    <div
                      className={cn(
                        'h-2 w-2 rounded-full transition-opacity',
                        channel.status === 'active' && 'bg-green-500',
                        channel.status === 'needs_reauth' && 'bg-yellow-500',
                        channel.status === 'sync_error' && 'bg-red-500',
                        !['active', 'needs_reauth', 'sync_error'].includes(
                          channel.status
                        ) && 'bg-gray-400',
                        !selectedChannelId && !visible && 'opacity-50'
                      )}
                    />
                  )}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
