import {
  WhapiClient,
  createWhapiClient,
  isRateLimitError,
  isRetryableError,
  getRetryDelay,
} from '@/lib/whapi-client'

// Mock fetch
const mockFetch = jest.fn()
global.fetch = mockFetch

describe('WhapiClient', () => {
  let client: WhapiClient

  beforeEach(() => {
    client = new WhapiClient({ token: 'test-token' })
    mockFetch.mockClear()
  })

  describe('constructor', () => {
    it('should use default baseUrl', () => {
      const client = new WhapiClient({ token: 'test' })
      // Check that requests go to default URL
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ok', connected: true }),
      })

      client.getHealth()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://gate.whapi.cloud'),
        expect.any(Object)
      )
    })

    it('should use custom baseUrl if provided', () => {
      const client = new WhapiClient({
        token: 'test',
        baseUrl: 'https://custom.api.com',
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ok', connected: true }),
      })

      client.getHealth()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://custom.api.com'),
        expect.any(Object)
      )
    })
  })

  describe('request headers', () => {
    it('should include Authorization header with Bearer token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ok' }),
      })

      await client.getHealth()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          }),
        })
      )
    })
  })

  describe('sendText', () => {
    it('should send text message successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sent: true,
          message: { id: 'msg-123', status: 'sent', timestamp: 1234567890 },
        }),
      })

      const result = await client.sendText({
        to: '1234567890',
        body: 'Hello World',
      })

      expect(result.sent).toBe(true)
      expect(result.message?.id).toBe('msg-123')
      expect(mockFetch).toHaveBeenCalledWith(
        'https://gate.whapi.cloud/messages/text',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ to: '1234567890', body: 'Hello World' }),
        })
      )
    })

    it('should include quoted message ID if provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sent: true, message: { id: 'msg-123' } }),
      })

      await client.sendText({
        to: '1234567890',
        body: 'Reply',
        quotedMessageId: 'original-msg',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            to: '1234567890',
            body: 'Reply',
            quoted: 'original-msg',
          }),
        })
      )
    })
  })

  describe('sendImage', () => {
    it('should send image message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sent: true, message: { id: 'img-123' } }),
      })

      const result = await client.sendImage(
        '1234567890',
        'https://example.com/image.jpg',
        'My caption'
      )

      expect(result.sent).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://gate.whapi.cloud/messages/image',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            to: '1234567890',
            media: 'https://example.com/image.jpg',
            caption: 'My caption',
          }),
        })
      )
    })
  })

  describe('sendVideo', () => {
    it('should send video message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sent: true, message: { id: 'vid-123' } }),
      })

      await client.sendVideo(
        '1234567890',
        'https://example.com/video.mp4',
        'Video caption'
      )

      expect(mockFetch).toHaveBeenCalledWith(
        'https://gate.whapi.cloud/messages/video',
        expect.any(Object)
      )
    })
  })

  describe('sendDocument', () => {
    it('should send document with filename', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sent: true, message: { id: 'doc-123' } }),
      })

      await client.sendDocument(
        '1234567890',
        'https://example.com/file.pdf',
        'report.pdf',
        'Here is the report'
      )

      expect(mockFetch).toHaveBeenCalledWith(
        'https://gate.whapi.cloud/messages/document',
        expect.objectContaining({
          body: JSON.stringify({
            to: '1234567890',
            media: 'https://example.com/file.pdf',
            filename: 'report.pdf',
            caption: 'Here is the report',
          }),
        })
      )
    })
  })

  describe('sendAudio', () => {
    it('should send audio message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sent: true, message: { id: 'audio-123' } }),
      })

      await client.sendAudio('1234567890', 'https://example.com/audio.mp3')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://gate.whapi.cloud/messages/audio',
        expect.any(Object)
      )
    })
  })

  describe('getHealth', () => {
    it('should return health status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'connected',
          connected: true,
          phone: '+1234567890',
          name: 'Business Account',
        }),
      })

      const result = await client.getHealth()

      expect(result.connected).toBe(true)
      expect(result.phone).toBe('+1234567890')
    })
  })

  describe('error handling', () => {
    it('should throw error with status and message on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Invalid phone number' }),
      })

      await expect(client.sendText({ to: 'invalid', body: 'test' })).rejects.toEqual({
        status: 400,
        message: 'Invalid phone number',
        code: undefined,
      })
    })

    it('should include error code when present', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({
          message: 'Rate limit exceeded',
          code: 'RATE_LIMIT',
        }),
      })

      await expect(client.sendText({ to: '123', body: 'test' })).rejects.toEqual({
        status: 429,
        message: 'Rate limit exceeded',
        code: 'RATE_LIMIT',
      })
    })
  })
})

describe('Error Helpers', () => {
  describe('isRateLimitError', () => {
    it('should return true for 429 status', () => {
      expect(isRateLimitError({ status: 429 })).toBe(true)
    })

    it('should return false for other status codes', () => {
      expect(isRateLimitError({ status: 400 })).toBe(false)
      expect(isRateLimitError({ status: 500 })).toBe(false)
    })

    it('should return false for null/undefined', () => {
      expect(isRateLimitError(null)).toBe(false)
      expect(isRateLimitError(undefined)).toBe(false)
    })
  })

  describe('isRetryableError', () => {
    it('should return true for 5xx errors', () => {
      expect(isRetryableError({ status: 500 })).toBe(true)
      expect(isRetryableError({ status: 502 })).toBe(true)
      expect(isRetryableError({ status: 503 })).toBe(true)
    })

    it('should return true for 429 rate limit', () => {
      expect(isRetryableError({ status: 429 })).toBe(true)
    })

    it('should return true for network errors (no status)', () => {
      expect(isRetryableError({})).toBe(true)
      expect(isRetryableError(new Error('Network error'))).toBe(true)
    })

    it('should return false for 4xx client errors (except 429)', () => {
      expect(isRetryableError({ status: 400 })).toBe(false)
      expect(isRetryableError({ status: 401 })).toBe(false)
      expect(isRetryableError({ status: 404 })).toBe(false)
    })
  })

  describe('getRetryDelay', () => {
    it('should use Retry-After header if present', () => {
      const delay = getRetryDelay({ retryAfter: '60' }, 1)
      expect(delay).toBe(60000) // 60 seconds in ms
    })

    it('should use exponential backoff', () => {
      // 1st attempt: 2^0 * 60000 = 60000ms (1 min)
      expect(getRetryDelay({}, 1)).toBe(60000)
      // 2nd attempt: 2^1 * 60000 = 120000ms (2 min)
      expect(getRetryDelay({}, 2)).toBe(120000)
      // 3rd attempt: 2^2 * 60000 = 240000ms (4 min)
      expect(getRetryDelay({}, 3)).toBe(240000)
      // 4th attempt: 2^3 * 60000 = 480000ms (8 min)
      expect(getRetryDelay({}, 4)).toBe(480000)
    })
  })
})

describe('createWhapiClient', () => {
  it('should create client with token', () => {
    const client = createWhapiClient('my-secret-token')
    expect(client).toBeInstanceOf(WhapiClient)
  })
})
