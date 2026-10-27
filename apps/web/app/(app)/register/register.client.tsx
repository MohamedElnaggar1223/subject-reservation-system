'use client';

/**
 * Reserve in the app (COORDINATOR_REWORK.md F1, §5 "Families"; P3) — the family's own page.
 *
 * The form version: one Google Form per subject, seven identity questions each, the subject's choices, a
 * refund-policy box and a declaration — about 35 answers for three subjects, no price anywhere, and all of it again
 * for a second child. Here: one page per child (a parent switches between children with one click, each child's
 * choices kept), the session open now preselected, every subject with its choices and prices, one agreement and
 * one button per child, then the checkout. The class, the guardian and the identity questions are gone: the
 * system knows them.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, gradeLabel, formatEgp } from '@repo/validations';
import { Notice } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { Reserve, Sentences, EMPTY_DRAFT, type ReserveDone, type ReserveDraft } from '~/components/reservations/reserve';
import { Money } from '~/app/(app)/(sessions)/admin/sessions/sessions-shared';

const fetchActive = () => apiResponse(api.v1.sessions.active.$get());
const fetchChildren = () => apiResponse(api.v1.links.children.$get());
const fetchFee = (studentId: string | undefined) => apiResponse(api.v1['school-fees'].status.$get({ query: { studentId } }));

export default function RegisterClient({ userId, userRole }: { userId: string; userRole: string | null }): React.JSX.Element {
  const isParent = userRole === 'parent';
  const { data: sessions } = useSuspenseQuery({ queryKey: ['sessions', 'active'], queryFn: fetchActive });
  const { data: children = [] } = useQuery({ queryKey: ['links', 'children'], queryFn: fetchChildren, enabled: isParent });
  const [childId, setChildId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  // Each child's choices and result, kept while the parent switches between them (F1: one page per child).
  const [drafts, setDrafts] = useState<Record<string, ReserveDraft>>({});
  const [done, setDone] = useState<Record<string, ReserveDone>>({});

  const child = isParent ? children.find((c) => c.student.id === childId) ?? children[0] ?? null : null;
  const studentId = isParent ? child?.student.id ?? null : userId;
  const session = sessions.find((s) => s.id === sessionId) ?? (sessions.length === 1 ? sessions[0]! : null);
  const key = `${session?.id ?? ''}|${studentId ?? ''}`;

  // The school fee of the year comes first (D-H): said here, refused by the API too.
  const { data: fee } = useQuery({
    queryKey: ['school-fees', 'status', studentId],
    queryFn: () => fetchFee(isParent ? studentId ?? undefined : undefined),
    enabled: !!studentId,
    retry: false,
  });
  const feeDue = !!fee && fee.required && !fee.paid;

  if (!sessions.length) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <Notice tone="neutral" title="No session is open for reservations">Check back later, or ask the school when the next one opens.</Notice>
      </div>
    );
  }

  const result = done[key];
  const others = isParent ? children.filter((c) => c.student.id !== studentId && !done[`${session?.id ?? ''}|${c.student.id}`]) : [];

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 animate-fade-up sm:px-6 sm:py-8">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Reserve</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isParent ? 'One page per child: pick the subjects, agree once, and reserve. You pay at the checkout.' : 'Pick what you will sit; your parent approves and pays.'}
        </p>
      </div>

      {isParent && children.length === 0 && (
        <Notice tone="warning"><span>No linked children yet:</span> <Link href="/links" className="font-semibold underline">link to your child</Link></Notice>
      )}

      {isParent && children.length > 1 && (
        <div role="group" aria-label="Child" className="flex flex-wrap gap-2">
          {children.map((c) => {
            const on = c.student.id === studentId;
            const n = Object.keys(drafts[`${session?.id ?? ''}|${c.student.id}`]?.picks ?? {}).length;
            return (
              <button key={c.student.id} type="button" aria-pressed={on} onClick={() => setChildId(c.student.id)}
                className={cn('min-h-11 rounded-lg border px-4 py-2 text-sm font-medium', on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground hover:border-primary/50')}>
                <bdi data-i18n-skip="true">{c.student.name}</bdi>
                {c.student.grade != null && <span className={cn('ms-1 font-normal', on ? 'text-primary-foreground/80' : 'text-muted-foreground')}>· {gradeLabel(c.student.grade)}</span>}
                {n > 0 && <span className="ms-1" dir="ltr">({n})</span>}
              </button>
            );
          })}
        </div>
      )}

      {sessions.length > 1 && (
        <div className="w-full min-w-0 sm:w-auto">
          <label htmlFor="reserve-session" className="mb-1 block text-xs font-medium text-foreground">Session</label>
          <select id="reserve-session" className="h-10 w-full max-w-full rounded-lg border border-input bg-background px-3 text-sm sm:w-auto" value={session?.id ?? ''} onChange={(e) => setSessionId(e.target.value)}>
            <option value="">Choose…</option>
            {sessions.map((s) => <option key={s.id} value={s.id} data-i18n-skip="true">{s.name}</option>)}
          </select>
        </div>
      )}

      {studentId && session && (
        <div>
          <h2 className="font-display text-xl font-semibold text-foreground">
            {isParent && child ? <><span>Reserve for</span> <bdi data-i18n-skip="true">{child.student.name}</bdi></> : <span>Your subjects</span>}
          </h2>
          <p className="text-sm text-muted-foreground">
            {isParent && child?.student.grade != null && <><span>{gradeLabel(child.student.grade)}</span> · </>}
            <bdi data-i18n-skip="true">{session.name}</bdi>
          </p>
        </div>
      )}

      {feeDue && (
        <Notice tone="warning" title="The school fee comes first">
          {/* One sentence, translated whole (word by word "The" stayed English in Arabic). */}
          <span>{`The ${fee.academicYear} school fee${fee.amount != null ? ` (${formatEgp(Number(fee.amount))})` : ''} is paid before reserving.`}</span>{' '}
          {isParent ? <Link href={`/school-fee${studentId ? `?studentId=${studentId}` : ''}` as never} className="font-semibold underline">Pay the school fee now →</Link> : <span>Ask your parent to pay it from their account.</span>}
        </Notice>
      )}

      {result && (
        <Notice tone="success" title={isParent && child ? <><span>Reserved for</span> <bdi data-i18n-skip="true">{child.student.name}</bdi></> : <Sentences items={result.sentences} />}>
          {isParent && <p><Sentences items={result.sentences} /></p>}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {result.payable && result.total > 0 && (
              <Link href={`/checkout?ids=${result.registrationIds.join(',')}`} className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
                <span>Pay</span>&nbsp;<Money amount={result.total} />
              </Link>
            )}
            {others.map((c) => (
              <button key={c.student.id} type="button" className="inline-flex min-h-11 items-center rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:border-primary/50"
                onClick={() => setChildId(c.student.id)}>
                <span>Reserve for</span>&nbsp;<bdi data-i18n-skip="true">{c.student.name}</bdi>
              </button>
            ))}
            <Link href="/statement" className="text-sm underline underline-offset-4">See the statement</Link>
            <button type="button" className="text-sm underline underline-offset-4" onClick={() => setDone(({ [key]: _gone, ...rest }) => rest)}>Reserve more</button>
          </div>
        </Notice>
      )}

      {studentId && session && !result && (
        <Reserve key={key} viewer={isParent ? 'parent' : 'student'} studentId={studentId} sessionId={session.id}
          childName={isParent ? child?.student.name : undefined}
          draft={drafts[key] ?? EMPTY_DRAFT} onDraft={(d) => setDrafts((all) => ({ ...all, [key]: d }))}
          onDone={(d) => { setDone((all) => ({ ...all, [key]: d })); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
      )}
    </div>
  );
}
