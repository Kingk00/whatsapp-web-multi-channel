/**
 * Bloe Engine Providers API Proxy
 *
 * Fetches available providers from the Bloe Engine API.
 * This server-side proxy avoids CORS issues when calling from the browser.
 */

import { NextResponse } from 'next/server'

// Fixed Bloe Engine API URL
const BLOE_API_URL = 'https://web-production-eb6f3.up.railway.app'

export async function GET() {
  try {
    const response = await fetch(`${BLOE_API_URL}/api/providers`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      // Cache for 60 seconds to reduce API calls
      next: { revalidate: 60 },
    })

    if (!response.ok) {
      console.error(`Bloe API error: ${response.status} ${response.statusText}`)
      return NextResponse.json(
        { error: `Failed to fetch providers: ${response.status}`, providers: [] },
        { status: response.status }
      )
    }

    const data = await response.json()

    return NextResponse.json({
      providers: data.providers || [],
      total: data.total || 0,
      active: data.active || 0,
    })
  } catch (error: any) {
    console.error('Error fetching Bloe providers:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to connect to Bloe Engine', providers: [] },
      { status: 500 }
    )
  }
}
