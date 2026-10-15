'use client';

/**
 * What happened to the student's class after a teacher change, in one sentence each
 * (lib/groups-followed.ts; docs/features/CYCLE_FOLLOWUPS.md §2): the desk's teacher change and the
 * Session screen's Replace a teacher. A refusal carries the API's reason beside it (the clash in the
 * published timetable), each text translated on its own.
 */

import { Notice } from '~/components/ui/tone';
import type { FollowSentence } from '~/lib/groups-followed';

export function ClassFollowNotice({ sentences }: { sentences: FollowSentence[] }) {
  if (!sentences.length) return null;
  return (
    <Notice tone={sentences.some((s) => s.tone === 'warning') ? 'warning' : 'success'}>
      <ul className="space-y-1">
        {sentences.map((s) => (
          <li key={`${s.text}|${s.reason ?? ''}`}>
            <span>{s.text}</span>
            {s.reason ? <> <span>{s.reason}</span></> : null}
          </li>
        ))}
      </ul>
    </Notice>
  );
}
