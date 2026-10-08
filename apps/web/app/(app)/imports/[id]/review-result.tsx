'use client';

/**
 * Result: what the last commit made, family by family — the counts, the
 * teachers and sections it added, and each family that failed with why (its
 * rows are marked; fix them and commit again: what was made is found, never
 * made twice).
 */

import { Button } from '~/components/ui/button';
import { Notice } from '~/components/ui/tone';
import type { ImportView } from '../import-shared';

type Result = {
  families?: { committed: number; failed: number };
  failed?: { family: string; error?: string }[];
  created?: Record<string, number>;
  teachersCreated?: string[];
  sectionsCreated?: string[];
};

const CREATED: [string, string][] = [
  ['students', 'student accounts'], ['parents', 'parent accounts'], ['links', 'parent–child links'], ['sectionPlaces', 'section places'],
  ['enrolments', 'course enrolments'], ['history', 'history rows'], ['registrations', 'lines awaiting payment'], ['money', 'money history notes'],
];

export function ResultTab({ v, onOpenRows }: { v: ImportView; onOpenRows: (show: string) => void }) {
  const r = (v.batch.result ?? {}) as Result;
  const created = r.created ?? {};
  const made = CREATED.filter(([k]) => (created[k] ?? 0) > 0);
  return (
    <div className="space-y-4">
      <Notice tone={r.families?.failed ? 'warning' : 'success'} title={
        <span><span className="tabular-nums">{r.families?.committed ?? 0}</span> <span>families committed</span>{r.families?.failed ? <>, <span className="tabular-nums">{r.families.failed}</span> <span>failed</span></> : null}</span>
      }>
        {made.length === 0 ? <p>Nothing new was made: everything was in the system already.</p> : (
          <ul className="mt-1 grid gap-x-6 sm:grid-cols-2">
            {made.map(([k, label]) => <li key={k}><span className="font-semibold tabular-nums">{created[k]}</span> <span>{label}</span></li>)}
          </ul>
        )}
      </Notice>
      {(r.teachersCreated?.length ?? 0) > 0 && (
        <p className="text-sm"><span className="text-muted-foreground">New teacher records:</span> <bdi data-i18n-skip="true">{r.teachersCreated!.join(', ')}</bdi></p>
      )}
      {(r.sectionsCreated?.length ?? 0) > 0 && (
        <p className="text-sm"><span className="text-muted-foreground">New sections:</span> <bdi data-i18n-skip="true">{r.sectionsCreated!.join(', ')}</bdi></p>
      )}
      {(r.failed?.length ?? 0) > 0 && (
        <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h2 className="mb-2 font-semibold text-foreground">Families that failed</h2>
          <p className="mb-2 text-sm text-muted-foreground">Nothing of each was made. Its rows say why; fix them and commit again.</p>
          <ul className="space-y-1 text-sm">
            {r.failed!.map((f) => (
              <li key={f.family}><bdi data-i18n-skip="true" className="font-medium">{f.family.replace(/^(student|parent)\|/, '')}</bdi> <span className="text-muted-foreground">—</span> <span>{f.error}</span></li>
            ))}
          </ul>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => onOpenRows('failed')}>Show their rows</Button>
        </section>
      )}
      <p className="text-sm text-muted-foreground">
        <span>Every record made points back to its line of the file. See them on</span>{' '}
        <a className="underline" href="/students">Students</a>, <a className="underline" href="/academic/sections">Sections</a> <span>and</span> <a className="underline" href="/academic/enrolment">Course enrolment</a>.
        {' '}<span>Accounts made here have no password yet: each family sets one with “Forgot password” on the sign-in page, using the email on the account.</span>
      </p>
      <Button variant="ghost" onClick={() => onOpenRows('committed')}>Show the committed rows</Button>
    </div>
  );
}
