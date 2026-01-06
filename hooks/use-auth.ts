'use client'

/**
 * Authentication Hook
 *
 * Provides authentication state and user profile information
 * with automatic refresh and caching via React Query.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { queryKeys } from '@/lib/query-client'

// ============================================================================
// Types
// ============================================================================

export interface UserProfile {
  user_id: string
  workspace_id: string
  role: 'main_admin' | 'admin' | 'agent' | 'viewer'
  display_name: string
  avatar_url: string | null
  notification_settings: {
    sound: boolean
    desktop: boolean
  }
  created_at: string
}

export interface AuthState {
  user: {
    id: string
    email: string
  } | null
  profile: UserProfile | null
  isLoading: boolean
  isAuthenticated: boolean
  isMainAdmin: boolean
  isAdmin: boolean
}

// ============================================================================
// Hook
// ============================================================================

export function useAuth(): AuthState & {
  signOut: () => Promise<void>
  refetch: () => void
} {
  const supabase = createClient()
  const router = useRouter()
  const queryClient = useQueryClient()

  // Fetch current user
  const {
    data: userData,
    isLoading: userLoading,
    refetch: refetchUser,
  } = useQuery({
    queryKey: queryKeys.auth.user,
    queryFn: async () => {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser()
      if (error) throw error
      return user
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    retry: false,
  })

  // Fetch user profile
  const {
    data: profile,
    isLoading: profileLoading,
    refetch: refetchProfile,
  } = useQuery({
    queryKey: queryKeys.auth.profile,
    queryFn: async () => {
      if (!userData) return null

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userData.id)
        .single()

      if (error) {
        // Profile might not exist yet for new users
        if (error.code === 'PGRST116') return null
        throw error
      }

      return data as UserProfile
    },
    enabled: !!userData,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  })

  // Listen for auth state changes
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        queryClient.invalidateQueries({ queryKey: queryKeys.auth.user })
        queryClient.invalidateQueries({ queryKey: queryKeys.auth.profile })
      } else if (event === 'SIGNED_OUT') {
        queryClient.clear()
        router.push('/login')
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [supabase, queryClient, router])

  // Sign out handler
  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    queryClient.clear()
    router.push('/login')
  }, [supabase, queryClient, router])

  // Refetch all auth data
  const refetch = useCallback(() => {
    refetchUser()
    refetchProfile()
  }, [refetchUser, refetchProfile])

  const isLoading = userLoading || profileLoading
  const isAuthenticated = !!userData && !!profile
  const isMainAdmin = profile?.role === 'main_admin'
  const isAdmin = profile?.role === 'main_admin' || profile?.role === 'admin'

  return {
    user: userData
      ? {
          id: userData.id,
          email: userData.email || '',
        }
      : null,
    profile: profile ?? null,
    isLoading,
    isAuthenticated,
    isMainAdmin,
    isAdmin,
    signOut,
    refetch,
  }
}

// ============================================================================
// Helper Hook: Require Authentication
// ============================================================================

/**
 * Hook that redirects to login if user is not authenticated.
 * Use this on protected pages.
 */
export function useRequireAuth() {
  const auth = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      router.push('/login')
    }
  }, [auth.isLoading, auth.isAuthenticated, router])

  return auth
}

// ============================================================================
// Helper Hook: Require Admin
// ============================================================================

/**
 * Hook that redirects if user is not an admin.
 * Use this on admin-only pages.
 */
export function useRequireAdmin() {
  const auth = useRequireAuth()
  const router = useRouter()

  useEffect(() => {
    if (!auth.isLoading && auth.isAuthenticated && !auth.isAdmin) {
      router.push('/inbox')
    }
  }, [auth.isLoading, auth.isAuthenticated, auth.isAdmin, router])

  return auth
}
