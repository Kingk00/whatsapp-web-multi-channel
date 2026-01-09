'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface AddChannelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export function AddChannelDialog({
  open,
  onOpenChange,
  onSuccess,
}: AddChannelDialogProps) {
  const [channelName, setChannelName] = useState('')
  const [whapiToken, setWhapiToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

  const validateToken = (token: string): boolean => {
    // Whapi tokens should be non-empty and typically start with a specific format
    // Basic validation: check if it's a non-empty string with reasonable length
    if (!token || token.trim().length < 10) {
      return false
    }
    return true
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    // Validation
    if (!channelName.trim()) {
      setError('Please enter a channel name')
      return
    }

    if (!whapiToken.trim()) {
      setError('Please enter a Whapi token')
      return
    }

    if (!validateToken(whapiToken)) {
      setError('Invalid Whapi token format')
      return
    }

    setLoading(true)

    try {
      // Get current user
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError('You must be logged in to add a channel')
        setLoading(false)
        return
      }

      // Call API to create channel
      const response = await fetch('/api/channels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: channelName.trim(),
          whapi_token: whapiToken.trim(),
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to add channel')
      }

      // Success - close dialog and refresh
      setChannelName('')
      setWhapiToken('')
      onOpenChange(false)
      onSuccess?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add channel')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    if (!loading) {
      setChannelName('')
      setWhapiToken('')
      setError(null)
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add WhatsApp Channel</DialogTitle>
            <DialogDescription>
              Connect a WhatsApp Business channel using your Whapi.cloud API token.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Channel Name */}
            <div className="grid gap-2">
              <Label htmlFor="channel-name">
                Channel Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="channel-name"
                placeholder="e.g., Support Team"
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
                disabled={loading}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                A friendly name to identify this channel
              </p>
            </div>

            {/* Whapi Token */}
            <div className="grid gap-2">
              <Label htmlFor="whapi-token">
                Whapi Token <span className="text-destructive">*</span>
              </Label>
              <Input
                id="whapi-token"
                type="password"
                placeholder="Enter your Whapi.cloud API token"
                value={whapiToken}
                onChange={(e) => setWhapiToken(e.target.value)}
                disabled={loading}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Get your token from{' '}
                <a
                  href="https://whapi.cloud"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  whapi.cloud
                </a>
              </p>
            </div>

            {/* Error Message */}
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <svg
                    className="mr-2 h-4 w-4 animate-spin"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Adding Channel...
                </>
              ) : (
                'Add Channel'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
