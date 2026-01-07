import { cn } from '@/lib/utils'

interface SkeletonProps {
  className?: string
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-gray-200',
        className
      )}
    />
  )
}

export function ChatListSkeleton() {
  return (
    <div className="space-y-1">
      {[...Array(8)].map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-12 w-12 rounded-full flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-12" />
            </div>
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function MessagesSkeleton() {
  return (
    <div className="space-y-3 p-4">
      {/* Incoming message */}
      <div className="flex justify-start">
        <Skeleton className="h-16 w-48 rounded-lg" />
      </div>
      {/* Outgoing message */}
      <div className="flex justify-end">
        <Skeleton className="h-12 w-56 rounded-lg" />
      </div>
      {/* Incoming message */}
      <div className="flex justify-start">
        <Skeleton className="h-20 w-64 rounded-lg" />
      </div>
      {/* Outgoing message */}
      <div className="flex justify-end">
        <Skeleton className="h-10 w-40 rounded-lg" />
      </div>
      {/* Incoming message */}
      <div className="flex justify-start">
        <Skeleton className="h-14 w-52 rounded-lg" />
      </div>
    </div>
  )
}

export function ChatHeaderSkeleton() {
  return (
    <div className="flex h-16 items-center justify-between border-b border-gray-200 bg-gray-50 px-4">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div>
          <Skeleton className="h-4 w-32 mb-1" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <Skeleton className="h-8 w-8 rounded-full" />
    </div>
  )
}

export function ChannelCardSkeleton() {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="flex items-start gap-4">
        <Skeleton className="h-12 w-12 rounded-lg" />
        <div className="flex-1">
          <Skeleton className="h-5 w-40 mb-2" />
          <Skeleton className="h-4 w-32 mb-1" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-6 w-16 rounded-full" />
      </div>
    </div>
  )
}

export function TableRowSkeleton({ columns = 4 }: { columns?: number }) {
  return (
    <tr>
      {[...Array(columns)].map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton className="h-4 w-full max-w-[120px]" />
        </td>
      ))}
    </tr>
  )
}
