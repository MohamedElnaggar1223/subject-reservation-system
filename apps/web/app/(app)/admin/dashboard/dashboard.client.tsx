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
import { useI18n } from '~/lib/i18n';

// ─── Types ────────────────────────────────────────────────────────────────────

type DashboardMetrics = {
  students: {
    grade10: number;
    grade11: number;
    grade12: number;
    graduated: number;
    // F0a: students below grade 10, without a recorded cohort, and who left.
    upcoming: number;
    unknown: number;
    left: number;
    active: number;
    total: number;
  };
  parents: number;
  activeSessions: number;
  activeSessionList: { id: string; name: string; sessionType: string }[];
  pendingApprovals: number;
  pendingPayments: number;
  pendingChangeReqs: number;
  pendingBankTransfers: number;
  pendingWithdrawals: number;
  pendingWithdrawalsAmountEGP: number;
  currentSessionRegistrations: number;
  currentSessionRevenueEGP: number;
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

type PaginatedList<T> = { data: T[]; total: number } | T[];

type PendingReport = {
  pendingRegistrations: PaginatedList<PendingReg>;
  pendingChangeRequests: PaginatedList<PendingCR>;
};

function extractList<T>(list: PaginatedList<T> | undefined): T[] {
  if (!list) return [];
  if (Array.isArray(list)) return list;
  return list.data;
}

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
  accent?: 'teal' | 'amber' | 'red' | 'indigo' | 'blue' | 'purple';
  href?: string;
}) {
  const accentBorder = {
    teal:   'border-l-brand-500',
    amber:  'border-l-chart-5',
    red:    'border-l-destructive',
    indigo: 'border-l-chart-4',
    blue:   'border-l-chart-2',
    purple: 'border-l-chart-4',
  }[accent ?? 'teal'];

  const iconBg = {
    teal:   'bg-brand-50 text-brand-600',
    amber:  'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400',
    red:    'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400',
    indigo: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400',
    blue:   'bg-brand-50 text-brand-600',
    purple: 'bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400',
  }[accent ?? 'teal'];

  const card = (
    <div
      className={`
        bg-card rounded-xl border border-border border-l-4 ${accentBorder}
        p-5 shadow-sm hover:shadow-md transition-all duration-200
        ${href ? 'cursor-pointer hover:border-l-brand-600' : ''}
      `}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide truncate">
            {label}
          </p>
          <p className="mt-1.5 text-2xl font-bold text-card-foreground tabular-nums">
            {value}
          </p>
          {sub && (
            <p className="mt-1 text-xs text-muted-foreground truncate">{sub}</p>
          )}
        </div>
        <div className={`hidden sm:flex size-9 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
          {accent === 'amber' && (
            <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          )}
          {accent === 'red' && (
            <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
          )}
          {accent === 'teal' && (
            <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
            </svg>
          )}
          {accent === 'indigo' && (
            <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
            </svg>
          )}
          {accent === 'blue' && (
            <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
            </svg>
          )}
          {accent === 'purple' && (
            <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" />
            </svg>
          )}
        </div>
      </div>
    </div>
  );

  if (href) return <Link href={href as never}>{card}</Link>;
  return card;
}

// ─── Days Badge ───────────────────────────────────────────────────────────────

function DaysBadge({ days }: { days: number }) {
  const { t } = useI18n();
  const cls =
    days >= 7
      ? 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-900/20 dark:text-red-400 dark:ring-red-800'
      : days >= 3
        ? 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:ring-amber-800'
        : 'bg-secondary text-muted-foreground ring-border';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ring-1 ring-inset ${cls}`}>
      {days}{t('dashboard.daysShort')}
    </span>
  );
}

// ─── Type Badge ───────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: 'registration' | 'drop' | 'swap' }) {
  const { t } = useI18n();
  const styles = {
    registration: 'bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-50 dark:text-brand-700 dark:ring-brand-200',
    drop: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-900/20 dark:text-red-400 dark:ring-red-800',
    swap: 'bg-purple-50 text-purple-700 ring-purple-200 dark:bg-purple-900/20 dark:text-purple-400 dark:ring-purple-800',
  }[type];

  const labels = {
    registration: t('dashboard.registration'),
    drop: t('dashboard.drop'),
    swap: t('dashboard.swap'),
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ring-1 ring-inset ${styles}`}>
      {labels[type]}
    </span>
  );
}

// ─── Section Header ──────────────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
      {children}
    </h2>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AdminDashboardClient() {
  const { t } = useI18n();
  const { data: metrics, isLoading: metricsLoading } = useQuery<DashboardMetrics>({
    queryKey: ['reports', 'dashboard'],
    queryFn: () => apiResponse(api.v1.reports.dashboard.$get({ query: {} })),
  });

  const { data: pending, isLoading: pendingLoading } = useQuery<PendingReport>({
    queryKey: ['reports', 'pending-approvals'],
    queryFn: () => apiResponse(api.v1.reports['pending-approvals'].$get({ query: {} })),
  });

  const pendingRegs = extractList(pending?.pendingRegistrations);
  const pendingCRs = extractList(pending?.pendingChangeRequests);
  const totalPending = pendingRegs.length + pendingCRs.length;

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="animate-fade-up mb-8">
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-foreground tracking-tight">
          {t('dashboard.title')}
        </h1>
        {metrics && (
          <p className="mt-1 text-xs text-muted-foreground">
            {t('dashboard.lastUpdated')} {new Date(metrics.generatedAt).toLocaleTimeString()}
          </p>
        )}
      </div>

      {/* Metrics Grid */}
      {metricsLoading ? (
        <div className="animate-fade-up stagger-1 grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-28 bg-card border border-border rounded-xl animate-pulse"
            />
          ))}
        </div>
      ) : metrics ? (
        <>
          {/* Action-Required row */}
          <div className="animate-fade-up stagger-1 mb-6">
            <SectionHeader>{t('dashboard.actionRequired')}</SectionHeader>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <MetricCard
                label={t('dashboard.pendingApprovals')}
                value={metrics.pendingApprovals}
                sub={t('dashboard.registrationRequests')}
                accent="amber"
                href="/admin/reports"
              />
              <MetricCard
                label={t('dashboard.pendingPayments')}
                value={metrics.pendingPayments}
                sub={t('dashboard.awaitingParentPayment')}
                accent="amber"
              />
              <MetricCard
                label={t('dashboard.changeRequests')}
                value={metrics.pendingChangeReqs}
                sub={t('dashboard.dropSwapRequests')}
                accent="amber"
                href="/admin/reports"
              />
              <MetricCard
                label={t('dashboard.bankTransfers')}
                value={metrics.pendingBankTransfers}
                sub={t('dashboard.manualConfirmationNeeded')}
                accent="red"
                href="/admin/payments"
              />
              <MetricCard
                label={t('dashboard.withdrawals')}
                value={metrics.pendingWithdrawals}
                sub={`EGP ${(metrics.pendingWithdrawalsAmountEGP ?? 0).toLocaleString('en-EG', { minimumFractionDigits: 2 })} ${t('dashboard.total')}`}
                accent="red"
                href="/admin/escrow"
              />
            </div>
          </div>

          {/* Current session row (REP-008 per URD) */}
          <div className="animate-fade-up stagger-3 mb-6">
            <SectionHeader>{metrics.activeSessions === 1 ? t('dashboard.currentSession') : t('dashboard.currentSessions')}</SectionHeader>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard
                label={t('dashboard.activeSessions')}
                value={metrics.activeSessions}
                sub={metrics.activeSessionList?.map((s) => s.name).join(', ') || t('dashboard.noneOpen')}
                accent="teal"
                href="/admin/sessions"
              />
              <MetricCard
                label={t('dashboard.registrationsCurrent')}
                value={metrics.currentSessionRegistrations}
                sub={t('dashboard.inActiveSessions')}
                accent="indigo"
              />
              <MetricCard
                label={t('dashboard.revenueCurrent')}
                value={`EGP ${metrics.currentSessionRevenueEGP.toLocaleString('en-EG', { minimumFractionDigits: 2 })}`}
                sub={t('dashboard.confirmedPayments')}
                accent="teal"
              />
              <MetricCard
                label={t('dashboard.confirmedThisMonth')}
                value={metrics.confirmedThisMonth}
                sub={t('dashboard.registrationsConfirmed')}
                accent="blue"
              />
            </div>
          </div>

          {/* Overview row */}
          <div className="animate-fade-up stagger-4 mb-6">
            <SectionHeader>{t('dashboard.overview')}</SectionHeader>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard
                label={t('dashboard.escrowLiability')}
                value={`EGP ${metrics.escrowLiabilityEGP.toLocaleString('en-EG', { minimumFractionDigits: 2 })}`}
                sub={t('dashboard.totalPositiveBalances')}
                accent="purple"
                href="/admin/escrow"
              />
              <MetricCard
                label={t('dashboard.activeStudents')}
                value={metrics.students.active ?? (metrics.students.total - metrics.students.graduated)}
                sub={t('dashboard.excludingGraduated')}
                accent="indigo"
              />
              <MetricCard
                label={t('dashboard.totalParents')}
                value={metrics.parents}
                accent="blue"
              />
              <MetricCard
                label={t('dashboard.pendingWithdrawals')}
                value={metrics.pendingWithdrawals}
                sub={`EGP ${metrics.pendingWithdrawalsAmountEGP.toLocaleString('en-EG', { minimumFractionDigits: 2 })}`}
                accent="amber"
                href="/admin/escrow"
              />
            </div>
          </div>

          {/* Students by grade */}
          <div className="animate-fade-up stagger-5 mb-8">
            <SectionHeader>{t('dashboard.studentsByGrade')}</SectionHeader>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard label={t('reports.grade10')} value={metrics.students.grade10} accent="indigo" />
              <MetricCard label={t('reports.grade11')} value={metrics.students.grade11} accent="indigo" />
              <MetricCard label={t('reports.grade12')} value={metrics.students.grade12} accent="indigo" />
              <MetricCard
                label={t('reports.graduated')}
                value={metrics.students.graduated}
                sub={`${t('dashboard.total')}: ${metrics.students.total}`}
                accent="indigo"
              />
              {metrics.students.upcoming > 0 && (
                <MetricCard label={t('dashboard.gradeUpcoming')} value={metrics.students.upcoming} accent="indigo" />
              )}
              {metrics.students.unknown > 0 && (
                <MetricCard
                  label={t('dashboard.gradeUnknown')}
                  value={metrics.students.unknown}
                  sub={t('dashboard.fixOnStudents')}
                  accent="amber"
                  href="/students?status=unknown"
                />
              )}
              {metrics.students.left > 0 && (
                <MetricCard label={t('dashboard.leftSchool')} value={metrics.students.left} accent="indigo" />
              )}
            </div>
          </div>
        </>
      ) : null}

      {/* Pending Approvals Table */}
      <div className="animate-fade-up stagger-7 bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="font-display text-base font-semibold text-card-foreground">
              {t('dashboard.pendingApprovals')}
              {totalPending > 0 && (
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:ring-amber-800">
                  {totalPending}
                </span>
              )}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('dashboard.pendingApprovalsDescription')}
            </p>
          </div>
          <Link
            href={"/admin/reports" as never}
            className="text-xs font-medium text-brand-600 hover:text-brand-700 transition-colors"
          >
            {t('dashboard.fullReport')} &rarr;
          </Link>
        </div>

        {pendingLoading && (
          <div className="py-16 text-center text-muted-foreground text-sm">
            {t('dashboard.loadingPendingApprovals')}
          </div>
        )}

        {!pendingLoading && totalPending === 0 && (
          <div className="py-16 text-center">
            <div className="inline-flex size-12 items-center justify-center rounded-full bg-brand-50 mb-3">
              <svg className="size-6 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </div>
            <p className="text-muted-foreground text-sm font-medium">
              {t('dashboard.allApprovalsUpToDate')}
            </p>
          </div>
        )}

        {!pendingLoading && totalPending > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">
                    {t('dashboard.type')}
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">
                    {t('dashboard.student')}
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">
                    {t('dashboard.subject')}
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">
                    {t('dashboard.session')}
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">
                    {t('dashboard.amount')}
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">
                    {t('dashboard.waiting')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pendingRegs.map((r) => (
                  <tr
                    key={r.registrationId}
                    className="hover:bg-accent/50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <TypeBadge type="registration" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-card-foreground text-xs">
                        {r.studentName}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {r.studentGrade}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {r.subjectName}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {r.sessionName}
                    </td>
                    <td className="px-4 py-3 text-xs font-medium text-card-foreground">
                      EGP {r.priceEGP.toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <DaysBadge days={r.daysWaiting} />
                    </td>
                  </tr>
                ))}
                {pendingCRs.map((cr) => (
                  <tr
                    key={cr.changeRequestId}
                    className="hover:bg-accent/50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <TypeBadge type={cr.type === 'drop' ? 'drop' : 'swap'} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-card-foreground text-xs">
                        {cr.studentName}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {cr.studentGrade}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {cr.currentSubject}
                      {cr.type === 'swap' && cr.newSubject !== '\u2014' && (
                        <span className="text-muted-foreground/70">
                          {' '}&rarr; {cr.newSubject}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {cr.sessionName}
                    </td>
                    <td className="px-4 py-3 text-xs font-medium">
                      {cr.priceDiffEGP !== 0 ? (
                        <span
                          className={
                            cr.priceDiffEGP > 0
                              ? 'text-destructive'
                              : 'text-brand-600'
                          }
                        >
                          {cr.priceDiffEGP > 0 ? '+' : ''}EGP{' '}
                          {cr.priceDiffEGP.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">&mdash;</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <DaysBadge days={cr.daysWaiting} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
