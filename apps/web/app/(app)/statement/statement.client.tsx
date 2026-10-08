'use client';

/**
 * The statement page (RESERVATIONS_REWORK.md §4.5). A parent sees the family's statement (every
 * child) and may narrow it to one child; a student sees their own.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, STUDENT_RECORD_ROLES, hasRole } from '@repo/validations';
import { StatementView } from '~/components/reservations/statement';

const fetchChildren = () => apiResponse(api.v1.links.children.$get());

export default function StatementClient({ role, studentId, familyId }: { role: string; studentId: string | null; familyId: string | null }): React.JSX.Element {
  const isParent = role === 'parent';
  const staff = hasRole(role, ...STUDENT_RECORD_ROLES);
  const { data: children = [] } = useQuery({ queryKey: ['links', 'children'], queryFn: fetchChildren, enabled: isParent });
  const [child, setChild] = useState<string>(studentId ?? '');
  const query = staff
    ? (studentId ? { studentId } : { familyId: familyId ?? undefined })
    : isParent ? (child ? { studentId: child } : {}) : {};
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8 animate-fade-up">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Statement</h1>
          <p className="mt-1 text-sm text-muted-foreground">Every line with its price and why, what is paid and what is still owed, and the payments — one per exam board deadline.</p>
        </div>
        {isParent && children.length > 1 && (
          <div>
            <label htmlFor="statement-child" className="mb-1 block text-xs font-medium text-foreground">Show</label>
            <select id="statement-child" className="h-10 rounded-lg border border-input bg-background px-3 text-sm" value={child} onChange={(e) => setChild(e.target.value)}>
              <option value="">Family statement (every child)</option>
              {children.map((c) => <option key={c.student.id} value={c.student.id} data-i18n-skip="true">{c.student.name}</option>)}
            </select>
          </div>
        )}
      </div>
      <StatementView key={JSON.stringify(query)} query={query} teacherChange={staff} money={role !== 'coordinator'} />
    </div>
  );
}
