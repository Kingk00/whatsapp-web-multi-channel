'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

interface BottomSheetProps {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  title?: string
  className?: string
}

export function BottomSheet({
  open,
  onClose,
  children,
  title,
  className,
}: BottomSheetProps) {
  const sheetRef = React.useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = React.useState(false)
  const [translateY, setTranslateY] = React.useState(0)
  const startYRef = React.useRef(0)

  // Handle escape key
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        onClose()
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [open, onClose])

  // Lock body scroll when open
  React.useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  // Touch handlers for swipe-to-close
  const handleTouchStart = React.useCallback((e: React.TouchEvent) => {
    startYRef.current = e.touches[0].clientY
    setIsDragging(true)
  }, [])

  const handleTouchMove = React.useCallback((e: React.TouchEvent) => {
    if (!isDragging) return
    const diff = e.touches[0].clientY - startYRef.current
    // Only allow dragging down
    if (diff > 0) {
      setTranslateY(diff)
    }
  }, [isDragging])

  const handleTouchEnd = React.useCallback(() => {
    setIsDragging(false)
    // Close if dragged more than 100px
    if (translateY > 100) {
      onClose()
    }
    setTranslateY(0)
  }, [translateY, onClose])

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-50 bg-black/50 backdrop-blur-sm',
          'animate-in fade-in duration-200'
        )}
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        className={cn(
          'fixed bottom-0 left-0 right-0 z-50',
          'bg-background rounded-t-2xl shadow-xl',
          'max-h-[90vh] overflow-hidden',
          !isDragging && 'animate-in slide-in-from-bottom duration-300',
          className
        )}
        style={{
          transform: `translateY(${translateY}px)`,
          transition: isDragging ? 'none' : 'transform 200ms ease-out',
        }}
      >
        {/* Drag handle */}
        <div
          className="flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        {/* Title */}
        {title && (
          <div className="px-4 pb-2 border-b border-border">
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          </div>
        )}

        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(90vh-60px)] pb-safe">
          {children}
        </div>
      </div>
    </>
  )
}

// Action sheet variant for list of actions
interface ActionSheetProps {
  open: boolean
  onClose: () => void
  actions: Array<{
    label: string
    icon?: React.ReactNode
    onClick: () => void
    variant?: 'default' | 'destructive'
  }>
  title?: string
  cancelLabel?: string
}

export function ActionSheet({
  open,
  onClose,
  actions,
  title,
  cancelLabel = 'Cancel',
}: ActionSheetProps) {
  const handleAction = (action: () => void) => {
    action()
    onClose()
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      <div className="p-2">
        {actions.map((action, index) => (
          <button
            key={index}
            onClick={() => handleAction(action.onClick)}
            className={cn(
              'w-full flex items-center gap-3 px-4 py-3 rounded-xl',
              'text-left transition-colors tap-transparent touch-target',
              'hover:bg-muted active:bg-muted/80',
              action.variant === 'destructive' && 'text-destructive'
            )}
          >
            {action.icon && (
              <span className="flex-shrink-0 text-muted-foreground">
                {action.icon}
              </span>
            )}
            <span className="font-medium">{action.label}</span>
          </button>
        ))}

        {/* Cancel button */}
        <button
          onClick={onClose}
          className={cn(
            'w-full mt-2 px-4 py-3 rounded-xl',
            'text-center font-medium text-muted-foreground',
            'bg-muted hover:bg-muted/80 active:bg-muted/60',
            'transition-colors tap-transparent touch-target'
          )}
        >
          {cancelLabel}
        </button>
      </div>
    </BottomSheet>
  )
}
