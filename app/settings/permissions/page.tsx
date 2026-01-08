'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'

interface Permission {
  key: string
  label: string
  description: string
  category: string
}

interface RolePermission {
  permission_key: string
  enabled: boolean
}

const AVAILABLE_PERMISSIONS: Permission[] = [
  // Chat Management
  {
    key: 'chat.archive',
    label: 'Archive Chats',
    description: 'Allow archiving and unarchiving chats',
    category: 'Chat Management',
  },
  {
    key: 'chat.delete',
    label: 'Delete Chats',
    description: 'Allow permanently deleting chats and messages',
    category: 'Chat Management',
  },
  {
    key: 'chat.mute',
    label: 'Mute Chats',
    description: 'Allow muting and unmuting chat notifications',
    category: 'Chat Management',
  },
  // Messaging
  {
    key: 'message.send',
    label: 'Send Messages',
    description: 'Allow sending messages to contacts',
    category: 'Messaging',
  },
  {
    key: 'message.send_media',
    label: 'Send Media',
    description: 'Allow sending images, videos, and documents',
    category: 'Messaging',
  },
  {
    key: 'message.view_once',
    label: 'Send View-Once',
    description: 'Allow sending view-once photos and videos',
    category: 'Messaging',
  },
  // Quick Replies
  {
    key: 'quick_reply.create',
    label: 'Create Quick Replies',
    description: 'Allow creating new quick reply templates',
    category: 'Quick Replies',
  },
  {
    key: 'quick_reply.edit',
    label: 'Edit Quick Replies',
    description: 'Allow editing existing quick reply templates',
    category: 'Quick Replies',
  },
  {
    key: 'quick_reply.delete',
    label: 'Delete Quick Replies',
    description: 'Allow deleting quick reply templates',
    category: 'Quick Replies',
  },
  // Contacts
  {
    key: 'contact.create',
    label: 'Create Contacts',
    description: 'Allow creating new contacts',
    category: 'Contacts',
  },
  {
    key: 'contact.edit',
    label: 'Edit Contacts',
    description: 'Allow editing contact information',
    category: 'Contacts',
  },
  {
    key: 'contact.delete',
    label: 'Delete Contacts',
    description: 'Allow deleting contacts',
    category: 'Contacts',
  },
  {
    key: 'contact.import',
    label: 'Import Contacts',
    description: 'Allow importing contacts from Google or CSV',
    category: 'Contacts',
  },
]

const ROLES = ['admin', 'agent', 'viewer'] as const
type Role = (typeof ROLES)[number]

const DEFAULT_PERMISSIONS: Record<Role, string[]> = {
  admin: AVAILABLE_PERMISSIONS.map((p) => p.key),
  agent: [
    'chat.archive',
    'chat.mute',
    'message.send',
    'message.send_media',
    'quick_reply.create',
    'quick_reply.edit',
    'contact.create',
    'contact.edit',
  ],
  viewer: [],
}

export default function PermissionsSettingsPage() {
  const router = useRouter()
  const supabase = createClient()
  const { addToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [permissions, setPermissions] = useState<Record<Role, RolePermission[]>>({
    admin: [],
    agent: [],
    viewer: [],
  })

  useEffect(() => {
    checkAccessAndLoad()
  }, [])

  const checkAccessAndLoad = async () => {
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

      if (!profile || profile.role !== 'main_admin') {
        router.push('/inbox')
        return
      }

      setWorkspaceId(profile.workspace_id)

      // Load existing permissions
      const { data: rolePerms } = await supabase
        .from('role_permissions')
        .select('role, permission_key, enabled')
        .eq('workspace_id', profile.workspace_id)

      // Build permissions map
      const permMap: Record<Role, RolePermission[]> = {
        admin: [],
        agent: [],
        viewer: [],
      }

      ROLES.forEach((role) => {
        AVAILABLE_PERMISSIONS.forEach((perm) => {
          const existing = rolePerms?.find(
            (rp: { role: string; permission_key: string; enabled: boolean }) => rp.role === role && rp.permission_key === perm.key
          )
          permMap[role].push({
            permission_key: perm.key,
            enabled: existing ? existing.enabled : DEFAULT_PERMISSIONS[role].includes(perm.key),
          })
        })
      })

      setPermissions(permMap)
    } catch (error) {
      console.error('Error loading permissions:', error)
      addToast('Failed to load permissions', 'error')
    } finally {
      setLoading(false)
    }
  }

  const togglePermission = (role: Role, permKey: string) => {
    setPermissions((prev) => ({
      ...prev,
      [role]: prev[role].map((p) =>
        p.permission_key === permKey ? { ...p, enabled: !p.enabled } : p
      ),
    }))
  }

  const savePermissions = async () => {
    if (!workspaceId) return

    setSaving(true)
    try {
      // Prepare all permission records
      const records: { workspace_id: string; role: string; permission_key: string; enabled: boolean }[] = []

      ROLES.forEach((role) => {
        permissions[role].forEach((perm) => {
          records.push({
            workspace_id: workspaceId,
            role,
            permission_key: perm.permission_key,
            enabled: perm.enabled,
          })
        })
      })

      // Upsert all permissions
      const { error } = await supabase
        .from('role_permissions')
        .upsert(records, { onConflict: 'workspace_id,role,permission_key' })

      if (error) throw error

      addToast('Permissions saved successfully', 'success')
    } catch (error) {
      console.error('Error saving permissions:', error)
      addToast('Failed to save permissions', 'error')
    } finally {
      setSaving(false)
    }
  }

  const resetToDefaults = (role: Role) => {
    setPermissions((prev) => ({
      ...prev,
      [role]: AVAILABLE_PERMISSIONS.map((perm) => ({
        permission_key: perm.key,
        enabled: DEFAULT_PERMISSIONS[role].includes(perm.key),
      })),
    }))
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    )
  }

  // Group permissions by category
  const categories = [...new Set(AVAILABLE_PERMISSIONS.map((p) => p.category))]

  return (
    <div className="flex-1">
      {/* Header */}
      <header className="border-b bg-white px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Permissions</h1>
            <p className="text-sm text-gray-500">
              Configure what each role can do in your workspace
            </p>
          </div>
          <Button onClick={savePermissions} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </header>

      <main className="p-8">
        <div className="max-w-6xl">
          {/* Role Tabs */}
          <div className="mb-6">
            <p className="text-sm text-muted-foreground mb-4">
              Main Admin has all permissions by default. Configure permissions for other roles below.
            </p>
          </div>

          {/* Permissions Grid */}
          <div className="rounded-lg border bg-card overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium w-1/3">
                    Permission
                  </th>
                  {ROLES.map((role) => (
                    <th key={role} className="px-4 py-3 text-center text-sm font-medium">
                      <div className="flex flex-col items-center gap-1">
                        <span className="capitalize">{role}</span>
                        <button
                          onClick={() => resetToDefaults(role)}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          Reset
                        </button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {categories.map((category) => (
                  <>
                    <tr key={category} className="bg-muted/30">
                      <td colSpan={4} className="px-4 py-2 text-sm font-semibold text-muted-foreground">
                        {category}
                      </td>
                    </tr>
                    {AVAILABLE_PERMISSIONS.filter((p) => p.category === category).map((perm) => (
                      <tr key={perm.key}>
                        <td className="px-4 py-3">
                          <div>
                            <p className="text-sm font-medium">{perm.label}</p>
                            <p className="text-xs text-muted-foreground">{perm.description}</p>
                          </div>
                        </td>
                        {ROLES.map((role) => {
                          const isEnabled = permissions[role].find(
                            (p) => p.permission_key === perm.key
                          )?.enabled
                          return (
                            <td key={role} className="px-4 py-3 text-center">
                              <button
                                onClick={() => togglePermission(role, perm.key)}
                                className={`inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                  isEnabled ? 'bg-green-500' : 'bg-gray-200'
                                }`}
                              >
                                <span
                                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                                    isEnabled ? 'translate-x-6' : 'translate-x-1'
                                  }`}
                                />
                              </button>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
            </table>
          </div>

          {/* Info Box */}
          <div className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
            <div className="flex gap-3">
              <svg
                className="h-5 w-5 text-blue-600 flex-shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div className="text-sm text-blue-800">
                <p className="font-medium">Role Hierarchy</p>
                <ul className="mt-1 list-disc list-inside text-blue-700">
                  <li><strong>Main Admin:</strong> Full access to all features including workspace settings</li>
                  <li><strong>Admin:</strong> Can manage team and most features, but not workspace settings</li>
                  <li><strong>Agent:</strong> Standard user for handling chats and messages</li>
                  <li><strong>Viewer:</strong> Read-only access to chats and messages</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
