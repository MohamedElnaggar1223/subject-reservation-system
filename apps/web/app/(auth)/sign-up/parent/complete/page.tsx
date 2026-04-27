"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "~/lib/auth-client";

export default function CompleteParentProfile(): React.JSX.Element {
  const router = useRouter();

  const [status, setStatus] = useState<"loading" | "error" | "success">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    async function completeProfile() {
      try {
        const session = await authClient.getSession();

        if (!session?.data?.user) {
          router.push("/sign-up/parent" as never);
          return;
        }

        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/v1/users/me/parent-setup`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
          }
        );

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed to complete profile setup");
        }

        setStatus("success");
        // Use a full navigation (not router.push) so Better Auth re-issues
        // the session cookie with the newly-assigned role — the (app)
        // layout guard reads the fresh role from the server and won't
        // bounce the user back to /complete-setup.
        setTimeout(() => {
          window.location.href = "/";
        }, 2000);
      } catch (err) {
        console.error("Profile setup error:", err);
        setError(err instanceof Error ? err.message : "Failed to complete profile setup");
        setStatus("error");
      }
    }

    completeProfile();
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center animate-fade-up max-w-sm px-6">
        {status === "loading" && (
          <>
            <div className="mx-auto mb-5 size-10 animate-spin rounded-full border-[3px] border-border border-t-primary" />
            <h2 className="text-lg font-semibold text-foreground font-display">
              Setting up your account...
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Please wait while we complete your parent profile.
            </p>
          </>
        )}

        {status === "error" && (
          <>
            <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-full bg-destructive/10">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-6 text-destructive">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-foreground font-display">
              Setup Failed
            </h2>
            <p className="mt-2 text-sm text-destructive">{error}</p>
            <button
              onClick={() => router.push("/sign-up/parent" as never)}
              className="mt-4 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
            >
              Try again
            </button>
          </>
        )}

        {status === "success" && (
          <>
            <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-900/20">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-6 text-emerald-600 dark:text-emerald-400">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-foreground font-display">
              Account Created Successfully!
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Redirecting you to the dashboard...
            </p>
            <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400 font-medium">
              Next step: Link your children's accounts
            </p>
          </>
        )}
      </div>
    </div>
  );
}
