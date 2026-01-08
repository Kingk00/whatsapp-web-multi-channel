'use client'

import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/ui/toast'

interface Channel {
  id: string
  name: string
  color: string | null
}

interface Attachment {
  id: string
  kind: 'image' | 'video' | 'audio' | 'document'
  storage_path: string
  filename: string
  mime_type: string
  sort_order: number
  url?: string
}

interface QuickReply {
  id: string
  workspace_id: string
  scope: 'global' | 'channel'
  channel_id: string | null
  shortcut: string
  title: string | null
  reply_type: string
  text_body: string | null
  created_by: string
  created_at: string
  updated_at: string
  channel?: Channel | null
  creator?: {
    user_id: string
    display_name: string
  } | null
  attachments?: Attachment[]
}

export default function QuickRepliesSettingsPage() {
  const [selectedChannelId, setSelectedChannelId] = useState<string>('')
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [editingReply, setEditingReply] = useState<QuickReply | null>(null)
  const { addToast } = useToast()
  const queryClient = useQueryClient()

  // Fetch channels for the filter dropdown
  const { data: channelsData } = useQuery({
    queryKey: ['channels'],
    queryFn: async () => {
      const response = await fetch('/api/channels')
      if (!response.ok) throw new Error('Failed to fetch channels')
      return response.json()
    },
  })

  const channels: Channel[] = channelsData?.channels || []

  // Fetch quick replies - channel-based only
  const { data, isLoading } = useQuery({
    queryKey: ['quick-replies', selectedChannelId],
    queryFn: async () => {
      const params = new URLSearchParams()
      params.set('scope', 'channel')
      if (selectedChannelId) {
        params.set('channel_id', selectedChannelId)
      }

      const response = await fetch(`/api/quick-replies?${params}`)
      if (!response.ok) throw new Error('Failed to fetch quick replies')
      return response.json()
    },
  })

  const quickReplies: QuickReply[] = (data?.quickReplies || []).filter(
    (r: QuickReply) => r.scope === 'channel'
  )

  // Create mutation - returns the new quick reply for file uploads
  const createMutation = useMutation({
    mutationFn: async (data: Partial<QuickReply> & { has_pending_media?: boolean }) => {
      const response = await fetch('/api/quick-replies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          scope: 'channel', // Always channel-based
        }),
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to create quick reply')
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quick-replies'] })
      // Note: Modal close is handled in the form after file uploads complete
    },
    onError: (error: Error) => {
      addToast(error.message, 'error')
    },
  })

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string } & Partial<QuickReply>) => {
      const response = await fetch(`/api/quick-replies/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to update quick reply')
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quick-replies'] })
      setEditingReply(null)
      addToast('Quick reply updated', 'success')
    },
    onError: (error: Error) => {
      addToast(error.message, 'error')
    },
  })

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/quick-replies/${id}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to delete quick reply')
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quick-replies'] })
      addToast('Quick reply deleted', 'success')
    },
    onError: (error: Error) => {
      addToast(error.message, 'error')
    },
  })

  // Group quick replies by channel
  const repliesByChannel = quickReplies.reduce((acc, reply) => {
    const channelId = reply.channel_id || 'unknown'
    if (!acc[channelId]) {
      acc[channelId] = {
        channel: reply.channel,
        replies: [],
      }
    }
    acc[channelId].replies.push(reply)
    return acc
  }, {} as Record<string, { channel: Channel | null | undefined; replies: QuickReply[] }>)

  return (
    <div className="flex-1">
      {/* Header */}
      <div className="border-b bg-white">
        <div className="px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Quick Replies</h1>
              <p className="text-sm text-gray-500">
                Create shortcuts for frequently used messages. Type <code className="rounded bg-gray-100 px-1.5 py-0.5 text-green-600">/shortcut</code> to use.
              </p>
            </div>
            <button
              onClick={() => setIsCreateModalOpen(true)}
              disabled={channels.length === 0}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add Quick Reply
            </button>
          </div>
        </div>
      </div>

      <div className="p-8">
        {/* Channel Filter */}
        {channels.length > 0 && (
          <div className="mb-6">
            <select
              value={selectedChannelId}
              onChange={(e) => setSelectedChannelId(e.target.value)}
              className="rounded-lg border border-gray-300 px-4 py-2 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
            >
              <option value="">All channels</option>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* No channels state */}
        {channels.length === 0 ? (
          <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-6 text-center">
            <svg
              className="mx-auto h-12 w-12 text-yellow-500 mb-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <p className="text-yellow-800 font-medium">No channels available</p>
            <p className="text-yellow-700 text-sm mt-1">
              Add a channel first to create quick replies.
            </p>
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-green-500 border-t-transparent" />
          </div>
        ) : quickReplies.length === 0 ? (
          <div className="rounded-lg bg-white p-8 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
              <svg
                className="h-8 w-8 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </div>
            <p className="text-gray-500">No quick replies yet</p>
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="mt-4 text-green-600 hover:text-green-700"
            >
              Create your first quick reply
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(repliesByChannel).map(([channelId, { channel, replies }]) => (
              <div key={channelId} className="rounded-lg bg-white shadow-sm overflow-hidden">
                {/* Channel Header */}
                <div className="border-b border-gray-100 bg-gray-50 px-6 py-3">
                  <div className="flex items-center gap-2">
                    {channel && (
                      <span
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: channel.color || '#6b7280' }}
                      />
                    )}
                    <h3 className="font-semibold text-gray-900">
                      {channel?.name || 'Unknown Channel'}
                    </h3>
                    <span className="text-sm text-gray-500">
                      ({replies.length} {replies.length === 1 ? 'reply' : 'replies'})
                    </span>
                  </div>
                </div>

                {/* Replies Table */}
                <table className="w-full">
                  <thead className="border-b border-gray-200 bg-gray-50/50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">
                        Shortcut
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">
                        Message
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium uppercase text-gray-500">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {replies.map((reply) => (
                      <tr key={reply.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <code className="rounded bg-gray-100 px-2 py-1 text-sm font-mono text-green-600">
                            /{reply.shortcut}
                          </code>
                        </td>
                        <td className="max-w-md px-6 py-4">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm text-gray-600">
                              {reply.text_body}
                            </p>
                            {reply.attachments && reply.attachments.length > 0 && (
                              <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                                <svg className="mr-1 h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                                </svg>
                                {reply.attachments.length}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => setEditingReply(reply)}
                            className="mr-3 text-sm text-gray-600 hover:text-gray-900"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => {
                              if (confirm('Delete this quick reply?')) {
                                deleteMutation.mutate(reply.id)
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
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {(isCreateModalOpen || editingReply) && (
        <QuickReplyFormModal
          reply={editingReply}
          channels={channels}
          onClose={() => {
            setIsCreateModalOpen(false)
            setEditingReply(null)
          }}
          onSave={async (data, pendingFiles) => {
            if (editingReply) {
              updateMutation.mutate({ id: editingReply.id, ...data })
              return editingReply.id
            } else {
              const result = await createMutation.mutateAsync({
                ...data,
                has_pending_media: pendingFiles.length > 0,
              })
              return result.quickReply?.id
            }
          }}
          onComplete={() => {
            setIsCreateModalOpen(false)
            setEditingReply(null)
            addToast(editingReply ? 'Quick reply updated' : 'Quick reply created', 'success')
          }}
          isPending={createMutation.isPending || updateMutation.isPending}
        />
      )}
    </div>
  )
}

interface QuickReplyFormModalProps {
  reply: QuickReply | null
  channels: Channel[]
  onClose: () => void
  onSave: (data: Partial<QuickReply>, pendingFiles: PendingFile[]) => Promise<string | undefined>
  onComplete: () => void
  isPending: boolean
}

interface PendingFile {
  file: File
  preview: string
  type: 'image' | 'video' | 'audio' | 'document'
}

function QuickReplyFormModal({
  reply,
  channels,
  onClose,
  onSave,
  onComplete,
  isPending,
}: QuickReplyFormModalProps) {
  const [shortcut, setShortcut] = useState(reply?.shortcut || '')
  const [textBody, setTextBody] = useState(reply?.text_body || '')
  const [channelId, setChannelId] = useState(reply?.channel_id || (channels[0]?.id || ''))
  const [existingAttachments, setExistingAttachments] = useState<Attachment[]>(
    reply?.attachments || []
  )
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  const [uploadingFiles, setUploadingFiles] = useState(false)
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0, percent: 0 })

  // Check if there's any media (existing or pending)
  const hasMedia = existingAttachments.length > 0 || pendingFiles.length > 0
  const [deletingAttachmentId, setDeletingAttachmentId] = useState<string | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const { addToast } = useToast()
  const queryClient = useQueryClient()

  // Cleanup preview URLs on unmount
  React.useEffect(() => {
    return () => {
      pendingFiles.forEach((pf) => {
        if (pf.preview) URL.revokeObjectURL(pf.preview)
      })
    }
  }, [pendingFiles])

  const getFileType = (file: File): PendingFile['type'] => {
    if (file.type.startsWith('image/')) return 'image'
    if (file.type.startsWith('video/')) return 'video'
    if (file.type.startsWith('audio/')) return 'audio'
    return 'document'
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    // Validate file sizes
    const validFiles = files.filter((file) => {
      if (file.size > 10 * 1024 * 1024) {
        addToast(`${file.name} is too large (max 10MB)`, 'error')
        return false
      }
      return true
    })

    const newPendingFiles: PendingFile[] = validFiles.map((file) => ({
      file,
      preview: file.type.startsWith('image/') || file.type.startsWith('video/')
        ? URL.createObjectURL(file)
        : '',
      type: getFileType(file),
    }))

    setPendingFiles((prev) => [...prev, ...newPendingFiles])
    e.target.value = '' // Reset input
  }

  const removePendingFile = (index: number) => {
    setPendingFiles((prev) => {
      const file = prev[index]
      if (file.preview) URL.revokeObjectURL(file.preview)
      return prev.filter((_, i) => i !== index)
    })
  }

  const deleteExistingAttachment = async (attachmentId: string) => {
    if (!reply) return
    setDeletingAttachmentId(attachmentId)

    try {
      const response = await fetch(
        `/api/quick-replies/${reply.id}/attachments?attachment_id=${attachmentId}`,
        { method: 'DELETE' }
      )
      if (!response.ok) {
        throw new Error('Failed to delete attachment')
      }
      setExistingAttachments((prev) => prev.filter((a) => a.id !== attachmentId))
      addToast('Attachment deleted', 'success')
    } catch (error) {
      addToast('Failed to delete attachment', 'error')
    } finally {
      setDeletingAttachmentId(null)
    }
  }

  const uploadFileWithProgress = (file: File, quickReplyId: string): Promise<boolean> => {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest()
      const formData = new FormData()
      formData.append('file', file)

      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100)
          setUploadProgress((prev) => ({ ...prev, percent }))
        }
      })

      xhr.addEventListener('load', () => {
        resolve(xhr.status >= 200 && xhr.status < 300)
      })

      xhr.addEventListener('error', () => {
        console.error('Upload error')
        resolve(false)
      })

      xhr.open('POST', `/api/quick-replies/${quickReplyId}/attachments`)
      xhr.send(formData)
    })
  }

  const uploadPendingFiles = async (quickReplyId: string) => {
    if (pendingFiles.length === 0) return

    setUploadingFiles(true)
    setUploadProgress({ current: 0, total: pendingFiles.length, percent: 0 })
    let uploadedCount = 0

    for (let i = 0; i < pendingFiles.length; i++) {
      const pf = pendingFiles[i]
      setUploadProgress({ current: i + 1, total: pendingFiles.length, percent: 0 })

      const success = await uploadFileWithProgress(pf.file, quickReplyId)
      if (success) {
        uploadedCount++
      }
    }

    if (uploadedCount > 0) {
      addToast(`${uploadedCount} file(s) uploaded`, 'success')
    }
    setUploadingFiles(false)
    setUploadProgress({ current: 0, total: 0, percent: 0 })
    setPendingFiles([])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Save the quick reply first
    const quickReplyId = await onSave({
      shortcut,
      text_body: textBody || null,
      channel_id: channelId,
    }, pendingFiles)

    // Upload any pending files
    if (quickReplyId && pendingFiles.length > 0) {
      await uploadPendingFiles(quickReplyId)
    }

    // Close the modal and notify parent
    onComplete()
  }

  const getAttachmentIcon = (type: string) => {
    switch (type) {
      case 'image':
        return (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        )
      case 'video':
        return (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        )
      case 'audio':
        return (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
        )
      default:
        return (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        )
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">
          {reply ? 'Edit Quick Reply' : 'Add Quick Reply'}
        </h2>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            {/* Channel Selection */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Channel *
              </label>
              <select
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                required
              >
                <option value="">Select a channel</option>
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Shortcut */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Shortcut *
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-gray-500">
                  /
                </span>
                <input
                  type="text"
                  value={shortcut}
                  onChange={(e) => setShortcut(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                  placeholder="hello"
                  className="w-full rounded-lg border border-gray-300 py-2 pl-8 pr-3 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                  required
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Type <code className="bg-gray-100 px-1 rounded">/{shortcut || 'shortcut'}</code> in chat to use
              </p>
            </div>

            {/* Message */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Message {hasMedia ? '(optional with media)' : '*'}
              </label>
              <textarea
                value={textBody}
                onChange={(e) => setTextBody(e.target.value)}
                placeholder="Hello! How can I help you today?"
                rows={4}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                required={!hasMedia}
              />
              {hasMedia && !textBody.trim() && (
                <p className="mt-1 text-xs text-green-600">
                  Message is optional when attaching media
                </p>
              )}
            </div>

            {/* Media Attachments */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Media Attachments
              </label>

              {/* Existing attachments */}
              {existingAttachments.length > 0 && (
                <div className="mb-3 space-y-2">
                  {existingAttachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2"
                    >
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <span className="text-gray-400">{getAttachmentIcon(attachment.kind)}</span>
                        <span className="truncate max-w-[200px]">{attachment.filename}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => deleteExistingAttachment(attachment.id)}
                        disabled={deletingAttachmentId === attachment.id}
                        className="text-red-500 hover:text-red-700 disabled:opacity-50"
                      >
                        {deletingAttachmentId === attachment.id ? (
                          <span className="text-xs">...</span>
                        ) : (
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Pending files (new uploads) */}
              {pendingFiles.length > 0 && (
                <div className="mb-3 space-y-2">
                  {pendingFiles.map((pf, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-3 py-2"
                    >
                      <div className="flex items-center gap-2 text-sm text-blue-700">
                        {pf.type === 'image' && pf.preview ? (
                          <img src={pf.preview} alt="" className="h-8 w-8 rounded object-cover" />
                        ) : (
                          <span className="text-blue-400">{getAttachmentIcon(pf.type)}</span>
                        )}
                        <span className="truncate max-w-[200px]">{pf.file.name}</span>
                        <span className="text-xs text-blue-500">(pending upload)</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removePendingFile(index)}
                        className="text-blue-500 hover:text-blue-700"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Upload button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 px-4 py-3 text-sm text-gray-600 hover:border-green-500 hover:text-green-600 transition-colors"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Image, Video, or Document
              </button>
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileSelect}
                multiple
                className="hidden"
                accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
              />
              <p className="mt-1 text-xs text-gray-500">
                Max 10MB per file. Images, videos, audio, and documents supported.
              </p>
            </div>
          </div>

          {/* Upload Progress Bar */}
          {uploadingFiles && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">
                  Uploading file {uploadProgress.current} of {uploadProgress.total}...
                </span>
                <span className="font-medium text-green-600">{uploadProgress.percent}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-green-500 to-green-600 transition-all duration-300"
                  style={{ width: `${uploadProgress.percent}%` }}
                />
              </div>
            </div>
          )}

          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={uploadingFiles}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || uploadingFiles || !shortcut.trim() || (!textBody.trim() && !hasMedia) || !channelId}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {isPending ? 'Saving...' : uploadingFiles ? 'Uploading...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
