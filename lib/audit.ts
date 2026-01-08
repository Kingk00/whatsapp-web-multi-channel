import { createServiceRoleClient } from '@/lib/supabase/server'
import { getCurrentUser, getUserProfile } from '@/lib/auth-helpers'

export type AuditAction =
  | 'user.created'
  | 'user.updated'
  | 'user.deleted'
  | 'user.profile_updated'
  | 'user.password_reset'
  | 'user.groups_changed'
  | 'user.role_changed'
  | 'user.login_success'
  | 'user.login_failed'
  | 'user.logout'
  | 'channel.created'
  | 'channel.updated'
  | 'channel.deleted'
  | 'group.created'
  | 'group.updated'
  | 'group.deleted'
  | 'group.members_changed'
  | 'message.sent'
  | 'message.deleted'
  | 'contact.created'
  | 'contact.updated'
  | 'contact.deleted'
  | 'workspace.settings_updated'

export type ResourceType =
  | 'user'
  | 'channel'
  | 'group'
  | 'message'
  | 'contact'
  | 'workspace'
  | 'conversation'

interface AuditLogOptions {
  action: AuditAction
  resourceType: ResourceType
  resourceId?: string
  metadata?: Record<string, unknown>
  userId?: string
  workspaceId?: string
}

/**
 * Extract client IP address from request headers
 */
function getClientIp(request: Request): string | null {
  // Check various headers for the client IP
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) {
    // x-forwarded-for can contain multiple IPs, take the first (original client)
    return forwardedFor.split(',')[0].trim()
  }

  // Cloudflare
  const cfConnectingIp = request.headers.get('cf-connecting-ip')
  if (cfConnectingIp) {
    return cfConnectingIp
  }

  // Vercel
  const xRealIp = request.headers.get('x-real-ip')
  if (xRealIp) {
    return xRealIp
  }

  return null
}

/**
 * Log an audit event to the database
 *
 * @param request - The incoming HTTP request (used to extract IP and user agent)
 * @param options - Audit log options
 */
export async function logAuditEvent(
  request: Request,
  options: AuditLogOptions
): Promise<void> {
  try {
    const supabase = createServiceRoleClient()

    // Get user info if not provided
    let userId = options.userId
    let workspaceId = options.workspaceId

    if (!userId || !workspaceId) {
      const user = await getCurrentUser()
      if (user && !userId) {
        userId = user.id
      }
      if (!workspaceId) {
        const profile = await getUserProfile(userId)
        workspaceId = profile?.workspace_id
      }
    }

    if (!workspaceId) {
      console.error('Cannot log audit event: workspace_id is required')
      return
    }

    const ipAddress = getClientIp(request)
    const userAgent = request.headers.get('user-agent')

    await supabase.from('audit_logs').insert({
      workspace_id: workspaceId,
      user_id: userId || null,
      action: options.action,
      resource_type: options.resourceType,
      resource_id: options.resourceId || null,
      metadata: options.metadata || null,
      ip_address: ipAddress,
      user_agent: userAgent,
    })
  } catch (error) {
    // Don't throw - audit logging should not break the main operation
    console.error('Failed to log audit event:', error)
  }
}

/**
 * Log a login activity event
 * Used for tracking login success/failure, logout, password changes
 */
export async function logLoginActivity(
  request: Request,
  options: {
    userId: string
    workspaceId: string
    eventType: 'login_success' | 'login_failed' | 'logout' | 'password_changed' | 'password_reset'
    metadata?: Record<string, unknown>
  }
): Promise<void> {
  try {
    const supabase = createServiceRoleClient()

    const ipAddress = getClientIp(request)
    const userAgent = request.headers.get('user-agent')

    await supabase.from('user_login_activity').insert({
      user_id: options.userId,
      workspace_id: options.workspaceId,
      event_type: options.eventType,
      ip_address: ipAddress,
      user_agent: userAgent,
      metadata: options.metadata || {},
    })
  } catch (error) {
    console.error('Failed to log login activity:', error)
  }
}

/**
 * Get recent login activity for a user
 */
export async function getLoginActivity(
  userId: string,
  limit: number = 20
): Promise<Array<{
  id: string
  event_type: string
  ip_address: string | null
  user_agent: string | null
  created_at: string
  metadata: Record<string, unknown>
}>> {
  const supabase = createServiceRoleClient()

  const { data, error } = await supabase
    .from('user_login_activity')
    .select('id, event_type, ip_address, user_agent, created_at, metadata')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('Failed to get login activity:', error)
    return []
  }

  return data || []
}

/**
 * Get recent audit logs for a resource
 */
export async function getAuditLogs(options: {
  workspaceId: string
  resourceType?: ResourceType
  resourceId?: string
  userId?: string
  limit?: number
}): Promise<Array<{
  id: string
  user_id: string | null
  action: string
  resource_type: string
  resource_id: string | null
  metadata: Record<string, unknown> | null
  ip_address: string | null
  user_agent: string | null
  created_at: string
}>> {
  const supabase = createServiceRoleClient()

  let query = supabase
    .from('audit_logs')
    .select('*')
    .eq('workspace_id', options.workspaceId)
    .order('created_at', { ascending: false })
    .limit(options.limit || 50)

  if (options.resourceType) {
    query = query.eq('resource_type', options.resourceType)
  }
  if (options.resourceId) {
    query = query.eq('resource_id', options.resourceId)
  }
  if (options.userId) {
    query = query.eq('user_id', options.userId)
  }

  const { data, error } = await query

  if (error) {
    console.error('Failed to get audit logs:', error)
    return []
  }

  return data || []
}
