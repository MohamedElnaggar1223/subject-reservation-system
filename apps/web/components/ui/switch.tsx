'use client';

/**
 * A switch: one setting that is on or off and takes effect at once — a session or a subject accepting
 * reservations, prices final, a grade that may reserve (COORDINATOR_REWORK.md C4, E6, D11). No switch
 * existed in the app before the coordinator's screens; it is drawn from the theme's tokens (primary
 * when on, the muted text colour when off) so it reads like the buttons beside it. A native button with
 * role="switch" and aria-checked, so a screen reader names it and says its state.
 */

import { cn } from '~/lib/utils';

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  describedBy,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Its accessible name (the visible label beside it says the same). */
  label: string;
  disabled?: boolean;
  describedBy?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors outline-none',
        'focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-muted-foreground/40',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none block size-5 rounded-full bg-background shadow-sm ring-0 transition-transform',
          checked ? 'translate-x-5 rtl:-translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  );
}
