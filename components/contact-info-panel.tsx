'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

interface PhoneNumber {
  number: string
  type?: string
  normalized?: string
}

interface EmailAddress {
  email: string
  type?: string
}

interface Contact {
  id: string
  display_name: string
  phone_numbers: PhoneNumber[]
  email_addresses: EmailAddress[]
  tags: string[]
}

interface Channel {
  id: string
  name: string
  color: string | null
  status: string
}

interface ChatDetails {
  id: string
  display_name: string | null
  phone_number: string | null
  profile_photo_url: string | null
  is_group: boolean
  is_archived: boolean
  is_muted: boolean
  contact_id: string | null
  contact: Contact | null
  channel: Channel | Channel[] | null
  message_count: number
  created_at: string
}

interface ContactInfoPanelProps {
  chatId: string
  onClose: () => void
}

export function ContactInfoPanel({ chatId, onClose }: ContactInfoPanelProps) {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const [showContactForm, setShowContactForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Contact form state
  const [contactForm, setContactForm] = useState({
    display_name: '',
    phone_number: '',
    email: '',
    tags: '',
  })

  const { data: chat, isLoading, refetch } = useQuery<ChatDetails>({
    queryKey: ['chat-details', chatId],
    queryFn: async () => {
      const response = await fetch(`/api/chats/${chatId}`)
      if (!response.ok) throw new Error('Failed to fetch chat')
      return response.json()
    },
  })

  // Extract channel from the response (could be array or single object)
  const channel = chat?.channel
    ? Array.isArray(chat.channel)
      ? chat.channel[0]
      : chat.channel
    : null

  const displayName = chat?.display_name || chat?.phone_number || 'Unknown'

  // Open contact form with pre-filled data
  const openContactForm = () => {
    if (chat?.contact) {
      // Edit existing contact
      setContactForm({
        display_name: chat.contact.display_name || '',
        phone_number: chat.contact.phone_numbers?.[0]?.number || chat.phone_number || '',
        email: chat.contact.email_addresses?.[0]?.email || '',
        tags: chat.contact.tags?.join(', ') || '',
      })
    } else {
      // Add new contact
      setContactForm({
        display_name: chat?.display_name || '',
        phone_number: chat?.phone_number || '',
        email: '',
        tags: '',
      })
    }
    setFormError(null)
    setShowContactForm(true)
  }

  // Save contact (create or update)
  const saveContact = async () => {
    if (!contactForm.display_name.trim()) {
      setFormError('Display name is required')
      return
    }

    setSaving(true)
    setFormError(null)

    try {
      const phoneNumbers = contactForm.phone_number.trim()
        ? [{ number: contactForm.phone_number.trim(), type: 'mobile' }]
        : []
      const emailAddresses = contactForm.email.trim()
        ? [{ email: contactForm.email.trim(), type: 'personal' }]
        : []
      const tags = contactForm.tags.trim()
        ? contactForm.tags.split(',').map(t => t.trim()).filter(Boolean)
        : []

      if (chat?.contact) {
        // Update existing contact
        const response = await fetch(`/api/contacts/${chat.contact.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            display_name: contactForm.display_name.trim(),
            phone_numbers: phoneNumbers,
            email_addresses: emailAddresses,
            tags,
          }),
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || 'Failed to update contact')
        }
      } else {
        // Create new contact and link to chat
        const response = await fetch('/api/contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            display_name: contactForm.display_name.trim(),
            phone_numbers: phoneNumbers,
            email_addresses: emailAddresses,
            tags,
            link_chat_id: chatId, // Link this contact to the chat
          }),
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || 'Failed to create contact')
        }
      }

      // Refresh chat data
      await refetch()
      queryClient.invalidateQueries({ queryKey: ['chats'] })
      setShowContactForm(false)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to save contact')
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return (
      <aside className="hidden w-80 border-l border-gray-200 bg-white lg:flex lg:flex-col">
        <div className="flex h-16 items-center justify-between border-b border-gray-200 px-4">
          <h2 className="font-semibold">Contact Info</h2>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-pulse text-gray-400">Loading...</div>
        </div>
      </aside>
    )
  }

  return (
    <aside className="hidden w-80 border-l border-gray-200 bg-white lg:flex lg:flex-col">
      {/* Header */}
      <div className="flex h-16 items-center justify-between border-b border-gray-200 px-4">
        <h2 className="font-semibold">Contact Info</h2>
        <button
          onClick={onClose}
          className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Profile section */}
        <div className="flex flex-col items-center border-b border-gray-100 bg-gray-50 py-8 px-4">
          {/* Avatar */}
          {chat?.profile_photo_url ? (
            <img
              src={chat.profile_photo_url}
              alt={displayName}
              className="h-32 w-32 rounded-full object-cover border-4 border-white shadow-lg"
            />
          ) : (
            <div
              className={cn(
                'flex h-32 w-32 items-center justify-center rounded-full text-4xl font-bold text-white border-4 border-white shadow-lg',
                chat?.is_group ? 'bg-blue-500' : 'bg-gray-400'
              )}
            >
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}

          {/* Name */}
          <h3 className="mt-4 text-xl font-semibold text-gray-900">{displayName}</h3>

          {/* Phone number */}
          {chat?.phone_number && (
            <a
              href={`tel:${chat.phone_number}`}
              className="mt-1 text-sm text-gray-500 hover:text-green-600 hover:underline"
            >
              {formatPhoneNumber(chat.phone_number)}
            </a>
          )}

          {/* Group badge */}
          {chat?.is_group && (
            <span className="mt-2 inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-800">
              <svg className="mr-1 h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              Group Chat
            </span>
          )}
        </div>

        {/* Channel info */}
        {channel && (
          <div className="border-b border-gray-100 px-4 py-4">
            <h4 className="mb-2 text-xs font-semibold uppercase text-gray-400">Channel</h4>
            <div className="flex items-center gap-2">
              <div
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: channel.color || '#10b981' }}
              />
              <span className="text-sm font-medium text-gray-900">{channel.name}</span>
              <span
                className={cn(
                  'ml-auto rounded-full px-2 py-0.5 text-xs',
                  channel.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                )}
              >
                {channel.status}
              </span>
            </div>
          </div>
        )}

        {/* Linked contact info */}
        {chat?.contact && (
          <div className="border-b border-gray-100 px-4 py-4">
            <h4 className="mb-3 text-xs font-semibold uppercase text-gray-400">Linked Contact</h4>

            {/* Contact name */}
            <div className="mb-3">
              <span className="text-sm font-medium text-gray-900">{chat.contact.display_name}</span>
            </div>

            {/* Phone numbers */}
            {chat.contact.phone_numbers && chat.contact.phone_numbers.length > 0 && (
              <div className="mb-3">
                <span className="text-xs text-gray-500 uppercase">Phone Numbers</span>
                <div className="mt-1 space-y-1">
                  {chat.contact.phone_numbers.map((phone, i) => (
                    <a
                      key={i}
                      href={`tel:${phone.number}`}
                      className="flex items-center gap-2 text-sm text-gray-700 hover:text-green-600"
                    >
                      <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                      </svg>
                      {formatPhoneNumber(phone.number)}
                      {phone.type && (
                        <span className="text-xs text-gray-400">({phone.type})</span>
                      )}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Email addresses */}
            {chat.contact.email_addresses && chat.contact.email_addresses.length > 0 && (
              <div className="mb-3">
                <span className="text-xs text-gray-500 uppercase">Email Addresses</span>
                <div className="mt-1 space-y-1">
                  {chat.contact.email_addresses.map((email, i) => (
                    <a
                      key={i}
                      href={`mailto:${email.email}`}
                      className="flex items-center gap-2 text-sm text-gray-700 hover:text-green-600"
                    >
                      <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      {email.email}
                      {email.type && (
                        <span className="text-xs text-gray-400">({email.type})</span>
                      )}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Tags */}
            {chat.contact.tags && chat.contact.tags.length > 0 && (
              <div>
                <span className="text-xs text-gray-500 uppercase">Tags</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {chat.contact.tags.map((tag, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Chat metadata */}
        <div className="px-4 py-4">
          <h4 className="mb-3 text-xs font-semibold uppercase text-gray-400">Chat Details</h4>

          <div className="space-y-3">
            {/* Message count */}
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Messages</span>
              <span className="font-medium text-gray-900">{chat?.message_count || 0}</span>
            </div>

            {/* Created date */}
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Chat started</span>
              <span className="font-medium text-gray-900">
                {chat?.created_at ? formatDate(chat.created_at) : '-'}
              </span>
            </div>

            {/* Status indicators */}
            <div className="flex items-center gap-2 pt-2">
              {chat?.is_archived && (
                <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                  <svg className="mr-1 h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                  </svg>
                  Archived
                </span>
              )}
              {chat?.is_muted && (
                <span className="inline-flex items-center rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-700">
                  <svg className="mr-1 h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                  </svg>
                  Muted
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Actions - Add/Edit Contact */}
        {!showContactForm ? (
          <div className="border-t border-gray-100 px-4 py-4">
            <button
              onClick={openContactForm}
              className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {chat?.contact ? 'Edit Contact' : 'Add Contact'}
            </button>
          </div>
        ) : (
          <div className="border-t border-gray-100 px-4 py-4">
            <h4 className="mb-3 text-xs font-semibold uppercase text-gray-400">
              {chat?.contact ? 'Edit Contact' : 'Add Contact'}
            </h4>

            {formError && (
              <div className="mb-3 rounded-md bg-red-50 p-2 text-sm text-red-600">
                {formError}
              </div>
            )}

            <div className="space-y-3">
              {/* Display Name */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  value={contactForm.display_name}
                  onChange={(e) => setContactForm({ ...contactForm, display_name: e.target.value })}
                  className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                  placeholder="Contact name"
                />
              </div>

              {/* Phone Number */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={contactForm.phone_number}
                  onChange={(e) => setContactForm({ ...contactForm, phone_number: e.target.value })}
                  className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                  placeholder="+1234567890"
                />
              </div>

              {/* Email */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={contactForm.email}
                  onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                  className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                  placeholder="email@example.com"
                />
              </div>

              {/* Tags */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Tags (comma-separated)
                </label>
                <input
                  type="text"
                  value={contactForm.tags}
                  onChange={(e) => setContactForm({ ...contactForm, tags: e.target.value })}
                  className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                  placeholder="customer, vip"
                />
              </div>

              {/* Buttons */}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setShowContactForm(false)}
                  className="flex-1 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  onClick={saveContact}
                  disabled={saving}
                  className="flex-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}

/**
 * Format phone number for display
 */
function formatPhoneNumber(phone: string): string {
  // Basic formatting - could be enhanced with libphonenumber
  if (phone.startsWith('+1') && phone.length === 12) {
    return `+1 (${phone.slice(2, 5)}) ${phone.slice(5, 8)}-${phone.slice(8)}`
  }
  return phone
}

/**
 * Format date for display
 */
function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
