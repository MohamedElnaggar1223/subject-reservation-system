/**
 * Exam days (FEATURES_PLAN.md F4, "Exam timetables and exam days"): each
 * sitting (a date and session, whatever the board — a Cambridge and a
 * Pearson paper the same morning share the hall), its rooms with their seat
 * grids, the seating plan (no seat holds two candidates, no candidate has two
 * seats: the database's two unique indexes), the invigilators (one room each
 * per sitting, one for every N candidates — a setting), the boards'
 * attendance registers marked in the room, and special consideration.
 *
 * A teacher sees their own invigilation duties and the register of the room
 * they invigilate, nothing else.
 */

import {
  db, examPaper, examEntry, examRoomSitting, examSeat, examInvigilation, examAttendance, examSpecialConsideration, room, teacher, user, file,
  eq, and, inArray, sql, asc, gte, lte,
} from '@repo/db';
import { randomUUID } from 'crypto';
import {
  ACADEMIC_ROLES, EXAM_SESSION_LABELS, hasRole, schoolDateString, seatLabel,
  type AssignSeatType, type CreateSpecialConsiderationType, type ExamSession, type MarkRegisterType, type SetInvigilatorsType,
  type SetSittingRoomsType, type SittingKeyType, type UpdateSpecialConsiderationType,
} from '@repo/validations';
import { logAction, type AuditContext } from './audit.services';
import { getSetting } from './settings.services';
import { candidatesOf } from './exam-candidate.services';
import { paperContext } from './exam-timetable.services';
import { ExamError, advisoryLock, boardNameMap, centreFor, isUniqueViolation, seriesOrThrow, violatedConstraint, type Executor } from './exam-shared';

type Actor = { id: string; role?: string | null };

const sittingName = (k: { examDate: string; session: string }) => `${k.examDate} ${EXAM_SESSION_LABELS[k.session as ExamSession]?.toLowerCase() ?? k.session}`;

/** The papers of a sitting and who sits each (live entries), across every series. */
async function sittingPapers(k: SittingKeyType, executor: Executor = db) {
  const papers = await executor.select().from(examPaper)
    .where(and(eq(examPaper.examDate, k.examDate), eq(examPaper.session, k.session))).orderBy(asc(examPaper.startTime), asc(examPaper.code));
  if (!papers.length) return { papers: [], sitters: new Map<string, string[]>(), entries: [] as (typeof examEntry.$inferSelect)[] };
  const entries = await executor.select().from(examEntry)
    .where(and(inArray(examEntry.boardSeriesId, [...new Set(papers.map((p) => p.boardSeriesId))]), sql`${examEntry.status} <> 'withdrawn'`));
  const { papersOf } = await paperContext(entries, executor);
  // paperId → students
  const sitters = new Map<string, string[]>(papers.map((p) => [p.id, []]));
  for (const e of entries) {
    for (const p of papersOf(e)) {
      if (sitters.has(p.id) && !sitters.get(p.id)!.includes(e.studentId)) sitters.get(p.id)!.push(e.studentId);
    }
  }
  return { papers, sitters, entries };
}

async function candidateNumbersFor(pairs: { studentId: string; boardSeriesId: string }[]) {
  if (!pairs.length) return new Map<string, string>();
  const rows = await db.execute(sql`
    select student_id as "studentId", board_series_id as "seriesId", number from exam_candidate_number
    where board_series_id in (${sql.join([...new Set(pairs.map((p) => p.boardSeriesId))].map((id) => sql`${id}`), sql`, `)})`);
  return new Map((rows.rows as { studentId: string; seriesId: string; number: string }[]).map((r) => [`${r.studentId}|${r.seriesId}`, r.number]));
}

// ─── Sittings ────────────────────────────────────────────────────────────────

/**
 * The sittings of a series (or of a date range, default the next 60 days):
 * each with its papers and candidates, the rooms set for it and their seats,
 * how many are still unseated, and whether each room has enough invigilators.
 */
export async function listSittings(q: { boardSeriesId?: string; from?: string; to?: string }) {
  const today = schoolDateString(new Date());
  const from = q.from ?? (q.boardSeriesId ? undefined : today);
  const to = q.to ?? (q.boardSeriesId ? undefined : schoolDateString(new Date(Date.now() + 60 * 86_400_000)));
  const keys = await db.selectDistinct({ examDate: examPaper.examDate, session: examPaper.session }).from(examPaper)
    .where(and(
      q.boardSeriesId ? eq(examPaper.boardSeriesId, q.boardSeriesId) : undefined,
      from ? gte(examPaper.examDate, from) : undefined,
      to ? lte(examPaper.examDate, to) : undefined,
    ))
    .orderBy(asc(examPaper.examDate), asc(examPaper.session));
  const ratio = await getSetting('exams.candidatesPerInvigilator');
  const names = await boardNameMap();
  const out = [];
  for (const k of keys) {
    const key = { examDate: k.examDate, session: k.session as ExamSession };
    const { papers, sitters } = await sittingPapers(key);
    const candidates = new Set([...sitters.values()].flat());
    const [rooms, seats, invig] = await Promise.all([
      db.select({ roomId: examRoomSitting.roomId, name: room.name, seatRows: examRoomSitting.seatRows, seatColumns: examRoomSitting.seatColumns })
        .from(examRoomSitting).innerJoin(room, eq(room.id, examRoomSitting.roomId))
        .where(and(eq(examRoomSitting.examDate, k.examDate), eq(examRoomSitting.session, k.session))).orderBy(asc(room.name)),
      db.select({ roomId: examSeat.roomId, studentId: examSeat.studentId }).from(examSeat)
        .where(and(eq(examSeat.examDate, k.examDate), eq(examSeat.session, k.session))),
      db.select({ roomId: examInvigilation.roomId, n: sql<number>`count(*)::int` }).from(examInvigilation)
        .where(and(eq(examInvigilation.examDate, k.examDate), eq(examInvigilation.session, k.session))).groupBy(examInvigilation.roomId),
    ]);
    out.push({
      ...key,
      papers: papers.map((p) => ({
        id: p.id, code: p.code, title: p.title, startTime: p.startTime, durationMinutes: p.durationMinutes, boardSeriesId: p.boardSeriesId,
        boardName: names.get(p.boardCode) ?? p.boardCode, candidates: sitters.get(p.id)?.length ?? 0,
      })),
      candidates: candidates.size,
      seated: seats.filter((s) => candidates.has(s.studentId)).length,
      rooms: rooms.map((r) => {
        const seated = seats.filter((s) => s.roomId === r.roomId).length;
        const invigilators = invig.find((i) => i.roomId === r.roomId)?.n ?? 0;
        return { ...r, capacity: r.seatRows * r.seatColumns, seated, invigilators, invigilatorsNeeded: seated ? Math.ceil(seated / ratio) : 0 };
      }),
    });
  }
  return { candidatesPerInvigilator: ratio, sittings: out };
}

/**
 * One sitting's plan: each room's grid with who sits where (their candidate
 * number for the paper they sit, the papers), the candidates still without
 * a seat, and the invigilators of each room.
 */
export async function getSittingPlan(k: SittingKeyType) {
  const { papers, sitters } = await sittingPapers(k);
  const studentIds = [...new Set([...sitters.values()].flat())];
  const [rooms, seats, invig, students] = await Promise.all([
    db.select({ roomId: examRoomSitting.roomId, name: room.name, seatRows: examRoomSitting.seatRows, seatColumns: examRoomSitting.seatColumns, roomCapacity: room.capacity })
      .from(examRoomSitting).innerJoin(room, eq(room.id, examRoomSitting.roomId))
      .where(and(eq(examRoomSitting.examDate, k.examDate), eq(examRoomSitting.session, k.session))).orderBy(asc(room.name)),
    db.select().from(examSeat).where(and(eq(examSeat.examDate, k.examDate), eq(examSeat.session, k.session))),
    db.select({ roomId: examInvigilation.roomId, teacherId: examInvigilation.teacherId, isLead: examInvigilation.isLead, name: teacher.name })
      .from(examInvigilation).innerJoin(teacher, eq(teacher.id, examInvigilation.teacherId))
      .where(and(eq(examInvigilation.examDate, k.examDate), eq(examInvigilation.session, k.session))),
    // Everyone the sitting's candidates and seats name (a seat can outlive its paper: a withdrawn entry).
    db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, [...studentIds, ...(await db.select({ s: examSeat.studentId }).from(examSeat)
      .where(and(eq(examSeat.examDate, k.examDate), eq(examSeat.session, k.session)))).map((r) => r.s), '__none__'])),
  ]);
  const cands = await candidatesOf(studentIds);
  const numbers = await candidateNumbersFor(papers.flatMap((p) => (sitters.get(p.id) ?? []).map((s) => ({ studentId: s, boardSeriesId: p.boardSeriesId }))));
  const ratio = await getSetting('exams.candidatesPerInvigilator');
  const who = (studentId: string) => {
    const mine = papers.filter((p) => sitters.get(p.id)?.includes(studentId));
    const c = cands.get(studentId);
    return {
      studentId,
      name: students.find((s) => s.id === studentId)?.name ?? '',
      legalName: c?.legalSurname && c?.legalForenames ? `${c.legalSurname.toUpperCase()}, ${c.legalForenames}` : null,
      papers: mine.map((p) => ({ id: p.id, code: p.code, candidateNumber: numbers.get(`${studentId}|${p.boardSeriesId}`) ?? null })),
      accessArrangements: c?.accessArrangements ?? [],
    };
  };
  return {
    sitting: k,
    candidatesPerInvigilator: ratio,
    papers: papers.map((p) => ({ id: p.id, code: p.code, title: p.title, startTime: p.startTime, durationMinutes: p.durationMinutes, candidates: sitters.get(p.id)?.length ?? 0 })),
    rooms: rooms.map((r) => {
      const inRoom = seats.filter((s) => s.roomId === r.roomId);
      return {
        ...r,
        capacity: r.seatRows * r.seatColumns,
        seats: inRoom.map((s) => ({ seatLabel: s.seatLabel, ...who(s.studentId) })).sort((a, b) => a.seatLabel.localeCompare(b.seatLabel, 'en', { numeric: true })),
        invigilators: invig.filter((i) => i.roomId === r.roomId),
        invigilatorsNeeded: inRoom.length ? Math.ceil(inRoom.length / ratio) : 0,
      };
    }),
    unseated: studentIds.filter((id) => !seats.some((s) => s.studentId === id)).map(who).sort((a, b) => a.name.localeCompare(b.name)),
    seatedElsewhere: seats.filter((s) => !studentIds.includes(s.studentId)).length,
  };
}

/**
 * The rooms a sitting uses and their seat grids. A room that holds seated
 * candidates cannot be dropped, nor its grid shrunk under them.
 */
export async function setSittingRooms(data: SetSittingRoomsType, actorId: string, ctx?: AuditContext) {
  const { papers } = await sittingPapers(data);
  if (!papers.length) throw new ExamError(`No paper is sat on ${sittingName(data)}`, 404);
  return db.transaction(async (tx) => {
    await advisoryLock(tx, `exam:sitting:${data.examDate}:${data.session}`);
    const roomIds = data.rooms.map((r) => r.roomId);
    if (new Set(roomIds).size !== roomIds.length) throw new ExamError('A room is listed twice', 400);
    const found = roomIds.length ? await tx.select().from(room).where(inArray(room.id, roomIds)) : [];
    for (const r of data.rooms) {
      const rr = found.find((x) => x.id === r.roomId);
      if (!rr) throw new ExamError('Room not found', 404);
      if (!rr.isActive) throw new ExamError(`${rr.name} is no longer in use`, 409);
    }
    const seats = await tx.select().from(examSeat).where(and(eq(examSeat.examDate, data.examDate), eq(examSeat.session, data.session)));
    const before = await tx.select().from(examRoomSitting).where(and(eq(examRoomSitting.examDate, data.examDate), eq(examRoomSitting.session, data.session)));
    for (const b of before) {
      const next = data.rooms.find((r) => r.roomId === b.roomId);
      const inRoom = seats.filter((s) => s.roomId === b.roomId);
      const name = (await tx.select({ name: room.name }).from(room).where(eq(room.id, b.roomId)))[0]?.name ?? 'The room';
      if (!next && inRoom.length) throw new ExamError(`${name} has ${inRoom.length} candidate(s) seated: move them first`, 409);
      if (next) {
        const outside = inRoom.filter((s) => s.seatLabel.charCodeAt(0) - 65 >= next.seatRows || Number(s.seatLabel.slice(1)) > next.seatColumns);
        if (outside.length) throw new ExamError(`${name}'s smaller grid would leave ${outside.length} candidate(s) without a seat: move them first`, 409);
      }
    }
    await tx.delete(examRoomSitting).where(and(eq(examRoomSitting.examDate, data.examDate), eq(examRoomSitting.session, data.session),
      roomIds.length ? sql`${examRoomSitting.roomId} not in (${sql.join(roomIds.map((id) => sql`${id}`), sql`, `)})` : undefined));
    for (const r of data.rooms) {
      await tx.insert(examRoomSitting).values({ id: randomUUID(), examDate: data.examDate, session: data.session, roomId: r.roomId, seatRows: r.seatRows, seatColumns: r.seatColumns, createdBy: actorId })
        .onConflictDoUpdate({ target: [examRoomSitting.examDate, examRoomSitting.session, examRoomSitting.roomId], set: { seatRows: r.seatRows, seatColumns: r.seatColumns } });
    }
    await logAction(actorId, 'EXAM_ROOMS_SET', 'exam_sitting', `${data.examDate}:${data.session}`,
      { rooms: before.map((b) => ({ roomId: b.roomId, seatRows: b.seatRows, seatColumns: b.seatColumns })) }, { rooms: data.rooms }, ctx, tx);
    return { rooms: data.rooms.length };
  });
}

/**
 * Seat everyone of a sitting who has no seat yet: candidates of one paper
 * together, in candidate-number order, filling each room row by row. Preview
 * first; the commit runs one at a time per sitting and the unique indexes
 * refuse a double-booked seat whatever happens alongside.
 */
export async function autoSeat(k: SittingKeyType, commit: boolean, actorId: string, ctx?: AuditContext) {
  const plan = async (executor: Executor) => {
    const { papers, sitters } = await sittingPapers(k, executor);
    const rooms = await executor.select({ roomId: examRoomSitting.roomId, name: room.name, seatRows: examRoomSitting.seatRows, seatColumns: examRoomSitting.seatColumns })
      .from(examRoomSitting).innerJoin(room, eq(room.id, examRoomSitting.roomId))
      .where(and(eq(examRoomSitting.examDate, k.examDate), eq(examRoomSitting.session, k.session))).orderBy(asc(room.name));
    if (!rooms.length) throw new ExamError(`Choose the rooms for ${sittingName(k)} first`, 409);
    const seats = await executor.select().from(examSeat).where(and(eq(examSeat.examDate, k.examDate), eq(examSeat.session, k.session)));
    const taken = new Set(seats.map((s) => `${s.roomId}|${s.seatLabel}`));
    const seated = new Set(seats.map((s) => s.studentId));
    const numbers = await candidateNumbersFor(papers.flatMap((p) => (sitters.get(p.id) ?? []).map((s) => ({ studentId: s, boardSeriesId: p.boardSeriesId }))));
    const names = new Map((await executor.select({ id: user.id, name: user.name }).from(user)
      .where(inArray(user.id, [...new Set([...sitters.values()].flat()), '__none__']))).map((u) => [u.id, u.name]));
    // A candidate the board allows a separate room is never placed among the others: listed to seat by hand.
    const cands = await candidatesOf([...new Set([...sitters.values()].flat())], executor);
    const ownRoom = new Set([...cands.values()].filter((c) => c.accessArrangements.includes('separate_room')).map((c) => c.studentId));
    const order: { studentId: string; paperCode: string; number: string | null }[] = [];
    for (const p of [...papers].sort((a, b) => a.code.localeCompare(b.code))) {
      const people = (sitters.get(p.id) ?? []).filter((s) => !seated.has(s) && !ownRoom.has(s) && !order.some((o) => o.studentId === s))
        .map((s) => ({ studentId: s, paperCode: p.code, number: numbers.get(`${s}|${p.boardSeriesId}`) ?? null }))
        .sort((a, b) => (a.number ?? '9999').localeCompare(b.number ?? '9999') || (names.get(a.studentId) ?? '').localeCompare(names.get(b.studentId) ?? ''));
      order.push(...people);
    }
    const free: { roomId: string; roomName: string; seatLabel: string }[] = [];
    for (const r of rooms) {
      for (let row = 0; row < r.seatRows; row++) {
        for (let c = 0; c < r.seatColumns; c++) {
          const label = seatLabel(row, c);
          if (!taken.has(`${r.roomId}|${label}`)) free.push({ roomId: r.roomId, roomName: r.name, seatLabel: label });
        }
      }
    }
    const assigned = order.slice(0, free.length).map((o, i) => ({ ...o, name: names.get(o.studentId) ?? '', ...free[i]! }));
    const unseated = order.slice(free.length).map((o) => ({ ...o, name: names.get(o.studentId) ?? '' }));
    const separateRoom = [...ownRoom].filter((s) => !seated.has(s)).map((s) => {
      const p = papers.find((x) => sitters.get(x.id)?.includes(s))!;
      return { studentId: s, name: names.get(s) ?? '', paperCode: p.code, number: numbers.get(`${s}|${p.boardSeriesId}`) ?? null };
    });
    return { alreadySeated: seats.length, assigned, unseated, separateRoom };
  };
  if (!commit) return { committed: false, ...(await plan(db)) };
  try {
    return await db.transaction(async (tx) => {
      await advisoryLock(tx, `exam:sitting:${k.examDate}:${k.session}`);
      const p = await plan(tx);
      if (p.assigned.length) {
        await tx.insert(examSeat).values(p.assigned.map((a) => ({
          id: randomUUID(), examDate: k.examDate, session: k.session, roomId: a.roomId, seatLabel: a.seatLabel, studentId: a.studentId, assignedBy: actorId,
        })));
        await logAction(actorId, 'EXAM_SEATS_ASSIGNED', 'exam_sitting', `${k.examDate}:${k.session}`, null,
          { count: p.assigned.length, unseated: p.unseated.length }, ctx, tx);
      }
      return { committed: true, ...p };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ExamError('Someone changed the seating of this sitting at the same moment — reload and try again', 409);
    throw err;
  }
}

/**
 * Seat one candidate (or move them): the seat must be in a room of the
 * sitting and inside its grid, and free — the database refuses a second
 * candidate in it whatever else happens at the same moment.
 */
export async function assignSeat(data: AssignSeatType, actorId: string, ctx?: AuditContext) {
  const { sitters } = await sittingPapers(data);
  if (![...sitters.values()].some((s) => s.includes(data.studentId))) {
    throw new ExamError(`This candidate sits no paper on ${sittingName(data)}`, 400);
  }
  const [rs] = await db.select({ seatRows: examRoomSitting.seatRows, seatColumns: examRoomSitting.seatColumns, name: room.name })
    .from(examRoomSitting).innerJoin(room, eq(room.id, examRoomSitting.roomId))
    .where(and(eq(examRoomSitting.examDate, data.examDate), eq(examRoomSitting.session, data.session), eq(examRoomSitting.roomId, data.roomId)));
  if (!rs) throw new ExamError('That room is not used in this sitting', 400);
  const row = data.seatLabel.charCodeAt(0) - 65;
  const column = Number(data.seatLabel.slice(1));
  if (row >= rs.seatRows || column < 1 || column > rs.seatColumns) {
    throw new ExamError(`${rs.name} has rows A–${String.fromCharCode(64 + rs.seatRows)} and seats 1–${rs.seatColumns}`, 400);
  }
  try {
    return await db.transaction(async (tx) => {
      const [before] = await tx.select().from(examSeat)
        .where(and(eq(examSeat.examDate, data.examDate), eq(examSeat.session, data.session), eq(examSeat.studentId, data.studentId))).for('update');
      if (before?.roomId === data.roomId && before.seatLabel === data.seatLabel) return before;
      if (before) await tx.delete(examSeat).where(eq(examSeat.id, before.id));
      const [created] = await tx.insert(examSeat).values({
        id: randomUUID(), examDate: data.examDate, session: data.session, roomId: data.roomId, seatLabel: data.seatLabel, studentId: data.studentId, assignedBy: actorId,
      }).returning();
      await logAction(actorId, 'EXAM_SEAT_ASSIGNED', 'exam_sitting', `${data.examDate}:${data.session}`,
        before ? { studentId: data.studentId, roomId: before.roomId, seatLabel: before.seatLabel } : null,
        { studentId: data.studentId, roomId: data.roomId, seatLabel: data.seatLabel }, ctx, tx);
      return created!;
    });
  } catch (err) {
    if (isUniqueViolation(err) && violatedConstraint(err) === 'examSeat_seat_idx') {
      const [holder] = await db.select({ name: user.name }).from(examSeat).innerJoin(user, eq(user.id, examSeat.studentId))
        .where(and(eq(examSeat.examDate, data.examDate), eq(examSeat.session, data.session), eq(examSeat.roomId, data.roomId), eq(examSeat.seatLabel, data.seatLabel)));
      throw new ExamError(`Seat ${data.seatLabel} in ${rs.name} is already ${holder?.name ?? 'another candidate'}'s`, 409);
    }
    if (isUniqueViolation(err)) throw new ExamError('This candidate was seated at the same moment — reload and try again', 409);
    throw err;
  }
}

// ─── Invigilators ────────────────────────────────────────────────────────────

/** Who invigilates a room in a sitting; a teacher can be in one room per sitting. */
export async function setInvigilators(data: SetInvigilatorsType, actorId: string, ctx?: AuditContext) {
  const [rs] = await db.select({ name: room.name }).from(examRoomSitting).innerJoin(room, eq(room.id, examRoomSitting.roomId))
    .where(and(eq(examRoomSitting.examDate, data.examDate), eq(examRoomSitting.session, data.session), eq(examRoomSitting.roomId, data.roomId)));
  if (!rs) throw new ExamError('That room is not used in this sitting', 400);
  const ids = [...new Set(data.teacherIds)];
  if (data.leadTeacherId && !ids.includes(data.leadTeacherId)) throw new ExamError('The lead invigilator must be one of the invigilators', 400);
  const teachers = ids.length ? await db.select({ id: teacher.id, name: teacher.name, isActive: teacher.isActive }).from(teacher).where(inArray(teacher.id, ids)) : [];
  if (teachers.length !== ids.length) throw new ExamError('Teacher not found', 404);
  try {
    return await db.transaction(async (tx) => {
      await advisoryLock(tx, `exam:sitting:${data.examDate}:${data.session}`);
      const elsewhere = ids.length
        ? await tx.select({ teacherId: examInvigilation.teacherId, roomName: room.name }).from(examInvigilation).innerJoin(room, eq(room.id, examInvigilation.roomId))
            .where(and(eq(examInvigilation.examDate, data.examDate), eq(examInvigilation.session, data.session), inArray(examInvigilation.teacherId, ids), sql`${examInvigilation.roomId} <> ${data.roomId}`))
        : [];
      if (elsewhere.length) {
        const t = teachers.find((x) => x.id === elsewhere[0]!.teacherId);
        throw new ExamError(`${t?.name ?? 'A teacher'} already invigilates ${elsewhere[0]!.roomName} in this sitting`, 409);
      }
      const before = await tx.select({ teacherId: examInvigilation.teacherId, isLead: examInvigilation.isLead }).from(examInvigilation)
        .where(and(eq(examInvigilation.examDate, data.examDate), eq(examInvigilation.session, data.session), eq(examInvigilation.roomId, data.roomId)));
      await tx.delete(examInvigilation).where(and(eq(examInvigilation.examDate, data.examDate), eq(examInvigilation.session, data.session), eq(examInvigilation.roomId, data.roomId)));
      if (ids.length) {
        await tx.insert(examInvigilation).values(ids.map((id) => ({
          id: randomUUID(), examDate: data.examDate, session: data.session, roomId: data.roomId, teacherId: id, isLead: id === data.leadTeacherId, assignedBy: actorId,
        })));
      }
      await logAction(actorId, 'EXAM_INVIGILATORS_SET', 'exam_sitting', `${data.examDate}:${data.session}`,
        { roomId: data.roomId, invigilators: before }, { roomId: data.roomId, teacherIds: ids, lead: data.leadTeacherId ?? null }, ctx, tx);
      return { invigilators: ids.length };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ExamError('A teacher was put in another room of this sitting at the same moment — reload and try again', 409);
    throw err;
  }
}

async function teacherOfAccount(userId: string) {
  const [t] = await db.select({ id: teacher.id, name: teacher.name }).from(teacher).where(eq(teacher.userId, userId));
  return t ?? null;
}

/** A teacher's own invigilation duties from yesterday on: when, which room, which papers, how many candidates. */
export async function myInvigilation(actor: Actor) {
  const t = await teacherOfAccount(actor.id);
  if (!t) throw new ExamError('Your account is not linked to a teacher record — ask the admin to link it on the Team page', 404);
  const since = schoolDateString(new Date(Date.now() - 86_400_000));
  const duties = await db.select({ examDate: examInvigilation.examDate, session: examInvigilation.session, roomId: examInvigilation.roomId, roomName: room.name, isLead: examInvigilation.isLead })
    .from(examInvigilation).innerJoin(room, eq(room.id, examInvigilation.roomId))
    .where(and(eq(examInvigilation.teacherId, t.id), gte(examInvigilation.examDate, since)))
    .orderBy(asc(examInvigilation.examDate), asc(examInvigilation.session));
  const out = [];
  for (const d of duties) {
    const { papers, sitters } = await sittingPapers({ examDate: d.examDate, session: d.session as ExamSession });
    const seats = await db.select({ studentId: examSeat.studentId }).from(examSeat)
      .where(and(eq(examSeat.examDate, d.examDate), eq(examSeat.session, d.session), eq(examSeat.roomId, d.roomId)));
    const inRoom = new Set(seats.map((s) => s.studentId));
    out.push({
      ...d,
      papers: papers.filter((p) => (sitters.get(p.id) ?? []).some((s) => inRoom.has(s)))
        .map((p) => ({ id: p.id, code: p.code, title: p.title, startTime: p.startTime, durationMinutes: p.durationMinutes, candidates: (sitters.get(p.id) ?? []).filter((s) => inRoom.has(s)).length })),
      candidates: inRoom.size,
    });
  }
  return { teacher: t, duties: out };
}

// ─── Attendance registers ────────────────────────────────────────────────────

/**
 * Which rooms of a paper's sitting this account may keep the register of:
 * every room for the coordinator and admin; the rooms they invigilate for a
 * teacher (another room, or a paper they do not invigilate, is refused).
 */
async function registerRooms(paper: typeof examPaper.$inferSelect, actor: Actor, roomId?: string): Promise<string[] | 'all'> {
  if (hasRole(actor.role, ...ACADEMIC_ROLES)) return roomId ? [roomId] : 'all';
  const t = await teacherOfAccount(actor.id);
  if (!t) throw new ExamError('Only the invigilators of this paper keep its register', 403);
  const mine = (await db.select({ roomId: examInvigilation.roomId }).from(examInvigilation)
    .where(and(eq(examInvigilation.examDate, paper.examDate), eq(examInvigilation.session, paper.session), eq(examInvigilation.teacherId, t.id)))).map((r) => r.roomId);
  if (!mine.length || (roomId && !mine.includes(roomId))) throw new ExamError('Only the invigilators of this room keep its register', 403);
  return roomId ? [roomId] : mine;
}

/** The board's attendance register for a paper (a room of it): candidate number, name as on ID, seat, mark. */
export async function getRegister(paperId: string, actor: Actor, roomId?: string) {
  const [paper] = await db.select().from(examPaper).where(eq(examPaper.id, paperId));
  if (!paper) throw new ExamError('Paper not found', 404);
  const rooms = await registerRooms(paper, actor, roomId);
  const series = await seriesOrThrow(paper.boardSeriesId);
  const { sitters } = await sittingPapers({ examDate: paper.examDate, session: paper.session as ExamSession });
  const students = sitters.get(paper.id) ?? [];
  const [seats, marks, users] = await Promise.all([
    students.length ? db.select({ studentId: examSeat.studentId, roomId: examSeat.roomId, seatLabel: examSeat.seatLabel, roomName: room.name })
      .from(examSeat).innerJoin(room, eq(room.id, examSeat.roomId))
      .where(and(eq(examSeat.examDate, paper.examDate), eq(examSeat.session, paper.session), inArray(examSeat.studentId, students))) : [],
    db.select().from(examAttendance).where(eq(examAttendance.paperId, paper.id)),
    students.length ? db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, students)) : [],
  ]);
  const cands = await candidatesOf(students);
  const numbers = await candidateNumbersFor(students.map((s) => ({ studentId: s, boardSeriesId: paper.boardSeriesId })));
  const rows = students
    .map((s) => {
      const seat = seats.find((x) => x.studentId === s);
      const c = cands.get(s);
      const m = marks.find((x) => x.studentId === s);
      return {
        studentId: s, name: users.find((u) => u.id === s)?.name ?? '',
        legalName: c?.legalSurname && c?.legalForenames ? `${c.legalSurname.toUpperCase()}, ${c.legalForenames}` : null,
        candidateNumber: numbers.get(`${s}|${paper.boardSeriesId}`) ?? null,
        roomId: seat?.roomId ?? null, roomName: seat?.roomName ?? null, seatLabel: seat?.seatLabel ?? null,
        accessArrangements: c?.accessArrangements ?? [],
        mark: m ? { status: m.status, minutesLate: m.minutesLate, note: m.note, recordedAt: m.recordedAt } : null,
      };
    })
    .filter((r) => rooms === 'all' || (r.roomId && rooms.includes(r.roomId)))
    .sort((a, b) => (a.candidateNumber ?? '9999').localeCompare(b.candidateNumber ?? '9999') || a.name.localeCompare(b.name));
  return {
    paper: { id: paper.id, code: paper.code, title: paper.title, examDate: paper.examDate, session: paper.session, startTime: paper.startTime, durationMinutes: paper.durationMinutes },
    series: { id: series.id, name: series.name, boardName: series.boardName },
    centreNumber: (await centreFor(series.boardCode)).centreNumber,
    rows,
    marked: rows.filter((r) => r.mark).length,
  };
}

/** Mark the register: each candidate present, absent or late (minutes). A teacher marks only their room's candidates. */
export async function markRegister(data: MarkRegisterType, actor: Actor, ctx?: AuditContext) {
  const [paper] = await db.select().from(examPaper).where(eq(examPaper.id, data.paperId));
  if (!paper) throw new ExamError('Paper not found', 404);
  const rooms = await registerRooms(paper, actor);
  const { sitters } = await sittingPapers({ examDate: paper.examDate, session: paper.session as ExamSession });
  const candidates = new Set(sitters.get(paper.id) ?? []);
  const seats = await db.select({ studentId: examSeat.studentId, roomId: examSeat.roomId }).from(examSeat)
    .where(and(eq(examSeat.examDate, paper.examDate), eq(examSeat.session, paper.session)));
  for (const m of data.marks) {
    if (!candidates.has(m.studentId)) throw new ExamError('A student on this register is not a candidate for this paper', 400);
    if (rooms !== 'all' && !rooms.includes(seats.find((s) => s.studentId === m.studentId)?.roomId ?? '')) {
      throw new ExamError('Only the invigilators of this room keep its register', 403);
    }
    if (m.status === 'late' && !m.minutesLate) throw new ExamError('Say how many minutes late', 400);
  }
  return db.transaction(async (tx) => {
    for (const m of data.marks) {
      const values = { status: m.status, minutesLate: m.status === 'late' ? m.minutesLate ?? null : null, note: m.note ?? null, recordedBy: actor.id, recordedAt: new Date() };
      await tx.insert(examAttendance).values({ id: randomUUID(), paperId: paper.id, studentId: m.studentId, ...values })
        .onConflictDoUpdate({ target: [examAttendance.paperId, examAttendance.studentId], set: values });
    }
    await logAction(actor.id, 'EXAM_REGISTER_MARKED', 'exam_paper', paper.id, null,
      { marks: data.marks.map((m) => ({ studentId: m.studentId, status: m.status })) }, ctx, tx);
    return { marked: data.marks.length };
  });
}

// ─── Special consideration ───────────────────────────────────────────────────

export async function listSpecialConsiderations(boardSeriesId: string) {
  const rows = await db.select({ sc: examSpecialConsideration, studentName: user.name, paperCode: examPaper.code })
    .from(examSpecialConsideration).innerJoin(user, eq(user.id, examSpecialConsideration.studentId))
    .leftJoin(examPaper, eq(examPaper.id, examSpecialConsideration.paperId))
    .where(eq(examSpecialConsideration.boardSeriesId, boardSeriesId)).orderBy(asc(examSpecialConsideration.createdAt));
  return rows.map((r) => ({ ...r.sc, studentName: r.studentName, paperCode: r.paperCode }));
}

async function assertEvidence(fileId: string, studentId: string) {
  const [f] = await db.select({ purpose: file.purpose, studentId: file.studentId }).from(file).where(eq(file.id, fileId));
  if (!f || f.purpose !== 'supporting_document' || f.studentId !== studentId) {
    throw new ExamError('Attach a supporting document uploaded for this student', 400);
  }
}

export async function createSpecialConsideration(data: CreateSpecialConsiderationType, actorId: string, ctx?: AuditContext) {
  const series = await seriesOrThrow(data.boardSeriesId);
  const [entry] = await db.select({ id: examEntry.id }).from(examEntry)
    .where(and(eq(examEntry.studentId, data.studentId), eq(examEntry.boardSeriesId, series.id), sql`${examEntry.status} <> 'withdrawn'`)).limit(1);
  if (!entry) throw new ExamError(`This candidate has no entry in ${series.name}`, 400);
  if (data.paperId) {
    const [p] = await db.select({ seriesId: examPaper.boardSeriesId }).from(examPaper).where(eq(examPaper.id, data.paperId));
    if (!p || p.seriesId !== series.id) throw new ExamError(`That paper is not in ${series.name}`, 400);
  }
  if (data.evidenceFileId) await assertEvidence(data.evidenceFileId, data.studentId);
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(examSpecialConsideration).values({
      id: randomUUID(), studentId: data.studentId, boardSeriesId: series.id, paperId: data.paperId ?? null, category: data.category,
      description: data.description, evidenceFileId: data.evidenceFileId ?? null, createdBy: actorId,
    }).returning();
    await logAction(actorId, 'SPECIAL_CONSIDERATION_CREATED', 'exam_special_consideration', row!.id, null,
      { studentId: data.studentId, boardSeriesId: series.id, category: data.category }, ctx, tx);
    return row!;
  });
}

export async function updateSpecialConsideration(id: string, data: UpdateSpecialConsiderationType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(examSpecialConsideration).where(eq(examSpecialConsideration.id, id)).for('update');
    if (!before) throw new ExamError('Not found', 404);
    if (data.evidenceFileId) await assertEvidence(data.evidenceFileId, before.studentId);
    const set = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) as Partial<typeof examSpecialConsideration.$inferInsert>;
    if (data.status === 'submitted' && !before.submittedAt) set.submittedAt = new Date();
    const [row] = await tx.update(examSpecialConsideration).set({ ...set, updatedAt: new Date() }).where(eq(examSpecialConsideration.id, id)).returning();
    await logAction(actorId, 'SPECIAL_CONSIDERATION_UPDATED', 'exam_special_consideration', id,
      { status: before.status, boardReference: before.boardReference }, { ...data }, ctx, tx);
    return row!;
  });
}
