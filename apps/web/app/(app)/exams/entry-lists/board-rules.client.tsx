'use client';

/**
 * The board's rules the entry check applies (F4, docs/features/EXAM_ENTRIES.md
 * §1 `exam_board_rule`). The paper version: the board's handbook on the
 * coordinator's shelf, and what it says about fees for a late change or a
 * withdrawal remembered — or not — when a parent asks. Here each rule is one
 * plain sentence beside the list it governs, the fee sentences on the
 * Entries screen are worked out from it, and when the handbook says
 * otherwise the coordinator changes the rule here with a reason (audited)
 * instead of anyone changing code.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AMENDMENT_AFTER_DEADLINE, AMENDMENT_FEE_FROM, RESULTS_KEYS, RULE_DATE_LABELS, WITHDRAWAL_REFUND_UNTIL, type UpdateBoardRuleType,
} from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { Badge, Notice } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { SELECT_CLASS } from '../exams-shared';
import { EXAMS_KEY, BoardText, fetchBoardRules, type BoardRuleRow } from '../exam-f4-shared';
import { updateBoardRule } from '../entries/entries-shared';

const RESULTS_KEY_LABEL: Record<string, string> = { candidate_number: 'candidate number', uci: 'UCI' };
const AMEND_LABEL: Record<string, string> = { allowed_with_fee: 'Taken, with a fee', refused: 'Refused: withdraw the entry instead' };

export function BoardRulesPanel({ boardCode }: { boardCode: string }): React.JSX.Element {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: [...EXAMS_KEY, 'board-rules'], queryFn: fetchBoardRules });
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const rule = data?.find((r) => r.boardCode === boardCode);

  return (
    <section className="mb-8 rounded-xl border border-border bg-card p-4 shadow-sm" aria-labelledby="board-rules-title">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="board-rules-title" className="font-display text-lg font-bold text-foreground">
            <span>The board&apos;s rules</span>
            {rule && <> <span className="text-muted-foreground">·</span> <BoardText>{rule.boardName}</BoardText></>}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            What the check above and the fee sentences on the Entries screen follow. Each comes from the research; change one when the board&apos;s handbook says otherwise.
          </p>
        </div>
        {rule && !editing && <Button type="button" variant="outline" onClick={() => { setEditing(true); setSaved(false); }}>Change the rules</Button>}
      </div>
      {isLoading ? (
        <LoadingState label="Loading the board's rules…" />
      ) : isError ? (
        <ErrorState title="The board's rules did not load" onRetry={() => refetch()} />
      ) : !rule ? (
        <p className="text-sm text-muted-foreground">This board is not on the Catalogue.</p>
      ) : editing ? (
        <RulesForm rule={rule} onDone={(ok) => { setEditing(false); setSaved(ok); }} />
      ) : (
        <>
          {saved && <Notice tone="success" className="mb-3">Saved. The check and the fee sentences use the new rules from now on.</Notice>}
          <RulesText rule={rule} />
        </>
      )}
    </section>
  );
}

function RulesText({ rule }: { rule: BoardRuleRow }) {
  const yesNo = (on: boolean, yes: string, no: string) => <span>{on ? yes : no}</span>;
  return (
    <div className="space-y-3 text-sm">
      {!rule.recorded && <Notice tone="warning">No rules are recorded for this board: the check reads lenient defaults until the coordinator records them.</Notice>}
      <ul className="grid gap-x-8 gap-y-2 md:grid-cols-2">
        <Rule>{yesNo(rule.forecastRequired, 'A forecast grade is required on every entry.', 'Forecast grades are not asked for.')}</Rule>
        <Rule>{yesNo(rule.forecastLockedOnSubmit, 'Once sent, a forecast grade is fixed: the board takes no change to it.', 'A forecast grade can still change after it is sent.')}</Rule>
        <Rule>{yesNo(rule.optionCodeRequired, 'Every award entry needs an option code.', 'Option codes are not required.')}</Rule>
        <Rule>{yesNo(rule.uciRequired, 'Every candidate needs a UCI.', 'A UCI is not required.')}</Rule>
        <Rule>{yesNo(rule.candidateNumberFixed, 'A candidate number is fixed once entries are sent.', 'A candidate number can change after entries are sent.')}</Rule>
        <Rule>
          {rule.amendmentAfterDeadline === 'refused'
            ? <span>After the entry deadline, a sent entry cannot be changed: it is withdrawn instead.</span>
            : <span>After the entry deadline, a change to a sent entry is taken, with a fee.</span>}
        </Rule>
        <Rule>
          <span>A change to a sent entry costs a fee from</span>{' '}
          <strong>{RULE_DATE_LABELS[rule.amendmentFeeFrom as keyof typeof RULE_DATE_LABELS] ?? rule.amendmentFeeFrom}</strong>
          {rule.amendmentFeeNote && <p className="mt-0.5 text-xs text-muted-foreground">{rule.amendmentFeeNote}</p>}
        </Rule>
        <Rule>
          {rule.withdrawalRefundUntil === 'never'
            ? <span>A withdrawn entry is never refunded by the board.</span>
            : <><span>A withdrawn entry is refunded by the board up to</span> <strong>{RULE_DATE_LABELS[rule.withdrawalRefundUntil as keyof typeof RULE_DATE_LABELS] ?? rule.withdrawalRefundUntil}</strong></>}
          {rule.withdrawalFeeNote && <p className="mt-0.5 text-xs text-muted-foreground">{rule.withdrawalFeeNote}</p>}
        </Rule>
        <Rule>
          {rule.carryForwardMonths
            ? <><span>Marks carry forward to an entry within</span> <strong className="tabular-nums">{rule.carryForwardMonths}</strong> <span>months</span></>
            : <span>No carry forward.</span>}
        </Rule>
        <Rule>
          <span>The results file names each candidate by</span> <strong>{RESULTS_KEY_LABEL[rule.resultsKey] ?? rule.resultsKey}</strong>
        </Rule>
      </ul>
      {rule.notes && <p className="text-xs text-muted-foreground">{rule.notes}</p>}
    </div>
  );
}

function Rule({ children }: { children: React.ReactNode }) {
  return <li className="flex gap-2 text-foreground"><span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground" /><div>{children}</div></li>;
}

function RulesForm({ rule, onDone }: { rule: BoardRuleRow; onDone: (saved: boolean) => void }) {
  const queryClient = useQueryClient();
  const [v, setV] = useState({
    forecastRequired: rule.forecastRequired,
    forecastLockedOnSubmit: rule.forecastLockedOnSubmit,
    optionCodeRequired: rule.optionCodeRequired,
    uciRequired: rule.uciRequired,
    candidateNumberFixed: rule.candidateNumberFixed,
    amendmentAfterDeadline: rule.amendmentAfterDeadline,
    amendmentFeeFrom: rule.amendmentFeeFrom,
    amendmentFeeNote: rule.amendmentFeeNote ?? '',
    withdrawalRefundUntil: rule.withdrawalRefundUntil,
    withdrawalFeeNote: rule.withdrawalFeeNote ?? '',
    carryForwardMonths: rule.carryForwardMonths ? String(rule.carryForwardMonths) : '',
    resultsKey: rule.resultsKey,
    notes: rule.notes ?? '',
  });
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const patch = (): UpdateBoardRuleType => {
    const p: UpdateBoardRuleType = { reason: reason.trim() };
    for (const k of ['forecastRequired', 'forecastLockedOnSubmit', 'optionCodeRequired', 'uciRequired', 'candidateNumberFixed'] as const) {
      if (v[k] !== rule[k]) p[k] = v[k];
    }
    if (v.amendmentAfterDeadline !== rule.amendmentAfterDeadline) p.amendmentAfterDeadline = v.amendmentAfterDeadline as UpdateBoardRuleType['amendmentAfterDeadline'];
    if (v.amendmentFeeFrom !== rule.amendmentFeeFrom) p.amendmentFeeFrom = v.amendmentFeeFrom as UpdateBoardRuleType['amendmentFeeFrom'];
    if (v.withdrawalRefundUntil !== rule.withdrawalRefundUntil) p.withdrawalRefundUntil = v.withdrawalRefundUntil as UpdateBoardRuleType['withdrawalRefundUntil'];
    if (v.resultsKey !== rule.resultsKey) p.resultsKey = v.resultsKey as UpdateBoardRuleType['resultsKey'];
    for (const k of ['amendmentFeeNote', 'withdrawalFeeNote', 'notes'] as const) {
      const t = v[k].trim() || null;
      if (t !== (rule[k] ?? null)) p[k] = t;
    }
    const months = v.carryForwardMonths ? Number(v.carryForwardMonths) : null;
    if (months !== (rule.carryForwardMonths ?? null)) p.carryForwardMonths = months;
    return p;
  };

  const save = useMutation({
    mutationFn: (json: UpdateBoardRuleType) => updateBoardRule(rule.boardCode, json),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: EXAMS_KEY }); onDone(true); },
    onError: (err: Error) => setError(err.message),
  });

  const check = (k: 'forecastRequired' | 'forecastLockedOnSubmit' | 'optionCodeRequired' | 'uciRequired' | 'candidateNumberFixed', label: string) => (
    <label className="flex items-start gap-2 text-sm text-foreground">
      <input type="checkbox" className="mt-0.5 size-4" checked={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.checked })} />
      <span>{label}</span>
    </label>
  );

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const p = patch();
        if (Object.keys(p).length === 1) return setError('Nothing changed.');
        if (reason.trim().length < 3) return setError('Say why the rules change (for example, the page of the board\'s handbook) — it is recorded.');
        if (v.carryForwardMonths && !/^\d{1,2}$/.test(v.carryForwardMonths)) return setError('The carry-forward period is a number of months, 1 to 60.');
        setError('');
        save.mutate(p);
      }}
    >
      <div className="grid gap-2 md:grid-cols-2">
        {check('forecastRequired', 'A forecast grade is required on every entry')}
        {check('forecastLockedOnSubmit', 'A forecast grade is fixed once sent')}
        {check('optionCodeRequired', 'Every award entry needs an option code')}
        {check('uciRequired', 'Every candidate needs a UCI')}
        {check('candidateNumberFixed', 'A candidate number is fixed once entries are sent')}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label htmlFor="rule-amend" className="mb-1 text-xs text-muted-foreground">A change after the entry deadline</Label>
          <select id="rule-amend" value={v.amendmentAfterDeadline} onChange={(e) => setV({ ...v, amendmentAfterDeadline: e.target.value })} className={SELECT_CLASS}>
            {AMENDMENT_AFTER_DEADLINE.map((x) => <option key={x} value={x}>{AMEND_LABEL[x]}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="rule-amend-from" className="mb-1 text-xs text-muted-foreground">A change costs a fee from</Label>
          <select id="rule-amend-from" value={v.amendmentFeeFrom} onChange={(e) => setV({ ...v, amendmentFeeFrom: e.target.value })} className={SELECT_CLASS}>
            {AMENDMENT_FEE_FROM.map((x) => <option key={x} value={x}>{RULE_DATE_LABELS[x]}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="rule-refund" className="mb-1 text-xs text-muted-foreground">A withdrawal is refunded up to</Label>
          <select id="rule-refund" value={v.withdrawalRefundUntil} onChange={(e) => setV({ ...v, withdrawalRefundUntil: e.target.value })} className={SELECT_CLASS}>
            {WITHDRAWAL_REFUND_UNTIL.map((x) => <option key={x} value={x}>{RULE_DATE_LABELS[x]}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="rule-results" className="mb-1 text-xs text-muted-foreground">The results file names candidates by</Label>
          <select id="rule-results" value={v.resultsKey} onChange={(e) => setV({ ...v, resultsKey: e.target.value })} className={SELECT_CLASS}>
            {RESULTS_KEYS.map((x) => <option key={x} value={x}>{RESULTS_KEY_LABEL[x]}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="rule-cf" className="mb-1 text-xs text-muted-foreground">Carry forward within (months; empty: none)</Label>
          <Input id="rule-cf" inputMode="numeric" maxLength={2} value={v.carryForwardMonths} onChange={(e) => setV({ ...v, carryForwardMonths: e.target.value })} dir="ltr" />
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {([['amendmentFeeNote', 'About the fee for a change'], ['withdrawalFeeNote', 'About the fee for a withdrawal'], ['notes', 'Notes']] as const).map(([k, label]) => (
          <div key={k}>
            <Label htmlFor={`rule-${k}`} className="mb-1 text-xs text-muted-foreground">{label}</Label>
            <textarea
              id={`rule-${k}`}
              rows={3}
              maxLength={k === 'notes' ? 1000 : 500}
              value={v[k]}
              onChange={(e) => setV({ ...v, [k]: e.target.value })}
              className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>
        ))}
      </div>
      <div>
        <Label htmlFor="rule-reason" className="mb-1 text-xs text-muted-foreground">Why the rules change (recorded)</Label>
        <Input id="rule-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Cambridge Handbook 2027, section 3.4" />
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className={cn('flex justify-end gap-2')}>
        <Button type="button" variant="ghost" onClick={() => onDone(false)} disabled={save.isPending}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save the rules'}</Button>
      </div>
      {!rule.recorded && <Badge tone="warning">Saving records the rules for this board for the first time.</Badge>}
    </form>
  );
}
