'use client'

/**
 * Connection Banner
 *
 * Shows connection status banner when:
 * - Disconnected from realtime
 * - Reconnecting
 * - Just reconnected (auto-dismiss)
 *
 * Integrates with both browser online/offline status
 * and Supabase realtime connection status.
 */

import { useEffect, useState, useCallback } from 'react'
import { useUIStore } from '@/store/ui-store'
import { useConnectionStatus, ConnectionStatus } from '@/hooks/use-realtime'
import { cn } from '@/lib/utils'

export function ConnectionBanner() {
  const { isOnline, isReconnecting, setOnline, setReconnecting } = useUIStore()
  const [showConnected, setShowConnected] = useState(false)

  // Handle realtime connection status changes
  const handleStatusChange = useCallback(
    (status: ConnectionStatus) => {
      switch (status) {
        case 'connected':
          setOnline(true)
          setReconnecting(false)
          setShowConnected(true)
          setTimeout(() => setShowConnected(false), 3000)
          break
        case 'disconnected':
          setOnline(false)
          setReconnecting(false)
          break
        case 'reconnecting':
          setReconnecting(true)
          break
        case 'connecting':
          // Initial state, no UI change
          break
      }
    },
    [setOnline, setReconnecting]
  )

  // Use connection status hook for realtime monitoring
  const { status, reconnectAttempts, reconnect } = useConnectionStatus({
    onStatusChange: handleStatusChange,
  })

  // Also monitor browser online/offline status
  useEffect(() => {
    const handleOnline = () => {
      if (status === 'disconnected') {
        reconnect()
      }
    }

    const handleOffline = () => {
      setOnline(false)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // Set initial state based on browser
    if (!navigator.onLine) {
      setOnline(false)
    }

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [setOnline, status, reconnect])

  // Don't show anything if everything is fine
  if (isOnline && !isReconnecting && !showConnected) {
    return null
  }

  return (
    <div
      className={cn(
        'flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium transition-all',
        !isOnline && 'bg-red-500 text-white',
        isReconnecting && 'bg-yellow-500 text-yellow-900',
        showConnected && isOnline && !isReconnecting && 'bg-green-500 text-white'
      )}
    >
      {!isOnline && (
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
              d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414"
            />
          </svg>
          <span>No internet connection</span>
        </>
      )}

      {isReconnecting && isOnline && (
        <>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4 animate-spin"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          <span>
            Reconnecting{reconnectAttempts > 1 ? ` (attempt ${reconnectAttempts})` : ''}...
          </span>
        </>
      )}

      {showConnected && isOnline && !isReconnecting && (
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
              d="M5 13l4 4L19 7"
            />
          </svg>
          <span>Connected</span>
        </>
      )}
    </div>
  )
}
