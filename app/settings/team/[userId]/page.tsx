'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/toast'

interface UserProfile {
  user_id: string
  display_name: string
  username: string | null
  role: string
  created_at: string
  email: string | null
  last_sign_in_at: string | null
}

interface Group {
  id: string
  name: string
  description: string | null
}

interface LoginActivity {
  id: string
  event_type: string
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

export default function UserDetailPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params)
  const router = useRouter()
  const supabase = createClient()
  const { addToast } = useToast()

  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [isMainAdmin, setIsMainAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  // User data
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [groups, setGroups] = useState<Group[]>([])
  const [allGroups, setAllGroups] = useState<Group[]>([])
  const [loginActivity, setLoginActivity] = useState<LoginActivity[]>([])

  // Edit mode
  const [isEditing, setIsEditing] = useState(false)
  const [editDisplayName, setEditDisplayName] = useState('')
  const [editUsername, setEditUsername] = useState('')
  const [editRole, setEditRole] = useState('')
  const [editLoading, setEditLoading] = useState(false)

  // Password reset modal
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [passwordMode, setPasswordMode] = useState<'auto' | 'manual'>('auto')
  const [manualPassword, setManualPassword] = useState('')
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null)
  const [passwordLoading, setPasswordLoading] = useState(false)

  // Group management
  const [showGroupModal, setShowGroupModal] = useState(false)
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([])
  const [groupLoading, setGroupLoading] = useState(false)

  // Delete confirmation
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)

  useEffect(() => {
    loadUserData()
  }, [userId])

  const loadUserData = async () => {
    setLoading(true)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push('/login')
        return
      }

      setCurrentUserId(user.id)

      // Get current user's profile
      const { data: adminProfile } = await supabase
        .from('profiles')
        .select('role, workspace_id')
        .eq('user_id', user.id)
        .single()

      if (!adminProfile || !['main_admin', 'admin'].includes(adminProfile.role)) {
        router.push('/inbox')
        return
      }

      setIsAdmin(true)
      setIsMainAdmin(adminProfile.role === 'main_admin')

      // Fetch user details from API
      const response = await fetch(`/api/team/users/${userId}`)
      if (!response.ok) {
        const data = await response.json()
        addToast(data.error || 'Failed to load user', 'error')
        router.push('/settings/team')
        return
      }

      const data = await response.json()
      setProfile(data.profile)
      setGroups(data.groups || [])
      setLoginActivity(data.loginActivity || [])
      setSelectedGroupIds(data.groups?.map((g: Group) => g.id) || [])

      // Initialize edit form
      setEditDisplayName(data.profile.display_name || '')
      setEditUsername(data.profile.username || '')
      setEditRole(data.profile.role || 'agent')

      // Fetch all available groups for the group selector
      const { data: groupsData } = await supabase
        .from('groups')
        .select('id, name, description')
        .eq('workspace_id', adminProfile.workspace_id)
        .order('name')

      setAllGroups(groupsData || [])
    } catch (error) {
      console.error('Error loading user data:', error)
      addToast('Failed to load user data', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleSaveProfile = async () => {
    if (!profile) return
    setEditLoading(true)

    try {
      const response = await fetch(`/api/team/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: editDisplayName,
          username: editUsername,
          role: editRole,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        addToast(data.error || 'Failed to update profile', 'error')
        return
      }

      setProfile(data.profile)
      setIsEditing(false)
      addToast('Profile updated successfully', 'success')
    } catch (error) {
      console.error('Error updating profile:', error)
      addToast('Failed to update profile', 'error')
    } finally {
      setEditLoading(false)
    }
  }

  const handleResetPassword = async () => {
    setPasswordLoading(true)
    setGeneratedPassword(null)

    try {
      const response = await fetch(`/api/team/users/${userId}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          passwordMode === 'auto'
            ? { auto_generate: true }
            : { password: manualPassword }
        ),
      })

      const data = await response.json()

      if (!response.ok) {
        addToast(data.error || 'Failed to reset password', 'error')
        return
      }

      setGeneratedPassword(data.password)
      addToast('Password reset successfully', 'success')
    } catch (error) {
      console.error('Error resetting password:', error)
      addToast('Failed to reset password', 'error')
    } finally {
      setPasswordLoading(false)
    }
  }

  const handleUpdateGroups = async () => {
    setGroupLoading(true)

    try {
      const response = await fetch(`/api/team/users/${userId}/groups`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_ids: selectedGroupIds }),
      })

      const data = await response.json()

      if (!response.ok) {
        addToast(data.error || 'Failed to update groups', 'error')
        return
      }

      setGroups(data.groups || [])
      setShowGroupModal(false)

      if (data.warning) {
        addToast(data.warning, 'warning')
      } else {
        addToast('Groups updated successfully', 'success')
      }
    } catch (error) {
      console.error('Error updating groups:', error)
      addToast('Failed to update groups', 'error')
    } finally {
      setGroupLoading(false)
    }
  }

  const handleDeleteUser = async () => {
    setDeleteLoading(true)

    try {
      const response = await fetch(`/api/team/users/${userId}`, {
        method: 'DELETE',
      })

      const data = await response.json()

      if (!response.ok) {
        addToast(data.error || 'Failed to delete user', 'error')
        return
      }

      addToast('User deleted successfully', 'success')
      router.push('/settings/team')
    } catch (error) {
      console.error('Error deleting user:', error)
      addToast('Failed to delete user', 'error')
    } finally {
      setDeleteLoading(false)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    addToast('Copied to clipboard', 'success')
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Never'
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getRoleBadgeClass = (role: string) => {
    switch (role) {
      case 'main_admin':
        return 'bg-purple-100 text-purple-800'
      case 'admin':
        return 'bg-blue-100 text-blue-800'
      case 'viewer':
        return 'bg-gray-100 text-gray-600'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const getEventTypeLabel = (eventType: string) => {
    switch (eventType) {
      case 'login_success':
        return { label: 'Login', class: 'bg-green-100 text-green-800' }
      case 'login_failed':
        return { label: 'Failed Login', class: 'bg-red-100 text-red-800' }
      case 'logout':
        return { label: 'Logout', class: 'bg-gray-100 text-gray-800' }
      case 'password_changed':
        return { label: 'Password Changed', class: 'bg-blue-100 text-blue-800' }
      case 'password_reset':
        return { label: 'Password Reset', class: 'bg-orange-100 text-orange-800' }
      default:
        return { label: eventType, class: 'bg-gray-100 text-gray-800' }
    }
  }

  const parseUserAgent = (ua: string | null) => {
    if (!ua) return 'Unknown device'
    // Simple parsing - could use a proper UA parser library
    if (ua.includes('Chrome')) return 'Chrome'
    if (ua.includes('Firefox')) return 'Firefox'
    if (ua.includes('Safari')) return 'Safari'
    if (ua.includes('Edge')) return 'Edge'
    return 'Unknown browser'
  }

  const canEditRole = () => {
    if (!profile) return false
    // Only main_admin can change roles
    if (!isMainAdmin) return false
    // Cannot change your own role
    if (profile.user_id === currentUserId) return false
    return true
  }

  const canResetPassword = () => {
    if (!profile) return false
    // Only main_admin can reset passwords
    if (!isMainAdmin) return false
    // Cannot reset your own password via this endpoint
    if (profile.user_id === currentUserId) return false
    return true
  }

  const canDeleteUser = () => {
    if (!profile) return false
    // Cannot delete yourself
    if (profile.user_id === currentUserId) return false
    // Only main_admin can delete admins
    if (['main_admin', 'admin'].includes(profile.role) && !isMainAdmin) return false
    return true
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    )
  }

  if (!isAdmin || !profile) {
    return null
  }

  return (
    <div className="flex-1">
      {/* Header */}
      <header className="border-b bg-white px-8 py-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => router.push('/settings/team')}>
            &larr; Back
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-semibold text-gray-900">
              {profile.display_name || 'User Details'}
            </h1>
            <p className="text-sm text-gray-500">
              @{profile.username || 'unnamed'} &middot; Joined {formatDate(profile.created_at)}
            </p>
          </div>
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${getRoleBadgeClass(profile.role)}`}
          >
            {profile.role.replace('_', ' ')}
          </span>
        </div>
      </header>

      <main className="max-w-4xl p-8 space-y-8">
        {/* Profile Section */}
        <section className="rounded-lg border bg-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Profile Information</h2>
            {!isEditing && (
              <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                Edit
              </Button>
            )}
          </div>

          {isEditing ? (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="displayName">Display Name</Label>
                  <Input
                    id="displayName"
                    value={editDisplayName}
                    onChange={(e) => setEditDisplayName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      @
                    </span>
                    <Input
                      id="username"
                      value={editUsername}
                      onChange={(e) =>
                        setEditUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))
                      }
                      className="pl-8"
                    />
                  </div>
                </div>
                {canEditRole() && (
                  <div className="space-y-2">
                    <Label htmlFor="role">Role</Label>
                    <select
                      id="role"
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="agent">Agent</option>
                      <option value="admin">Admin</option>
                      <option value="main_admin">Main Admin</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button onClick={handleSaveProfile} disabled={editLoading}>
                  {editLoading ? 'Saving...' : 'Save Changes'}
                </Button>
                <Button variant="outline" onClick={() => setIsEditing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-sm text-muted-foreground">Display Name</p>
                <p className="font-medium">{profile.display_name || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Username</p>
                <p className="font-medium">@{profile.username || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Email</p>
                <p className="font-medium">{profile.email || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Last Sign In</p>
                <p className="font-medium">{formatDate(profile.last_sign_in_at)}</p>
              </div>
            </div>
          )}
        </section>

        {/* Quick Actions */}
        <section className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
          <div className="flex flex-wrap gap-3">
            {canResetPassword() && (
              <Button variant="outline" onClick={() => setShowPasswordModal(true)}>
                Reset Password
              </Button>
            )}
            {canDeleteUser() && (
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => setShowDeleteConfirm(true)}
              >
                Delete User
              </Button>
            )}
          </div>
        </section>

        {/* Group Memberships */}
        <section className="rounded-lg border bg-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Group Memberships</h2>
              <p className="text-sm text-muted-foreground">
                Groups control which channels this user can access
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setShowGroupModal(true)}>
              Manage Groups
            </Button>
          </div>

          {groups.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {profile.role === 'main_admin'
                ? 'Main admins have access to all channels regardless of group membership.'
                : 'No group memberships. This user cannot access any channels.'}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {groups.map((group) => (
                <span
                  key={group.id}
                  className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary"
                >
                  {group.name}
                </span>
              ))}
            </div>
          )}
        </section>

        {/* Login Activity */}
        <section className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-semibold mb-4">Recent Login Activity</h2>
          {loginActivity.length === 0 ? (
            <p className="text-muted-foreground text-sm">No login activity recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium">Event</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Date & Time</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">IP Address</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Device</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loginActivity.map((activity) => {
                    const eventType = getEventTypeLabel(activity.event_type)
                    return (
                      <tr key={activity.id}>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${eventType.class}`}
                          >
                            {eventType.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm">{formatDate(activity.created_at)}</td>
                        <td className="px-4 py-3 text-sm font-mono">
                          {activity.ip_address || '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {parseUserAgent(activity.user_agent)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {/* Password Reset Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
            <h3 className="text-lg font-semibold mb-4">Reset Password</h3>

            {generatedPassword ? (
              <div className="space-y-4">
                <div className="rounded-md bg-green-50 p-4">
                  <p className="text-sm text-green-800 mb-2">
                    Password reset successfully. Share this password securely with the user:
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 rounded bg-white p-2 font-mono text-sm">
                      {generatedPassword}
                    </code>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => copyToClipboard(generatedPassword)}
                    >
                      Copy
                    </Button>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  This password will only be shown once. The user should change it after logging in.
                </p>
                <Button
                  className="w-full"
                  onClick={() => {
                    setShowPasswordModal(false)
                    setGeneratedPassword(null)
                    setManualPassword('')
                  }}
                >
                  Done
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex gap-2">
                  <Button
                    variant={passwordMode === 'auto' ? 'default' : 'outline'}
                    onClick={() => setPasswordMode('auto')}
                    className="flex-1"
                  >
                    Auto-generate
                  </Button>
                  <Button
                    variant={passwordMode === 'manual' ? 'default' : 'outline'}
                    onClick={() => setPasswordMode('manual')}
                    className="flex-1"
                  >
                    Set manually
                  </Button>
                </div>

                {passwordMode === 'manual' && (
                  <div className="space-y-2">
                    <Label htmlFor="newPassword">New Password</Label>
                    <Input
                      id="newPassword"
                      type="text"
                      placeholder="Min 8 characters"
                      value={manualPassword}
                      onChange={(e) => setManualPassword(e.target.value)}
                    />
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    onClick={handleResetPassword}
                    disabled={passwordLoading || (passwordMode === 'manual' && manualPassword.length < 8)}
                  >
                    {passwordLoading ? 'Resetting...' : 'Reset Password'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowPasswordModal(false)
                      setManualPassword('')
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Group Management Modal */}
      {showGroupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
            <h3 className="text-lg font-semibold mb-4">Manage Group Memberships</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Select which groups this user should belong to. Group membership determines channel access.
            </p>

            <div className="max-h-64 overflow-y-auto space-y-2 mb-4">
              {allGroups.length === 0 ? (
                <p className="text-sm text-muted-foreground">No groups available.</p>
              ) : (
                allGroups.map((group) => (
                  <label
                    key={group.id}
                    className="flex items-center gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedGroupIds.includes(group.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedGroupIds([...selectedGroupIds, group.id])
                        } else {
                          setSelectedGroupIds(selectedGroupIds.filter((id) => id !== group.id))
                        }
                      }}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    <div>
                      <p className="font-medium">{group.name}</p>
                      {group.description && (
                        <p className="text-sm text-muted-foreground">{group.description}</p>
                      )}
                    </div>
                  </label>
                ))
              )}
            </div>

            {selectedGroupIds.length === 0 && profile.role !== 'main_admin' && (
              <div className="rounded-md bg-orange-50 p-3 mb-4">
                <p className="text-sm text-orange-800">
                  Warning: Removing all groups will revoke this user&apos;s access to all channels.
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <Button onClick={handleUpdateGroups} disabled={groupLoading}>
                {groupLoading ? 'Saving...' : 'Save Changes'}
              </Button>
              <Button variant="outline" onClick={() => setShowGroupModal(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
            <h3 className="text-lg font-semibold mb-4">Delete User</h3>
            <p className="text-muted-foreground mb-4">
              Are you sure you want to delete <strong>{profile.display_name}</strong>? This action
              cannot be undone.
            </p>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                onClick={handleDeleteUser}
                disabled={deleteLoading}
              >
                {deleteLoading ? 'Deleting...' : 'Delete User'}
              </Button>
              <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
