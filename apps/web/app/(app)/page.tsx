/**
 * Home Page - Student / Parent Dashboard
 *
 * Server component that:
 * - Checks authentication and redirects appropriately
 * - Fetches user profile for grade data
 * - Shows "Graduated" banner when student has grade === null
 * - Hides registration/swap links for graduated students
 */

import type { JSX } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuthenticated } from "~/lib/auth/session";
import { getServerApi } from "~/lib/hono-server";
import { apiResponse } from "@repo/validations";
import SessionBanner from "./session-banner.client";

type ActiveSessionRow = {
  id: string;
  name: string;
  sessionType: string;
  endDate: string;
};

export default async function Home(): Promise<JSX.Element> {
  const session = await requireAuthenticated()

  if(!session.session) {
    redirect('/sign-up')
  }

  const role = session.user.role ?? null;
  const isAdmin = role === 'admin';

  // Finance staff live at the Desk, not the student/parent dashboard
  if (role === 'finance_officer' || role === 'finance_admin') {
    redirect('/desk');
  }

  // Fetch full profile to get grade info for students
  let grade: number | null = null;
  if (role === 'student') {
    try {
      const serverApi = await getServerApi();
      const profile = await apiResponse(serverApi.v1.users.me.$get()) as { grade: number | null };
      grade = profile.grade;
    } catch {
      // Fallback: unable to fetch grade
    }
  }

  const isGraduated = role === 'student' && grade === null;

  if (isAdmin) redirect('/admin/sessions');

  // SES-005: Fetch active session(s) so the dashboard shows an
  // open/closed banner with a live countdown for the current window.
  let activeSessions: ActiveSessionRow[] = [];
  try {
    const serverApi = await getServerApi();
    const rows = await apiResponse(serverApi.v1.sessions.active.$get()) as ActiveSessionRow[];
    activeSessions = rows ?? [];
  } catch {
    // Non-fatal: dashboard still renders without the banner.
  }

  /* ── Quick-link definitions ───────────────────────────────────────────────── */

  type QuickLink = {
    href: string;
    title: string;
    description: string;
    icon: JSX.Element;
    visible: boolean;
  };

  const links: QuickLink[] = [
    {
      href: '/register',
      title: 'Register Subjects',
      description:
        role === 'parent'
          ? 'Register subjects for your children'
          : 'Browse and register for exam subjects',
      icon: (
        <svg className="size-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
      ),
      visible: !isGraduated,
    },
    {
      href: '/registrations',
      title: 'My Registrations',
      description: 'View current registrations and status',
      icon: (
        <svg className="size-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15a2.25 2.25 0 0 1 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V19.5a2.25 2.25 0 0 0 2.25 2.25h.75m0 0h3m-3 0h-3" />
        </svg>
      ),
      visible: true,
    },
    {
      href: '/subjects',
      title: 'Browse Subjects',
      description: 'View all available IGCSE subjects and pricing',
      icon: (
        <svg className="size-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
        </svg>
      ),
      visible: true,
    },
    {
      href: '/pending-requests',
      title: 'My Requests',
      description: 'View pending drop and swap requests',
      icon: (
        <svg className="size-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
        </svg>
      ),
      visible: !isGraduated && role === 'student',
    },
    {
      href: '/links',
      title: role === 'parent' ? 'Linked Children' : 'Linked Parents',
      description: 'Manage parent-student connections',
      icon: (
        <svg className="size-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
        </svg>
      ),
      visible: true,
    },
    {
      href: '/profile',
      title: 'Profile',
      description: 'View and update your account information',
      icon: (
        <svg className="size-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M17.982 18.725A7.488 7.488 0 0 0 12 15.75a7.488 7.488 0 0 0-5.982 2.975m11.963 0a9 9 0 1 0-11.963 0m11.963 0A8.966 8.966 0 0 1 12 21a8.966 8.966 0 0 1-5.982-2.275M15 9.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
        </svg>
      ),
      visible: true,
    },
    {
      href: '/escrow',
      title: 'Escrow Balance',
      description: 'View balance and request withdrawals',
      icon: (
        <svg className="size-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" />
        </svg>
      ),
      visible: role === 'parent',
    },
    {
      href: '/approvals',
      title: 'Pending Approvals',
      description: 'Review and approve student requests',
      icon: (
        <svg className="size-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
      ),
      visible: role === 'parent',
    },
  ];

  const visibleLinks = links.filter((l) => l.visible);

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 max-w-6xl mx-auto">
      {/* Welcome header */}
      <div className="animate-fade-up mb-8">
        <div className="flex flex-wrap items-center gap-3 mb-1">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-foreground tracking-tight">
            Welcome back, {session.user.name || session.user.email}
          </h1>
          <span className="inline-flex items-center rounded-full bg-brand-100 px-3 py-0.5 text-xs font-semibold text-brand-700 capitalize">
            {role || 'user'}
          </span>
          {role === 'student' && grade !== null && (
            <span className="inline-flex items-center rounded-full bg-secondary px-3 py-0.5 text-xs font-semibold text-secondary-foreground">
              Grade {grade}
            </span>
          )}
        </div>
        <p className="text-muted-foreground text-sm mt-1">
          IGCSE Subject Reservation System
        </p>
      </div>

      {/* SES-005: Active session status + countdown (hidden for graduated students) */}
      {!isGraduated && <SessionBanner sessions={activeSessions} />}

      {/* Graduated Banner */}
      {isGraduated && (
        <div className="animate-fade-up stagger-1 mb-8 rounded-xl border border-brand-200 bg-brand-50 p-6">
          <div className="flex items-start gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-brand-100">
              <svg className="size-6 text-brand-700" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342M6.75 15a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 0v-3.675A55.378 55.378 0 0 1 12 8.443m-7.007 11.55A5.981 5.981 0 0 0 6.75 15.75v-1.5" />
              </svg>
            </div>
            <div>
              <h2 className="font-display text-lg font-bold text-brand-800">
                Congratulations, Graduate!
              </h2>
              <p className="text-brand-700 mt-1 text-sm leading-relaxed">
                Your student record shows you have graduated. Registration, drop, and swap features are no longer available.
                If you believe this is an error, please contact the school administration.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Quick Links Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visibleLinks.map((link, i) => (
          <Link
            key={link.href}
            href={link.href as never}
            className={`animate-fade-up stagger-${Math.min(i + 1, 8)} group block`}
          >
            <div className="relative h-full rounded-xl border border-border bg-card p-5 shadow-sm transition-all duration-200 hover:border-brand-200 hover:shadow-md">
              <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600 transition-colors group-hover:bg-brand-100 group-hover:text-brand-700">
                {link.icon}
              </div>
              <h3 className="font-display font-semibold text-card-foreground">
                {link.title}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                {link.description}
              </p>
              {/* Hover arrow indicator */}
              <div className="absolute right-4 top-5 text-muted-foreground/0 transition-all duration-200 group-hover:text-brand-500 group-hover:translate-x-0.5">
                <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                </svg>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
