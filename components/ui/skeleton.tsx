import { cn } from '@/lib/utils'

interface SkeletonProps {
  className?: string
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-md bg-muted',
        'before:absolute before:inset-0 before:-translate-x-full',
        'before:animate-[shimmer_1.5s_infinite]',
        'before:bg-gradient-to-r before:from-transparent before:via-white/20 before:to-transparent',
        className
      )}
    />
  )
}

export function ChatListSkeleton() {
  return (
    <div className="space-y-0.5">
      {[...Array(8)].map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 px-4 py-3 min-h-[72px]"
          style={{ animationDelay: `${i * 100}ms` }}
        >
          <Skeleton className="h-12 w-12 rounded-full flex-shrink-0" />
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-10" />
            </div>
            <Skeleton className="h-3.5 w-48" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function MessagesSkeleton() {
  return (
    <div className="space-y-4 p-4">
      {/* Incoming message */}
      <div className="flex justify-start">
        <Skeleton className="h-14 w-52 rounded-2xl rounded-tl-sm" />
      </div>
      {/* Outgoing message */}
      <div className="flex justify-end">
        <Skeleton className="h-10 w-40 rounded-2xl rounded-tr-sm" />
      </div>
      {/* Incoming message */}
      <div className="flex justify-start">
        <Skeleton className="h-20 w-64 rounded-2xl rounded-tl-sm" />
      </div>
      {/* Outgoing message */}
      <div className="flex justify-end">
        <Skeleton className="h-12 w-48 rounded-2xl rounded-tr-sm" />
      </div>
      {/* Incoming message */}
      <div className="flex justify-start">
        <Skeleton className="h-16 w-56 rounded-2xl rounded-tl-sm" />
      </div>
    </div>
  )
}

export function ChatHeaderSkeleton() {
  return (
    <div className="flex h-16 items-center justify-between border-b border-border bg-card px-4">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-8 rounded-full" />
        <Skeleton className="h-8 w-8 rounded-full" />
      </div>
    </div>
  )
}

export function ChannelCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <Skeleton className="h-12 w-12 rounded-xl flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-32" />
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

export function ComposerSkeleton() {
  return (
    <div className="flex items-center gap-3 border-t border-border bg-card p-4">
      <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
      <Skeleton className="h-11 flex-1 rounded-full" />
      <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
    </div>
  )
}
