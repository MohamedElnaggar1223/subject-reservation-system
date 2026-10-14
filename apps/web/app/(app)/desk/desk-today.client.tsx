'use client';

/**
 * F6b — finance's landing is the desk; this is its first line (FEATURES_PLAN.md §1 F6b, point 2):
 * today's money in front of the officer before the first family arrives — what came in today, what
 * falls due today, what is overdue — each opening the screen that deals with it (daily takings, the
 * session's Money tab with Remind, Charges).
 *
 * The spreadsheet version: filter the response sheet by the fee column and today's date, then add
 * up the cash book. Here it is read for them on opening the desk.
 *
 * Existing endpoints only: GET /v1/payments/daily-takings?date= (today, the browser's day as the
 * Daily Takings page reads it), GET /v1/sessions (each session's unpaid lines), GET
 * /v1/sessions/:id/money?filter=unpaid (their due dates) for every session with unpaid lines, and
 * GET /v1/charges?status=pending_payment (instalments and other charges owed).
 */

import Link from 'next/link';
import { useQueries, useQuery } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, schoolDateString } from '@repo/validations';
import { Money } from '~/app/(app)/(sessions)/admin/sessions/sessions-shared';
import { DateText } from '~/app/(app)/academic/calendar/academic-shared';

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fetchTakings = (date: string) => apiResponse(api.v1.payments['daily-takings'].$get({ query: { date } }));
const fetchSessions = () => apiResponse(api.v1.sessions.$get({ query: {} }));
const fetchUnpaid = (id: string) => apiResponse(api.v1.sessions[':id'].money.$get({ param: { id }, query: { filter: 'unpaid' } }));
const fetchCharges = () => apiResponse(api.v1.charges.$get({ query: { status: 'pending_payment' } }));

const round2 = (n: number) => Math.round(n * 100) / 100;

export default function DeskToday(): React.JSX.Element | null {
  const date = todayStr();
  const takings = useQuery({ queryKey: ['finance', 'takings', date], queryFn: () => fetchTakings(date) });
  const sessions = useQuery({ queryKey: ['sessions', 'admin'], queryFn: fetchSessions });
  const owing = (sessions.data ?? []).filter((s) => s.summary.unpaid > 0);
  const money = useQueries({
    queries: owing.map((s) => ({ queryKey: ['sessions', s.id, 'money', 'unpaid'], queryFn: () => fetchUnpaid(s.id) })),
  });
  const charges = useQuery({ queryKey: ['charges', 'pending_payment', 'desk-today'], queryFn: fetchCharges });

  // The school's day (Cairo) decides what is due today, as the Money tab's due dates read.
  const today = schoolDateString(new Date());
  const isToday = (iso: string | Date | null | undefined) => !!iso && schoolDateString(new Date(iso)) === today;
  const isPast = (iso: string | Date | null | undefined) => !!iso && schoolDateString(new Date(iso)) < today;

  const perSession = owing.map((s, i) => {
    const lines = money[i]?.data?.lines ?? [];
    const dueToday = lines.filter((l) => l.unpaid && isToday(l.dueAt));
    const overdue = lines.filter((l) => l.unpaid && l.overdueDays > 0);
    return {
      s,
      loaded: !!money[i]?.data,
      dueToday: { n: dueToday.length, amount: round2(dueToday.reduce((a, l) => a + l.outstanding, 0)), families: new Set(dueToday.map((l) => l.student.id)).size },
      overdue: { n: overdue.length, amount: round2(overdue.reduce((a, l) => a + l.outstanding, 0)), families: new Set(overdue.map((l) => l.student.id)).size },
    };
  });
  const chargeRows = charges.data ?? [];
  const chargesToday = chargeRows.filter((c) => isToday(c.dueAt));
  const chargesOverdue = chargeRows.filter((c) => isPast(c.dueAt));

  const collected = takings.data?.totals.moneyIn ?? 0;
  const payments = (takings.data?.rows.length ?? 0) + (takings.data?.lateTransfers.length ?? 0);
  const dueTodayAmount = round2(perSession.reduce((a, p) => a + p.dueToday.amount, 0) + chargesToday.reduce((a, c) => a + c.outstanding, 0));
  const dueTodayCount = perSession.reduce((a, p) => a + p.dueToday.n, 0) + chargesToday.length;
  const overdueAmount = round2(perSession.reduce((a, p) => a + p.overdue.amount, 0) + chargesOverdue.reduce((a, c) => a + c.outstanding, 0));
  const overdueCount = perSession.reduce((a, p) => a + p.overdue.n, 0) + chargesOverdue.length;
  // What falls due next after today, so a quiet day still says what is coming.
  const ahead = [
    ...owing.flatMap((_, i) => (money[i]?.data?.lines ?? []).filter((l) => l.unpaid).map((l) => ({ due: l.dueAt, amount: l.outstanding }))),
    ...chargeRows.map((c) => ({ due: c.dueAt, amount: c.outstanding })),
  ].filter((x) => x.due && schoolDateString(new Date(x.due)) > today);
  const nextDay = ahead.map((x) => schoolDateString(new Date(x.due!))).sort()[0] ?? null;
  const nextAmount = nextDay ? round2(ahead.filter((x) => schoolDateString(new Date(x.due!)) === nextDay).reduce((a, x) => a + x.amount, 0)) : 0;
  const moneyTab = perSession.length === 1 ? `/admin/sessions/${perSession[0]!.s.id}#money` : '/charges';
  const loading =takings.isLoading || sessions.isLoading || charges.isLoading || money.some((m) => m.isLoading);

  return (
    <section className="mb-6 rounded-xl border border-border bg-card p-4 shadow-sm" aria-label="Today at the desk">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Today</span> · <DateText date={today} />
        </h2>
        {loading && <span className="text-xs text-muted-foreground">Reading today…</span>}
        {(takings.isError || sessions.isError || charges.isError || money.some((m) => m.isError)) && (
          <span className="text-xs text-destructive">Part of today could not be read.</span>
        )}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Tile href="/takings" label="Collected today" amount={collected}
          detail={<><span>{payments}</span> <span>{payments === 1 ? 'payment' : 'payments'}</span></>} cta="Daily takings" />
        <Tile href={moneyTab} label="Due today" amount={dueTodayAmount}
          detail={
            <>
              <span>{dueTodayCount}</span> <span>{dueTodayCount === 1 ? 'item due today' : 'items due today'}</span>
              {nextDay && <span className="block"><span>Next due</span> <DateText date={nextDay} /><span>:</span> <Money amount={nextAmount} /></span>}
            </>
          }
          cta={perSession.length === 1 ? 'Open the Money tab' : 'Charges'} tone={dueTodayCount ? 'warning' : 'neutral'} />
        <Tile href={moneyTab} label="Overdue" amount={overdueAmount}
          detail={<><span>{overdueCount}</span> <span>{overdueCount === 1 ? 'item past its due date' : 'items past their due date'}</span></>}
          cta={perSession.length === 1 ? (overdueCount ? 'Remind them' : 'Open the Money tab') : 'Charges'} tone={overdueCount ? 'danger' : 'neutral'} />
      </div>
      {perSession.length > 1 && (
        <ul className="mt-3 space-y-1 text-sm">
          {perSession.map((p) => (
            <li key={p.s.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <bdi>{p.s.name}</bdi><span>:</span>{' '}
                <span>{p.dueToday.n}</span> <span>due today</span> · <span>{p.overdue.n}</span> <span>overdue</span>
              </span>
              <Link href={`/admin/sessions/${p.s.id}#money` as never} className="text-xs font-semibold text-primary underline-offset-4 hover:underline">Open the Money tab</Link>
            </li>
          ))}
        </ul>
      )}
      {chargesOverdue.length + chargesToday.length > 0 && perSession.length <= 1 && (
        <p className="mt-2 text-xs text-muted-foreground">
          <span>Charges and instalments included:</span> <span>{chargesToday.length}</span> <span>due today</span> · <span>{chargesOverdue.length}</span> <span>overdue</span> —{' '}
          <Link href="/charges" className="font-semibold text-primary underline-offset-4 hover:underline">Charges</Link>
        </p>
      )}
    </section>
  );
}

const TILE_TONE = {
  neutral: 'border-border',
  warning: 'border-amber-200 dark:border-amber-700',
  danger: 'border-red-200 dark:border-red-800',
} as const;

function Tile({ href, label, amount, detail, cta, tone = 'neutral' }: {
  href: string; label: string; amount: number; detail: React.ReactNode; cta: string; tone?: keyof typeof TILE_TONE;
}) {
  return (
    <Link href={href as never} className={`group block rounded-lg border bg-background p-3 transition-colors hover:bg-muted/50 ${TILE_TONE[tone]}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-xl font-bold text-foreground"><Money amount={amount} /></p>
      <p className="text-xs text-muted-foreground">{detail}</p>
      <p className="mt-1 text-xs font-semibold text-primary group-hover:underline">{cta}</p>
    </Link>
  );
}
