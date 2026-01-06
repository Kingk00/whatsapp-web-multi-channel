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
        (payload) => {
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
      <ChatHeader chat={chat} displayName={displayName} />

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto px-4 py-2"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23d5d1c9' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}
      >
        {messagesLoading ? (
          <div className="flex h-full items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-green-500 border-t-transparent" />
          </div>
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
}: {
  chat: Chat | undefined
  displayName: string
}) {
  const { toggleDetailsPanel } = useUIStore()

  return (
    <header className="flex h-16 items-center justify-between border-b border-gray-200 bg-gray-50 px-4">
      <div className="flex items-center gap-3">
        {/* Avatar */}
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

        {/* Info */}
        <div>
          <h2 className="font-medium text-gray-900">{displayName}</h2>
          {chat?.channel && (
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

  return (
    <div
      className={cn('flex', isOutbound ? 'justify-end' : 'justify-start')}
    >
      <div
        className={cn(
          'max-w-[65%] rounded-lg px-3 py-2 shadow-sm',
          isOutbound ? 'bg-[#d9fdd3]' : 'bg-white'
        )}
      >
        {/* Sender name (for group chats) */}
        {!isOutbound && message.sender_name && (
          <p className="mb-1 text-xs font-medium text-green-600">
            {message.sender_name}
          </p>
        )}

        {/* Message content */}
        {message.deleted_at ? (
          <p className="italic text-gray-400">This message was deleted</p>
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm text-gray-900">
            {message.text}
          </p>
        )}

        {/* Footer with time and status */}
        <div
          className={cn(
            'mt-1 flex items-center gap-1',
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

function MessageStatus({ status }: { status: string | null }) {
  if (!status) return null

  const getStatusIcon = () => {
    switch (status) {
      case 'pending':
        return (
          <svg className="h-3 w-3 text-gray-400" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        )
      case 'sent':
        return (
          <svg className="h-3 w-3 text-gray-400" viewBox="0 0 16 16" fill="currentColor">
            <path d="M10.97 4.97a.75.75 0 0 1 1.071 1.05l-3.992 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.235.235 0 0 1 .02-.022z" />
          </svg>
        )
      case 'delivered':
        return (
          <svg className="h-3 w-3 text-gray-400" viewBox="0 0 16 16" fill="currentColor">
            <path d="M12.354 4.354a.5.5 0 0 0-.708-.708L5 10.293 1.854 7.146a.5.5 0 1 0-.708.708l3.5 3.5a.5.5 0 0 0 .708 0l7-7zm-4.208 7-.896-.897.707-.707.543.543 6.646-6.647a.5.5 0 0 1 .708.708l-7 7a.5.5 0 0 1-.708 0z" />
          </svg>
        )
      case 'read':
        return (
          <svg className="h-3 w-3 text-blue-500" viewBox="0 0 16 16" fill="currentColor">
            <path d="M12.354 4.354a.5.5 0 0 0-.708-.708L5 10.293 1.854 7.146a.5.5 0 1 0-.708.708l3.5 3.5a.5.5 0 0 0 .708 0l7-7zm-4.208 7-.896-.897.707-.707.543.543 6.646-6.647a.5.5 0 0 1 .708.708l-7 7a.5.5 0 0 1-.708 0z" />
          </svg>
        )
      case 'failed':
        return (
          <svg className="h-3 w-3 text-red-500" viewBox="0 0 16 16" fill="currentColor">
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

function MessageComposer({
  chatId,
  channelColor,
}: {
  chatId: string
  channelColor: string | null | undefined
}) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const queryClient = useQueryClient()
  const { getDraft, setDraft, clearDraft } = useUIStore()

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

  // Send mutation
  const sendMutation = useMutation({
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
    onSuccess: () => {
      setText('')
      clearDraft(chatId)
      // Invalidate messages to show the new one
      queryClient.invalidateQueries({
        queryKey: queryKeys.messages.list(chatId),
      })
      // Invalidate chat list to update last message preview
      queryClient.invalidateQueries({
        queryKey: queryKeys.chats.all,
      })
    },
  })

  const handleSend = () => {
    const trimmedText = text.trim()
    if (!trimmedText || sendMutation.isPending) return
    sendMutation.mutate(trimmedText)
  }

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

      {/* Input area */}
      <div className="flex items-end gap-2">
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
            placeholder="Type a message"
            className="w-full resize-none rounded-lg bg-white px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            rows={1}
            disabled={sendMutation.isPending}
          />
        </div>

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!text.trim() || sendMutation.isPending}
          className={cn(
            'rounded-full p-2 transition-colors',
            text.trim() && !sendMutation.isPending
              ? 'bg-green-500 text-white hover:bg-green-600'
              : 'text-gray-400'
          )}
        >
          {sendMutation.isPending ? (
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

      {/* Error message */}
      {sendMutation.isError && (
        <p className="mt-2 text-xs text-red-500">
          Failed to send message. Please try again.
        </p>
      )}
    </div>
  )
}
