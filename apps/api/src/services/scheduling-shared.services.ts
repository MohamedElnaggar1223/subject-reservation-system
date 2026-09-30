/**
 * What every part of scheduling (F1) shares: its refusal type, dates, and
 * who is in a teaching group on a date.
 *
 * Membership on a date (FEATURES_PLAN.md F1; STATE_AUDIT.md ST-16, SO-9):
 * - An enrolment or manual group's students are its member rows; a section
 *   group's students are the section's members on each date.
 * - Two memberships of one student can cover the same day: F0a lets a move be
 *   dated the day the student joined their current section, which ends the old
 *   membership on its own start day (ST-16), and a group move can do the same.
 *   The later membership wins that day — the one that started later, or on
 *   the same start day the one recorded later — so the student is in one
 *   section (and one group per subject) on any date.
 * - Nobody is in any group after the day they left the school. A leaving
 *   dated before the current section's start moves the section's end to its
 *   start day instead of refusing (SO-9); the leaving wins, so that clamped
 *   day holds no lessons either.
 * - A group is not taught from the day it was archived (merged or retired).
 * Dates are the school's calendar dates (YYYY-MM-DD) and a membership's end
 * is its last day (inclusive), as F0a's sections.
 */

import {
  db, teachingGroup, teachingGroupMember, sectionMembership, user, eq, and, inArray, sql, isNull, or,
} from '@repo/db';

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Executor = typeof db | Tx;

/** A refusal with the status the route answers and a sentence for the screen. */
export class SchedulingError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409 = 400) {
    super(message);
  }
}

export const isUniqueViolation = (err: unknown) =>
  (err as { code?: string } | null)?.code === '23505' || (err as { cause?: { code?: string } } | null)?.cause?.code === '23505';

// ─── Dates ───────────────────────────────────────────────────────────────────

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const minDate = (a: string, b: string) => (a < b ? a : b);
export const maxDate = (a: string, b: string) => (a > b ? a : b);

/** "Sunday 5 October 2026". */
export function readableDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** The Sunday that starts the week of a date. */
export function weekStartOf(date: string): string {
  const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addDays(date, -wd);
}

/**
 * A local time in Cairo on a date, as the UTC instant it is (Egypt has kept
 * summer time on and off; the zone database decides).
 */
export function cairoInstant(date: string, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const guess = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), h, m);
  const offsetAt = (ms: number) => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(ms));
    const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute')) - ms;
  };
  let ms = guess - offsetAt(guess);
  ms = guess - offsetAt(ms);
  return new Date(ms);
}

// ─── Who is in a group, date by date ─────────────────────────────────────────

export type MemberInterval = { studentId: string; groupId: string; from: string; to: string };

type Row = { id: string; studentId: string; key: string; startedOn: string; endedOn: string | null; createdAt: Date };

/**
 * Each row's last effective day: a row gives way to the next one of the same
 * student and family (subject, or section) that starts before it ends — the
 * later membership wins a day both cover.
 */
function effectiveEnds(rows: Row[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const byKey = new Map<string, Row[]>();
  for (const r of rows) {
    const k = `${r.studentId}|${r.key}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(r);
  }
  for (const list of byKey.values()) {
    list.sort((a, b) => a.startedOn.localeCompare(b.startedOn) || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    list.forEach((r, i) => {
      let end = r.endedOn;
      const next = list[i + 1];
      if (next && (end === null || next.startedOn <= end)) {
        const cut = addDays(next.startedOn, -1);
        end = end === null || cut < end ? cut : end;
      }
      out.set(r.id, end);
    });
  }
  return out;
}

/**
 * Who is in each of these groups between two dates, as date intervals (a
 * student in and out of a group has several). The rules are the module's:
 * section groups follow the section, the later membership wins a shared day,
 * nobody is in a group after leaving the school, nothing after an archive.
 */
export async function groupMembersBetween(groupIds: string[], from: string, to: string, executor: Executor = db): Promise<MemberInterval[]> {
  if (!groupIds.length || to < from) return [];
  const groups = await executor
    .select({ id: teachingGroup.id, kind: teachingGroup.kind, sectionId: teachingGroup.sectionId, subjectId: teachingGroup.subjectId, academicYearId: teachingGroup.academicYearId, archivedOn: teachingGroup.archivedOn })
    .from(teachingGroup)
    .where(inArray(teachingGroup.id, [...new Set(groupIds)]));
  const out: MemberInterval[] = [];
  const pending: { studentId: string; groupId: string; from: string; to: string }[] = [];

  // Enrolment and manual groups: their member rows, the later one winning a shared day per subject.
  const explicit = groups.filter((g) => g.kind !== 'section');
  if (explicit.length) {
    const rows = await executor
      .select({ id: teachingGroupMember.id, groupId: teachingGroupMember.groupId, studentId: teachingGroupMember.studentId, subjectId: teachingGroupMember.subjectId, academicYearId: teachingGroupMember.academicYearId, startedOn: teachingGroupMember.startedOn, endedOn: teachingGroupMember.endedOn, createdAt: teachingGroupMember.createdAt })
      .from(teachingGroupMember)
      .where(and(
        inArray(teachingGroupMember.groupId, explicit.map((g) => g.id)),
        sql`${teachingGroupMember.startedOn} <= ${to}`,
        or(isNull(teachingGroupMember.endedOn), sql`${teachingGroupMember.endedOn} >= ${from}`),
      ));
    // The same students' other memberships of the same subjects, which may take a shared day.
    const withSubject = rows.filter((r) => r.subjectId);
    const rivals = withSubject.length
      ? await executor
        .select({ id: teachingGroupMember.id, groupId: teachingGroupMember.groupId, studentId: teachingGroupMember.studentId, subjectId: teachingGroupMember.subjectId, academicYearId: teachingGroupMember.academicYearId, startedOn: teachingGroupMember.startedOn, endedOn: teachingGroupMember.endedOn, createdAt: teachingGroupMember.createdAt })
        .from(teachingGroupMember)
        .where(and(
          inArray(teachingGroupMember.studentId, [...new Set(withSubject.map((r) => r.studentId))]),
          inArray(teachingGroupMember.subjectId, [...new Set(withSubject.map((r) => r.subjectId!))]),
          sql`${teachingGroupMember.startedOn} <= ${to}`,
          or(isNull(teachingGroupMember.endedOn), sql`${teachingGroupMember.endedOn} >= ${from}`),
        ))
      : [];
    const all = new Map([...rows, ...rivals].map((r) => [r.id, r]));
    const ends = effectiveEnds([...all.values()].map((r) => ({
      id: r.id, studentId: r.studentId, key: r.subjectId ? `${r.academicYearId}|${r.subjectId}` : `group|${r.groupId}`, startedOn: r.startedOn, endedOn: r.endedOn, createdAt: r.createdAt,
    })));
    for (const r of rows) pending.push({ studentId: r.studentId, groupId: r.groupId, from: r.startedOn, to: ends.get(r.id) ?? '9999-12-31' });
  }

  // Section groups: the section's students on each date, one section at a time per year.
  const sectional = groups.filter((g) => g.kind === 'section' && g.sectionId);
  if (sectional.length) {
    const inSections = await executor
      .select({ studentId: sectionMembership.studentId })
      .from(sectionMembership)
      .where(and(
        inArray(sectionMembership.sectionId, sectional.map((g) => g.sectionId!)),
        sql`${sectionMembership.startedOn} <= ${to}`,
        or(isNull(sectionMembership.endedOn), sql`${sectionMembership.endedOn} >= ${from}`),
      ));
    const studentIds = [...new Set(inSections.map((r) => r.studentId))];
    if (studentIds.length) {
      const years = [...new Set(sectional.map((g) => g.academicYearId))];
      const rows = await executor
        .select({ id: sectionMembership.id, sectionId: sectionMembership.sectionId, studentId: sectionMembership.studentId, academicYearId: sectionMembership.academicYearId, startedOn: sectionMembership.startedOn, endedOn: sectionMembership.endedOn, createdAt: sectionMembership.createdAt })
        .from(sectionMembership)
        .where(and(inArray(sectionMembership.studentId, studentIds), inArray(sectionMembership.academicYearId, years)));
      const ends = effectiveEnds(rows.map((r) => ({ id: r.id, studentId: r.studentId, key: r.academicYearId, startedOn: r.startedOn, endedOn: r.endedOn, createdAt: r.createdAt })));
      for (const g of sectional) {
        for (const r of rows) {
          if (r.sectionId !== g.sectionId) continue;
          pending.push({ studentId: r.studentId, groupId: g.id, from: r.startedOn, to: ends.get(r.id) ?? '9999-12-31' });
        }
      }
    }
  }

  // Nobody after leaving; nothing after an archive; only the asked dates.
  const studentIds = [...new Set(pending.map((p) => p.studentId))];
  const left = studentIds.length
    ? new Map((await executor.select({ id: user.id, leftOn: user.leftOn }).from(user).where(inArray(user.id, studentIds))).map((u) => [u.id, u.leftOn]))
    : new Map<string, string | null>();
  const archived = new Map(groups.map((g) => [g.id, g.archivedOn]));
  for (const p of pending) {
    let a = maxDate(p.from, from);
    let b = minDate(p.to, to);
    const l = left.get(p.studentId);
    if (l) b = minDate(b, l);
    const arch = archived.get(p.groupId);
    if (arch) b = minDate(b, addDays(arch, -1));
    if (a <= b) out.push({ studentId: p.studentId, groupId: p.groupId, from: a, to: b });
  }
  out.sort((x, y) => x.groupId.localeCompare(y.groupId) || x.studentId.localeCompare(y.studentId) || x.from.localeCompare(y.from));
  return out;
}

/** The groups a student is in on some day between two dates (then read with groupMembersBetween). */
export async function candidateGroupsOfStudent(studentId: string, from: string, to: string, executor: Executor = db): Promise<string[]> {
  const explicit = await executor
    .select({ groupId: teachingGroupMember.groupId })
    .from(teachingGroupMember)
    .where(and(
      eq(teachingGroupMember.studentId, studentId),
      sql`${teachingGroupMember.startedOn} <= ${to}`,
      or(isNull(teachingGroupMember.endedOn), sql`${teachingGroupMember.endedOn} >= ${from}`),
    ));
  const sections = await executor
    .select({ sectionId: sectionMembership.sectionId })
    .from(sectionMembership)
    .where(and(
      eq(sectionMembership.studentId, studentId),
      sql`${sectionMembership.startedOn} <= ${to}`,
      or(isNull(sectionMembership.endedOn), sql`${sectionMembership.endedOn} >= ${from}`),
    ));
  const sectionGroups = sections.length
    ? await executor.select({ id: teachingGroup.id }).from(teachingGroup)
      .where(and(eq(teachingGroup.kind, 'section'), inArray(teachingGroup.sectionId, sections.map((s) => s.sectionId))))
    : [];
  return [...new Set([...explicit.map((r) => r.groupId), ...sectionGroups.map((g) => g.id)])];
}

/** The most students a group holds on any one day, from its intervals. */
export function peakSize(intervals: MemberInterval[]): number {
  const events: [string, number][] = [];
  for (const i of intervals) {
    events.push([i.from, 1]);
    events.push([addDays(i.to, 1), -1]);
  }
  events.sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]);
  let n = 0;
  let peak = 0;
  for (const [, d] of events) {
    n += d;
    if (n > peak) peak = n;
  }
  return peak;
}

/** Pairs of groups that share a student on a common day, with how many students. */
export function overlapsOf(intervals: MemberInterval[]): { a: string; b: string; students: number }[] {
  const byStudent = new Map<string, MemberInterval[]>();
  for (const i of intervals) {
    if (!byStudent.has(i.studentId)) byStudent.set(i.studentId, []);
    byStudent.get(i.studentId)!.push(i);
  }
  const pairs = new Map<string, Set<string>>();
  for (const [studentId, list] of byStudent) {
    for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
      const p = list[x]!;
      const q = list[y]!;
      if (p.groupId === q.groupId) continue;
      if (p.from > q.to || q.from > p.to) continue;
      const [a, b] = [p.groupId, q.groupId].sort() as [string, string];
      const k = `${a}|${b}`;
      if (!pairs.has(k)) pairs.set(k, new Set());
      pairs.get(k)!.add(studentId);
    }
  }
  return [...pairs.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([k, s]) => {
    const [a, b] = k.split('|') as [string, string];
    return { a, b, students: s.size };
  });
}
