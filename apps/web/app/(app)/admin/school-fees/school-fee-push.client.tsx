'use client';

/**
 * Push the school fee to families (RESERVATIONS_REWORK.md §3.6): a charge on each student's
 * statement for the year, due by a date, the family told. Paid, waived and graduate (A-13)
 * students are skipped and listed, as are those already pushed or paying; a school-fee payment
 * settles the push, a reversal reopens it, a waiver granted after it cancels it.
 *
 * In the sheet this is a column of who owes the year's fee, filled by hand and chased by phone;
 * here one push reaches every family of a grade or section, and the statement shows it until it
 * is paid.
 */

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Notice } from '~/components/ui/tone';
import { Field, INPUT_CLASS, Money } from '~/app/(app)/(sessions)/admin/sessions/sessions-shared';

const fetchSchedules = () => apiResponse(api.v1['school-fees'].schedules.$get());
const fetchSections = () => apiResponse(api.v1.academic.sections.$get({ query: {} }));
const pushRoute = api.v1['school-fees'].push;
const pushFees = (json: Parameters<typeof pushRoute.$post>[0]['json']) => apiResponse(pushRoute.$post({ json }));
type Pushed = Awaited<ReturnType<typeof pushFees>>;

export default function SchoolFeePush(): React.JSX.Element {
  const schedules = useQuery({ queryKey: ['school-fees', 'schedules', 'push'], queryFn: fetchSchedules });
  const sections = useQuery({ queryKey: ['academic', 'sections', 'push'], queryFn: fetchSections });
  const years = [...new Set((schedules.data ?? []).map((s) => s.academicYear))].sort().reverse();
  const [year, setYear] = useState('');
  const [target, setTarget] = useState<'grade' | 'section'>('grade');
  const [grade, setGrade] = useState('12');
  const [sectionId, setSectionId] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [formError, setFormError] = useState('');
  const [result, setResult] = useState<Pushed | null>(null);
  const chosenYear = year || years[0] || '';

  const push = useMutation({
    mutationFn: () => pushFees({
      academicYear: chosenYear,
      ...(target === 'grade' ? { grade: Number(grade) } : { sectionId }),
      // The end of that day at the school.
      dueAt: new Date(`${dueAt}T20:59:59Z`),
    }),
    onSuccess: (r) => { setResult(r); setFormError(''); },
    onError: (err: Error) => setFormError(err.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    if (!chosenYear) return setFormError('Set the year\'s school fee first.');
    if (target === 'section' && !sectionId) return setFormError('Pick a section.');
    if (!dueAt) return setFormError('Pick the date it is due by.');
    push.mutate();
  }

  return (
    <div className="mx-auto max-w-5xl px-6 pb-10">
      <form onSubmit={submit} className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 className="font-display text-base font-semibold text-foreground">Push to families</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The year&apos;s fee goes on each student&apos;s statement, due by the date, and the family is told. Paid, waived and graduate students are skipped and listed.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-4">
          <Field label="Academic year" htmlFor="push-year">
            <select id="push-year" value={chosenYear} onChange={(e) => setYear(e.target.value)} className={INPUT_CLASS}>
              {!years.length && <option value="">No school fee set</option>}
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </Field>
          <Field label="To">
            <div className="flex gap-2" role="radiogroup" aria-label="To">
              <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <input type="radio" name="push-target" checked={target === 'grade'} onChange={() => setTarget('grade')} />
                <span>A grade</span>
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <input type="radio" name="push-target" checked={target === 'section'} onChange={() => setTarget('section')} />
                <span>A section</span>
              </label>
            </div>
          </Field>
          {target === 'grade' ? (
            <Field label="Grade (that year)" htmlFor="push-grade">
              <select id="push-grade" value={grade} onChange={(e) => setGrade(e.target.value)} className={INPUT_CLASS}>
                {['9', '10', '11', '12', '13'].map((g) => <option key={g} value={g}>{`Grade ${g}`}</option>)}
              </select>
            </Field>
          ) : (
            <Field label="Section" htmlFor="push-section">
              <select id="push-section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} className={INPUT_CLASS}>
                <option value="">Pick a section…</option>
                {(sections.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Due by" htmlFor="push-due">
            <input id="push-due" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className={INPUT_CLASS} />
          </Field>
        </div>
        {formError && <Notice tone="danger" className="mt-4">{formError}</Notice>}
        <div className="mt-4 flex justify-end">
          <Button type="submit" disabled={push.isPending}>{push.isPending ? 'Pushing…' : 'Push the fee'}</Button>
        </div>
      </form>

      {result && (
        <div className="mt-4 space-y-3">
          <Notice tone={result.pushed.length ? 'success' : 'info'} title={<><span>Pushed to</span> <span>{result.pushed.length}</span> <span>{result.pushed.length === 1 ? 'student' : 'students'}</span></>}>
            {result.pushed.length > 0 && (
              <p><span>In all</span> <Money amount={result.pushed.reduce((s, p) => s + p.amount, 0)} /></p>
            )}
          </Notice>
          {result.skipped.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
              <table className="w-full min-w-[480px] text-sm">
                <caption className="px-4 pt-3 text-start text-sm font-medium text-foreground"><span>Skipped</span> (<span>{result.skipped.length}</span>)</caption>
                <thead className="border-b border-border bg-muted">
                  <tr>
                    <th className="px-4 py-2 text-start font-semibold text-muted-foreground">Student</th>
                    <th className="px-4 py-2 text-start font-semibold text-muted-foreground">Why</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {result.skipped.map((s) => (
                    <tr key={s.studentId}>
                      <td className="px-4 py-2"><bdi>{s.name}</bdi></td>
                      <td className="px-4 py-2 text-muted-foreground">{s.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
