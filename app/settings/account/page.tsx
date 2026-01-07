'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/toast'

interface Profile {
  user_id: string
  username: string | null
  display_name: string
  role: string
}

export default function AccountSettingsPage() {
  const router = useRouter()
  const supabase = createClient()
  const { addToast } = useToast()

  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  // Password change form
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordLoading, setPasswordLoading] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  useEffect(() => {
    loadProfile()
  }, [])

  const loadProfile = async () => {
    setLoading(true)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push('/login')
        return
      }

      const { data: profileData } = await supabase
        .from('profiles')
        .select('user_id, username, display_name, role')
        .eq('user_id', user.id)
        .single()

      setProfile(profileData)
    } catch (error) {
      console.error('Error loading profile:', error)
    } finally {
      setLoading(false)
    }
  }

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault()
    setPasswordError(null)

    // Validate passwords
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters')
      return
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match')
      return
    }

    setPasswordLoading(true)

    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setPasswordError(data.error || 'Failed to change password')
        return
      }

      addToast('Password changed successfully', 'success')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (error) {
      setPasswordError('Failed to change password')
    } finally {
      setPasswordLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    )
  }

  return (
    <div className="flex-1">
      {/* Header */}
      <header className="border-b bg-white px-8 py-6">
        <h1 className="text-2xl font-semibold text-gray-900">Account Settings</h1>
        <p className="text-sm text-gray-500">Manage your account and security</p>
      </header>

      <main className="max-w-2xl p-8 space-y-8">
        {/* Profile Info */}
        <section className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-semibold mb-4">Profile Information</h2>
          <div className="space-y-4">
            <div>
              <Label className="text-muted-foreground">Username</Label>
              <p className="text-lg font-medium">@{profile?.username || 'Not set'}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Display Name</Label>
              <p className="text-lg font-medium">{profile?.display_name || 'Not set'}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Role</Label>
              <p className="text-lg font-medium capitalize">{profile?.role?.replace('_', ' ') || 'Agent'}</p>
            </div>
          </div>
        </section>

        {/* Password Change */}
        <section className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-semibold mb-4">Change Password</h2>
          <form onSubmit={handlePasswordChange} className="space-y-4">
            {passwordError && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {passwordError}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="currentPassword">Current Password</Label>
              <Input
                id="currentPassword"
                type="password"
                placeholder="Enter your current password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="newPassword">New Password</Label>
              <Input
                id="newPassword"
                type="password"
                placeholder="Enter new password (min 8 characters)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm New Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>

            <Button type="submit" disabled={passwordLoading}>
              {passwordLoading ? 'Changing...' : 'Change Password'}
            </Button>
          </form>
        </section>
      </main>
    </div>
  )
}
