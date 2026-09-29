"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "~/lib/auth-client";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { cn } from "~/lib/utils";
import AuthLayout from "~/components/auth-layout";
import { getSignUpError, getNetworkError } from "~/lib/auth-errors";

// The grade this academic year; the API stores the cohort (F0a). Grade 9 is
// a family enrolling before the student starts grade 10.
const GRADES = [
  { value: 9, label: "Grade 9", description: "Starts grade 10 next year" },
  { value: 10, label: "Grade 10", description: "First year of IGCSE" },
  { value: 11, label: "Grade 11", description: "Second year of IGCSE" },
  { value: 12, label: "Grade 12", description: "Final year" },
];

export default function StudentSignUpClient(): React.JSX.Element {
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [grade, setGrade] = useState<number | "">("");
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

    // Validate grade selection
    if (!grade) {
      setError("Please select your grade");
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
            // After sign-up, we need to update the user with role and grade
            // This will be handled by the backend after sign-up
            // For now, redirect to complete profile setup
            router.push(`/sign-up/student/complete?grade=${grade}`);
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
      title="Student Registration"
      subtitle="Create your IGCSE student account to start reserving subjects."
      decorativeContent={
        <div className="relative z-10 flex h-full flex-col justify-between p-10 lg:p-12">
          {/* Logo */}
          <div className="animate-fade-up">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/20 backdrop-blur-sm">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5 text-white">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342M6.75 15a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 0v-3.675A55.378 55.378 0 0 1 12 8.443m-7.007 11.55A5.981 5.981 0 0 0 6.75 15.75v-1.5" />
                </svg>
              </div>
              <span className="font-display text-lg font-bold tracking-tight text-white">IGCSE Reserve</span>
            </div>
          </div>

          {/* Student-themed content */}
          <div className="animate-fade-up stagger-2 space-y-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 backdrop-blur-sm">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-8 w-8 text-white">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342M6.75 15a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 0v-3.675A55.378 55.378 0 0 1 12 8.443m-7.007 11.55A5.981 5.981 0 0 0 6.75 15.75v-1.5" />
              </svg>
            </div>
            <h1 className="font-display text-3xl font-bold leading-tight text-white lg:text-4xl">
              Shape your
              <br />
              academic future.
            </h1>
            <p className="max-w-xs text-sm leading-relaxed text-white/70">
              Choose the IGCSE subjects that align with your goals. Track every step from registration to exam day.
            </p>
          </div>

          {/* Student benefits */}
          <div className="animate-fade-up stagger-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/20">
                <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
              <span className="text-sm text-white/80">Browse and reserve subjects</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/20">
                <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
              <span className="text-sm text-white/80">Track registration status</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/20">
                <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
              <span className="text-sm text-white/80">Manage your escrow balance</span>
            </div>
          </div>
        </div>
      }
      footer={
        <div className="space-y-3">
          <Link
            href={"/sign-up" as never}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-3.5 w-3.5">
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
          <div className="animate-fade-up rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3">
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
            placeholder="student@example.com"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        {/* Grade selection as radio cards */}
        <div className="space-y-2">
          <Label>Current Grade</Label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {GRADES.map((g) => (
              <button
                key={g.value}
                type="button"
                onClick={() => setGrade(g.value)}
                className={cn(
                  "group relative flex flex-col items-center rounded-xl border-2 px-3 py-3 text-center transition-all duration-150",
                  grade === g.value
                    ? "border-primary bg-brand-50 shadow-sm"
                    : "border-border bg-card hover:border-primary/30 hover:bg-brand-50/50"
                )}
              >
                <span
                  className={cn(
                    "font-display text-lg font-bold transition-colors",
                    grade === g.value ? "text-primary" : "text-foreground"
                  )}
                >
                  {g.value}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {g.description}
                </span>
                {/* Selected indicator */}
                {grade === g.value && (
                  <div className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                    <svg className="h-3 w-3 text-primary-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
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
          <Input
            id="confirmPassword"
            type="password"
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
            "Create Student Account"
          )}
        </Button>
      </form>
    </AuthLayout>
  );
}
