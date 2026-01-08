'use client'

import { cn } from '@/lib/utils'

interface BadgeProps {
  children?: React.ReactNode
  count?: number
  variant?: 'default' | 'primary' | 'secondary' | 'destructive' | 'muted'
  size?: 'sm' | 'md' | 'lg'
  dot?: boolean
  pulse?: boolean
  className?: string
}

const variantClasses = {
  default: 'bg-foreground text-background',
  primary: 'bg-whatsapp-500 text-white',
  secondary: 'bg-secondary text-secondary-foreground',
  destructive: 'bg-destructive text-destructive-foreground',
  muted: 'bg-muted text-muted-foreground',
}

const sizeClasses = {
  sm: 'text-[10px] min-w-[16px] h-4 px-1',
  md: 'text-xs min-w-[20px] h-5 px-1.5',
  lg: 'text-sm min-w-[24px] h-6 px-2',
}

export function Badge({
  children,
  count,
  variant = 'primary',
  size = 'md',
  dot = false,
  pulse = false,
  className,
}: BadgeProps) {
  // If dot mode, show a simple dot
  if (dot) {
    return (
      <span
        className={cn(
          'inline-flex rounded-full',
          pulse && 'animate-pulse-soft',
          variant === 'primary' && 'bg-whatsapp-500',
          variant === 'destructive' && 'bg-destructive',
          variant === 'default' && 'bg-foreground',
          size === 'sm' && 'w-2 h-2',
          size === 'md' && 'w-2.5 h-2.5',
          size === 'lg' && 'w-3 h-3',
          className
        )}
      />
    )
  }

  // Display count or children
  const content = count !== undefined ? (count > 99 ? '99+' : count) : children

  // Don't render if no content or count is 0
  if (count === 0 || (!content && count === undefined)) {
    return null
  }

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full font-medium',
        variantClasses[variant],
        sizeClasses[size],
        pulse && 'animate-pulse-soft',
        className
      )}
    >
      {content}
    </span>
  )
}

// Status badge for showing channel/user status
interface StatusBadgeProps {
  status: 'online' | 'offline' | 'busy' | 'away' | 'typing' | 'recording'
  showLabel?: boolean
  size?: 'sm' | 'md'
  className?: string
}

const statusConfig = {
  online: { color: 'bg-status-online', label: 'Online' },
  offline: { color: 'bg-muted-foreground/50', label: 'Offline' },
  busy: { color: 'bg-destructive', label: 'Busy' },
  away: { color: 'bg-yellow-500', label: 'Away' },
  typing: { color: 'bg-status-typing', label: 'Typing...' },
  recording: { color: 'bg-status-recording', label: 'Recording...' },
}

export function StatusBadge({
  status,
  showLabel = false,
  size = 'md',
  className,
}: StatusBadgeProps) {
  const config = statusConfig[status]

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span
        className={cn(
          'rounded-full',
          config.color,
          size === 'sm' && 'w-2 h-2',
          size === 'md' && 'w-2.5 h-2.5',
          (status === 'typing' || status === 'online') && 'animate-pulse-soft'
        )}
      />
      {showLabel && (
        <span
          className={cn(
            'text-muted-foreground',
            size === 'sm' && 'text-xs',
            size === 'md' && 'text-sm',
            status === 'typing' && 'text-status-typing',
            status === 'recording' && 'text-status-recording'
          )}
        >
          {config.label}
        </span>
      )}
    </span>
  )
}

// Channel badge for showing which channel a message is from
interface ChannelBadgeProps {
  name: string
  color?: string | null
  size?: 'sm' | 'md'
  className?: string
}

export function ChannelBadge({ name, color, size = 'sm', className }: ChannelBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-medium',
        size === 'sm' && 'text-[10px] px-1.5 py-0.5',
        size === 'md' && 'text-xs px-2 py-0.5',
        className
      )}
      style={{
        backgroundColor: color ? `${color}20` : undefined,
        color: color || undefined,
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: color || 'currentColor' }}
      />
      {name}
    </span>
  )
}
