/**
 * Certificates (FEATURES_PLAN.md F4, "Certificates"; DISCOVERY_RESEARCH.md §2:
 * Cambridge's June certificates arrive by the end of October, November's by
 * the end of March, and centres keep them at least 12 months).
 *
 * A certificate is received for a candidate and series, collected once — at
 * the desk, by the candidate or someone they send, who signs a printed slip
 * like a receipt (its scan can be attached) — and, if nobody claims it within
 * the retention period (a setting), returned to the board or destroyed with a
 * reason. Two people handing out the same certificate at once: one succeeds,
 * the other is told who took it (a status-guarded update).
 */

import {
  db, examCertificate, examResult, examEntry, qualification, user, file, boardSeries,
  eq, and, inArray, sql, asc,
} from '@repo/db';
import { randomUUID } from 'crypto';
import {
  schoolDateString, COLLECTOR_RELATION_LABELS,
  type CollectCertificateType, type DisposeCertificateType, type ReceiveCertificatesType,
} from '@repo/validations';
import { logAction, type AuditContext } from './audit.services';
import { getSetting } from './settings.services';
import { createBulkNotifications } from './notification.services';
import { candidatesOf } from './exam-candidate.services';
import { ExamError, boardNameMap, centreFor, familyOf, seriesOrThrow } from './exam-shared';
import { boardSeriesName } from './series.services';

/** The date `months` after a YYYY-MM-DD date. */
function addMonths(date: string, months: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Certificates of a series (or all), each with its retention date and whether it is unclaimed past it. */
export async function listCertificates(q: { boardSeriesId?: string; status?: string; unclaimedOnly?: string; search?: string }) {
  const months = await getSetting('exams.certificateRetentionMonths');
  const today = schoolDateString(new Date());
  const search = q.search?.trim();
  const rows = await db.select({
    c: examCertificate, studentName: user.name, studentCode: user.studentId, month: boardSeries.month, year: boardSeries.year, label: boardSeries.label,
  }).from(examCertificate).innerJoin(user, eq(user.id, examCertificate.studentId)).innerJoin(boardSeries, eq(boardSeries.id, examCertificate.boardSeriesId))
    .where(and(
      q.boardSeriesId ? eq(examCertificate.boardSeriesId, q.boardSeriesId) : undefined,
      q.status ? eq(examCertificate.status, q.status) : undefined,
      search ? sql`(${user.name} ilike ${'%' + search + '%'} or ${user.studentId} ilike ${'%' + search + '%'})` : undefined,
    ))
    .orderBy(asc(user.name));
  const names = await boardNameMap();
  const staffIds = [...new Set(rows.flatMap((r) => [r.c.collectedBy, r.c.receivedBy, r.c.disposedBy]).filter((x): x is string => !!x))];
  const staff = staffIds.length ? await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, staffIds)) : [];
  const nameOf = (id: string | null) => (id ? staff.find((s) => s.id === id)?.name ?? null : null);
  const out = rows.map(({ c, studentName, studentCode, month, year, label }) => {
    const keepUntil = addMonths(c.receivedOn, months);
    return {
      ...c, studentName, studentCode,
      seriesName: boardSeriesName(names, { boardCode: c.boardCode, month, year, label }),
      keepUntil, unclaimed: c.status === 'received' && today > keepUntil,
      collectedByName: nameOf(c.collectedBy), receivedByName: nameOf(c.receivedBy), disposedByName: nameOf(c.disposedBy),
    };
  });
  return { retentionMonths: months, certificates: q.unclaimedOnly === 'true' ? out.filter((c) => c.unclaimed) : out };
}

/**
 * Record a series' certificates as received: by default every candidate with
 * a published result in it, each with the awards it lists. Preview, then a
 * commit that makes each certificate once; families are told to collect.
 */
export async function receiveCertificates(data: ReceiveCertificatesType, actorId: string, ctx?: AuditContext) {
  const series = await seriesOrThrow(data.boardSeriesId);
  const students = data.studentIds ?? (await db.selectDistinct({ id: examResult.studentId }).from(examResult)
    .where(and(eq(examResult.boardSeriesId, series.id), eq(examResult.status, 'published')))).map((r) => r.id);
  if (!students.length) throw new ExamError(`${series.name} has no published results: publish them, or name the candidates`, 409);
  const [awards, entries, existing, users] = await Promise.all([
    db.select({ studentId: examResult.studentId, title: qualification.title, code: examResult.code }).from(examResult)
      .leftJoin(qualification, eq(qualification.id, examResult.qualificationId))
      .where(and(eq(examResult.boardSeriesId, series.id), eq(examResult.kind, 'award'), inArray(examResult.studentId, students))),
    db.select({ studentId: examEntry.studentId, title: examEntry.title, code: examEntry.entryCode }).from(examEntry)
      .where(and(eq(examEntry.boardSeriesId, series.id), eq(examEntry.kind, 'award'), sql`${examEntry.status} <> 'withdrawn'`, inArray(examEntry.studentId, students))),
    db.select({ studentId: examCertificate.studentId }).from(examCertificate).where(and(eq(examCertificate.boardSeriesId, series.id), inArray(examCertificate.studentId, students))),
    db.select({ id: user.id, name: user.name, role: user.role }).from(user).where(inArray(user.id, students)),
  ]);
  if (users.length !== students.length || users.some((u) => u.role !== 'student')) throw new ExamError('Student not found', 404);
  const plan = students.filter((s) => !existing.some((e) => e.studentId === s)).map((s) => {
    const listed = [...new Map([...awards, ...entries].filter((a) => a.studentId === s).map((a) => [a.code, `${a.code} ${a.title ?? ''}`.trim()])).values()];
    return { studentId: s, name: users.find((u) => u.id === s)!.name, description: listed.length ? `${series.name}: ${listed.join('; ')}` : `${series.name} certificate` };
  });
  if (!data.commit) return { committed: false, already: existing.length, toReceive: plan, created: 0 };
  const created = await db.transaction(async (tx) => {
    const rows = plan.length
      ? await tx.insert(examCertificate).values(plan.map((p) => ({
          id: randomUUID(), studentId: p.studentId, boardSeriesId: series.id, boardCode: series.boardCode, description: p.description,
          receivedOn: data.receivedOn, receivedBy: actorId,
        }))).onConflictDoNothing().returning({ id: examCertificate.id, studentId: examCertificate.studentId })
      : [];
    if (rows.length) {
      await logAction(actorId, 'EXAM_CERTIFICATES_RECEIVED', 'board_series', series.id, null, { count: rows.length, receivedOn: data.receivedOn }, ctx, tx);
    }
    return rows;
  });
  const families = await familyOf(created.map((c) => c.studentId));
  await createBulkNotifications([...new Set([...families.values()].flat())], 'EXAM_CERTIFICATE_READY', 'Certificate ready to collect',
    `The ${series.name} certificate has arrived. The candidate, or a parent, can collect it at the school office and sign for it; bring an ID.`,
    { boardSeriesId: series.id, url: '/exams/my' });
  return { committed: true, already: existing.length, toReceive: plan, created: created.length };
}

/**
 * Hand a certificate over, once. The update only moves a certificate still
 * waiting; a second officer at the same moment is told who collected it.
 */
export async function collectCertificate(id: string, data: CollectCertificateType, actorId: string, ctx?: AuditContext) {
  const [c] = await db.select().from(examCertificate).where(eq(examCertificate.id, id));
  if (!c) throw new ExamError('Certificate not found', 404);
  if (data.signatureFileId) {
    const [f] = await db.select({ purpose: file.purpose, studentId: file.studentId }).from(file).where(eq(file.id, data.signatureFileId));
    if (!f || f.purpose !== 'supporting_document' || f.studentId !== c.studentId) throw new ExamError('Attach the signed slip uploaded for this student', 400);
  }
  return db.transaction(async (tx) => {
    const [row] = await tx.update(examCertificate).set({
      status: 'collected', collectedAt: new Date(), collectedBy: actorId, collectorName: data.collectorName, collectorRelation: data.collectorRelation,
      collectorIdChecked: data.collectorIdChecked ?? null, signatureFileId: data.signatureFileId ?? null, updatedAt: new Date(),
    }).where(and(eq(examCertificate.id, id), eq(examCertificate.status, 'received'))).returning();
    if (!row) {
      const [now] = await tx.select({ status: examCertificate.status, collectorName: examCertificate.collectorName, collectedAt: examCertificate.collectedAt })
        .from(examCertificate).where(eq(examCertificate.id, id));
      if (now?.status === 'collected') {
        throw new ExamError(`This certificate was already collected by ${now.collectorName} on ${schoolDateString(now.collectedAt!)}`, 409);
      }
      throw new ExamError('This certificate is no longer here to collect', 409);
    }
    await logAction(actorId, 'EXAM_CERTIFICATE_COLLECTED', 'exam_certificate', id, { status: 'received' },
      { status: 'collected', collectorName: data.collectorName, collectorRelation: data.collectorRelation, signatureFileId: data.signatureFileId ?? null }, ctx, tx);
    return row;
  });
}

/**
 * Return a certificate to the board (any time, with a reason — a misspelt
 * name) or destroy it (only once unclaimed past the retention period).
 */
export async function disposeCertificate(id: string, data: DisposeCertificateType, actorId: string, ctx?: AuditContext) {
  const months = await getSetting('exams.certificateRetentionMonths');
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(examCertificate).where(eq(examCertificate.id, id)).for('update');
    if (!c) throw new ExamError('Certificate not found', 404);
    if (c.status !== 'received') throw new ExamError('Only a certificate still waiting to be collected can be returned or destroyed', 409);
    const keepUntil = addMonths(c.receivedOn, months);
    if (data.action === 'destroyed' && schoolDateString(new Date()) <= keepUntil) {
      throw new ExamError(`Keep this certificate until ${keepUntil} (${months} months after it arrived) before destroying it`, 409);
    }
    const [row] = await tx.update(examCertificate).set({ status: data.action, disposedAt: new Date(), disposedBy: actorId, disposalReason: data.reason, updatedAt: new Date() })
      .where(eq(examCertificate.id, id)).returning();
    await logAction(actorId, 'EXAM_CERTIFICATE_DISPOSED', 'exam_certificate', id, { status: c.status }, { status: data.action, reason: data.reason }, ctx, tx);
    return row!;
  });
}

/** What the printed collection slip shows: the centre, the candidate as on their ID, the series, the collector, a signature line. */
export async function certificateSlip(id: string) {
  const [c] = await db.select({ c: examCertificate, studentName: user.name, studentCode: user.studentId }).from(examCertificate)
    .innerJoin(user, eq(user.id, examCertificate.studentId)).where(eq(examCertificate.id, id));
  if (!c) throw new ExamError('Certificate not found', 404);
  const series = await seriesOrThrow(c.c.boardSeriesId);
  const cand = (await candidatesOf([c.c.studentId])).get(c.c.studentId);
  const [staff] = c.c.collectedBy ? await db.select({ name: user.name }).from(user).where(eq(user.id, c.c.collectedBy)) : [];
  return {
    certificate: c.c,
    seriesName: series.name,
    centre: await centreFor(series.boardCode),
    candidate: {
      name: c.studentName, studentCode: c.studentCode,
      legalName: cand?.legalSurname && cand?.legalForenames ? `${cand.legalSurname.toUpperCase()}, ${cand.legalForenames}` : null,
    },
    collectorRelationLabel: c.c.collectorRelation ? COLLECTOR_RELATION_LABELS[c.c.collectorRelation as keyof typeof COLLECTOR_RELATION_LABELS] : null,
    handedOverBy: staff?.name ?? null,
  };
}
