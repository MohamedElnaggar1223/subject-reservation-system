/**
 * Prices as the coordinator sets them (COORDINATOR_REWORK.md E1–E7; Appendix A price lists, prices,
 * a row's exam fee).
 *
 * - Parse (writes nothing): a board's fee list pasted as printed — "0970 CX Biology 10,850", "WMA11 4,800",
 *   "4MA1 1H 4,600", "S1 / S2 4,450" (one amount for each of the pair), an old code the reference aliases
 *   ("9608 SY" → 9618's A.S.) — each line matched to a reference row by the codes its list prints
 *   (`price_codes`), longest first, and to the session's row of that subject and key.
 * - Apply: the list is kept as printed (a list of the same name replaces its rows); each matched row
 *   takes its amount (source 'list'); the rows whose fee follows another (the board rule for a
 *   one-paper retake on a board that charges the syllabus; the sum of a qualification's units) follow;
 *   the unpaid lines of every row whose price changed are re-priced and the others listed for finance —
 *   its impact answered first.
 * - The missing-prices list (amendment 4): every ticked row without an exam fee, with what could fill it
 *   (its units' sum, the board rule, another list's row); the subjects with no course fee.
 * - A row's exam fee: typed, or filled by the board rule or the sum of its units.
 *
 * Locks (§9.2): the session FOR SHARE, the board's offerings FOR UPDATE (id order), their rows FOR
 * UPDATE (id order), then the lines (planReprice).
 */

import {
  db, registrationSession, examBoard, sessionOffer, sessionOfferItem, subject, referenceRow, referenceSubject, priceList, priceListRow,
  and, eq, inArray, asc, sql,
} from '@repo/db';
import { randomUUID } from 'crypto';
import { matchPrintedCode, printedCodeCandidates, normalizePrintedCode, type ApplyPriceListType, type SetRowExamFeeType, type SubjectsFile } from '@repo/validations';
import { logAction, type AuditContext } from '../audit.services';
import { round2 } from '../pricing.services';
import { SetupError, sessionForSetup, setupRethrow } from './offering.services';
import {
  planReprice, applyReprice, settleImpact, tellRepriced, ImpactPending, type Impact,
} from './reprice.services';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;
type ItemRow = typeof sessionOfferItem.$inferSelect;

// ─── Reading a printed list ──────────────────────────────────────────────────

export type ParsedLine = { lineNo: number; code: string; name: string; amount: number };

const AMOUNT = /^(.*?)[\s\t]+((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)\s*(?:EGP|LE|L\.E\.?|جنيه)?\s*$/i;

/** One printed line as its text before the amount, and the amount (null: no amount at the end — a heading or a note). */
function splitAmount(raw: string): { printed: string; amount: number } | null {
  const line = raw.replace(/\u00a0/g, ' ').trim();
  if (!line) return null;
  const m = AMOUNT.exec(line);
  if (!m) return null;
  const printed = m[1]!.trim().replace(/\s+/g, ' ');
  const amount = Number(m[2]!.replace(/,/g, ''));
  return printed && Number.isFinite(amount) ? { printed, amount } : null;
}

type Reference = Awaited<ReturnType<typeof referenceFor>>;

/**
 * The board's reference subjects and aliases as P0's matcher reads them (the reference check reads the files
 * the same way), and the session's rows of that board.
 */
async function referenceFor(executor: Executor, sessionId: string, board: string) {
  const subjectRows = await executor.select().from(referenceSubject).where(eq(referenceSubject.boardCode, board)).orderBy(asc(referenceSubject.sortOrder));
  const rowRows = subjectRows.length
    ? await executor.select().from(referenceRow).where(inArray(referenceRow.referenceSubjectId, subjectRows.map((s) => s.id))).orderBy(asc(referenceRow.sortOrder))
    : [];
  const refs = rowRows.map((r) => {
    const s = subjectRows.find((x) => x.id === r.referenceSubjectId)!;
    return { subjectCode: s.code, subjectName: s.name, key: r.key, label: r.labelEn, kind: r.kind };
  });
  const subjects: SubjectsFile = subjectRows.map((s) => ({
    code: s.code, name: s.name, group: s.group as 'O.L.' | 'A.S./A.L.', level: s.level as 'igcse' | 'as_al', confirmed: s.confirmed,
    ...(s.note ? { note: s.note } : {}), winterSitting: (s.winterSitting as 'november' | 'january' | null),
    rows: rowRows.filter((r) => r.referenceSubjectId === s.id).map((r) => ({
      key: r.key, kind: r.kind as SubjectsFile[number]['rows'][number]['kind'], codes: r.codes, priceCodes: r.priceCodes,
      ...(r.short ? { short: r.short } : {}), label: { en: r.labelEn, ar: r.labelAr }, ...(r.sumOfUnits.length ? { sumOfUnits: r.sumOfUnits } : {}),
    })),
  }));
  const [b] = await executor.select({ aliases: examBoard.referenceAliases }).from(examBoard).where(eq(examBoard.code, board));
  const rows = await executor.select({ id: sessionOfferItem.id, key: sessionOfferItem.referenceKey, codes: sessionOfferItem.referenceCodes, label: sessionOfferItem.label, referenceCode: sessionOffer.referenceCode, subjectName: subject.name, subjectCode: subject.code })
    .from(sessionOfferItem).innerJoin(sessionOffer, eq(sessionOffer.id, sessionOfferItem.offerId)).innerJoin(subject, eq(subject.id, sessionOffer.subjectId))
    .where(and(eq(sessionOfferItem.sessionId, sessionId), eq(subject.council, board)));
  return { refs, subjects, aliases: b?.aliases ?? [], rows };
}

/**
 * A line's match: the reference row and the session's rows of it; `toCheck` (an alias in doubt) is applied only when
 * confirmed. A paper row's code in doubt has a second reading (P2's L9, the mock's decision 5): the whole
 * qualification — its subject's all-papers row — as the November 2026 list's 4MA1H / 4MA2H at 9,840 may mean.
 */
type Reading = { reading: 'paper' | 'whole'; matchedKey: string; label: string; rowIds: string[] };
type Target = { matchedKey: string; label: string; rowIds: string[]; toCheck?: true; note?: string; readings?: Reading[] };

/**
 * What a printed code reaches: the reference rows P0's matcher finds through the printed price codes and the
 * board's aliases (a `toCheck` alias marked so); else a row's own code as the board enters it — a bare
 * syllabus ("3180") or paper code ("3180/01") — when it names exactly one reference row (one code on several
 * rows, as 9618 on A.S., A.2. and A.L., matches none); else a custom row by its own code. With the session's
 * rows of each.
 */
function targetsOf(printed: string, ref: Reference): Target[] {
  const target = (subjectCode: string, key: string, extra: Partial<Target> = {}): Target => {
    const r = ref.refs.find((x) => x.subjectCode === subjectCode && x.key === key);
    return {
      matchedKey: `${subjectCode}:${key}`, label: r ? `${r.subjectName} — ${r.label}` : `${subjectCode} ${key}`,
      rowIds: ref.rows.filter((x) => x.referenceCode === subjectCode && x.key === key).map((x) => x.id), ...extra,
    };
  };
  const matches = matchPrintedCode(printed, { aliases: ref.aliases }, ref.subjects);
  if (matches.length) {
    return matches.map((m) => {
      if (!m.toCheck) return target(m.subject, m.row);
      const own = target(m.subject, m.row);
      const kind = ref.refs.find((x) => x.subjectCode === m.subject && x.key === m.row)?.kind;
      const whole = kind === 'paper' ? ref.refs.find((x) => x.subjectCode === m.subject && x.kind === 'all_papers') : undefined;
      const wholeTarget = whole ? target(m.subject, whole.key) : null;
      // Two readings only where there is a second one (a paper row of a subject with an all-papers row).
      const readings: Reading[] | undefined = wholeTarget ? [
        { reading: 'paper', matchedKey: own.matchedKey, label: own.label, rowIds: own.rowIds },
        { reading: 'whole', matchedKey: wholeTarget.matchedKey, label: `${wholeTarget.label} (the whole qualification)`, rowIds: wholeTarget.rowIds },
      ] : undefined;
      return { ...own, toCheck: true as const, note: m.note, ...(readings ? { readings } : {}) };
    });
  }
  const wanted = new Set(printedCodeCandidates(printed));
  const byOwnCode = ref.subjects.flatMap((s) => s.rows.filter((r) => r.codes.some((c) => wanted.has(normalizePrintedCode(c)))).map((r) => ({ subject: s.code, key: r.key })));
  if (byOwnCode.length === 1) return [target(byOwnCode[0]!.subject, byOwnCode[0]!.key)];
  if (byOwnCode.length > 1) return [];
  return ref.rows.filter((x) => !x.key && x.codes.some((c) => wanted.has(normalizePrintedCode(c))))
    .map((x) => ({ matchedKey: `${x.subjectCode}:#${x.id}`, label: `${x.subjectName} — ${x.label}`, rowIds: [x.id] }));
}

/**
 * A printed line read: the longest run of its first words that is a printed code the matcher knows
 * ("9700 S1 / S2" of "9700 S1 / S2 AS Level BIOLOGY 14,100"), the rest its name; a line no run matches
 * keeps its first word as its code (or two: "0970 CX").
 */
function readLine(raw: string, lineNo: number, ref: Reference): (ParsedLine & { targets: Target[] }) | null {
  const split = splitAmount(raw);
  if (!split) return null;
  const tokens = split.printed.split(' ');
  for (let k = Math.min(tokens.length, 6); k >= 1; k--) {
    const code = tokens.slice(0, k).join(' ');
    const targets = targetsOf(code, ref);
    if (targets.length) return { lineNo, code, name: tokens.slice(k).join(' '), amount: split.amount, targets };
  }
  const n = tokens[1] && /^[A-Z0-9]{1,3}$/i.test(tokens[1]) && /^\d{4}$/.test(tokens[0]!) ? 2 : 1;
  return { lineNo, code: tokens.slice(0, n).join(' '), name: tokens.slice(n).join(' '), amount: split.amount, targets: [] };
}

/** POST /sessions/:id/price-lists/parse — the list as printed, each line matched or not (writes nothing). */
export async function parsePriceList(sessionId: string, board: string, text: string) {
  const [s] = await db.select({ id: registrationSession.id }).from(registrationSession).where(eq(registrationSession.id, sessionId));
  if (!s) throw new SetupError('Session not found', 404);
  const ref = await referenceFor(db, sessionId, board);
  const rows: { lineNo: number; code: string; name: string; amount: number; matches: Target[] }[] = [];
  const skipped: { lineNo: number; text: string }[] = [];
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = readLine(raw, i + 1, ref);
    if (!line) {
      if (raw.trim()) skipped.push({ lineNo: i + 1, text: raw.trim() });
      continue;
    }
    const { targets, ...rest } = line;
    rows.push({ ...rest, matches: targets });
  }
  return {
    board,
    rows,
    // Matched to the reference but no row of this session enters it (the subject or the row is not offered).
    matchedNotInSession: rows.filter((r) => r.matches.length && r.matches.every((m) => !m.rowIds.length)).length,
    unmatched: rows.filter((r) => !r.matches.length),
    skipped,
  };
}

// ─── Fees that follow other fees (E5, §6) ────────────────────────────────────

/**
 * The fees that follow others (E5), on these offerings: a row summing its units (the reference's
 * sumOfUnits), then a one-paper retake on a board that charges the syllabus (the board rule, from all
 * papers). A row is filled when it has no fee, or kept in step when its fee came from the same rule; a
 * fee typed or read from a list is hers and stays. Returns the rows whose fee changed (the caller
 * re-prices their lines); with `audit`, each change has its OFFER_ITEM_UPDATED row.
 */
/** Source fees a change cleared (a row's fee set to none, or the row removed): by reference key, and whether all papers. */
export type ClearedSources = { keys: ReadonlySet<string>; allPapers: boolean };

export async function deriveFollowingFees(tx: Tx, offerIds: string[], audit?: { actorId: string; ctx?: AuditContext }, cleared: ClearedSources = { keys: new Set(), allPapers: false }) {
  if (!offerIds.length) return [] as string[];
  const changed: string[] = [];
  const offers = await tx.select({ id: sessionOffer.id, referenceCode: sessionOffer.referenceCode, board: subject.council, feeKey: examBoard.onePaperFeeKey })
    .from(sessionOffer).innerJoin(subject, eq(subject.id, sessionOffer.subjectId)).innerJoin(examBoard, eq(examBoard.code, subject.council))
    .where(inArray(sessionOffer.id, offerIds));
  for (const o of offers) {
    const rows = await tx.select().from(sessionOfferItem).where(eq(sessionOfferItem.offerId, o.id)).orderBy(asc(sessionOfferItem.id));
    const refs = o.referenceCode
      ? await tx.select().from(referenceRow).where(inArray(referenceRow.id, rows.filter((r) => r.referenceKey).map((r) => `${o.board}:${o.referenceCode}:${r.referenceKey}`).concat('__none__')))
      : [];
    const set = async (r: ItemRow, fee: number | null, source: 'units_sum' | 'board_rule', sourceCleared: boolean) => {
      // A source's fee cleared, or its row removed (in this change): a row that follows it loses its own (price not set).
      // A source never priced leaves the follower as it is; so does a fee typed or read from a list (hers).
      if (fee === null && (r.examFee === null || r.examFeeSource !== source || !sourceCleared)) return;
      if (fee !== null && r.examFee !== null && r.examFeeSource !== source) return;
      if (r.examFee === fee && r.examFeeSource === (fee === null ? null : source)) return;
      await tx.update(sessionOfferItem).set({ examFee: fee, examFeeSource: fee === null ? null : source, priceListRowId: null, updatedAt: new Date() }).where(eq(sessionOfferItem.id, r.id));
      if (audit) {
        await logAction(audit.actorId, 'OFFER_ITEM_UPDATED', 'offer_item', r.id, { examFee: r.examFee, examFeeSource: r.examFeeSource },
          { examFee: fee, examFeeSource: fee === null ? null : source, via: source === 'board_rule' ? 'the board rule' : 'the sum of its units' }, audit.ctx, tx);
      }
      r.examFee = fee;
      r.examFeeSource = fee === null ? null : source;
      changed.push(r.id);
    };
    // The sum of units first (an all-papers row may be the sum of its papers), then the board rule on its papers.
    for (const r of rows) {
      const ref = refs.find((x) => x.key === r.referenceKey);
      if (!ref?.sumOfUnits.length) continue;
      const parts = ref.sumOfUnits.map((k) => rows.find((x) => x.referenceKey === k)?.examFee ?? null);
      await set(r, parts.every((p): p is number => p !== null) ? round2(parts.reduce((a, b) => a + b, 0)) : null, 'units_sum', ref.sumOfUnits.some((k) => cleared.keys.has(k)));
    }
    if (o.feeKey === 'qualification') {
      const all = rows.find((r) => r.kind === 'all_papers');
      for (const r of rows.filter((x) => x.kind === 'paper')) await set(r, all?.examFee ?? null, 'board_rule', cleared.allPapers);
    }
  }
  return changed;
}

/** The board's offerings of a session and their rows, FOR UPDATE in §9.2's order (offerings, then rows, each in id order). */
async function lockBoardRows(tx: Tx, sessionId: string, board: string) {
  const offers = await tx.select({ id: sessionOffer.id }).from(sessionOffer).innerJoin(subject, eq(subject.id, sessionOffer.subjectId))
    .where(and(eq(sessionOffer.sessionId, sessionId), eq(subject.council, board))).orderBy(asc(sessionOffer.id)).for('update', { of: sessionOffer });
  const rows = offers.length
    ? await tx.select().from(sessionOfferItem).where(inArray(sessionOfferItem.offerId, offers.map((o) => o.id))).orderBy(asc(sessionOfferItem.id)).for('update')
    : [];
  return { offerIds: offers.map((o) => o.id), rows };
}

export type PriceSave = { saved: boolean; impact: Impact };

/**
 * POST /sessions/:id/price-lists — a list applied (see the header). The rows are matched again here,
 * never taken from the client.
 */
export async function applyPriceList(sessionId: string, input: ApplyPriceListType, actorId: string, ctx?: AuditContext) {
  try {
    const out = await db.transaction(async (tx) => {
      const session = await sessionForSetup(tx, sessionId);
      const { offerIds, rows } = await lockBoardRows(tx, sessionId, input.board);
      const ref = await referenceFor(tx, sessionId, input.board);
      // The list kept as printed: one of the same name replaces its rows.
      const [existing] = await tx.select().from(priceList)
        .where(and(eq(priceList.sessionId, sessionId), eq(priceList.boardCode, input.board), eq(priceList.name, input.name))).for('update');
      const listId = existing?.id ?? randomUUID();
      if (existing) {
        await tx.update(sessionOfferItem).set({ priceListRowId: null }).where(sql`${sessionOfferItem.priceListRowId} in (select id from price_list_row where price_list_id = ${listId})`);
        await tx.delete(priceListRow).where(eq(priceListRow.priceListId, listId));
        await tx.update(priceList).set({ updatedAt: new Date() }).where(eq(priceList.id, listId));
      } else {
        await tx.insert(priceList).values({ id: listId, sessionId, boardCode: input.board, name: input.name, createdBy: actorId });
      }
      const priceRows = new Set<string>();
      let matched = 0;
      const unmatched: { code: string; name: string; amount: number }[] = [];
      // A match through an alias in doubt (toCheck) is shown for her to confirm, never applied silently; once she
      // reads it, per paper (its own row) or as the whole qualification (the all-papers row: P2's L9).
      const toConfirm: { code: string; name: string; amount: number; label: string; note: string | null; readings?: Reading[] }[] = [];
      const wholeAmounts = new Map<string, { code: string; amount: number }>();
      for (const [i, r] of input.rows.entries()) {
        const line = { lineNo: r.lineNo ?? i + 1, code: r.code, name: r.name, amount: r.amount };
        const reading = r.reading ?? (r.confirmed ? 'paper' : null);
        const all = targetsOf(r.code, ref).map((t) => {
          if (!t.toCheck || reading !== 'whole') return t;
          const whole = t.readings?.find((x) => x.reading === 'whole');
          if (!whole) throw new SetupError(`${r.code} has no other reading: it is ${t.label}`);
          for (const id of whole.rowIds) {
            const before = wholeAmounts.get(id);
            if (before && before.amount !== r.amount) throw new SetupError(`${before.code} and ${r.code} are read as the whole qualification at different amounts: read them per paper, or leave one out`, 409);
            wholeAmounts.set(id, { code: r.code, amount: r.amount });
          }
          return { matchedKey: whole.matchedKey, label: whole.label, rowIds: whole.rowIds };
        });
        const doubtful = all.filter((t) => t.toCheck && !reading);
        for (const t of doubtful) {
          toConfirm.push({ code: r.code, name: r.name, amount: r.amount, label: t.label, note: t.note ?? null, ...(t.readings ? { readings: t.readings } : {}) });
          await tx.insert(priceListRow).values({ id: randomUUID(), priceListId: listId, lineNo: line.lineNo, code: r.code, name: r.name, amount: r.amount, matchedKey: t.matchedKey, matchedItemId: null });
        }
        const targets = all.filter((t) => !doubtful.includes(t));
        if (!all.length) {
          unmatched.push({ code: r.code, name: r.name, amount: r.amount });
          await tx.insert(priceListRow).values({ id: randomUUID(), priceListId: listId, lineNo: line.lineNo, code: r.code, name: r.name, amount: r.amount });
          continue;
        }
        if (!targets.length) continue;
        matched++;
        for (const t of targets) {
          const rowId = randomUUID();
          await tx.insert(priceListRow).values({ id: rowId, priceListId: listId, lineNo: line.lineNo, code: r.code, name: r.name, amount: r.amount, matchedKey: t.matchedKey, matchedItemId: t.rowIds[0] ?? null });
          for (const id of t.rowIds) {
            const row = rows.find((x) => x.id === id);
            if (!row) continue;
            const same = row.examFee === r.amount && row.examFeeSource === 'list';
            await tx.update(sessionOfferItem).set({ examFee: r.amount, examFeeSource: 'list', priceListRowId: rowId, updatedAt: new Date() }).where(eq(sessionOfferItem.id, id));
            if (!same) priceRows.add(id);
          }
        }
      }
      for (const id of await deriveFollowingFees(tx, offerIds)) priceRows.add(id);
      const plan = await planReprice(tx, { rowIds: [...priceRows] });
      const { told: repriced, impact } = await applyReprice(tx, plan, { actorId, reason: `the price list "${input.name}" was applied to ${session.name}`, entity: { type: 'price_list', id: listId }, ctx });
      settleImpact(impact, input.expected);
      await logAction(actorId, 'PRICE_LIST_APPLIED', 'price_list', listId, existing ? { name: existing.name } : null,
        { sessionId, board: input.board, name: input.name, lines: input.rows.length, matched, unmatched: unmatched.length, rowsPriced: priceRows.size, repriced: repriced.length, listedForFinance: plan.listed.length }, ctx, tx);
      return { impact, repriced, listId, matched, unmatched, toConfirm, rowsPriced: priceRows.size, sessionName: session.name };
    });
    await tellRepriced(out.repriced, `The exam fee changed in ${out.sessionName}`);
    return { saved: true, impact: out.impact, listId: out.listId, matched: out.matched, unmatched: out.unmatched, toConfirm: out.toConfirm, rowsPriced: out.rowsPriced };
  } catch (err) {
    if (err instanceof ImpactPending) {
      return { saved: false, impact: err.impact, listId: null, matched: 0, unmatched: [] as { code: string; name: string; amount: number }[], toConfirm: [] as { code: string; name: string; amount: number; label: string; note: string | null; readings?: Reading[] }[], rowsPriced: 0 };
    }
    setupRethrow(err);
  }
}

/**
 * PUT /sessions/:id/rows/:rowId/exam-fee — typed, or filled by the board rule (a one-paper retake on a
 * board that charges the syllabus) or by the sum of its units; the fees that follow it follow, and the
 * unpaid lines of each row whose price changed are re-priced (impact first).
 */
export async function setRowExamFee(sessionId: string, rowId: string, input: SetRowExamFeeType, actorId: string, ctx?: AuditContext) {
  try {
    const out = await db.transaction(async (tx) => {
      const session = await sessionForSetup(tx, sessionId);
      const [found] = await tx.select({ offerId: sessionOfferItem.offerId }).from(sessionOfferItem).where(and(eq(sessionOfferItem.id, rowId), eq(sessionOfferItem.sessionId, sessionId)));
      if (!found) throw new SetupError('That row is not in this session', 404);
      const [offer] = await tx.select({ id: sessionOffer.id, referenceCode: sessionOffer.referenceCode, board: subject.council, feeKey: examBoard.onePaperFeeKey, name: subject.name })
        .from(sessionOffer).innerJoin(subject, eq(subject.id, sessionOffer.subjectId)).innerJoin(examBoard, eq(examBoard.code, subject.council))
        .where(eq(sessionOffer.id, found.offerId)).for('update', { of: sessionOffer });
      const rows = await tx.select().from(sessionOfferItem).where(eq(sessionOfferItem.offerId, found.offerId)).orderBy(asc(sessionOfferItem.id)).for('update');
      const row = rows.find((r) => r.id === rowId)!;
      let fee: number;
      let source: 'typed' | 'units_sum' | 'board_rule';
      if ('amount' in input) {
        fee = input.amount;
        source = 'typed';
      } else if (input.source === 'board_rule') {
        if (row.kind !== 'paper') throw new SetupError('The board rule fills a one-paper retake\'s fee');
        if (offer!.feeKey !== 'qualification') throw new SetupError(`${offer!.name}'s board prices each paper on its own: set the paper's fee from its list`);
        const all = rows.find((r) => r.kind === 'all_papers');
        if (all?.examFee == null) throw new SetupError(`${offer!.name} has no all-papers fee yet: the board rule reads it`);
        fee = all.examFee;
        source = 'board_rule';
      } else {
        const [ref] = row.referenceKey && offer!.referenceCode
          ? await tx.select().from(referenceRow).where(eq(referenceRow.id, `${offer!.board}:${offer!.referenceCode}:${row.referenceKey}`))
          : [];
        if (!ref?.sumOfUnits.length) throw new SetupError(`${row.label} is not made of units on the reference list`);
        const parts = ref.sumOfUnits.map((k) => rows.find((r) => r.referenceKey === k));
        const missing = parts.filter((p) => p?.examFee == null);
        if (missing.length) throw new SetupError(`${row.label}: a unit it sums has no fee yet`);
        fee = round2(parts.reduce((a, p) => a + p!.examFee!, 0));
        source = 'units_sum';
      }
      const priceRows = new Set<string>();
      if (row.examFee !== fee || row.examFeeSource !== source) {
        await tx.update(sessionOfferItem).set({ examFee: fee, examFeeSource: source, priceListRowId: null, updatedAt: new Date() }).where(eq(sessionOfferItem.id, rowId));
        await logAction(actorId, 'OFFER_ITEM_UPDATED', 'offer_item', rowId, { examFee: row.examFee, examFeeSource: row.examFeeSource }, { examFee: fee, examFeeSource: source }, ctx, tx);
        priceRows.add(rowId);
      }
      for (const id of await deriveFollowingFees(tx, [found.offerId])) priceRows.add(id);
      const plan = await planReprice(tx, { rowIds: [...priceRows] });
      const { told: repriced, impact } = await applyReprice(tx, plan, { actorId, reason: `${offer!.name} — ${row.label}: its exam fee changed`, entity: { type: 'offer_item', id: rowId }, ctx });
      settleImpact(impact, input.expected);
      return { impact, repriced, examFee: fee, examFeeSource: source, sessionName: session.name };
    });
    await tellRepriced(out.repriced, `The exam fee changed in ${out.sessionName}`);
    return { saved: true, impact: out.impact, examFee: out.examFee as number | null, examFeeSource: out.examFeeSource as string | null };
  } catch (err) {
    if (err instanceof ImpactPending) return { saved: false, impact: err.impact, examFee: null as number | null, examFeeSource: null as string | null };
    setupRethrow(err);
  }
}

// ─── The missing-prices list (amendment 4) ───────────────────────────────────

/** GET /sessions/:id/prices — every row's exam fee and source; the missing prices, each with what could fill it. */
export async function sessionPrices(sessionId: string) {
  const [s] = await db.select().from(registrationSession).where(eq(registrationSession.id, sessionId));
  if (!s) throw new SetupError('Session not found', 404);
  const rows = await db.select({ row: sessionOfferItem, offerId: sessionOffer.id, offerCourseFee: sessionOffer.courseFee, referenceCode: sessionOffer.referenceCode, subjectName: subject.name, board: subject.council, feeKey: examBoard.onePaperFeeKey })
    .from(sessionOfferItem).innerJoin(sessionOffer, eq(sessionOffer.id, sessionOfferItem.offerId)).innerJoin(subject, eq(subject.id, sessionOffer.subjectId)).innerJoin(examBoard, eq(examBoard.code, subject.council))
    .where(eq(sessionOfferItem.sessionId, sessionId)).orderBy(asc(sessionOffer.sortOrder), asc(subject.name), asc(sessionOfferItem.sortOrder));
  const lists = await db.select().from(priceList).where(eq(priceList.sessionId, sessionId)).orderBy(asc(priceList.createdAt));
  const listRows = lists.length ? await db.select().from(priceListRow).where(inArray(priceListRow.priceListId, lists.map((l) => l.id))) : [];
  const refs = await db.select().from(referenceRow).where(inArray(referenceRow.id, rows.filter((r) => r.row.referenceKey && r.referenceCode).map((r) => `${r.board}:${r.referenceCode}:${r.row.referenceKey}`).concat('__none__')));
  const ticked = (r: ItemRow) => r.firstInSchool || r.retakeInSchool || r.retakeSelfStudy || r.firstSelfStudy;
  const view = rows.map(({ row: r, offerId, offerCourseFee, referenceCode, subjectName, board, feeKey }) => {
    const ref = refs.find((x) => x.id === `${board}:${referenceCode}:${r.referenceKey}`);
    const siblings = rows.filter((x) => x.offerId === offerId).map((x) => x.row);
    const units = ref?.sumOfUnits.length ? ref.sumOfUnits.map((k) => siblings.find((x) => x.referenceKey === k)?.examFee ?? null) : null;
    const list = r.priceListRowId ? listRows.find((x) => x.id === r.priceListRowId) : undefined;
    return {
      offeringId: offerId, subject: subjectName, board, rowId: r.id, kind: r.kind, label: r.label, ticked: ticked(r),
      examFee: r.examFee, examFeeSource: r.examFeeSource,
      priceList: list ? { id: list.priceListId, name: lists.find((l) => l.id === list.priceListId)?.name ?? '', code: list.code } : null,
      courseFee: r.courseFee ?? offerCourseFee, courseFeeOwn: r.courseFee !== null, selfStudyFee: r.selfStudyFee,
      // What could fill a missing fee (amendment 4).
      fill: {
        unitsSum: units && units.every((u): u is number => u !== null) ? round2(units.reduce((a, b) => a + b, 0)) : null,
        boardRule: r.kind === 'paper' && feeKey === 'qualification' ? siblings.find((x) => x.kind === 'all_papers')?.examFee ?? null : null,
        fromLists: listRows.filter((x) => referenceCode && r.referenceKey && x.matchedKey === `${referenceCode}:${r.referenceKey}` && x.id !== r.priceListRowId)
          .map((x) => ({ listId: x.priceListId, listName: lists.find((l) => l.id === x.priceListId)?.name ?? '', code: x.code, amount: x.amount })),
      },
    };
  });
  const offerings = [...new Map(rows.map((r) => [r.offerId, r])).values()];
  return {
    rows: view,
    missing: view.filter((r) => r.ticked && r.examFee === null),
    courseFeeMissing: offerings.filter((o) => o.offerCourseFee === null && rows.some((r) => r.offerId === o.offerId && ticked(r.row) && r.row.courseFee === null))
      .map((o) => ({ offeringId: o.offerId, subject: o.subjectName })),
    lists: lists.map((l) => ({
      id: l.id, board: l.boardCode, name: l.name, updatedAt: l.updatedAt,
      lines: new Set(listRows.filter((x) => x.priceListId === l.id).map((x) => x.lineNo)).size,
      unmatched: listRows.filter((x) => x.priceListId === l.id && !x.matchedKey).map((x) => ({ code: x.code, name: x.name, amount: x.amount })),
    })),
  };
}
