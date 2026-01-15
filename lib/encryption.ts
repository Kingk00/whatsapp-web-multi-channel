import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16
const SALT_LENGTH = 64
const DEK_LENGTH = 32 // 256 bits for AES-256

// In-memory cache for decrypted DEKs (cleared on process restart)
// Key: workspaceId, Value: { dek: Buffer, version: number, expiresAt: number }
const dekCache = new Map<string, { dek: Buffer; version: number; expiresAt: number }>()
const DEK_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

// ============================================================================
// PERFORMANCE: PBKDF2 Key Derivation Cache
// ============================================================================
// PBKDF2 with 100,000 iterations is expensive (~20ms per call)
// Cache derived keys by salt to avoid redundant computation

interface DerivedKeyCache {
  key: Buffer
  expiry: number
}

const pbkdf2Cache = new Map<string, DerivedKeyCache>()
const PBKDF2_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Derive key from ENCRYPTION_KEY using PBKDF2 with caching
 * PERFORMANCE: Caches derived keys to avoid expensive PBKDF2 computation
 */
function deriveKeyCached(salt: Buffer): Buffer {
  const saltHex = salt.toString('hex')
  const now = Date.now()

  // Check cache
  const cached = pbkdf2Cache.get(saltHex)
  if (cached && cached.expiry > now) {
    return cached.key
  }

  // Cache miss - derive key (expensive operation)
  const key = crypto.pbkdf2Sync(
    process.env.ENCRYPTION_KEY!,
    salt,
    100000,
    32,
    'sha256'
  )

  // Cache the derived key
  pbkdf2Cache.set(saltHex, {
    key,
    expiry: now + PBKDF2_CACHE_TTL_MS,
  })

  return key
}

// Cleanup expired PBKDF2 cache entries periodically
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of pbkdf2Cache.entries()) {
    if (entry.expiry < now) {
      pbkdf2Cache.delete(key)
    }
  }
}, 60000) // Every minute

/**
 * Encrypt sensitive data (e.g., Whapi tokens) using AES-256-GCM
 * @param text - Plain text to encrypt
 * @returns Encrypted string in format: salt:iv:authTag:encryptedData
 */
export function encrypt(text: string): string {
  if (!process.env.ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY environment variable is not set')
  }

  // Generate random salt and IV
  const salt = crypto.randomBytes(SALT_LENGTH)
  const iv = crypto.randomBytes(IV_LENGTH)

  // Derive key from ENCRYPTION_KEY using PBKDF2
  const key = crypto.pbkdf2Sync(
    process.env.ENCRYPTION_KEY,
    salt,
    100000,
    32,
    'sha256'
  )

  // Create cipher
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

  // Encrypt the text
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  // Get authentication tag
  const authTag = cipher.getAuthTag()

  // Return format: salt:iv:authTag:encryptedData
  return [
    salt.toString('hex'),
    iv.toString('hex'),
    authTag.toString('hex'),
    encrypted,
  ].join(':')
}

/**
 * Decrypt data encrypted with encrypt()
 * PERFORMANCE: Uses cached key derivation to avoid expensive PBKDF2 on repeat calls
 *
 * @param encryptedText - Encrypted string in format: salt:iv:authTag:encryptedData
 * @returns Decrypted plain text
 */
export function decrypt(encryptedText: string): string {
  if (!process.env.ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY environment variable is not set')
  }

  try {
    // Parse the encrypted text
    const parts = encryptedText.split(':')
    if (parts.length !== 4) {
      throw new Error('Invalid encrypted text format')
    }

    const [saltHex, ivHex, authTagHex, encryptedData] = parts

    // Convert from hex
    const salt = Buffer.from(saltHex, 'hex')
    const iv = Buffer.from(ivHex, 'hex')
    const authTag = Buffer.from(authTagHex, 'hex')

    // PERFORMANCE: Use cached key derivation
    const key = deriveKeyCached(salt)

    // Create decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)

    // Decrypt the data
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8')
    decrypted += decipher.final('utf8')

    return decrypted
  } catch (error) {
    throw new Error('Failed to decrypt data: Invalid encryption key or corrupted data')
  }
}

/**
 * Hash data for comparison (one-way, cannot be decrypted)
 * Useful for storing webhook secrets, etc.
 * @param text - Plain text to hash
 * @returns SHA-256 hash in hex format
 */
export function hash(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex')
}

/**
 * Generate a secure random token
 * @param length - Number of bytes (default: 32)
 * @returns Random token in hex format
 */
export function generateToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex')
}

// =============================================================================
// Workspace DEK (Data Encryption Key) Functions
// =============================================================================

/**
 * Generate a new Data Encryption Key for a workspace
 * @returns Encrypted DEK ready to store in database
 */
export function generateWorkspaceDEK(): string {
  // Generate a random 256-bit key
  const dek = crypto.randomBytes(DEK_LENGTH)

  // Encrypt the DEK with the master key
  return encrypt(dek.toString('base64'))
}

/**
 * Decrypt a workspace's DEK
 * @param encryptedDek - The encrypted DEK from database
 * @returns Decrypted DEK as Buffer
 */
function decryptDEK(encryptedDek: string): Buffer {
  const dekBase64 = decrypt(encryptedDek)
  return Buffer.from(dekBase64, 'base64')
}

/**
 * Get workspace DEK, using cache if available
 * @param workspaceId - The workspace UUID
 * @param encryptedDek - The encrypted DEK from database
 * @param keyVersion - The key version for cache validation
 * @returns Decrypted DEK as Buffer
 */
function getWorkspaceDEK(
  workspaceId: string,
  encryptedDek: string,
  keyVersion: number
): Buffer {
  const cached = dekCache.get(workspaceId)
  const now = Date.now()

  // Return cached DEK if valid
  if (cached && cached.version === keyVersion && cached.expiresAt > now) {
    return cached.dek
  }

  // Decrypt and cache
  const dek = decryptDEK(encryptedDek)
  dekCache.set(workspaceId, {
    dek,
    version: keyVersion,
    expiresAt: now + DEK_CACHE_TTL_MS,
  })

  return dek
}

/**
 * Clear cached DEK for a workspace (use after key rotation)
 */
export function clearDEKCache(workspaceId?: string): void {
  if (workspaceId) {
    dekCache.delete(workspaceId)
  } else {
    dekCache.clear()
  }
}

/**
 * Encrypt data using a workspace's DEK
 * Uses AES-256-GCM for authenticated encryption
 *
 * @param workspaceId - The workspace UUID
 * @param encryptedDek - The encrypted DEK from database
 * @param keyVersion - The key version
 * @param plaintext - Data to encrypt
 * @returns Encrypted string in format: v{version}:iv:authTag:ciphertext
 */
export function encryptWithWorkspaceDEK(
  workspaceId: string,
  encryptedDek: string,
  keyVersion: number,
  plaintext: string
): string {
  if (!plaintext) return ''

  const dek = getWorkspaceDEK(workspaceId, encryptedDek, keyVersion)
  const iv = crypto.randomBytes(IV_LENGTH)

  const cipher = crypto.createCipheriv(ALGORITHM, dek, iv)
  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  const authTag = cipher.getAuthTag()

  // Include version for future key rotation
  return [
    `v${keyVersion}`,
    iv.toString('hex'),
    authTag.toString('hex'),
    encrypted,
  ].join(':')
}

/**
 * Decrypt data using a workspace's DEK
 *
 * @param workspaceId - The workspace UUID
 * @param encryptedDek - The encrypted DEK from database
 * @param keyVersion - Current key version (for cache)
 * @param ciphertext - Encrypted string from encryptWithWorkspaceDEK
 * @returns Decrypted plaintext
 */
export function decryptWithWorkspaceDEK(
  workspaceId: string,
  encryptedDek: string,
  keyVersion: number,
  ciphertext: string
): string {
  if (!ciphertext) return ''

  const parts = ciphertext.split(':')
  if (parts.length !== 4) {
    throw new Error('Invalid encrypted data format')
  }

  const [versionStr, ivHex, authTagHex, encryptedData] = parts

  // Extract version number
  const dataVersion = parseInt(versionStr.replace('v', ''), 10)
  if (isNaN(dataVersion)) {
    throw new Error('Invalid encryption version')
  }

  // Note: In a full implementation, you'd need to handle version mismatches
  // by looking up historical DEKs. For simplicity, we assume same version.
  if (dataVersion !== keyVersion) {
    console.warn(`DEK version mismatch: data=${dataVersion}, current=${keyVersion}`)
    // In production, you'd look up the correct DEK version
  }

  const dek = getWorkspaceDEK(workspaceId, encryptedDek, keyVersion)
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')

  const decipher = crypto.createDecipheriv(ALGORITHM, dek, iv)
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(encryptedData, 'hex', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}

// =============================================================================
// Phone Number Hashing (for matching without revealing PII)
// =============================================================================

/**
 * Normalize a phone number to E.164 format
 * @param phone - Phone number in various formats
 * @returns Normalized E.164 phone number or null if invalid
 */
export function normalizePhoneE164(phone: string): string | null {
  if (!phone) return null

  // Remove all non-digit characters except leading +
  let cleaned = phone.replace(/[^\d+]/g, '')

  // If starts with +, keep it, otherwise assume it needs +
  if (!cleaned.startsWith('+')) {
    // If it's a reasonable length for a phone number, add +
    if (cleaned.length >= 10 && cleaned.length <= 15) {
      cleaned = '+' + cleaned
    } else {
      return null // Invalid phone number
    }
  }

  // Validate E.164 format: + followed by 7-15 digits
  if (/^\+[1-9]\d{6,14}$/.test(cleaned)) {
    return cleaned
  }

  return null
}

/**
 * Hash a phone number for storage/matching
 * Uses SHA-256 for one-way hashing
 *
 * @param phone - Phone number (will be normalized first)
 * @returns SHA-256 hash of normalized E.164 number, or null if invalid
 */
export function hashPhoneE164(phone: string): string | null {
  const normalized = normalizePhoneE164(phone)
  if (!normalized) return null

  return crypto.createHash('sha256').update(normalized).digest('hex')
}

/**
 * Check if two phone numbers match (normalized comparison)
 * @param phone1 - First phone number
 * @param phone2 - Second phone number
 * @returns True if they normalize to the same E.164 number
 */
export function phoneNumbersMatch(phone1: string, phone2: string): boolean {
  const norm1 = normalizePhoneE164(phone1)
  const norm2 = normalizePhoneE164(phone2)

  if (!norm1 || !norm2) return false
  return norm1 === norm2
}
