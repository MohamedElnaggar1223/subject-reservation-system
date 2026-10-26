/**
 * D4's duplicate check (COORDINATOR_REWORK.md §1, Q15): a new teacher's name against the school's
 * list, by spelling and initials — an invented example of each kind §1 found: "Ms. Hoda" against
 * "Huda Fawzy" (a title and a first name), "Sara Kamel" against "Sarah Kamel", "Ra'ouf Nabil" against
 * "Raouf Nabil", "Dina El Masry" against "Dena Elmasry" — so one person is not entered twice under two
 * spellings (six such disagreements reached families in the June 2027 set; their names stay out of the
 * repository).
 *
 * Two names may be one person when every word of the shorter one matches a different word of the
 * other — the same word, one letter apart (words of three letters or more), or an initial — and at
 * least one matched word is more than an initial. Titles (Mr, Ms, Dr…), punctuation and an "El"
 * written apart are ignored.
 */

import { db, teacher, eq } from '@repo/db';

const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'mx', 'eng', 'mister', 'madam', 'mme', 'sir']);

/** A name's words, as the check compares them. */
export function nameWords(name: string): string[] {
  const words = name
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’'`]/g, '')
    .replace(/[.\-_,()]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !TITLES.has(w));
  // "El Masry" and "Elmasry" are one word.
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if ((w === 'el' || w === 'al') && i + 1 < words.length) {
      out.push(w + words[i + 1]!);
      i++;
    } else out.push(w);
  }
  return out;
}

function distance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[b.length]!;
}

/** How two words match: 'same', 'spelling' (one letter apart), 'initial', or null. */
function wordMatch(a: string, b: string): 'same' | 'spelling' | 'initial' | null {
  if (a === b) return 'same';
  if ((a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b))) return 'initial';
  if (Math.min(a.length, b.length) >= 3 && distance(a, b) <= 1) return 'spelling';
  return null;
}

/** Why two names may be one person (null: they are not alike). */
export function sameTeacherReason(a: string, b: string): 'same name' | 'spelling' | 'initials' | null {
  const wa = nameWords(a);
  const wb = nameWords(b);
  if (!wa.length || !wb.length) return null;
  if (wa.join('') === wb.join('')) return 'same name';
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  const used = new Set<number>();
  let full = 0;
  let initials = 0;
  let spelling = 0;
  for (const w of short) {
    let best: { i: number; m: 'same' | 'spelling' | 'initial' } | null = null;
    for (let i = 0; i < long.length; i++) {
      if (used.has(i)) continue;
      const m = wordMatch(w, long[i]!);
      if (!m) continue;
      if (!best || (m === 'same' && best.m !== 'same')) best = { i, m };
    }
    if (!best) return null;
    used.add(best.i);
    if (best.m === 'initial') initials++;
    else full++;
    if (best.m === 'spelling') spelling++;
  }
  if (full === 0) return null;
  return initials ? 'initials' : spelling ? 'spelling' : 'same name';
}

type Executor = Pick<typeof db, 'select'>;

/** The school's active teachers a name may be (GET /teachers/duplicates; the subject editor's new names). */
export async function teacherDuplicates(executor: Executor, name: string) {
  const all = await executor.select({ id: teacher.id, name: teacher.name, kind: teacher.kind }).from(teacher).where(eq(teacher.isActive, true));
  return all
    .map((t) => ({ ...t, reason: sameTeacherReason(name, t.name) }))
    .filter((t): t is typeof t & { reason: NonNullable<typeof t.reason> } => t.reason !== null)
    .sort((x, y) => x.name.localeCompare(y.name));
}

/** The refusal of a new name that looks like a teacher already on the list (D4). */
export function duplicateTeacherRefusal(name: string, dups: { name: string }[]) {
  return `"${name}" looks like ${dups.map((d) => `"${d.name}"`).join(', ')} already on the school's list: pick that teacher, or confirm "${name}" is someone new`;
}
