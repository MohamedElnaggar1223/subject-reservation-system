'use client';

/**
 * What families agree to (COORDINATOR_REWORK.md C7, C8, C10, D11, D13, E4; §5.3): the refund policy as
 * rows of weeks and percentages with the sentence families read made from them, the declaration (one
 * school-wide text, read here), the self-study share, the grades that may reserve, the days after the
 * payment date an unpaid reservation is cancelled, and the extra questions.
 *
 * The spreadsheet version: the policy typed into the refund box of every form (one form had none, two
 * read "50&"), the share in her head. Here the words are made from the rows, so the words and the money
 * cannot disagree, and the share is one setting every subject shows. A share change that re-prices
 * unpaid reservations says so before it is saved (E7).
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '~/lib/hono';
import {
  apiResponse, refundPolicySentence, DECLARATION_TEXT, ALLOWED_GRADES, QUESTION_KINDS, QuestionKindSchema, RefundPolicyStepSchema, AllowedGradeSchema,
  type RefundPolicy, type AllowedGrade, type UpdateSessionType, type QuestionInputType, type ImpactType,
} from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge } from '~/components/ui/tone';
import { Switch } from '~/components/ui/switch';
import { cn } from '~/lib/utils';
import { ErrorLine, INPUT_CLASS, TEXTAREA_CLASS } from '../sessions-shared';
import { subjectTitle, useImpactSave, ImpactDialog, CommitSelect, QUESTION_KIND_WORDS, CARD as card, type SetupSession } from '../setup-shared';

const PERCENTS = [100, 75, 50, 25, 0];
const GRADE_WORDS: Record<AllowedGrade, string> = { '10': 'Grade 10', '11': 'Grade 11', '12': 'Grade 12', graduates: 'Graduates retaking' };
type QuestionKind = QuestionInputType['kind'];

/** The fields of PUT /sessions/:id this tab sends (the API's input type); the questions go through their own card. */
type SessionPut = Pick<UpdateSessionType, 'selfStudyPercent' | 'allowedGrades' | 'unpaidCancelDays' | 'refundPolicy'>;

export default function AgreeTab({ s }: { s: SetupSession }) {
  const queryClient = useQueryClient();
  const save = useImpactSave(
    (json: SessionPut, expected) => apiResponse(api.v1.sessions[':id'].$put({ param: { id: s.id }, json: { ...json, ...(expected ? { expected } : {}) } })),
    () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  );
  const closed = s.status === 'closed';
  // A select's pick stays on screen while it saves or asks; cancelled or refused, the select shows the saved value.
  const holding = save.isPending || !!save.asking;
  return (
    <div className="space-y-5">
      <RefundPolicyCard s={s} onSave={(refundPolicy) => save.save({ refundPolicy })} pending={save.isPending} />
      <section className={card} aria-labelledby="decl-title">
        <h2 id="decl-title" className="font-display text-base font-semibold text-foreground">Declaration</h2>
        <p className="mt-2 text-sm text-foreground">“<span>{DECLARATION_TEXT}</span>”</p>
        <p className="mt-1 text-xs text-muted-foreground">One text for the whole school, set by the admin; each family&apos;s agreement keeps a copy of it.</p>
      </section>
      <section className={card} aria-label="Self study, grades and unpaid reservations">
        <div className="grid gap-5 sm:grid-cols-3">
          <div>
            <label htmlFor="ag-share" className="block text-sm font-medium text-foreground">Self study pays</label>
            <CommitSelect id="ag-share" className={cn(INPUT_CLASS, 'mt-1')} value={String(s.selfStudyPercent)} disabled={closed || save.isPending} pending={holding}
              onCommit={(v) => save.save({ selfStudyPercent: Number(v) })}>
              {Array.from({ length: 21 }, (_, i) => i * 5).map((p) => <option key={p} value={p}>{`${p}% of the course fee`}</option>)}
            </CommitSelect>
            <p className="mt-1 text-xs text-muted-foreground">and the whole exam fee. Shown on every subject; a row may have its own amount.</p>
          </div>
          <fieldset>
            <legend className="text-sm font-medium text-foreground">Grades that may reserve</legend>
            <div className="mt-1 space-y-2">
              {ALLOWED_GRADES.map((g) => {
                const on = s.allowedGrades.includes(g);
                return (
                  <div key={g} className="flex max-w-60 items-center justify-between gap-3">
                    <span className="text-sm text-foreground">{GRADE_WORDS[g]}</span>
                    <Switch checked={on} label={GRADE_WORDS[g]} disabled={closed || save.isPending || (on && s.allowedGrades.length === 1)}
                      onChange={(next) => save.save({ allowedGrades: AllowedGradeSchema.array().parse(next ? [...s.allowedGrades, g] : s.allowedGrades.filter((x) => x !== g)) })} />
                  </div>
                );
              })}
            </div>
          </fieldset>
          <div>
            <label htmlFor="ag-cancel" className="block text-sm font-medium text-foreground">Last day to pay</label>
            <CommitSelect id="ag-cancel" className={cn(INPUT_CLASS, 'mt-1')} value={String(s.unpaidCancelDays)} disabled={closed || save.isPending} pending={holding}
              onCommit={(v) => save.save({ unpaidCancelDays: Number(v) })}>
              {Array.from({ length: 15 }, (_, d) => d).map((d) => <option key={d} value={d}>{d === 0 ? 'the pay-by date itself' : `${d} ${d === 1 ? 'day' : 'days'} after the pay-by date`}</option>)}
            </CommitSelect>
            <p className="mt-1 text-xs text-muted-foreground">Unpaid reservations are cancelled after it, or at the board&apos;s deadline if that is earlier. Reminders go before.</p>
          </div>
        </div>
        <ErrorLine message={save.error} />
      </section>
      <QuestionsCard s={s} />
      <ImpactDialog save={save} />
    </div>
  );
}

/** C7: "until week N → P%" rows; the sentence families read made from them; fixed once a family agrees. */
function RefundPolicyCard({ s, onSave, pending }: { s: SetupSession; onSave: (p: RefundPolicy) => void; pending: boolean }) {
  // The stored policy as it is: its rows read by their own schema (a policy that breaks a rule between rows, which
  // no save lets through, is still shown as stored, not replaced); none stored, one row of 0%.
  const stored = z.object({ steps: z.array(RefundPolicyStepSchema).min(1) }).safeParse(s.refundPolicy);
  const saved: RefundPolicy = stored.success ? stored.data : { steps: [{ throughWeek: null, percent: 0 }] };
  const [steps, setSteps] = useState(saved.steps);
  const locked = s.refundPolicyLocked || s.status === 'closed';
  const changed = JSON.stringify(steps) !== JSON.stringify(saved.steps);
  const set = (i: number, patch: Partial<RefundPolicy['steps'][number]>) => setSteps(steps.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const fromWeek = (i: number) => (i === 0 ? 1 : (steps[i - 1]!.throughWeek ?? 0) + 1);
  const add = () => {
    const last = steps.length > 1 ? steps[steps.length - 2]!.throughWeek ?? 0 : 0;
    setSteps([...steps.slice(0, -1), { throughWeek: last + 1, percent: 50 }, steps[steps.length - 1]!]);
  };
  return (
    <section className={card} aria-labelledby="refund-title">
      <h2 id="refund-title" className="font-display text-base font-semibold text-foreground">Refund policy</h2>
      <p className="mt-1 text-sm text-muted-foreground">Of the course fee, counted from the first lesson. Families read the sentence below, made from these rows, so the words and the money cannot disagree.</p>
      {s.refundPolicyLocked && <p className="mt-2"><Badge tone="info">Fixed: a family has agreed to it</Badge></p>}
      <div className="mt-3 space-y-2">
        {steps.map((st, i) => {
          const last = i === steps.length - 1;
          const from = fromWeek(i);
          return (
            <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
              {last ? <span className="w-36"><span>From week</span> <span>{from}</span></span> : (
                <>
                  <span className="w-16">{i === 0 ? 'Up to' : 'Then to'}</span>
                  <select aria-label={`Step ${i + 1}: up to week`} className={cn(INPUT_CLASS, 'h-9 w-28')} disabled={locked} value={st.throughWeek ?? from}
                    onChange={(e) => set(i, { throughWeek: Number(e.target.value) })}>
                    {Array.from({ length: 21 - from }, (_, k) => from + k).map((w) => <option key={w} value={w}>{`week ${w}`}</option>)}
                  </select>
                </>
              )}
              <select aria-label={last ? `From week ${from}: refund` : `Step ${i + 1}: refund`} className={cn(INPUT_CLASS, 'h-9 w-24')} disabled={locked} value={st.percent}
                onChange={(e) => set(i, { percent: Number(e.target.value) })}>
                {PERCENTS.map((p) => <option key={p} value={p}>{`${p}%`}</option>)}
              </select>
              <span className="text-muted-foreground">of the course fee back</span>
              {!locked && !last && steps.length > 2 && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setSteps(steps.filter((_, j) => j !== i))} aria-label={`Remove step ${i + 1}`}>Remove</Button>
              )}
            </div>
          );
        })}
      </div>
      {!locked && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={add}>Add a step</Button>
          {changed && <Button type="button" size="sm" disabled={pending} onClick={() => onSave({ steps })}>Save the policy</Button>}
          {changed && <Button type="button" variant="ghost" size="sm" onClick={() => setSteps(saved.steps)}>Undo</Button>}
        </div>
      )}
      <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3 text-sm">
        <span className="font-medium">Families read:</span> <span>{refundPolicySentence({ steps })}</span>
      </div>
    </section>
  );
}

/**
 * D13: optional questions with every reservation or with one subject; never a price, never who may reserve.
 * Adding or removing one is a save like any other (A3): when the API answers what it would do to families
 * first (`saved: false`), she reads it and saves it or not; the question she typed stays in its fields until
 * it is saved.
 */
function QuestionsCard({ s }: { s: SetupSession }) {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState('session');
  const [kind, setKind] = useState<QuestionKind>('yes_no');
  const [prompt, setPrompt] = useState('');
  const [choices, setChoices] = useState('');
  const save = useImpactSave(
    async ({ offeringId, questions }: { offeringId: string | null; questions: QuestionInputType[]; added: boolean }, expected?: ImpactType) => (offeringId
      ? await apiResponse(api.v1.sessions[':id'].offerings[':offeringId'].$put({ param: { id: s.id, offeringId }, json: { questions, ...(expected ? { expected } : {}) } }))
      : await apiResponse(api.v1.sessions[':id'].$put({ param: { id: s.id }, json: { questions, ...(expected ? { expected } : {}) } }))),
    async (_res, v) => {
      if (v.added) { setPrompt(''); setChoices(''); }
      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  );
  const asOf = (q: { id: string; kind: string; prompt: string; choices: string[]; required: boolean }): QuestionInputType =>
    ({ id: q.id, kind: QuestionKindSchema.parse(q.kind), prompt: q.prompt, choices: q.choices, required: q.required });
  const all = [
    ...s.questions.map((q) => ({ q, where: null as null | (typeof s.offerings)[number] })),
    ...s.offerings.flatMap((o) => o.questions.map((q) => ({ q, where: o }))),
  ];
  const list = choices.split('\n').map((c) => c.trim()).filter(Boolean);
  const ready = prompt.trim().length >= 2 && (kind !== 'choice' || list.length > 0);
  const add = () => {
    const q = { kind, prompt: prompt.trim(), choices: kind === 'choice' ? list : [], required: false };
    if (scope === 'session') save.save({ offeringId: null, questions: [...s.questions.map(asOf), q], added: true });
    else {
      const o = s.offerings.find((x) => x.id === scope)!;
      save.save({ offeringId: o.id, questions: [...o.questions.map(asOf), q], added: true });
    }
  };
  const remove = (id: string, where: (typeof s.offerings)[number] | null) => {
    if (!where) save.save({ offeringId: null, questions: s.questions.filter((q) => q.id !== id).map(asOf), added: false });
    else save.save({ offeringId: where.id, questions: where.questions.filter((q) => q.id !== id).map(asOf), added: false });
  };
  const busy = save.isPending || !!save.asking;
  const closed = s.status === 'closed';
  return (
    <section className={card} aria-labelledby="questions-title">
      <h2 id="questions-title" className="font-display text-base font-semibold text-foreground">Extra questions</h2>
      <p className="mt-1 text-sm text-muted-foreground">Optional. The answers go into the reservations export; they never change a price or who may reserve.</p>
      {all.length ? (
        <ul className="mt-3 divide-y divide-border">
          {all.map(({ q, where }) => (
            <li key={q.id} className="flex items-start justify-between gap-3 py-2">
              <div className="text-sm">
                <p className="text-foreground"><bdi data-i18n-skip="true">{q.prompt}</bdi></p>
                <p className="text-xs text-muted-foreground">
                  <span>{QUESTION_KIND_WORDS[QuestionKindSchema.parse(q.kind)]}</span>{q.choices.length > 0 && <>: <bdi data-i18n-skip="true">{q.choices.join(' / ')}</bdi></>} · {where ? <><span>asked with</span> <bdi data-i18n-skip="true">{subjectTitle(where)}</bdi></> : <span>asked with every reservation</span>}
                </p>
              </div>
              {!closed && <Button type="button" variant="ghost" size="sm" aria-label={`Remove the question: ${q.prompt}`} disabled={busy} onClick={() => remove(q.id, where)}>Remove</Button>}
            </li>
          ))}
        </ul>
      ) : <p className="mt-2 text-sm text-muted-foreground">None.</p>}
      {!closed && (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="q-scope" className="block text-sm font-medium text-foreground">Asked</label>
            <select id="q-scope" className={cn(INPUT_CLASS, 'mt-1')} value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="session">with every reservation</option>
              {s.offerings.map((o) => <option key={o.id} value={o.id}>{`with ${subjectTitle(o)}`}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="q-kind" className="block text-sm font-medium text-foreground">Answer</label>
            <select id="q-kind" className={cn(INPUT_CLASS, 'mt-1')} value={kind} onChange={(e) => setKind(QuestionKindSchema.parse(e.target.value))}>
              {QUESTION_KINDS.map((k) => <option key={k} value={k}>{QUESTION_KIND_WORDS[k]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="q-text" className="block text-sm font-medium text-foreground">Question</label>
            <input id="q-text" className={cn(INPUT_CLASS, 'mt-1')} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. Will the student bring their own calculator?" />
          </div>
          {kind === 'choice' && (
            <div className="sm:col-span-3">
              <label htmlFor="q-choices" className="block text-sm font-medium text-foreground">Choices, one per line</label>
              <textarea id="q-choices" rows={3} className={cn(TEXTAREA_CLASS, 'mt-1')} value={choices} onChange={(e) => setChoices(e.target.value)} />
            </div>
          )}
          <div className="sm:col-span-3">
            <Button type="button" variant="outline" size="sm" disabled={!ready || busy} onClick={add}>{save.isPending ? 'Saving…' : 'Add the question'}</Button>
            <ErrorLine message={save.error} />
          </div>
        </div>
      )}
      <ImpactDialog save={save} />
    </section>
  );
}
