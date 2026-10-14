/**
 * The students first (RESERVATIONS_REWORK.md §6). A reservation takes its student
 * `FOR NO KEY UPDATE` before anything else, so a writer that moves lines into a series (an item's
 * series change, a session's series correction, a subject's board change) must lock the students
 * of those lines before its own rows. It cannot know them for certain until it holds its rows: a
 * reservation already past its student lock may commit a new line while the writer waits. So the
 * writer locks the students it can see, takes its rows, reads the students again, and — when one
 * appeared meanwhile — rolls back and runs again with that student locked first. The order is
 * never broken, so the two never deadlock, and no line moves under a student who is not locked.
 */

import { db, user, inArray } from '@repo/db';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Thrown inside the transaction when the writer's rows show a student it did not lock first. */
export class StudentSetChanged extends Error {
  constructor(readonly students: string[]) {
    super('A reservation landed while this change waited: it runs again with that student locked first');
  }
}

/** Lock students `FOR NO KEY UPDATE`, in id order (the reservation's own lock). */
export async function lockStudents(tx: Tx, ids: Iterable<string>): Promise<Set<string>> {
  const sorted = [...new Set(ids)].sort();
  if (sorted.length) await tx.select({ id: user.id }).from(user).where(inArray(user.id, sorted)).orderBy(user.id).for('no key update');
  return new Set(sorted);
}

/** After the writer's own row locks: every student whose line it moves must be locked already. */
export function assertStudentsLocked(locked: Set<string>, studentIds: Iterable<string>) {
  const extra = [...new Set(studentIds)].filter((s) => !locked.has(s));
  if (extra.length) throw new StudentSetChanged([...locked, ...extra]);
}

/** The refusal when the students kept changing: every route running the pattern answers it with 409. */
export const STUDENTS_KEPT_CHANGING =
  'The students with lines here changed while this change was running (new reservations kept arriving): nothing was changed. Try again.';

/** A fourth newcomer in a row: the change is refused, nothing written (409 on every route). */
export class StudentsKeptChanging extends Error {
  readonly status = 409 as const;
  constructor() {
    super(STUDENTS_KEPT_CHANGING);
  }
}

/**
 * Run a writer's transaction; when it finds a student it did not lock first, run it again with
 * that student among those locked first (`extra`). Three retries: a fourth newcomer is a refusal
 * (`StudentsKeptChanging`, 409 with its sentence; until the review of F1 it reached the client
 * as a 400 or a server error with the internal retry's message).
 */
export async function withStudentsFirst<T>(run: (extra: string[]) => Promise<T>): Promise<T> {
  let extra: string[] = [];
  for (let attempt = 0; ; attempt++) {
    try {
      return await run(extra);
    } catch (err) {
      if (err instanceof StudentSetChanged) {
        if (attempt < 3) {
          extra = err.students;
          continue;
        }
        throw new StudentsKeptChanging();
      }
      throw err;
    }
  }
}
