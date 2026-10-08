import { describe, it, expect, beforeAll } from 'vitest';
import { apiResponse, academicYearStartOf } from '@repo/validations';
import { admin, staff, onboard, subject, one, lockWaiters, holdRowLock, type Client, CONSENT } from './helpers';

// SCRATCH (not committed): a payment reversal (payment, then receipts, then lines: MA-16's order)
// against the coordinator's rejection of the same paid line (the line, then its receipt).
const days = (n: number) => n * 86_400_000;
const RUN = Math.random().toString(36).slice(2, 6);
const Y = academicYearStartOf();
const cairoDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d);
type Res = { status: number; json(): Promise<unknown> };

describe('scratch: reversal against rejection', () => {
  let adm: Client, finadmin: Client, officer: Client, coordinator: Client;
  let s1: string, item: string, teacherId: string;
  beforeAll(async () => {
    adm = await admin('zzr');
    finadmin = await staff(adm, 'finance_admin', 'zzr');
    officer = await staff(adm, 'finance_officer', 'zzr');
    coordinator = await staff(adm, 'coordinator', 'zzr');
    teacherId = (await apiResponse(adm.api.v1.teachers.$post({ json: { name: `Teacher Z (${RUN})` } })))!.id;
    s1 = (await apiResponse(adm.api.v1.sessions.$post({ json: {
      type: 'june', year: Y + 1, label: `zzr-${RUN}`, startDate: new Date(Date.now() - days(1)).toISOString(), endDate: new Date(Date.now() + days(60)).toISOString(),
      courseStartsOn: cairoDate(new Date()), paymentDueAt: new Date(Date.now() + days(40)).toISOString(),
    } })))!.id;
    const series = (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'cambridge', month: 'june', year: Y + 1, label: `zzr-${RUN}`, entryDeadline: new Date(Date.now() + days(50)) } })))!.id;
    const sub = await subject(adm, `ZZR-${RUN}`, `Scratch (${RUN})`, { course: 1000, registration: 500 });
    await apiResponse(adm.api.v1['board-fees'].$put({ query: { seriesId: series }, json: { rows: [{ keyKind: 'subject', keyId: sub, amount: 500, provisional: false }] } }));
    item = (await apiResponse(adm.api.v1.sessions[':id'].offers.$post({ param: { id: s1 }, json: { subjectId: sub, courseFee: 1000, teachers: [{ teacherId, mode: 'in_school' }],
      items: [{ label: 'Whole subject', kind: 'whole', enters: { kind: 'subject' }, boardSeriesId: series, availability: 'open', requiredInSeries: false }] } })))!.items[0]!;
  });

  for (const first of ['rejection', 'reversal'] as const) {
    it(`${first} first`, async () => {
      const f = await onboard(officer, `zzr-${first}-${RUN}`, 11);
      const desk = await apiResponse(officer.api.v1.registrations.desk.$post({ json: {
        studentId: f.studentId, sessionId: s1, lines: [{ offerItemId: item, attempt: 'retake', mode: 'in_school', teacherId, priorSitting: { month: 'june', year: Y } }],
        consent: CONSENT, collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } } }));
      const id = desk.registrations[0]!.id;
      const paymentId = desk.payments[0]!.id;
      const reject = () => coordinator.api.v1.registrations[':id']['verify-prior'].$post({ param: { id }, json: { outcome: 'rejected', reason: 'no such sitting on record' } });
      const reverse = () => finadmin.api.v1.payments[':id'].reverse.$post({ param: { id: paymentId }, json: { reason: 'scratch race', moneyReturned: true } });
      const release = await holdRowLock('registration', id);
      let a: Promise<Res> | undefined;
      let b: Promise<Res> | undefined;
      try {
        a = first === 'rejection' ? reject() : reverse();
        await lockWaiters(1);
        b = first === 'rejection' ? reverse() : reject();
        await lockWaiters(2);
      } finally {
        await release();
      }
      const out = await Promise.all([a!, b!]);
      const bodies = await Promise.all(out.map(async (r) => [r.status, ((await r.json()) as { error?: string }).error ?? 'ok']));
      console.log(`[scratch] ${first} first:`, JSON.stringify(bodies), JSON.stringify(await one(`select status from registration where id = $1`, [id])));
      expect(bodies.some(([, e]) => String(e).includes('deadlock'))).toBe(false);
    });
  }
});
