'use client'

import { createBrowserClient as createSupabaseBrowserClient } from '@supabase/ssr'

// Check if we have the required environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export function createClient() {
  // During build time, env vars might not be available
  // Return a placeholder that will be replaced at runtime
  if (!supabaseUrl || !supabaseAnonKey) {
    // Return a mock client that throws helpful errors when used
    // This prevents build-time crashes while still failing fast at runtime
    const throwNotConfigured = () => {
      throw new Error('Supabase client not configured. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables.')
    }
    return {
      auth: {
        getUser: throwNotConfigured,
        getSession: throwNotConfigured,
        signInWithPassword: throwNotConfigured,
        signUp: throwNotConfigured,
        signOut: throwNotConfigured,
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      from: () => ({
        select: () => ({ data: null, error: new Error('Supabase not configured') }),
        insert: () => ({ data: null, error: new Error('Supabase not configured') }),
        update: () => ({ data: null, error: new Error('Supabase not configured') }),
        delete: () => ({ data: null, error: new Error('Supabase not configured') }),
        eq: () => ({ data: null, error: new Error('Supabase not configured') }),
        single: () => ({ data: null, error: new Error('Supabase not configured') }),
      }),
      channel: () => ({
        on: () => ({ subscribe: () => ({}) }),
        subscribe: () => ({}),
      }),
      removeChannel: () => {},
      storage: {
        from: () => ({
          upload: () => ({ data: null, error: new Error('Supabase not configured') }),
          getPublicUrl: () => ({ data: { publicUrl: '' } }),
        }),
      },
    } as any
  }

  return createSupabaseBrowserClient(supabaseUrl, supabaseAnonKey)
}

// Alias for backwards compatibility
export const createBrowserClient = createClient
