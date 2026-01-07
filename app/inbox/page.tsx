'use client'

/**
 * Inbox Page
 *
 * Main chat interface with:
 * - Channel selector (left sidebar header)
 * - Chat list (left sidebar)
 * - Active chat view (center)
 * - Details panel (right, collapsible)
 *
 * Layout follows WhatsApp Web design patterns.
 */

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRequireAuth } from '@/hooks/use-auth'
import { useUIStore } from '@/store/ui-store'
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts'
import { ChatList } from '@/components/chat-list'
import { ChatView } from '@/components/chat-view'
import { ChannelSelector } from '@/components/channel-selector'
import { ConnectionBanner } from '@/components/connection-banner'
import { ContactInfoPanel } from '@/components/contact-info-panel'
import { cn } from '@/lib/utils'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-client'

type ChatFilter = 'all' | 'unread' | 'groups'

export default function InboxPage() {
  const { isLoading, isAuthenticated, profile, signOut } = useRequireAuth()
  const [searchQuery, setSearchQuery] = useState('')
  const [chatFilter, setChatFilter] = useState<ChatFilter>('all')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const {
    selectedChatId,
    selectedChannelId,
    sidebarCollapsed,
    detailsPanelOpen,
    isOnline,
    isReconnecting,
    toggleDetailsPanel,
    selectChat,
  } = useUIStore()

  // Keyboard shortcuts
  const focusSearch = useCallback(() => {
    searchInputRef.current?.focus()
  }, [])

  const handleEscape = useCallback(() => {
    if (searchQuery) {
      setSearchQuery('')
    } else if (detailsPanelOpen) {
      toggleDetailsPanel()
    } else if (selectedChatId) {
      selectChat(null)
    }
  }, [searchQuery, detailsPanelOpen, selectedChatId, toggleDetailsPanel, selectChat])

  useKeyboardShortcuts([
    { key: 'k', ctrl: true, action: focusSearch, description: 'Focus search' },
    { key: '/', action: focusSearch, description: 'Focus search' },
    { key: 'Escape', action: handleEscape, description: 'Close panel / Clear' },
  ])

  // Handle chat selection with unread count clearing
  const handleSelectChat = useCallback(async (chatId: string | null, channelId?: string) => {
    selectChat(chatId, channelId)

    // Clear unread count when selecting a chat
    if (chatId) {
      try {
        await fetch(`/api/chats/${chatId}/read`, { method: 'POST' })
        // Invalidate chats to refresh unread counts
        queryClient.invalidateQueries({ queryKey: queryKeys.chats.all })
      } catch (error) {
        console.error('Failed to mark chat as read:', error)
      }
    }
  }, [selectChat, queryClient])

  // Update max panes based on screen width
  useEffect(() => {
    const updateMaxPanes = () => {
      const width = window.innerWidth
      if (width >= 1440) {
        useUIStore.getState().setMaxPanes(4)
      } else if (width >= 1200) {
        useUIStore.getState().setMaxPanes(3)
      } else if (width >= 1024) {
        useUIStore.getState().setMaxPanes(2)
      } else {
        useUIStore.getState().setMaxPanes(1)
      }
    }

    updateMaxPanes()
    window.addEventListener('resize', updateMaxPanes)
    return () => window.removeEventListener('resize', updateMaxPanes)
  }, [])

  // Loading state
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-100">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-green-500 border-t-transparent" />
          <p className="text-sm text-gray-500">Loading...</p>
        </div>
      </div>
    )
  }

  // Not authenticated - useRequireAuth will redirect
  if (!isAuthenticated) {
    return null
  }

  return (
    <div className="flex h-screen flex-col bg-gray-100">
      {/* Connection status banner */}
      <ConnectionBanner />

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar - Chat list */}
        <aside
          className={cn(
            'flex flex-col border-r border-gray-200 bg-white transition-all duration-300',
            sidebarCollapsed ? 'w-16' : 'w-80 lg:w-96'
          )}
        >
          {/* Header with channel selector */}
          <header className="flex h-16 items-center justify-between border-b border-gray-200 px-4">
            <ChannelSelector />

            {/* User menu */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => window.location.href = '/settings/channels'}
                className="rounded-full p-2 text-gray-500 hover:bg-gray-100"
                title="Settings"
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
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </button>
              <button
                onClick={signOut}
                className="rounded-full p-2 text-gray-500 hover:bg-gray-100 hover:text-red-500"
                title="Logout"
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
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                  />
                </svg>
              </button>
            </div>
          </header>

          {/* Search bar */}
          <div className="border-b border-gray-200 p-2">
            <div className="relative">
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search chats... (Ctrl+K)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg bg-gray-100 py-2 pl-10 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="absolute left-3 top-2.5 h-4 w-4 text-gray-400"
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
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {/* Filter bubbles */}
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => setChatFilter('all')}
                className={cn(
                  'rounded-full px-3 py-1 text-sm font-medium transition-colors',
                  chatFilter === 'all'
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                )}
              >
                All
              </button>
              <button
                onClick={() => setChatFilter('unread')}
                className={cn(
                  'rounded-full px-3 py-1 text-sm font-medium transition-colors',
                  chatFilter === 'unread'
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                )}
              >
                Unread
              </button>
              <button
                onClick={() => setChatFilter('groups')}
                className={cn(
                  'rounded-full px-3 py-1 text-sm font-medium transition-colors',
                  chatFilter === 'groups'
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                )}
              >
                Groups
              </button>
            </div>
          </div>

          {/* Chat list */}
          <div className="flex-1 overflow-y-auto">
            <ChatList
              channelId={selectedChannelId}
              searchQuery={searchQuery}
              filter={chatFilter}
              onSelectChat={handleSelectChat}
            />
          </div>
        </aside>

        {/* Center - Active chat */}
        <main className="flex flex-1 flex-col bg-[#efeae2]">
          {selectedChatId ? (
            <ChatView chatId={selectedChatId} />
          ) : (
            <EmptyState />
          )}
        </main>

        {/* Right sidebar - Details panel (optional) */}
        {detailsPanelOpen && selectedChatId && (
          <ContactInfoPanel
            chatId={selectedChatId}
            onClose={toggleDetailsPanel}
          />
        )}
      </div>
    </div>
  )
}

/**
 * Empty state when no chat is selected
 */
function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 flex h-32 w-32 items-center justify-center rounded-full bg-green-100">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-16 w-16 text-green-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
        </div>
        <h2 className="mb-2 text-2xl font-light text-gray-700">
          WhatsApp Web Multi-Channel
        </h2>
        <p className="text-gray-500">
          Send and receive messages from multiple WhatsApp Business accounts.
          Select a chat from the list to start messaging.
        </p>
      </div>
    </div>
  )
}
