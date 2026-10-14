/**
 * The rules on a line (RESERVATIONS_REWORK.md §3.5's table; docs/features/RESERVATIONS.md §2.5).
 *
 * `assertLineRules` is asked by every path that puts a line into a series — the reservation
 * paths, an item's series change, the grade-10 bulk commit, the day-one import, preregistration —
 * inside its transaction, after the student lock (assertMayRegisterForInTx). Each rule is a
 * policy with a key; before refusing, it asks the exception adapter for an active exception of
 * that key covering the line (one-shot gates are locked FOR UPDATE and returned to be marked
 * used in the same transaction). The school-fee gate and the session window stay where they are
 * (schoolFeeGateReason, sessionWindow).
 */

import { db, sql } from '@repo/db';
import { type Eligibility, type LinePolicyKey } from '@repo/validations';
import { lineExceptions, type ExceptionScope } from './line-exceptions';
import { availabilityConstraints } from './offer.services';
import { schoolMonthIndex } from './series.services';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class LineRuleError extends Error {
  constructor(message: string, public readonly policyKey: LinePolicyKey, public readonly status: 400 | 409 = 400) {
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
  qualification_id: string | null; board_series_id: string | null; availability: string; needs_prior_series: boolean;
  required_in_series: boolean; exclusive_group: string | null;
  offer_availability: string; grade10_core: boolean; subject_id: string; subject_name: string;
  board_code: string | null; month: string | null; year: number | null; series_label: string | null; board_name: string | null;
  carry_forward_months: number | null;
};

async function loadItems(tx: Tx, ids: string[]): Promise<Map<string, ItemRow & { units: string[] }>> {
  if (!ids.length) return new Map();
  const r = await tx.execute(sql`
    select i.id, i.offer_id, i.session_id, i.label, i.kind, i.enters_kind, i.qualification_id, i.board_series_id, i.availability,
      i.needs_prior_series, i.required_in_series, i.exclusive_group,
      o.availability as offer_availability, o.grade10_core, o.subject_id, s.name as subject_name,
      bs.board_code, bs.month, bs.year, bs.label as series_label, b.name as board_name, b.carry_forward_months,
      coalesce((select array_agg(u.unit_id order by u.unit_id) from session_offer_item_unit u where u.item_id = i.id), '{}') as units
    from session_offer_item i
    join session_offer o on o.id = i.offer_id
    join subject s on s.id = o.subject_id
    left join board_series bs on bs.id = i.board_series_id
    left join exam_board b on b.code = bs.board_code
    where i.id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
  return new Map((r.rows as (ItemRow & { units: string[] })[]).map((x) => [x.id, x]));
}

/** What an item enters, as keys two lines collide on: an award (q:), a unit (u:), an unmapped row (s:). */
function entryKeys(i: { enters_kind: string; qualification_id: string | null; subject_id: string; units: string[] }) {
  if (i.enters_kind === 'award' || i.enters_kind === 'option') return i.qualification_id ? [`q:${i.qualification_id}`] : [`s:${i.subject_id}`];
  if (i.enters_kind === 'units') return i.units.map((u) => `u:${u}`);
  return [`s:${i.subject_id}`];
}

const seriesName = (i: ItemRow) => (i.board_name && i.month ? `${i.board_name} ${i.month.charAt(0).toUpperCase()}${i.month.slice(1)} ${i.year}${i.series_label ? ` (${i.series_label})` : ''}` : 'its series');

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
     * Check again only what a move can change — the carry-forward period, the same entry once in
     * the series, the required items there. What governs a new line (availability, self-study,
     * a declared retake, exclusive groups, the grade-10 core) was asked when it was made.
     */
    recheck?: boolean;
    /**
     * False: read the gate exceptions without locking them — a check that is rolled back and makes
     * nothing (the day-one import's review, a GET) must not hold exception rows FOR UPDATE. Every
     * path that makes a line leaves it true (one-shot gates are locked and marked used).
     */
    lockExceptions?: boolean;
  } = {},
): Promise<{ usedExceptionIds: string[] }> {
  const used: string[] = [];
  const recheck = !!opts.recheck;
  const excluded = new Set(opts.excludeLineIds ?? []);
  const items = await loadItems(tx, [...new Set(lines.map((l) => l.offerItemId))]);
  for (const l of lines) {
    const it = items.get(l.offerItemId);
    if (!it || it.session_id !== ctx.sessionId) throw new LineRuleError('That item is not on offer in this session', 'gate.availability');
  }
  /** Refuse unless an exception of `key` covers the line; a one-shot one is used. */
  const gate = async (key: LinePolicyKey, scope: ExceptionScope, message: string, status: 400 | 409 = 400) => {
    const exc = await lineExceptions.active(tx, ctx.studentId, [key], scope, opts.lockExceptions === false ? undefined : { lock: 'update' });
    const e = exc.find((x) => !used.includes(x.id));
    if (!e) throw new LineRuleError(message, key, status);
    if (e.oneShot) used.push(e.id);
  };
  const scopeOf = (it: ItemRow) => ({ sessionId: ctx.sessionId, subjectId: it.subject_id, offerId: it.offer_id, offerItemId: it.id, ...(it.board_series_id ? { boardSeriesId: it.board_series_id } : {}) });

  // Per line: availability, self-study first entry, a retake's prior sitting, the carry-forward period.
  for (const l of lines) {
    const it = items.get(l.offerItemId)!;
    const c = availabilityConstraints(it.offer_availability, it.availability);
    const name = it.kind === 'whole' ? it.subject_name : `${it.subject_name} — ${it.label}`;
    if (recheck) {
      // Only the carry-forward period below.
    } else if (c.closed) await gate('gate.availability', scopeOf(it), `${name} is closed in this session`);
    else if (c.retakeOnly && l.attempt !== 'retake') await gate('gate.availability', scopeOf(it), `${name} takes retakes only this cycle`);
    else if (c.selfStudyOnly && l.mode !== 'self_study') await gate('gate.availability', scopeOf(it), `${name} is self-study only: the school does not teach it this cycle`);
    if (!recheck && l.mode === 'self_study' && l.attempt === 'first' && !c.selfStudyOnly) {
      // The forms' "Self Study … (ONLY 2nd entry)" (G-09); the old sentence kept.
      await gate('gate.selfStudyFirstEntry', scopeOf(it), 'Subjects can only be taken outside school when retaking or when the school does not offer them');
    }
    if (!recheck && l.attempt === 'retake' && !l.priorSittingSeriesId && l.priorSittingSource !== 'legacy') {
      throw new LineRuleError(`A retake of ${name} names the sitting it follows`, 'gate.retakeDeclared');
    }
    if (it.needs_prior_series) {
      if (!l.priorSittingSeriesId) {
        await gate('gate.priorSeries', scopeOf(it), `${name} carries an earlier sitting forward: name the series it is carried from`);
      } else {
        const p = await tx.execute(sql`select bs.board_code, bs.month, bs.year from board_series bs where bs.id = ${l.priorSittingSeriesId}`);
        const prior = p.rows[0] as { board_code: string; month: string; year: number } | undefined;
        if (!prior || !it.month || !it.year) throw new LineRuleError('The sitting carried from was not found', 'gate.priorSeries');
        const here = it.year * 12 + schoolMonthIndex(it.month);
        const then = prior.year * 12 + schoolMonthIndex(prior.month);
        const priorName = `${prior.month.charAt(0).toUpperCase()}${prior.month.slice(1)} ${prior.year}`;
        if (prior.board_code !== it.board_code) {
          await gate('gate.priorSeries', scopeOf(it), `${name} carries a sitting of its own board forward; ${priorName} was another board's`);
        } else if (then >= here) {
          await gate('gate.priorSeries', scopeOf(it), `${priorName} is not before ${seriesName(it)}: a carried sitting comes first`);
        } else if (it.carry_forward_months && here - then > it.carry_forward_months) {
          await gate('gate.priorSeries', scopeOf(it),
            `${priorName} is outside ${it.board_name}'s carry-forward period (${it.carry_forward_months} months) for ${seriesName(it)}: it cannot be carried forward`);
        }
      }
    }
  }

  // The student's live lines, every session: exclusive groups, the same entry once, required items, core.
  const r = await tx.execute(sql`
    select r.id, r.session_id, r.offer_item_id, r.board_series_id, i.offer_id, i.exclusive_group, i.enters_kind, i.qualification_id, i.kind,
      i.label, o.subject_id, s.name as subject_name, rs.name as session_name,
      coalesce((select array_agg(u.unit_id order by u.unit_id) from session_offer_item_unit u where u.item_id = i.id), '{}') as units
    from registration r
    join session_offer_item i on i.id = r.offer_item_id
    join session_offer o on o.id = i.offer_id
    join subject s on s.id = o.subject_id
    join registration_session rs on rs.id = r.session_id
    where r.student_id = ${ctx.studentId} and r.status not in ('rejected', 'expired', 'dropped')`);
  const existing = (r.rows as { id: string }[]).filter((x) => !excluded.has(x.id)) as unknown as {
    id: string; session_id: string; offer_item_id: string; board_series_id: string | null; offer_id: string; exclusive_group: string | null;
    enters_kind: string; qualification_id: string | null; kind: string; label: string; subject_id: string; subject_name: string; session_name: string; units: string[];
  }[];

  // Exclusive groups: one live line per group per offer, in this session.
  const groups = new Map<string, string[]>();
  for (const e of existing.filter((x) => x.session_id === ctx.sessionId && x.exclusive_group)) {
    const k = `${e.offer_id}|${e.exclusive_group}`;
    groups.set(k, [...(groups.get(k) ?? []), e.kind === 'whole' ? e.subject_name : `${e.subject_name} — ${e.label}`]);
  }
  for (const l of recheck ? [] : lines) {
    const it = items.get(l.offerItemId)!;
    if (!it.exclusive_group) continue;
    const k = `${it.offer_id}|${it.exclusive_group}`;
    const here = groups.get(k) ?? [];
    const name = it.kind === 'whole' ? it.subject_name : `${it.subject_name} — ${it.label}`;
    if (here.length) await gate('gate.exclusiveItems', scopeOf(it), `${name} and ${here.join(', ')} cannot be reserved together`, 409);
    groups.set(k, [...here, name]);
  }

  // The same unit or award once per student in one board series, across sessions.
  const taken = existing
    .filter((e) => e.board_series_id)
    .map((e) => ({ series: e.board_series_id!, keys: entryKeys(e), where: e.session_name, name: e.kind === 'whole' ? e.subject_name : `${e.subject_name} — ${e.label}` }));
  for (const l of lines) {
    const it = items.get(l.offerItemId)!;
    if (!it.board_series_id) continue;
    const keys = entryKeys(it);
    const clash = taken.find((t) => t.series === it.board_series_id && t.keys.some((k) => keys.includes(k)));
    const name = it.kind === 'whole' ? it.subject_name : `${it.subject_name} — ${it.label}`;
    if (clash) {
      await gate('gate.sameEntryOnce', scopeOf(it), `${name} is already reserved in ${seriesName(it)} (${clash.name}, ${clash.where}): the board takes one entry`, 409);
    }
    taken.push({ series: it.board_series_id, keys, where: 'this reservation', name });
  }

  // Required items: a first entry of a subject in a series includes the items it requires there.
  const firstOffers = new Map<string, ItemRow>();
  for (const l of lines) {
    const it = items.get(l.offerItemId)!;
    if (l.attempt === 'first' && it.board_series_id) firstOffers.set(`${it.offer_id}|${it.board_series_id}`, it);
  }
  for (const [key, it] of firstOffers) {
    const [offerId, seriesId] = key.split('|') as [string, string];
    const req = await tx.execute(sql`
      select i.id, i.label from session_offer_item i
      where i.offer_id = ${offerId} and i.board_series_id = ${seriesId} and i.required_in_series and i.availability <> 'closed'`);
    const have = new Set([...existing.map((e) => e.offer_item_id), ...lines.map((x) => x.offerItemId)]);
    const missing = (req.rows as { id: string; label: string }[]).filter((x) => !have.has(x.id));
    if (missing.length) {
      await gate('gate.requiredItems', scopeOf(it), `A first entry of ${it.subject_name} in ${seriesName(it)} includes ${missing.map((m) => m.label).join(', ')}`);
    }
  }

  // Grade 10 in June registers every core offer of the session (A-05).
  if (!recheck && ctx.eligibility.grade === 10 && ctx.eligibility.series.sessionType === 'june') {
    const core = await tx.execute(sql`
      select o.id, s.name from session_offer o join subject s on s.id = o.subject_id
      where o.session_id = ${ctx.sessionId} and o.grade10_core and o.availability <> 'closed' order by s.name`);
    const haveOffers = new Set([
      ...existing.filter((e) => e.session_id === ctx.sessionId).map((e) => e.offer_id),
      ...lines.map((x) => items.get(x.offerItemId)!.offer_id),
    ]);
    const missing = (core.rows as { id: string; name: string }[]).filter((c) => !haveOffers.has(c.id));
    if (missing.length) {
      await gate('gate.grade10Core', { sessionId: ctx.sessionId }, `Grade 10 June session requires all core subjects. Missing: ${missing.map((m) => m.name).join(', ')}`);
    }
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
