import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { validateApiAuth } from '@/lib/auth-helpers'
import { decrypt } from '@/lib/encryption'

/**
 * GET /api/channels/[id]/qr
 * Fetch QR code for WhatsApp channel connection
 * Returns QR code image data from Whapi.cloud
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Authenticate user and verify channel access
    await validateApiAuth({ channelId: id })

    const supabase = createServiceRoleClient()

    // Get the encrypted token for this channel
    const { data: tokenData, error: tokenError } = await supabase
      .from('channel_tokens')
      .select('encrypted_token')
      .eq('channel_id', id)
      .eq('token_type', 'whapi')
      .single()

    if (tokenError || !tokenData) {
      return NextResponse.json(
        { error: 'Channel token not found' },
        { status: 404 }
      )
    }

    // Decrypt the Whapi token
    let whapiToken: string
    try {
      whapiToken = decrypt(tokenData.encrypted_token)
    } catch (error) {
      return NextResponse.json(
        { error: 'Failed to decrypt channel token' },
        { status: 500 }
      )
    }

    // Fetch QR code from Whapi.cloud
    try {
      const whapiResponse = await fetch('https://gate.whapi.cloud/qr', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${whapiToken}`,
          'Accept': 'image/png',
        },
      })

      if (!whapiResponse.ok) {
        // If QR code is not available, check the status
        if (whapiResponse.status === 404) {
          return NextResponse.json(
            { error: 'QR code not available. Channel may already be connected.' },
            { status: 404 }
          )
        }

        if (whapiResponse.status === 401) {
          return NextResponse.json(
            { error: 'Invalid Whapi token' },
            { status: 401 }
          )
        }

        return NextResponse.json(
          { error: 'Failed to fetch QR code from Whapi' },
          { status: whapiResponse.status }
        )
      }

      // Get the image as buffer
      const imageBuffer = await whapiResponse.arrayBuffer()
      const base64Image = Buffer.from(imageBuffer).toString('base64')

      // Return QR code as base64 data URL
      return NextResponse.json({
        qr_code: `data:image/png;base64,${base64Image}`,
        channel_id: id,
      })
    } catch (error) {
      return NextResponse.json(
        { error: 'Failed to connect to Whapi.cloud' },
        { status: 500 }
      )
    }
  } catch (error) {
    if (error instanceof Response) {
      return error
    }
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
