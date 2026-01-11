'use client'

import { cn } from '@/lib/utils'
import { Badge } from './badge'

export type NavItem = 'chats' | 'channels' | 'settings'

interface BottomNavigationProps {
  activeItem: NavItem
  onItemClick: (item: NavItem) => void
  unreadCount?: number
  className?: string
}

export function BottomNavigation({
  activeItem,
  onItemClick,
  unreadCount = 0,
  className,
}: BottomNavigationProps) {
  return (
    <nav
      className={cn(
        'fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-card border-t border-border md:hidden',
        className
      )}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-center justify-around min-h-[60px]">
        {/* Chats */}
        <button
          onClick={() => onItemClick('chats')}
          className={cn(
            'flex flex-col items-center justify-center flex-1 min-h-[60px] gap-1 transition-colors tap-transparent active:bg-muted/30',
            activeItem === 'chats'
              ? 'text-whatsapp-500'
              : 'text-muted-foreground'
          )}
        >
          <div className="relative">
            <ChatIcon className="w-7 h-7" />
            {unreadCount > 0 && (
              <Badge
                count={unreadCount}
                size="sm"
                className="absolute -top-1.5 -right-2"
              />
            )}
          </div>
          <span className="text-[11px] font-medium">Chats</span>
          {activeItem === 'chats' && (
            <span className="absolute bottom-1 w-1.5 h-1.5 rounded-full bg-whatsapp-500" />
          )}
        </button>

        {/* Channels */}
        <button
          onClick={() => onItemClick('channels')}
          className={cn(
            'flex flex-col items-center justify-center flex-1 min-h-[60px] gap-1 transition-colors tap-transparent relative active:bg-muted/30',
            activeItem === 'channels'
              ? 'text-whatsapp-500'
              : 'text-muted-foreground'
          )}
        >
          <ChannelIcon className="w-7 h-7" />
          <span className="text-[11px] font-medium">Channels</span>
          {activeItem === 'channels' && (
            <span className="absolute bottom-1 w-1.5 h-1.5 rounded-full bg-whatsapp-500" />
          )}
        </button>

        {/* Settings */}
        <button
          onClick={() => onItemClick('settings')}
          className={cn(
            'flex flex-col items-center justify-center flex-1 min-h-[60px] gap-1 transition-colors tap-transparent relative active:bg-muted/30',
            activeItem === 'settings'
              ? 'text-whatsapp-500'
              : 'text-muted-foreground'
          )}
        >
          <SettingsIcon className="w-7 h-7" />
          <span className="text-[11px] font-medium">Settings</span>
          {activeItem === 'settings' && (
            <span className="absolute bottom-1 w-1.5 h-1.5 rounded-full bg-whatsapp-500" />
          )}
        </button>
      </div>
    </nav>
  )
}

// Icons
function ChatIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function ChannelIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  )
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}
