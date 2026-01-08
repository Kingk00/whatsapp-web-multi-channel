'use client'

import { useState, useRef, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'

interface Contact {
  id: string
  display_name: string
  phone_numbers: Array<{ number: string; type: string; normalized?: string }>
  email_addresses: Array<{ email: string; type: string }>
  tags: string[]
  source: 'manual' | 'google' | 'csv_import'
  source_metadata?: Record<string, unknown>
  created_at: string
  updated_at: string
}

export default function ContactsSettingsPage() {
  return (
    <Suspense fallback={<ContactsLoadingFallback />}>
      <ContactsSettingsContent />
    </Suspense>
  )
}

function ContactsLoadingFallback() {
  return (
    <div className="flex-1">
      <div className="border-b bg-white">
        <div className="px-8 py-6">
          <h1 className="text-2xl font-semibold text-gray-900">Contacts</h1>
          <p className="text-sm text-gray-500">Loading...</p>
        </div>
      </div>
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-green-500 border-t-transparent" />
      </div>
    </div>
  )
}

function ContactsSettingsContent() {
  const searchParams = useSearchParams()
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState<string>('')
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [editingContact, setEditingContact] = useState<Contact | null>(null)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [isGoogleImportModalOpen, setIsGoogleImportModalOpen] = useState(false)
  const [googleImportLoading, setGoogleImportLoading] = useState(false)
  const { addToast } = useToast()
  const queryClient = useQueryClient()

  // Handle Google OAuth callback results
  useEffect(() => {
    const googleImport = searchParams.get('google_import')
    const error = searchParams.get('error')
    const imported = searchParams.get('imported')
    const skipped = searchParams.get('skipped')

    if (googleImport === 'success' && imported) {
      addToast(
        `Imported ${imported} contacts from Google${skipped ? ` (${skipped} skipped)` : ''}`,
        'success'
      )
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
      // Clean up URL
      window.history.replaceState({}, '', '/settings/contacts')
    } else if (error) {
      const errorMessages: Record<string, string> = {
        oauth_denied: 'Google import was cancelled',
        missing_params: 'Invalid callback parameters',
        invalid_state: 'Invalid OAuth state',
        state_expired: 'OAuth session expired. Please try again.',
        not_configured: 'Google OAuth is not configured',
        token_exchange_failed: 'Failed to authenticate with Google',
        internal_error: 'An error occurred during import',
      }
      addToast(errorMessages[error] || 'Google import failed', 'error')
      window.history.replaceState({}, '', '/settings/contacts')
    }
  }, [searchParams, addToast, queryClient])

  // Check if Google OAuth is configured
  const { data: googleConfig } = useQuery({
    queryKey: ['google-oauth-config'],
    queryFn: async () => {
      const response = await fetch('/api/contacts/import/google')
      if (!response.ok) return { configured: false }
      return response.json()
    },
  })

  const handleGoogleImport = async () => {
    setGoogleImportLoading(true)
    try {
      const response = await fetch('/api/contacts/import/google', {
        method: 'POST',
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to start Google import')
      }

      // Redirect to Google OAuth
      window.location.href = data.authUrl
    } catch (error) {
      addToast(
        error instanceof Error ? error.message : 'Failed to start Google import',
        'error'
      )
      setGoogleImportLoading(false)
    }
  }

  // Fetch contacts
  const { data, isLoading } = useQuery({
    queryKey: ['contacts', search, sourceFilter],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (sourceFilter) params.set('source', sourceFilter)
      params.set('limit', '100')

      const response = await fetch(`/api/contacts?${params}`)
      if (!response.ok) throw new Error('Failed to fetch contacts')
      return response.json()
    },
  })

  const contacts: Contact[] = data?.contacts || []

  // Create contact mutation
  const createMutation = useMutation({
    mutationFn: async (contactData: Partial<Contact>) => {
      const response = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(contactData),
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to create contact')
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
      setIsCreateModalOpen(false)
      addToast('Contact created', 'success')
    },
    onError: (error: Error) => {
      addToast(error.message, 'error')
    },
  })

  // Update contact mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string } & Partial<Contact>) => {
      const response = await fetch(`/api/contacts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to update contact')
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
      setEditingContact(null)
      addToast('Contact updated', 'success')
    },
    onError: (error: Error) => {
      addToast(error.message, 'error')
    },
  })

  // Delete contact mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/contacts/${id}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to delete contact')
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
      addToast('Contact deleted', 'success')
    },
    onError: (error: Error) => {
      addToast(error.message, 'error')
    },
  })

  return (
    <div className="flex-1">
      {/* Header */}
      <div className="border-b bg-white">
        <div className="px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Contacts</h1>
              <p className="text-sm text-gray-500">
                Manage your contacts and import from CSV
              </p>
            </div>
            <div className="flex gap-2">
              {googleConfig?.configured && (
                <button
                  onClick={handleGoogleImport}
                  disabled={googleImportLoading}
                  className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {googleImportLoading ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
                  ) : (
                    <svg className="h-4 w-4" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                  )}
                  Import from Google
                </button>
              )}
              <button
                onClick={() => setIsImportModalOpen(true)}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Import CSV
              </button>
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
              >
                Add Contact
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="p-8">

        {/* Search and filters */}
        <div className="mb-6 flex gap-4">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Search contacts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
            />
          </div>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="rounded-lg border border-gray-300 px-4 py-2 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
          >
            <option value="">All sources</option>
            <option value="manual">Manual</option>
            <option value="csv_import">CSV Import</option>
            <option value="google">Google</option>
            <option value="whapi_sync">WhatsApp</option>
          </select>
        </div>

        {/* Contacts list */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-green-500 border-t-transparent" />
          </div>
        ) : contacts.length === 0 ? (
          <div className="rounded-lg bg-white p-8 text-center shadow-sm">
            <p className="text-gray-500">No contacts found</p>
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="mt-4 text-green-600 hover:text-green-700"
            >
              Add your first contact
            </button>
          </div>
        ) : (
          <div className="rounded-lg bg-white shadow-sm">
            <table className="w-full">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Phone
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Email
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Source
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase text-gray-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {contacts.map((contact) => (
                  <tr key={contact.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-200 text-gray-600">
                          {contact.display_name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">
                            {contact.display_name}
                          </p>
                          {contact.tags.length > 0 && (
                            <div className="mt-1 flex gap-1">
                              {contact.tags.slice(0, 3).map((tag, i) => (
                                <span
                                  key={i}
                                  className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {contact.phone_numbers?.[0]?.number || '-'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {contact.email_addresses?.[0]?.email || '-'}
                    </td>
                    <td className="px-6 py-4">
                      <SourceBadge source={contact.source} />
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => setEditingContact(contact)}
                        className="mr-2 text-sm text-gray-600 hover:text-gray-900"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('Are you sure you want to delete this contact?')) {
                            deleteMutation.mutate(contact.id)
                          }
                        }}
                        className="text-sm text-red-600 hover:text-red-700"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {(isCreateModalOpen || editingContact) && (
        <ContactFormModal
          contact={editingContact}
          onClose={() => {
            setIsCreateModalOpen(false)
            setEditingContact(null)
          }}
          onSave={(data) => {
            if (editingContact) {
              updateMutation.mutate({ id: editingContact.id, ...data })
            } else {
              createMutation.mutate(data)
            }
          }}
          isPending={createMutation.isPending || updateMutation.isPending}
        />
      )}

      {/* Import Modal */}
      {isImportModalOpen && (
        <ImportCSVModal
          onClose={() => setIsImportModalOpen(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['contacts'] })
            setIsImportModalOpen(false)
          }}
        />
      )}
    </div>
  )
}

function SourceBadge({ source }: { source: string }) {
  const colors: Record<string, string> = {
    manual: 'bg-blue-100 text-blue-700',
    csv_import: 'bg-purple-100 text-purple-700',
    google: 'bg-red-100 text-red-700',
    whapi_sync: 'bg-green-100 text-green-700',
  }

  const labels: Record<string, string> = {
    manual: 'Manual',
    csv_import: 'CSV',
    google: 'Google',
    whapi_sync: 'WhatsApp',
  }

  return (
    <span
      className={cn(
        'rounded-full px-2 py-1 text-xs font-medium',
        colors[source] || 'bg-gray-100 text-gray-700'
      )}
    >
      {labels[source] || source}
    </span>
  )
}

interface ContactFormModalProps {
  contact: Contact | null
  onClose: () => void
  onSave: (data: Partial<Contact>) => void
  isPending: boolean
}

function ContactFormModal({ contact, onClose, onSave, isPending }: ContactFormModalProps) {
  const [displayName, setDisplayName] = useState(contact?.display_name || '')
  const [phone, setPhone] = useState(contact?.phone_numbers?.[0]?.number || '')
  const [email, setEmail] = useState(contact?.email_addresses?.[0]?.email || '')
  const [tags, setTags] = useState(contact?.tags?.join(', ') || '')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave({
      display_name: displayName,
      phone_numbers: phone ? [{ number: phone, type: 'mobile' }] : [],
      email_addresses: email ? [{ email, type: 'personal' }] : [],
      tags: tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">
          {contact ? 'Edit Contact' : 'Add Contact'}
        </h2>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Name *
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Phone
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 234 567 8900"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Tags (comma-separated)
              </label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="client, vip, follow-up"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
              />
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || !displayName.trim()}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

interface ImportCSVModalProps {
  onClose: () => void
  onSuccess: () => void
}

function ImportCSVModal({ onClose, onSuccess }: ImportCSVModalProps) {
  const [file, setFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{
    imported: number
    skipped: number
    errors: string[]
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { addToast } = useToast()

  const handleImport = async () => {
    if (!file) return

    setImporting(true)
    setResult(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/contacts/import/csv', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Import failed')
      }

      setResult(data)
      if (data.imported > 0) {
        addToast(`Imported ${data.imported} contacts`, 'success')
        onSuccess()
      }
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Import failed', 'error')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">Import Contacts from CSV</h2>

        <div className="mb-4 rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
          <p className="mb-2 font-medium">CSV Format</p>
          <p>Your CSV should have columns for:</p>
          <ul className="ml-4 list-disc">
            <li>Name (required) - name, display_name, full_name</li>
            <li>Phone (optional) - phone, phone_number, mobile</li>
            <li>Email (optional) - email, email_address</li>
            <li>Tags (optional) - tags, comma-separated</li>
          </ul>
        </div>

        <div
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            'mb-4 cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors',
            file ? 'border-green-300 bg-green-50' : 'border-gray-300 hover:border-gray-400'
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="hidden"
          />
          {file ? (
            <div>
              <p className="font-medium text-green-700">{file.name}</p>
              <p className="text-sm text-gray-500">Click to change file</p>
            </div>
          ) : (
            <div>
              <svg
                className="mx-auto h-12 w-12 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
              <p className="mt-2 text-gray-600">Click to select CSV file</p>
            </div>
          )}
        </div>

        {result && (
          <div className="mb-4 rounded-lg bg-gray-50 p-4">
            <p className="font-medium text-gray-900">Import Results</p>
            <p className="text-sm text-green-600">Imported: {result.imported}</p>
            <p className="text-sm text-gray-500">Skipped: {result.skipped}</p>
            {result.errors.length > 0 && (
              <div className="mt-2">
                <p className="text-sm font-medium text-red-600">Errors:</p>
                <ul className="ml-4 list-disc text-sm text-red-500">
                  {result.errors.slice(0, 5).map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                  {result.errors.length > 5 && (
                    <li>...and {result.errors.length - 5} more</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button
              onClick={handleImport}
              disabled={!file || importing}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {importing ? 'Importing...' : 'Import'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
