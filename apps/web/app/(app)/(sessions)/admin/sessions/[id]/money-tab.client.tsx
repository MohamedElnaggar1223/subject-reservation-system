'use client';

/**
 * The Money tab (RESERVATIONS_REWORK.md §4.6), lines only in this step: every line of the session
 * with its family, its price and what it is made of, its due date and the days overdue; filters
 * (unpaid, overdue, provisional, paid, by subject) and an export. Every number is the ledger's:
 * the takings, the receipts and the workbench are unchanged. (Charges join it in step C; the
 * "Remind" batch in step D: remind.client.tsx.)
 */

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Button } from '~/components/ui/button';
import { Badge } from '~/components/ui/tone';
import { ErrorState, LoadingState, EmptyState } from '~/components/ui/query-state';
import { downloadCsv, toCsv } from '~/lib/csv';
import { SessionCharges } from './session-charges.client';
import { Remind } from './remind.client';
import {
  fetchMoney, moneyKey, Money, Day, INPUT_CLASS, LINE_STATUS_LABEL, LINE_STATUS_TONE, type SessionDetail,
} from '../sessions-shared';

const FILTERS = ['all', 'unpaid', 'overdue', 'provisional', 'paid'] as const;
type Filter = (typeof FILTERS)[number];
const FILTER_LABEL: Record<Filter, string> = { all: 'All', unpaid: 'Unpaid', overdue: 'Overdue', provisional: 'Provisional', paid: 'Paid' };

export default function MoneyTab({ session }: { session: SessionDetail }): React.JSX.Element {
  const [filter, setFilter] = useState<Filter>('all');
  const [offerId, setOfferId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [...moneyKey(session.id), filter, offerId, sectionId],
    queryFn: () => fetchMoney(session.id, { filter, ...(offerId ? { offerId } : {}), ...(sectionId ? { sectionId } : {}) }),
  });
  // The subject filter: the subjects this session's lines are of (finance reads no offer list); the sections come with the answer.
  const { data: all } = useQuery({ queryKey: [...moneyKey(session.id), 'all', '', ''], queryFn: () => fetchMoney(session.id, { filter: 'all' }) });
  const subjects = [...new Map((all?.lines ?? []).map((l) => [l.item.offerId, l.subject.name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;
  const t = data.totals;
  const exportCsv = () => downloadCsv(`${session.name} — money.csv`, toCsv(
    ['Student', 'Number', 'Section', 'Subject', 'Item', 'Series', 'Attempt', 'Mode', 'Course', 'Board', 'Price', 'Provisional', 'Status', 'Due', 'Days overdue'],
    data.lines.map((l) => [l.student.name, l.student.number ?? '', l.student.section ?? '', l.subject.name, l.item.label, l.series ?? '', l.attempt, l.mode,
      l.courseFee, l.boardFee, l.price, l.provisional ? 'yes' : '', l.status, new Date(l.dueAt).toISOString().slice(0, 10), l.overdueDays]),
  ));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Lines" value={<span>{t.lines}</span>} />
        <Stat label="Paid" value={<><span>{t.paid}</span> · <Money amount={t.paidAmount} /></>} />
        <Stat label="Unpaid" value={<><span>{t.unpaid}</span> · <Money amount={t.outstanding} /></>}
          hint={<><span>{t.families}</span> <span>families</span>{t.awaitingApproval > 0 && <> · <span>{t.awaitingApproval}</span> <span>awaiting the parent</span></>}{t.depositsHeld > 0 && <> · <span>held from instalments</span> <Money amount={t.depositsHeld} /></>}</>} />
        <Stat label="Overdue" value={<><span>{t.overdue}</span> · <Money amount={t.overdueAmount} /></>} hint={t.provisional ? <><span>{t.provisional}</span> <span>provisional (not payable yet)</span></> : undefined} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border bg-card p-0.5 text-sm" role="group" aria-label="Show">
            {FILTERS.map((f) => (
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
                className={`rounded-md px-3 py-1.5 ${filter === f ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{FILTER_LABEL[f]}</button>
            ))}
          </div>
          {(all?.sections.length ?? 0) > 1 && (
            <select aria-label="Section" className={INPUT_CLASS.replace('w-full', 'w-48')} value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
              <option value="">Every section</option>
              {all!.sections.map((x) => <option key={x.id} value={x.id} data-i18n-skip="true">{x.name}</option>)}
            </select>
          )}
          {subjects.length > 1 && (
            <select aria-label="Subject" className={INPUT_CLASS.replace('w-full', 'w-64')} value={offerId} onChange={(e) => setOfferId(e.target.value)}>
              <option value="">Every subject</option>
              {subjects.map(([id, name]) => <option key={id} value={id} data-i18n-skip="true">{name}</option>)}
            </select>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* "Remind" sends the payment reminder to these families now (a batch audience): step D's
              messages and reminders (RESERVATIONS_REWORK.md §3.8, remind.client.tsx). */}
          <Remind sessionId={session.id} filter={filter} offerId={offerId} sectionId={sectionId} />
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!data.lines.length}>Export</Button>
        </div>
      </div>
      {data.lines.length === 0 ? <EmptyState title="No lines here" /> : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-start font-medium">Student</th>
                <th className="px-4 py-2 text-start font-medium">Subject</th>
                <th className="px-4 py-2 text-start font-medium">Series</th>
                <th className="px-4 py-2 text-end font-medium">Price</th>
                <th className="px-4 py-2 text-start font-medium">Due</th>
                <th className="px-4 py-2 text-start font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l) => (
                <tr key={l.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 align-top">
                    <div className="font-medium text-foreground"><Link href={`/statement?studentId=${l.student.id}`} className="hover:underline"><bdi data-i18n-skip="true">{l.student.name}</bdi></Link></div>
                    <div className="text-xs text-muted-foreground"><bdi data-i18n-skip="true">{l.student.number ?? ''}</bdi>{l.student.section && <> · <bdi data-i18n-skip="true">{l.student.section}</bdi></>}</div>
                  </td>
                  <td className="px-4 py-2 align-top">
                    <bdi data-i18n-skip="true">{l.subject.name}</bdi>{l.item.kind !== 'whole' && <> — <bdi>{l.item.label}</bdi></>}
                    <div className="text-xs text-muted-foreground">
                      <span>{l.attempt === 'retake' ? 'Retake' : 'First entry'}</span> · <span>{l.mode === 'self_study' ? 'Self-study' : 'In school'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2 align-top text-xs text-muted-foreground"><bdi data-i18n-skip="true">{l.series ?? '—'}</bdi></td>
                  <td className="px-4 py-2 text-end align-top">
                    <Money amount={l.price} />
                    <div className="text-xs text-muted-foreground" title="course + board"><Money amount={l.courseFee} /> + <Money amount={l.boardFee} /></div>
                    {l.provisional && <Badge tone="info">provisional</Badge>}
                    {l.deposits > 0 && <div className="text-xs text-muted-foreground"><span>held from instalments</span> <Money amount={l.deposits} /> · <span>owes</span> <Money amount={l.outstanding} /></div>}
                  </td>
                  <td className="px-4 py-2 align-top">
                    <Day iso={l.dueAt} />
                    {l.overdueDays > 0 && <div><Badge tone="danger"><span>{l.overdueDays}</span>&nbsp;<span>{l.overdueDays === 1 ? 'day overdue' : 'days overdue'}</span></Badge></div>}
                  </td>
                  <td className="px-4 py-2 align-top"><Badge tone={LINE_STATUS_TONE[l.status] ?? 'neutral'}>{LINE_STATUS_LABEL[l.status] ?? l.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* Step C (RESERVATIONS_MONEY.md §8): the session's charges beside its lines. */}
      <SessionCharges sessionId={session.id} />
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
