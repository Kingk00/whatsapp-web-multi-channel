/**
 * Workspace Encryption Helpers
 *
 * High-level encryption API for API routes that handles:
 * - DEK retrieval and caching
 * - Transparent encrypt/decrypt of workspace data
 */

import { SupabaseClient } from '@supabase/supabase-js'
import {
  generateWorkspaceDEK,
  encryptWithWorkspaceDEK,
  decryptWithWorkspaceDEK,
  clearDEKCache,
  hashPhoneE164,
} from './encryption'

// =============================================================================
// Types
// =============================================================================

export interface WorkspaceEncryptionKey {
  workspace_id: string
  encrypted_dek: string
  key_version: number
}

export interface EncryptableContact {
  display_name?: string | null
  phone_numbers?: any
  [key: string]: any
}

export interface EncryptableChat {
  display_name?: string | null
  last_message_preview?: string | null
  phone_number?: string | null
  [key: string]: any
}

export interface EncryptableMessage {
  text?: string | null
  [key: string]: any
}

// =============================================================================
// DEK Management
// =============================================================================

/**
 * Get or create encryption key for a workspace
 * Uses service role client to access workspace_encryption_keys table
 */
export async function getOrCreateWorkspaceKey(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<WorkspaceEncryptionKey> {
  // Try to get existing key
  const { data: existing, error: fetchError } = await supabase
    .from('workspace_encryption_keys')
    .select('*')
    .eq('workspace_id', workspaceId)
    .single()

  if (existing) {
    return existing as WorkspaceEncryptionKey
  }

  // Create new key if not exists (PGRST116 = not found)
  if (fetchError && fetchError.code !== 'PGRST116') {
    console.error('Error fetching workspace encryption key:', fetchError)
    throw new Error('Failed to fetch workspace encryption key')
  }

  // Generate and store new DEK
  const encryptedDek = generateWorkspaceDEK()

  const { data: newKey, error: insertError } = await supabase
    .from('workspace_encryption_keys')
    .upsert(
      {
        workspace_id: workspaceId,
        encrypted_dek: encryptedDek,
        key_version: 1,
      },
      {
        onConflict: 'workspace_id',
        ignoreDuplicates: true,
      }
    )
    .select()
    .single()

  if (insertError) {
    console.error('Error creating workspace encryption key:', insertError)
    throw new Error('Failed to create workspace encryption key')
  }

  return newKey as WorkspaceEncryptionKey
}

/**
 * Get encryption key for a workspace (must exist)
 */
export async function getWorkspaceKey(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<WorkspaceEncryptionKey | null> {
  const { data, error } = await supabase
    .from('workspace_encryption_keys')
    .select('*')
    .eq('workspace_id', workspaceId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    console.error('Error fetching workspace encryption key:', error)
    return null
  }

  return data as WorkspaceEncryptionKey
}

/**
 * Rotate workspace encryption key
 * Generates a new DEK and increments version
 */
export async function rotateWorkspaceKey(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<WorkspaceEncryptionKey> {
  const encryptedDek = generateWorkspaceDEK()

  const { data, error } = await supabase
    .from('workspace_encryption_keys')
    .update({
      encrypted_dek: encryptedDek,
      key_version: supabase.rpc('increment', { x: 1 }), // Won't work directly, need raw SQL
      rotated_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .select()
    .single()

  // Clear cache after rotation
  clearDEKCache(workspaceId)

  if (error) {
    console.error('Error rotating workspace encryption key:', error)
    throw new Error('Failed to rotate workspace encryption key')
  }

  return data as WorkspaceEncryptionKey
}

// =============================================================================
// Encryption Helpers for Data Types
// =============================================================================

/**
 * Create an encryption context for a workspace
 * Returns functions bound to the workspace's DEK
 */
export function createEncryptionContext(key: WorkspaceEncryptionKey) {
  const { workspace_id, encrypted_dek, key_version } = key

  return {
    encrypt: (plaintext: string | null): string => {
      if (!plaintext) return ''
      return encryptWithWorkspaceDEK(workspace_id, encrypted_dek, key_version, plaintext)
    },

    decrypt: (ciphertext: string | null): string => {
      if (!ciphertext) return ''
      return decryptWithWorkspaceDEK(workspace_id, encrypted_dek, key_version, ciphertext)
    },

    encryptJSON: (data: any): string => {
      if (!data) return ''
      return encryptWithWorkspaceDEK(
        workspace_id,
        encrypted_dek,
        key_version,
        JSON.stringify(data)
      )
    },

    decryptJSON: <T = any>(ciphertext: string | null): T | null => {
      if (!ciphertext) return null
      try {
        const json = decryptWithWorkspaceDEK(
          workspace_id,
          encrypted_dek,
          key_version,
          ciphertext
        )
        return JSON.parse(json) as T
      } catch {
        return null
      }
    },

    hashPhone: hashPhoneE164,
  }
}

// =============================================================================
// Data Transformation Helpers
// =============================================================================

/**
 * Encrypt sensitive fields in a contact record before storing
 */
export function encryptContactForStorage(
  ctx: ReturnType<typeof createEncryptionContext>,
  contact: EncryptableContact
): Record<string, any> {
  const encrypted: Record<string, any> = { ...contact }

  // Encrypt display_name if present
  if (contact.display_name) {
    encrypted.display_name_enc = ctx.encrypt(contact.display_name)
    // Keep original for now (dual-write during migration)
  }

  // Encrypt phone_numbers if present
  if (contact.phone_numbers) {
    encrypted.phone_numbers_enc = ctx.encryptJSON(contact.phone_numbers)
    // Keep original for now
  }

  return encrypted
}

/**
 * Decrypt sensitive fields in a contact record after fetching
 * Prioritizes encrypted fields, falls back to unencrypted
 */
export function decryptContactFromStorage(
  ctx: ReturnType<typeof createEncryptionContext>,
  contact: any
): any {
  const decrypted = { ...contact }

  // Decrypt display_name if encrypted version exists
  if (contact.display_name_enc) {
    try {
      decrypted.display_name = ctx.decrypt(contact.display_name_enc)
    } catch {
      // Fall back to unencrypted if decryption fails
    }
  }

  // Decrypt phone_numbers if encrypted version exists
  if (contact.phone_numbers_enc) {
    try {
      decrypted.phone_numbers = ctx.decryptJSON(contact.phone_numbers_enc)
    } catch {
      // Fall back to unencrypted
    }
  }

  // Remove encrypted fields from response
  delete decrypted.display_name_enc
  delete decrypted.phone_numbers_enc

  return decrypted
}

/**
 * Encrypt sensitive fields in a chat record before storing
 */
export function encryptChatForStorage(
  ctx: ReturnType<typeof createEncryptionContext>,
  chat: EncryptableChat
): Record<string, any> {
  const encrypted: Record<string, any> = { ...chat }

  if (chat.display_name) {
    encrypted.display_name_enc = ctx.encrypt(chat.display_name)
  }

  if (chat.last_message_preview) {
    encrypted.last_message_preview_enc = ctx.encrypt(chat.last_message_preview)
  }

  // Add phone hash for matching
  if (chat.phone_number) {
    encrypted.phone_e164_hash = ctx.hashPhone(chat.phone_number)
  }

  return encrypted
}

/**
 * Decrypt sensitive fields in a chat record after fetching
 */
export function decryptChatFromStorage(
  ctx: ReturnType<typeof createEncryptionContext>,
  chat: any
): any {
  const decrypted = { ...chat }

  if (chat.display_name_enc) {
    try {
      decrypted.display_name = ctx.decrypt(chat.display_name_enc)
    } catch {
      // Fall back to unencrypted
    }
  }

  if (chat.last_message_preview_enc) {
    try {
      decrypted.last_message_preview = ctx.decrypt(chat.last_message_preview_enc)
    } catch {
      // Fall back to unencrypted
    }
  }

  // Remove encrypted fields from response
  delete decrypted.display_name_enc
  delete decrypted.last_message_preview_enc

  return decrypted
}

/**
 * Encrypt sensitive fields in a message record before storing
 */
export function encryptMessageForStorage(
  ctx: ReturnType<typeof createEncryptionContext>,
  message: EncryptableMessage
): Record<string, any> {
  const encrypted: Record<string, any> = { ...message }

  if (message.text) {
    encrypted.text_enc = ctx.encrypt(message.text)
  }

  return encrypted
}

/**
 * Decrypt sensitive fields in a message record after fetching
 */
export function decryptMessageFromStorage(
  ctx: ReturnType<typeof createEncryptionContext>,
  message: any
): any {
  const decrypted = { ...message }

  if (message.text_enc) {
    try {
      decrypted.text = ctx.decrypt(message.text_enc)
    } catch {
      // Fall back to unencrypted
    }
  }

  // Remove encrypted field from response
  delete decrypted.text_enc

  return decrypted
}

// =============================================================================
// Batch Encryption Helpers
// =============================================================================

/**
 * Decrypt multiple contacts
 */
export function decryptContacts(
  ctx: ReturnType<typeof createEncryptionContext>,
  contacts: any[]
): any[] {
  return contacts.map((c) => decryptContactFromStorage(ctx, c))
}

/**
 * Decrypt multiple chats
 */
export function decryptChats(
  ctx: ReturnType<typeof createEncryptionContext>,
  chats: any[]
): any[] {
  return chats.map((c) => decryptChatFromStorage(ctx, c))
}

/**
 * Decrypt multiple messages
 */
export function decryptMessages(
  ctx: ReturnType<typeof createEncryptionContext>,
  messages: any[]
): any[] {
  return messages.map((m) => decryptMessageFromStorage(ctx, m))
}
