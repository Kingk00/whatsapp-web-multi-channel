/**
 * Integration tests for /api/chats/[id]/messages route
 */

import { NextRequest, NextResponse } from 'next/server'

// Mock Supabase client
const mockSelect = jest.fn()
const mockOrder = jest.fn()
const mockLimit = jest.fn()
const mockLt = jest.fn()
const mockEq = jest.fn()
const mockIs = jest.fn()
const mockInsert = jest.fn()
const mockSingle = jest.fn()

const mockSupabase = {
  from: jest.fn(() => ({
    select: mockSelect,
    insert: mockInsert,
  })),
  auth: {
    getUser: jest.fn(),
  },
}

mockSelect.mockReturnValue({ order: mockOrder })
mockOrder.mockReturnValue({ limit: mockLimit })
mockLimit.mockReturnValue({ lt: mockLt })
mockLt.mockReturnValue({ eq: mockEq })
mockEq.mockReturnValue({ is: mockIs })
mockInsert.mockReturnValue({ select: jest.fn().mockReturnValue({ single: mockSingle }) })

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(() => mockSupabase),
}))

// Import after mocking
import { GET, POST } from '@/app/api/chats/[id]/messages/route'

describe('Messages API Route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Default: authenticated user
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null,
    })
  })

  describe('GET /api/chats/[id]/messages', () => {
    it('should return 401 if user is not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Not authenticated' },
      })

      const request = new NextRequest('http://localhost/api/chats/chat-123/messages')
      const response = await GET(request, { params: { id: 'chat-123' } })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return messages for a chat', async () => {
      const mockMessages = [
        {
          id: 'msg-1',
          wa_message_id: 'wa-msg-1',
          direction: 'inbound',
          message_type: 'text',
          text: 'Hello',
          created_at: '2024-01-15T10:00:00Z',
          status: null,
        },
        {
          id: 'msg-2',
          wa_message_id: 'wa-msg-2',
          direction: 'outbound',
          message_type: 'text',
          text: 'Hi there',
          created_at: '2024-01-15T10:01:00Z',
          status: 'delivered',
        },
      ]

      mockIs.mockResolvedValue({
        data: mockMessages,
        error: null,
      })

      const request = new NextRequest('http://localhost/api/chats/chat-123/messages')
      const response = await GET(request, { params: { id: 'chat-123' } })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.messages).toHaveLength(2)
    })

    it('should apply cursor pagination', async () => {
      mockIs.mockResolvedValue({
        data: [],
        error: null,
      })

      const request = new NextRequest(
        'http://localhost/api/chats/chat-123/messages?cursor=2024-01-15T10:00:00Z'
      )
      await GET(request, { params: { id: 'chat-123' } })

      expect(mockLt).toHaveBeenCalledWith('created_at', '2024-01-15T10:00:00Z')
    })

    it('should limit results', async () => {
      mockIs.mockResolvedValue({
        data: [],
        error: null,
      })

      const request = new NextRequest(
        'http://localhost/api/chats/chat-123/messages?limit=20'
      )
      await GET(request, { params: { id: 'chat-123' } })

      expect(mockLimit).toHaveBeenCalledWith(20)
    })

    it('should handle database errors', async () => {
      mockIs.mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      })

      const request = new NextRequest('http://localhost/api/chats/chat-123/messages')
      const response = await GET(request, { params: { id: 'chat-123' } })
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to fetch messages')
    })
  })

  describe('POST /api/chats/[id]/messages', () => {
    it('should return 401 if user is not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Not authenticated' },
      })

      const request = new NextRequest('http://localhost/api/chats/chat-123/messages', {
        method: 'POST',
        body: JSON.stringify({ text: 'Hello' }),
      })
      const response = await POST(request, { params: { id: 'chat-123' } })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return 400 if text is missing', async () => {
      const request = new NextRequest('http://localhost/api/chats/chat-123/messages', {
        method: 'POST',
        body: JSON.stringify({}),
      })
      const response = await POST(request, { params: { id: 'chat-123' } })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('text')
    })

    it('should create message and outbox entry', async () => {
      // Mock chat lookup
      const mockChatSelect = jest.fn().mockResolvedValue({
        data: {
          id: 'chat-123',
          channel_id: 'channel-123',
          wa_chat_id: '1234567890@s.whatsapp.net',
          workspace_id: 'workspace-123',
        },
        error: null,
      })

      mockSupabase.from.mockImplementation((table) => {
        if (table === 'chats') {
          return {
            select: () => ({
              eq: () => ({
                single: mockChatSelect,
              }),
            }),
          }
        }
        if (table === 'messages') {
          return {
            insert: () => ({
              select: () => ({
                single: jest.fn().mockResolvedValue({
                  data: {
                    id: 'msg-new',
                    text: 'Hello',
                    status: 'pending',
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'outbox_messages') {
          return {
            insert: jest.fn().mockResolvedValue({
              data: { id: 'outbox-123' },
              error: null,
            }),
          }
        }
        return mockSupabase.from(table)
      })

      const request = new NextRequest('http://localhost/api/chats/chat-123/messages', {
        method: 'POST',
        body: JSON.stringify({ text: 'Hello' }),
      })
      const response = await POST(request, { params: { id: 'chat-123' } })

      expect(response.status).toBe(201)
    })

    it('should return 404 if chat not found', async () => {
      mockSupabase.from.mockImplementation((table) => {
        if (table === 'chats') {
          return {
            select: () => ({
              eq: () => ({
                single: jest.fn().mockResolvedValue({
                  data: null,
                  error: { message: 'Not found' },
                }),
              }),
            }),
          }
        }
        return mockSupabase.from(table)
      })

      const request = new NextRequest('http://localhost/api/chats/unknown-chat/messages', {
        method: 'POST',
        body: JSON.stringify({ text: 'Hello' }),
      })
      const response = await POST(request, { params: { id: 'unknown-chat' } })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Chat not found')
    })
  })
})
