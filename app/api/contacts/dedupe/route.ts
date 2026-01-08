import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { normalizePhoneNumber } from '@/lib/phone-utils'

export const maxDuration = 300 // 5 minutes for large contact lists

/**
 * GET /api/contacts/dedupe
 *
 * Preview duplicate contacts (dry run)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('workspace_id, role')
      .eq('user_id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    }

    if (!['main_admin', 'admin'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const serviceClient = createServiceRoleClient()

    // Find duplicates by phone number
    const duplicates = await findDuplicates(serviceClient, profile.workspace_id)

    return NextResponse.json({
      duplicate_groups: duplicates.length,
      total_duplicates: duplicates.reduce((sum, g) => sum + g.duplicates.length, 0),
      preview: duplicates, // Show all groups
    })
  } catch (error) {
    console.error('Dedupe preview error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/contacts/dedupe
 *
 * Remove duplicate contacts, keeping the oldest one
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('workspace_id, role')
      .eq('user_id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    }

    if (!['main_admin', 'admin'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const serviceClient = createServiceRoleClient()

    // Find all duplicates
    const duplicateGroups = await findDuplicates(serviceClient, profile.workspace_id)

    if (duplicateGroups.length === 0) {
      return NextResponse.json({
        success: true,
        removed: 0,
        message: 'No duplicates found',
      })
    }

    // Collect all duplicate IDs to remove (keep the original, remove the rest)
    const idsToRemove: string[] = []
    for (const group of duplicateGroups) {
      idsToRemove.push(...group.duplicates.map(d => d.id))
    }

    // Delete phone lookups first
    if (idsToRemove.length > 0) {
      // Delete in batches
      for (let i = 0; i < idsToRemove.length; i += 500) {
        const batch = idsToRemove.slice(i, i + 500)
        await serviceClient
          .from('contact_phone_lookup')
          .delete()
          .in('contact_id', batch)
      }

      // Delete contacts in batches
      for (let i = 0; i < idsToRemove.length; i += 500) {
        const batch = idsToRemove.slice(i, i + 500)
        await serviceClient
          .from('contacts')
          .delete()
          .in('id', batch)
          .eq('workspace_id', profile.workspace_id)
      }
    }

    return NextResponse.json({
      success: true,
      removed: idsToRemove.length,
      groups_processed: duplicateGroups.length,
    })
  } catch (error) {
    console.error('Dedupe error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

interface DuplicateGroup {
  phone: string
  original: { id: string; display_name: string; created_at: string }
  duplicates: { id: string; display_name: string; created_at: string }[]
}

async function findDuplicates(
  supabase: ReturnType<typeof createServiceRoleClient>,
  workspaceId: string
): Promise<DuplicateGroup[]> {
  // Get all contacts with their phone numbers
  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, display_name, phone_numbers, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true })

  if (!contacts || contacts.length === 0) {
    return []
  }

  // Group contacts by normalized phone number
  const phoneMap = new Map<string, typeof contacts>()

  for (const contact of contacts) {
    const phones = contact.phone_numbers as Array<{ number: string; normalized?: string }> | null
    if (!phones || phones.length === 0) continue

    for (const phone of phones) {
      // Use pre-normalized value if available, otherwise normalize using libphonenumber-js
      const normalized = phone.normalized || normalizePhoneNumber(phone.number)
      if (!normalized) continue

      const existing = phoneMap.get(normalized) || []
      existing.push(contact)
      phoneMap.set(normalized, existing)
    }
  }

  // Find groups with more than one contact
  const duplicateGroups: DuplicateGroup[] = []

  for (const [phone, group] of phoneMap.entries()) {
    if (group.length > 1) {
      // Sort by created_at to keep the oldest
      group.sort((a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )

      const [original, ...duplicates] = group

      // Only add if we haven't already processed this original
      const alreadyProcessed = duplicateGroups.some(
        dg => dg.original.id === original.id ||
              dg.duplicates.some(d => d.id === original.id)
      )

      if (!alreadyProcessed) {
        duplicateGroups.push({
          phone,
          original: {
            id: original.id,
            display_name: original.display_name,
            created_at: original.created_at,
          },
          duplicates: duplicates.map(d => ({
            id: d.id,
            display_name: d.display_name,
            created_at: d.created_at,
          })),
        })
      }
    }
  }

  return duplicateGroups
}
