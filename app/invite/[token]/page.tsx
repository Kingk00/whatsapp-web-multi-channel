'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface InviteData {
  email: string
  role: string
  expires_at: string
}

export default function InvitePage() {
  const params = useParams()
  const token = params.token as string
  const router = useRouter()
  const supabase = createClient()

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inviteData, setInviteData] = useState<InviteData | null>(null)

  // Form fields
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // Validate token on mount
  useEffect(() => {
    validateToken()
  }, [token])

  const validateToken = async () => {
    setLoading(true)
    setError(null)

    try {
      // Call a query to validate the token
      const { data, error: queryError } = await supabase
        .from('invite_tokens')
        .select('email, role, expires_at')
        .eq('token', token)
        .eq('used', false)
        .gt('expires_at', new Date().toISOString())
        .single()

      if (queryError || !data) {
        setError('Invalid or expired invite link')
        setInviteData(null)
      } else {
        setInviteData(data)
      }
    } catch (err) {
      setError('Failed to validate invite')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    // Validation
    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (!fullName.trim()) {
      setError('Full name is required')
      return
    }

    setSubmitting(true)

    try {
      // Call our API route to create the user
      const response = await fetch('/api/auth/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token,
          email: inviteData?.email,
          password,
          fullName: fullName.trim(),
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        setError(result.error || 'Registration failed')
        return
      }

      // Success - now sign in the user
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: inviteData!.email,
        password,
      })

      if (signInError) {
        // Account created but sign-in failed - redirect to login
        router.push('/login?message=Account created. Please sign in.')
      } else {
        // Signed in successfully
        router.push('/inbox')
      }
    } catch (err) {
      setError('An unexpected error occurred')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-pulse text-lg text-muted-foreground">
            Validating invite...
          </div>
        </div>
      </div>
    )
  }

  if (!inviteData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center">
            <h1 className="text-3xl font-bold tracking-tight text-destructive">
              Invalid Invite
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {error || 'This invite link is invalid or has expired'}
            </p>
          </div>

          <div className="rounded-lg border bg-card p-8 shadow-sm text-center">
            <p className="mb-4 text-sm text-muted-foreground">
              Please contact your administrator for a new invite link.
            </p>
            <Button
              onClick={() => router.push('/login')}
              variant="outline"
              className="w-full"
            >
              Go to Login
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">
            Create Your Account
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You've been invited to join WhatsApp Web Multi-Channel
          </p>
        </div>

        <div className="rounded-lg border bg-card p-8 shadow-sm">
          {/* Invite Info */}
          <div className="mb-6 rounded-md bg-primary/10 p-3">
            <p className="text-sm">
              <span className="font-medium">Email:</span> {inviteData.email}
            </p>
            <p className="text-sm">
              <span className="font-medium">Role:</span>{' '}
              {inviteData.role.replace('_', ' ')}
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Registration Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name</Label>
              <Input
                id="fullName"
                type="text"
                placeholder="John Doe"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                autoComplete="name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
              <p className="text-xs text-muted-foreground">
                Must be at least 6 characters
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
            </div>

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Creating account...' : 'Create Account'}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            <p>
              Already have an account?{' '}
              <a
                href="/login"
                className="font-medium text-primary hover:underline"
              >
                Sign in
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
