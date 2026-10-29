"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "~/lib/auth-client";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { PasswordInput } from "~/components/ui/password-input";
import { Label } from "~/components/ui/label";
import AuthLayout from "~/components/auth-layout";
import { getSignUpError, getNetworkError } from "~/lib/auth-errors";

export default function ParentSignUpClient(): React.JSX.Element {
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // Validate password match
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    // Validate password requirements
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);

    try {
      // Sign up with better-auth
      await authClient.signUp.email(
        {
          email,
          password,
          name,
        },
        {
          onSuccess: async () => {
            // Redirect to complete profile setup
            router.push("/sign-up/parent/complete");
          },
          onError: (ctx) => {
            setError(getSignUpError(ctx.error));
            setLoading(false);
          },
        }
      );
    } catch (err) {
      setError(getNetworkError(err));
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Parent Registration"
      subtitle="Create your account, then link each child and reserve their subjects."
      footer={
        <div className="space-y-3">
          <Link
            href={"/sign-up" as never}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-3.5 w-3.5 rtl:rotate-180">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Back to account type
          </Link>
          <p>
            Already have an account?{" "}
            <Link
              href={"/sign-in" as never}
              className="font-medium text-primary hover:text-primary/80 transition-colors"
            >
              Sign in
            </Link>
          </p>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div role="alert" className="animate-fade-up rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="name">Full Name</Label>
          <Input
            id="name"
            type="text"
            placeholder="Enter your full name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email Address</Label>
          <Input
            id="email"
            type="email"
            placeholder="parent@example.com"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <PasswordInput
            id="password"
            placeholder="At least 8 characters"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Minimum 8 characters required
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm Password</Label>
          <PasswordInput
            id="confirmPassword"
            placeholder="Confirm your password"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>

        <Button type="submit" size="lg" className="w-full" disabled={loading}>
          {loading ? (
            <span className="flex items-center gap-2">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
              </svg>
              Creating account...
            </span>
          ) : (
            "Create Parent Account"
          )}
        </Button>

        {/* After registration info box */}
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
          <div className="flex gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
              <svg className="h-4 w-4 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-emerald-800">
                After you create the account
              </h3>
              <ul className="mt-1.5 space-y-1 text-sm text-emerald-700">
                <li className="flex items-center gap-2">
                  <span className="h-1 w-1 rounded-full bg-emerald-400" />
                  Link each child&apos;s account — your child accepts the link
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1 w-1 rounded-full bg-emerald-400" />
                  Reserve their subjects
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1 w-1 rounded-full bg-emerald-400" />
                  Pay at the school desk or by InstaPay
                </li>
              </ul>
            </div>
          </div>
        </div>
      </form>
    </AuthLayout>
  );
}
