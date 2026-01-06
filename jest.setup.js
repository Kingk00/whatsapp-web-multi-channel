// Jest setup file

// Mock environment variables
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars!!'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
process.env.CRON_SECRET = 'test-cron-secret'

// Mock fetch globally
global.fetch = jest.fn()

// Reset mocks after each test
afterEach(() => {
  jest.clearAllMocks()
})
