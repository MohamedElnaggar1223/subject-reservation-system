/**
 * The reference loader (COORDINATOR_REWORK.md §7, §7.1, §11): the data we maintain — the boards with
 * their rules and sittings (board dates), and per board the subjects with their suggested rows —
 * loaded into `exam_board`, `board_series`, `reference_subject` and `reference_row`.
 *
 * Idempotent: loading the same data twice changes nothing the second time; loading new data makes
 * the reference tables equal to it (a subject or a row no longer in the data is removed — offerings
 * keep the code they were made from, with no foreign key to it). A board date the data leaves empty
 * keeps a date the admin entered from the check list (C6: "once, and it joins the reference data");
 * a date the data gives replaces it.
 *
 * Callable from the seed (`pnpm --filter @repo/db seed:reference`, which reads
 * packages/db/reference/*.json — P0's files) and from the integration suite with in-memory data.
 *
 * PENDING P0's merge: the shapes below are P0's (`@repo/validations` offering/reference.ts —
 * BoardsFile, SubjectsFile: a sitting's `levels`, a row's `winterSitting`, the notes); on its merge they
 * are imported from there, and the seed parses the files with P0's schemas before loading them.
 */

import { randomUUID } from 'crypto';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from './schema';

export type ReferenceSitting = {
  month: 1 | 6 | 10 | 11;
  year: number;
  /** The levels the board sits that month ('igcse', 'as_al'): a winter row's "November" finds its sitting by level. */
  levels: ('igcse' | 'as_al')[];
  entryDeadline: string | null;
  retakeDeadline: string | null;
  examsStart: string | null;
  source: string;
  confirmed: boolean;
  note?: string;
};

export type ReferenceBoard = {
  code: 'cambridge' | 'pearson_edexcel' | 'oxford';
  name: string;
  onePaperFee: 'syllabus' | 'paper';
  onePaperAsksSitting: boolean;
  carryForwardMonths: number | null;
  note?: string;
  sittings: ReferenceSitting[];
  aliases: { printed: string; subject: string; row: string; note?: string }[];
};

export type ReferenceRowData = {
  key: string;
  kind: 'all_papers' | 'paper' | 'unit' | 'as' | 'a2' | 'al' | 'qualification';
  codes: string[];
  priceCodes: string[];
  short?: string;
  label: { en: string; ar: string };
  sumOfUnits?: string[];
  /** The row's own winter sitting where it differs from the subject's; null: not sat in winter. */
  winterSitting?: 'november' | 'january' | null;
  note?: string;
};

export type ReferenceSubjectData = {
  code: string;
  name: string;
  group: 'O.L.' | 'A.S./A.L.';
  level: 'igcse' | 'as_al';
  confirmed: boolean;
  note?: string;
  winterSitting: 'november' | 'january' | null;
  rows: ReferenceRowData[];
};

export type ReferenceData = {
  boards: ReferenceBoard[];
  /** Per board code: its subjects (packages/db/reference/subjects/<board>.json). */
  subjects: Partial<Record<ReferenceBoard['code'], ReferenceSubjectData[]>>;
};

export type ReferenceLoadResult = { boards: number; sittings: number; subjects: number; rows: number; removedSubjects: number; removedRows: number };

const MONTHS: Record<number, string> = { 1: 'january', 6: 'june', 10: 'october', 11: 'november' };
const MONTH_ORDER = ['january', 'june', 'october', 'november'];

type Db = NodePgDatabase<typeof schema>;

/** A text[] value: drizzle expands a JS array in a template into a list of parameters, not one array. */
const textArray = (xs: readonly string[]) => (xs.length ? sql`ARRAY[${sql.join(xs.map((x) => sql`${x}`), sql`, `)}]::text[]` : sql`'{}'::text[]`);
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * A reference date ('YYYY-MM-DD') as an instant: the end of that day in Cairo (the school reads a
 * board's deadline as its whole day; the instant stays inside the day in summer and winter time).
 */
export function referenceDeadline(d: string | null): Date | null {
  if (!d) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) throw new Error(`Not a date (YYYY-MM-DD): ${d}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 20, 59, 0));
}

/** The same checks P0's schema makes, enough to refuse a malformed file before anything is written. */
export function assertReferenceData(data: ReferenceData): void {
  const fail = (msg: string) => { throw new Error(`Reference data: ${msg}`); };
  if (!Array.isArray(data.boards) || !data.boards.length) fail('no boards');
  for (const b of data.boards) {
    if (!['cambridge', 'pearson_edexcel', 'oxford'].includes(b.code)) fail(`unknown board ${b.code}`);
    if (!['syllabus', 'paper'].includes(b.onePaperFee)) fail(`${b.code}: onePaperFee`);
    for (const s of b.sittings ?? []) {
      if (!MONTHS[s.month]) fail(`${b.code}: sitting month ${s.month}`);
      if (!s.levels?.length || s.levels.some((l) => l !== 'igcse' && l !== 'as_al')) fail(`${b.code}: the levels of ${s.month}/${s.year}`);
      for (const d of [s.entryDeadline, s.retakeDeadline, s.examsStart]) if (d !== null && !/^\d{4}-\d{2}-\d{2}$/.test(d)) fail(`${b.code}: date ${d}`);
    }
  }
  for (const [board, subjects] of Object.entries(data.subjects)) {
    if (!data.boards.some((b) => b.code === board)) fail(`subjects of a board not listed: ${board}`);
    const codes = new Set<string>();
    for (const s of subjects ?? []) {
      if (!s.code) fail(`${board}: a subject with no code (a subject not on a list we hold loads as "not on the list")`);
      if (codes.has(s.code)) fail(`${board}: ${s.code} twice`);
      codes.add(s.code);
      if (!['O.L.', 'A.S./A.L.'].includes(s.group)) fail(`${board} ${s.code}: group ${s.group}`);
      if (!['igcse', 'as_al'].includes(s.level)) fail(`${board} ${s.code}: level ${s.level}`);
      const keys = new Set<string>();
      for (const r of s.rows) {
        if (keys.has(r.key)) fail(`${board} ${s.code}: row ${r.key} twice`);
        keys.add(r.key);
        if (!['all_papers', 'paper', 'unit', 'as', 'a2', 'al', 'qualification'].includes(r.kind)) fail(`${board} ${s.code} ${r.key}: kind ${r.kind}`);
        if (!r.label?.en || !r.label?.ar) fail(`${board} ${s.code} ${r.key}: a label in English and Arabic`);
      }
      for (const r of s.rows) for (const k of r.sumOfUnits ?? []) if (!keys.has(k)) fail(`${board} ${s.code} ${r.key}: sums ${k}, not a row of the subject`);
    }
  }
}

/** Load the reference data into the database (see the header). Runs in its own transaction, or the caller's. */
export async function loadReference(executor: Db | Tx, data: ReferenceData, opts: { actorId?: string | null } = {}): Promise<ReferenceLoadResult> {
  assertReferenceData(data);
  const run = async (tx: Tx | Db) => {
    const out: ReferenceLoadResult = { boards: 0, sittings: 0, subjects: 0, rows: 0, removedSubjects: 0, removedRows: 0 };
    for (const b of data.boards) {
      const months = [...new Set(b.sittings.map((s) => MONTHS[s.month]!))];
      await tx.execute(sql`
        insert into exam_board (code, name, short_name, series_months, carry_forward_months, one_paper_fee_key, one_paper_asks_sitting, reference_aliases)
        values (${b.code}, ${b.name}, ${b.name}, ${JSON.stringify(months)}::jsonb, ${b.carryForwardMonths},
          ${b.onePaperFee === 'syllabus' ? 'qualification' : 'unit'}, ${b.onePaperAsksSitting}, ${JSON.stringify(b.aliases ?? [])}::jsonb)
        on conflict (code) do update set
          series_months = (select coalesce(jsonb_agg(m order by array_position(${textArray(MONTH_ORDER)}, m)), '[]'::jsonb)
                           from (select distinct jsonb_array_elements_text(exam_board.series_months || excluded.series_months) as m) x),
          carry_forward_months = excluded.carry_forward_months,
          one_paper_fee_key = excluded.one_paper_fee_key,
          one_paper_asks_sitting = excluded.one_paper_asks_sitting,
          reference_aliases = excluded.reference_aliases,
          updated_at = case when (exam_board.carry_forward_months is distinct from excluded.carry_forward_months
                                  or exam_board.one_paper_fee_key is distinct from excluded.one_paper_fee_key
                                  or exam_board.one_paper_asks_sitting is distinct from excluded.one_paper_asks_sitting
                                  or exam_board.reference_aliases is distinct from excluded.reference_aliases)
                            then now() else exam_board.updated_at end`);
      out.boards++;
      for (const s of b.sittings) {
        const month = MONTHS[s.month]!;
        const entry = referenceDeadline(s.entryDeadline);
        const retake = referenceDeadline(s.retakeDeadline);
        await tx.execute(sql`
          insert into board_series (id, board_code, month, year, label, entry_deadline, retake_deadline, exams_start, dates_source, dates_confirmed, levels)
          values (${randomUUID()}, ${b.code}, ${month}, ${s.year}, '', ${entry}, ${retake}, ${s.examsStart}, ${s.source}, ${s.confirmed}, ${textArray(s.levels)})
          on conflict (board_code, month, year, label) do update set
            levels = excluded.levels,
            entry_deadline = coalesce(excluded.entry_deadline, board_series.entry_deadline),
            retake_deadline = coalesce(excluded.retake_deadline, board_series.retake_deadline),
            exams_start = coalesce(excluded.exams_start, board_series.exams_start),
            dates_source = excluded.dates_source,
            dates_confirmed = excluded.dates_confirmed,
            updated_at = case when (board_series.entry_deadline is distinct from coalesce(excluded.entry_deadline, board_series.entry_deadline)
                                    or board_series.retake_deadline is distinct from coalesce(excluded.retake_deadline, board_series.retake_deadline)
                                    or board_series.exams_start is distinct from coalesce(excluded.exams_start, board_series.exams_start)
                                    or board_series.dates_source is distinct from excluded.dates_source
                                    or board_series.dates_confirmed is distinct from excluded.dates_confirmed
                                    or board_series.levels is distinct from excluded.levels)
                              then now() else board_series.updated_at end`);
        out.sittings++;
      }
    }
    for (const [board, subjects] of Object.entries(data.subjects) as [string, ReferenceSubjectData[]][]) {
      const keep: string[] = [];
      for (const [i, s] of subjects.entries()) {
        const id = `${board}:${s.code}`;
        keep.push(id);
        await tx.execute(sql`
          insert into reference_subject (id, board_code, code, name, "group", level, confirmed, note, winter_sitting, sort_order, loaded_at)
          values (${id}, ${board}, ${s.code}, ${s.name}, ${s.group}, ${s.level}, ${s.confirmed}, ${s.note ?? null}, ${s.winterSitting}, ${i}, now())
          on conflict (id) do update set name = excluded.name, "group" = excluded."group", level = excluded.level, confirmed = excluded.confirmed,
            note = excluded.note, winter_sitting = excluded.winter_sitting, sort_order = excluded.sort_order`);
        out.subjects++;
        const rowIds: string[] = [];
        for (const [j, r] of s.rows.entries()) {
          const rowId = `${id}:${r.key}`;
          rowIds.push(rowId);
          await tx.execute(sql`
            insert into reference_row (id, reference_subject_id, key, kind, codes, price_codes, short, label_en, label_ar, sum_of_units, winter_sitting, sort_order)
            values (${rowId}, ${id}, ${r.key}, ${r.kind}, ${textArray(r.codes)}, ${textArray(r.priceCodes)}, ${r.short ?? null}, ${r.label.en}, ${r.label.ar},
              ${textArray(r.sumOfUnits ?? [])}, ${r.winterSitting === null ? 'none' : r.winterSitting ?? null}, ${j})
            on conflict (id) do update set kind = excluded.kind, codes = excluded.codes, price_codes = excluded.price_codes, short = excluded.short,
              label_en = excluded.label_en, label_ar = excluded.label_ar, sum_of_units = excluded.sum_of_units, winter_sitting = excluded.winter_sitting,
              sort_order = excluded.sort_order`);
          out.rows++;
        }
        const removed = await tx.execute(sql`
          delete from reference_row where reference_subject_id = ${id}
            ${rowIds.length ? sql`and id not in (${sql.join(rowIds.map((x) => sql`${x}`), sql`, `)})` : sql``}
          returning id`);
        out.removedRows += removed.rows.length;
      }
      const gone = await tx.execute(sql`
        delete from reference_subject where board_code = ${board}
          ${keep.length ? sql`and id not in (${sql.join(keep.map((x) => sql`${x}`), sql`, `)})` : sql``}
        returning id`);
      out.removedSubjects += gone.rows.length;
    }
    await tx.execute(sql`
      insert into audit_log (id, user_id, action, entity_type, entity_id, previous_data, new_data)
      values (${randomUUID()}, ${opts.actorId ?? null}, 'REFERENCE_DATA_LOADED', 'reference', 'reference', null, ${JSON.stringify(out)}::jsonb)`);
    return out;
  };
  if ('transaction' in executor && typeof (executor as Db).transaction === 'function' && !('rollback' in executor)) {
    return (executor as Db).transaction(run);
  }
  return run(executor);
}
