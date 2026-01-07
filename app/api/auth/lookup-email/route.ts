import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'

/**
 * POST /api/auth/lookup-email
 * Look up a user's email by username for login
 * This is public but only returns email if username exists
 */
export async function POST(request: NextRequest) {
  try {
    const { username } = await request.json()

    if (!username) {
      return NextResponse.json(
        { error: 'Username is required' },
        { status: 400 }
      )
    }

    const supabase = createServiceRoleClient()

    // Look up user_id from profiles table
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('username', username.toLowerCase())
      .single()

    if (profileError || !profile) {
      // Don't reveal if username exists or not
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      )
    }

    // Get email from auth.users using admin API
    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(
      profile.user_id
    )

    if (userError || !userData.user) {
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      )
    }

    return NextResponse.json({ email: userData.user.email })
  } catch (error) {
    console.error('Lookup email error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
