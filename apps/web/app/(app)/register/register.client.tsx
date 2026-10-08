'use client';

/**
 * Reserve in the app (RESERVATIONS_REWORK.md §4.4) — the family's own page.
 *
 * The form version: one Google Form per subject, seven identity questions each, the subject's
 * choices, a refund-policy box and a declaration, about 35 answers for three subjects and no
 * price anywhere. Here: the child (a parent with several) and the session, then the Reserve page
 * — the subjects the school opened this cycle with what can be entered, the teacher where there
 * are several, a retake the system does not know declared with its sitting (to be verified by the
 * school), the price of each line and the total, the two consents — then the checkout by series.
 * The class, the guardian and the identity questions are gone: the system knows them.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, gradeLabel } from '@repo/validations';
import { Notice } from '~/components/ui/tone';
import { Reserve, type ReserveDone } from '~/components/reservations/reserve';
import { Money, Day } from '~/app/(app)/(sessions)/admin/sessions/sessions-shared';

const fetchActive = () => apiResponse(api.v1.sessions.active.$get());
const fetchUpcoming = () => apiResponse(api.v1.sessions.upcoming.$get());
const fetchChildren = () => apiResponse(api.v1.links.children.$get());
const fetchFee = (studentId: string | undefined) => apiResponse(api.v1['school-fees'].status.$get({ query: { studentId } }));
type SessionRow = Awaited<ReturnType<typeof fetchActive>>[number];

export default function RegisterClient({ userId, userRole }: { userId: string; userRole: string | null }): React.JSX.Element {
  const isParent = userRole === 'parent';
  const { data: active } = useSuspenseQuery({ queryKey: ['sessions', 'active'], queryFn: fetchActive });
  // A parent may preregister for a session that has not opened yet (V3 §6.8).
  const { data: upcoming = [] } = useQuery({ queryKey: ['sessions', 'upcoming'], queryFn: fetchUpcoming, enabled: isParent });
  const { data: children = [] } = useQuery({ queryKey: ['links', 'children'], queryFn: fetchChildren, enabled: isParent });
  const [childId, setChildId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [done, setDone] = useState<ReserveDone | null>(null);

  const child = isParent ? children.find((c) => c.student.id === (childId ?? (children.length === 1 ? children[0]!.student.id : ''))) ?? null : null;
  const studentId = isParent ? child?.student.id ?? null : userId;
  const sessions: SessionRow[] = [...active, ...(isParent ? upcoming : [])];
  const session = sessions.find((s) => s.id === (sessionId ?? (sessions.length === 1 ? sessions[0]!.id : ''))) ?? null;

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
      <div className="mx-auto max-w-5xl px-6 py-8">
        <Notice tone="neutral" title="No session is open for reservations">Check back later, or ask the school when the next one opens.</Notice>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8 animate-fade-up">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Reserve</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isParent ? 'Choose your child and the session, tick what they will sit, and pay by exam series.' : 'Tick what you will sit; your parent approves and pays.'}
        </p>
      </div>

      {done && (
        <Notice tone="success" title={done.message}>
          <div className="mt-2 flex flex-wrap gap-3">
            {isParent && (
              <Link href={`/checkout?ids=${done.registrationIds.join(',')}`} className="inline-flex items-center rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">Pay now →</Link>
            )}
            <Link href="/statement" className="text-sm underline">See the statement</Link>
            <button type="button" className="text-sm underline" onClick={() => setDone(null)}>Reserve more</button>
          </div>
        </Notice>
      )}

      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-border bg-card p-4 shadow-sm">
        {isParent && (
          <div>
            <label htmlFor="reserve-child" className="mb-1 block text-xs font-medium text-foreground">Child</label>
            {children.length === 0 ? (
              <p className="text-sm text-muted-foreground"><span>No linked children yet:</span> <Link href="/links" className="text-primary underline">link to your child</Link></p>
            ) : (
              <select id="reserve-child" className="h-10 rounded-lg border border-input bg-background px-3 text-sm" value={child?.student.id ?? ''} onChange={(e) => { setChildId(e.target.value); setDone(null); }}>
                <option value="">Choose…</option>
                {children.map((c) => (
                  <option key={c.student.id} value={c.student.id} data-i18n-skip="true">{c.student.name}{c.student.grade != null ? ` · ${gradeLabel(c.student.grade)}` : ''}</option>
                ))}
              </select>
            )}
          </div>
        )}
        <div>
          <label htmlFor="reserve-session" className="mb-1 block text-xs font-medium text-foreground">Session</label>
          <select id="reserve-session" className="h-10 rounded-lg border border-input bg-background px-3 text-sm" value={session?.id ?? ''} onChange={(e) => { setSessionId(e.target.value); setDone(null); }}>
            <option value="">Choose…</option>
            {sessions.map((s) => <option key={s.id} value={s.id} data-i18n-skip="true">{s.name}{s.status === 'draft' ? ' (preregistration)' : ''}</option>)}
          </select>
        </div>
        {session && (
          <p className="text-xs text-muted-foreground">
            <span>Reservations close</span> <Day iso={typeof session.endDate === 'string' ? session.endDate : null} />
            {session.status === 'draft' && <> · <span>not open yet: a preregistration holds the money until it opens</span></>}
          </p>
        )}
      </div>

      {feeDue && (
        <Notice tone="warning" title="The school fee comes first">
          <span>The</span> <span dir="ltr">{fee.academicYear}</span> <span>school fee</span>{fee.amount != null && <> (<Money amount={fee.amount} />)</>} <span>is paid before reserving.</span>{' '}
          {isParent ? <Link href={`/school-fee${studentId ? `?studentId=${studentId}` : ''}` as never} className="font-semibold underline">Pay the school fee now →</Link> : <span>Ask your parent to pay it from their account.</span>}
        </Notice>
      )}

      {studentId && session && (
        <Reserve key={`${session.id}|${studentId}`} viewer={isParent ? 'parent' : 'student'} studentId={studentId} sessionId={session.id} onDone={setDone} />
      )}
    </div>
  );
}
