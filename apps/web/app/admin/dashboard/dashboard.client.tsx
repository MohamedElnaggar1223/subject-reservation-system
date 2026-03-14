'use client';

/**
 * Admin Dashboard Client Component (REP-008 + REP-009)
 *
 * Displays:
 * - Key metrics cards: student counts by grade, parents, active sessions,
 *   pending approvals, pending payments, pending bank transfers, escrow liability
 * - Pending approvals table: registration requests + change requests with age
 * - Quick action links to manage approvals
 *
 * Data is pre-fetched on the server and hydrated here for instant display.
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse } from '@repo/validations';
import Link from 'next/link';

// ─── Types ────────────────────────────────────────────────────────────────────

type DashboardMetrics = {
  students: {
    grade10: number;
    grade11: number;
    grade12: number;
    graduated: number;
    total: number;
  };
  parents: number;
  activeSessions: number;
  pendingApprovals: number;
  pendingPayments: number;
  pendingChangeReqs: number;
  pendingBankTransfers: number;
  confirmedThisMonth: number;
  escrowLiabilityEGP: number;
  generatedAt: string;
};

type PendingReg = {
  registrationId: string;
  studentName: string;
  studentIdCode: string;
  studentGrade: number | string;
  subjectName: string;
  subjectCode: string;
  sessionName: string;
  priceEGP: number;
  daysWaiting: number;
  submittedAt: string;
};

type PendingCR = {
  changeRequestId: string;
  type: string;
  studentName: string;
  studentGrade: number | string;
  currentSubject: string;
  newSubject: string;
  sessionName: string;
  priceDiffEGP: number;
  daysWaiting: number;
  submittedAt: string;
  reason: string;
};

type PendingReport = {
  pendingRegistrations: PendingReg[];
  pendingChangeRequests: PendingCR[];
};

// ─── Metric Card ──────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
  accent,
  href,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: 'green' | 'amber' | 'red' | 'indigo' | 'blue' | 'purple';
  href?: string;
}) {
  const accentClass = {
    green:  'border-l-emerald-500',
    amber:  'border-l-amber-500',
    red:    'border-l-red-500',
    indigo: 'border-l-indigo-500',
    blue:   'border-l-blue-500',
    purple: 'border-l-purple-500',
  }[accent ?? 'indigo'];

  const card = (
    <div className={`bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-5 border-l-4 ${accentClass} hover:shadow-md transition-shadow`}>
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
    </div>
  );

  if (href) return <Link href={href}>{card}</Link>;
  return card;
}

// ─── Days Badge ───────────────────────────────────────────────────────────────

function DaysBadge({ days }: { days: number }) {
  const cls =
    days >= 7 ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
    days >= 3 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold ${cls}`}>
      {days}d
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AdminDashboardClient() {
  const { data: metrics, isLoading: metricsLoading } = useQuery<DashboardMetrics>({
    queryKey: ['reports', 'dashboard'],
    queryFn: () => apiResponse(api.v1.reports.dashboard.$get({ query: {} })),
  });

  const { data: pending, isLoading: pendingLoading } = useQuery<PendingReport>({
    queryKey: ['reports', 'pending-approvals'],
    queryFn: () => apiResponse(api.v1.reports['pending-approvals'].$get({ query: {} })),
  });

  const totalPending = (pending?.pendingRegistrations.length ?? 0) + (pending?.pendingChangeRequests.length ?? 0);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">

        {/* Header */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">
              Admin Dashboard
            </h1>
            {metrics && (
              <p className="mt-1 text-xs text-gray-400">
                Last updated {new Date(metrics.generatedAt).toLocaleTimeString()}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Link
              href="/admin/reports"
              className="px-4 py-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
            >
              Reports
            </Link>
            <Link
              href="/admin/audit"
              className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Audit Log
            </Link>
          </div>
        </div>

        {/* Metrics Grid */}
        {metricsLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-24 bg-gray-100 dark:bg-gray-800 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : metrics ? (
          <>
            {/* Action-Required row */}
            <div className="mb-3">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Action Required</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <MetricCard
                  label="Pending Approvals"
                  value={metrics.pendingApprovals}
                  sub="Registration requests"
                  accent="amber"
                  href="/admin/reports"
                />
                <MetricCard
                  label="Pending Payments"
                  value={metrics.pendingPayments}
                  sub="Awaiting parent payment"
                  accent="amber"
                />
                <MetricCard
                  label="Pending Change Requests"
                  value={metrics.pendingChangeReqs}
                  sub="Drop / swap requests"
                  accent="amber"
                  href="/admin/reports"
                />
                <MetricCard
                  label="Pending Bank Transfers"
                  value={metrics.pendingBankTransfers}
                  sub="Manual confirmation needed"
                  accent="red"
                  href="/admin/payments"
                />
              </div>
            </div>

            {/* Stats row */}
            <div className="mb-3">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2 mt-4">Overview</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <MetricCard
                  label="Active Sessions"
                  value={metrics.activeSessions}
                  sub="Registration windows open"
                  accent="green"
                  href="/admin/sessions"
                />
                <MetricCard
                  label="Confirmed This Month"
                  value={metrics.confirmedThisMonth}
                  sub="Registrations confirmed"
                  accent="green"
                />
                <MetricCard
                  label="Escrow Liability"
                  value={`EGP ${metrics.escrowLiabilityEGP.toLocaleString('en-EG', { minimumFractionDigits: 2 })}`}
                  sub="Total positive balances"
                  accent="purple"
                  href="/admin/escrow"
                />
                <MetricCard
                  label="Total Parents"
                  value={metrics.parents}
                  accent="blue"
                />
              </div>
            </div>

            {/* Students by grade */}
            <div className="mb-6">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2 mt-4">Students by Grade</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <MetricCard label="Grade 10" value={metrics.students.grade10} accent="indigo" />
                <MetricCard label="Grade 11" value={metrics.students.grade11} accent="indigo" />
                <MetricCard label="Grade 12" value={metrics.students.grade12} accent="indigo" />
                <MetricCard
                  label="Graduated"
                  value={metrics.students.graduated}
                  sub={`Total: ${metrics.students.total}`}
                  accent="indigo"
                />
              </div>
            </div>
          </>
        ) : null}

        {/* Pending Approvals Table */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                Pending Approvals
                {totalPending > 0 && (
                  <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                    {totalPending}
                  </span>
                )}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">Registration requests + drop/swap requests awaiting parent approval</p>
            </div>
            <Link
              href="/admin/reports"
              className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Full report →
            </Link>
          </div>

          {pendingLoading && (
            <div className="py-12 text-center text-gray-400 text-sm">Loading pending approvals…</div>
          )}

          {!pendingLoading && totalPending === 0 && (
            <div className="py-12 text-center">
              <p className="text-2xl mb-2">✅</p>
              <p className="text-gray-500 dark:text-gray-400 text-sm font-medium">All approvals are up to date</p>
            </div>
          )}

          {!pendingLoading && totalPending > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-gray-50 dark:border-gray-800">
                    <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Type</th>
                    <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Student</th>
                    <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Subject</th>
                    <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Session</th>
                    <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Amount</th>
                    <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Waiting</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {pending?.pendingRegistrations.map((r) => (
                    <tr key={r.registrationId} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                          Registration
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-800 dark:text-gray-200 text-xs">{r.studentName}</div>
                        <div className="text-gray-400 text-xs">Grade {r.studentGrade}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400">{r.subjectName}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{r.sessionName}</td>
                      <td className="px-4 py-3 text-xs text-gray-700 dark:text-gray-300">EGP {r.priceEGP.toFixed(2)}</td>
                      <td className="px-4 py-3"><DaysBadge days={r.daysWaiting} /></td>
                    </tr>
                  ))}
                  {pending?.pendingChangeRequests.map((cr) => (
                    <tr key={cr.changeRequestId} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${cr.type === 'drop' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'}`}>
                          {cr.type === 'drop' ? 'Drop' : 'Swap'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-800 dark:text-gray-200 text-xs">{cr.studentName}</div>
                        <div className="text-gray-400 text-xs">Grade {cr.studentGrade}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400">
                        {cr.currentSubject}
                        {cr.type === 'swap' && cr.newSubject !== '—' && (
                          <span className="text-gray-400"> → {cr.newSubject}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{cr.sessionName}</td>
                      <td className="px-4 py-3 text-xs text-gray-700 dark:text-gray-300">
                        {cr.priceDiffEGP !== 0 ? (
                          <span className={cr.priceDiffEGP > 0 ? 'text-red-600' : 'text-emerald-600'}>
                            {cr.priceDiffEGP > 0 ? '+' : ''}EGP {cr.priceDiffEGP.toFixed(2)}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3"><DaysBadge days={cr.daysWaiting} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
