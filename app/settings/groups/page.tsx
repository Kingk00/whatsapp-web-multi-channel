'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/toast'

interface Group {
  id: string
  name: string
  created_at: string
  member_count: number
  channel_count: number
}

interface GroupMember {
  user_id: string
  display_name: string
  username: string
  role: string
}

interface GroupChannel {
  id: string
  name: string
  phone_number: string | null
  status: string
}

interface GroupDetail extends Group {
  members: GroupMember[]
  channels: GroupChannel[]
}

interface WorkspaceUser {
  user_id: string
  display_name: string
  username: string
  role: string
}

interface WorkspaceChannel {
  id: string
  name: string
  phone_number: string | null
  status: string
}

export default function GroupsSettingsPage() {
  const router = useRouter()
  const supabase = createClient()
  const { addToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [groups, setGroups] = useState<Group[]>([])
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null)
  const [expandedGroupDetail, setExpandedGroupDetail] = useState<GroupDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  // Create group form
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [creating, setCreating] = useState(false)

  // Delete confirmation
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // Add member dialog
  const [showAddMember, setShowAddMember] = useState(false)
  const [workspaceUsers, setWorkspaceUsers] = useState<WorkspaceUser[]>([])
  const [addingMember, setAddingMember] = useState(false)

  // Add channel dialog
  const [showAddChannel, setShowAddChannel] = useState(false)
  const [workspaceChannels, setWorkspaceChannels] = useState<WorkspaceChannel[]>([])
  const [addingChannel, setAddingChannel] = useState(false)

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
      await fetchGroups()
    } catch (error) {
      console.error('Error checking access:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchGroups = async () => {
    try {
      const response = await fetch('/api/groups')
      const data = await response.json()

      if (response.ok) {
        setGroups(data.groups || [])
      } else {
        addToast(data.error || 'Failed to fetch groups', 'error')
      }
    } catch (error) {
      console.error('Error fetching groups:', error)
      addToast('Failed to fetch groups', 'error')
    }
  }

  const fetchGroupDetail = async (groupId: string) => {
    setLoadingDetail(true)
    try {
      const response = await fetch(`/api/groups/${groupId}`)
      const data = await response.json()

      if (response.ok) {
        setExpandedGroupDetail(data.group)
      } else {
        addToast(data.error || 'Failed to fetch group details', 'error')
      }
    } catch (error) {
      console.error('Error fetching group detail:', error)
      addToast('Failed to fetch group details', 'error')
    } finally {
      setLoadingDetail(false)
    }
  }

  const handleExpandGroup = (groupId: string) => {
    if (expandedGroupId === groupId) {
      setExpandedGroupId(null)
      setExpandedGroupDetail(null)
    } else {
      setExpandedGroupId(groupId)
      fetchGroupDetail(groupId)
    }
  }

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newGroupName.trim()) return

    setCreating(true)
    try {
      const response = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newGroupName.trim() }),
      })

      const data = await response.json()

      if (response.ok) {
        addToast('Group created successfully', 'success')
        setNewGroupName('')
        setShowCreateForm(false)
        await fetchGroups()
      } else {
        addToast(data.error || 'Failed to create group', 'error')
      }
    } catch (error) {
      console.error('Error creating group:', error)
      addToast('Failed to create group', 'error')
    } finally {
      setCreating(false)
    }
  }

  const handleDeleteGroup = async (groupId: string) => {
    setDeleteLoading(true)
    try {
      const response = await fetch(`/api/groups/${groupId}`, {
        method: 'DELETE',
      })

      const data = await response.json()

      if (response.ok) {
        addToast('Group deleted successfully', 'success')
        setDeletingGroupId(null)
        if (expandedGroupId === groupId) {
          setExpandedGroupId(null)
          setExpandedGroupDetail(null)
        }
        await fetchGroups()
      } else {
        addToast(data.error || 'Failed to delete group', 'error')
      }
    } catch (error) {
      console.error('Error deleting group:', error)
      addToast('Failed to delete group', 'error')
    } finally {
      setDeleteLoading(false)
    }
  }

  const fetchWorkspaceUsers = async () => {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('user_id, display_name, username, role')
        .order('display_name')

      setWorkspaceUsers(data || [])
    } catch (error) {
      console.error('Error fetching users:', error)
    }
  }

  const fetchWorkspaceChannels = async () => {
    try {
      const { data } = await supabase
        .from('channels')
        .select('id, name, phone_number, status')
        .order('name')

      setWorkspaceChannels(data || [])
    } catch (error) {
      console.error('Error fetching channels:', error)
    }
  }

  const handleAddMember = async (userId: string) => {
    if (!expandedGroupId) return

    setAddingMember(true)
    try {
      const response = await fetch(`/api/groups/${expandedGroupId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      })

      const data = await response.json()

      if (response.ok) {
        addToast('Member added successfully', 'success')
        await fetchGroupDetail(expandedGroupId)
        await fetchGroups()
      } else {
        addToast(data.error || 'Failed to add member', 'error')
      }
    } catch (error) {
      console.error('Error adding member:', error)
      addToast('Failed to add member', 'error')
    } finally {
      setAddingMember(false)
    }
  }

  const handleRemoveMember = async (userId: string) => {
    if (!expandedGroupId) return

    try {
      const response = await fetch(`/api/groups/${expandedGroupId}/members/${userId}`, {
        method: 'DELETE',
      })

      const data = await response.json()

      if (response.ok) {
        addToast('Member removed successfully', 'success')
        await fetchGroupDetail(expandedGroupId)
        await fetchGroups()
      } else {
        addToast(data.error || 'Failed to remove member', 'error')
      }
    } catch (error) {
      console.error('Error removing member:', error)
      addToast('Failed to remove member', 'error')
    }
  }

  const handleAddChannel = async (channelId: string) => {
    if (!expandedGroupId) return

    setAddingChannel(true)
    try {
      const response = await fetch(`/api/groups/${expandedGroupId}/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_id: channelId }),
      })

      const data = await response.json()

      if (response.ok) {
        addToast('Channel added successfully', 'success')
        await fetchGroupDetail(expandedGroupId)
        await fetchGroups()
      } else {
        addToast(data.error || 'Failed to add channel', 'error')
      }
    } catch (error) {
      console.error('Error adding channel:', error)
      addToast('Failed to add channel', 'error')
    } finally {
      setAddingChannel(false)
    }
  }

  const handleRemoveChannel = async (channelId: string) => {
    if (!expandedGroupId) return

    try {
      const response = await fetch(`/api/groups/${expandedGroupId}/channels/${channelId}`, {
        method: 'DELETE',
      })

      const data = await response.json()

      if (response.ok) {
        addToast('Channel removed successfully', 'success')
        await fetchGroupDetail(expandedGroupId)
        await fetchGroups()
      } else {
        addToast(data.error || 'Failed to remove channel', 'error')
      }
    } catch (error) {
      console.error('Error removing channel:', error)
      addToast('Failed to remove channel', 'error')
    }
  }

  const openAddMemberDialog = () => {
    fetchWorkspaceUsers()
    setShowAddMember(true)
  }

  const openAddChannelDialog = () => {
    fetchWorkspaceChannels()
    setShowAddChannel(true)
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

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800'
      case 'pending_qr':
        return 'bg-yellow-100 text-yellow-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  // Get users not already in the group
  const availableUsers = expandedGroupDetail
    ? workspaceUsers.filter(
        (u) => !expandedGroupDetail.members.some((m) => m.user_id === u.user_id)
      )
    : workspaceUsers

  // Get channels not already in the group
  const availableChannels = expandedGroupDetail
    ? workspaceChannels.filter(
        (c) => !expandedGroupDetail.channels.some((gc) => gc.id === c.id)
      )
    : workspaceChannels

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
            <h1 className="text-2xl font-semibold text-gray-900">Groups</h1>
            <p className="text-sm text-gray-500">
              Create groups and assign team members and channels
            </p>
          </div>
          {!showCreateForm && (
            <Button onClick={() => setShowCreateForm(true)}>+ Create Group</Button>
          )}
        </div>
      </header>

      <main className="max-w-4xl p-8">
        {/* Create Group Form */}
        {showCreateForm && (
          <section className="mb-8">
            <div className="rounded-lg border bg-card p-6">
              <h3 className="text-lg font-semibold mb-4">Create New Group</h3>
              <form onSubmit={handleCreateGroup} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="groupName">Group Name *</Label>
                  <Input
                    id="groupName"
                    type="text"
                    placeholder="e.g., Sales Team"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    required
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <Button type="submit" disabled={creating}>
                    {creating ? 'Creating...' : 'Create Group'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowCreateForm(false)
                      setNewGroupName('')
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </div>
          </section>
        )}

        {/* Groups List */}
        <section>
          <h2 className="text-lg font-semibold mb-4">
            Groups ({groups.length})
          </h2>

          {groups.length === 0 ? (
            <div className="rounded-lg border bg-card p-8 text-center">
              <p className="text-muted-foreground">
                No groups yet. Create your first group to organize team members and channels.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {groups.map((group) => (
                <div
                  key={group.id}
                  className="rounded-lg border bg-card overflow-hidden"
                >
                  {/* Group Header */}
                  <div
                    className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/50"
                    onClick={() => handleExpandGroup(group.id)}
                  >
                    <div className="flex items-center gap-3">
                      <svg
                        className={`h-5 w-5 text-gray-400 transition-transform ${
                          expandedGroupId === group.id ? 'rotate-90' : ''
                        }`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 5l7 7-7 7"
                        />
                      </svg>
                      <div>
                        <h3 className="font-medium">{group.name}</h3>
                        <p className="text-xs text-muted-foreground">
                          Created {formatDate(group.created_at)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-4 text-sm">
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                          </svg>
                          {group.member_count} members
                        </span>
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                          </svg>
                          {group.channel_count} channels
                        </span>
                      </div>

                      {/* Delete button */}
                      {deletingGroupId === group.id ? (
                        <div
                          className="flex items-center gap-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="text-sm text-muted-foreground">Delete?</span>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleDeleteGroup(group.id)}
                            disabled={deleteLoading}
                          >
                            {deleteLoading ? '...' : 'Yes'}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setDeletingGroupId(null)}
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
                          onClick={(e) => {
                            e.stopPropagation()
                            setDeletingGroupId(group.id)
                          }}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Expanded Detail */}
                  {expandedGroupId === group.id && (
                    <div className="border-t px-4 py-4 bg-muted/20">
                      {loadingDetail ? (
                        <div className="text-center py-8 text-muted-foreground">
                          Loading...
                        </div>
                      ) : expandedGroupDetail ? (
                        <div className="grid gap-6 md:grid-cols-2">
                          {/* Members Section */}
                          <div>
                            <div className="flex items-center justify-between mb-3">
                              <h4 className="font-medium">Members</h4>
                              <Button size="sm" onClick={openAddMemberDialog}>
                                + Add
                              </Button>
                            </div>

                            {expandedGroupDetail.members.length === 0 ? (
                              <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg bg-card">
                                No members yet
                              </p>
                            ) : (
                              <div className="space-y-2">
                                {expandedGroupDetail.members.map((member) => (
                                  <div
                                    key={member.user_id}
                                    className="flex items-center justify-between p-2 rounded-lg border bg-card"
                                  >
                                    <div>
                                      <p className="font-medium text-sm">
                                        {member.display_name}
                                      </p>
                                      <p className="text-xs text-muted-foreground">
                                        @{member.username || 'unnamed'}
                                      </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span
                                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getRoleBadgeClass(
                                          member.role
                                        )}`}
                                      >
                                        {member.role.replace('_', ' ')}
                                      </span>
                                      <button
                                        onClick={() => handleRemoveMember(member.user_id)}
                                        className="text-red-500 hover:text-red-700 p-1"
                                        title="Remove member"
                                      >
                                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Channels Section */}
                          <div>
                            <div className="flex items-center justify-between mb-3">
                              <h4 className="font-medium">Channels</h4>
                              <Button size="sm" onClick={openAddChannelDialog}>
                                + Add
                              </Button>
                            </div>

                            {expandedGroupDetail.channels.length === 0 ? (
                              <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg bg-card">
                                No channels yet
                              </p>
                            ) : (
                              <div className="space-y-2">
                                {expandedGroupDetail.channels.map((channel) => (
                                  <div
                                    key={channel.id}
                                    className="flex items-center justify-between p-2 rounded-lg border bg-card"
                                  >
                                    <div>
                                      <p className="font-medium text-sm">{channel.name}</p>
                                      <p className="text-xs text-muted-foreground">
                                        {channel.phone_number || 'No phone'}
                                      </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span
                                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getStatusBadgeClass(
                                          channel.status
                                        )}`}
                                      >
                                        {channel.status}
                                      </span>
                                      <button
                                        onClick={() => handleRemoveChannel(channel.id)}
                                        className="text-red-500 hover:text-red-700 p-1"
                                        title="Remove channel"
                                      >
                                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* Add Member Dialog */}
      {showAddMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card rounded-lg shadow-lg w-full max-w-md mx-4 max-h-[80vh] overflow-hidden">
            <div className="p-4 border-b">
              <h3 className="text-lg font-semibold">Add Member</h3>
              <p className="text-sm text-muted-foreground">
                Select a team member to add to this group
              </p>
            </div>
            <div className="p-4 overflow-y-auto max-h-96">
              {availableUsers.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  All team members are already in this group
                </p>
              ) : (
                <div className="space-y-2">
                  {availableUsers.map((user) => (
                    <button
                      key={user.user_id}
                      onClick={() => {
                        handleAddMember(user.user_id)
                        setShowAddMember(false)
                      }}
                      disabled={addingMember}
                      className="w-full flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                    >
                      <div className="text-left">
                        <p className="font-medium">{user.display_name}</p>
                        <p className="text-sm text-muted-foreground">
                          @{user.username || 'unnamed'}
                        </p>
                      </div>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getRoleBadgeClass(
                          user.role
                        )}`}
                      >
                        {user.role.replace('_', ' ')}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="p-4 border-t">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setShowAddMember(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Add Channel Dialog */}
      {showAddChannel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card rounded-lg shadow-lg w-full max-w-md mx-4 max-h-[80vh] overflow-hidden">
            <div className="p-4 border-b">
              <h3 className="text-lg font-semibold">Add Channel</h3>
              <p className="text-sm text-muted-foreground">
                Select a channel to add to this group
              </p>
            </div>
            <div className="p-4 overflow-y-auto max-h-96">
              {availableChannels.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  All channels are already in this group
                </p>
              ) : (
                <div className="space-y-2">
                  {availableChannels.map((channel) => (
                    <button
                      key={channel.id}
                      onClick={() => {
                        handleAddChannel(channel.id)
                        setShowAddChannel(false)
                      }}
                      disabled={addingChannel}
                      className="w-full flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                    >
                      <div className="text-left">
                        <p className="font-medium">{channel.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {channel.phone_number || 'No phone number'}
                        </p>
                      </div>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getStatusBadgeClass(
                          channel.status
                        )}`}
                      >
                        {channel.status}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="p-4 border-t">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setShowAddChannel(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
