'use client'

/**
 * Label Picker Component
 *
 * Allows users to select/create labels for chats.
 * Used in chat menu (desktop) and action sheet (mobile).
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { LabelBadge } from '@/components/ui/badge'

// Predefined colors matching the API
const LABEL_COLORS = [
  { name: 'Red', value: '#ef4444' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Pink', value: '#ec4899' },
  { name: 'Gray', value: '#6b7280' },
]

interface Label {
  id: string
  name: string
  color: string
}

interface LabelPickerProps {
  chatId: string
  currentLabels: Label[]
  onLabelToggle?: (label: Label, added: boolean) => void
  onClose?: () => void
  className?: string
}

export function LabelPicker({
  chatId,
  currentLabels,
  onLabelToggle,
  onClose,
  className,
}: LabelPickerProps) {
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [newLabelName, setNewLabelName] = useState('')
  const [selectedColor, setSelectedColor] = useState(LABEL_COLORS[4].value) // Default blue

  // Fetch all workspace labels
  const { data: labelsData, isLoading } = useQuery({
    queryKey: ['labels'],
    queryFn: async () => {
      const response = await fetch('/api/labels')
      if (!response.ok) throw new Error('Failed to fetch labels')
      return response.json()
    },
  })

  const allLabels: Label[] = labelsData?.labels || []

  // Check if a label is currently assigned
  const isLabelAssigned = (labelId: string) => {
    return currentLabels.some((l) => l.id === labelId)
  }

  // Mutation to add label
  const addLabelMutation = useMutation({
    mutationFn: async (labelId: string) => {
      const response = await fetch(`/api/chats/${chatId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add-label', label_id: labelId }),
      })
      if (!response.ok) throw new Error('Failed to add label')
      return response.json()
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['chats'] })
      onLabelToggle?.(data.label, true)
    },
  })

  // Mutation to remove label
  const removeLabelMutation = useMutation({
    mutationFn: async (labelId: string) => {
      const response = await fetch(`/api/chats/${chatId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove-label', label_id: labelId }),
      })
      if (!response.ok) throw new Error('Failed to remove label')
      return response.json()
    },
    onSuccess: (_, labelId) => {
      queryClient.invalidateQueries({ queryKey: ['chats'] })
      const label = allLabels.find((l) => l.id === labelId)
      if (label) onLabelToggle?.(label, false)
    },
  })

  // Mutation to create new label
  const createLabelMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newLabelName.trim(), color: selectedColor }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create label')
      }
      return response.json()
    },
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: ['labels'] })
      setNewLabelName('')
      setShowCreate(false)
      // Auto-assign the new label to the chat
      if (data.label) {
        addLabelMutation.mutate(data.label.id)
      }
    },
  })

  const handleToggleLabel = (label: Label) => {
    if (isLabelAssigned(label.id)) {
      removeLabelMutation.mutate(label.id)
    } else {
      addLabelMutation.mutate(label.id)
    }
  }

  const handleCreateLabel = () => {
    if (!newLabelName.trim()) return
    createLabelMutation.mutate()
  }

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
        <span className="text-sm font-medium text-gray-900">Labels</span>
        {onClose && (
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Label list */}
      <div className="max-h-48 overflow-y-auto py-1">
        {isLoading ? (
          <div className="px-3 py-2 text-sm text-gray-500">Loading...</div>
        ) : allLabels.length === 0 ? (
          <div className="px-3 py-2 text-sm text-gray-500">No labels yet</div>
        ) : (
          allLabels.map((label) => (
            <button
              key={label.id}
              onClick={() => handleToggleLabel(label)}
              disabled={addLabelMutation.isPending || removeLabelMutation.isPending}
              className="flex w-full items-center gap-2 px-3 py-2 hover:bg-gray-50 disabled:opacity-50"
            >
              <span
                className="flex h-4 w-4 items-center justify-center rounded border"
                style={{
                  borderColor: label.color,
                  backgroundColor: isLabelAssigned(label.id) ? label.color : 'transparent',
                }}
              >
                {isLabelAssigned(label.id) && (
                  <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </span>
              <span
                className="flex-1 text-left text-sm"
                style={{ color: label.color }}
              >
                {label.name}
              </span>
            </button>
          ))
        )}
      </div>

      {/* Create new label section */}
      <div className="border-t border-gray-200">
        {showCreate ? (
          <div className="p-3 space-y-3">
            <input
              type="text"
              value={newLabelName}
              onChange={(e) => setNewLabelName(e.target.value)}
              placeholder="Label name"
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-green-500 focus:outline-none"
              autoFocus
            />
            {/* Color picker */}
            <div className="flex flex-wrap gap-2">
              {LABEL_COLORS.map((color) => (
                <button
                  key={color.value}
                  onClick={() => setSelectedColor(color.value)}
                  className={cn(
                    'h-6 w-6 rounded-full border-2',
                    selectedColor === color.value ? 'border-gray-900' : 'border-transparent'
                  )}
                  style={{ backgroundColor: color.value }}
                  title={color.name}
                />
              ))}
            </div>
            {/* Preview */}
            {newLabelName.trim() && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Preview:</span>
                <LabelBadge name={newLabelName.trim()} color={selectedColor} size="md" />
              </div>
            )}
            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowCreate(false)
                  setNewLabelName('')
                }}
                className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateLabel}
                disabled={!newLabelName.trim() || createLabelMutation.isPending}
                className="flex-1 rounded bg-green-500 px-3 py-1.5 text-sm text-white hover:bg-green-600 disabled:opacity-50"
              >
                {createLabelMutation.isPending ? 'Creating...' : 'Create'}
              </button>
            </div>
            {createLabelMutation.isError && (
              <p className="text-xs text-red-500">
                {(createLabelMutation.error as Error).message}
              </p>
            )}
          </div>
        ) : (
          <button
            onClick={() => setShowCreate(true)}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-green-600 hover:bg-gray-50"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create new label
          </button>
        )}
      </div>
    </div>
  )
}
