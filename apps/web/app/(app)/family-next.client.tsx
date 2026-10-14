'use client';

/**
 * F6b — the family's landing (FEATURES_PLAN.md §1 F6b, point 2; docs/features/RESERVATION_FOCUS.md
 * §3): for each child, the step of the reservation cycle they are at, with the action in front of
 * them — the school fee first where it gates reserving, reserve (the open session is the one the
 * Reserve page preselects), the parent's approval, pay with the due date (the reminder), and the
 * statement once everything is paid. A student sees their own reservations and requests.
 *
 * The form version: one Google Form per subject, filled again for each subject, with no price, no
 * due date and no way to see later what was sent. Here the family sees where it stands per session
 * and the one next thing to do.
 *
 * Existing endpoints only: GET /v1/users/me/home-summary (the school fee, approvals, receipts,
 * what is payable now), GET /v1/sessions/active and /upcoming (what can be reserved), GET
 * /v1/statement (each child's lines per session, with what is outstanding and its due date).
 */

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, gradeLabel } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { type Tone } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { fetchStatement, statementKey } from '~/components/reservations/statement';
import { Day, Money } from '~/app/(app)/(sessions)/admin/sessions/sessions-shared';

const fetchHome = () => apiResponse(api.v1.users.me['home-summary'].$get());
const fetchActive = () => apiResponse(api.v1.sessions.active.$get());
const fetchUpcoming = () => apiResponse(api.v1.sessions.upcoming.$get());

type Row = { key: string; tone: Tone; body: React.ReactNode; action?: { label: string; href: string } };

const DOT: Record<Tone, string> = {
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
  info: 'bg-violet-500',
  neutral: 'bg-muted-foreground/40',
};

const LIVE = ['pending_approval', 'pending_payment', 'preregistered', 'confirmed'];

export default function FamilyNext({ viewerRole, viewerId, mayReserve }: { viewerRole: 'parent' | 'student'; viewerId: string; mayReserve: boolean }): React.JSX.Element | null {
  const isParent = viewerRole === 'parent';
  const home = useQuery({ queryKey: ['home-summary', 'next'], queryFn: fetchHome, retry: false });
  const active = useQuery({ queryKey: ['sessions', 'active'], queryFn: fetchActive });
  const upcoming = useQuery({ queryKey: ['sessions', 'upcoming'], queryFn: fetchUpcoming, enabled: isParent });
  const q = isParent ? {} : { studentId: viewerId };
  const statement = useQuery({ queryKey: statementKey(q), queryFn: () => fetchStatement(q) });

  if (home.isLoading || statement.isLoading || active.isLoading) {
    return (
      <div className="mb-8 animate-pulse rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="h-4 w-40 rounded bg-muted" />
        <div className="mt-3 h-8 w-64 rounded bg-muted" />
      </div>
    );
  }
  // Non-fatal: the quick links below still render.
  if (home.isError || !home.data) return null;

  const children = home.data.children;
  if (isParent && children.length === 0) {
    return (
      <div className="mb-8 rounded-xl border border-amber-200 bg-amber-50 p-6 dark:border-amber-700 dark:bg-amber-900/20">
        <h2 className="font-semibold text-amber-900 dark:text-amber-200">Start by linking your child</h2>
        <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
          You need a linked child before you can reserve subjects or pay fees. If your child already has an account, ask for the link; otherwise the school office sets both up for you in one visit.
        </p>
        <Button asChild className="mt-3"><Link href="/links">Link my child</Link></Button>
      </div>
    );
  }

  // What can be reserved now: the open sessions, and for a parent the ones about to open (preregistration).
  const reservable = [
    ...(active.data ?? []).map((s) => ({ id: s.id, name: s.name, opens: null as string | null, closes: String(s.endDate) })),
    ...(isParent ? (upcoming.data ?? []) : []).map((s) => ({ id: s.id, name: s.name, opens: String(s.startDate), closes: String(s.endDate) })),
  ];

  const perChild = children.map((c) => {
    const st = statement.data?.students.find((x) => x.student.id === c.student.id);
    const rows: Row[] = [];
    const who = c.student.id;

    // 1. The school fee gates reserving for the year (D-H).
    if (c.schoolFee.required && !c.schoolFee.paid) {
      rows.push(isParent
        ? {
            key: `fee-${who}`, tone: 'warning',
            body: <span><span>The school fee for</span> <span dir="ltr">{c.schoolFee.academicYear}</span> <span>is not paid yet: reserving opens after it.</span>{c.schoolFee.amount != null && <> <Money amount={c.schoolFee.amount} /></>}</span>,
            action: { label: 'Pay the school fee', href: `/school-fee?studentId=${who}` },
          }
        : { key: `fee-${who}`, tone: 'warning', body: <span>The school fee is not paid yet: ask your parent.</span> });
    }

    // 2. Reserve, in each session open now (or opening soon, for a parent) with nothing reserved in it yet.
    for (const s of reservable) {
      const mine = st?.sessions.find((x) => x.id === s.id)?.lines.filter((l) => LIVE.includes(l.status)) ?? [];
      if (mine.length > 0 || !mayReserve) continue;
      rows.push({
        key: `reserve-${who}-${s.id}`, tone: 'info',
        body: s.opens
          ? <span><bdi>{s.name}</bdi><span>:</span> <span>opens on</span> <Day iso={s.opens} /><span>; you can preregister now.</span></span>
          : <span><bdi>{s.name}</bdi> <span>is open for reservations until</span> <Day iso={s.closes} />.</span>,
        action: { label: s.opens ? 'Preregister' : 'Reserve subjects', href: '/register' },
      });
    }

    // 3. Waiting for the parent's approval (a student's reservation or drop/swap request).
    if (c.pendingApprovalCount > 0) {
      rows.push(isParent
        ? {
            key: `approve-${who}`, tone: 'warning',
            body: <span><span>{c.pendingApprovalCount}</span> <span>{c.pendingApprovalCount === 1 ? 'subject is waiting for your approval' : 'subjects are waiting for your approval'}</span></span>,
            action: { label: 'Approve', href: '/approvals' },
          }
        : {
            key: `approve-${who}`, tone: 'info',
            body: <span><span>{c.pendingApprovalCount}</span> <span>{c.pendingApprovalCount === 1 ? 'subject is waiting for your parent’s approval' : 'subjects are waiting for your parent’s approval'}</span></span>,
          });
    }

    // 4. Pay, session by session, with the due date: the reminder in front of them.
    for (const sess of st?.sessions ?? []) {
      const owed = sess.lines.filter((l) => l.outstanding > 0);
      if (!owed.length) continue;
      const amount = Math.round(owed.reduce((a, l) => a + l.outstanding, 0) * 100) / 100;
      const due = owed.map((l) => l.dueAt).filter((d): d is NonNullable<typeof d> => !!d).map(String).sort()[0] ?? null;
      const overdue = owed.some((l) => l.overdueDays > 0);
      const payable = owed.map((l) => l.id).filter((id) => c.owingRegistrationIds.includes(id));
      const provisionalOnly = payable.length === 0 && owed.every((l) => l.provisional);
      rows.push({
        key: `pay-${who}-${sess.id}`, tone: overdue ? 'danger' : 'warning',
        body: (
          <span>
            <bdi>{sess.name}</bdi><span>:</span> <Money amount={amount} /> <span>to pay</span>
            {due && (overdue
              ? <> — <span className="font-medium text-red-700 dark:text-red-400"><span>overdue since</span> <Day iso={due} /></span></>
              : <> — <span><span>due by</span> <Day iso={due} /></span></>)}
            {provisionalOnly && <span className="block text-xs text-muted-foreground">Payable once the board publishes its fee.</span>}
          </span>
        ),
        action: isParent && payable.length > 0
          ? { label: 'Pay now', href: `/checkout?ids=${payable.join(',')}` }
          : { label: isParent ? 'See the statement' : 'Ask your parent: see the statement', href: '/statement' },
      });
    }

    // 5. Everything reserved in an open session is paid: done, the statement shows it.
    for (const s of reservable) {
      const mine = st?.sessions.find((x) => x.id === s.id)?.lines.filter((l) => LIVE.includes(l.status)) ?? [];
      if (!mine.length || mine.some((l) => l.outstanding > 0 || l.status === 'pending_approval')) continue;
      rows.push({
        key: `done-${who}-${s.id}`, tone: 'success',
        body: <span><bdi>{s.name}</bdi><span>:</span> <span>{mine.length}</span> <span>{mine.length === 1 ? 'subject reserved and paid' : 'subjects reserved and paid'}</span></span>,
        action: { label: isParent ? 'Add a subject' : 'Reserve another subject', href: '/register' },
      });
    }

    // 6. Receipts to bring back before a refund is released; 7. drop and swap requests.
    if (c.receiptsToReturn > 0) {
      rows.push({
        key: `receipts-${who}`, tone: 'warning',
        body: <span><span>{c.receiptsToReturn}</span> <span>{c.receiptsToReturn === 1 ? 'receipt to bring back to the school to release the refund' : 'receipts to bring back to the school to release the refund'}</span></span>,
        action: { label: 'My Registrations', href: '/registrations' },
      });
    }
    if (c.pendingChangeRequestCount > 0) {
      rows.push(isParent
        ? {
            key: `changes-${who}`, tone: 'warning',
            body: <span><span>{c.pendingChangeRequestCount}</span> <span>{c.pendingChangeRequestCount === 1 ? 'drop or swap request to review' : 'drop or swap requests to review'}</span></span>,
            action: { label: 'Review', href: '/approvals' },
          }
        : {
            key: `changes-${who}`, tone: 'info',
            body: <span><span>{c.pendingChangeRequestCount}</span> <span>{c.pendingChangeRequestCount === 1 ? 'drop or swap request waiting' : 'drop or swap requests waiting'}</span></span>,
            action: { label: 'My requests', href: '/pending-requests' },
          });
    }
    return { child: c, rows };
  });

  const firstAction = perChild.flatMap((p) => p.rows).find((r) => r.action)?.key;
  const nothing = perChild.every((p) => p.rows.length === 0);
  const escrowFree = statement.data?.totals.escrowFree ?? 0;

  return (
    <section className="mb-8 rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-bold text-foreground">{nothing ? 'Nothing is waiting on you' : 'What comes next'}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {nothing
              ? (reservable.length ? 'Everything reserved is paid.' : 'No session is open for reservations right now. You will be told when the next one opens.')
              : isParent ? 'For each of your children, the next step of the reservation.' : 'Your reservations and requests, and what each one needs.'}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/statement">{isParent ? 'The family statement' : 'My statement'}</Link>
        </Button>
      </div>

      {!nothing && (
        <div className="mt-4 space-y-4">
          {perChild.filter((p) => p.rows.length > 0).map(({ child, rows }) => (
            <div key={child.student.id}>
              {isParent && (
                <h3 className="text-sm font-semibold text-foreground">
                  <bdi data-i18n-skip="true">{child.student.name}</bdi> <span className="font-normal text-muted-foreground">· {gradeLabel(child.student.grade)}</span>
                </h3>
              )}
              <ul className="mt-1 divide-y divide-border">
                {rows.map((r) => (
                  <li key={r.key} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                    <div className="flex min-w-0 items-start gap-2 text-sm text-foreground">
                      <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', DOT[r.tone])} aria-hidden />
                      {r.body}
                    </div>
                    {r.action && (
                      <Button asChild size="sm" variant={r.key === firstAction ? 'default' : 'outline'}>
                        <Link href={r.action.href as never}>{r.action.label}</Link>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {escrowFree > 0 && (
        <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
          <span>In the wallet:</span> <Money amount={escrowFree} /> <span>available</span>
        </p>
      )}
    </section>
  );
}
