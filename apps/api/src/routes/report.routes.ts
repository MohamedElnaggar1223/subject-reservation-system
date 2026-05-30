/**
 * Report & Dashboard API Routes
 *
 * Admin-only routes for all report types (REP-001 to REP-009)
 * and the admin dashboard metrics (REP-008).
 *
 * GET /reports/dashboard                  - Dashboard metrics (REP-008)
 * GET /reports/registrations              - Registration report per session (REP-001)
 * GET /reports/financial                  - Financial summary per session (REP-002)
 * GET /reports/escrow                     - Escrow balances + liabilities (REP-003)
 * GET /reports/enrollment                 - Subject enrollment counts (REP-004)
 * GET /reports/compliance                 - Grade 10 core subject compliance (REP-005)
 * GET /reports/roster                     - Student roster by grade (REP-007)
 * GET /reports/pending-approvals          - All pending approval items with age (REP-009)
 * GET /reports/comprehensive              - Broad staff analytics across all major entities
 *
 * All routes support an optional `?format=csv` query parameter to download as CSV.
 * Default format is JSON.
 *
 * All routes are admin-only.
 */

import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  SessionReportQuery,
  RegistrationReportQuery,
  RosterReportQuery,
  FormatQuery,
} from '@repo/validations';
import { success, error } from '../lib/response';
import { requireAuth, requireAdmin } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import {
  getAdminDashboardMetrics,
  generateRegistrationReport,
  generateFinancialSummary,
  generateEscrowReport,
  generateSubjectEnrollmentReport,
  generateGrade10ComplianceReport,
  generateStudentRoster,
  generatePendingApprovalsReport,
  generateComprehensiveStaffReport,
} from '../services/report.services';

// ─── CSV Helper ───────────────────────────────────────────────────────────────

/**
 * Convert an array of flat objects to a CSV string.
 * Values are quoted and internal quotes are escaped.
 */
function toCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]!);
  const escape = (v: unknown) => {
    let str = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const lines = [
    headers.map(escape).join(','),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(',')),
  ];
  return lines.join('\r\n');
}

function flattenComprehensiveReport(report: {
  summary?: Record<string, unknown>;
  sections?: Record<string, Record<string, unknown>[]>;
}) {
  const rows: Record<string, unknown>[] = [];

  if (report.summary) {
    for (const [metric, value] of Object.entries(report.summary)) {
      rows.push({ section: 'summary', metric, value });
    }
  }

  for (const [section, sectionRows] of Object.entries(report.sections ?? {})) {
    if (!Array.isArray(sectionRows) || sectionRows.length === 0) {
      rows.push({ section, metric: 'noData', value: '' });
      continue;
    }

    for (const row of sectionRows) {
      rows.push({ section, ...row });
    }
  }

  return rows;
}

/**
 * Return data as JSON (default) or CSV based on the `format` query param.
 * Supports both plain arrays/objects and paginated { data, total } shapes.
 */
function respond(
  c: Context,
  filename: string,
  data: Record<string, unknown> | Record<string, unknown>[] | { data: Record<string, unknown>[]; total: number },
  format?: string
) {
  // Extract rows from paginated shape if needed
  const isPaginated = data && !Array.isArray(data) && 'data' in data && 'total' in data && Array.isArray((data as { data: unknown }).data);

  if (format === 'csv') {
    let rows: Record<string, unknown>[];
    if (isPaginated) {
      rows = (data as { data: Record<string, unknown>[] }).data;
    } else {
      rows = Array.isArray(data) ? data : [data as Record<string, unknown>];
    }
    const csv = toCSV(rows);
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}.csv"`,
      },
    });
  }
  return success(c, data);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export const reports = new Hono<HonoEnv>()
  .use('*', requireAuth())
  .use('*', requireAdmin())

  /**
   * GET /reports/dashboard
   *
   * Returns the key admin dashboard metrics (REP-008).
   * Includes pending approval count, student counts by grade, escrow liability, etc.
   */
  .get('/dashboard',
    zValidator('query', FormatQuery),
    async (c) => {
      const { format } = c.req.valid('query');
      const metrics = await getAdminDashboardMetrics();
      return respond(c, 'dashboard-metrics', metrics as Record<string, unknown>, format);
    }
  )

  /**
   * GET /reports/comprehensive
   *
   * Broad, multi-section staff analytics report across users, sessions,
   * registrations, subjects, payments, escrow, withdrawals, notifications,
   * parent coverage, approval aging, and audit activity.
   */
  .get('/comprehensive',
    zValidator('query', FormatQuery),
    async (c) => {
      const { format } = c.req.valid('query');
      const result = await generateComprehensiveStaffReport();

      if (format === 'csv') {
        const csv = toCSV(flattenComprehensiveReport(result));
        return new Response(csv, {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="comprehensive-staff-report.csv"',
          },
        });
      }

      return success(c, result);
    }
  )

  /**
   * GET /reports/registrations?sessionId=...&grade=...&status=...
   *
   * Per-session registration report with approval trail (REP-001).
   */
  .get('/registrations',
    zValidator('query', RegistrationReportQuery),
    async (c) => {
      const { sessionId, grade, status, council, format, limit, offset } = c.req.valid('query');

      const result = await generateRegistrationReport(sessionId, { grade, status, council }, { limit, offset });
      return respond(c, `registrations-${sessionId}`, result, format);
    }
  )

  /**
   * GET /reports/financial?sessionId=...
   *
   * Financial summary for a session (REP-002).
   */
  .get('/financial',
    zValidator('query', SessionReportQuery),
    async (c) => {
      const { sessionId, council, format } = c.req.valid('query');
      const summary = await generateFinancialSummary(sessionId, { council });
      return respond(c, `financial-${sessionId}`, summary as Record<string, unknown>, format);
    }
  )

  /**
   * GET /reports/escrow
   *
   * All escrow accounts with balances, pending withdrawals, and linked parents (REP-003).
   */
  .get('/escrow',
    zValidator('query', FormatQuery),
    async (c) => {
      const { format, limit, offset } = c.req.valid('query');
      const result = await generateEscrowReport({ limit, offset });
      return respond(c, 'escrow-report', result, format);
    }
  )

  /**
   * GET /reports/enrollment?sessionId=...
   *
   * Subject enrollment counts for a session (REP-004).
   */
  .get('/enrollment',
    zValidator('query', SessionReportQuery),
    async (c) => {
      const { sessionId, format, limit, offset } = c.req.valid('query');
      const result = await generateSubjectEnrollmentReport(sessionId, { limit, offset });
      return respond(c, `enrollment-${sessionId}`, result, format);
    }
  )

  /**
   * GET /reports/compliance?sessionId=...
   *
   * Grade 10 core subject compliance report (REP-005).
   * JSON: full structure. CSV: flattened per student + subject.
   */
  .get('/compliance',
    zValidator('query', SessionReportQuery),
    async (c) => {
      const { sessionId, format } = c.req.valid('query');
      const result = await generateGrade10ComplianceReport(sessionId);

      if (format === 'csv') {
        // Flatten: one row per student-subject combination
        const rows = result.students.flatMap((stu) =>
          stu.subjects.map((subj) => ({
            studentName:   stu.studentName,
            studentIdCode: stu.studentIdCode,
            studentEmail:  stu.studentEmail,
            isCompliant:   stu.isCompliant ? 'Yes' : 'No',
            subjectName:   subj.subjectName,
            status:        subj.status,
          }))
        );
        const csv = toCSV(rows);
        return new Response(csv, {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="compliance-${sessionId}.csv"`,
          },
        });
      }

      return success(c, result);
    }
  )

  /**
   * GET /reports/roster?grade=10|11|12|graduated
   *
   * Student roster with contact info and linked parents (REP-007).
   */
  .get('/roster',
    zValidator('query', RosterReportQuery),
    async (c) => {
      const { grade, format, limit, offset } = c.req.valid('query');
      const result = await generateStudentRoster(grade, { limit, offset });
      const filename = grade === null ? 'roster-graduated' : grade !== undefined ? `roster-grade${grade}` : 'roster-all';
      return respond(c, filename, result, format);
    }
  )

  /**
   * GET /reports/pending-approvals
   *
   * All pending approval items (registration requests + change requests) with age (REP-009).
   */
  .get('/pending-approvals',
    zValidator('query', FormatQuery),
    async (c) => {
      const { format, limit, offset } = c.req.valid('query');
      const result = await generatePendingApprovalsReport({ limit, offset });

      if (format === 'csv') {
        // Combine both lists into one flat CSV
        const regs = result.pendingRegistrations.data.map((r) => ({ itemType: 'Registration', ...r }));
        const crs  = result.pendingChangeRequests.data.map((cr) => ({ itemType: (cr as Record<string, unknown>).type === 'drop' ? 'Drop Request' : 'Swap Request', ...cr }));
        const csv  = toCSV([...regs, ...crs] as Record<string, unknown>[]);
        return new Response(csv, {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="pending-approvals.csv"',
          },
        });
      }

      return success(c, result);
    }
  );

export type ReportsApi = typeof reports;
