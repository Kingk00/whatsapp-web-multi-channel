import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Predefined color options for labels
export const LABEL_COLORS = [
  { name: 'Red', value: '#ef4444' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Pink', value: '#ec4899' },
  { name: 'Gray', value: '#6b7280' },
]

/**
 * GET /api/labels
 *
 * List all labels for the user's workspace.
 */
export async function GET() {
  try {
    const supabase = await createClient()

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('workspace_id')
      .eq('user_id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Fetch labels for workspace
    const { data: labels, error: labelsError } = await supabase
      .from('chat_labels')
      .select('id, name, color, created_at')
      .eq('workspace_id', profile.workspace_id)
      .order('name')

    if (labelsError) {
      console.error('Error fetching labels:', labelsError)
      return NextResponse.json({ error: 'Failed to fetch labels' }, { status: 500 })
    }

    return NextResponse.json({
      labels: labels || [],
      colors: LABEL_COLORS,
    })
  } catch (error) {
    console.error('Labels GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/labels
 *
 * Create a new label.
 *
 * Body:
 * - name: Label name (required)
 * - color: Hex color (optional, defaults to gray)
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('workspace_id')
      .eq('user_id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const body = await request.json()
    const { name, color } = body

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Label name is required' }, { status: 400 })
    }

    // Validate color if provided
    const finalColor = color && /^#[0-9a-fA-F]{6}$/.test(color)
      ? color
      : '#6b7280' // Default to gray

    // Check for duplicate name
    const { data: existing } = await supabase
      .from('chat_labels')
      .select('id')
      .eq('workspace_id', profile.workspace_id)
      .eq('name', name.trim())
      .single()

    if (existing) {
      return NextResponse.json(
        { error: 'A label with this name already exists' },
        { status: 409 }
      )
    }

    // Create label
    const { data: label, error: createError } = await supabase
      .from('chat_labels')
      .insert({
        workspace_id: profile.workspace_id,
        name: name.trim(),
        color: finalColor,
      })
      .select()
      .single()

    if (createError) {
      console.error('Error creating label:', createError)
      return NextResponse.json({ error: 'Failed to create label' }, { status: 500 })
    }

    return NextResponse.json({ label }, { status: 201 })
  } catch (error) {
    console.error('Labels POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
