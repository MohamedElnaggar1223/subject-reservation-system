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
 *
 * All routes support an optional `?format=csv` query parameter to download as CSV.
 * Default format is JSON.
 *
 * All routes are admin-only.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
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
} from '../services/report.services';

// ─── CSV Helper ───────────────────────────────────────────────────────────────

/**
 * Convert an array of flat objects to a CSV string.
 * Values are quoted and internal quotes are escaped.
 */
function toCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const str = v === null || v === undefined ? '' : String(v);
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

/**
 * Return data as JSON (default) or CSV based on the `format` query param.
 */
function respond(
  c: Parameters<Parameters<ReturnType<typeof new Hono().get>>[1]>[0],
  filename: string,
  data: Record<string, unknown> | Record<string, unknown>[],
  format?: string
) {
  if (format === 'csv') {
    const rows = Array.isArray(data) ? data : [data];
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

// ─── Query Schemas ────────────────────────────────────────────────────────────

const SessionQuery = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  format:    z.enum(['json', 'csv']).optional(),
});

const RegistrationReportQuery = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  grade:     z.string().optional().transform((v) => (v ? parseInt(v, 10) : undefined)),
  status:    z.string().optional(),
  format:    z.enum(['json', 'csv']).optional(),
});

const RosterQuery = z.object({
  grade:  z.string().optional().transform((v) => {
    if (v === 'graduated') return null;
    return v ? parseInt(v, 10) : undefined;
  }),
  format: z.enum(['json', 'csv']).optional(),
});

const FormatQuery = z.object({
  format: z.enum(['json', 'csv']).optional(),
});

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
   * GET /reports/registrations?sessionId=...&grade=...&status=...
   *
   * Per-session registration report with approval trail (REP-001).
   */
  .get('/registrations',
    zValidator('query', RegistrationReportQuery),
    async (c) => {
      const { sessionId, grade, status, format } = c.req.valid('query');

      const rows = await generateRegistrationReport(sessionId, { grade, status });
      return respond(c, `registrations-${sessionId}`, rows, format);
    }
  )

  /**
   * GET /reports/financial?sessionId=...
   *
   * Financial summary for a session (REP-002).
   */
  .get('/financial',
    zValidator('query', SessionQuery),
    async (c) => {
      const { sessionId, format } = c.req.valid('query');
      const summary = await generateFinancialSummary(sessionId);
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
      const { format } = c.req.valid('query');
      const rows = await generateEscrowReport();
      return respond(c, 'escrow-report', rows, format);
    }
  )

  /**
   * GET /reports/enrollment?sessionId=...
   *
   * Subject enrollment counts for a session (REP-004).
   */
  .get('/enrollment',
    zValidator('query', SessionQuery),
    async (c) => {
      const { sessionId, format } = c.req.valid('query');
      const rows = await generateSubjectEnrollmentReport(sessionId);
      return respond(c, `enrollment-${sessionId}`, rows, format);
    }
  )

  /**
   * GET /reports/compliance?sessionId=...
   *
   * Grade 10 core subject compliance report (REP-005).
   * JSON: full structure. CSV: flattened per student + subject.
   */
  .get('/compliance',
    zValidator('query', SessionQuery),
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
    zValidator('query', RosterQuery),
    async (c) => {
      const { grade, format } = c.req.valid('query');
      const rows = await generateStudentRoster(grade);
      const filename = grade === null ? 'roster-graduated' : grade !== undefined ? `roster-grade${grade}` : 'roster-all';
      return respond(c, filename, rows, format);
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
      const { format } = c.req.valid('query');
      const result = await generatePendingApprovalsReport();

      if (format === 'csv') {
        // Combine both lists into one flat CSV
        const regs = result.pendingRegistrations.map((r) => ({ type: 'Registration', ...r }));
        const crs  = result.pendingChangeRequests.map((cr) => ({ type: cr.type === 'drop' ? 'Drop Request' : 'Swap Request', ...cr }));
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
