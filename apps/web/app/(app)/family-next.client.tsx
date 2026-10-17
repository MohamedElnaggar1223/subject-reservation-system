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
import { useQueries, useQuery } from '@tanstack/react-query';
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
const fetchEligibility = (studentId: string, sessionId: string) =>
  apiResponse(api.v1.registrations.eligibility.$get({ query: { studentId, sessionId } }));

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

  // What can be reserved now: the open sessions, and for a parent the ones about to open (preregistration).
  const open = (active.data ?? []).map((s) => ({ id: s.id, name: s.name, opens: null as string | null, closes: String(s.endDate) }));
  const comingUp = (isParent ? (upcoming.data ?? []) : []).map((s) => ({ id: s.id, name: s.name, opens: String(s.startDate) as string | null, closes: String(s.endDate) }));
  const reservable = [...open, ...comingUp];
  // Whether each child may reserve in each of them (grade, leaving, graduation): the Reserve page's own check.
  const pairs = (home.data?.children ?? []).flatMap((c) => reservable.map((s) => ({ studentId: c.student.id, sessionId: s.id })));
  const verdicts = useQueries({
    queries: pairs.map((p) => ({
      queryKey: ['registrations', 'eligibility', p.studentId, p.sessionId],
      queryFn: () => fetchEligibility(p.studentId, p.sessionId),
    })),
  });
  const verdictOf = (studentId: string, sessionId: string) =>
    verdicts[pairs.findIndex((p) => p.studentId === studentId && p.sessionId === sessionId)]?.data ?? null;

  if (home.isLoading || statement.isLoading || active.isLoading) {
    return (
      <div className="mb-8 animate-pulse rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="h-4 w-40 rounded bg-muted" />
        <div className="mt-3 h-8 w-64 rounded bg-muted" />
      </div>
    );
  }
  // Non-fatal: the quick links below still render. Without the statement the card could offer to
  // reserve what is already reserved, so it waits for both.
  if (home.isError || !home.data || statement.isError) return null;

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

  // F6: each child's rows in the order the family meets them — the school fee that gates reserving, a
  // request waiting for the parent, what is owed (overdue first), then reserving in the session open now,
  // then what is done and what waits on the school. A session that opens later is not a step today: it
  // is said once, under "Coming up", for the whole family (it came first, filled, above "Pay now").
  const perChild = children.map((c) => {
    const st = statement.data?.students.find((x) => x.student.id === c.student.id);
    const rows: Row[] = [];
    const who = c.student.id;
    const reserveRows: Row[] = [];
    const payRows: Row[] = [];

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

    // 2. Reserve, in each session open now with nothing reserved in it yet — where the child may
    //    reserve in it; where not, the school's reason, once.
    for (const s of open) {
      const mine = st?.sessions.find((x) => x.id === s.id)?.lines.filter((l) => LIVE.includes(l.status)) ?? [];
      if (mine.length > 0 || !mayReserve) continue;
      const verdict = verdictOf(who, s.id);
      if (verdict && !verdict.allowed) {
        reserveRows.push({
          key: `cannot-${who}-${s.id}`, tone: 'neutral',
          body: <span><bdi>{s.name}</bdi><span>:</span> <span>{verdict.reason ?? 'Not open to this student.'}</span></span>,
        });
        continue;
      }
      reserveRows.push({
        key: `reserve-${who}-${s.id}`, tone: 'info',
        body: <span><bdi>{s.name}</bdi> <span>is open for reservations until</span> <Day iso={s.closes} />.</span>,
        action: { label: 'Reserve subjects', href: '/register' },
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
    //    A line on a board fee not published yet is reserved, not payable (unless the school's
    //    setting says so): it is named apart, so the amount shown is the amount "Pay now" takes.
    //    A line whose payment is under way (F8-08) is not paid again: a transfer the finance office is
    //    checking is said apart ("being checked by the school"), a checkout the family started and did not
    //    finish has its own row to finish it, and "Pay now" takes only the lines that can still be paid.
    for (const sess of st?.sessions ?? []) {
      const owedAll = sess.lines.filter((l) => l.outstanding > 0);
      if (!owedAll.length) continue;
      const sum = (ls: typeof owedAll) => Math.round(ls.reduce((a, l) => a + l.outstanding, 0) * 100) / 100;
      const checking = owedAll.filter((l) => l.paymentInProgress?.status === 'pending_verification');
      const started = owedAll.filter((l) => l.paymentInProgress?.status === 'pending');
      if (started.length) {
        const atDesk = started.every((l) => l.paymentInProgress?.method === 'in_school');
        payRows.push({
          key: `started-${who}-${sess.id}`, tone: 'warning',
          body: (
            <span>
              <bdi>{sess.name}</bdi><span>:</span> <Money amount={sum(started)} />{' '}
              <span>{atDesk ? 'to pay at the finance desk, as you chose' : 'in a payment you started and have not finished'}</span>
            </span>
          ),
          action: isParent
            ? { label: 'Finish the payment', href: `/checkout?ids=${started.map((l) => l.id).join(',')}` }
            : { label: 'Ask your parent: see the statement', href: '/statement' },
        });
      }
      if (checking.length) {
        const byTransfer = checking.every((l) => l.paymentInProgress?.method === 'instapay');
        payRows.push({
          key: `checking-${who}-${sess.id}`, tone: 'info',
          body: (
            <span>
              <bdi>{sess.name}</bdi><span>:</span> <Money amount={sum(checking)} /> <span>being checked by the school</span>
              <span className="block text-xs text-muted-foreground">
                <bdi data-i18n-skip="true">{checking.map((l) => l.label).join(' · ')}</bdi><span>:</span>{' '}
                <span>{byTransfer ? 'your InstaPay transfer is with the finance office; nothing to do until it is confirmed.' : 'your payment is with the finance office; nothing to do until it is confirmed.'}</span>
              </span>
            </span>
          ),
        });
      }
      const owed = owedAll.filter((l) => !l.paymentInProgress);
      if (!owed.length) continue;
      const payable = owed.filter((l) => c.owingRegistrationIds.includes(l.id));
      const waitingFee = owed.filter((l) => !c.owingRegistrationIds.includes(l.id) && l.provisional);
      const now = owed.filter((l) => !waitingFee.includes(l));
      const due = now.map((l) => l.dueAt).filter((d): d is NonNullable<typeof d> => !!d).map(String).sort()[0] ?? null;
      const overdue = now.some((l) => l.overdueDays > 0);
      payRows.push({
        key: `pay-${who}-${sess.id}`, tone: overdue ? 'danger' : now.length ? 'warning' : 'info',
        body: now.length ? (
          <span>
            <bdi>{sess.name}</bdi><span>:</span> <Money amount={sum(now)} /> <span>to pay</span>
            {due && (overdue
              ? <> — <span className="font-medium text-red-700 dark:text-red-400"><span>overdue since</span> <Day iso={due} /></span></>
              : <> — <span><span>due by</span> <Day iso={due} /></span></>)}
            {waitingFee.length > 0 && (
              <span className="block text-xs text-muted-foreground">
                <span>Plus</span> <Money amount={sum(waitingFee)} /> <span>once the board publishes its fee.</span>
              </span>
            )}
          </span>
        ) : (
          <span>
            <bdi>{sess.name}</bdi><span>:</span> <Money amount={sum(waitingFee)} /> <span>to pay</span>
            <span className="block text-xs text-muted-foreground">Payable once the board publishes its fee.</span>
          </span>
        ),
        action: isParent && payable.length > 0
          ? { label: 'Pay now', href: `/checkout?ids=${payable.map((l) => l.id).join(',')}` }
          : { label: isParent ? 'See the statement' : 'Ask your parent: see the statement', href: '/statement' },
      });
    }
    // What is overdue first, then what is due, then what waits for the board's fee.
    const weight = (r: Row) => (r.tone === 'danger' ? 0 : r.tone === 'warning' ? 1 : 2);
    rows.push(...payRows.sort((a, b) => weight(a) - weight(b)), ...reserveRows);

    // 5. Everything reserved in an open session is paid: done, the statement shows it.
    for (const s of open) {
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

  // Coming up (a parent): the sessions that open later, said once for the family, where a child may
  // preregister — not before what is owed or open now.
  const later = mayReserve ? comingUp.filter((s) => children.some((c) => {
    const mine = statement.data?.students.find((x) => x.student.id === c.student.id)?.sessions.find((x) => x.id === s.id)?.lines.filter((l) => LIVE.includes(l.status)) ?? [];
    const verdict = verdictOf(c.student.id, s.id);
    return mine.length === 0 && (!verdict || verdict.allowed);
  })) : [];

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

      {later.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <h3 className="text-sm font-semibold text-foreground">Coming up</h3>
          <ul className="mt-1 divide-y divide-border">
            {later.map((s) => (
              <li key={`later-${s.id}`} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm text-foreground">
                <span className="flex min-w-0 items-start gap-2">
                  <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', DOT.neutral)} aria-hidden />
                  <span><bdi>{s.name}</bdi><span>:</span> <span>opens on</span> <Day iso={s.opens} /><span>; you can preregister now.</span></span>
                </span>
                <Button asChild size="sm" variant="outline"><Link href="/register">Preregister</Link></Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* F6: the rest of the family's pages, in the cycle's order — what the six quick-link cards under
          this card used to repeat of the sidebar, as one short list (on a phone the sidebar is behind
          the menu button). */}
      <nav aria-label="Everything else" className="mt-4 border-t border-border pt-3">
        <ul className="divide-y divide-border text-sm">
          {(isParent
            ? [
                { href: '/register', label: 'Reserve subjects' },
                { href: '/registrations', label: 'My Registrations' },
                { href: '/school-fee', label: 'School Fee' },
                { href: '/charges-due', label: 'Charges & Instalments' },
                { href: '/escrow', label: 'Balance', extra: escrowFree > 0 ? <><Money amount={escrowFree} /> <span>available</span></> : null },
                { href: '/links', label: 'Linked Children' },
              ]
            : [
                ...(mayReserve ? [{ href: '/register', label: 'Reserve subjects' }] : []),
                { href: '/registrations', label: 'My Registrations' },
                { href: '/pending-requests', label: 'My requests' },
                { href: '/links', label: 'Linked Parents' },
              ] as { href: string; label: string; extra?: React.ReactNode }[]
          ).map((l) => (
            <li key={l.href}>
              <Link href={l.href as never} className="flex min-h-11 items-center justify-between gap-3 py-2 text-foreground hover:text-primary">
                <span>{l.label}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">{'extra' in l && l.extra}<span aria-hidden className="rtl:rotate-180">›</span></span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  );
}
