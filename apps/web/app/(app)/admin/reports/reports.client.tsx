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
import { env } from '~/env';
import { Button } from '~/components/ui/button';
import { useI18n, type TranslationKey } from '~/lib/i18n';

// --- Report Definitions ---

const REPORTS = [
  { id: 'comprehensive',     labelKey: 'reports.comprehensive',     badge: 'ALL',     needsSession: false, needsGrade: false },
  { id: 'pending-approvals', labelKey: 'reports.pendingApprovals',   badge: 'REP-009', needsSession: false, needsGrade: false },
  { id: 'registrations',     labelKey: 'reports.registrations',      badge: 'REP-001', needsSession: true,  needsGrade: true  },
  { id: 'financial',         labelKey: 'reports.financial',          badge: 'REP-002', needsSession: true,  needsGrade: false },
  { id: 'enrollment',        labelKey: 'reports.enrollment',         badge: 'REP-004', needsSession: true,  needsGrade: false },
  { id: 'compliance',        labelKey: 'reports.compliance',         badge: 'REP-005', needsSession: true,  needsGrade: false },
  { id: 'roster',            labelKey: 'reports.roster',             badge: 'REP-007', needsSession: false, needsGrade: true  },
  { id: 'escrow',            labelKey: 'reports.escrow',             badge: 'REP-003', needsSession: false, needsGrade: false },
] as const;

type ReportId = typeof REPORTS[number]['id'];
type ReportDefinition = typeof REPORTS[number];

// --- Helpers ---

async function downloadCSV(reportId: ReportId, sessionId: string, grade: string) {
  const params = new URLSearchParams({ format: 'csv' });
  if (sessionId) params.set('sessionId', sessionId);
  if (grade)     params.set('grade', grade);

  const url = `${env.apiUrl}/v1/reports/${reportId}?${params.toString()}`;
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
      console.error('CSV download failed:', res.status, res.statusText);
      return;
    }
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `${reportId}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);
  } catch (err) {
    console.error('CSV download error:', err);
  }
}

// Generic flat table renderer
function DataTable({ rows }: { rows: Record<string, unknown>[] }) {
  const { t } = useI18n();
  if (!rows.length) return <p className="text-sm text-muted-foreground py-4 text-center">{t('common.noData')}</p>;
  const headers = Object.keys(rows[0]!);
  return (
    <div className="overflow-x-auto bg-card rounded-xl border border-border shadow-sm">
      <table className="w-full text-xs">
        <thead className="bg-muted border-b border-border">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                {h.replace(/([A-Z])/g, ' $1').trim()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, idx) => (
            <tr key={idx} className="hover:bg-muted/50 transition-colors">
              {headers.map((h) => (
                <td key={h} className="px-3 py-2 text-card-foreground whitespace-nowrap max-w-[200px] truncate">
                  {row[h] === null || row[h] === undefined ? '---' : String(row[h])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Helper to extract rows from paginated or plain response
function extractRows(data: unknown): Record<string, unknown>[] {
  if (!data) return [];
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (typeof data === 'object' && data !== null && 'data' in data && Array.isArray((data as { data: unknown }).data)) {
    return (data as { data: Record<string, unknown>[] }).data;
  }
  return [data as Record<string, unknown>];
}

function extractTotal(data: unknown): number | null {
  if (!data) return null;
  if (typeof data === 'object' && data !== null && 'total' in data) {
    return (data as { total: number }).total;
  }
  if (Array.isArray(data)) return data.length;
  return null;
}

// Pending approvals specialized renderer
function PendingApprovalsView({ data }: { data: { pendingRegistrations: unknown; pendingChangeRequests: unknown } }) {
  const { t } = useI18n();
  const regs = extractRows(data.pendingRegistrations);
  const crs  = extractRows(data.pendingChangeRequests);
  const totalRegs = extractTotal(data.pendingRegistrations) ?? regs.length;
  const totalCRs  = extractTotal(data.pendingChangeRequests) ?? crs.length;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">
          {t('reports.registrationRequests')} <span className="text-muted-foreground font-normal">({totalRegs})</span>
        </h3>
        <DataTable rows={regs} />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">
          {t('reports.dropSwapRequests')} <span className="text-muted-foreground font-normal">({totalCRs})</span>
        </h3>
        <DataTable rows={crs} />
      </div>
    </div>
  );
}

// Compliance specialized renderer (REP-005)
// URD requires "approval status per subject". Expand each row with a
// per-core-subject column: name + its registration status (not_registered,
// pending_approval, pending_payment, confirmed, dropped, etc).
type ComplianceSubjectStatus = {
  subjectName: string;
  status: string;
};
type ComplianceStudentRow = {
  studentName: string;
  studentIdCode: string;
  isCompliant: boolean;
  subjects?: ComplianceSubjectStatus[];
};

const COMPLIANCE_STATUS_STYLE: Record<string, string> = {
  confirmed:        'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300',
  pending_payment:  'bg-brand-50 text-brand-700',
  pending_approval: 'bg-amber-50 text-amber-700',
  dropped:          'bg-muted text-muted-foreground',
  rejected:         'bg-destructive/10 text-destructive',
  expired:          'bg-muted text-muted-foreground',
  not_registered:   'bg-destructive/10 text-destructive',
};

function ComplianceView({ data }: { data: { students: ComplianceStudentRow[]; coreSubjects: string[] } }) {
  const { t } = useI18n();
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-3">
        {t('reports.coreSubjects')}: {data.coreSubjects.join(', ') || t('reports.noneDefined')}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">{t('reports.student')}</th>
              <th className="px-3 py-2 text-left font-medium">{t('reports.studentId')}</th>
              <th className="px-3 py-2 text-left font-medium">{t('reports.compliant')}</th>
              <th className="px-3 py-2 text-left font-medium">{t('reports.perSubjectStatus')}</th>
            </tr>
          </thead>
          <tbody>
            {data.students.map((s, idx) => (
              <tr key={idx} className="border-t border-border align-top">
                <td className="px-3 py-2 font-medium text-foreground">{s.studentName}</td>
                <td className="px-3 py-2 text-muted-foreground font-mono text-xs">{s.studentIdCode}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                    s.isCompliant
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
                      : 'bg-destructive/10 text-destructive'
                  }`}>
                    {s.isCompliant ? t('common.yes') : t('common.no')}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {s.subjects && s.subjects.length > 0 ? (
                    <ul className="space-y-1">
                      {s.subjects.map((sub, i) => {
                        const style = COMPLIANCE_STATUS_STYLE[sub.status] ?? 'bg-muted text-muted-foreground';
                        return (
                          <li key={i} className="flex items-center gap-2 text-xs">
                            <span className="text-foreground">{sub.subjectName}</span>
                            <span className={`px-1.5 py-0.5 rounded ${style}`}>
                              {sub.status.replace(/_/g, ' ')}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
            {data.students.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                  {t('reports.noGrade10')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Financial specialized renderer
function FinancialView({ data }: { data: Record<string, unknown> }) {
  const methodBreakdown = data.revenueByPaymentMethod as Record<string, number> | undefined;
  const councilBreakdown = data.revenueByCouncil as Record<string, number> | undefined;
  const flatRows: Record<string, unknown>[] = [
    { metric: 'Confirmed Revenue -- School Subjects (EGP)',     value: data.confirmedRevenueSchoolEGP },
    { metric: 'Confirmed Revenue -- Non-School Subjects (EGP)', value: data.confirmedRevenueNonSchoolEGP },
    { metric: 'Total Confirmed Revenue (EGP)',                  value: data.confirmedRevenueTotalEGP },
    { metric: 'Pending Revenue (EGP)',                          value: data.pendingRevenueEGP },
  ];
  if (methodBreakdown) {
    for (const [method, amount] of Object.entries(methodBreakdown)) {
      flatRows.push({ metric: `By payment method -- ${method} (EGP)`, value: amount });
    }
  }
  if (councilBreakdown) {
    for (const [council, amount] of Object.entries(councilBreakdown)) {
      flatRows.push({ metric: `By council -- ${council} (EGP)`, value: amount });
    }
  }
  return <DataTable rows={flatRows} />;
}

type ComprehensiveReport = {
  summary: Record<string, unknown>;
  sections: Record<string, Record<string, unknown>[]>;
};

function titleize(value: string) {
  return value.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase());
}

function ComprehensiveView({ data }: { data: ComprehensiveReport }) {
  const { t } = useI18n();
  const summaryRows = Object.entries(data.summary ?? {}).map(([metric, value]) => ({ metric: titleize(metric), value }));
  const sections = Object.entries(data.sections ?? {});

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">{t('reports.summary')}</h3>
        <DataTable rows={summaryRows} />
      </div>
      <p className="text-xs text-muted-foreground">{t('reports.comprehensiveDescription')}</p>
      {sections.map(([section, rows]) => (
        <section key={section} className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">{titleize(section)}</h3>
          <DataTable rows={rows} />
        </section>
      ))}
    </div>
  );
}

// --- Main Component ---

export default function ReportsClient() {
  const { t } = useI18n();
  const [activeReport, setActiveReport] = useState<ReportId>('comprehensive');
  const [sessionId, setSessionId]       = useState('');
  const [grade, setGrade]               = useState('');
  const [submitted, setSubmitted]       = useState(false);

  const reportDef = REPORTS.find((r) => r.id === activeReport)! as ReportDefinition;
  const reportLabel = t(reportDef.labelKey as TranslationKey);

  const { data: sessions } = useQuery({
    queryKey: ['sessions', 'admin'],
    queryFn: async () => apiResponse(api.v1.sessions.$get({ query: {} })),
  });

  const sortedSessions = (sessions as { id: string; name: string; sessionType: string; status: string; startDate: string }[] | undefined)
    ?.slice()
    .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());

  const canRun =
    (!reportDef.needsSession || sessionId.length > 0) &&
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
        case 'comprehensive':
          return apiResponse(api.v1.reports.comprehensive.$get({ query: {} }));
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
    if (isLoading) return <div className="py-12 text-center text-muted-foreground text-sm">{t('reports.generating')}</div>;
    if (isError) return <div className="py-12 text-center text-red-500 dark:text-red-400 text-sm">{t('reports.failed')}</div>;
    if (!isFetched || data === null || data === undefined) return null;

    if (activeReport === 'comprehensive') {
      return <ComprehensiveView data={data as ComprehensiveReport} />;
    }
    if (activeReport === 'pending-approvals') {
      return <PendingApprovalsView data={data as { pendingRegistrations: unknown; pendingChangeRequests: unknown }} />;
    }
    if (activeReport === 'financial') {
      return <FinancialView data={data as Record<string, unknown>} />;
    }
    if (activeReport === 'compliance') {
      // The compliance endpoint returns { students: [...], coreSubjects: [] }
      // — we narrow here to the specific ComplianceView shape rather than
      // surface Record<string, unknown> which loses the per-subject fields.
      const d = data as {
        students: ComplianceStudentRow[];
        coreSubjects: string[];
      };
      return <ComplianceView data={d} />;
    }
    // Handle paginated { data, total } response shape
    const rows = extractRows(data);
    return <DataTable rows={rows} />;
  };

  const rowCount = (() => {
    if (!data) return null;
    if (activeReport === 'pending-approvals') {
      const d = data as { pendingRegistrations: unknown; pendingChangeRequests: unknown };
      const regTotal = extractTotal(d.pendingRegistrations) ?? 0;
      const crTotal = extractTotal(d.pendingChangeRequests) ?? 0;
      return regTotal + crTotal;
    }
    const total = extractTotal(data);
    if (total !== null) return total;
    if (Array.isArray(data)) return (data as unknown[]).length;
    return null;
  })();

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto animate-fade-up">

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground font-display tracking-tight">{t('reports.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('reports.description')}
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
                    ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                <span className="flex-1">{t(r.labelKey as TranslationKey)}</span>
                <span className="text-xs text-muted-foreground shrink-0">{r.badge}</span>
              </button>
            ))}
          </nav>
        </aside>

        {/* Main panel */}
        <main className="flex-1 min-w-0 space-y-5">

          {/* Filters card */}
          <div className="bg-card rounded-xl border border-border shadow-sm p-5">
            <h2 className="text-sm font-semibold text-foreground mb-4">
              {reportLabel}
              <span className="ml-2 text-xs font-normal text-muted-foreground">{reportDef.badge}</span>
            </h2>

            <div className="flex flex-wrap gap-4 items-end">
              {reportDef.needsSession && (
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                    {t('reports.session')} <span className="text-destructive">*</span>
                  </label>
                  <select
                    value={sessionId}
                    onChange={(e) => { setSessionId(e.target.value); setSubmitted(false); }}
                    className="w-full rounded-lg border border-border bg-background text-sm px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">{t('reports.selectSession')}</option>
                    {sortedSessions?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.sessionType}) — {s.status}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {reportDef.needsGrade && (
                <div>
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                    {t('reports.grade')}
                  </label>
                  <select
                    value={grade}
                    onChange={(e) => { setGrade(e.target.value); setSubmitted(false); }}
                    className="rounded-lg border border-border bg-background text-sm px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">{t('reports.allGrades')}</option>
                    <option value="10">{t('reports.grade10')}</option>
                    <option value="11">{t('reports.grade11')}</option>
                    <option value="12">{t('reports.grade12')}</option>
                    <option value="graduated">{t('reports.graduated')}</option>
                  </select>
                </div>
              )}

              <div className="flex gap-2 self-end">
                <Button
                  onClick={handleRun}
                  disabled={!canRun || isLoading}
                >
                  {isLoading ? t('common.loading') : t('reports.run')}
                </Button>

                {submitted && isFetched && !isError && (
                  <Button
                    variant="outline"
                    onClick={() => downloadCSV(activeReport, sessionId, grade)}
                  >
                    {t('common.csv')}
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Results card */}
          {submitted && (
            <div className="bg-card rounded-xl border border-border shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-foreground">
                  {t('common.results')}
                  {rowCount !== null && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {rowCount} {rowCount === 1 ? t('common.row') : t('common.rows')}
                    </span>
                  )}
                </h3>
              </div>
              {renderResults()}
            </div>
          )}

        </main>
      </div>
    </div>
  );
}
