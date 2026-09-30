'use client';

/**
 * A change after publishing that would put someone in two lessons at once in
 * a published timetable (F1): the API refuses it with the clashes, and the
 * coordinator may go ahead anyway — the clash is then recorded and listed on
 * the Timetables screen. The Sections screen (a move between sections) and
 * the Teaching groups screen (a student added, a split, a merge, forming, a
 * teacher changed) show the refusal the same way.
 */

import { Button } from '~/components/ui/button';
import { Notice } from '~/components/ui/tone';

/** The start of the API's refusal (timetable-clash.services.ts). */
const REFUSAL = 'In the published timetable';

export function isPublishedClash(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith(REFUSAL);
}

/** The refusal's sentence. */
export const clashMessage = (err: unknown) => (err instanceof Error ? err.message : '');

export function PublishedClashNotice({
  message, onAnyway, onCancel, pending, className,
}: { message: string; onAnyway: () => void; onCancel: () => void; pending?: boolean; className?: string }) {
  return (
    <Notice tone="warning" title="This would put someone in two lessons at once" className={className}>
      <p className="text-sm">{message}</p>
      <p className="mt-1 text-xs text-muted-foreground">Going ahead records the clash; it is listed on the Timetables screen until a new version resolves it.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onAnyway} disabled={pending}>{pending ? 'Saving…' : 'Go ahead anyway'}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={pending}>Cancel</Button>
      </div>
    </Notice>
  );
}
