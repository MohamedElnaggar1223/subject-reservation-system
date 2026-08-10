"use client";

/** API errors may be a string or a structured object; never render "[object Object]". */
function errText(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object') {
    const e = (data as { error?: unknown }).error;
    if (typeof e === 'string') return e;
    if (e && typeof e === 'object') {
      const m = (e as { message?: unknown }).message;
      if (typeof m === 'string') return m;
    }
    const m = (data as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return '';
}


import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "~/lib/auth-client";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";

interface LinkedUser {
  id: string;
  name: string;
  email: string;
  grade?: number | null;
  studentId?: string | null;
  phone?: string | null;
}

interface LinkRequest {
  id: string;
  status: string;
  requestedAt: string;
  respondedAt: string | null;
  parent?: LinkedUser;
  student?: LinkedUser;
}

export default function LinksClient(): React.JSX.Element {
  const router = useRouter();

  const [userRole, setUserRole] = useState<string | null>(null);
  const [pendingLinks, setPendingLinks] = useState<LinkRequest[]>([]);
  const [approvedLinks, setApprovedLinks] = useState<LinkRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Parent: create link request form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [studentIdentifier, setStudentIdentifier] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      // Get current user's role
      const session = await authClient.getSession();
      const role = (session?.data?.user as { role?: string } | undefined)?.role;
      setUserRole(role || null);

      // Fetch pending links
      const pendingRes = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/v1/links/pending`,
        { credentials: "include" }
      );
      if (pendingRes.ok) {
        const pendingData = await pendingRes.json();
        setPendingLinks(pendingData.data || []);
      }

      // Fetch approved links (children for parents, parents for students)
      if (role === "parent") {
        const childrenRes = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/v1/links/children`,
          { credentials: "include" }
        );
        if (childrenRes.ok) {
          const childrenData = await childrenRes.json();
          setApprovedLinks(childrenData.data || []);
        }
      } else if (role === "student") {
        const parentsRes = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/v1/links/parents`,
          { credentials: "include" }
        );
        if (parentsRes.ok) {
          const parentsData = await parentsRes.json();
          setApprovedLinks(parentsData.data || []);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateLinkRequest(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setCreating(true);

    try {
      const isEmail = studentIdentifier.includes("@");
      const body = isEmail
        ? { studentEmail: studentIdentifier }
        : { studentIdentifier: studentIdentifier };

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/v1/links`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(body),
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(errText(data) || "Failed to create link request");
      }

      setSuccess("Link request sent successfully!");
      setStudentIdentifier("");
      setShowCreateForm(false);
      fetchData(); // Refresh the list
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create link request");
    } finally {
      setCreating(false);
    }
  }

  async function handleRespondToLink(linkId: string, status: "approved" | "rejected") {
    setError("");
    setSuccess("");

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/v1/links/${linkId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ status }),
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(errText(data) || `Failed to ${status} link request`);
      }

      setSuccess(`Link request ${status}!`);
      fetchData(); // Refresh the list
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${status} link request`);
    }
  }

  if (loading) {
    return (
      <div className="px-6 py-8 max-w-5xl mx-auto flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto animate-fade-up">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground font-display tracking-tight">
            {userRole === "parent" ? "Linked Children" : "Linked Parents"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {userRole === "parent"
              ? "Manage connections with your children's accounts"
              : "View and manage parent connections"}
          </p>
        </div>
        <Link href={"/profile" as never}>
          <Button variant="outline">Back to Profile</Button>
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

      {/* Parent: Create Link Request */}
      {userRole === "parent" && (
        <div className="mb-6 bg-card rounded-xl border border-border shadow-sm p-6">
          <h2 className="text-lg font-semibold text-foreground font-display">
            Link a Child
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Request to link your child's student account
          </p>

          {showCreateForm ? (
            <form onSubmit={handleCreateLinkRequest} className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="studentIdentifier">
                  Student Email or Student ID
                </Label>
                <Input
                  id="studentIdentifier"
                  type="text"
                  placeholder="student@example.com or STU-20260128-XXXXX"
                  value={studentIdentifier}
                  onChange={(e) => setStudentIdentifier(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Your child will need to approve this request
                </p>
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={creating}>
                  {creating ? "Sending..." : "Send Request"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowCreateForm(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button onClick={() => setShowCreateForm(true)} className="mt-4">
              + Add Child
            </Button>
          )}
        </div>
      )}

      {/* Pending Link Requests */}
      {pendingLinks.length > 0 && (
        <div className="mb-6 bg-card rounded-xl border border-amber-200 dark:border-amber-700 shadow-sm p-6">
          <h2 className="text-lg font-semibold text-foreground font-display">
            Pending Requests ({pendingLinks.length})
          </h2>
          <div className="mt-4 space-y-3">
            {pendingLinks.map((link) => (
              <div
                key={link.id}
                className="flex items-center justify-between rounded-lg bg-muted p-4"
              >
                <div>
                  {userRole === "student" && link.parent && (
                    <>
                      <p className="font-medium text-foreground">
                        {link.parent.name}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {link.parent.email}
                      </p>
                    </>
                  )}
                  {userRole === "parent" && link.student && (
                    <>
                      <p className="font-medium text-foreground">
                        {link.student.name}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {link.student.email}
                        {link.student.grade && ` · Grade ${link.student.grade}`}
                      </p>
                    </>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    Requested {new Date(link.requestedAt).toLocaleDateString()}
                  </p>
                </div>
                {userRole === "student" && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleRespondToLink(link.id, "approved")}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleRespondToLink(link.id, "rejected")}
                    >
                      Reject
                    </Button>
                  </div>
                )}
                {userRole === "parent" && (
                  <span className="text-sm px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 font-medium">
                    Awaiting approval
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Approved Links */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-6">
        <h2 className="text-lg font-semibold text-foreground font-display">
          {userRole === "parent" ? "Your Children" : "Your Parents"}
        </h2>

        {approvedLinks.length === 0 ? (
          <div className="mt-4 rounded-lg bg-muted p-8 text-center">
            <p className="text-muted-foreground text-sm">
              {userRole === "parent"
                ? "No children linked yet. Send a link request to get started."
                : "No parents linked to your account."}
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {approvedLinks.map((link) => (
              <div
                key={link.id}
                className="flex items-center justify-between rounded-lg border border-border p-4"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-lg font-semibold text-muted-foreground">
                    {userRole === "parent" && link.student
                      ? link.student.name.charAt(0).toUpperCase()
                      : link.parent?.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    {userRole === "parent" && link.student && (
                      <>
                        <p className="font-medium text-foreground">
                          {link.student.name}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {link.student.email}
                          {link.student.grade && ` · Grade ${link.student.grade}`}
                        </p>
                        {link.student.studentId && (
                          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                            {link.student.studentId}
                          </p>
                        )}
                      </>
                    )}
                    {userRole === "student" && link.parent && (
                      <>
                        <p className="font-medium text-foreground">
                          {link.parent.name}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {link.parent.email}
                        </p>
                      </>
                    )}
                  </div>
                </div>
                <span className="inline-flex items-center rounded-full bg-brand-50 text-brand-700 px-2.5 py-0.5 text-xs font-medium">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                    className="mr-1 h-3 w-3"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
                    />
                  </svg>
                  Linked
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Info Card for Students */}
      {userRole === "student" && (
        <div className="mt-6 bg-card rounded-xl border border-brand-200 dark:border-brand-700 p-4">
          <h3 className="font-medium text-foreground font-display">
            About Parent Links
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            When a parent is linked to your account, they can register subjects on
            your behalf, view your registration history, and manage your escrow
            balance. You can approve or reject link requests at any time.
          </p>
        </div>
      )}
    </div>
  );
}
