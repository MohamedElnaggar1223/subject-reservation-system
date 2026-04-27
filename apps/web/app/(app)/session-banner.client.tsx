'use client';

/**
 * Session Banner (SES-005)
 *
 * Client component mounted on the home dashboard that displays the
 * currently-active registration window(s) and a live countdown timer.
 * The server has already fetched the `sessions` prop — this component
 * only handles the per-second tick + graceful transition to
 * "Registration closed" when the timer hits zero.
 */

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';

type ActiveSession = {
  id: string;
  name: string;
  sessionType: string;
  endDate: string;
};

type Remaining = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  total: number;
};

function computeRemaining(endDate: string): Remaining {
  const end = new Date(endDate).getTime();
  const now = Date.now();
  const total = Math.max(0, end - now);
  const days = Math.floor(total / 86_400_000);
  const hours = Math.floor((total % 86_400_000) / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  return { days, hours, minutes, seconds, total };
}

function Countdown({ endDate }: { endDate: string }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // `tick` drives recomputation; useMemo keeps formatting cheap
  const remaining = useMemo(() => computeRemaining(endDate), [endDate, tick]);

  if (remaining.total === 0) {
    return (
      <span className="text-sm font-semibold text-destructive">
        Registration window has closed
      </span>
    );
  }

  const pad = (n: number) => String(n).padStart(2, '0');
  const primary = remaining.days > 0
    ? `${remaining.days}d ${pad(remaining.hours)}h ${pad(remaining.minutes)}m`
    : `${pad(remaining.hours)}:${pad(remaining.minutes)}:${pad(remaining.seconds)}`;

  const urgent = remaining.total <= 24 * 3_600_000;

  return (
    <span className={`font-mono text-base font-semibold tabular-nums ${
      urgent ? 'text-amber-700 dark:text-amber-400' : 'text-brand-700 dark:text-brand-300'
    }`}>
      {primary}
    </span>
  );
}

export default function SessionBanner({ sessions }: { sessions: ActiveSession[] }) {
  if (sessions.length === 0) {
    return (
      <div className="animate-fade-up mb-6 rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">No active registration window</p>
            <p className="text-xs text-muted-foreground">You'll be notified by email when the next window opens.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-up mb-6 space-y-3">
      {sessions.map((s) => (
        <Link
          key={s.id}
          href={'/register' as never}
          className="block rounded-xl border border-brand-200 bg-brand-50/60 dark:bg-brand-900/10 dark:border-brand-700 p-5 transition hover:border-brand-400 hover:shadow-md"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-100 dark:bg-brand-800/40 text-brand-700 dark:text-brand-200">
                <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Registration open — {s.name}
                </p>
                <p className="text-xs text-muted-foreground capitalize">
                  {s.sessionType} session · closes {new Date(s.endDate).toLocaleString('en-GB', {
                    day: '2-digit', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Closing in
              </p>
              <Countdown endDate={s.endDate} />
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
