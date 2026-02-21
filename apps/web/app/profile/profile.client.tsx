"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "~/lib/auth-client";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";

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
          router.push("/sign-in");
        },
      },
    });
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-600"></div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-red-600">{error || "Failed to load profile"}</p>
          <Button onClick={() => router.push("/")} className="mt-4">
            Go Home
          </Button>
        </div>
      </div>
    );
  }

  const roleColors: Record<string, string> = {
    admin: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
    student: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    parent: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <div className="mx-auto max-w-3xl px-4 py-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              My Profile
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Manage your account information
            </p>
          </div>
          <Link href="/">
            <Button variant="outline">&larr; Back to Dashboard</Button>
          </Link>
        </div>

        {/* Alerts */}
        {error && (
          <div className="mb-4 rounded-lg bg-red-50 p-4 dark:bg-red-900/20">
            <p className="text-sm text-red-800 dark:text-red-400">{error}</p>
          </div>
        )}
        {success && (
          <div className="mb-4 rounded-lg bg-green-50 p-4 dark:bg-green-900/20">
            <p className="text-sm text-green-800 dark:text-green-400">{success}</p>
          </div>
        )}

        {/* Profile Card */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          {/* Avatar and Role Badge */}
          <div className="mb-6 flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-200 text-2xl font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
              {profile.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                {profile.name}
              </h2>
              <div className="mt-1 flex items-center gap-2">
                {profile.role && (
                  <span
                    className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
                      roleColors[profile.role] || "bg-slate-100 text-slate-800"
                    }`}
                  >
                    {profile.role}
                  </span>
                )}
                {profile.grade && (
                  <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-800 dark:bg-slate-700 dark:text-slate-300">
                    Grade {profile.grade}
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
                  <dt className="text-sm font-medium text-slate-500 dark:text-slate-400">
                    Email
                  </dt>
                  <dd className="mt-1 text-slate-900 dark:text-white">
                    {profile.email}
                    {profile.emailVerified && (
                      <span className="ml-2 inline-flex items-center text-green-600 dark:text-green-400">
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
                  <dt className="text-sm font-medium text-slate-500 dark:text-slate-400">
                    Phone
                  </dt>
                  <dd className="mt-1 text-slate-900 dark:text-white">
                    {profile.phone || "Not provided"}
                  </dd>
                </div>

                {profile.studentId && (
                  <div>
                    <dt className="text-sm font-medium text-slate-500 dark:text-slate-400">
                      Student ID
                    </dt>
                    <dd className="mt-1 font-mono text-slate-900 dark:text-white">
                      {profile.studentId}
                    </dd>
                  </div>
                )}

                <div>
                  <dt className="text-sm font-medium text-slate-500 dark:text-slate-400">
                    Member Since
                  </dt>
                  <dd className="mt-1 text-slate-900 dark:text-white">
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
          <Link href="/links">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-blue-300 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-blue-600">
              <h3 className="font-medium text-slate-900 dark:text-white">
                {profile.role === "parent" ? "Linked Children" : "Linked Parents"}
              </h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                {profile.role === "parent"
                  ? "Manage your children's account links"
                  : "View and manage parent connections"}
              </p>
            </div>
          </Link>

          <button
            onClick={handleSignOut}
            className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-red-300 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-red-600"
          >
            <h3 className="font-medium text-red-600 dark:text-red-400">Sign Out</h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Sign out of your account
            </p>
          </button>
        </div>
      </div>
    </div>
  );
}
