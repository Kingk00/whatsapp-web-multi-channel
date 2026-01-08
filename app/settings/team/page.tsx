'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/toast'

interface TeamMember {
  user_id: string
  display_name: string
  username: string | null
  role: string
  created_at: string
}

export default function TeamSettingsPage() {
  const router = useRouter()
  const supabase = createClient()
  const { addToast } = useToast()

  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [isMainAdmin, setIsMainAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [members, setMembers] = useState<TeamMember[]>([])

  // Create user form
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [formUsername, setFormUsername] = useState('')
  const [formDisplayName, setFormDisplayName] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formPassword, setFormPassword] = useState('')
  const [formRole, setFormRole] = useState('agent')
  const [formLoading, setFormLoading] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Delete confirmation
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  useEffect(() => {
    checkAccess()
  }, [])

  const checkAccess = async () => {
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

      const { data: profile } = await supabase
        .from('profiles')
        .select('role, workspace_id')
        .eq('user_id', user.id)
        .single()

      if (!profile || !['main_admin', 'admin'].includes(profile.role)) {
        router.push('/inbox')
        return
      }

      setIsAdmin(true)
      setIsMainAdmin(profile.role === 'main_admin')
      setWorkspaceId(profile.workspace_id)

      await fetchMembers(profile.workspace_id)
    } catch (error) {
      console.error('Error checking access:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchMembers = async (wsId: string) => {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('user_id, display_name, username, role, created_at')
        .eq('workspace_id', wsId)
        .order('created_at', { ascending: true })

      setMembers(data || [])
    } catch (error) {
      console.error('Error fetching members:', error)
    }
  }

  const resetForm = () => {
    setFormUsername('')
    setFormDisplayName('')
    setFormEmail('')
    setFormPassword('')
    setFormRole('agent')
    setFormError(null)
  }

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    setFormLoading(true)

    try {
      const response = await fetch('/api/team/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: formUsername,
          displayName: formDisplayName,
          email: formEmail,
          password: formPassword,
          role: formRole,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setFormError(data.error || 'Failed to create user')
        addToast(data.error || 'Failed to create user', 'error')
        return
      }

      addToast('User created successfully', 'success')
      resetForm()
      setShowCreateForm(false)
      if (workspaceId) {
        await fetchMembers(workspaceId)
      }
    } catch (error) {
      setFormError('Failed to create user')
      addToast('Failed to create user', 'error')
    } finally {
      setFormLoading(false)
    }
  }

  const handleDeleteUser = async (userId: string) => {
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
      setDeletingUserId(null)
      if (workspaceId) {
        await fetchMembers(workspaceId)
      }
    } catch (error) {
      console.error('Error deleting user:', error)
      addToast('Failed to delete user', 'error')
    } finally {
      setDeleteLoading(false)
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const getRoleBadgeClass = (role: string) => {
    switch (role) {
      case 'main_admin':
        return 'bg-purple-100 text-purple-800'
      case 'admin':
        return 'bg-blue-100 text-blue-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const canDeleteUser = (member: TeamMember) => {
    // Cannot delete yourself
    if (member.user_id === currentUserId) return false
    // Only main_admin can delete admins
    if (['main_admin', 'admin'].includes(member.role) && !isMainAdmin) return false
    return true
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    )
  }

  if (!isAdmin) {
    return null
  }

  return (
    <div className="flex-1">
      {/* Header */}
      <header className="border-b bg-white px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Team Management</h1>
            <p className="text-sm text-gray-500">Create and manage team members</p>
          </div>
          {!showCreateForm && (
            <Button onClick={() => setShowCreateForm(true)}>+ Add User</Button>
          )}
        </div>
      </header>

      <main className="max-w-4xl p-8">
        {/* Create User Form */}
        {showCreateForm && (
          <section className="mb-8">
            <div className="rounded-lg border bg-card p-6">
              <h3 className="text-lg font-semibold mb-4">Create New User</h3>
              <form onSubmit={handleCreateUser} className="space-y-4">
                {formError && (
                  <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                    {formError}
                  </div>
                )}

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="username">Username *</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                        @
                      </span>
                      <Input
                        id="username"
                        type="text"
                        placeholder="johndoe"
                        value={formUsername}
                        onChange={(e) =>
                          setFormUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))
                        }
                        className="pl-8"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="displayName">Display Name *</Label>
                    <Input
                      id="displayName"
                      type="text"
                      placeholder="John Doe"
                      value={formDisplayName}
                      onChange={(e) => setFormDisplayName(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email">Email (optional)</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="john@example.com (auto-generated if empty)"
                      value={formEmail}
                      onChange={(e) => setFormEmail(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password">Password *</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="Min 8 characters"
                      value={formPassword}
                      onChange={(e) => setFormPassword(e.target.value)}
                      minLength={8}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="role">Role</Label>
                    <select
                      id="role"
                      value={formRole}
                      onChange={(e) => setFormRole(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <option value="agent">Agent</option>
                      <option value="admin">Admin</option>
                      {isMainAdmin && <option value="main_admin">Main Admin</option>}
                    </select>
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <Button type="submit" disabled={formLoading}>
                    {formLoading ? 'Creating...' : 'Create User'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowCreateForm(false)
                      resetForm()
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </div>
          </section>
        )}

        {/* Team Members */}
        <section>
          <h2 className="text-lg font-semibold mb-4">Team Members ({members.length})</h2>
          <div className="rounded-lg border bg-card overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium">Username</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Display Name</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Role</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Joined</th>
                  <th className="px-4 py-3 text-right text-sm font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {members.map((member) => (
                  <tr key={member.user_id}>
                    <td className="px-4 py-3 text-sm font-medium">
                      @{member.username || member.display_name?.toLowerCase().replace(/\s+/g, '') || 'unnamed'}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {member.display_name || 'Unnamed'}
                      {member.user_id === currentUserId && (
                        <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getRoleBadgeClass(member.role)}`}
                      >
                        {member.role.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {formatDate(member.created_at)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canDeleteUser(member) && (
                        <>
                          {deletingUserId === member.user_id ? (
                            <div className="flex items-center justify-end gap-2">
                              <span className="text-sm text-muted-foreground">Delete?</span>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => handleDeleteUser(member.user_id)}
                                disabled={deleteLoading}
                              >
                                {deleteLoading ? '...' : 'Yes'}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setDeletingUserId(null)}
                                disabled={deleteLoading}
                              >
                                No
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              onClick={() => setDeletingUserId(member.user_id)}
                            >
                              Delete
                            </Button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  )
}
