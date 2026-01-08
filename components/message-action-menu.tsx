'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

interface Message {
  id: string
  direction: 'inbound' | 'outbound'
  message_type: string
  text: string | null
  deleted_at: string | null
}

interface MessageActionMenuProps {
  message: Message
  position: { top: number; left: number }
  onClose: () => void
  onEdit: () => void
  onDelete: (forEveryone: boolean) => void
  onCopy: () => void
}

export function MessageActionMenu({
  message,
  position,
  onClose,
  onEdit,
  onDelete,
  onCopy,
}: MessageActionMenuProps) {
  const [showDeleteOptions, setShowDeleteOptions] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const canEdit =
    message.direction === 'outbound' &&
    message.message_type === 'text' &&
    !message.deleted_at

  const canDelete = !message.deleted_at
  const canCopy = message.text && !message.deleted_at
  const isOutbound = message.direction === 'outbound'

  // Close menu on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (menuRef.current && !menuRef.current.contains(target)) {
        onClose()
      }
    }

    const handleScroll = () => {
      onClose()
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('scroll', handleScroll, true)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('scroll', handleScroll, true)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  const handleEditClick = () => {
    onEdit()
    onClose()
  }

  const handleCopyClick = () => {
    onCopy()
    onClose()
  }

  const handleDeleteClick = () => {
    if (isOutbound) {
      // Show delete options for outbound messages
      setShowDeleteOptions(true)
    } else {
      // Direct delete for inbound (local only)
      onDelete(false)
      onClose()
    }
  }

  const handleDeleteForMe = () => {
    onDelete(false)
    onClose()
  }

  const handleDeleteForEveryone = () => {
    onDelete(true)
    onClose()
  }

  const menuContent = (
    <div
      ref={menuRef}
      className="fixed w-48 rounded-lg border border-border bg-card py-1.5 shadow-2xl"
      style={{
        top: position.top,
        left: position.left,
        zIndex: 99999,
      }}
    >
      {!showDeleteOptions ? (
        <>
          {/* Edit (only for outbound text messages) */}
          {canEdit && (
            <button
              onClick={handleEditClick}
              className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-foreground hover:bg-muted"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                />
              </svg>
              Edit
            </button>
          )}

          {/* Copy */}
          {canCopy && (
            <button
              onClick={handleCopyClick}
              className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-foreground hover:bg-muted"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              Copy
            </button>
          )}

          {/* Divider */}
          {(canEdit || canCopy) && canDelete && (
            <hr className="my-1 border-border" />
          )}

          {/* Delete */}
          {canDelete && (
            <button
              onClick={handleDeleteClick}
              className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
            >
              <svg
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
              Delete
            </button>
          )}
        </>
      ) : (
        <>
          {/* Delete options for outbound messages */}
          <button
            onClick={handleDeleteForEveryone}
            className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
          >
            <svg
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
            Delete for everyone
          </button>
          <button
            onClick={handleDeleteForMe}
            className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-muted-foreground hover:bg-muted"
          >
            <svg
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
            Delete for me
          </button>
          <hr className="my-1 border-border" />
          <button
            onClick={() => setShowDeleteOptions(false)}
            className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-muted-foreground hover:bg-muted"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 19l-7-7m0 0l7-7m-7 7h18"
              />
            </svg>
            Back
          </button>
        </>
      )}
    </div>
  )

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(menuContent, document.body)
}

// Mobile action sheet variant
interface MessageActionSheetProps {
  message: Message
  isOpen: boolean
  onClose: () => void
  onEdit: () => void
  onDelete: (forEveryone: boolean) => void
  onCopy: () => void
}

export function MessageActionSheet({
  message,
  isOpen,
  onClose,
  onEdit,
  onDelete,
  onCopy,
}: MessageActionSheetProps) {
  const canEdit =
    message.direction === 'outbound' &&
    message.message_type === 'text' &&
    !message.deleted_at

  const canDelete = !message.deleted_at
  const canCopy = message.text && !message.deleted_at
  const isOutbound = message.direction === 'outbound'

  if (!isOpen || typeof document === 'undefined') {
    return null
  }

  const handleEdit = () => {
    onEdit()
    onClose()
  }

  const handleCopy = () => {
    onCopy()
    onClose()
  }

  const handleDeleteForMe = () => {
    onDelete(false)
    onClose()
  }

  const handleDeleteForEveryone = () => {
    onDelete(true)
    onClose()
  }

  const sheetContent = (
    <div className="fixed inset-0 z-[99999]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="absolute bottom-0 left-0 right-0 rounded-t-xl bg-card animate-in slide-in-from-bottom duration-200">
        <div className="mx-auto my-3 h-1 w-10 rounded-full bg-muted" />

        <div className="px-2 pb-safe-bottom">
          {/* Edit */}
          {canEdit && (
            <button
              onClick={handleEdit}
              className="flex w-full items-center gap-4 rounded-lg px-4 py-3.5 text-left text-base text-foreground active:bg-muted"
            >
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                />
              </svg>
              Edit message
            </button>
          )}

          {/* Copy */}
          {canCopy && (
            <button
              onClick={handleCopy}
              className="flex w-full items-center gap-4 rounded-lg px-4 py-3.5 text-left text-base text-foreground active:bg-muted"
            >
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              Copy text
            </button>
          )}

          {/* Divider */}
          {canDelete && (canEdit || canCopy) && (
            <hr className="my-2 border-border" />
          )}

          {/* Delete options */}
          {canDelete && isOutbound && (
            <button
              onClick={handleDeleteForEveryone}
              className="flex w-full items-center gap-4 rounded-lg px-4 py-3.5 text-left text-base text-destructive active:bg-destructive/10"
            >
              <svg
                className="h-5 w-5"
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
              Delete for everyone
            </button>
          )}

          {canDelete && (
            <button
              onClick={handleDeleteForMe}
              className="flex w-full items-center gap-4 rounded-lg px-4 py-3.5 text-left text-base text-muted-foreground active:bg-muted"
            >
              <svg
                className="h-5 w-5"
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
              Delete for me
            </button>
          )}

          {/* Cancel */}
          <button
            onClick={onClose}
            className="mt-2 flex w-full items-center justify-center rounded-lg bg-muted px-4 py-3.5 text-base font-medium text-foreground active:bg-muted/80"
          >
            Cancel
          </button>
        </div>

        {/* Safe area padding for iOS */}
        <div className="h-safe-bottom" />
      </div>
    </div>
  )

  return createPortal(sheetContent, document.body)
}
