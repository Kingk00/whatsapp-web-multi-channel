'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { ChannelList } from '@/components/channel-list'
import { AddChannelDialog } from '@/components/add-channel-dialog'

export default function ChannelSettingsPage() {
  const router = useRouter()
  const supabase = createClient()
  const [isMainAdmin, setIsMainAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

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
      // Error checking user role - redirect to login
    } finally {
      setLoading(false)
    }
  }

  const handleChannelAdded = () => {
    // Refresh the channel list by incrementing the key
    setRefreshKey((prev) => prev + 1)
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
    <div className="flex-1">
      {/* Header */}
      <div className="border-b bg-white">
        <div className="px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Channels</h1>
              <p className="mt-1 text-sm text-gray-500">
                Manage your WhatsApp Business channels
              </p>
            </div>
            {isMainAdmin && (
              <Button onClick={() => setShowAddDialog(true)}>
                Add Channel
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-8">
        <div className="max-w-4xl">
          <ChannelList key={refreshKey} />
        </div>
      </div>

      {/* Add Channel Dialog */}
      <AddChannelDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onSuccess={handleChannelAdded}
      />
    </div>
  )
}
