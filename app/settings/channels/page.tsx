'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { ChannelList } from '@/components/channel-list'

export default function ChannelSettingsPage() {
  const router = useRouter()
  const supabase = createClient()
  const [isMainAdmin, setIsMainAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    checkUserRole()
  }, [])

  const checkUserRole = async () => {
    setLoading(true)
    try {
      // Get current user
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push('/login')
        return
      }

      // Get user profile to check role
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('user_id', user.id)
        .single()

      setIsMainAdmin(profile?.role === 'main_admin')
    } catch (error) {
      console.error('Error checking user role:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-pulse text-sm text-muted-foreground">
          Loading...
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Channels</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Manage your WhatsApp Business channels
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={() => router.push('/inbox')}
              >
                Back to Inbox
              </Button>
              {isMainAdmin && (
                <Button>
                  Add Channel
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl">
          <ChannelList />
        </div>
      </div>
    </div>
  )
}
