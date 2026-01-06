'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Invite {
  id: string
  email: string
  role: string
  expires_at: string
  used: boolean
  created_at: string
}

interface TeamMember {
  user_id: string
  display_name: string
  role: string
  created_at: string
}

export default function TeamSettingsPage() {
  const router = useRouter()
  const supabase = createClient()
  const [isAdmin, setIsAdmin] = useState(false)
  const [isMainAdmin, setIsMainAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [invites, setInvites] = useState<Invite[]>([])
  const [members, setMembers] = useState<TeamMember[]>([])

  // Invite form
  const [showInviteForm, setShowInviteForm] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('agent')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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

      // Load team data
      await Promise.all([fetchInvites(), fetchMembers(profile.workspace_id)])
    } catch (error) {
      console.error('Error checking access:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchInvites = async () => {
    try {
      const response = await fetch('/api/team/invites')
      if (response.ok) {
        const data = await response.json()
        setInvites(data.invites || [])
      }
    } catch (error) {
      console.error('Error fetching invites:', error)
    }
  }

  const fetchMembers = async (workspaceId: string) => {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('user_id, display_name, role, created_at')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: true })

      setMembers(data || [])
    } catch (error) {
      console.error('Error fetching members:', error)
    }
  }

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setInviteUrl(null)
    setInviteLoading(true)

    try {
      const response = await fetch('/api/team/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to create invite')
        return
      }

      setInviteUrl(data.inviteUrl)
      setInviteEmail('')
      await fetchInvites()
    } catch (error) {
      setError('Failed to create invite')
    } finally {
      setInviteLoading(false)
    }
  }

  const handleRevokeInvite = async (inviteId: string) => {
    try {
      const response = await fetch(`/api/team/invites?id=${inviteId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        await fetchInvites()
      }
    } catch (error) {
      console.error('Error revoking invite:', error)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
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
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Team Management</h1>
            <p className="text-sm text-muted-foreground">
              Invite and manage team members
            </p>
          </div>
          <Button variant="outline" onClick={() => router.push('/inbox')}>
            Back to Inbox
          </Button>
        </div>
      </header>

      <main className="container mx-auto max-w-4xl px-6 py-8">
        {/* Invite Section */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Invite New Member</h2>
            {!showInviteForm && (
              <Button onClick={() => setShowInviteForm(true)}>
                + New Invite
              </Button>
            )}
          </div>

          {showInviteForm && (
            <div className="rounded-lg border bg-card p-6">
              <form onSubmit={handleCreateInvite} className="space-y-4">
                {error && (
                  <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                    {error}
                  </div>
                )}

                {inviteUrl && (
                  <div className="rounded-md bg-green-50 p-4">
                    <p className="text-sm font-medium text-green-800 mb-2">
                      Invite created! Share this link:
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 rounded bg-white p-2 text-xs break-all">
                        {inviteUrl}
                      </code>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => copyToClipboard(inviteUrl)}
                      >
                        Copy
                      </Button>
                    </div>
                  </div>
                )}

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email Address</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="colleague@example.com"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="role">Role</Label>
                    <select
                      id="role"
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <option value="agent">Agent</option>
                      <option value="admin">Admin</option>
                      {isMainAdmin && (
                        <option value="main_admin">Main Admin</option>
                      )}
                    </select>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button type="submit" disabled={inviteLoading}>
                    {inviteLoading ? 'Creating...' : 'Create Invite'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowInviteForm(false)
                      setInviteUrl(null)
                      setError(null)
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </div>
          )}
        </section>

        {/* Pending Invites */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-4">Pending Invites</h2>
          {invites.filter((i) => !i.used).length === 0 ? (
            <p className="text-muted-foreground text-sm">No pending invites</p>
          ) : (
            <div className="rounded-lg border bg-card overflow-hidden">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium">
                      Email
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium">
                      Role
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium">
                      Expires
                    </th>
                    <th className="px-4 py-3 text-right text-sm font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {invites
                    .filter((i) => !i.used)
                    .map((invite) => (
                      <tr key={invite.id}>
                        <td className="px-4 py-3 text-sm">{invite.email}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getRoleBadgeClass(invite.role)}`}
                          >
                            {invite.role.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {formatDate(invite.expires_at)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() => handleRevokeInvite(invite.id)}
                          >
                            Revoke
                          </Button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Team Members */}
        <section>
          <h2 className="text-lg font-semibold mb-4">Team Members</h2>
          <div className="rounded-lg border bg-card overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium">
                    Name
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium">
                    Role
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium">
                    Joined
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {members.map((member) => (
                  <tr key={member.user_id}>
                    <td className="px-4 py-3 text-sm font-medium">
                      {member.display_name || 'Unnamed'}
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
