'use client'

import { useState, useEffect } from 'react'
import { Avatar } from '@/components/ui/avatar'

interface ChatAvatarProps {
  chatId: string
  src?: string | null
  fallback: string
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

/**
 * Chat Avatar component that automatically fetches profile photos from WhatsApp
 * if not already cached in the database.
 */
export function ChatAvatar({
  chatId,
  src,
  fallback,
  size = 'lg',
  className,
}: ChatAvatarProps) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(src || null)
  const [loading, setLoading] = useState(false)
  const [attempted, setAttempted] = useState(false)

  useEffect(() => {
    // Reset state when chat changes
    setAvatarUrl(src || null)
    setAttempted(false)
  }, [chatId, src])

  useEffect(() => {
    // Only fetch if we don't have a URL and haven't attempted yet
    if (!avatarUrl && !loading && !attempted && chatId) {
      setLoading(true)
      setAttempted(true)

      fetch(`/api/chats/${chatId}/avatar`)
        .then((res) => res.json())
        .then((data) => {
          if (data.avatar_url) {
            setAvatarUrl(data.avatar_url)
          }
        })
        .catch((err) => {
          console.error('Failed to fetch avatar:', err)
        })
        .finally(() => {
          setLoading(false)
        })
    }
  }, [chatId, avatarUrl, loading, attempted])

  return (
    <Avatar
      src={avatarUrl}
      fallback={fallback}
      size={size}
      className={className}
    />
  )
}
