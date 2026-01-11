import { cn } from '@/lib/utils'

type ChannelStatus = 'active' | 'needs_reauth' | 'sync_error' | 'degraded' | 'stopped' | 'disconnected'

interface ChannelStatusBadgeProps {
  status: ChannelStatus
  className?: string
  showLabel?: boolean
  size?: 'sm' | 'md' | 'lg'
}

const STATUS_CONFIG: Record<
  ChannelStatus,
  {
    label: string
    color: string
    bgColor: string
    dotColor: string
    description: string
  }
> = {
  active: {
    label: 'Active',
    color: 'text-green-700',
    bgColor: 'bg-green-100',
    dotColor: 'bg-green-500',
    description: 'Channel is connected and working normally',
  },
  needs_reauth: {
    label: 'Needs Reauth',
    color: 'text-yellow-700',
    bgColor: 'bg-yellow-100',
    dotColor: 'bg-yellow-500',
    description: 'WhatsApp session expired, please scan QR code again',
  },
  sync_error: {
    label: 'Sync Error',
    color: 'text-red-700',
    bgColor: 'bg-red-100',
    dotColor: 'bg-red-500',
    description: 'Error syncing with WhatsApp, check channel settings',
  },
  degraded: {
    label: 'Degraded',
    color: 'text-orange-700',
    bgColor: 'bg-orange-100',
    dotColor: 'bg-orange-500',
    description: 'Channel is experiencing issues, may be rate limited',
  },
  stopped: {
    label: 'Stopped',
    color: 'text-gray-700',
    bgColor: 'bg-gray-100',
    dotColor: 'bg-gray-500',
    description: 'Channel has been manually stopped',
  },
  disconnected: {
    label: 'Disconnected',
    color: 'text-red-700',
    bgColor: 'bg-red-100',
    dotColor: 'bg-red-500',
    description: 'Webhook is disconnected, channel is offline',
  },
}

const SIZE_CONFIG = {
  sm: {
    badge: 'px-2 py-0.5 text-xs',
    dot: 'h-1.5 w-1.5',
    gap: 'gap-1',
  },
  md: {
    badge: 'px-2.5 py-1 text-xs',
    dot: 'h-2 w-2',
    gap: 'gap-1.5',
  },
  lg: {
    badge: 'px-3 py-1.5 text-sm',
    dot: 'h-2.5 w-2.5',
    gap: 'gap-2',
  },
}

/**
 * Channel Status Badge Component
 * Displays visual indicator for channel connection status
 *
 * @param status - Current channel status
 * @param className - Additional CSS classes
 * @param showLabel - Whether to show status label text (default: true)
 * @param size - Badge size variant (default: 'md')
 */
export function ChannelStatusBadge({
  status,
  className,
  showLabel = true,
  size = 'md',
}: ChannelStatusBadgeProps) {
  const config = STATUS_CONFIG[status]
  const sizeConfig = SIZE_CONFIG[size]

  if (!config) {
    return null
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium',
        sizeConfig.badge,
        sizeConfig.gap,
        config.bgColor,
        config.color,
        className
      )}
      title={config.description}
    >
      <span
        className={cn(
          'rounded-full',
          sizeConfig.dot,
          config.dotColor
        )}
        aria-hidden="true"
      />
      {showLabel && config.label}
    </span>
  )
}

/**
 * Get status configuration for external use
 * Useful for building custom UI elements based on status
 */
export function getStatusConfig(status: ChannelStatus) {
  return STATUS_CONFIG[status]
}

/**
 * Get status badge color for inline styling
 * Returns Tailwind color classes for the status
 */
export function getStatusColor(status: ChannelStatus) {
  const config = STATUS_CONFIG[status]
  if (!config) return 'bg-gray-500'

  // Map bg colors to solid colors for simple use cases
  const colorMap: Record<string, string> = {
    'bg-green-100': 'bg-green-500',
    'bg-blue-100': 'bg-blue-500',
    'bg-yellow-100': 'bg-yellow-500',
    'bg-red-100': 'bg-red-500',
    'bg-orange-100': 'bg-orange-500',
    'bg-gray-100': 'bg-gray-500',
  }

  return colorMap[config.bgColor] || 'bg-gray-500'
}
