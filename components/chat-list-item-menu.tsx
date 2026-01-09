'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { LabelPicker } from '@/components/label-picker'

interface Label {
  id: string
  name: string
  color: string
}

interface ChatListItemMenuProps {
  chatId: string
  isArchived: boolean
  isMuted: boolean
  isPinned?: boolean
  labels?: Label[]
  onArchive: () => void
  onMute: (duration: '8h' | '1w' | 'always') => void
  onUnmute: () => void
  onPin: () => void
  onDelete: () => void
  onOpenChange?: (isOpen: boolean) => void
}

export function ChatListItemMenu({
  chatId,
  isArchived,
  isMuted,
  isPinned,
  labels = [],
  onArchive,
  onMute,
  onUnmute,
  onPin,
  onDelete,
  onOpenChange,
}: ChatListItemMenuProps) {
  const [isOpenInternal, setIsOpenInternal] = useState(false)
  const [showMuteSubmenu, setShowMuteSubmenu] = useState(false)
  const [showLabelsSubmenu, setShowLabelsSubmenu] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Wrapper to notify parent of open state changes
  const setIsOpen = (value: boolean) => {
    setIsOpenInternal(value)
    onOpenChange?.(value)
  }

  // Calculate menu position when opening
  const openMenu = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      // Position menu above the button, aligned to the right
      setMenuPosition({
        top: rect.top - 8, // 8px gap above button
        left: rect.right - 208, // 208px is menu width (w-52 = 13rem = 208px)
      })
    }
    setIsOpen(true)
  }

  // Close menu on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        buttonRef.current &&
        !buttonRef.current.contains(target)
      ) {
        setIsOpen(false)
        setShowMuteSubmenu(false)
        setShowLabelsSubmenu(false)
        setShowDeleteConfirm(false)
      }
    }

    // Close on scroll
    const handleScroll = () => {
      if (isOpenInternal) {
        setIsOpen(false)
        setShowMuteSubmenu(false)
        setShowLabelsSubmenu(false)
        setShowDeleteConfirm(false)
      }
    }

    if (isOpenInternal) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('scroll', handleScroll, true)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('scroll', handleScroll, true)
    }
  }, [isOpenInternal])

  const handlePinClick = () => {
    onPin()
    setIsOpen(false)
  }

  const handleArchiveClick = () => {
    onArchive()
    setIsOpen(false)
  }

  const handleMuteClick = (duration: '8h' | '1w' | 'always') => {
    onMute(duration)
    setIsOpen(false)
    setShowMuteSubmenu(false)
  }

  const handleUnmuteClick = () => {
    onUnmute()
    setIsOpen(false)
  }

  const handleDeleteClick = () => {
    if (showDeleteConfirm) {
      onDelete()
      setIsOpen(false)
      setShowDeleteConfirm(false)
    } else {
      setShowDeleteConfirm(true)
    }
  }

  // Menu content component
  const menuContent = (
    <div
      ref={menuRef}
      className="fixed w-52 rounded-lg border border-border bg-card py-2 shadow-2xl"
      style={{
        top: menuPosition.top,
        left: menuPosition.left,
        zIndex: 99999,
        transform: 'translateY(-100%)',
      }}
    >
          {/* Pin / Unpin */}
          <button
            onClick={handlePinClick}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-foreground hover:bg-muted"
          >
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
                d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
              />
            </svg>
            {isPinned ? 'Unpin' : 'Pin'}
          </button>

          {/* Labels */}
          <div className="relative">
            <button
              onClick={() => setShowLabelsSubmenu(!showLabelsSubmenu)}
              className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm text-foreground hover:bg-muted"
            >
              <span className="flex items-center gap-3">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
                </svg>
                Labels
                {labels.length > 0 && (
                  <span className="text-xs text-muted-foreground">({labels.length})</span>
                )}
              </span>
              <svg className={cn('h-4 w-4 transition-transform', showLabelsSubmenu && 'rotate-90')} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>

            {/* Labels submenu */}
            {showLabelsSubmenu && (
              <div className="border-t border-border">
                <LabelPicker
                  chatId={chatId}
                  currentLabels={labels}
                  onClose={() => setShowLabelsSubmenu(false)}
                />
              </div>
            )}
          </div>

          {/* Archive / Unarchive */}
          <button
            onClick={handleArchiveClick}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-foreground hover:bg-muted"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
            {isArchived ? 'Unarchive' : 'Archive'}
          </button>

          {/* Mute / Unmute */}
          {isMuted ? (
            <button
              onClick={handleUnmuteClick}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-foreground hover:bg-muted"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              </svg>
              Unmute
            </button>
          ) : (
            <div className="relative">
              <button
                onClick={() => setShowMuteSubmenu(!showMuteSubmenu)}
                className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm text-foreground hover:bg-muted"
              >
                <span className="flex items-center gap-3">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                  </svg>
                  Mute
                </span>
                <svg className={cn('h-4 w-4 transition-transform', showMuteSubmenu && 'rotate-90')} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>

              {/* Mute submenu */}
              {showMuteSubmenu && (
                <div className="border-t border-border bg-muted/50 py-1">
                  <button onClick={() => handleMuteClick('8h')} className="flex w-full items-center gap-3 px-8 py-2.5 text-left text-sm text-muted-foreground hover:bg-muted">
                    8 hours
                  </button>
                  <button onClick={() => handleMuteClick('1w')} className="flex w-full items-center gap-3 px-8 py-2.5 text-left text-sm text-muted-foreground hover:bg-muted">
                    1 week
                  </button>
                  <button onClick={() => handleMuteClick('always')} className="flex w-full items-center gap-3 px-8 py-2.5 text-left text-sm text-muted-foreground hover:bg-muted">
                    Always
                  </button>
                </div>
              )}
            </div>
          )}

          <hr className="my-1.5 border-border" />

          {/* Delete */}
          <button
            onClick={handleDeleteClick}
            className={cn(
              'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-destructive/10',
              showDeleteConfirm ? 'text-destructive font-medium' : 'text-destructive'
            )}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            {showDeleteConfirm ? 'Click again to confirm' : 'Delete chat'}
          </button>
    </div>
  )

  return (
    <>
      {/* Menu trigger button */}
      <button
        ref={buttonRef}
        onClick={(e) => {
          e.stopPropagation()
          if (isOpenInternal) {
            setIsOpen(false)
            setShowMuteSubmenu(false)
            setShowDeleteConfirm(false)
          } else {
            openMenu()
            setShowMuteSubmenu(false)
            setShowDeleteConfirm(false)
          }
        }}
        className={cn(
          'rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
          isOpenInternal && 'bg-muted text-foreground'
        )}
        title="More options"
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
            d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
          />
        </svg>
      </button>

      {/* Portal the dropdown menu to body to escape stacking context */}
      {isOpenInternal && typeof document !== 'undefined' && createPortal(menuContent, document.body)}
    </>
  )
}
