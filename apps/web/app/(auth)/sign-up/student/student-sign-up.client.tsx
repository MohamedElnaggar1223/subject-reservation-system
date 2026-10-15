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
