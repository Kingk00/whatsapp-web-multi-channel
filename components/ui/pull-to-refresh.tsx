'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

interface PullToRefreshProps {
  onRefresh: () => Promise<void>
  children: React.ReactNode
  threshold?: number
  className?: string
}

export function PullToRefresh({
  onRefresh,
  children,
  threshold = 80,
  className,
}: PullToRefreshProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [pullDistance, setPullDistance] = React.useState(0)
  const [isRefreshing, setIsRefreshing] = React.useState(false)
  const [isPulling, setIsPulling] = React.useState(false)
  const startYRef = React.useRef(0)
  const isAtTopRef = React.useRef(true)

  // Check if scrolled to top
  const checkIsAtTop = React.useCallback(() => {
    if (containerRef.current) {
      isAtTopRef.current = containerRef.current.scrollTop <= 0
    }
  }, [])

  const handleTouchStart = React.useCallback((e: React.TouchEvent) => {
    if (isRefreshing) return
    checkIsAtTop()
    if (isAtTopRef.current) {
      startYRef.current = e.touches[0].clientY
      setIsPulling(true)
    }
  }, [isRefreshing, checkIsAtTop])

  const handleTouchMove = React.useCallback((e: React.TouchEvent) => {
    if (!isPulling || isRefreshing) return
    if (!isAtTopRef.current) {
      setPullDistance(0)
      return
    }

    const currentY = e.touches[0].clientY
    const diff = currentY - startYRef.current

    // Only pull down, with resistance
    if (diff > 0) {
      // Apply resistance formula for natural feel
      const resistance = 0.4
      const distance = Math.min(diff * resistance, threshold * 1.5)
      setPullDistance(distance)
    }
  }, [isPulling, isRefreshing, threshold])

  const handleTouchEnd = React.useCallback(async () => {
    if (!isPulling) return
    setIsPulling(false)

    if (pullDistance >= threshold && !isRefreshing) {
      setIsRefreshing(true)
      setPullDistance(threshold) // Hold at threshold during refresh

      try {
        await onRefresh()
      } finally {
        setIsRefreshing(false)
        setPullDistance(0)
      }
    } else {
      setPullDistance(0)
    }
  }, [isPulling, pullDistance, threshold, isRefreshing, onRefresh])

  // Calculate progress (0-1) and rotation
  const progress = Math.min(pullDistance / threshold, 1)
  const rotation = progress * 360

  return (
    <div
      ref={containerRef}
      className={cn('relative overflow-y-auto', className)}
      onScroll={checkIsAtTop}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull indicator */}
      <div
        className={cn(
          'absolute left-1/2 -translate-x-1/2 z-10',
          'flex items-center justify-center',
          'transition-opacity duration-200',
          pullDistance > 0 || isRefreshing ? 'opacity-100' : 'opacity-0'
        )}
        style={{
          top: Math.max(pullDistance - 40, 8),
          transition: isPulling ? 'none' : 'all 200ms ease-out',
        }}
      >
        <div
          className={cn(
            'w-10 h-10 rounded-full bg-background shadow-lg',
            'flex items-center justify-center',
            'border border-border'
          )}
        >
          {isRefreshing ? (
            <RefreshSpinner />
          ) : (
            <svg
              className="w-5 h-5 text-whatsapp-500"
              style={{
                transform: `rotate(${rotation}deg)`,
                transition: isPulling ? 'none' : 'transform 200ms',
              }}
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
          )}
        </div>
      </div>

      {/* Content with pull offset */}
      <div
        style={{
          transform: `translateY(${pullDistance}px)`,
          transition: isPulling ? 'none' : 'transform 200ms ease-out',
        }}
      >
        {children}
      </div>
    </div>
  )
}

// Animated spinner
function RefreshSpinner() {
  return (
    <svg
      className="w-5 h-5 animate-spin text-whatsapp-500"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )
}
