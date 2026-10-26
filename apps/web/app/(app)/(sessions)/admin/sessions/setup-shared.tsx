'use client';

/**
 * Shared by the coordinator's screens (COORDINATOR_REWORK.md §5; P2): Sessions, the Session with its
 * check list and tabs, the subject editor and her Home. The fetchers are typed by the API through the
 * RPC client, never by hand (CLAUDE.md, PATTERNS.md); the impact pattern (A3) every save that touches
 * families goes through; the school's dates as a date picker reads them (Cairo).
 *
 * Her words: none of award, suite, series, sitting, component, mapping, option code (§13 P2). An API
 * refusal that carries one is put in her words by `herWords` (lib/i18n-setup.ts) before it is shown.
 */

import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import {
  apiResponse, schoolDateString, impactSentence, IMPACT_CHANGED_REFUSAL, type ImpactType,
} from '@repo/validations';
import { Button } from '~/components/ui/button';
import type { Tone } from '~/components/ui/tone';
import { herWords } from '~/lib/i18n-setup';
import { Modal, errorText } from './sessions-shared';

// ─── Fetchers (Appendix A) ───────────────────────────────────────────────────

export const fetchSetupSession = (id: string) => apiResponse(api.v1.sessions[':id'].$get({ param: { id } }));
export type SetupSession = Awaited<ReturnType<typeof fetchSetupSession>>;
export type Offering = SetupSession['offerings'][number];
export type OfferingRow = Offering['rows'][number];
export type CheckItem = SetupSession['checkList'][number];

export const fetchOffering = (id: string, offeringId: string) =>
  apiResponse(api.v1.sessions[':id'].offerings[':offeringId'].$get({ param: { id, offeringId } }));

export const fetchPrices = (id: string) => apiResponse(api.v1.sessions[':id'].prices.$get({ param: { id } }));
export type PricesData = Awaited<ReturnType<typeof fetchPrices>>;

export const fetchFamilyPreview = (id: string, as: 'first_timer' | 'retaker', offeringId: string) =>
  apiResponse(api.v1.sessions[':id'].preview.$get({ param: { id }, query: { as, offeringId } }));
export type FamilyPreview = Awaited<ReturnType<typeof fetchFamilyPreview>>;

export const fetchReservations = (id: string) => apiResponse(api.v1.sessions[':id'].reservations.$get({ param: { id }, query: { format: 'json' } }));

export const fetchReferenceSubjects = () => apiResponse(api.v1.reference.subjects.$get({ query: {} }));
export type ReferenceSubject = Awaited<ReturnType<typeof fetchReferenceSubjects>>[number];
export const fetchReferenceBoards = () => apiResponse(api.v1.reference.boards.$get());
export type ReferenceBoard = Awaited<ReturnType<typeof fetchReferenceBoards>>[number];

export const fetchTeachers = () => apiResponse(api.v1.teachers.$get({ query: { isActive: 'true' } }));
export type SchoolTeacher = Awaited<ReturnType<typeof fetchTeachers>>[number];

export const setupKey = (id: string) => ['sessions', id] as const;
export const offeringKey = (id: string, offeringId: string) => ['sessions', id, 'offering', offeringId] as const;
export const pricesKey = (id: string) => ['sessions', id, 'prices'] as const;
export const previewKey = (id: string, offeringId: string, as: string) => ['sessions', id, 'preview', offeringId, as] as const;
export const reservationsKey = (id: string) => ['sessions', id, 'reservations'] as const;
export const REFERENCE_SUBJECTS_KEY = ['reference', 'subjects'] as const;
export const REFERENCE_BOARDS_KEY = ['reference', 'boards'] as const;
export const TEACHERS_KEY = ['teachers', 'active'] as const;

// ─── Words ───────────────────────────────────────────────────────────────────

/** A subject as she names it on her links sheet: "Arabic O.L.", "Biology A.S./A.L." (two subjects share a name). */
export const subjectTitle = (o: { subject: { name: string }; group: string }) => `${o.subject.name} ${o.group}`;

/** The four columns of D3, in the grid's order. */
export const CELLS = ['firstInSchool', 'retakeInSchool', 'retakeSelfStudy', 'firstSelfStudy'] as const;
export type CellKey = (typeof CELLS)[number];
export const CELL_WORDS: Record<CellKey, string> = {
  firstInSchool: 'First entry in school',
  retakeInSchool: 'Retake in school',
  retakeSelfStudy: 'Retake self study',
  firstSelfStudy: 'First entry self study',
};
export const CELL_SHORT: Record<CellKey, string> = {
  firstInSchool: 'first entry in school',
  retakeInSchool: 'retake in school',
  retakeSelfStudy: 'retake self study',
  firstSelfStudy: 'first entry self study',
};

/** A session's status as families meet it (C4), and its badge's tone. */
export const STATUS_TONE: Record<string, Tone> = { active: 'success', draft: 'neutral', closed: 'danger' };
export const STATUS_WORDS: Record<string, string> = {
  active: 'Accepting reservations',
  draft: 'Draft — families cannot see it',
  closed: 'Closed',
};

const MONTH_WORDS: Record<string, string> = { january: 'January', june: 'June', october: 'November', november: 'November' };
/**
 * An exam month as she says it: "June 2026", "November 2025". Pearson's October International A Level exams
 * are the school's "November" (D12).
 */
export const examMonth = (month: string, year: number) => `${MONTH_WORDS[month] ?? month} ${year}`;
const MONTH_INDEX: Record<string, number> = { january: 1, june: 6, october: 10, november: 11 };
export const monthIndex = (month: string, year: number) => year * 12 + (MONTH_INDEX[month] ?? 0);

/** An error's sentence in her words. */
export const refusalText = (err: unknown) => herWords(errorText(err));

// ─── Dates (Cairo) ───────────────────────────────────────────────────────────

/** The school day an instant falls on, as a date picker's value ('YYYY-MM-DD'). */
export const pickerValue = (iso: string | null | undefined) => (iso ? schoolDateString(new Date(iso)) : '');

/**
 * A picked day as the instant it means — the end of that day in Cairo (UTC+2, or +3 in summer: 20:59 UTC
 * is inside the day in both), as the API stores the reference data's dates and a session's defaults.
 */
export const endOfSchoolDay = (day: string) => `${day}T20:59:00.000Z`;

// ─── A select that acts ──────────────────────────────────────────────────────

const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

/**
 * A select whose choice does something at once (adds a teacher, an earlier exam; saves the share). Picked
 * with the mouse it acts on the pick; walked with the arrow keys (a closed select changes its value on each
 * key in some browsers) it waits for Enter or for her to leave the field, so a key press is never a save.
 * `value` '' with `reset` makes it a pick-to-add list that goes back to its prompt.
 */
export function CommitSelect({ value, onCommit, reset, children, ...props }: Omit<React.ComponentProps<'select'>, 'onChange' | 'value' | 'onKeyDown' | 'onBlur'> & {
  value: string;
  onCommit: (value: string) => void;
  reset?: boolean;
}) {
  const walking = useRef(false);
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  const commit = (v: string) => {
    walking.current = false;
    if (v !== value && v !== '') onCommit(v);
    setLocal(reset ? '' : v);
  };
  return (
    <select
      {...props}
      value={local}
      onKeyDown={(e) => {
        if (ARROWS.has(e.key)) walking.current = true;
        if (e.key === 'Enter') { e.preventDefault(); commit(e.currentTarget.value); }
      }}
      onChange={(e) => { if (walking.current) setLocal(e.target.value); else commit(e.target.value); }}
      onBlur={(e) => { if (walking.current) commit(e.currentTarget.value); }}
    >
      {children}
    </select>
  );
}

// ─── The impact pattern (A3, §6) ─────────────────────────────────────────────

/**
 * A save that touches families answers `{ saved: false, impact }` until the same counts come back as
 * `expected`; counts that moved meanwhile answer 409 IMPACT_CHANGED, and the new counts are asked for
 * again. `send` is the route's call (typed by the RPC client); `onSaved` runs once it is saved.
 */
export function useImpactSave<V, R extends { saved: boolean; impact: ImpactType }>(
  send: (vars: V, expected?: ImpactType) => Promise<R>,
  onSaved: (res: R, vars: V) => unknown,
  // Not saved after all (she cancelled what it would do): a field showing the new value puts the saved one back.
  onCancel?: () => void,
) {
  const [asking, setAsking] = useState<{ vars: V; impact: ImpactType; changed: boolean } | null>(null);
  const m = useMutation({
    mutationFn: async ({ vars, expected }: { vars: V; expected?: ImpactType }) => {
      try {
        return { vars, res: await send(vars, expected), changed: false };
      } catch (err) {
        // The counts moved while she was looking: ask again with the new ones.
        if (!expected || errorText(err) !== IMPACT_CHANGED_REFUSAL) throw err;
        return { vars, res: await send(vars), changed: true };
      }
    },
    onSuccess: async ({ vars, res, changed }) => {
      if (!res.saved) {
        setAsking({ vars, impact: res.impact, changed });
        return;
      }
      setAsking(null);
      await onSaved(res, vars);
    },
  });
  return {
    save: (vars: V) => m.mutate({ vars }),
    confirm: () => { if (asking) m.mutate({ vars: asking.vars, expected: asking.impact }); },
    cancel: () => { setAsking(null); m.reset(); onCancel?.(); },
    asking,
    isPending: m.isPending,
    error: m.error ? refusalText(m.error) : null,
    reset: () => m.reset(),
  };
}

type ImpactAsk = {
  asking: { impact: ImpactType; changed: boolean } | null;
  confirm: () => void;
  cancel: () => void;
  isPending: boolean;
  error: string | null;
};

/** What a change does to families, said before it is saved, with one button that saves it. */
export function ImpactDialog({ save }: { save: ImpactAsk }) {
  if (!save.asking) return null;
  return (
    <Modal title={save.asking.changed ? 'The counts changed while you were looking' : 'Before this is saved'} onClose={save.cancel}>
      <div className="space-y-4">
        <p className="text-sm text-foreground">{impactSentence(save.asking.impact)}</p>
        {save.error && <p role="alert" className="text-sm text-destructive">{save.error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={save.cancel}>Cancel</Button>
          <Button type="button" onClick={save.confirm} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save it'}</Button>
        </div>
      </div>
    </Modal>
  );
}
