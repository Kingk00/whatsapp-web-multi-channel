/**
 * Whapi.cloud API Client
 *
 * Wrapper for Whapi.cloud REST API endpoints.
 * Used for sending messages and managing WhatsApp sessions.
 */

// ============================================================================
// Types
// ============================================================================

export interface WhapiConfig {
  token: string
  baseUrl?: string
}

export interface SendTextOptions {
  to: string
  body: string
  quotedMessageId?: string
}

export interface SendMediaOptions {
  to: string
  mediaUrl: string
  mediaType: 'image' | 'video' | 'document' | 'audio'
  caption?: string
  filename?: string
}

export interface WhapiMessageResponse {
  sent: boolean
  message?: {
    id: string
    status: string
    timestamp: number
  }
  error?: string
}

export interface WhapiHealthResponse {
  status: string
  connected: boolean
  phone?: string
  name?: string
}

export interface WhapiError {
  status: number
  message: string
  code?: string
}

// Contact types
export interface WhapiContact {
  id: string
  name?: string
  pushname?: string
  saved?: boolean
  type?: string
  // Additional fields that may be returned by Whapi
  [key: string]: any
}

export interface WhapiContactsResponse {
  contacts: WhapiContact[]
  count?: number
  total?: number
}

export interface CreateContactRequest {
  phone: string
  name: string
}

export interface UpdateContactRequest {
  name: string
}

// ============================================================================
// Client Class
// ============================================================================

export class WhapiClient {
  private token: string
  private baseUrl: string

  constructor(config: WhapiConfig) {
    this.token = config.token
    this.baseUrl = config.baseUrl || 'https://gate.whapi.cloud'
  }

  /**
   * Make authenticated request to Whapi API
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`

    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })

    const data = await response.json()

    if (!response.ok) {
      const error: WhapiError = {
        status: response.status,
        message: data.message || data.error || 'Unknown error',
        code: data.code,
      }
      throw error
    }

    return data
  }

  /**
   * Check channel health/connection status
   */
  async getHealth(): Promise<WhapiHealthResponse> {
    return this.request<WhapiHealthResponse>('/health')
  }

  /**
   * Get profile photo URL for a contact or chat
   * @param contactId - Phone number or chat ID (e.g., "1234567890" or "1234567890@s.whatsapp.net")
   */
  async getProfilePhoto(contactId: string): Promise<{ avatar?: string; icon?: string }> {
    // Normalize contact ID - remove @s.whatsapp.net suffix if present
    const normalizedId = contactId.replace(/@s\.whatsapp\.net$/, '').replace(/@g\.us$/, '')
    return this.request<{ avatar?: string; icon?: string }>(`/contacts/${normalizedId}/profile`)
  }

  /**
   * Send text message
   */
  async sendText(options: SendTextOptions): Promise<WhapiMessageResponse> {
    const body: Record<string, any> = {
      to: options.to,
      body: options.body,
    }

    if (options.quotedMessageId) {
      body.quoted = options.quotedMessageId
    }

    return this.request<WhapiMessageResponse>('/messages/text', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  /**
   * Send image message
   */
  async sendImage(
    to: string,
    mediaUrl: string,
    caption?: string
  ): Promise<WhapiMessageResponse> {
    return this.request<WhapiMessageResponse>('/messages/image', {
      method: 'POST',
      body: JSON.stringify({
        to,
        media: mediaUrl,
        caption,
      }),
    })
  }

  /**
   * Send video message
   */
  async sendVideo(
    to: string,
    mediaUrl: string,
    caption?: string
  ): Promise<WhapiMessageResponse> {
    return this.request<WhapiMessageResponse>('/messages/video', {
      method: 'POST',
      body: JSON.stringify({
        to,
        media: mediaUrl,
        caption,
      }),
    })
  }

  /**
   * Send document message
   */
  async sendDocument(
    to: string,
    mediaUrl: string,
    filename?: string,
    caption?: string
  ): Promise<WhapiMessageResponse> {
    return this.request<WhapiMessageResponse>('/messages/document', {
      method: 'POST',
      body: JSON.stringify({
        to,
        media: mediaUrl,
        filename,
        caption,
      }),
    })
  }

  /**
   * Send audio message
   */
  async sendAudio(to: string, mediaUrl: string): Promise<WhapiMessageResponse> {
    return this.request<WhapiMessageResponse>('/messages/audio', {
      method: 'POST',
      body: JSON.stringify({
        to,
        media: mediaUrl,
      }),
    })
  }

  /**
   * Delete message (for everyone)
   */
  async deleteMessage(messageId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/messages/${messageId}`, {
      method: 'DELETE',
    })
  }

  /**
   * Mark messages as read
   */
  async markAsRead(chatId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>('/messages/read', {
      method: 'POST',
      body: JSON.stringify({
        chat_id: chatId,
      }),
    })
  }

  /**
   * Get chat list
   */
  async getChats(limit = 100): Promise<any[]> {
    const response = await this.request<{ chats: any[] }>(
      `/chats?limit=${limit}`
    )
    return response.chats || []
  }

  /**
   * Get messages from a chat
   */
  async getMessages(chatId: string, limit = 50): Promise<any[]> {
    const response = await this.request<{ messages: any[] }>(
      `/messages/list?chatId=${chatId}&limit=${limit}`
    )
    return response.messages || []
  }

  // ==========================================================================
  // Contact Methods
  // ==========================================================================

  /**
   * Get all contacts from WhatsApp
   */
  async getContacts(count = 1000, offset = 0): Promise<WhapiContact[]> {
    const response = await this.request<WhapiContactsResponse>(
      `/contacts?count=${count}&offset=${offset}`
    )
    return response.contacts || []
  }

  /**
   * Add a new contact to WhatsApp
   */
  async createContact(data: CreateContactRequest): Promise<WhapiContact> {
    return this.request<WhapiContact>('/contacts', {
      method: 'PUT',
      body: JSON.stringify({
        phone: data.phone,
        name: data.name,
      }),
    })
  }

  /**
   * Update a contact's name in WhatsApp
   */
  async updateContact(contactId: string, data: UpdateContactRequest): Promise<WhapiContact> {
    return this.request<WhapiContact>(`/contacts/${contactId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: data.name,
      }),
    })
  }

  /**
   * Delete a contact from WhatsApp
   */
  async deleteContact(contactId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/contacts/${contactId}`, {
      method: 'DELETE',
    })
  }

  // ==========================================================================
  // Google Contacts Integration Methods
  // ==========================================================================

  /**
   * Note: Google Contacts integration only supports ADDING contacts.
   * To fetch contacts, use the regular getContacts() method which returns
   * all WhatsApp contacts including saved ones (marked with saved: true).
   */

  /**
   * Add contacts to Google Contacts via Whapi integration
   * @param googleToken - The Google Contacts connection token
   * @param contacts - Array of contacts to add
   */
  async addGoogleContacts(
    googleToken: string,
    contacts: Array<{ phone: string; name: string }>
  ): Promise<{ success: boolean }> {
    const response = await fetch('https://tools.whapi.cloud/integrations/google_people/addContacts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        token: googleToken,
        contacts,
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || 'Failed to add Google contacts')
    }

    return { success: true }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a Whapi client with decrypted token
 */
export function createWhapiClient(decryptedToken: string): WhapiClient {
  return new WhapiClient({ token: decryptedToken })
}

// ============================================================================
// Error Helpers
// ============================================================================

/**
 * Check if error is a rate limit (429)
 */
export function isRateLimitError(error: any): boolean {
  return error?.status === 429
}

/**
 * Check if error is retryable (5xx or network error)
 */
export function isRetryableError(error: any): boolean {
  if (!error?.status) return true // Network error, retry
  return error.status >= 500 || error.status === 429
}

/**
 * Get recommended retry delay based on error
 */
export function getRetryDelay(error: any, attempt: number): number {
  // If rate limited, check for Retry-After header
  if (error?.retryAfter) {
    return parseInt(error.retryAfter, 10) * 1000
  }

  // Exponential backoff: 1min, 2min, 4min, 8min, 16min
  return Math.pow(2, attempt - 1) * 60 * 1000
}
