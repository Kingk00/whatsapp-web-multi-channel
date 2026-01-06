'use client'

/**
 * React Query Provider
 *
 * Sets up TanStack Query for server state management with:
 * - Optimized default settings for real-time apps
 * - Devtools in development
 * - Cache invalidation patterns
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { useState, type ReactNode } from 'react'

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Don't refetch on window focus for chat apps (too aggressive)
            refetchOnWindowFocus: false,
            // Keep data fresh for 30 seconds
            staleTime: 30 * 1000,
            // Cache for 5 minutes
            gcTime: 5 * 60 * 1000,
            // Retry failed requests once
            retry: 1,
            // Don't retry on 4xx errors
            retryOnMount: false,
          },
          mutations: {
            // Retry mutations once on failure
            retry: 1,
          },
        },
      })
  )

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === 'development' && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  )
}

// ============================================================================
// Query Keys
// ============================================================================

/**
 * Centralized query key factory for consistent cache management
 */
export const queryKeys = {
  // Auth
  auth: {
    user: ['auth', 'user'] as const,
    profile: ['auth', 'profile'] as const,
  },

  // Channels
  channels: {
    all: ['channels'] as const,
    list: () => [...queryKeys.channels.all, 'list'] as const,
    detail: (id: string) => [...queryKeys.channels.all, 'detail', id] as const,
    health: (id: string) => [...queryKeys.channels.all, 'health', id] as const,
  },

  // Chats
  chats: {
    all: ['chats'] as const,
    list: (channelId?: string) =>
      channelId
        ? ([...queryKeys.chats.all, 'list', channelId] as const)
        : ([...queryKeys.chats.all, 'list'] as const),
    detail: (id: string) => [...queryKeys.chats.all, 'detail', id] as const,
    unified: () => [...queryKeys.chats.all, 'unified'] as const,
  },

  // Messages
  messages: {
    all: ['messages'] as const,
    list: (chatId: string) => [...queryKeys.messages.all, 'list', chatId] as const,
    infinite: (chatId: string) =>
      [...queryKeys.messages.all, 'infinite', chatId] as const,
  },

  // Quick replies
  quickReplies: {
    all: ['quick-replies'] as const,
    list: () => [...queryKeys.quickReplies.all, 'list'] as const,
    resolve: (shortcut: string, channelId?: string) =>
      [...queryKeys.quickReplies.all, 'resolve', shortcut, channelId] as const,
  },

  // Contacts
  contacts: {
    all: ['contacts'] as const,
    list: () => [...queryKeys.contacts.all, 'list'] as const,
    search: (query: string) => [...queryKeys.contacts.all, 'search', query] as const,
  },
}
