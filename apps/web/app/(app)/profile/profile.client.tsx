"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "~/lib/auth-client";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { gradeLabel } from "@repo/validations";

interface UserProfile {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: string | null;
  grade: number | null;
  studentId: string | null;
  phone: string | null;
  createdAt: string;
}

export default function ProfileClient(): React.JSX.Element {
  const router = useRouter();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Edit form state
  const [editMode, setEditMode] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    fetchProfile();
  }, []);

  async function fetchProfile() {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/v1/users/me`,
        {
          credentials: "include",
        }
      );

      if (!response.ok) {
        throw new Error("Failed to fetch profile");
      }

      const data = await response.json();
      setProfile(data.data);
      setName(data.data.name);
      setPhone(data.data.phone || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load profile");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setSaving(true);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/v1/users/me`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            name: name || undefined,
            phone: phone || null,
          }),
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to update profile");
      }

      const data = await response.json();
      setProfile(data.data);
      setEditMode(false);
      setSuccess("Profile updated successfully");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update profile");
    } finally {
      setSaving(false);
    }
  }

  function handleSignOut() {
    authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          router.push("/sign-in" as never);
        },
      },
    });
  }

  if (loading) {
    return (
      <div className="px-6 py-8 max-w-5xl mx-auto flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="px-6 py-8 max-w-5xl mx-auto flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <p className="text-destructive">{error || "Failed to load profile"}</p>
          <Button onClick={() => router.push("/" as never)} className="mt-4">
            Go Home
          </Button>
        </div>
      </div>
    );
  }

  const roleColors: Record<string, string> = {
    admin: "bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400",
    student: "bg-brand-50 text-brand-700",
    parent: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  };

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto animate-fade-up">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground font-display tracking-tight">
            My Profile
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your account information
          </p>
        </div>
        <Link href={"/" as never}>
          <Button variant="outline">Back to Dashboard</Button>
        </Link>
      </div>

      {/* Alerts */}
      {error && (
        <div className="mb-4 rounded-lg bg-destructive/10 border border-destructive/20 p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}
      {success && (
        <div className="mb-4 rounded-lg bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-700 p-4">
          <p className="text-sm text-brand-800 dark:text-brand-300">{success}</p>
        </div>
      )}

      {/* Profile Card */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-6">
        {/* Avatar and Role Badge */}
        <div className="mb-6 flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-2xl font-semibold text-muted-foreground">
            {profile.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 className="text-xl font-semibold text-foreground font-display">
              {profile.name}
            </h2>
            <div className="mt-1 flex items-center gap-2">
              {profile.role && (
                <span
                  className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
                    roleColors[profile.role] || "bg-muted text-muted-foreground"
                  }`}
                >
                  {profile.role}
                </span>
              )}
              {profile.role === 'student' && (
                <span className="inline-flex rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                  {gradeLabel(profile.grade)}
                </span>
              )}
            </div>
          </div>
        </div>

        {editMode ? (
          // Edit Form
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Full Name</Label>
              <Input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="Optional"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : "Save Changes"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditMode(false);
                  setName(profile.name);
                  setPhone(profile.phone || "");
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          // Profile Display
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Email
                </dt>
                <dd className="mt-1 text-foreground">
                  {profile.email}
                  {profile.emailVerified && (
                    <span className="ml-2 inline-flex items-center text-emerald-600 dark:text-emerald-400">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                        className="h-4 w-4"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                        />
                      </svg>
                    </span>
                  )}
                </dd>
              </div>

              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Phone
                </dt>
                <dd className="mt-1 text-foreground">
                  {profile.phone || "Not provided"}
                </dd>
              </div>

              {profile.studentId && (
                <div>
                  <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Student ID
                  </dt>
                  <dd className="mt-1 font-mono text-foreground">
                    {profile.studentId}
                  </dd>
                </div>
              )}

              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Member Since
                </dt>
                <dd className="mt-1 text-foreground">
                  {new Date(profile.createdAt).toLocaleDateString()}
                </dd>
              </div>
            </div>

            <div className="pt-4">
              <Button onClick={() => setEditMode(true)}>Edit Profile</Button>
            </div>
          </div>
        )}
      </div>

      {/* Quick Links */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Link href={"/links" as never}>
          <div className="bg-card rounded-xl border border-border shadow-sm p-4 transition-colors hover:border-primary/40">
            <h3 className="font-medium text-foreground font-display">
              {profile.role === "parent" ? "Linked Children" : "Linked Parents"}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {profile.role === "parent"
                ? "Manage your children's account links"
                : "View and manage parent connections"}
            </p>
          </div>
        </Link>

        <button
          onClick={handleSignOut}
          className="bg-card rounded-xl border border-border shadow-sm p-4 text-left transition-colors hover:border-destructive/40"
        >
          <h3 className="font-medium text-destructive">Sign Out</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign out of your account
          </p>
        </button>
      </div>
    </div>
  );
}
