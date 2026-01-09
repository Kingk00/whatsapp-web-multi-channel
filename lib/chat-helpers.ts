/**
 * Chat Helpers
 *
 * Utilities for managing chats, including auto-creation from webhook events.
 * Chats are automatically created when a message arrives for a new contact.
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { normalizePhoneNumber } from '@/lib/phone-utils'

// ============================================================================
// Types
// ============================================================================

export interface ChannelInfo {
  id: string
  workspace_id: string
  status: string
}

export interface Chat {
  id: string
  workspace_id: string
  channel_id: string
  wa_chat_id: string
  is_group: boolean
  display_name: string | null
  phone_number: string | null
  profile_photo_url: string | null
  group_participants: any | null
  last_message_at: string | null
  last_message_preview: string | null
  unread_count: number
  is_archived: boolean
  created_at: string
  updated_at: string
}

export interface MessageData {
  from?: string
  to?: string
  from_me?: boolean
  fromMe?: boolean
  chat_id?: string
  chatId?: string
  sender?: {
    id?: string
    name?: string
    pushname?: string
    profile_photo?: string
    thumbnail?: string
  }
  pushname?: string
  notifyName?: string
  // Profile photo from various Whapi formats
  profile_photo?: string
  thumbnail?: string
  contact?: {
    profile_photo?: string
    thumbnail?: string
  }
  chat?: {
    id?: string
    name?: string
    is_group?: boolean
    isGroup?: boolean
    participants?: any[]
    profile_photo?: string
    thumbnail?: string
  }
  // Group-specific
  isGroup?: boolean
  is_group?: boolean
  group?: {
    id?: string
    name?: string
    participants?: any[]
    profile_photo?: string
    thumbnail?: string
  }
}

export interface UpdateChatOptions {
  text: string | null
  timestamp: string
  incrementUnread?: boolean
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Get an existing chat or create a new one
 *
 * @param supabase - Supabase client (service role)
 * @param channel - Channel info
 * @param waChatId - WhatsApp chat ID
 * @param messageData - Message data for extracting contact info
 * @returns The chat record
 */
export async function getOrCreateChat(
  supabase: SupabaseClient,
  channel: ChannelInfo,
  waChatId: string,
  messageData: MessageData
): Promise<Chat | null> {
  // First, try to get existing chat
  const { data: existingChat, error: fetchError } = await supabase
    .from('chats')
    .select('*')
    .eq('channel_id', channel.id)
    .eq('wa_chat_id', waChatId)
    .single()

  if (existingChat) {
    // Update contact info if we have newer data
    await updateChatContactInfo(supabase, existingChat, messageData)
    return existingChat as Chat
  }

  // Chat doesn't exist, create it
  if (fetchError && fetchError.code !== 'PGRST116') {
    // PGRST116 = not found, which is expected
    console.error('Error fetching chat:', fetchError)
    return null
  }

  // Extract contact information from message data
  const contactInfo = extractContactInfo(waChatId, messageData)

  // Compute phone hash for auto-linking to contacts
  // Uses the same normalization as contacts API for consistent matching
  const normalizedPhone = contactInfo.phoneNumber ? normalizePhoneNumber(contactInfo.phoneNumber) : null
  const phoneHash = normalizedPhone ? createHash('sha256').update(normalizedPhone).digest('hex') : null

  // Create new chat record
  const newChat = {
    workspace_id: channel.workspace_id,
    channel_id: channel.id,
    wa_chat_id: waChatId,
    is_group: contactInfo.isGroup,
    display_name: contactInfo.displayName,
    phone_number: contactInfo.phoneNumber,
    phone_e164_hash: phoneHash, // Enables auto-linking to contacts via trigger
    profile_photo_url: contactInfo.profilePhotoUrl,
    group_participants: contactInfo.groupParticipants,
    last_message_at: new Date().toISOString(),
    unread_count: 0,
    is_archived: false,
  }

  const { data: createdChat, error: createError } = await supabase
    .from('chats')
    .upsert(newChat, {
      onConflict: 'channel_id,wa_chat_id',
      ignoreDuplicates: false,
    })
    .select()
    .single()

  if (createError) {
    console.error('Error creating chat:', createError)
    return null
  }

  return createdChat as Chat
}

/**
 * Update chat's last message information
 *
 * @param supabase - Supabase client
 * @param chatId - Chat UUID
 * @param options - Update options
 */
export async function updateChatLastMessage(
  supabase: SupabaseClient,
  chatId: string,
  options: UpdateChatOptions
): Promise<void> {
  const { text, timestamp, incrementUnread = false } = options

  // Truncate preview text
  const preview = text ? truncateText(text, 100) : null

  // Build update object
  const updateData: Record<string, any> = {
    last_message_at: timestamp,
    last_message_preview: preview,
    updated_at: new Date().toISOString(),
  }

  // Handle unread count - either increment or keep as is
  // We use a raw SQL approach for atomic increment
  if (incrementUnread) {
    // Use RPC or raw query for atomic increment
    const { error } = await supabase.rpc('increment_chat_unread', {
      chat_id: chatId,
      preview_text: preview,
      message_time: timestamp,
    })

    if (error) {
      // Fallback: just update without increment if RPC doesn't exist
      console.warn('increment_chat_unread RPC not found, using fallback')
      await supabase.from('chats').update(updateData).eq('id', chatId)
    }
  } else {
    await supabase.from('chats').update(updateData).eq('id', chatId)
  }
}

/**
 * Mark chat as read (reset unread count)
 *
 * @param supabase - Supabase client
 * @param chatId - Chat UUID
 */
export async function markChatAsRead(
  supabase: SupabaseClient,
  chatId: string
): Promise<void> {
  await supabase
    .from('chats')
    .update({
      unread_count: 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', chatId)
}

/**
 * Get chat by WhatsApp chat ID
 *
 * @param supabase - Supabase client
 * @param channelId - Channel UUID
 * @param waChatId - WhatsApp chat ID
 * @returns Chat record or null
 */
export async function getChatByWaId(
  supabase: SupabaseClient,
  channelId: string,
  waChatId: string
): Promise<Chat | null> {
  const { data, error } = await supabase
    .from('chats')
    .select('*')
    .eq('channel_id', channelId)
    .eq('wa_chat_id', waChatId)
    .single()

  if (error) {
    if (error.code !== 'PGRST116') {
      console.error('Error fetching chat by WA ID:', error)
    }
    return null
  }

  return data as Chat
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract contact information from message data
 */
function extractContactInfo(
  waChatId: string,
  messageData: MessageData
): {
  isGroup: boolean
  displayName: string | null
  phoneNumber: string | null
  profilePhotoUrl: string | null
  groupParticipants: any | null
} {
  // Check if this is a group chat
  const isGroup = isGroupChat(waChatId, messageData)

  // Extract profile photo from various possible locations
  const profilePhoto = extractProfilePhoto(messageData, isGroup)

  if (isGroup) {
    // Group chat
    const groupInfo = messageData.group || messageData.chat
    return {
      isGroup: true,
      displayName:
        groupInfo?.name ||
        messageData.chat?.name ||
        extractGroupName(waChatId) ||
        'Unknown Group',
      phoneNumber: null,
      profilePhotoUrl: profilePhoto,
      groupParticipants: groupInfo?.participants || messageData.chat?.participants || null,
    }
  }

  // Individual chat
  const senderName =
    messageData.sender?.name ||
    messageData.sender?.pushname ||
    messageData.pushname ||
    messageData.notifyName

  return {
    isGroup: false,
    displayName: senderName || formatPhoneNumber(waChatId),
    phoneNumber: extractPhoneNumber(waChatId),
    profilePhotoUrl: profilePhoto,
    groupParticipants: null,
  }
}

/**
 * Extract profile photo URL from message data
 */
function extractProfilePhoto(messageData: MessageData, isGroup: boolean): string | null {
  // Try various locations where Whapi might include the profile photo
  if (isGroup) {
    // Group photos
    return (
      messageData.group?.profile_photo ||
      messageData.group?.thumbnail ||
      messageData.chat?.profile_photo ||
      messageData.chat?.thumbnail ||
      null
    )
  }

  // Individual contact photos
  return (
    messageData.sender?.profile_photo ||
    messageData.sender?.thumbnail ||
    messageData.profile_photo ||
    messageData.thumbnail ||
    messageData.contact?.profile_photo ||
    messageData.contact?.thumbnail ||
    null
  )
}

/**
 * Check if a chat is a group chat
 */
function isGroupChat(waChatId: string, messageData: MessageData): boolean {
  // Explicit flags
  if (messageData.is_group || messageData.isGroup) return true
  if (messageData.chat?.is_group || messageData.chat?.isGroup) return true
  if (messageData.group) return true

  // WhatsApp group IDs end with @g.us
  if (waChatId.endsWith('@g.us')) return true

  // Individual chats end with @c.us or @s.whatsapp.net
  if (waChatId.endsWith('@c.us') || waChatId.endsWith('@s.whatsapp.net')) return false

  return false
}

/**
 * Extract phone number from WhatsApp ID
 * WhatsApp IDs are typically in format: {countrycode}{number}@c.us
 */
function extractPhoneNumber(waId: string): string | null {
  if (!waId) return null

  // Remove the @c.us or @s.whatsapp.net suffix
  const cleaned = waId.replace(/@(c\.us|s\.whatsapp\.net|g\.us)$/, '')

  // Return as E.164 format (with + prefix)
  if (cleaned && /^\d+$/.test(cleaned)) {
    return `+${cleaned}`
  }

  return cleaned || null
}

/**
 * Format phone number for display
 */
function formatPhoneNumber(waId: string): string {
  const phone = extractPhoneNumber(waId)
  return phone || waId
}

/**
 * Extract group name from group ID if possible
 */
function extractGroupName(waChatId: string): string | null {
  // Group IDs don't contain the name, return null
  return null
}

/**
 * Update existing chat with newer contact information
 */
async function updateChatContactInfo(
  supabase: SupabaseClient,
  chat: Chat,
  messageData: MessageData
): Promise<void> {
  const updates: Record<string, any> = {}

  // Extract potential new info
  const senderName =
    messageData.sender?.name ||
    messageData.sender?.pushname ||
    messageData.pushname ||
    messageData.notifyName

  // Update display name if we have a better one
  if (senderName && (!chat.display_name || chat.display_name.startsWith('+'))) {
    updates.display_name = senderName
  }

  // Update profile photo if we have one and chat doesn't
  if (!chat.profile_photo_url) {
    const profilePhoto = extractProfilePhoto(messageData, chat.is_group)
    if (profilePhoto) {
      updates.profile_photo_url = profilePhoto
    }
  }

  // Update group participants if available
  if (chat.is_group) {
    const newParticipants =
      messageData.group?.participants || messageData.chat?.participants
    if (newParticipants && newParticipants.length > 0) {
      updates.group_participants = newParticipants
    }
  }

  // Only update if we have changes
  if (Object.keys(updates).length > 0) {
    updates.updated_at = new Date().toISOString()
    await supabase.from('chats').update(updates).eq('id', chat.id)
  }
}

/**
 * Truncate text to a maximum length
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength - 3) + '...'
}

// ============================================================================
// Display Name Priority Functions
// ============================================================================

interface ContactInfo {
  display_name: string
}

interface ChatWithContact {
  display_name?: string | null
  wa_display_name?: string | null
  phone_number?: string | null
  contact?: ContactInfo | null
}

/**
 * Get the display name for a chat based on priority:
 * 1. Linked contact name
 * 2. Phone number (formatted)
 * 3. WhatsApp display name (fallback)
 *
 * This implements the user's requirement that saved contact names
 * should be shown instead of WhatsApp names.
 */
export function getDisplayName(chat: ChatWithContact): string {
  // Priority 1: Linked contact name
  if (chat.contact?.display_name) {
    return chat.contact.display_name
  }

  // Priority 2: Phone number (formatted nicely)
  if (chat.phone_number) {
    return formatPhoneForDisplay(chat.phone_number)
  }

  // Priority 3: WhatsApp display name
  if (chat.wa_display_name) {
    return chat.wa_display_name
  }

  // Fallback: original display_name or Unknown
  return chat.display_name || 'Unknown'
}

/**
 * Format a phone number for display
 * Handles various formats and tries to make them readable
 */
export function formatPhoneForDisplay(phone: string): string {
  if (!phone) return ''

  // Remove any non-digit except leading +
  const cleaned = phone.replace(/[^\d+]/g, '')

  // If it starts with +1 (US/Canada), format as (XXX) XXX-XXXX
  if (cleaned.startsWith('+1') && cleaned.length === 12) {
    const areaCode = cleaned.slice(2, 5)
    const firstPart = cleaned.slice(5, 8)
    const lastPart = cleaned.slice(8, 12)
    return `+1 (${areaCode}) ${firstPart}-${lastPart}`
  }

  // If it starts with +, format with spaces
  if (cleaned.startsWith('+') && cleaned.length > 5) {
    const countryCode = cleaned.slice(0, cleaned.length > 12 ? 3 : 2)
    const rest = cleaned.slice(countryCode.length)
    // Add space every 3-4 digits
    const formatted = rest.replace(/(\d{3,4})(?=\d)/g, '$1 ')
    return `${countryCode} ${formatted}`
  }

  // Return as-is if we can't format
  return phone
}

/**
 * Get a short version of the phone number (for compact displays)
 */
export function getShortPhoneNumber(phone: string): string {
  if (!phone) return ''
  const cleaned = phone.replace(/[^\d+]/g, '')
  // Show last 4 digits with ellipsis
  if (cleaned.length > 4) {
    return `...${cleaned.slice(-4)}`
  }
  return cleaned
}

/**
 * Check if two phone numbers match (normalized comparison)
 */
export function phoneNumbersMatch(phone1: string, phone2: string): boolean {
  const normalize = (p: string) => p.replace(/[^\d]/g, '')
  return normalize(phone1) === normalize(phone2)
}
