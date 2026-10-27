/**
 * The reference loader (COORDINATOR_REWORK.md §7, §7.1, §11): the data we maintain — the boards with
 * their rules and sittings (board dates), and per board the subjects with their suggested rows —
 * loaded into `exam_board`, `board_series`, `reference_subject` and `reference_row`.
 *
 * Idempotent: loading the same data twice changes nothing the second time; loading new data makes
 * the reference tables equal to it (a subject or a row no longer in the data is removed — offerings
 * keep the code they were made from, with no foreign key to it). A board date the data leaves empty
 * keeps a date the admin entered from the check list (C6: "once, and it joins the reference data");
 * a date the data gives replaces any other — one the data itself filled included (each deadline's source is
 * kept on its own, `admin_deadlines`: P1b fix 3).
 *
 * Callable from the seed (`pnpm --filter @repo/db seed:reference`, which reads
 * packages/db/reference/*.json — P0's files) and from the integration suite with in-memory data.
 *
 * The shapes are P0's (`@repo/validations` offering/reference.ts): the seed reads the files through its
 * schemas (`scripts/reference-files.ts`), and a test parses its in-memory data through them before loading.
 */

import { randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { BoardsFile, SubjectsFile, ReferenceBoardCode } from '@repo/validations';
import type * as schema from './schema';

/**
 * The directory of the reference data files (packages/db/reference), found from this module wherever it runs —
 * from src (tsx) or from dist (the built package the API runs): the nearest ancestor holding reference/boards.json.
 */
export function referenceDataDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'reference');
    if (existsSync(join(candidate, 'boards.json'))) return candidate;
    dir = dirname(dir);
  }
  throw new Error('The reference data files (packages/db/reference/boards.json) were not found');
}

/**
 * The reference data files as JSON, not yet parsed: boards.json and subjects/<board>.json for each board named.
 * The caller parses them through P0's schemas (@repo/validations) before loading them (P1c: the API loads them at
 * its start, so every database it runs on holds the board's list).
 */
export function readReferenceDataFiles(boardCodes: readonly string[]): { boards: unknown; subjects: Record<string, unknown> } {
  const dir = referenceDataDir();
  const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as unknown;
  return {
    boards: read(join(dir, 'boards.json')),
    subjects: Object.fromEntries(boardCodes.map((code) => [code, read(join(dir, 'subjects', `${code}.json`))])),
  };
}

/** What the loader takes: the boards file and, per board, its subjects file (parsed by P0's schemas). */
export type ReferenceData = {
  boards: BoardsFile;
  subjects: Partial<Record<ReferenceBoardCode, SubjectsFile>>;
};

/**
 * `adminDatesKept`: a sitting whose deadline the admin entered from the check list (dates_source 'admin', C6)
 * and that the file now gives a different date for — the admin's is kept; someone checks which is right.
 */
export type ReferenceLoadResult = {
  boards: number; sittings: number; subjects: number; rows: number; removedSubjects: number; removedRows: number;
  adminDatesKept: string[];
};

const cairoDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d);

/**
 * The admin's deadlines (C6) the file disagrees with, as sentences — each deadline on its own (the entry and the
 * retake deadline): one she entered and the file gives differently. One she left empty is filled from the file.
 */
export function adminDateDisagreements(
  sitting: string, admin: { entry: Date | null; retake: Date | null }, file: { entry: string | null; retake: string | null },
): string[] {
  const out: string[] = [];
  for (const [which, mine, theirs] of [['entry', admin.entry, file.entry], ['retake', admin.retake, file.retake]] as const) {
    if (mine && theirs && cairoDay(mine) !== theirs) out.push(`${sitting}: the file gives the ${which} deadline ${theirs}, the admin entered ${cairoDay(mine)} — the admin's is kept; check which is right`);
  }
  return out;
}

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

/** Load the reference data into the database (see the header). Runs in its own transaction, or the caller's. */
export async function loadReference(executor: Db | Tx, data: ReferenceData, opts: { actorId?: string | null } = {}): Promise<ReferenceLoadResult> {
  const run = async (tx: Tx | Db) => {
    const out: ReferenceLoadResult = { boards: 0, sittings: 0, subjects: 0, rows: 0, removedSubjects: 0, removedRows: 0, adminDatesKept: [] };
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
        const [kept] = (await tx.execute(sql`
          select entry_deadline as entry, retake_deadline as retake, admin_deadlines as mine from board_series
          where board_code = ${b.code} and month = ${month} and year = ${s.year} and label = '' and cardinality(admin_deadlines) > 0`)).rows as {
            entry: string | Date | null; retake: string | Date | null; mine: string[];
          }[];
        if (kept) {
          // Only the dates she entered: one the file filled is the file's to replace.
          const hers = (which: 'entry' | 'retake', v: string | Date | null) => (v === null || !kept.mine.includes(which) ? null : new Date(v));
          out.adminDatesKept.push(...adminDateDisagreements(`${b.code} ${month} ${s.year}`, { entry: hers('entry', kept.entry), retake: hers('retake', kept.retake) }, { entry: s.entryDeadline, retake: s.retakeDeadline }));
        }
        await tx.execute(sql`
          insert into board_series (id, board_code, month, year, label, entry_deadline, retake_deadline, exams_start, dates_source, dates_confirmed, levels)
          values (${randomUUID()}, ${b.code}, ${month}, ${s.year}, '', ${entry}, ${retake}, ${s.examsStart}, ${s.source}, ${s.confirmed}, ${textArray(s.levels)})
          on conflict (board_code, month, year, label) do update set
            levels = excluded.levels,
            -- C6: a deadline the admin entered from the check list (admin_deadlines) is kept; every other is the
            -- file's — filled where she left it empty, and replaced by a later file (P1b fix 3).
            entry_deadline = case when 'entry' = any(board_series.admin_deadlines) then board_series.entry_deadline
                                  else coalesce(excluded.entry_deadline, board_series.entry_deadline) end,
            retake_deadline = case when 'retake' = any(board_series.admin_deadlines) then board_series.retake_deadline
                                   else coalesce(excluded.retake_deadline, board_series.retake_deadline) end,
            exams_start = coalesce(excluded.exams_start, board_series.exams_start),
            dates_source = case when board_series.dates_source = 'admin' then 'admin' else excluded.dates_source end,
            dates_confirmed = case when board_series.dates_source = 'admin' then board_series.dates_confirmed else excluded.dates_confirmed end,
            updated_at = case when (board_series.dates_source is distinct from 'admin' and (
                                      board_series.dates_source is distinct from excluded.dates_source
                                   or board_series.dates_confirmed is distinct from excluded.dates_confirmed))
                                 or (not 'entry' = any(board_series.admin_deadlines)
                                     and board_series.entry_deadline is distinct from coalesce(excluded.entry_deadline, board_series.entry_deadline))
                                 or (not 'retake' = any(board_series.admin_deadlines)
                                     and board_series.retake_deadline is distinct from coalesce(excluded.retake_deadline, board_series.retake_deadline))
                                 or board_series.exams_start is distinct from coalesce(excluded.exams_start, board_series.exams_start)
                                 or board_series.levels is distinct from excluded.levels
                              then now() else board_series.updated_at end`);
        out.sittings++;
      }
    }
    for (const [board, subjects] of Object.entries(data.subjects) as [string, SubjectsFile][]) {
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
