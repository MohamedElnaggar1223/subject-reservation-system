'use client'

import { useEffect, useState } from "react"
import Link from "next/link"
import { authClient } from "~/lib/auth-client"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import AuthLayout from "~/components/auth-layout"
import { getSignInError, getNetworkError } from "~/lib/auth-errors"

function roleRedirect(role?: string | null): string {
  switch (role) {
    case 'admin':   return '/admin/dashboard';
    case 'student': return '/register';
    case 'parent':  return '/approvals';
    default:        return '/';
  }
}

export default function SignInPage(): React.JSX.Element {
  const { data } = authClient.useSession()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  // Guard against the dual-redirect race: the sign-in mutation's
  // onSuccess and the useSession effect both fire after auth — we only
  // want ONE navigation. redirectedRef ensures the first wins.
  const [redirected, setRedirected] = useState(false)

  useEffect(() => {
    if (redirected) return;
    if (!data?.session.userId) return;
    const role = (data.user as { role?: string })?.role;
    // Role may still be undefined on the very first tick if Better-auth
    // hasn't projected it onto the session user yet. In that case the
    // (app) layout guard will resolve the final destination server-side,
    // so we fall through to "/" without worrying about flashing the
    // wrong page.
    setRedirected(true);
    // Full navigation so server middleware sees the fresh session cookie
    // and the (app) layout's role/verification gates run against current
    // data rather than a stale client cache.
    window.location.href = roleRedirect(role);
  }, [data?.session.userId, data?.user, redirected])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const { error: signInError } = await authClient.signIn.email({
        email,
        password,
      }, {
        onSuccess: (ctx) => {
          if (redirected) return;
          setRedirected(true);
          const role = (ctx.data?.user as { role?: string })?.role;
          window.location.href = roleRedirect(role);
        },
        onError: (ctx) => {
          setError(getSignInError(ctx.error))
        }
      })

      if (signInError) {
        setError(getSignInError(signInError))
      }
    } catch (err) {
      setError(getNetworkError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to your IGCSE account to manage your subject reservations."
      footer={
        <p>
          Don&apos;t have an account?{" "}
          <Link
            href={"/sign-up" as never}
            className="font-medium text-primary hover:text-primary/80 transition-colors"
          >
            Create one
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="animate-fade-up rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              href={"/forgot-password" as never}
              className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <Button
          type="submit"
          disabled={loading}
          size="lg"
          className="w-full"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
              </svg>
              Signing in...
            </span>
          ) : (
            "Sign in"
          )}
        </Button>
      </form>
    </AuthLayout>
  )
}
