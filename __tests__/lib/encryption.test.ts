import {
  encrypt,
  decrypt,
  hash,
  generateToken,
  generateWorkspaceDEK,
  encryptWithWorkspaceDEK,
  decryptWithWorkspaceDEK,
  clearDEKCache,
  normalizePhoneE164,
  hashPhoneE164,
  phoneNumbersMatch,
} from '@/lib/encryption'

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

describe('Workspace DEK Functions', () => {
  const workspaceId = 'test-workspace-123'

  beforeEach(() => {
    clearDEKCache()
  })

  describe('generateWorkspaceDEK', () => {
    it('should generate an encrypted DEK', () => {
      const encryptedDek = generateWorkspaceDEK()

      // Should be a valid encrypted format (salt:iv:authTag:data)
      const parts = encryptedDek.split(':')
      expect(parts.length).toBe(4)
    })

    it('should generate unique DEKs each time', () => {
      const dek1 = generateWorkspaceDEK()
      const dek2 = generateWorkspaceDEK()

      expect(dek1).not.toBe(dek2)
    })
  })

  describe('encryptWithWorkspaceDEK / decryptWithWorkspaceDEK', () => {
    it('should encrypt and decrypt data with workspace DEK', () => {
      const encryptedDek = generateWorkspaceDEK()
      const keyVersion = 1
      const plaintext = 'Hello, World!'

      const encrypted = encryptWithWorkspaceDEK(
        workspaceId,
        encryptedDek,
        keyVersion,
        plaintext
      )
      const decrypted = decryptWithWorkspaceDEK(
        workspaceId,
        encryptedDek,
        keyVersion,
        encrypted
      )

      expect(decrypted).toBe(plaintext)
    })

    it('should produce versioned encrypted format', () => {
      const encryptedDek = generateWorkspaceDEK()
      const keyVersion = 3

      const encrypted = encryptWithWorkspaceDEK(
        workspaceId,
        encryptedDek,
        keyVersion,
        'test'
      )

      // Format: v{version}:iv:authTag:ciphertext
      const parts = encrypted.split(':')
      expect(parts.length).toBe(4)
      expect(parts[0]).toBe('v3')
    })

    it('should handle empty strings', () => {
      const encryptedDek = generateWorkspaceDEK()
      const keyVersion = 1

      const encrypted = encryptWithWorkspaceDEK(
        workspaceId,
        encryptedDek,
        keyVersion,
        ''
      )
      const decrypted = decryptWithWorkspaceDEK(
        workspaceId,
        encryptedDek,
        keyVersion,
        ''
      )

      expect(encrypted).toBe('')
      expect(decrypted).toBe('')
    })

    it('should handle unicode and special characters', () => {
      const encryptedDek = generateWorkspaceDEK()
      const keyVersion = 1
      const plaintext = 'Hello 世界 🌍 émoji \n\t special chars: <>&"'

      const encrypted = encryptWithWorkspaceDEK(
        workspaceId,
        encryptedDek,
        keyVersion,
        plaintext
      )
      const decrypted = decryptWithWorkspaceDEK(
        workspaceId,
        encryptedDek,
        keyVersion,
        encrypted
      )

      expect(decrypted).toBe(plaintext)
    })

    it('should use cached DEK for multiple operations', () => {
      const encryptedDek = generateWorkspaceDEK()
      const keyVersion = 1

      // First operation populates cache
      const encrypted1 = encryptWithWorkspaceDEK(
        workspaceId,
        encryptedDek,
        keyVersion,
        'test1'
      )

      // Second operation should use cache
      const encrypted2 = encryptWithWorkspaceDEK(
        workspaceId,
        encryptedDek,
        keyVersion,
        'test2'
      )

      const decrypted1 = decryptWithWorkspaceDEK(
        workspaceId,
        encryptedDek,
        keyVersion,
        encrypted1
      )
      const decrypted2 = decryptWithWorkspaceDEK(
        workspaceId,
        encryptedDek,
        keyVersion,
        encrypted2
      )

      expect(decrypted1).toBe('test1')
      expect(decrypted2).toBe('test2')
    })

    it('should throw error for invalid encrypted format', () => {
      const encryptedDek = generateWorkspaceDEK()
      const keyVersion = 1

      expect(() =>
        decryptWithWorkspaceDEK(workspaceId, encryptedDek, keyVersion, 'invalid')
      ).toThrow('Invalid encrypted data format')

      expect(() =>
        decryptWithWorkspaceDEK(workspaceId, encryptedDek, keyVersion, 'a:b:c')
      ).toThrow('Invalid encrypted data format')
    })

    it('should throw error for invalid version format', () => {
      const encryptedDek = generateWorkspaceDEK()
      const keyVersion = 1

      expect(() =>
        decryptWithWorkspaceDEK(
          workspaceId,
          encryptedDek,
          keyVersion,
          'invalid:iv:authTag:data'
        )
      ).toThrow('Invalid encryption version')
    })
  })

  describe('clearDEKCache', () => {
    it('should clear cache for specific workspace', () => {
      const encryptedDek = generateWorkspaceDEK()
      const keyVersion = 1

      // Populate cache
      encryptWithWorkspaceDEK(workspaceId, encryptedDek, keyVersion, 'test')

      // Clear specific workspace
      clearDEKCache(workspaceId)

      // Should still work (will re-decrypt DEK)
      const encrypted = encryptWithWorkspaceDEK(
        workspaceId,
        encryptedDek,
        keyVersion,
        'test2'
      )
      const decrypted = decryptWithWorkspaceDEK(
        workspaceId,
        encryptedDek,
        keyVersion,
        encrypted
      )

      expect(decrypted).toBe('test2')
    })

    it('should clear all caches when called without argument', () => {
      const encryptedDek1 = generateWorkspaceDEK()
      const encryptedDek2 = generateWorkspaceDEK()
      const keyVersion = 1

      // Populate cache for two workspaces
      encryptWithWorkspaceDEK('workspace1', encryptedDek1, keyVersion, 'test')
      encryptWithWorkspaceDEK('workspace2', encryptedDek2, keyVersion, 'test')

      // Clear all
      clearDEKCache()

      // Both should still work (will re-decrypt DEKs)
      const encrypted1 = encryptWithWorkspaceDEK(
        'workspace1',
        encryptedDek1,
        keyVersion,
        'new1'
      )
      const encrypted2 = encryptWithWorkspaceDEK(
        'workspace2',
        encryptedDek2,
        keyVersion,
        'new2'
      )

      expect(
        decryptWithWorkspaceDEK('workspace1', encryptedDek1, keyVersion, encrypted1)
      ).toBe('new1')
      expect(
        decryptWithWorkspaceDEK('workspace2', encryptedDek2, keyVersion, encrypted2)
      ).toBe('new2')
    })
  })
})

describe('Phone Number Hashing', () => {
  describe('normalizePhoneE164', () => {
    it('should normalize phone with + prefix', () => {
      expect(normalizePhoneE164('+14155551234')).toBe('+14155551234')
      expect(normalizePhoneE164('+447911123456')).toBe('+447911123456')
    })

    it('should add + prefix to valid numbers without it', () => {
      expect(normalizePhoneE164('14155551234')).toBe('+14155551234')
      expect(normalizePhoneE164('447911123456')).toBe('+447911123456')
    })

    it('should strip non-digit characters', () => {
      expect(normalizePhoneE164('+1 (415) 555-1234')).toBe('+14155551234')
      expect(normalizePhoneE164('+1-415-555-1234')).toBe('+14155551234')
      expect(normalizePhoneE164('+1.415.555.1234')).toBe('+14155551234')
    })

    it('should return null for invalid phones', () => {
      expect(normalizePhoneE164('')).toBeNull()
      expect(normalizePhoneE164('123')).toBeNull() // Too short
      expect(normalizePhoneE164('abcdefghijk')).toBeNull() // Non-digits
      expect(normalizePhoneE164('+0123456789')).toBeNull() // Starts with 0 after +
    })

    it('should handle edge cases', () => {
      // Minimum valid length (7 digits after +)
      expect(normalizePhoneE164('+1234567')).toBe('+1234567')
      // Maximum valid length (15 digits after +)
      expect(normalizePhoneE164('+123456789012345')).toBe('+123456789012345')
      // Too long (16 digits after +)
      expect(normalizePhoneE164('+1234567890123456')).toBeNull()
    })
  })

  describe('hashPhoneE164', () => {
    it('should hash valid phone numbers', () => {
      const hash = hashPhoneE164('+14155551234')

      expect(hash).toBeDefined()
      expect(hash!.length).toBe(64) // SHA-256 = 64 hex chars
      expect(/^[0-9a-f]+$/.test(hash!)).toBe(true)
    })

    it('should produce consistent hashes for same number', () => {
      const hash1 = hashPhoneE164('+14155551234')
      const hash2 = hashPhoneE164('+14155551234')
      const hash3 = hashPhoneE164('14155551234') // Without +
      const hash4 = hashPhoneE164('+1 (415) 555-1234') // Formatted

      expect(hash1).toBe(hash2)
      expect(hash1).toBe(hash3)
      expect(hash1).toBe(hash4)
    })

    it('should produce different hashes for different numbers', () => {
      const hash1 = hashPhoneE164('+14155551234')
      const hash2 = hashPhoneE164('+14155551235')

      expect(hash1).not.toBe(hash2)
    })

    it('should return null for invalid phones', () => {
      expect(hashPhoneE164('')).toBeNull()
      expect(hashPhoneE164('invalid')).toBeNull()
      expect(hashPhoneE164('123')).toBeNull()
    })
  })

  describe('phoneNumbersMatch', () => {
    it('should match equivalent phone numbers', () => {
      expect(phoneNumbersMatch('+14155551234', '14155551234')).toBe(true)
      expect(phoneNumbersMatch('+1 (415) 555-1234', '+14155551234')).toBe(true)
      expect(phoneNumbersMatch('1-415-555-1234', '+1.415.555.1234')).toBe(true)
    })

    it('should not match different phone numbers', () => {
      expect(phoneNumbersMatch('+14155551234', '+14155551235')).toBe(false)
      expect(phoneNumbersMatch('+14155551234', '+447911123456')).toBe(false)
    })

    it('should return false for invalid numbers', () => {
      expect(phoneNumbersMatch('', '+14155551234')).toBe(false)
      expect(phoneNumbersMatch('+14155551234', '')).toBe(false)
      expect(phoneNumbersMatch('invalid', '+14155551234')).toBe(false)
    })
  })
})
