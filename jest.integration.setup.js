// Jest integration test setup file

// Mock environment variables for integration testing
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars!!'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
process.env.CRON_SECRET = 'test-cron-secret'

// Mock fetch globally
global.fetch = jest.fn()

// Mock NextResponse for API routes
jest.mock('next/server', () => {
  return {
    NextRequest: class MockNextRequest {
      constructor(url, options = {}) {
        this.url = url
        this.method = options.method || 'GET'
        this._headers = new Map(Object.entries(options.headers || {}))
        this._body = options.body
      }

      get headers() {
        return {
          get: (key) => this._headers.get(key.toLowerCase()) || this._headers.get(key),
        }
      }

      async json() {
        return typeof this._body === 'string' ? JSON.parse(this._body) : this._body
      }
    },
    NextResponse: {
      json: (data, options = {}) => ({
        status: options.status || 200,
        headers: options.headers || {},
        json: async () => data,
        _data: data,
      }),
    },
  }
})

// Reset mocks after each test
afterEach(() => {
  jest.clearAllMocks()
})
