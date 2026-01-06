'use client'

import { cn } from '@/lib/utils'

/**
 * Base skeleton component with shimmer animation
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-gray-200',
        className
      )}
      {...props}
    />
  )
}

/**
 * Chat list item skeleton
 */
export function ChatListItemSkeleton() {
  return (
    <div className="flex items-center gap-3 p-3 border-b border-gray-100">
      {/* Avatar */}
      <Skeleton className="w-12 h-12 rounded-full flex-shrink-0" />

      <div className="flex-1 min-w-0">
        {/* Name and time row */}
        <div className="flex items-center justify-between mb-1">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-12" />
        </div>

        {/* Message preview row */}
        <div className="flex items-center justify-between">
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-5 w-5 rounded-full" />
        </div>
      </div>
    </div>
  )
}

/**
 * Chat list loading skeleton
 */
export function ChatListSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="divide-y divide-gray-100">
      {Array.from({ length: count }).map((_, i) => (
        <ChatListItemSkeleton key={i} />
      ))}
    </div>
  )
}

/**
 * Message bubble skeleton
 */
export function MessageSkeleton({ isOutbound = false }: { isOutbound?: boolean }) {
  return (
    <div className={cn('flex mb-2', isOutbound ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[70%] rounded-lg p-3',
          isOutbound ? 'bg-green-100' : 'bg-white border border-gray-200'
        )}
      >
        <Skeleton className="h-4 w-48 mb-2" />
        <Skeleton className="h-4 w-32" />
        <div className="flex justify-end mt-1">
          <Skeleton className="h-3 w-10" />
        </div>
      </div>
    </div>
  )
}

/**
 * Chat view loading skeleton
 */
export function ChatViewSkeleton() {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-gray-200 bg-gray-50">
        <Skeleton className="w-10 h-10 rounded-full" />
        <div>
          <Skeleton className="h-4 w-32 mb-1" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 p-4 space-y-4 overflow-hidden">
        {/* Date separator */}
        <div className="flex justify-center">
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>

        {/* Messages */}
        <MessageSkeleton isOutbound={false} />
        <MessageSkeleton isOutbound={true} />
        <MessageSkeleton isOutbound={false} />
        <MessageSkeleton isOutbound={true} />
        <MessageSkeleton isOutbound={false} />
      </div>

      {/* Composer */}
      <div className="p-4 border-t border-gray-200 bg-gray-50">
        <div className="flex items-center gap-2">
          <Skeleton className="w-10 h-10 rounded-full" />
          <Skeleton className="flex-1 h-10 rounded-full" />
          <Skeleton className="w-10 h-10 rounded-full" />
        </div>
      </div>
    </div>
  )
}

/**
 * Channel selector skeleton
 */
export function ChannelSelectorSkeleton() {
  return (
    <div className="p-3 border-b border-gray-200">
      <Skeleton className="h-10 w-full rounded-md" />
    </div>
  )
}

/**
 * Full page loading skeleton
 */
export function InboxPageSkeleton() {
  return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar */}
      <div className="w-[400px] bg-white border-r border-gray-200 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <Skeleton className="h-8 w-32" />
            <div className="flex gap-2">
              <Skeleton className="w-8 h-8 rounded-full" />
              <Skeleton className="w-8 h-8 rounded-full" />
            </div>
          </div>
        </div>

        {/* Channel selector */}
        <ChannelSelectorSkeleton />

        {/* Search */}
        <div className="p-3">
          <Skeleton className="h-10 w-full rounded-md" />
        </div>

        {/* Chat list */}
        <div className="flex-1 overflow-hidden">
          <ChatListSkeleton />
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Skeleton className="w-64 h-64 rounded-full mx-auto mb-4" />
          <Skeleton className="h-6 w-48 mx-auto mb-2" />
          <Skeleton className="h-4 w-64 mx-auto" />
        </div>
      </div>
    </div>
  )
}

/**
 * Contact details panel skeleton
 */
export function ContactDetailsSkeleton() {
  return (
    <div className="w-[300px] bg-white border-l border-gray-200 p-4">
      {/* Avatar */}
      <div className="flex flex-col items-center mb-6">
        <Skeleton className="w-24 h-24 rounded-full mb-3" />
        <Skeleton className="h-5 w-32 mb-1" />
        <Skeleton className="h-4 w-24" />
      </div>

      {/* Info sections */}
      <div className="space-y-4">
        <div>
          <Skeleton className="h-4 w-16 mb-2" />
          <Skeleton className="h-5 w-full" />
        </div>
        <div>
          <Skeleton className="h-4 w-16 mb-2" />
          <Skeleton className="h-5 w-full" />
        </div>
        <div>
          <Skeleton className="h-4 w-16 mb-2" />
          <Skeleton className="h-5 w-3/4" />
        </div>
      </div>

      {/* Actions */}
      <div className="mt-6 space-y-2">
        <Skeleton className="h-10 w-full rounded-md" />
        <Skeleton className="h-10 w-full rounded-md" />
      </div>
    </div>
  )
}
