/**
 * The rules on a line — v2, the coordinator rework (COORDINATOR_REWORK.md §6 "May reserve", D3, D6–D8, F2;
 * §9.2's line-rules row).
 *
 * `assertLineRules` is asked by every path that puts a line into a row — the reservation paths through
 * insertLines, the day-one import, a move (`recheck`) — inside its transaction, after the student lock
 * (assertMayRegisterForInTx, which judges the session's grade list, D11). For a new line:
 *
 *   - may reserve (window.services mayReserveRow): the session open, the subject accepting and not past its
 *     close, the row not past its close — or a G4 later reserve date — and never past its board deadline;
 *     a date refusal names the policy key G4's exception lifts (`deadline.reserve`);
 *   - the option's cell ticked on the row (D3): what the row offers is the cells, nothing else (no exception, G4),
 *     save a first entry in self study, which the student's exception "self-study on a first entry" still lets
 *     through (decision 1 of 16 Oct 2026); a one-paper row is a retake (its cells never offer a first entry);
 *   - F2: a student the system knows has sat the subject reserves a retake, not a first entry;
 *   - the earlier exam a row carries from (D6): where the row asks it (an A.2., a one-paper retake where the board
 *     asks), it is named and is one of her list for the row; her list wins over the board's carry-forward months
 *     (an older exam is a warning on her screen, never a refusal here); elsewhere a retake may name none;
 *   - D8: one line per exclusive group of a subject in the session (all papers and the one-paper rows, A.S./A.2./A.L.,
 *     the qualifications), units freely;
 *   - the same entry once (`gate.sameEntryOnce`, kept on): one live line per (row code, sitting) for the student.
 *
 * Required items, today's availability and the grade-10 core left with the old model. Each gate is a policy
 * with a key; before refusing it asks the exception adapter for an active exception of that key covering the
 * line (one-shot gates are locked FOR UPDATE and returned to be marked used in the same transaction).
 */

import { db, sql } from '@repo/db';
import { type Eligibility, type LinePolicyKey } from '@repo/validations';
import { lineExceptions, type ExceptionScope } from './line-exceptions';
import { schoolMonthIndex } from './series.services';
import { mayReserveRow } from './window.services';
import { studentRecordOf, knownSittingOf, type StudentRecord } from './known-sittings.services';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class LineRuleError extends Error {
  /** `policyKey`: the exception that could lift it, or null for a rule nothing lifts. */
  constructor(message: string, public readonly policyKey: LinePolicyKey | null, public readonly status: 400 | 409 = 400) {
    super(message);
  }
}

export type RuleLine = {
  offerItemId: string;
  attempt: 'first' | 'retake';
  mode: 'in_school' | 'self_study';
  priorSittingSeriesId: string | null;
  priorSittingSource?: string | null;
};

type ItemRow = {
  id: string; offer_id: string; session_id: string; label: string; kind: string; enters_kind: string;
  qualification_id: string | null; board_series_id: string | null; needs_prior_series: boolean; exclusive_group: string | null;
  first_in_school: boolean; retake_in_school: boolean; retake_self_study: boolean; first_self_study: boolean;
  allowed_prior_series_ids: string[]; subject_id: string; subject_name: string; subject_qualification_id: string | null;
  board_code: string | null; month: string | null; year: number | null; series_label: string | null; board_name: string | null;
  reference_codes: string[];
};

async function loadItems(tx: Tx, ids: string[]): Promise<Map<string, ItemRow & { units: string[] }>> {
  if (!ids.length) return new Map();
  const r = await tx.execute(sql`
    select i.id, i.offer_id, i.session_id, i.label, i.kind, i.enters_kind, i.qualification_id, i.board_series_id,
      i.needs_prior_series, i.exclusive_group, i.reference_codes, i.first_in_school, i.retake_in_school, i.retake_self_study,
      i.first_self_study, i.allowed_prior_series_ids, o.subject_id, s.name as subject_name, s.qualification_id as subject_qualification_id,
      bs.board_code, bs.month, bs.year, bs.label as series_label, b.name as board_name,
      coalesce((select array_agg(u.unit_id order by u.unit_id) from session_offer_item_unit u where u.item_id = i.id), '{}') as units
    from session_offer_item i
    join session_offer o on o.id = i.offer_id
    join subject s on s.id = o.subject_id
    left join board_series bs on bs.id = i.board_series_id
    left join exam_board b on b.code = bs.board_code
    where i.id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
  return new Map((r.rows as (ItemRow & { units: string[] })[]).map((x) => [x.id, { ...x, year: x.year === null ? null : Number(x.year) }]));
}

/**
 * What an item enters, as keys two lines collide on: an award (q:), a unit (u:), an unmapped row (s:).
 * A row the coordinator's set-up made enters no catalogue award or unit: its keys are its codes
 * (c:, scoped to its subject) — "the same row code once per sitting" (COORDINATOR_REWORK.md §9.2) — so two
 * units of one subject (P1, P2) are two entries, not one.
 */
function entryKeys(i: { enters_kind: string; qualification_id: string | null; subject_id: string; units: string[]; reference_codes?: string[] | null }) {
  if (i.enters_kind === 'subject' && i.reference_codes?.length) return i.reference_codes.map((c) => `c:${i.subject_id}:${c}`);
  if (i.enters_kind === 'award' || i.enters_kind === 'option') return i.qualification_id ? [`q:${i.qualification_id}`] : [`s:${i.subject_id}`];
  if (i.enters_kind === 'units') return i.units.map((u) => `u:${u}`);
  return [`s:${i.subject_id}`];
}

const seriesName = (i: ItemRow) => (i.board_name && i.month ? `${i.board_name} ${i.month.charAt(0).toUpperCase()}${i.month.slice(1)} ${i.year}${i.series_label ? ` (${i.series_label})` : ''}` : 'its series');
const nameOf = (i: { kind: string; subject_name: string; label: string }) => (i.kind === 'all_papers' ? i.subject_name : `${i.subject_name} — ${i.label}`);
const sittingWords = (month: string, year: number) => `${month.charAt(0).toUpperCase()}${month.slice(1)} ${year}`;

/** The cell (D3) an option is: how it is studied, first entry or retake. */
export function cellOf(attempt: 'first' | 'retake', mode: 'in_school' | 'self_study') {
  return attempt === 'first'
    ? (mode === 'in_school' ? 'first_in_school' as const : 'first_self_study' as const)
    : (mode === 'in_school' ? 'retake_in_school' as const : 'retake_self_study' as const);
}
const OPTION_WORDS = { first_in_school: 'a first entry in school', first_self_study: 'a first entry in self study', retake_in_school: 'a retake in school', retake_self_study: 'a retake in self study' } as const;

/**
 * Check the lines a path is about to create for one student in one session, against each other
 * and the student's live lines (every session). Returns the one-shot exceptions it used.
 */
export async function assertLineRules(
  tx: Tx,
  ctx: { studentId: string; sessionId: string; eligibility: Pick<Eligibility, 'grade' | 'series'> },
  lines: RuleLine[],
  opts: {
    /**
     * Lines already made that these are (a move or a capture checks them again where they now
     * are): left out of the student's live lines, so a line does not collide with itself.
     */
    excludeLineIds?: string[];
    /**
     * Check again only what a move can change — the same entry once in the sitting, and an earlier exam of
     * its own board before it. What governs a new line (may reserve, the cells, F2, her list, D8) was asked
     * when it was made.
     */
    recheck?: boolean;
    /**
     * False: read the gate exceptions without locking them — a check that is rolled back and makes
     * nothing (the day-one import's review, a GET) must not hold exception rows FOR UPDATE. Every
     * path that makes a line leaves it true (one-shot gates are locked and marked used).
     */
    lockExceptions?: boolean;
    /** The moment the lines are made (insertLines' `now`). */
    now?: Date;
  } = {},
): Promise<{ usedExceptionIds: string[] }> {
  const used: string[] = [];
  const recheck = !!opts.recheck;
  const now = opts.now ?? new Date();
  const excluded = new Set(opts.excludeLineIds ?? []);
  const items = await loadItems(tx, [...new Set(lines.map((l) => l.offerItemId))]);
  for (const l of lines) {
    const it = items.get(l.offerItemId);
    if (!it || it.session_id !== ctx.sessionId) throw new LineRuleError('That item is not on offer in this session', null);
  }
  /** Refuse unless an exception of `key` covers the line; a one-shot one is used. */
  const gate = async (key: LinePolicyKey, scope: ExceptionScope, message: string, status: 400 | 409 = 400) => {
    const exc = await lineExceptions.active(tx, ctx.studentId, [key], scope, opts.lockExceptions === false ? undefined : { lock: 'update' });
    const e = exc.find((x) => !used.includes(x.id));
    if (!e) throw new LineRuleError(message, key, status);
    if (e.oneShot) used.push(e.id);
  };
  const scopeOf = (it: ItemRow) => ({ sessionId: ctx.sessionId, subjectId: it.subject_id, offerId: it.offer_id, offerItemId: it.id, ...(it.board_series_id ? { boardSeriesId: it.board_series_id } : {}) });
  let record: StudentRecord | null = null;

  for (const l of lines) {
    const it = items.get(l.offerItemId)!;
    const name = nameOf(it);
    if (!recheck) {
      // May reserve (§6): her dates (or a G4 later reserve date), never the board's deadline.
      const may = await mayReserveRow(tx, { studentId: ctx.studentId, offerItemId: it.id, attempt: l.attempt, priorSittingSeriesId: l.priorSittingSeriesId }, now);
      if (!may.allowed) throw new LineRuleError(may.message, may.code === 'NOT_ACCEPTING' ? 'deadline.reserve' : null, may.code === 'NOT_FOUND' ? 400 : 409);
      // The cells (D3): what the row offers.
      const cell = cellOf(l.attempt, l.mode);
      if (!it[cell]) {
        const offersAny = it.first_in_school || it.retake_in_school || it.retake_self_study || it.first_self_study;
        if (it.kind === 'paper' && l.attempt === 'first') {
          // "One paper ONLY" is always a retake (F6a; the database refuses a first-entry cell on it).
          throw new LineRuleError(`${name} is a retake of one paper: it takes no first entry`, null);
        }
        if (cell === 'first_self_study' && offersAny) {
          // Decision 1 of 16 Oct 2026 ("Self Study … ONLY 2nd entry"): a first entry in self study where her
          // cells do not offer one is the student's exception, used once.
          await gate('gate.selfStudyFirstEntry', scopeOf(it), it.first_in_school
            ? 'Subjects can only be taken outside school when retaking or when the school does not offer them'
            : `${name} is self study on a second entry only: name the earlier sitting, or ask for the exception`);
        } else {
          throw new LineRuleError(offersAny ? `${name} is not offered as ${OPTION_WORDS[cell]}` : `${name} is not offered in this session`, null);
        }
      }
      // F2: a student known to have sat the subject reserves a retake.
      if (l.attempt === 'first') {
        record ??= await studentRecordOf(tx, ctx.studentId, ctx.sessionId);
        const known = knownSittingOf(record, { subjectId: it.subject_id, subjectQualificationId: it.subject_qualification_id, referenceCodes: it.reference_codes, month: it.month, year: it.year });
        if (known && !it.needs_prior_series) {
          throw new LineRuleError(`${name} was sat before (${sittingWords(known.month, known.year)}): reserve it as a retake`, null, 409);
        }
      }
    }
    // A retake names the sitting it follows (kept from v1; a legacy line's history is its sitting).
    if (!recheck && l.attempt === 'retake' && !l.priorSittingSeriesId && l.priorSittingSource !== 'legacy') {
      throw new LineRuleError(`A retake of ${name} names the sitting it follows`, 'gate.retakeDeclared');
    }
    // The earlier exam it carries from (D6).
    if (!l.priorSittingSeriesId) {
      if (it.needs_prior_series && !recheck) {
        await gate('gate.priorSeries', scopeOf(it), `${name} carries an earlier exam forward: name the one it is carried from`);
      }
      continue;
    }
    const p = await tx.execute(sql`select bs.board_code, bs.month, bs.year from board_series bs where bs.id = ${l.priorSittingSeriesId}`);
    const prior = p.rows[0] as { board_code: string; month: string; year: number } | undefined;
    if (!prior) throw new LineRuleError('The earlier exam named was not found', 'gate.priorSeries');
    const priorName = sittingWords(prior.month, Number(prior.year));
    if (!recheck && it.needs_prior_series && it.allowed_prior_series_ids.length) {
      // Her list for the row (D6): it wins over the board's carry-forward months either way.
      if (!it.allowed_prior_series_ids.includes(l.priorSittingSeriesId)) {
        await gate('gate.priorSeries', scopeOf(it), `${priorName} is not one of the earlier exams ${name} is carried from`);
      }
      continue;
    }
    // A row with no list of its own (a row made before the rework, or one whose board does not ask): an exam of
    // its own board, before this one.
    if (!it.month || !it.year) continue;
    const here = it.year * 12 + schoolMonthIndex(it.month);
    const then = Number(prior.year) * 12 + schoolMonthIndex(prior.month);
    if (prior.board_code !== it.board_code) {
      await gate('gate.priorSeries', scopeOf(it), `${name} carries an exam of its own board forward; ${priorName} was another board's`);
    } else if (then >= here) {
      await gate('gate.priorSeries', scopeOf(it), `${priorName} is not before ${seriesName(it)}: a carried exam comes first`);
    }
  }

  // The student's live lines, every session: exclusive groups and the same entry once.
  const r = await tx.execute(sql`
    select r.id, r.session_id, r.offer_item_id, r.board_series_id, i.offer_id, i.exclusive_group, i.enters_kind, i.qualification_id, i.kind,
      i.label, i.reference_codes, o.subject_id, s.name as subject_name, rs.name as session_name,
      coalesce((select array_agg(u.unit_id order by u.unit_id) from session_offer_item_unit u where u.item_id = i.id), '{}') as units
    from registration r
    join session_offer_item i on i.id = r.offer_item_id
    join session_offer o on o.id = i.offer_id
    join subject s on s.id = o.subject_id
    join registration_session rs on rs.id = r.session_id
    where r.student_id = ${ctx.studentId} and r.status not in ('rejected', 'expired', 'dropped')`);
  const existing = (r.rows as { id: string }[]).filter((x) => !excluded.has(x.id)) as unknown as {
    id: string; session_id: string; offer_item_id: string; board_series_id: string | null; offer_id: string; exclusive_group: string | null;
    enters_kind: string; qualification_id: string | null; kind: string; label: string; reference_codes: string[]; subject_id: string; subject_name: string; session_name: string; units: string[];
  }[];

  // D8: one live line per exclusive group per subject, in this session.
  const groups = new Map<string, string[]>();
  for (const e of existing.filter((x) => x.session_id === ctx.sessionId && x.exclusive_group)) {
    const k = `${e.offer_id}|${e.exclusive_group}`;
    groups.set(k, [...(groups.get(k) ?? []), nameOf(e)]);
  }
  for (const l of recheck ? [] : lines) {
    const it = items.get(l.offerItemId)!;
    if (!it.exclusive_group) continue;
    const k = `${it.offer_id}|${it.exclusive_group}`;
    const here = groups.get(k) ?? [];
    const name = nameOf(it);
    if (here.length) await gate('gate.exclusiveItems', scopeOf(it), `${name} and ${here.join(', ')} cannot be reserved together`, 409);
    groups.set(k, [...here, name]);
  }

  // The same entry once per student in one sitting (row code, sitting), across sessions.
  const taken = existing
    .filter((e) => e.board_series_id)
    .map((e) => ({ series: e.board_series_id!, keys: entryKeys(e), where: e.session_name, name: nameOf(e) }));
  for (const l of lines) {
    const it = items.get(l.offerItemId)!;
    if (!it.board_series_id) continue;
    const keys = entryKeys(it);
    const clash = taken.find((t) => t.series === it.board_series_id && t.keys.some((k) => keys.includes(k)));
    const name = nameOf(it);
    if (clash) {
      await gate('gate.sameEntryOnce', scopeOf(it), `${name} is already reserved in ${seriesName(it)} (${clash.name}, ${clash.where}): the board takes one entry`, 409);
    }
    taken.push({ series: it.board_series_id, keys, where: 'this reservation', name });
  }
  return { usedExceptionIds: used };
}

/**
 * Lines already made, checked again where they now are, per student (§6: every path that puts a
 * line into a series runs the rules — an item's series change, the admin's move, a board change,
 * the series correction, preregistration capture). Each student's lines are left out of their own
 * live lines; only what a move can change is asked (`recheck`). The caller holds the students.
 */
export async function recheckLines(tx: Tx, lineIds: string[]) {
  if (!lineIds.length) return;
  const r = await tx.execute(sql`
    select r.id, r.student_id, r.session_id, r.offer_item_id, r.attempt, r.mode, r.prior_sitting_series_id, r.prior_sitting_source, w.session_type
    from registration r join registration_session w on w.id = r.session_id
    where r.id in (${sql.join(lineIds.map((id) => sql`${id}`), sql`, `)})
    order by r.student_id, r.id`);
  const rows = r.rows as {
    id: string; student_id: string; session_id: string; offer_item_id: string; attempt: 'first' | 'retake'; mode: 'in_school' | 'self_study';
    prior_sitting_series_id: string | null; prior_sitting_source: string | null; session_type: string;
  }[];
  const groups = new Map<string, typeof rows>();
  for (const x of rows) groups.set(`${x.student_id}|${x.session_id}`, [...(groups.get(`${x.student_id}|${x.session_id}`) ?? []), x]);
  for (const g of groups.values()) {
    const first = g[0]!;
    await assertLineRules(tx, {
      studentId: first.student_id, sessionId: first.session_id,
      eligibility: { grade: null, series: { sessionType: first.session_type } } as unknown as Pick<Eligibility, 'grade' | 'series'>,
    }, g.map((x) => ({
      offerItemId: x.offer_item_id, attempt: x.attempt, mode: x.mode, priorSittingSeriesId: x.prior_sitting_series_id, priorSittingSource: x.prior_sitting_source,
    })), { excludeLineIds: g.map((x) => x.id), recheck: true });
  }
}
