'use client';

/**
 * The leave policy (FEATURES_PLAN.md F2, "Policy settings"): the leave keys
 * of F0a's settings store, as cards in plain words, in the order a school
 * thinks about them — when families must ask, who may leave alone, the
 * reasons, the limit, what happens to a request that breaks a rule, who
 * approves, and when the gate raises an alert. The same cards as the School
 * settings screen (one component), each change with a reason and audited.
 *
 * The paper version is a paragraph in the handbook nobody can find, and a
 * rule changed by telling the office.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { Notice } from '~/components/ui/tone';
import { SettingCard, fetchSettings } from '../../settings/settings.client';
import { LeaveNav } from '../leave-nav';

const ORDER = [
  'leave.sameDayCutoff', 'leave.noticeMinutes', 'leave.familyRules', 'leave.autoApprove', 'leave.aloneGrades', 'leave.reasonCategories',
  'leave.limitPerTerm', 'leave.approverRoles', 'leave.noShowGraceMinutes', 'leave.lateReturnGraceMinutes',
];

export default function PolicyClient(): React.JSX.Element {
  const settings = useQuery({ queryKey: ['settings'], queryFn: fetchSettings });
  const [saved, setSaved] = useState<{ label: string; value: string } | null>(null);
  const leave = (settings.data ?? []).filter((s) => s.group === 'leave').sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8 animate-fade-up">
      <LeaveNav academic />
      <header className="mb-5">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Leave policy</h1>
        <p className="mt-1 text-sm text-muted-foreground">The school&apos;s rules for campus leave. Families see the cut-off and the notice before they send a request; the approver sees every rule a request breaks.</p>
      </header>
      {saved && <Notice tone="success" className="mb-4"><span>Saved:</span> <span>{saved.label}</span> → <span>{saved.value}</span></Notice>}
      {settings.isLoading ? <LoadingState /> : settings.isError ? <ErrorState onRetry={() => settings.refetch()} /> : (
        <div className="space-y-3">{leave.map((s) => <SettingCard key={s.key} setting={s} onSaved={setSaved} />)}</div>
      )}
    </div>
  );
}
