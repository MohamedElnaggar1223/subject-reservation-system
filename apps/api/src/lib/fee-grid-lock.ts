/**
 * A series' fee grid lock (docs/features/RESERVATIONS.md §2.1; the review of 40c1447).
 *
 * A move of lines reads the fee rows of the series the lines go to after it has locked them; a
 * fee row that existed nowhere when the move began, created and confirmed by finance inside the
 * move's transaction, was read provisional by the move while the Confirm, not yet seeing the moved
 * lines, cleared none — the line stayed provisional on a confirmed row. So the series is taken
 * before its fee rows by both sides: a move **shared**, and every path that creates or confirms a
 * fee row (the grid's put and paste, its copy, copy-from's fees, Confirm) **exclusive**. A finance
 * write and a move into the same series then never overlap; moves do not wait for each other.
 *
 * It is a transaction-scoped advisory lock on the series id, not a mode of the series row: the
 * checkout and a change's approval take the series row FOR SHARE **after** their lines, so a row
 * mode strong enough to conflict with a move's would deadlock a Confirm (series, then lines)
 * against them. Only the paths above take this one, always before their fee rows and lines.
 */

import { db, sql } from '@repo/db';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The advisory namespace of fee grids (the second key is the series id's hash). */
const FEE_GRID = 4041;

/** Take the fee grids of these series, in id order: `move` shared, `write` exclusive. */
export async function lockFeeGrids(tx: Tx, seriesIds: Iterable<string | null | undefined>, mode: 'move' | 'write') {
  const ids = [...new Set([...seriesIds].filter((s): s is string => !!s))].sort();
  for (const id of ids) {
    await tx.execute(mode === 'move'
      ? sql`select pg_advisory_xact_lock_shared(${sql.raw(String(FEE_GRID))}, hashtext(${id}))`
      : sql`select pg_advisory_xact_lock(${sql.raw(String(FEE_GRID))}, hashtext(${id}))`);
  }
}
