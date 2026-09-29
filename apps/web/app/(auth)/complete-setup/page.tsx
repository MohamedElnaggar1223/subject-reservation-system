"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import AuthLayout from "~/components/auth-layout";
import { authClient } from "~/lib/auth-client";

// The grade this academic year; the API stores the cohort (F0a). Grade 9 is
// a family enrolling before the student starts grade 10.
const GRADES = [
  { value: 9, label: "Grade 9", description: "Starts grade 10 next year" },
  { value: 10, label: "Grade 10", description: "First year of IGCSE" },
  { value: 11, label: "Grade 11", description: "Second year of IGCSE" },
  { value: 12, label: "Grade 12", description: "Final year" },
];

export default function CompleteSetupPage(): React.JSX.Element {
  const router = useRouter();

  const [role, setRole] = useState<"student" | "parent" | "">("");
  const [roleLocked, setRoleLocked] = useState(false);
  const [grade, setGrade] = useState<number | "">("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    authClient.getSession().then((session) => {
      const userRole = (session?.data?.user as { role?: string } | undefined)?.role;
      if (userRole === "student") {
        setRole("student");
        setRoleLocked(true);
      } else if (userRole === "parent") {
        setRole("parent");
        setRoleLocked(true);
      }
    }).catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!role) {
      setError("Please select your account type");
      return;
    }

    if (role === "student" && !grade) {
      setError("Please select your grade");
      return;
    }

    setLoading(true);

    try {
      const endpoint =
        role === "student"
          ? "/v1/users/me/student-setup"
          : "/v1/users/me/parent-setup";

      const body =
        role === "student" ? JSON.stringify({ grade: Number(grade) }) : "{}";

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}${endpoint}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body,
        }
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const msg = typeof data.error === 'string'
          ? data.error
          : typeof data.error === 'object' && data.error?.message
            ? data.error.message
            : `Setup failed (HTTP ${response.status})`;
        throw new Error(msg);
      }

      // Force a full page reload so the session is re-fetched with the updated role
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete setup");
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title={roleLocked && role === "student" ? "Select Your Grade" : "Complete Your Profile"}
      subtitle={roleLocked && role === "student"
        ? "We need your current grade to set up your account correctly."
        : "One more step — tell us your role so we can personalize your experience."}
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="animate-fade-up rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* Role picker — hidden if role already set */}
        {!roleLocked && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">I am a...</p>
            <div className="grid gap-3">
              <button
                type="button"
                onClick={() => { setRole("student"); setGrade(""); }}
                className={cn(
                  "group relative flex items-start gap-4 rounded-xl border-2 p-4 text-left transition-all duration-150",
                  role === "student"
                    ? "border-primary bg-brand-50 shadow-sm"
                    : "border-border bg-card hover:border-primary/30"
                )}
              >
                <div className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors",
                  role === "student" ? "bg-brand-100 text-primary" : "bg-muted text-muted-foreground"
                )}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342M6.75 15a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 0v-3.675A55.378 55.378 0 0 1 12 8.443m-7.007 11.55A5.981 5.981 0 0 0 6.75 15.75v-1.5" />
                  </svg>
                </div>
                <div>
                  <p className="font-display font-semibold text-foreground">Student</p>
                  <p className="text-sm text-muted-foreground">Register for IGCSE subjects and track your progress</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => { setRole("parent"); setGrade(""); }}
                className={cn(
                  "group relative flex items-start gap-4 rounded-xl border-2 p-4 text-left transition-all duration-150",
                  role === "parent"
                    ? "border-emerald-500 bg-emerald-50 shadow-sm"
                    : "border-border bg-card hover:border-emerald-400/30"
                )}
              >
                <div className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors",
                  role === "parent" ? "bg-emerald-100 text-emerald-600" : "bg-muted text-muted-foreground"
                )}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
                  </svg>
                </div>
                <div>
                  <p className="font-display font-semibold text-foreground">Parent</p>
                  <p className="text-sm text-muted-foreground">Register subjects on behalf of your children</p>
                </div>
              </button>
            </div>
          </div>
        )}

        {roleLocked && (
          <div className="rounded-lg border border-primary/20 bg-brand-50 px-4 py-3">
            <p className="text-sm text-foreground">
              Your account is set up as a <strong className="capitalize">{role}</strong>.
              {role === "student" && " Please select your current grade to continue."}
            </p>
          </div>
        )}

        {/* Grade picker (student only) */}
        {role === "student" && (
          <div className="animate-fade-up space-y-2">
            <p className="text-sm font-medium text-foreground">Current Grade</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {GRADES.map((g) => (
                <button
                  key={g.value}
                  type="button"
                  onClick={() => setGrade(g.value)}
                  className={cn(
                    "relative flex flex-col items-center rounded-xl border-2 px-3 py-3 text-center transition-all duration-150",
                    grade === g.value
                      ? "border-primary bg-brand-50 shadow-sm"
                      : "border-border bg-card hover:border-primary/30"
                  )}
                >
                  <span className={cn(
                    "font-display text-lg font-bold transition-colors",
                    grade === g.value ? "text-primary" : "text-foreground"
                  )}>
                    {g.value}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{g.description}</span>
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
        )}

        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={loading || !role || (role === "student" && !grade)}
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
              </svg>
              Setting up...
            </span>
          ) : (
            "Continue"
          )}
        </Button>
      </form>
    </AuthLayout>
  );
}
