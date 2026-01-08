import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { logAuditEvent, logLoginActivity } from '@/lib/audit'

/**
 * Generate a secure random password
 */
function generateSecurePassword(length: number = 16): string {
  const lowercase = 'abcdefghijklmnopqrstuvwxyz'
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const numbers = '0123456789'
  const symbols = '!@#$%^&*'
  const allChars = lowercase + uppercase + numbers + symbols

  // Ensure at least one of each type
  let password = ''
  password += lowercase[Math.floor(Math.random() * lowercase.length)]
  password += uppercase[Math.floor(Math.random() * uppercase.length)]
  password += numbers[Math.floor(Math.random() * numbers.length)]
  password += symbols[Math.floor(Math.random() * symbols.length)]

  // Fill the rest randomly
  for (let i = password.length; i < length; i++) {
    password += allChars[Math.floor(Math.random() * allChars.length)]
  }

  // Shuffle the password
  return password
    .split('')
    .sort(() => Math.random() - 0.5)
    .join('')
}

/**
 * POST /api/team/users/[userId]/reset-password
 *
 * Reset a user's password (main_admin only).
 * Supports two modes:
 * - auto_generate: true - Generate a random password
 * - password: string - Set a specific password (min 8 chars)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId: targetUserId } = await params
    const body = await request.json()
    const { auto_generate, password } = body

    const supabase = await createClient()
    const serviceSupabase = createServiceRoleClient()

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get admin's profile
    const { data: adminProfile } = await supabase
      .from('profiles')
      .select('workspace_id, role')
      .eq('user_id', user.id)
      .single()

    if (!adminProfile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Only main_admin can reset passwords
    if (adminProfile.role !== 'main_admin') {
      return NextResponse.json(
        { error: 'Only main admin can reset passwords' },
        { status: 403 }
      )
    }

    // Cannot reset your own password via this endpoint
    if (user.id === targetUserId) {
      return NextResponse.json(
        { error: 'Use change-password to change your own password' },
        { status: 400 }
      )
    }

    // Get target user's profile
    const { data: targetProfile } = await supabase
      .from('profiles')
      .select('workspace_id, role, display_name')
      .eq('user_id', targetUserId)
      .single()

    if (!targetProfile) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify same workspace
    if (targetProfile.workspace_id !== adminProfile.workspace_id) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Determine the new password
    let newPassword: string
    if (auto_generate) {
      newPassword = generateSecurePassword(16)
    } else if (password) {
      if (typeof password !== 'string' || password.length < 8) {
        return NextResponse.json(
          { error: 'Password must be at least 8 characters' },
          { status: 400 }
        )
      }
      newPassword = password
    } else {
      return NextResponse.json(
        { error: 'Provide either auto_generate: true or password' },
        { status: 400 }
      )
    }

    // Update the user's password using admin API
    const { error: updateError } = await serviceSupabase.auth.admin.updateUserById(
      targetUserId,
      { password: newPassword }
    )

    if (updateError) {
      console.error('Error resetting password:', updateError)
      return NextResponse.json(
        { error: 'Failed to reset password' },
        { status: 500 }
      )
    }

    // Log audit event
    await logAuditEvent(request, {
      action: 'user.password_reset',
      resourceType: 'user',
      resourceId: targetUserId,
      metadata: {
        reset_by: user.id,
        auto_generated: !!auto_generate,
      },
      workspaceId: adminProfile.workspace_id,
    })

    // Log login activity for the target user
    await logLoginActivity(request, {
      userId: targetUserId,
      workspaceId: adminProfile.workspace_id,
      eventType: 'password_reset',
      metadata: {
        reset_by: user.id,
      },
    })

    // Return the password (only shown once)
    return NextResponse.json({
      success: true,
      password: newPassword,
      message: 'Password reset successfully. Share this password securely with the user.',
    })
  } catch (error) {
    console.error('Reset password error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
