'use client';

/**
 * Shared loading / error / empty states.
 *
 * Most screens rendered a spinner and then fell through to their EMPTY
 * state when a query failed — so "the connection dropped" looked
 * identical to "there is nothing here". On the finance screens that is
 * dangerous: an officer could conclude the cash drawer balances when
 * the data simply never loaded.
 */

import { Button } from '~/components/ui/button';

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12" role="status" aria-live="polite">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

export function ErrorState({
  title = 'Could not load this',
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-8 text-center" role="alert">
      <p className="font-medium text-destructive">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        {message ?? 'Something went wrong fetching this data — it is not empty, it just did not load.'}
      </p>
      {onRetry && (
        <Button variant="outline" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-10 text-center shadow-sm">
      <p className="font-medium text-foreground">{title}</p>
      {message && <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
