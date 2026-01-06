/**
 * Integration tests for /api/webhooks/whapi/[channelId] route
 */

import { NextRequest, NextResponse } from 'next/server'

// Mock crypto for webhook signature verification
jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  createHmac: jest.fn(() => ({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn().mockReturnValue('valid-signature'),
  })),
}))

// Mock dependencies
const mockChannel = {
  id: 'channel-123',
  workspace_id: 'workspace-123',
  status: 'active',
}

const mockSupabase = {
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  single: jest.fn(),
}

jest.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: jest.fn(() => mockSupabase),
}))

jest.mock('@/lib/encryption', () => ({
  hash: jest.fn((input) => 'hashed-' + input),
}))

jest.mock('@/lib/webhook-processor', () => ({
  processWebhookEvent: jest.fn().mockResolvedValue({
    success: true,
    action: 'message_upserted',
    details: { message_id: 'msg-123' },
  }),
}))

// Import after mocking
import { POST, GET } from '@/app/api/webhooks/whapi/[channelId]/route'
import { processWebhookEvent } from '@/lib/webhook-processor'

describe('Webhook API Route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Default mock: channel exists
    mockSupabase.single.mockResolvedValue({
      data: mockChannel,
      error: null,
    })
  })

  describe('GET /api/webhooks/whapi/[channelId]', () => {
    it('should return 200 for webhook verification', async () => {
      const request = new NextRequest(
        'http://localhost/api/webhooks/whapi/channel-123?hub.challenge=test-challenge'
      )

      const response = await GET(request, { params: { channelId: 'channel-123' } })

      expect(response.status).toBe(200)
    })
  })

  describe('POST /api/webhooks/whapi/[channelId]', () => {
    it('should return 404 if channel not found', async () => {
      mockSupabase.single.mockResolvedValue({
        data: null,
        error: { message: 'Not found' },
      })

      const request = new NextRequest('http://localhost/api/webhooks/whapi/unknown-channel', {
        method: 'POST',
        body: JSON.stringify({ event: 'message', id: 'msg-123' }),
        headers: {
          'Content-Type': 'application/json',
        },
      })

      const response = await POST(request, { params: { channelId: 'unknown-channel' } })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Channel not found')
    })

    it('should process valid webhook event', async () => {
      const webhookPayload = {
        event: 'message',
        id: 'msg-123',
        chat_id: 'chat-123',
        from: '1234567890',
        body: 'Hello World',
        timestamp: 1234567890,
      }

      const request = new NextRequest('http://localhost/api/webhooks/whapi/channel-123', {
        method: 'POST',
        body: JSON.stringify(webhookPayload),
        headers: {
          'Content-Type': 'application/json',
        },
      })

      const response = await POST(request, { params: { channelId: 'channel-123' } })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.received).toBe(true)
      expect(processWebhookEvent).toHaveBeenCalledWith(
        mockChannel,
        webhookPayload
      )
    })

    it('should handle webhook processing errors gracefully', async () => {
      const mockProcessWebhookEvent = processWebhookEvent as jest.Mock
      mockProcessWebhookEvent.mockResolvedValueOnce({
        success: false,
        action: 'error',
        error: 'Processing failed',
      })

      const webhookPayload = {
        event: 'message',
        id: 'msg-123',
      }

      const request = new NextRequest('http://localhost/api/webhooks/whapi/channel-123', {
        method: 'POST',
        body: JSON.stringify(webhookPayload),
        headers: {
          'Content-Type': 'application/json',
        },
      })

      const response = await POST(request, { params: { channelId: 'channel-123' } })

      // Should still return 200 to acknowledge receipt
      expect(response.status).toBe(200)
    })

    it('should handle malformed JSON body', async () => {
      const request = new NextRequest('http://localhost/api/webhooks/whapi/channel-123', {
        method: 'POST',
        body: 'invalid json',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      // Mock json() to throw
      request.json = jest.fn().mockRejectedValue(new Error('Invalid JSON'))

      const response = await POST(request, { params: { channelId: 'channel-123' } })

      expect(response.status).toBe(400)
    })

    it('should process batch message events', async () => {
      const webhookPayload = {
        event: 'messages',
        messages: [
          { id: 'msg-1', chat_id: 'chat-1', body: 'Hello 1' },
          { id: 'msg-2', chat_id: 'chat-1', body: 'Hello 2' },
        ],
      }

      const request = new NextRequest('http://localhost/api/webhooks/whapi/channel-123', {
        method: 'POST',
        body: JSON.stringify(webhookPayload),
        headers: {
          'Content-Type': 'application/json',
        },
      })

      const response = await POST(request, { params: { channelId: 'channel-123' } })

      expect(response.status).toBe(200)
      expect(processWebhookEvent).toHaveBeenCalledWith(
        mockChannel,
        webhookPayload
      )
    })

    it('should process status update events', async () => {
      const webhookPayload = {
        event: 'message.status',
        data: {
          id: 'msg-123',
          status: 'delivered',
        },
      }

      const request = new NextRequest('http://localhost/api/webhooks/whapi/channel-123', {
        method: 'POST',
        body: JSON.stringify(webhookPayload),
        headers: {
          'Content-Type': 'application/json',
        },
      })

      const response = await POST(request, { params: { channelId: 'channel-123' } })

      expect(response.status).toBe(200)
      expect(processWebhookEvent).toHaveBeenCalled()
    })
  })
})
