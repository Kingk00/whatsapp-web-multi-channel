'use client'

/**
 * Inbox Page
 *
 * Main chat interface with mobile-first responsive design:
 * - Mobile (< md): Full-screen views with bottom navigation
 * - Tablet (md): Sidebar + chat view
 * - Desktop (lg+): Sidebar + chat view + details panel
 */

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireAuth } from '@/hooks/use-auth'
import { useUIStore } from '@/store/ui-store'
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts'
import { ChatList } from '@/components/chat-list'
import { ChatView } from '@/components/chat-view'
import { ChannelSelector } from '@/components/channel-selector'
import { ConnectionBanner } from '@/components/connection-banner'
import { ContactInfoPanel } from '@/components/contact-info-panel'
import { BottomNavigation, NavItem } from '@/components/ui/bottom-navigation'
import { cn } from '@/lib/utils'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-client'

type ChatFilter = 'all' | 'unread' | 'groups'

interface Label {
  id: string
  name: string
  color: string
}

export default function InboxPage() {
  const router = useRouter()
  const { isLoading, isAuthenticated, profile, signOut } = useRequireAuth()
  const [searchQuery, setSearchQuery] = useState('')
  const [chatFilter, setChatFilter] = useState<ChatFilter>('all')
  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null)
  const [showLabels, setShowLabels] = useState(true)
  const [activeNav, setActiveNav] = useState<NavItem>('chats')
  const [isMobile, setIsMobile] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()

  const {
    selectedChatId,
    selectedChannelId,
    sidebarCollapsed,
    detailsPanelOpen,
    toggleDetailsPanel,
    selectChat,
  } = useUIStore()

  // Fetch labels for the Labels section
  const { data: labelsData } = useQuery({
    queryKey: ['labels'],
    queryFn: async () => {
      const response = await fetch('/api/labels')
      if (!response.ok) throw new Error('Failed to fetch labels')
      return response.json()
    },
  })

  // Fetch chats to determine which labels are in use
  const { data: chatsData } = useQuery({
    queryKey: queryKeys.chats.list(selectedChannelId || undefined),
    queryFn: async () => {
      const params = new URLSearchParams()
      if (selectedChannelId) params.set('channel_id', selectedChannelId)
      params.set('limit', '100')
      params.set('archived', 'exclude')
      const response = await fetch(`/api/chats?${params.toString()}`)
      if (!response.ok) throw new Error('Failed to fetch chats')
      return response.json()
    },
  })

  // Filter labels to only show those that have at least one chat assigned
  const allLabels: Label[] = labelsData?.labels || []
  const chats = chatsData?.chats || []

  const labels = allLabels.filter((label) =>
    chats.some((chat: { labels?: Array<{ id: string }> }) =>
      chat.labels?.some((chatLabel) => chatLabel.id === label.id)
    )
  )

  // Handle label selection - clears when clicking the same label
  const handleLabelClick = useCallback((labelId: string) => {
    setSelectedLabelId((prev) => (prev === labelId ? null : labelId))
  }, [])

  // Detect mobile viewport
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768)
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Keyboard shortcuts
  const focusSearch = useCallback(() => {
    searchInputRef.current?.focus()
  }, [])

  const handleEscape = useCallback(() => {
    if (searchQuery) {
      setSearchQuery('')
    } else if (detailsPanelOpen) {
      toggleDetailsPanel()
    } else if (selectedChatId && isMobile) {
      selectChat(null)
    }
  }, [searchQuery, detailsPanelOpen, selectedChatId, toggleDetailsPanel, selectChat, isMobile])

  useKeyboardShortcuts([
    { key: 'k', ctrl: true, action: focusSearch, description: 'Focus search' },
    { key: '/', action: focusSearch, description: 'Focus search' },
    { key: 'Escape', action: handleEscape, description: 'Close panel / Clear' },
  ])

  // Handle chat selection with unread count clearing
  const handleSelectChat = useCallback(async (chatId: string | null, channelId?: string) => {
    selectChat(chatId, channelId)

    if (chatId) {
      try {
        await fetch(`/api/chats/${chatId}/read`, { method: 'POST' })
        queryClient.invalidateQueries({ queryKey: queryKeys.chats.all })
      } catch (error) {
        console.error('Failed to mark chat as read:', error)
      }
    }
  }, [selectChat, queryClient])

  // Handle mobile back button
  const handleMobileBack = useCallback(() => {
    selectChat(null)
  }, [selectChat])

  // Handle bottom navigation
  const handleNavClick = useCallback((item: NavItem) => {
    setActiveNav(item)
    if (item === 'channels') {
      router.push('/settings/channels')
    } else if (item === 'settings') {
      router.push('/settings/account')
    } else {
      // Reset to chat list
      if (isMobile && selectedChatId) {
        selectChat(null)
      }
    }
  }, [router, isMobile, selectedChatId, selectChat])

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
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-whatsapp-500 border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return null
  }

  // Mobile: Show either chat list or chat view
  const showChatList = !isMobile || !selectedChatId
  const showChatView = !isMobile || selectedChatId

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Connection status banner */}
      <ConnectionBanner />

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar - Chat list */}
        {showChatList && (
          <aside
            className={cn(
              'flex flex-col border-r border-border bg-card transition-all duration-normal',
              // Mobile: full width, Desktop: fixed width
              isMobile ? 'w-full' : sidebarCollapsed ? 'w-16' : 'w-80 lg:w-96'
            )}
          >
            {/* Header with channel selector */}
            <header className="flex min-h-[64px] items-center justify-between border-b border-border px-3 md:px-4 py-2">
              <ChannelSelector />

              {/* Desktop only: Settings and logout */}
              <div className="hidden md:flex items-center gap-1">
                <button
                  onClick={() => router.push('/settings/channels')}
                  className="btn-icon touch-target"
                  title="Settings"
                >
                  <SettingsIcon className="h-6 w-6" />
                </button>
                <button
                  onClick={signOut}
                  className="btn-icon hover:text-destructive touch-target"
                  title="Logout"
                >
                  <LogoutIcon className="h-6 w-6" />
                </button>
              </div>
            </header>

            {/* Search bar */}
            <div className="p-3 md:p-4 space-y-3">
              <div className="relative">
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search chats..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="search-input"
                />
                <SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground hover:text-foreground active:bg-muted rounded-full"
                  >
                    <XIcon className="h-5 w-5" />
                  </button>
                )}
              </div>

              {/* Filter tabs - 44px minimum touch targets for mobile */}
              <div className="flex gap-1.5">
                {(['all', 'unread', 'groups'] as const).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setChatFilter(filter)}
                    className={cn(
                      'flex-1 min-h-[44px] py-2.5 text-sm font-medium rounded-xl transition-colors active:scale-[0.98]',
                      chatFilter === filter
                        ? 'bg-whatsapp-500 text-white shadow-sm'
                        : 'text-muted-foreground hover:bg-muted active:bg-muted/80'
                    )}
                  >
                    {filter.charAt(0).toUpperCase() + filter.slice(1)}
                  </button>
                ))}
              </div>

              {/* Labels section */}
              {labels.length > 0 && (
                <div className="space-y-2">
                  <button
                    onClick={() => setShowLabels(!showLabels)}
                    className="flex w-full items-center justify-between text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <span className="flex items-center gap-1.5">
                      <LabelIcon className="h-3.5 w-3.5" />
                      Labels ({labels.length})
                    </span>
                    <svg
                      className={cn('h-3.5 w-3.5 transition-transform duration-200', showLabels && 'rotate-180')}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {showLabels && (
                    <div className="flex flex-wrap gap-1.5">
                      {labels.map((label) => (
                        <button
                          key={label.id}
                          onClick={() => handleLabelClick(label.id)}
                          className={cn(
                            'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all active:scale-[0.98]',
                            selectedLabelId === label.id
                              ? 'ring-2 ring-offset-1 ring-offset-background'
                              : 'opacity-80 hover:opacity-100'
                          )}
                          style={{
                            backgroundColor: `${label.color}20`,
                            color: label.color,
                            ...(selectedLabelId === label.id && { ringColor: label.color }),
                          }}
                        >
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: label.color }}
                          />
                          {label.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Chat list */}
            <div className="flex-1 overflow-y-auto scrollbar-thin">
              <ChatList
                channelId={selectedChannelId}
                searchQuery={searchQuery}
                filter={chatFilter}
                labelId={selectedLabelId}
                onSelectChat={handleSelectChat}
              />
            </div>
          </aside>
        )}

        {/* Center - Active chat */}
        {showChatView && (
          <main className="flex flex-1 flex-col chat-pattern">
            {selectedChatId ? (
              <ChatView
                chatId={selectedChatId}
                onBack={isMobile ? handleMobileBack : undefined}
              />
            ) : (
              !isMobile && <EmptyState />
            )}
          </main>
        )}

        {/* Right sidebar - Details panel (desktop only) */}
        {!isMobile && detailsPanelOpen && selectedChatId && (
          <ContactInfoPanel
            chatId={selectedChatId}
            onClose={toggleDetailsPanel}
          />
        )}
      </div>

      {/* Mobile bottom navigation */}
      {isMobile && !selectedChatId && (
        <BottomNavigation
          activeItem={activeNav}
          onItemClick={handleNavClick}
          unreadCount={0}
        />
      )}
    </div>
  )
}

/**
 * Empty state when no chat is selected
 */
function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 flex h-32 w-32 items-center justify-center rounded-full bg-whatsapp-100">
          <ChatBubbleIcon className="h-16 w-16 text-whatsapp-600" />
        </div>
        <h2 className="mb-2 text-2xl font-light text-foreground">
          WhatsApp Web Multi-Channel
        </h2>
        <p className="text-muted-foreground">
          Send and receive messages from multiple WhatsApp Business accounts.
          Select a chat from the list to start messaging.
        </p>
      </div>
    </div>
  )
}

// Icons
function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}

function LogoutIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  )
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  )
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

function ChatBubbleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  )
}

function LabelIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
    </svg>
  )
}
