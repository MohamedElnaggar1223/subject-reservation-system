/**
 * Status tones — the badge and notice colours the screens already use
 * (sessions, desk, subjects, exceptions), in one place so new screens take
 * the same ones instead of inventing a palette: emerald for done or
 * allowed, amber for attention, red for refused or ended, violet for
 * information, muted for neutral.
 */

import { cn } from '~/lib/utils';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export const TONE_CLASSES: Record<Tone, string> = {
  success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  warning: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  danger: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  info: 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  neutral: 'bg-muted text-muted-foreground',
};

const NOTICE_BORDER: Record<Tone, string> = {
  success: 'border-emerald-200 dark:border-emerald-800',
  warning: 'border-amber-200 dark:border-amber-700',
  danger: 'border-red-200 dark:border-red-800',
  info: 'border-violet-200 dark:border-violet-700',
  neutral: 'border-border',
};

export function Badge({ tone = 'neutral', className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', TONE_CLASSES[tone], className)}>
      {children}
    </span>
  );
}

/** A block message: what happened or what to do next. `role` makes errors announce themselves. */
export function Notice({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('rounded-xl border p-4 text-sm', TONE_CLASSES[tone], NOTICE_BORDER[tone], className)}
    >
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cn(title && 'mt-1')}>{children}</div>}
    </div>
  );
}

/** Where a student stands today, as a badge. */
export function StandingBadge({ standing }: { standing: string }) {
  const map: Record<string, { tone: Tone; label: string }> = {
    in_school: { tone: 'success', label: 'At school' },
    upcoming: { tone: 'info', label: 'Starts next year' },
    graduated: { tone: 'neutral', label: 'Graduated' },
    withdrawn: { tone: 'danger', label: 'Withdrawn' },
    transferred: { tone: 'danger', label: 'Transferred' },
    unknown: { tone: 'warning', label: 'Grade not recorded' },
  };
  const m = map[standing] ?? { tone: 'neutral' as Tone, label: standing };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}
