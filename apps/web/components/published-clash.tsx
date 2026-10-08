'use client';

/**
 * A change after publishing that would put someone in two lessons at once in
 * a published timetable (F1): the API refuses it with every clash and a
 * confirmation code made from them, and the coordinator may go ahead anyway
 * with exactly those clashes — the code goes back with the confirmation, and a
 * list that has changed since is refused with the new one. The clash is then
 * recorded and listed on the Timetables screen. The Sections screen (a move
 * between sections, the roll-over) and the Teaching groups screen (a student
 * added or moved, a split, a merge, forming, a teacher changed) show the
 * refusal the same way.
 */

import { Button } from '~/components/ui/button';
import { Notice } from '~/components/ui/tone';

/** The start of the API's refusal (timetable-clash.services.ts). */
const REFUSAL = 'In the published timetable';
/** The confirmation code at the end of the refusal: " [confirm 0123456789ab]". */
const CODE = /\s*\[confirm ([0-9a-f]+)\]\s*$/;

export function isPublishedClash(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith(REFUSAL);
}

/** The refusal's sentences, without the code. */
export const clashMessage = (err: unknown) => (err instanceof Error ? err.message.replace(CODE, '') : '');

/** The code of the clashes the refusal shows: going ahead sends it back, so it covers exactly those. */
export const clashToken = (err: unknown) => (err instanceof Error ? CODE.exec(err.message)?.[1] ?? null : null);

/** What a confirmation sends: go ahead with the clashes this refusal listed. */
export const goAheadWith = (err: unknown) => ({ anyway: true as const, clashToken: clashToken(err) });

export function PublishedClashNotice({
  message, onAnyway, onCancel, pending, className,
}: { message: string; onAnyway: () => void; onCancel: () => void; pending?: boolean; className?: string }) {
  return (
    <Notice tone="warning" title="This would put someone in two lessons at once" className={className}>
      <p className="text-sm">{message}</p>
      <p className="mt-1 text-xs text-muted-foreground">Going ahead records these clashes, and only these; they are listed on the Timetables screen until a new version resolves them.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onAnyway} disabled={pending}>{pending ? 'Saving…' : 'Go ahead anyway'}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={pending}>Cancel</Button>
      </div>
    </Notice>
  );
}
