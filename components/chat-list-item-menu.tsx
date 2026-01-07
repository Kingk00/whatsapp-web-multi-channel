'use client'

import { useState, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'

interface ChatListItemMenuProps {
  chatId: string
  isArchived: boolean
  isMuted: boolean
  onArchive: () => void
  onMute: (duration: '8h' | '1w' | 'always') => void
  onUnmute: () => void
  onDelete: () => void
}

export function ChatListItemMenu({
  chatId,
  isArchived,
  isMuted,
  onArchive,
  onMute,
  onUnmute,
  onDelete,
}: ChatListItemMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [showMuteSubmenu, setShowMuteSubmenu] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close menu on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        setShowMuteSubmenu(false)
        setShowDeleteConfirm(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

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

  return (
    <div className="relative" ref={menuRef}>
      {/* Menu trigger button */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          setIsOpen(!isOpen)
          setShowMuteSubmenu(false)
          setShowDeleteConfirm(false)
        }}
        className={cn(
          'rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600',
          isOpen && 'bg-gray-200 text-gray-600'
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

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          {/* Archive / Unarchive */}
          <button
            onClick={handleArchiveClick}
            className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
          >
            {isArchived ? (
              <>
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
                Unarchive
              </>
            ) : (
              <>
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
                Archive
              </>
            )}
          </button>

          {/* Mute / Unmute */}
          {isMuted ? (
            <button
              onClick={handleUnmuteClick}
              className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
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
                  d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                />
              </svg>
              Unmute
            </button>
          ) : (
            <div className="relative">
              <button
                onClick={() => setShowMuteSubmenu(!showMuteSubmenu)}
                className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
              >
                <span className="flex items-center gap-3">
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
                      d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
                    />
                  </svg>
                  Mute
                </span>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className={cn(
                    'h-4 w-4 transition-transform',
                    showMuteSubmenu && 'rotate-90'
                  )}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>

              {/* Mute submenu */}
              {showMuteSubmenu && (
                <div className="border-t border-gray-100 bg-gray-50">
                  <button
                    onClick={() => handleMuteClick('8h')}
                    className="flex w-full items-center gap-3 px-8 py-2 text-left text-sm text-gray-600 hover:bg-gray-100"
                  >
                    8 hours
                  </button>
                  <button
                    onClick={() => handleMuteClick('1w')}
                    className="flex w-full items-center gap-3 px-8 py-2 text-left text-sm text-gray-600 hover:bg-gray-100"
                  >
                    1 week
                  </button>
                  <button
                    onClick={() => handleMuteClick('always')}
                    className="flex w-full items-center gap-3 px-8 py-2 text-left text-sm text-gray-600 hover:bg-gray-100"
                  >
                    Always
                  </button>
                </div>
              )}
            </div>
          )}

          <hr className="my-1 border-gray-100" />

          {/* Delete */}
          <button
            onClick={handleDeleteClick}
            className={cn(
              'flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-red-50',
              showDeleteConfirm ? 'text-red-600' : 'text-red-500'
            )}
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
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
            {showDeleteConfirm ? 'Click again to confirm' : 'Delete chat'}
          </button>
        </div>
      )}
    </div>
  )
}
