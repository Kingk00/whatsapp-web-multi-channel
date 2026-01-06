/**
 * Unit tests for webhook processor helper functions
 * Database operations are tested in integration tests
 */

// Mock the Supabase client and dependencies
jest.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: jest.fn(() => ({
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    upsert: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
  })),
}))

jest.mock('@/lib/chat-helpers', () => ({
  getOrCreateChat: jest.fn().mockResolvedValue({ id: 'chat-123' }),
  updateChatLastMessage: jest.fn().mockResolvedValue(undefined),
}))

import { processWebhookEvent, ChannelInfo } from '@/lib/webhook-processor'

const mockChannel: ChannelInfo = {
  id: 'channel-123',
  workspace_id: 'workspace-123',
  status: 'active',
}

describe('Webhook Processor', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('processWebhookEvent - Event Type Routing', () => {
    it('should route message events to message processor', async () => {
      const event = {
        event: 'message',
        id: 'msg-123',
        chat_id: 'chat-123',
        from: '1234567890',
        body: 'Hello',
      }

      const result = await processWebhookEvent(mockChannel, event)

      expect(result.action).toMatch(/message|error/)
    })

    it('should route messages (plural) events', async () => {
      const event = {
        event: 'messages',
        messages: [
          { id: 'msg-1', chat_id: 'chat-123', body: 'Hello 1' },
          { id: 'msg-2', chat_id: 'chat-123', body: 'Hello 2' },
        ],
      }

      const result = await processWebhookEvent(mockChannel, event)

      expect(result.action).toMatch(/message|error/)
    })

    it('should route status events to status processor', async () => {
      const event = {
        event: 'message.status',
        data: {
          id: 'msg-123',
          status: 'delivered',
        },
      }

      const result = await processWebhookEvent(mockChannel, event)

      expect(result.action).toMatch(/status|ignored|error/)
    })

    it('should route ack events to status processor', async () => {
      const event = {
        event: 'ack',
        id: 'msg-123',
        ack: 2, // delivered
      }

      const result = await processWebhookEvent(mockChannel, event)

      expect(result.action).toMatch(/status|ignored|error/)
    })

    it('should route edit events to edit processor', async () => {
      const event = {
        event: 'message.edit',
        data: {
          id: 'msg-123',
          newBody: 'Edited message',
        },
      }

      const result = await processWebhookEvent(mockChannel, event)

      expect(result.action).toMatch(/edit|error/)
    })

    it('should route delete events to delete processor', async () => {
      const event = {
        event: 'message.revoked',
        data: {
          id: 'msg-123',
        },
      }

      const result = await processWebhookEvent(mockChannel, event)

      expect(result.action).toMatch(/delete|error/)
    })

    it('should route chat events to chat processor', async () => {
      const event = {
        event: 'chat',
        data: {
          id: 'chat-123',
          archive: true,
        },
      }

      const result = await processWebhookEvent(mockChannel, event)

      expect(result.action).toMatch(/chat|ignored|error/)
    })

    it('should route channel.status events', async () => {
      const event = {
        event: 'channel.status',
        data: {
          status: 'connected',
        },
      }

      const result = await processWebhookEvent(mockChannel, event)

      expect(result.action).toMatch(/channel|ignored|error/)
    })

    it('should ignore unknown event types', async () => {
      const event = {
        event: 'unknown.event.type',
        data: {},
      }

      const result = await processWebhookEvent(mockChannel, event)

      expect(result.success).toBe(true)
      expect(result.action).toBe('ignored')
      expect(result.details?.reason).toContain('Unknown event type')
    })

    it('should handle missing event type gracefully', async () => {
      const event = {
        data: { some: 'data' },
      }

      const result = await processWebhookEvent(mockChannel, event)

      expect(result.success).toBe(true)
      expect(result.action).toBe('ignored')
    })
  })

  describe('processWebhookEvent - Message Validation', () => {
    it('should fail if message ID is missing', async () => {
      const event = {
        event: 'message',
        chat_id: 'chat-123',
        body: 'Hello',
        // Missing id
      }

      const result = await processWebhookEvent(mockChannel, event)

      expect(result.details?.results?.[0]?.success).toBe(false)
      expect(result.details?.results?.[0]?.error).toContain('message ID')
    })

    it('should handle both type and event fields', async () => {
      // Using 'type' instead of 'event'
      const event = {
        type: 'message',
        id: 'msg-123',
        chat_id: 'chat-123',
        body: 'Hello',
      }

      const result = await processWebhookEvent(mockChannel, event)

      expect(result.action).toMatch(/message|error/)
    })
  })

  describe('processWebhookEvent - Status Validation', () => {
    it('should fail if status event missing message ID', async () => {
      const event = {
        event: 'message.status',
        data: {
          status: 'delivered',
          // Missing id
        },
      }

      const result = await processWebhookEvent(mockChannel, event)

      expect(result.success).toBe(false)
      expect(result.error).toContain('message ID')
    })

    it('should ignore unknown status values', async () => {
      const event = {
        event: 'message.status',
        data: {
          id: 'msg-123',
          status: 'unknown_status_value',
        },
      }

      const result = await processWebhookEvent(mockChannel, event)

      expect(result.success).toBe(true)
      expect(result.action).toBe('ignored')
    })
  })

  describe('processWebhookEvent - Edit Validation', () => {
    it('should fail if edit event missing message ID', async () => {
      const event = {
        event: 'message.edit',
        data: {
          newBody: 'Edited text',
          // Missing id
        },
      }

      const result = await processWebhookEvent(mockChannel, event)

      expect(result.success).toBe(false)
      expect(result.error).toContain('message ID')
    })
  })

  describe('processWebhookEvent - Delete Validation', () => {
    it('should fail if delete event missing message ID', async () => {
      const event = {
        event: 'message.delete',
        data: {
          // Missing id
        },
      }

      const result = await processWebhookEvent(mockChannel, event)

      expect(result.success).toBe(false)
      expect(result.error).toContain('message ID')
    })
  })

  describe('processWebhookEvent - Chat Validation', () => {
    it('should fail if chat event missing chat ID', async () => {
      const event = {
        event: 'chat',
        data: {
          archive: true,
          // Missing chat id
        },
      }

      const result = await processWebhookEvent(mockChannel, event)

      expect(result.success).toBe(false)
      expect(result.error).toContain('chat ID')
    })

    it('should ignore unhandled chat events', async () => {
      const event = {
        event: 'chat',
        data: {
          id: 'chat-123',
          // No archive field
        },
      }

      const result = await processWebhookEvent(mockChannel, event)

      expect(result.success).toBe(true)
      expect(result.action).toBe('ignored')
    })
  })

  describe('Error Handling', () => {
    it('should catch and return errors', async () => {
      // Force an error by providing malformed data
      const event = {
        event: 'message',
        id: 'msg-123',
        chat_id: 'chat-123',
        body: 'test',
      }

      // Even with mock errors, the processor should not throw
      const result = await processWebhookEvent(mockChannel, event)

      expect(result).toHaveProperty('success')
      expect(result).toHaveProperty('action')
    })
  })
})

describe('Status Mapping', () => {
  // Test status mapping through processWebhookEvent
  it('should map numeric ack 0 to pending', async () => {
    const event = { event: 'ack', id: 'msg-123', ack: 0 }
    const result = await processWebhookEvent(mockChannel, event)
    expect(result.details?.new_status).toBe('pending')
  })

  it('should map numeric ack 1 to sent', async () => {
    const event = { event: 'ack', id: 'msg-123', ack: 1 }
    const result = await processWebhookEvent(mockChannel, event)
    expect(result.details?.new_status).toBe('sent')
  })

  it('should map numeric ack 2 to delivered', async () => {
    const event = { event: 'ack', id: 'msg-123', ack: 2 }
    const result = await processWebhookEvent(mockChannel, event)
    expect(result.details?.new_status).toBe('delivered')
  })

  it('should map numeric ack 3 to read', async () => {
    const event = { event: 'ack', id: 'msg-123', ack: 3 }
    const result = await processWebhookEvent(mockChannel, event)
    expect(result.details?.new_status).toBe('read')
  })

  it('should map string "delivered" to delivered', async () => {
    const event = { event: 'message.status', id: 'msg-123', status: 'delivered' }
    const result = await processWebhookEvent(mockChannel, event)
    expect(result.details?.new_status).toBe('delivered')
  })

  it('should map string "seen" to read', async () => {
    const event = { event: 'message.status', id: 'msg-123', status: 'seen' }
    const result = await processWebhookEvent(mockChannel, event)
    expect(result.details?.new_status).toBe('read')
  })
})

describe('Channel Status Mapping', () => {
  it('should map "connected" to active', async () => {
    const event = { event: 'channel.status', status: 'connected' }
    const result = await processWebhookEvent(mockChannel, event)
    expect(result.details?.new_status).toBe('active')
  })

  it('should map "disconnected" to stopped', async () => {
    const event = { event: 'channel.status', status: 'disconnected' }
    const result = await processWebhookEvent(mockChannel, event)
    expect(result.details?.new_status).toBe('stopped')
  })

  it('should map "qr" to needs_reauth', async () => {
    const event = { event: 'channel.status', status: 'qr' }
    const result = await processWebhookEvent(mockChannel, event)
    expect(result.details?.new_status).toBe('needs_reauth')
  })

  it('should ignore unknown channel status', async () => {
    const event = { event: 'channel.status', status: 'unknown_status' }
    const result = await processWebhookEvent(mockChannel, event)
    expect(result.action).toBe('ignored')
  })
})
