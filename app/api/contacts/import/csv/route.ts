import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createHash } from 'crypto'
import { normalizePhoneNumber } from '@/lib/phone-utils'

/**
 * POST /api/contacts/import/csv
 *
 * Import contacts from CSV file. Admin only.
 *
 * Expected CSV columns (flexible matching):
 * - Name/name/display_name (required)
 * - Phone/phone/phone_number/mobile (optional)
 * - Email/email/email_address (optional)
 * - Tags/tags (optional, comma-separated)
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

    // Get user's workspace and verify admin
    const { data: membership } = await supabase
      .from('workspace_members')
      .select('workspace_id, role')
      .eq('user_id', user.id)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    }

    if (membership.role !== 'admin') {
      return NextResponse.json(
        { error: 'Only admins can import contacts' },
        { status: 403 }
      )
    }

    // Parse FormData
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'CSV file is required' }, { status: 400 })
    }

    if (!file.name.endsWith('.csv')) {
      return NextResponse.json({ error: 'File must be a CSV' }, { status: 400 })
    }

    // Read and parse CSV
    const csvText = await file.text()
    const rows = parseCSV(csvText)

    if (rows.length < 2) {
      return NextResponse.json(
        { error: 'CSV must have a header row and at least one data row' },
        { status: 400 }
      )
    }

    const headers = rows[0].map((h) => h.toLowerCase().trim())
    const dataRows = rows.slice(1)

    // Find column indices
    const nameCol = findColumnIndex(headers, ['name', 'display_name', 'full_name', 'contact_name'])
    const phoneCol = findColumnIndex(headers, ['phone', 'phone_number', 'mobile', 'telephone', 'cell'])
    const emailCol = findColumnIndex(headers, ['email', 'email_address', 'e-mail'])
    const tagsCol = findColumnIndex(headers, ['tags', 'tag', 'labels', 'categories'])

    if (nameCol === -1) {
      return NextResponse.json(
        { error: 'CSV must have a name column (name, display_name, full_name, or contact_name)' },
        { status: 400 }
      )
    }

    // Process contacts
    const results = {
      imported: 0,
      skipped: 0,
      errors: [] as string[],
    }

    const sourceMetadata = {
      filename: file.name,
      imported_at: new Date().toISOString(),
      imported_by: user.id,
    }

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i]
      const rowNum = i + 2 // 1-indexed + header row

      const name = row[nameCol]?.trim()
      if (!name) {
        results.skipped++
        continue
      }

      try {
        // Build phone numbers array
        const phoneNumbers = []
        if (phoneCol !== -1 && row[phoneCol]?.trim()) {
          const normalized = normalizePhoneNumber(row[phoneCol].trim())
          phoneNumbers.push({
            number: row[phoneCol].trim(),
            type: 'mobile',
            normalized,
          })
        }

        // Build email addresses array
        const emailAddresses = []
        if (emailCol !== -1 && row[emailCol]?.trim()) {
          emailAddresses.push({
            email: row[emailCol].trim(),
            type: 'personal',
          })
        }

        // Parse tags
        const tags = tagsCol !== -1 && row[tagsCol]?.trim()
          ? row[tagsCol].split(',').map((t) => t.trim()).filter(Boolean)
          : []

        // Insert contact
        const { data: contact, error: insertError } = await supabase
          .from('contacts')
          .insert({
            workspace_id: membership.workspace_id,
            display_name: name,
            phone_numbers: phoneNumbers,
            email_addresses: emailAddresses,
            tags,
            source: 'csv_import',
            source_metadata: sourceMetadata,
          })
          .select()
          .single()

        if (insertError) {
          results.errors.push(`Row ${rowNum}: ${insertError.message}`)
          continue
        }

        // Create phone lookup entries
        const phoneEntries = phoneNumbers
          .filter((p) => p.normalized)
          .map((p) => ({
            contact_id: contact.id,
            phone_e164: p.normalized!,
            phone_e164_hash: hashPhone(p.normalized!),
            phone_type: p.type,
          }))

        if (phoneEntries.length > 0) {
          await supabase.from('contact_phone_lookup').insert(phoneEntries)
        }

        results.imported++
      } catch (err) {
        results.errors.push(`Row ${rowNum}: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    }

    return NextResponse.json({
      success: true,
      ...results,
    })
  } catch (error) {
    console.error('CSV import error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Parse CSV text into array of rows
 */
function parseCSV(text: string): string[][] {
  const lines = text.split(/\r?\n/)
  const result: string[][] = []

  for (const line of lines) {
    if (!line.trim()) continue

    const row: string[] = []
    let inQuotes = false
    let current = ''

    for (let i = 0; i < line.length; i++) {
      const char = line[i]

      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = !inQuotes
        }
      } else if (char === ',' && !inQuotes) {
        row.push(current)
        current = ''
      } else {
        current += char
      }
    }
    row.push(current)
    result.push(row)
  }

  return result
}

/**
 * Find column index by possible names
 */
function findColumnIndex(headers: string[], possibleNames: string[]): number {
  for (const name of possibleNames) {
    const idx = headers.indexOf(name)
    if (idx !== -1) return idx
  }
  return -1
}

function hashPhone(phone: string): string {
  return createHash('sha256').update(phone).digest('hex')
}
