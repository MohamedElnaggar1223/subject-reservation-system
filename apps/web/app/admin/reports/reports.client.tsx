'use client';

/**
 * Admin Report Generator Client Component
 *
 * On-demand report generator for all REP-001 to REP-009 reports.
 *
 * Reports available:
 * - REP-001: Registration Report (per session, with approval trail)
 * - REP-002: Financial Summary (school vs. non-school revenue)
 * - REP-003: Escrow Report (all balances + pending withdrawals)
 * - REP-004: Subject Enrollment (per session)
 * - REP-005: Grade 10 Compliance (core subject check)
 * - REP-007: Student Roster (by grade with contacts)
 * - REP-009: Pending Approvals (all pending requests with age)
 *
 * Features:
 * - Report picker sidebar
 * - Dynamic filter form per report type (session selector, grade filter, etc.)
 * - Results table rendered per report type
 * - CSV download button for each report
 */

import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse } from '@repo/validations';

// ─── Report Definitions ───────────────────────────────────────────────────────

const REPORTS = [
  { id: 'pending-approvals', label: 'Pending Approvals',    badge: 'REP-009', needsSession: false, needsGrade: false },
  { id: 'registrations',     label: 'Registration Report',  badge: 'REP-001', needsSession: true,  needsGrade: true  },
  { id: 'financial',         label: 'Financial Summary',    badge: 'REP-002', needsSession: true,  needsGrade: false },
  { id: 'enrollment',        label: 'Subject Enrollment',   badge: 'REP-004', needsSession: true,  needsGrade: false },
  { id: 'compliance',        label: 'Grade 10 Compliance',  badge: 'REP-005', needsSession: true,  needsGrade: false },
  { id: 'roster',            label: 'Student Roster',       badge: 'REP-007', needsSession: false, needsGrade: true  },
  { id: 'escrow',            label: 'Escrow Report',        badge: 'REP-003', needsSession: false, needsGrade: false },
] as const;

type ReportId = typeof REPORTS[number]['id'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildCSVUrl(reportId: ReportId, sessionId: string, grade: string): string {
  const base = `/api/v1/reports/${reportId}`;
  const params = new URLSearchParams({ format: 'csv' });
  if (sessionId) params.set('sessionId', sessionId);
  if (grade)     params.set('grade', grade);
  return `${base}?${params.toString()}`;
}

// Generic flat table renderer
function DataTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return <p className="text-sm text-gray-400 py-4 text-center">No data found.</p>;
  const headers = Object.keys(rows[0]);
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-gray-800">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-3 py-2 text-left font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">
                {h.replace(/([A-Z])/g, ' $1').trim()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
          {rows.map((row, idx) => (
            <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
              {headers.map((h) => (
                <td key={h} className="px-3 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap max-w-[200px] truncate">
                  {row[h] === null || row[h] === undefined ? '—' : String(row[h])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Pending approvals specialized renderer
function PendingApprovalsView({ data }: { data: { pendingRegistrations: Record<string, unknown>[]; pendingChangeRequests: Record<string, unknown>[] } }) {
  const totalRegs = data.pendingRegistrations.length;
  const totalCRs  = data.pendingChangeRequests.length;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
          Registration Requests <span className="text-gray-400 font-normal">({totalRegs})</span>
        </h3>
        <DataTable rows={data.pendingRegistrations} />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
          Drop / Swap Requests <span className="text-gray-400 font-normal">({totalCRs})</span>
        </h3>
        <DataTable rows={data.pendingChangeRequests} />
      </div>
    </div>
  );
}

// Compliance specialized renderer
function ComplianceView({ data }: { data: { students: Record<string, unknown>[]; coreSubjects: string[] } }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-3">
        Core subjects: {data.coreSubjects.join(', ') || 'None defined'}
      </p>
      <DataTable rows={data.students.map((s) => ({
        studentName:   s.studentName,
        studentIdCode: s.studentIdCode,
        isCompliant:   s.isCompliant ? '✅ Yes' : '❌ No',
      }))} />
    </div>
  );
}

// Financial specialized renderer
function FinancialView({ data }: { data: Record<string, unknown> }) {
  const methodBreakdown = data.revenueByPaymentMethod as Record<string, number> | undefined;
  const flatRows: Record<string, unknown>[] = [
    { metric: 'Confirmed Revenue — School Subjects (EGP)',     value: data.confirmedRevenueSchoolEGP },
    { metric: 'Confirmed Revenue — Non-School Subjects (EGP)', value: data.confirmedRevenueNonSchoolEGP },
    { metric: 'Total Confirmed Revenue (EGP)',                 value: data.confirmedRevenueTotalEGP },
    { metric: 'Pending Revenue (EGP)',                         value: data.pendingRevenueEGP },
  ];
  if (methodBreakdown) {
    for (const [method, amount] of Object.entries(methodBreakdown)) {
      flatRows.push({ metric: `By payment method — ${method} (EGP)`, value: amount });
    }
  }
  return <DataTable rows={flatRows} />;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ReportsClient() {
  const [activeReport, setActiveReport] = useState<ReportId>('pending-approvals');
  const [sessionId, setSessionId]       = useState('');
  const [grade, setGrade]               = useState('');
  const [submitted, setSubmitted]       = useState(false);

  const reportDef = REPORTS.find((r) => r.id === activeReport)!;

  const canRun =
    (!reportDef.needsSession || sessionId.trim().length === 36) &&
    true; // grade is always optional

  const queryKey = ['reports', activeReport, sessionId, grade, submitted];

  const { data, isLoading, isError, isFetched } = useQuery({
    queryKey,
    enabled: submitted && canRun,
    queryFn: async () => {
      const q: Record<string, string> = {};
      if (sessionId) q.sessionId = sessionId;
      if (grade) q.grade = grade;

      switch (activeReport) {
        case 'pending-approvals':
          return apiResponse(api.v1.reports['pending-approvals'].$get({ query: {} }));
        case 'registrations':
          return apiResponse(api.v1.reports.registrations.$get({ query: { sessionId, ...(grade ? { grade } : {}) } }));
        case 'financial':
          return apiResponse(api.v1.reports.financial.$get({ query: { sessionId } }));
        case 'enrollment':
          return apiResponse(api.v1.reports.enrollment.$get({ query: { sessionId } }));
        case 'compliance':
          return apiResponse(api.v1.reports.compliance.$get({ query: { sessionId } }));
        case 'roster':
          return apiResponse(api.v1.reports.roster.$get({ query: grade ? { grade } : {} }));
        case 'escrow':
          return apiResponse(api.v1.reports.escrow.$get({ query: {} }));
        default:
          return null;
      }
    },
  });

  const handleRun = useCallback(() => {
    setSubmitted(true);
  }, []);

  const handleReportChange = useCallback((id: ReportId) => {
    setActiveReport(id);
    setSessionId('');
    setGrade('');
    setSubmitted(false);
  }, []);

  const renderResults = () => {
    if (!submitted) return null;
    if (isLoading) return <div className="py-12 text-center text-gray-400 text-sm">Generating report…</div>;
    if (isError) return <div className="py-12 text-center text-red-500 text-sm">Failed to generate report. Check your session ID and try again.</div>;
    if (!isFetched || data === null || data === undefined) return null;

    if (activeReport === 'pending-approvals') {
      return <PendingApprovalsView data={data as { pendingRegistrations: Record<string, unknown>[]; pendingChangeRequests: Record<string, unknown>[] }} />;
    }
    if (activeReport === 'financial') {
      return <FinancialView data={data as Record<string, unknown>} />;
    }
    if (activeReport === 'compliance') {
      const d = data as { students: Record<string, unknown>[]; coreSubjects: string[] };
      return <ComplianceView data={d} />;
    }
    if (Array.isArray(data)) {
      return <DataTable rows={data as Record<string, unknown>[]} />;
    }
    return <DataTable rows={[data as Record<string, unknown>]} />;
  };

  const rowCount = (() => {
    if (!data) return null;
    if (Array.isArray(data)) return data.length;
    if (activeReport === 'pending-approvals') {
      const d = data as { pendingRegistrations: unknown[]; pendingChangeRequests: unknown[] };
      return (d.pendingRegistrations?.length ?? 0) + (d.pendingChangeRequests?.length ?? 0);
    }
    return null;
  })();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">Reports</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Generate and export data reports. All reports support CSV download.
          </p>
        </div>

        <div className="flex flex-col lg:flex-row gap-6">

          {/* Report picker sidebar */}
          <aside className="lg:w-56 shrink-0">
            <nav className="space-y-1">
              {REPORTS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => handleReportChange(r.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-colors flex items-center gap-2 ${
                    activeReport === r.id
                      ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-800'
                  }`}
                >
                  <span className="flex-1">{r.label}</span>
                  <span className="text-xs text-gray-400 shrink-0">{r.badge}</span>
                </button>
              ))}
            </nav>
          </aside>

          {/* Main panel */}
          <main className="flex-1 min-w-0 space-y-5">

            {/* Filters card */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-5">
              <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-4">
                {reportDef.label}
                <span className="ml-2 text-xs font-normal text-gray-400">{reportDef.badge}</span>
              </h2>

              <div className="flex flex-wrap gap-4 items-end">
                {reportDef.needsSession && (
                  <div className="flex-1 min-w-[200px]">
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                      Session ID <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={sessionId}
                      onChange={(e) => { setSessionId(e.target.value); setSubmitted(false); }}
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm px-3 py-2 text-gray-900 dark:text-gray-100 font-mono placeholder:text-gray-400 placeholder:font-sans focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <p className="text-xs text-gray-400 mt-1">Find session IDs in Session Management.</p>
                  </div>
                )}

                {reportDef.needsGrade && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                      Grade
                    </label>
                    <select
                      value={grade}
                      onChange={(e) => { setGrade(e.target.value); setSubmitted(false); }}
                      className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm px-3 py-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="">All grades</option>
                      <option value="10">Grade 10</option>
                      <option value="11">Grade 11</option>
                      <option value="12">Grade 12</option>
                      <option value="graduated">Graduated</option>
                    </select>
                  </div>
                )}

                <div className="flex gap-2 self-end">
                  <button
                    onClick={handleRun}
                    disabled={!canRun || isLoading}
                    className="px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {isLoading ? 'Loading…' : 'Run Report'}
                  </button>

                  {submitted && isFetched && !isError && (
                    <a
                      href={buildCSVUrl(activeReport, sessionId, grade)}
                      download
                      className="px-4 py-2 rounded-lg text-sm font-semibold border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    >
                      ↓ CSV
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* Results card */}
            {submitted && (
              <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                    Results
                    {rowCount !== null && (
                      <span className="ml-2 text-xs font-normal text-gray-400">{rowCount} row{rowCount !== 1 ? 's' : ''}</span>
                    )}
                  </h3>
                </div>
                {renderResults()}
              </div>
            )}

          </main>
        </div>
      </div>
    </div>
  );
}
