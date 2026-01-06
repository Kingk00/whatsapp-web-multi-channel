/**
 * Date Utilities
 *
 * Helper functions for date formatting and manipulation.
 */

/**
 * Format a date as relative time (e.g., "5 min ago", "Yesterday", "Jan 5")
 */
export function formatDistanceToNow(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)

  if (diffSec < 60) {
    return 'Just now'
  }

  if (diffMin < 60) {
    return `${diffMin} min`
  }

  if (diffHour < 24) {
    return `${diffHour}h`
  }

  if (diffDay === 1) {
    return 'Yesterday'
  }

  if (diffDay < 7) {
    return `${diffDay}d`
  }

  // Format as date
  return formatDate(date)
}

/**
 * Format a date as a short date string (e.g., "Jan 5" or "Jan 5, 2024")
 */
export function formatDate(date: Date): string {
  const now = new Date()
  const sameYear = date.getFullYear() === now.getFullYear()

  const options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }

  return date.toLocaleDateString('en-US', options)
}

/**
 * Format a date as a time string (e.g., "2:30 PM")
 */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

/**
 * Format a date for message timestamps
 * Shows time for today, "Yesterday" for yesterday, date otherwise
 */
export function formatMessageTime(date: Date): string {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
  const messageDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  )

  if (messageDate.getTime() === today.getTime()) {
    return formatTime(date)
  }

  if (messageDate.getTime() === yesterday.getTime()) {
    return `Yesterday ${formatTime(date)}`
  }

  return `${formatDate(date)} ${formatTime(date)}`
}

/**
 * Format a date for message group headers (e.g., "Today", "Yesterday", "January 5, 2024")
 */
export function formatMessageDateHeader(date: Date): string {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
  const messageDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  )

  if (messageDate.getTime() === today.getTime()) {
    return 'Today'
  }

  if (messageDate.getTime() === yesterday.getTime()) {
    return 'Yesterday'
  }

  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Check if two dates are on the same day
 */
export function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  )
}
