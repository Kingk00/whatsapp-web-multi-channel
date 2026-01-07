import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { User } from '@supabase/supabase-js'

/**
 * Get the current authenticated user from the session
 * Use this in Server Components, Route Handlers, and Server Actions
 * @returns User object if authenticated, null otherwise
 */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

/**
 * Require authentication - throws error if user is not logged in
 * Use this at the start of API routes that require authentication
 * @returns User object
 * @throws Error if user is not authenticated
 */
export async function requireAuth(): Promise<User> {
  const user = await getCurrentUser()
  if (!user) {
    throw new Error('Unauthorized: Authentication required')
  }
  return user
}

/**
 * Get user's profile with role information
 * @param userId - User ID (defaults to current user)
 * @returns Profile with role and workspace info, null if not found
 */
export async function getUserProfile(userId?: string) {
  const supabase = await createClient()

  // If no userId provided, get current user
  const targetUserId = userId || (await getCurrentUser())?.id

  if (!targetUserId) {
    return null
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', targetUserId)
    .single()

  if (error) {
    console.error('Error fetching user profile:', error)
    return null
  }

  return profile
}

/**
 * Check if current user is a main admin
 * @returns true if user is main admin, false otherwise
 */
export async function isMainAdmin(): Promise<boolean> {
  const profile = await getUserProfile()
  return profile?.role === 'main_admin'
}

/**
 * Check if user can access a specific channel
 * This checks:
 * - If user is main_admin (can access all channels)
 * - If user has direct access via user_channels
 * - If user has access via group_channels
 * @param channelId - Channel UUID
 * @returns true if user can access channel, false otherwise
 */
export async function canAccessChannel(channelId: string): Promise<boolean> {
  const supabase = await createClient()
  const user = await getCurrentUser()

  if (!user) {
    return false
  }

  // Check via database function (uses RLS)
  const { data, error } = await supabase.rpc('user_can_access_channel', {
    channel_id: channelId,
  })

  if (error) {
    console.error('Error checking channel access:', error)
    return false
  }

  return data === true
}

/**
 * Get user's workspace ID
 * @returns Workspace UUID or null
 */
export async function getUserWorkspaceId(): Promise<string | null> {
  const profile = await getUserProfile()
  return profile?.workspace_id || null
}

/**
 * Validate API request authorization
 * Use this in API routes to ensure user is authenticated and has access
 * @param options - Optional configuration
 * @returns User and profile information
 * @throws Response with 401 if unauthorized
 */
export async function validateApiAuth(options?: {
  requireMainAdmin?: boolean
  channelId?: string
}) {
  const user = await getCurrentUser()

  if (!user) {
    throw new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const profile = await getUserProfile(user.id)

  if (!profile) {
    throw new Response(JSON.stringify({ error: 'Profile not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  // Check main admin requirement
  if (options?.requireMainAdmin && profile.role !== 'main_admin') {
    throw new Response(JSON.stringify({ error: 'Forbidden: Admin access required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  // Check channel access
  if (options?.channelId) {
    const hasAccess = await canAccessChannel(options.channelId)
    if (!hasAccess) {
      throw new Response(JSON.stringify({ error: 'Forbidden: No access to this channel' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      })
    }
  }

  return { user, profile }
}

/**
 * Create an invite token for new user registration
 * Only main admins can create invites
 * @param email - Email address to invite
 * @param role - Role to assign (default: 'agent')
 * @returns Invite token or null if failed
 */
export async function createInviteToken(
  email: string,
  role: 'main_admin' | 'admin' | 'agent' = 'agent'
): Promise<string | null> {
  // Verify current user is main admin
  const admin = await isMainAdmin()
  if (!admin) {
    throw new Error('Only main admins can create invites')
  }

  const supabase = createServiceRoleClient()
  const workspaceId = await getUserWorkspaceId()

  if (!workspaceId) {
    throw new Error('User workspace not found')
  }

  // Generate random token
  const token = crypto.randomUUID()
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 7) // 7 days expiry

  const { error } = await supabase.from('invite_tokens').insert({
    token,
    email,
    role,
    workspace_id: workspaceId,
    expires_at: expiresAt.toISOString(),
    created_by: (await getCurrentUser())?.id,
  })

  if (error) {
    console.error('Error creating invite token:', error)
    return null
  }

  return token
}

/**
 * Validate an invite token
 * @param token - Invite token
 * @returns Invite data if valid, null otherwise
 */
export async function validateInviteToken(token: string) {
  const supabase = createServiceRoleClient()

  const { data: invite, error } = await supabase
    .from('invite_tokens')
    .select('*')
    .eq('token', token)
    .eq('used', false)
    .gt('expires_at', new Date().toISOString())
    .single()

  if (error || !invite) {
    return null
  }

  return invite
}

/**
 * Mark an invite token as used
 * @param token - Invite token
 * @param userId - User ID who used the invite
 */
export async function markInviteUsed(token: string, userId: string) {
  const supabase = createServiceRoleClient()

  await supabase
    .from('invite_tokens')
    .update({
      used: true,
      used_by: userId,
      used_at: new Date().toISOString(),
    })
    .eq('token', token)
}
