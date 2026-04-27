'use client';

/**
 * Email Verification Page
 *
 * Handles the verification token from the URL sent via the email verification flow.
 * When the user clicks the verification link in their email, they land here.
 * The page extracts the token from the URL and calls better-auth's verify endpoint.
 *
 * States:
 * - No token: shows an invalid/missing link message
 * - Verifying: spinner while the API call is in progress
 * - Success: confirmation with sign-in link
 * - Error: failure message with option to resend
 */

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { authClient } from '~/lib/auth-client';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import AuthLayout from '~/components/auth-layout';

type VerificationState = 'idle' | 'verifying' | 'success' | 'error';

function VerifyEmailInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [state, setState] = useState<VerificationState>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [resendEmail, setResendEmail] = useState('');
  const [resendSent, setResendSent] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);

  useEffect(() => {
    if (!token) return;

    setState('verifying');

    authClient.verifyEmail({ query: { token } })
      .then(() => {
        setState('success');
      })
      .catch(() => {
        setState('error');
        setErrorMessage('Verification failed. The link may have expired or already been used.');
      });
  }, [token]);

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resendEmail.trim()) return;

    setResendLoading(true);
    try {
      await authClient.sendVerificationEmail({ email: resendEmail.trim().toLowerCase() });
      setResendSent(true);
    } catch {
      setErrorMessage('Failed to resend verification email. Please try again.');
    } finally {
      setResendLoading(false);
    }
  };

  // No token provided
  if (!token) {
    return (
      <AuthLayout
        title="Missing verification token"
        subtitle="This link appears to be incomplete. Please check your email and click the full verification link."
        footer={
          <Link
            href={"/sign-in" as never}
            className="font-medium text-primary hover:text-primary/80 transition-colors"
          >
            Go to sign in
          </Link>
        }
      >
        <div className="flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50">
            <svg className="h-8 w-8 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
        </div>
      </AuthLayout>
    );
  }

  // Verifying state
  if (state === 'verifying' || state === 'idle') {
    return (
      <AuthLayout
        title="Verifying your email"
        subtitle="Please wait while we verify your email address."
      >
        <div className="flex flex-col items-center gap-4 py-8">
          <div className="relative">
            <div className="h-12 w-12 rounded-full border-[3px] border-brand-100" />
            <div className="absolute inset-0 h-12 w-12 animate-spin rounded-full border-[3px] border-transparent border-t-primary" />
          </div>
          <p className="text-sm text-muted-foreground">This should only take a moment...</p>
        </div>
      </AuthLayout>
    );
  }

  // Success state
  if (state === 'success') {
    return (
      <AuthLayout
        title="Email verified"
        subtitle="Your email address has been successfully verified. You can now sign in to your account."
        footer={
          <Link
            href={"/sign-in" as never}
            className="font-medium text-primary hover:text-primary/80 transition-colors"
          >
            Back to sign in
          </Link>
        }
      >
        <div className="space-y-6">
          <div className="flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50">
              <svg className="h-8 w-8 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>

          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 text-center">
            <p className="text-sm text-emerald-800">
              Your email has been confirmed. You are all set to start using IGCSE Reserve.
            </p>
          </div>

          <Button asChild size="lg" className="w-full">
            <Link href={"/sign-in" as never}>
              Sign in to your account
            </Link>
          </Button>
        </div>
      </AuthLayout>
    );
  }

  // Error state
  return (
    <AuthLayout
      title="Verification failed"
      subtitle={errorMessage}
      footer={
        <Link
          href={"/sign-in" as never}
          className="inline-flex items-center gap-1 font-medium text-primary hover:text-primary/80 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-3.5 w-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Back to sign in
        </Link>
      }
    >
      <div className="space-y-6">
        <div className="flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50">
            <svg className="h-8 w-8 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        </div>

        {/* Resend verification form */}
        {!resendSent ? (
          <form onSubmit={handleResend} className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="mb-3 text-center text-sm text-muted-foreground">
                Enter your email to receive a new verification link:
              </p>
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="resendEmail" className="sr-only">
                    Email address
                  </Label>
                  <Input
                    id="resendEmail"
                    type="email"
                    required
                    placeholder="you@example.com"
                    value={resendEmail}
                    onChange={(e) => setResendEmail(e.target.value)}
                  />
                </div>
                <Button type="submit" size="lg" className="w-full" disabled={resendLoading}>
                  {resendLoading ? (
                    <span className="flex items-center gap-2">
                      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                        <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
                      </svg>
                      Sending...
                    </span>
                  ) : (
                    "Resend verification email"
                  )}
                </Button>
              </div>
            </div>
          </form>
        ) : (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 text-center">
            <p className="text-sm text-emerald-800">
              A new verification email has been sent to <strong className="font-semibold">{resendEmail}</strong>. Please check your inbox.
            </p>
          </div>
        )}
      </div>
    </AuthLayout>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="size-10 animate-spin rounded-full border-[3px] border-border border-t-primary" />
        </div>
      }
    >
      <VerifyEmailInner />
    </Suspense>
  );
}
