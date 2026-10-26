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
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, refundPolicySentence, DECLARATION_TEXT, ALLOWED_GRADES, type RefundPolicy, type AllowedGrade } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge } from '~/components/ui/tone';
import { Switch } from '~/components/ui/switch';
import { cn } from '~/lib/utils';
import { ErrorLine, INPUT_CLASS, TEXTAREA_CLASS } from '../sessions-shared';
import { subjectTitle, useImpactSave, ImpactDialog, refusalText, type SetupSession } from '../setup-shared';

const card = 'rounded-xl border border-border bg-card p-5 shadow-sm';
const PERCENTS = [100, 75, 50, 25, 0];
const GRADE_WORDS: Record<AllowedGrade, string> = { '10': 'Grade 10', '11': 'Grade 11', '12': 'Grade 12', graduates: 'Graduates retaking' };
const QUESTION_KINDS = { yes_no: 'Yes / no', text: 'Short text', choice: 'A choice' } as const;
type QuestionKind = keyof typeof QUESTION_KINDS;

type SessionPut = {
  selfStudyPercent?: number; allowedGrades?: AllowedGrade[]; unpaidCancelDays?: number; refundPolicy?: RefundPolicy;
  questions?: { id?: string; kind: QuestionKind; prompt: string; choices: string[]; required: boolean }[];
};

export default function AgreeTab({ s }: { s: SetupSession }) {
  const queryClient = useQueryClient();
  const save = useImpactSave(
    (json: SessionPut, expected) => apiResponse(api.v1.sessions[':id'].$put({ param: { id: s.id }, json: { ...json, ...(expected ? { expected } : {}) } })),
    () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  );
  const closed = s.status === 'closed';
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
            <select id="ag-share" className={cn(INPUT_CLASS, 'mt-1')} value={s.selfStudyPercent} disabled={closed || save.isPending}
              onChange={(e) => save.save({ selfStudyPercent: Number(e.target.value) })}>
              {Array.from({ length: 21 }, (_, i) => i * 5).map((p) => <option key={p} value={p}>{`${p}% of the course fee`}</option>)}
            </select>
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
                      onChange={(next) => save.save({ allowedGrades: (next ? [...s.allowedGrades, g] : s.allowedGrades.filter((x) => x !== g)) as AllowedGrade[] })} />
                  </div>
                );
              })}
            </div>
          </fieldset>
          <div>
            <label htmlFor="ag-cancel" className="block text-sm font-medium text-foreground">Unpaid reservations are cancelled</label>
            <select id="ag-cancel" className={cn(INPUT_CLASS, 'mt-1')} value={s.unpaidCancelDays} disabled={closed || save.isPending}
              onChange={(e) => save.save({ unpaidCancelDays: Number(e.target.value) })}>
              {Array.from({ length: 15 }, (_, d) => d).map((d) => <option key={d} value={d}>{d === 0 ? 'on the payment due date' : `${d} ${d === 1 ? 'day' : 'days'} after the payment due date`}</option>)}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">or at the board&apos;s deadline, if that is earlier. Reminders go before.</p>
          </div>
        </div>
        <ErrorLine message={save.error} />
      </section>
      <QuestionsCard s={s} onSave={(questions) => save.save({ questions })} pending={save.isPending} />
      <ImpactDialog save={save} />
    </div>
  );
}

/** C7: "until week N → P%" rows; the sentence families read made from them; fixed once a family agrees. */
function RefundPolicyCard({ s, onSave, pending }: { s: SetupSession; onSave: (p: RefundPolicy) => void; pending: boolean }) {
  const saved = (s.refundPolicy as RefundPolicy | null) ?? { steps: [{ throughWeek: null, percent: 0 }] };
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

/** D13: optional questions with every reservation or with one subject; never a price, never who may reserve. */
function QuestionsCard({ s, onSave, pending }: { s: SetupSession; onSave: (q: SessionPut['questions']) => void; pending: boolean }) {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState('session');
  const [kind, setKind] = useState<QuestionKind>('yes_no');
  const [prompt, setPrompt] = useState('');
  const [choices, setChoices] = useState('');
  const asOf = (q: { id: string; kind: string; prompt: string; choices: string[]; required: boolean }) => ({ id: q.id, kind: q.kind as QuestionKind, prompt: q.prompt, choices: q.choices, required: q.required });
  const subject = useMutation({
    mutationFn: async ({ offeringId, questions }: { offeringId: string; questions: SessionPut['questions'] }) =>
      apiResponse(api.v1.sessions[':id'].offerings[':offeringId'].$put({ param: { id: s.id, offeringId }, json: { questions } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  });
  const all = [
    ...s.questions.map((q) => ({ q, where: null as null | (typeof s.offerings)[number] })),
    ...s.offerings.flatMap((o) => o.questions.map((q) => ({ q, where: o }))),
  ];
  const list = choices.split('\n').map((c) => c.trim()).filter(Boolean);
  const ready = prompt.trim().length >= 2 && (kind !== 'choice' || list.length > 0);
  const add = () => {
    const q = { kind, prompt: prompt.trim(), choices: kind === 'choice' ? list : [], required: false };
    if (scope === 'session') onSave([...s.questions.map(asOf), q]);
    else {
      const o = s.offerings.find((x) => x.id === scope)!;
      subject.mutate({ offeringId: o.id, questions: [...o.questions.map(asOf), q] });
    }
    setPrompt(''); setChoices('');
  };
  const remove = (id: string, where: (typeof s.offerings)[number] | null) => {
    if (!where) onSave(s.questions.filter((q) => q.id !== id).map(asOf));
    else subject.mutate({ offeringId: where.id, questions: where.questions.filter((q) => q.id !== id).map(asOf) });
  };
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
                  <span>{QUESTION_KINDS[q.kind as QuestionKind] ?? q.kind}</span>{q.choices.length > 0 && <>: <bdi data-i18n-skip="true">{q.choices.join(' / ')}</bdi></>} · {where ? <><span>asked with</span> <bdi data-i18n-skip="true">{subjectTitle(where)}</bdi></> : <span>asked with every reservation</span>}
                </p>
              </div>
              {!closed && <Button type="button" variant="ghost" size="sm" disabled={pending || subject.isPending} onClick={() => remove(q.id, where)}>Remove</Button>}
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
            <select id="q-kind" className={cn(INPUT_CLASS, 'mt-1')} value={kind} onChange={(e) => setKind(e.target.value as QuestionKind)}>
              {(Object.keys(QUESTION_KINDS) as QuestionKind[]).map((k) => <option key={k} value={k}>{QUESTION_KINDS[k]}</option>)}
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
            <Button type="button" variant="outline" size="sm" disabled={!ready || pending || subject.isPending} onClick={add}>Add the question</Button>
            <ErrorLine message={subject.error ? refusalText(subject.error) : null} />
          </div>
        </div>
      )}
    </section>
  );
}
