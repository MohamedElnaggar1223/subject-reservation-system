"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "~/lib/auth-client";
import { api } from "~/lib/hono";
import { apiResponse } from "@repo/validations";

export default function CompleteStudentProfile(): React.JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const grade = searchParams.get("grade");

  const [status, setStatus] = useState<"loading" | "error" | "success">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    async function completeProfile() {
      try {
        // Get the current session
        const session = await authClient.getSession();
        
        if (!session?.data?.user) {
          // Not logged in, redirect to sign-up
          router.push("/sign-up/student");
          return;
        }

        if (!grade) {
          setError("Grade not specified");
          setStatus("error");
          return;
        }

        // Call the API to set student fields
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/v1/users/me/student-setup`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            credentials: "include",
            body: JSON.stringify({ grade: Number(grade) }),
          }
        );

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed to complete profile setup");
        }

        setStatus("success");
        
        // Redirect to dashboard after a short delay
        setTimeout(() => {
          router.push("/");
        }, 2000);
      } catch (err) {
        console.error("Profile setup error:", err);
        setError(err instanceof Error ? err.message : "Failed to complete profile setup");
        setStatus("error");
      }
    }

    completeProfile();
  }, [grade, router]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600"></div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Setting up your account...
          </h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Please wait while we complete your student profile.
          </p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="h-6 w-6"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
              />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Setup Failed
          </h2>
          <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
          <button
            onClick={() => router.push("/sign-up/student")}
            className="mt-4 text-sm text-blue-600 hover:text-blue-500 dark:text-blue-400"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="h-6 w-6"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
            />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          Account Created Successfully!
        </h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Redirecting you to the dashboard...
        </p>
      </div>
    </div>
  );
}
