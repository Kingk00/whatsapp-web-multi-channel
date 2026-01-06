import { encrypt, decrypt, hash, generateToken } from '@/lib/encryption'

describe('Encryption Module', () => {
  describe('encrypt / decrypt', () => {
    it('should encrypt and decrypt a string correctly', () => {
      const original = 'my-secret-api-token'
      const encrypted = encrypt(original)
      const decrypted = decrypt(encrypted)

      expect(decrypted).toBe(original)
    })

    it('should produce different ciphertext for same input (due to random salt/iv)', () => {
      const original = 'my-secret-api-token'
      const encrypted1 = encrypt(original)
      const encrypted2 = encrypt(original)

      expect(encrypted1).not.toBe(encrypted2)
    })

    it('should handle empty strings', () => {
      const original = ''
      const encrypted = encrypt(original)
      const decrypted = decrypt(encrypted)

      expect(decrypted).toBe(original)
    })

    it('should handle unicode characters', () => {
      const original = 'Hello 世界 🌍 émoji'
      const encrypted = encrypt(original)
      const decrypted = decrypt(encrypted)

      expect(decrypted).toBe(original)
    })

    it('should handle long strings', () => {
      const original = 'a'.repeat(10000)
      const encrypted = encrypt(original)
      const decrypted = decrypt(encrypted)

      expect(decrypted).toBe(original)
    })

    it('should produce encrypted format with 4 parts separated by colons', () => {
      const encrypted = encrypt('test')
      const parts = encrypted.split(':')

      expect(parts.length).toBe(4)
      // Salt (64 bytes = 128 hex chars)
      expect(parts[0].length).toBe(128)
      // IV (16 bytes = 32 hex chars)
      expect(parts[1].length).toBe(32)
      // Auth tag (16 bytes = 32 hex chars)
      expect(parts[2].length).toBe(32)
      // Encrypted data (hex string)
      expect(parts[3].length).toBeGreaterThan(0)
    })

    it('should throw error for invalid encrypted format', () => {
      expect(() => decrypt('invalid')).toThrow('Failed to decrypt data')
      expect(() => decrypt('a:b')).toThrow('Failed to decrypt data')
      expect(() => decrypt('a:b:c')).toThrow('Failed to decrypt data')
    })

    it('should throw error for tampered ciphertext', () => {
      const encrypted = encrypt('test')
      const parts = encrypted.split(':')
      // Tamper with encrypted data
      parts[3] = parts[3].replace('0', '1').replace('a', 'b')
      const tampered = parts.join(':')

      expect(() => decrypt(tampered)).toThrow('Failed to decrypt data')
    })

    it('should throw error for tampered auth tag', () => {
      const encrypted = encrypt('test')
      const parts = encrypted.split(':')
      // Tamper with auth tag
      parts[2] = '00'.repeat(16)
      const tampered = parts.join(':')

      expect(() => decrypt(tampered)).toThrow('Failed to decrypt data')
    })
  })

  describe('hash', () => {
    it('should produce consistent hash for same input', () => {
      const input = 'my-webhook-secret'
      const hash1 = hash(input)
      const hash2 = hash(input)

      expect(hash1).toBe(hash2)
    })

    it('should produce different hashes for different inputs', () => {
      const hash1 = hash('input1')
      const hash2 = hash('input2')

      expect(hash1).not.toBe(hash2)
    })

    it('should produce 64-character hex string (SHA-256)', () => {
      const result = hash('test')

      expect(result.length).toBe(64)
      expect(/^[0-9a-f]+$/.test(result)).toBe(true)
    })

    it('should handle empty strings', () => {
      const result = hash('')

      expect(result.length).toBe(64)
    })
  })

  describe('generateToken', () => {
    it('should generate default 32-byte token (64 hex chars)', () => {
      const token = generateToken()

      expect(token.length).toBe(64)
      expect(/^[0-9a-f]+$/.test(token)).toBe(true)
    })

    it('should generate token of specified length', () => {
      const token16 = generateToken(16)
      const token64 = generateToken(64)

      expect(token16.length).toBe(32) // 16 bytes = 32 hex chars
      expect(token64.length).toBe(128) // 64 bytes = 128 hex chars
    })

    it('should generate unique tokens', () => {
      const tokens = new Set(Array.from({ length: 100 }, () => generateToken()))

      expect(tokens.size).toBe(100)
    })
  })
})

describe('Encryption Module - Environment', () => {
  const originalKey = process.env.ENCRYPTION_KEY

  afterEach(() => {
    process.env.ENCRYPTION_KEY = originalKey
  })

  it('should throw error if ENCRYPTION_KEY is not set (encrypt)', () => {
    delete process.env.ENCRYPTION_KEY

    expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY environment variable is not set')
  })

  it('should throw error if ENCRYPTION_KEY is not set (decrypt)', () => {
    // First encrypt with key
    const encrypted = encrypt('test')

    // Then try to decrypt without key
    delete process.env.ENCRYPTION_KEY

    expect(() => decrypt(encrypted)).toThrow('ENCRYPTION_KEY environment variable is not set')
  })
})
