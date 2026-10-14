'use client';

/**
 * People and conflicts: the students and parents the rows name, one per
 * email. The conflicts the spike found (IS-06) come first, each with its fix
 * beside it: two children under one email (give one child's rows their own
 * email, or say they are one child), the same child or parent under two
 * emails (merge, or say they are different people), several spellings of a
 * name (choose one), an email another kind of account holds (use another).
 * Accounts already in the system are found and matched, never recreated.
 */

import { useMemo, useState } from 'react';
import { api } from '~/lib/hono';
import { apiResponse } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge, Notice } from '~/components/ui/tone';
import { EmptyState } from '~/components/ui/query-state';
import { cn } from '~/lib/utils';
import { ProblemChip, LineRef, rowSummary, FAMILY_STATUS, SELECT, INPUT, type ImportView, type ImportPerson } from '../import-shared';
import { useReviewMutation } from './review.client';

type Show = 'conflicts' | 'students' | 'parents' | 'found' | 'aside';
const PAGE = 60;

export function PeopleTab({ id, v, editable, onEdit }: { id: string; v: ImportView; editable: boolean; onEdit: (rowId: string) => void }) {
  const [show, setShow] = useState<Show>('conflicts');
  const [limit, setLimit] = useState(PAGE);
  const [search, setSearch] = useState('');
  const groups = useMemo(() => {
    const live = v.people.filter((p) => !p.mergedInto);
    return {
      conflicts: live.filter((p) => p.problems.some((x) => x.severity !== 'info')),
      students: live.filter((p) => p.role === 'student' && p.decision === 'import'),
      parents: live.filter((p) => p.role === 'parent' && p.decision === 'import'),
      found: live.filter((p) => p.matched),
      aside: v.people.filter((p) => p.mergedInto || p.decision === 'skip'),
    };
  }, [v.people]);
  const q = search.trim().toLowerCase();
  const list = groups[show].filter((p) => !q || [p.name, p.email, p.key].some((x) => x?.toLowerCase().includes(q)));
  const labels: [Show, string][] = [['conflicts', 'Conflicts'], ['students', 'Students'], ['parents', 'Parents'], ['found', 'Accounts found'], ['aside', 'Merged or left out']];

  if (v.kind === 'money_record') {
    return (
      <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        A money record names students already in the system; each row is matched by email or school ID. Rows whose student is not found are on the Problems tab.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
          {labels.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={show === k} onClick={() => { setShow(k); setLimit(PAGE); }}
              className={cn('rounded-full border px-3 py-1 text-xs font-semibold', show === k ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-accent')}>
              <span>{label}</span> <span className="tabular-nums">{groups[k].length}</span>
            </button>
          ))}
        </div>
        <input type="search" aria-label="Search people" placeholder="Name or email" className={cn(INPUT, 'ms-auto w-56')} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {list.length === 0 ? (
        <EmptyState title={show === 'conflicts' ? 'No conflicts' : 'Nobody here'} message={show === 'conflicts' ? 'Every email names one person, and no two people look like the same one.' : undefined} />
      ) : (
        <>
          <ul className="space-y-2">
            {list.slice(0, limit).map((p) => <PersonCard key={`${p.role}|${p.key}`} id={id} v={v} p={p} editable={editable && p.status !== 'committed'} onEdit={onEdit} />)}
          </ul>
          {list.length > limit && <Button variant="outline" onClick={() => setLimit(limit + PAGE)}><span>Show more</span> (<span className="tabular-nums">{list.length - limit}</span>)</Button>}
        </>
      )}
    </div>
  );
}

function PersonCard({ id, v, p, editable, onEdit }: { id: string; v: ImportView; p: ImportPerson; editable: boolean; onEdit: (rowId: string) => void }) {
  const [email, setEmail] = useState('');
  const person = useReviewMutation(id, (json: Parameters<typeof api.v1.imports[':id']['people']['$put']>[0]['json']) =>
    apiResponse(api.v1.imports[':id'].people.$put({ param: { id }, json })));
  const rows = useReviewMutation(id, (json: Parameters<typeof api.v1.imports[':id']['rows']['$put']>[0]['json']) =>
    apiResponse(api.v1.imports[':id'].rows.$put({ param: { id }, json })));
  const myRows = v.rows.filter((r) => p.rowIds.includes(r.id));
  const family = v.families.find((f) => f.key === p.familyKey);
  const has = (code: string) => p.problems.some((x) => x.code === code);
  const others = (code: string) => (p.problems.find((x) => x.code === code)?.detail ?? '').replace(/^also /, '').replace(/ \(.*\)$/, '').split(', ').filter(Boolean);
  const byName = new Map<string, typeof myRows>();
  for (const r of myRows) {
    const n = rowSummary(r).student ?? '';
    byName.set(n, [...(byName.get(n) ?? []), r]);
  }
  const error = person.error || rows.error;
  const busy = person.isPending || rows.isPending;
  const emailField = p.role === 'student' ? 'studentEmail' : 'parentEmail';

  return (
    <li className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start gap-3">
        <Badge tone="neutral">{p.role === 'student' ? 'Student' : 'Parent'}</Badge>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-foreground"><bdi data-i18n-skip="true">{p.name || '—'}</bdi></p>
          <p className="text-sm text-muted-foreground">
            <bdi data-i18n-skip="true">{p.email ?? 'no email'}</bdi>
            {p.phone && <> · <bdi data-i18n-skip="true">{p.phone}</bdi></>}
            {p.role === 'student' && p.section && <> · <bdi data-i18n-skip="true">{p.section}</bdi></>}
            {p.role === 'student' && p.gradeToday !== null && <> · <span>grade today</span> <span className="tabular-nums">{p.gradeToday > 12 ? '—' : p.gradeToday}</span>{p.gradeToday > 12 && <> <span>(finished school)</span></>}</>}
          </p>
          {p.matched && (
            <p className="mt-0.5 text-sm"><Badge tone="success">Account found</Badge> <bdi data-i18n-skip="true" className="text-muted-foreground">{p.matched.name}</bdi> <span className="text-muted-foreground">— matched, never recreated</span></p>
          )}
          {p.mergedInto && <p className="mt-0.5 text-sm text-muted-foreground"><span>Merged into</span> <bdi data-i18n-skip="true">{p.mergedInto}</bdi></p>}
          {p.mergedFrom.length > 0 && <p className="mt-0.5 text-sm text-muted-foreground"><span>Also under</span> <bdi data-i18n-skip="true">{p.mergedFrom.join(', ')}</bdi></p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {p.problems.map((x) => <ProblemChip key={x.code} p={x} />)}
          {family && <Badge tone={FAMILY_STATUS[family.status]!.tone}>{FAMILY_STATUS[family.status]!.label}</Badge>}
          {p.status === 'committed' && <Badge tone="success">Committed</Badge>}
        </div>
      </div>
      {error && <Notice tone="danger" className="mt-2">{error}</Notice>}

      {editable && (
        <div className="mt-3 space-y-3 border-t border-border pt-3 text-sm">
          {has('student_email_shared') && (
            <div>
              <p className="mb-2 font-medium text-foreground">These rows name different children under one email. Give one child's rows their own email:</p>
              <ul className="space-y-2">
                {[...byName.entries()].slice(1).map(([name, rs]) => (
                  <SplitRow key={name} name={name} count={rs.length} busy={busy} onSplit={(e) => rows.mutate({ rowIds: rs.map((r) => r.id), edits: { studentEmail: e } })} />
                ))}
              </ul>
              <Button size="sm" variant="ghost" className="mt-1" disabled={busy} onClick={() => person.mutate({ role: 'student', key: p.key, oneChild: true })}>They are one child</Button>
            </div>
          )}
          {(has('duplicate_student') || has('duplicate_parent')) && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">{p.role === 'student' ? 'The same child?' : 'The same parent?'}</span>
              {others(has('duplicate_student') ? 'duplicate_student' : 'duplicate_parent').map((o) => (
                <Button key={o} size="sm" variant="outline" disabled={busy} onClick={() => person.mutate({ role: p.role, key: p.key, mergedInto: o })}>
                  <span>Merge into</span> <bdi data-i18n-skip="true">{o}</bdi>
                </Button>
              ))}
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => person.mutate({ role: p.role, key: p.key, distinct: true })}>Different people</Button>
            </div>
          )}
          {(has('email_taken') || has('email_student_is_parent')) && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">Use another email on its rows:</span>
              <input aria-label="Another email" dir="ltr" data-i18n-skip="true" className={cn(INPUT, 'w-64')} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
              <Button size="sm" variant="outline" disabled={busy || !email.includes('@')} onClick={() => rows.mutate({ rowIds: p.rowIds, edits: { [emailField]: email } })}>Use it</Button>
            </div>
          )}
          {p.names.length > 1 && (
            <label className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">Name to use:</span>
              <select className={SELECT} value={p.name} disabled={busy} onChange={(e) => person.mutate({ role: p.role, key: p.key, edits: { name: e.target.value } })}>
                {p.names.map((n) => <option key={n.name} value={n.name}>{n.name} ({n.rows})</option>)}
              </select>
            </label>
          )}
          {p.phones.length > 1 && (
            <label className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">Phone to use:</span>
              <select className={SELECT} value={p.phone ?? ''} disabled={busy} onChange={(e) => person.mutate({ role: p.role, key: p.key, edits: { phone: e.target.value } })}>
                {p.phones.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            {p.mergedInto ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => person.mutate({ role: p.role, key: p.key, mergedInto: null })}>Undo the merge</Button>
            ) : p.decision === 'skip' ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => person.mutate({ role: p.role, key: p.key, decision: 'import' })}>Bring back in</Button>
            ) : (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => person.mutate({ role: p.role, key: p.key, decision: 'skip' })}>
                {p.role === 'student' ? 'Leave this student out' : 'Leave this parent out (the children stay)'}
              </Button>
            )}
            {(p.distinct || p.oneChild) && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => person.mutate({ role: p.role, key: p.key, distinct: false, oneChild: false })}>Flag it again</Button>
            )}
          </div>
        </div>
      )}

      {myRows.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-muted-foreground"><span className="tabular-nums">{myRows.length}</span> <span>{myRows.length === 1 ? 'line' : 'lines'}</span></summary>
          <ul className="mt-1 divide-y divide-border">
            {myRows.map((r) => {
              const s = rowSummary(r);
              return (
                <li key={r.id} className="flex items-center gap-3 py-1.5">
                  <span className="w-28"><LineRef r={r} /></span>
                  <bdi data-i18n-skip="true" className="w-48 truncate">{s.student}</bdi>
                  <bdi data-i18n-skip="true" className="flex-1 truncate text-muted-foreground">{[s.subject, s.code, s.cls].filter(Boolean).join(' · ')}</bdi>
                  <Button size="sm" variant="ghost" onClick={() => onEdit(r.id)}>Open line</Button>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </li>
  );
}

function SplitRow({ name, count, busy, onSplit }: { name: string; count: number; busy: boolean; onSplit: (email: string) => void }) {
  const [email, setEmail] = useState('');
  return (
    <li className="flex flex-wrap items-center gap-2">
      <bdi data-i18n-skip="true" className="w-44 truncate font-medium">{name}</bdi>
      <span className="text-muted-foreground">(<span className="tabular-nums">{count}</span> <span>{count === 1 ? 'line' : 'lines'}</span>)</span>
      <input aria-label={`Own email for ${name}`} dir="ltr" data-i18n-skip="true" className={cn(INPUT, 'w-64')} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
      <Button size="sm" variant="outline" disabled={busy || !email.includes('@')} onClick={() => onSplit(email)}>Give them this email</Button>
    </li>
  );
}
