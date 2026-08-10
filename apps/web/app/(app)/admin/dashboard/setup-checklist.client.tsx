'use client';

/**
 * Setup Checklist Card (UX_AUDIT G9)
 *
 * Tells the admin what's still unconfigured BEFORE a parent hits the
 * error. Renders nothing when everything is in order.
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, COUNCIL_LABELS } from '@repo/validations';

type Checklist = {
  academicYear: string;
  hasOpenOrUpcomingSession: boolean;
  activeSessionCount: number;
  draftOnly: boolean;
  subjectCount: number;
  zeroFeeSubjects: number;
  subjectsWithoutTeachers: number;
  schoolFeeConfigured: boolean;
  refundWindowsConfigured: boolean;
  councilsMissingRemarkFees: string[];
};

export default function SetupChecklist(): React.JSX.Element | null {
  const { data } = useQuery<Checklist>({
    queryKey: ['reports', 'setup-checklist'],
    queryFn: async () =>
      (await apiResponse(api.v1.reports['setup-checklist'].$get())) as Checklist,
  });

  if (!data) return null;

  const warnings: { text: string; href: string }[] = [];
  if (!data.hasOpenOrUpcomingSession) {
    warnings.push({ text: 'No open or upcoming registration session', href: '/admin/sessions' });
  }
  if (data.draftOnly) {
    warnings.push({
      text: 'Your session is still a draft — activate it or nobody can register',
      href: '/admin/sessions',
    });
  }
  if (data.subjectCount === 0) {
    warnings.push({ text: 'No subjects created yet', href: '/admin/subjects' });
  }
  if (data.zeroFeeSubjects > 0) {
    warnings.push({
      text: `${data.zeroFeeSubjects} subject(s) have zero fees — parents would register for free`,
      href: '/admin/subjects',
    });
  }
  if (data.subjectsWithoutTeachers > 0) {
    warnings.push({
      text: `${data.subjectsWithoutTeachers} subject(s) have no teachers linked`,
      href: '/admin/subjects',
    });
  }
  if (!data.schoolFeeConfigured) {
    warnings.push({
      text: `No ${data.academicYear} school-fee schedule — the registration gate is off`,
      href: '/admin/school-fees',
    });
  }
  if (!data.refundWindowsConfigured) {
    warnings.push({
      text: 'No refund windows — drops refund 100% until configured',
      href: '/admin/school-fees',
    });
  }
  if (data.councilsMissingRemarkFees.length > 0) {
    warnings.push({
      text: `Remark fees missing for: ${data.councilsMissingRemarkFees
        .map((c) => COUNCIL_LABELS[c as keyof typeof COUNCIL_LABELS] ?? c)
        .join(', ')} — parents get an error if they request one`,
      href: '/remarks-desk',
    });
  }

  if (warnings.length === 0) return null;

  return (
    <div className="mb-6 rounded-xl border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-5">
      <h2 className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-2">
        Setup needed — parents will hit these before you do
      </h2>
      <ul className="space-y-1.5">
        {warnings.map((w) => (
          <li key={w.text} className="text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2">
            <span aria-hidden>⚠</span>
            <a href={w.href} className="underline hover:no-underline">{w.text}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
