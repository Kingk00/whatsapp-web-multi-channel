'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

interface SwipeAction {
  icon: React.ReactNode
  label: string
  color: string
  onClick: () => void
}

interface SwipeActionsProps {
  children: React.ReactNode
  leftActions?: SwipeAction[]
  rightActions?: SwipeAction[]
  threshold?: number
  className?: string
}

export function SwipeActions({
  children,
  leftActions = [],
  rightActions = [],
  threshold = 80,
  className,
}: SwipeActionsProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [translateX, setTranslateX] = React.useState(0)
  const [isDragging, setIsDragging] = React.useState(false)
  const startXRef = React.useRef(0)
  const currentXRef = React.useRef(0)

  const hasLeftActions = leftActions.length > 0
  const hasRightActions = rightActions.length > 0

  const handleTouchStart = React.useCallback((e: React.TouchEvent) => {
    startXRef.current = e.touches[0].clientX
    currentXRef.current = translateX
    setIsDragging(true)
  }, [translateX])

  const handleTouchMove = React.useCallback((e: React.TouchEvent) => {
    if (!isDragging) return

    const diff = e.touches[0].clientX - startXRef.current
    let newTranslate = currentXRef.current + diff

    // Limit based on available actions
    const maxRight = hasLeftActions ? threshold * leftActions.length : 0
    const maxLeft = hasRightActions ? -threshold * rightActions.length : 0

    // Apply resistance at boundaries
    if (newTranslate > maxRight) {
      newTranslate = maxRight + (newTranslate - maxRight) * 0.2
    } else if (newTranslate < maxLeft) {
      newTranslate = maxLeft + (newTranslate - maxLeft) * 0.2
    }

    setTranslateX(newTranslate)
  }, [isDragging, hasLeftActions, hasRightActions, leftActions.length, rightActions.length, threshold])

  const handleTouchEnd = React.useCallback(() => {
    setIsDragging(false)

    const actionThreshold = threshold * 0.5

    // Snap to action position or back to center
    if (translateX > actionThreshold && hasLeftActions) {
      setTranslateX(threshold * leftActions.length)
    } else if (translateX < -actionThreshold && hasRightActions) {
      setTranslateX(-threshold * rightActions.length)
    } else {
      setTranslateX(0)
    }
  }, [translateX, hasLeftActions, hasRightActions, leftActions.length, rightActions.length, threshold])

  const handleActionClick = React.useCallback((action: SwipeAction) => {
    action.onClick()
    setTranslateX(0)
  }, [])

  // Reset on click outside
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setTranslateX(0)
      }
    }

    if (translateX !== 0) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [translateX])

  return (
    <div
      ref={containerRef}
      className={cn('relative overflow-hidden', className)}
    >
      {/* Left actions (revealed when swiping right) */}
      {hasLeftActions && (
        <div className="absolute inset-y-0 left-0 flex">
          {leftActions.map((action, index) => (
            <button
              key={index}
              onClick={() => handleActionClick(action)}
              className={cn(
                'flex items-center justify-center px-4 text-white transition-transform duration-fast',
                'min-w-[80px]'
              )}
              style={{
                backgroundColor: action.color,
                transform: `translateX(${Math.min(0, translateX - threshold * (leftActions.length - index))}px)`,
              }}
            >
              <div className="flex flex-col items-center gap-1">
                {action.icon}
                <span className="text-xs font-medium">{action.label}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Right actions (revealed when swiping left) */}
      {hasRightActions && (
        <div className="absolute inset-y-0 right-0 flex">
          {rightActions.map((action, index) => (
            <button
              key={index}
              onClick={() => handleActionClick(action)}
              className={cn(
                'flex items-center justify-center px-4 text-white transition-transform duration-fast',
                'min-w-[80px]'
              )}
              style={{
                backgroundColor: action.color,
                transform: `translateX(${Math.max(0, translateX + threshold * (index + 1))}px)`,
              }}
            >
              <div className="flex flex-col items-center gap-1">
                {action.icon}
                <span className="text-xs font-medium">{action.label}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Main content */}
      <div
        className={cn(
          'relative bg-background',
          isDragging ? '' : 'transition-transform duration-normal ease-out'
        )}
        style={{ transform: `translateX(${translateX}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </div>
    </div>
  )
}

// Common action icons
export function ArchiveIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('h-5 w-5', className)} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
    </svg>
  )
}

export function DeleteIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('h-5 w-5', className)} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  )
}

export function MuteIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('h-5 w-5', className)} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
    </svg>
  )
}

export function ReadIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('h-5 w-5', className)} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  )
}
