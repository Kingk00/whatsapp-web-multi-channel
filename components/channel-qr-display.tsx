'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface ChannelQrDisplayProps {
  channelId: string
  channelName: string
  webhookSecret?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnected?: () => void
}

interface QrCodeData {
  qr_code: string
  channel_id: string
}

interface ChannelStatus {
  id: string
  status: string
  health_status: string
  phone_number?: string
}

export function ChannelQrDisplay({
  channelId,
  channelName,
  webhookSecret,
  open,
  onOpenChange,
  onConnected,
}: ChannelQrDisplayProps) {
  const [copied, setCopied] = useState(false)

  // Generate webhook URL
  const webhookUrl = typeof window !== 'undefined' && webhookSecret
    ? `${window.location.origin}/api/webhooks/whapi/${channelId}?secret=${webhookSecret}`
    : ''

  const copyToClipboard = async () => {
    if (webhookUrl) {
      await navigator.clipboard.writeText(webhookUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null)

  // Fetch QR code from API
  const fetchQrCode = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/channels/${channelId}/qr`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch QR code')
      }

      setQrCode(data.qr_code)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load QR code')
    } finally {
      setLoading(false)
    }
  }, [channelId])

  // Check channel status
  const checkChannelStatus = useCallback(async () => {
    try {
      const response = await fetch(`/api/channels/${channelId}`)
      const data = await response.json()

      if (response.ok && data.channel) {
        const channel: ChannelStatus = data.channel

        // If channel becomes ACTIVE, stop polling and notify
        if (channel.status === 'ACTIVE') {
          setIsConnected(true)
          if (pollingInterval) {
            clearInterval(pollingInterval)
            setPollingInterval(null)
          }
          onConnected?.()
        }
      }
    } catch (err) {
      // Silently fail - polling will retry
    }
  }, [channelId, pollingInterval, onConnected])

  // Start polling for channel status when QR code is displayed
  useEffect(() => {
    if (open && qrCode && !isConnected) {
      // Poll every 3 seconds
      const interval = setInterval(checkChannelStatus, 3000)
      setPollingInterval(interval)

      return () => {
        clearInterval(interval)
      }
    }
  }, [open, qrCode, isConnected, checkChannelStatus])

  // Fetch QR code when dialog opens
  useEffect(() => {
    if (open && !qrCode && !isConnected) {
      fetchQrCode()
    }
  }, [open, qrCode, isConnected, fetchQrCode])

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval)
      }
    }
  }, [pollingInterval])

  const handleClose = () => {
    if (!loading) {
      setQrCode(null)
      setError(null)
      setIsConnected(false)
      if (pollingInterval) {
        clearInterval(pollingInterval)
        setPollingInterval(null)
      }
      onOpenChange(false)
    }
  }

  const handleRetry = () => {
    fetchQrCode()
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Connect WhatsApp Channel</DialogTitle>
          <DialogDescription>
            Scan the QR code below with your WhatsApp mobile app to connect{' '}
            <strong>{channelName}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center justify-center gap-4 py-6">
          {loading && (
            <div className="flex flex-col items-center gap-3">
              <div className="h-64 w-64 animate-pulse rounded-lg bg-muted" />
              <p className="text-sm text-muted-foreground">Loading QR code...</p>
            </div>
          )}

          {error && !loading && (
            <div className="flex flex-col items-center gap-4">
              <div className="rounded-md bg-destructive/10 p-4 text-center">
                <p className="text-sm text-destructive">{error}</p>
              </div>
              <Button onClick={handleRetry} variant="outline">
                Retry
              </Button>
            </div>
          )}

          {qrCode && !loading && !error && !isConnected && (
            <div className="flex flex-col items-center gap-4">
              <div className="rounded-lg border-2 border-border p-4">
                <img
                  src={qrCode}
                  alt="WhatsApp QR Code"
                  className="h-64 w-64"
                />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">
                  Open WhatsApp on your phone
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Tap <strong>Menu</strong> or <strong>Settings</strong> and select{' '}
                  <strong>Linked Devices</strong>
                </p>
                <p className="text-xs text-muted-foreground">
                  Tap <strong>Link a Device</strong> and scan this QR code
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
                <span>Waiting for scan...</span>
              </div>
            </div>
          )}

          {isConnected && (
            <div className="flex flex-col items-center gap-4">
              <div className="rounded-full bg-green-100 p-4">
                <svg
                  className="h-16 w-16 text-green-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-lg font-semibold text-green-600">
                  Connected Successfully!
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Your WhatsApp channel is now active
                </p>
              </div>
              <Button onClick={handleClose}>Close</Button>
            </div>
          )}

          {/* Webhook URL Configuration */}
          {webhookUrl && (
            <div className="w-full mt-4 p-4 rounded-lg border bg-muted/50">
              <div className="flex items-center gap-2 mb-2">
                <svg className="h-4 w-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                <p className="text-sm font-medium">Webhook Configuration</p>
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                Configure this URL in your Whapi.cloud channel settings to receive messages:
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-background p-2 rounded border overflow-x-auto whitespace-nowrap">
                  {webhookUrl}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={copyToClipboard}
                  className="shrink-0"
                >
                  {copied ? (
                    <svg className="h-4 w-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
