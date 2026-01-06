/**
 * Integration tests for /api/chats route
 */

import { NextRequest, NextResponse } from 'next/server'

// Mock Supabase client
const mockSelect = jest.fn()
const mockOrder = jest.fn()
const mockLimit = jest.fn()
const mockRange = jest.fn()
const mockEq = jest.fn()
const mockOr = jest.fn()

const mockSupabase = {
  from: jest.fn(() => ({
    select: mockSelect,
  })),
  auth: {
    getUser: jest.fn(),
  },
}

mockSelect.mockReturnValue({ order: mockOrder })
mockOrder.mockReturnValue({ limit: mockLimit })
mockLimit.mockReturnValue({ range: mockRange })
mockRange.mockReturnValue({ eq: mockEq })
mockEq.mockReturnValue({ or: mockOr })

// Mock the Supabase modules
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(() => mockSupabase),
}))

// Import after mocking
import { GET } from '@/app/api/chats/route'

describe('GET /api/chats', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Default: authenticated user
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null,
    })
  })

  it('should return 401 if user is not authenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'Not authenticated' },
    })

    const request = new NextRequest('http://localhost/api/chats')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('should return chats for authenticated user', async () => {
    const mockChats = [
      {
        id: 'chat-1',
        wa_chat_id: '123456789@s.whatsapp.net',
        contact_name: 'John Doe',
        last_message_text: 'Hello',
        last_message_at: '2024-01-15T10:00:00Z',
        unread_count: 2,
        channel: { id: 'ch-1', display_name: 'Business 1' },
      },
      {
        id: 'chat-2',
        wa_chat_id: '987654321@s.whatsapp.net',
        contact_name: 'Jane Doe',
        last_message_text: 'Hi there',
        last_message_at: '2024-01-15T09:00:00Z',
        unread_count: 0,
        channel: { id: 'ch-2', display_name: 'Business 2' },
      },
    ]

    mockOr.mockResolvedValue({
      data: mockChats,
      error: null,
    })

    const request = new NextRequest('http://localhost/api/chats')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.chats).toHaveLength(2)
    expect(data.chats[0].contact_name).toBe('John Doe')
  })

  it('should filter by channel_id when provided', async () => {
    mockOr.mockResolvedValue({
      data: [],
      error: null,
    })

    const request = new NextRequest('http://localhost/api/chats?channel_id=ch-1')
    await GET(request)

    expect(mockEq).toHaveBeenCalledWith('channel_id', 'ch-1')
  })

  it('should apply pagination parameters', async () => {
    mockOr.mockResolvedValue({
      data: [],
      error: null,
    })

    const request = new NextRequest('http://localhost/api/chats?limit=20&offset=10')
    await GET(request)

    expect(mockLimit).toHaveBeenCalledWith(20)
    expect(mockRange).toHaveBeenCalledWith(10, 29) // offset to offset+limit-1
  })

  it('should handle database errors', async () => {
    mockOr.mockResolvedValue({
      data: null,
      error: { message: 'Database error' },
    })

    const request = new NextRequest('http://localhost/api/chats')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to fetch chats')
  })
})
