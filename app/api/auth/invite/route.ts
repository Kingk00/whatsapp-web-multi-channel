import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { validateInviteToken, markInviteUsed } from '@/lib/auth-helpers'

export async function POST(request: NextRequest) {
  try {
    const { token, email, password, fullName } = await request.json()

    // Validate required fields
    if (!token || !email || !password || !fullName) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Validate invite token
    const invite = await validateInviteToken(token)
    if (!invite) {
      return NextResponse.json(
        { error: 'Invalid or expired invite token' },
        { status: 400 }
      )
    }

    // Verify email matches invite
    if (invite.email.toLowerCase() !== email.toLowerCase()) {
      return NextResponse.json(
        { error: 'Email does not match invite' },
        { status: 400 }
      )
    }

    // Create user with service role client
    const supabase = createServiceRoleClient()

    const { data: authData, error: signUpError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm email for invited users
      user_metadata: {
        full_name: fullName,
      },
    })

    if (signUpError) {
      return NextResponse.json(
        { error: signUpError.message },
        { status: 400 }
      )
    }

    if (!authData.user) {
      return NextResponse.json(
        { error: 'Failed to create user' },
        { status: 500 }
      )
    }

    // Create profile for the user
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        user_id: authData.user.id,
        email: email,
        full_name: fullName,
        role: invite.role,
        workspace_id: invite.workspace_id,
      })

    if (profileError) {
      // Rollback: delete the user if profile creation fails
      await supabase.auth.admin.deleteUser(authData.user.id)
      return NextResponse.json(
        { error: 'Failed to create user profile' },
        { status: 500 }
      )
    }

    // Mark invite as used
    await markInviteUsed(token, authData.user.id)

    return NextResponse.json({
      success: true,
      message: 'Account created successfully',
    })
  } catch (error) {
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
