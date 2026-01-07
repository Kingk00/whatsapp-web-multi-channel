'use client'

import { useEffect, useCallback, useRef } from 'react'

interface ShortcutConfig {
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  action: () => void
  description?: string
}

/**
 * Hook for handling keyboard shortcuts
 *
 * Shortcuts:
 * - Escape: Close details panel or clear selection
 * - Ctrl+K or /: Focus search
 * - Ctrl+Enter: Send message (when in composer)
 * - Up/Down: Navigate chat list (when search focused)
 */
export function useKeyboardShortcuts(shortcuts: ShortcutConfig[]) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore shortcuts when typing in input/textarea (except Escape)
      const target = event.target as HTMLElement
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'

      for (const shortcut of shortcuts) {
        const keyMatches = event.key.toLowerCase() === shortcut.key.toLowerCase()
        const ctrlMatches = shortcut.ctrl ? (event.ctrlKey || event.metaKey) : !event.ctrlKey && !event.metaKey
        const shiftMatches = shortcut.shift ? event.shiftKey : !event.shiftKey
        const altMatches = shortcut.alt ? event.altKey : !event.altKey

        // Allow Escape always, others only when not in input
        const allowedInInput = shortcut.key === 'Escape' || shortcut.ctrl

        if (keyMatches && ctrlMatches && shiftMatches && altMatches) {
          if (!isInput || allowedInInput) {
            event.preventDefault()
            shortcut.action()
            return
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [shortcuts])
}

/**
 * Pre-configured shortcuts for the inbox page
 */
export function useInboxShortcuts({
  onFocusSearch,
  onClosePanel,
  onNavigateUp,
  onNavigateDown,
  onOpenChat,
}: {
  onFocusSearch: () => void
  onClosePanel: () => void
  onNavigateUp: () => void
  onNavigateDown: () => void
  onOpenChat: () => void
}) {
  const shortcuts: ShortcutConfig[] = [
    {
      key: 'k',
      ctrl: true,
      action: onFocusSearch,
      description: 'Focus search',
    },
    {
      key: '/',
      action: onFocusSearch,
      description: 'Focus search',
    },
    {
      key: 'Escape',
      action: onClosePanel,
      description: 'Close panel / Clear selection',
    },
  ]

  useKeyboardShortcuts(shortcuts)
}
