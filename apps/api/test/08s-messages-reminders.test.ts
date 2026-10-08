import { describe, it, expect, beforeAll } from 'vitest';
import { apiResponse, academicYearStartOf, academicYearLabel } from '@repo/validations';
import {
  admin, staff, onboard, refused, one, sql, money, app, waitFor, pauseAtAudits, lockWaiters, notificationsFor, CONSENT, type Client,
} from './helpers';

/**
 * 08s — messages and reminders (RESERVATIONS_REWORK.md §3.8, §4.8, §8; docs/features/RESERVATIONS_MESSAGES.md).
 *
 * The staff send through /v1/messages as the screen does; the scheduler's step is called as the
 * scheduler calls it, at chosen instants (the suite's one reach past the API, as runPaymentDeadlines
 * is): `runMessagesStep(now)`. A reminder's day is counted in Cairo and goes out at the school's send
 * hour, Cairo time — the instants below are built from Cairo wall times, so the file asserts the
 * same whatever zone the suite runs in (local time and TZ=UTC). Families read their own
 * notifications through the API.
 *
 * The step is the school's: it reaches every row in the database, so each scenario asserts on its
 * own families' claims, notifications and deliveries.
 */

const DAY = 86_400_000;
const RUN = Math.random().toString(36).slice(2, 6);
const Y = academicYearStartOf();
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

/** The school's day (Cairo) of an instant, YYYY-MM-DD. */
const cairoDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d);
/** A Cairo day moved by n days. */
const shift = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
/** The instant a Cairo wall clock shows `day hh:mm` (Cairo is UTC+2 or +3: the one that reads back right). */
function cairoAt(day: string, hh: number, mm = 0): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  for (const off of [2, 3]) {
    const t = new Date(Date.UTC(y, m - 1, d, hh - off, mm));
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(t);
    if (p === `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}, ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`) return t;
  }
  throw new Error(`no Cairo instant for ${day} ${hh}:${mm}`);
}
/** A Cairo day as a message writes it, literally. */
const enDay = (day: string) => { const [y, m, d] = day.split('-').map(Number) as [number, number, number]; return `${d} ${EN_MONTHS[m - 1]} ${y}`; };
const arDay = (day: string) => { const [y, m, d] = day.split('-').map(Number) as [number, number, number]; return `${d} ${AR_MONTHS[m - 1]} ${y}`; };

async function step(now: Date) {
  const { runMessagesStep } = await import('../src/services/messages-step.services');
  return runMessagesStep(now);
}
/** The scheduler's emails: sent after the commit; the test waits for them as the suite waits for any fire-and-forget. */
async function emailsSettled(messageId: string) {
  await waitFor(async () => (await sql<{ n: string }>(`select count(*) as n from message_delivery where message_id = $1 and channel = 'email' and status in ('queued', 'sending')`, [messageId]))[0]!.n === '0' || null);
}
const claimsOf = async (targetId: string) =>
  (await sql<{ offset_days: number; anchor_on: string; kind: string }>(`select offset_days, anchor_on::text, kind from reminder_sent where target_id = $1 order by sent_at, offset_days`, [targetId]));
const offsetsOf = async (targetId: string, kind?: string) => (await claimsOf(targetId)).filter((c) => !kind || c.kind === kind).map((c) => Number(c.offset_days));
const reminderCount = async (email: string) => (await notificationsFor(email, 'PAYMENT_REMINDER')).length;

describe('08s: messages and reminders', () => {
  let adm: Client, officer: Client, finadmin: Client, coordinator: Client;
  let teacherId: string, seriesA: string, seriesProv: string, priorSeries: string;
  let sessionA: string, sessionAName: string, sessionAEnd: Date;
  let subjA: string, subjAName: string, itemA: string, itemProv: string, feeProv: string;
  let dueDay: string;
  const TPL = { paymentDue: 'tpl-payment-due', paymentOverdue: 'tpl-payment-overdue' };
  type Family = Awaited<ReturnType<typeof onboard>>;

  const reserveUnpaid = async (f: Family, offerItemId: string, sessionId = sessionA) =>
    (await apiResponse(officer.api.v1.registrations.desk.$post({
      json: { studentId: f.studentId, sessionId, lines: [{ offerItemId, attempt: 'first', mode: 'in_school', teacherId }], consent: CONSENT },
    }))).registrations[0]!.id;
  const payAtDesk = (f: Family, ids: string[]) =>
    apiResponse(officer.api.v1.registrations.desk.collect.$post({ json: { studentId: f.studentId, registrationIds: ids, instrumentUsed: 'cash', escrowAmountToApply: 0 } }));

  beforeAll(async () => {
    adm = await admin(`s08-${RUN}`);
    officer = await staff(adm, 'finance_officer', `s08-${RUN}`);
    finadmin = await staff(adm, 'finance_admin', `s08-${RUN}`);
    coordinator = await staff(adm, 'coordinator', `s08-${RUN}`);
    teacherId = (await apiResponse(adm.api.v1.teachers.$post({ json: { name: `Teacher D (08s ${RUN})` } })))!.id;
    // The payment due date: a Cairo day 30 days ahead, at noon; the session runs well past it.
    dueDay = cairoDay(new Date(Date.now() + 30 * DAY));
    sessionAEnd = cairoAt(shift(dueDay, 40), 23, 59);
    sessionA = (await apiResponse(adm.api.v1.sessions.$post({
      json: {
        type: 'june', year: Y + 1, label: `s08-${RUN}`, startDate: new Date(Date.now() - DAY).toISOString(), endDate: sessionAEnd.toISOString(),
        courseStartsOn: cairoDay(new Date()), paymentDueAt: cairoAt(dueDay, 12).toISOString(),
      },
    })))!.id;
    sessionAName = (await one<{ name: string }>(`select name from registration_session where id = $1`, [sessionA])).name;
    const mk = async (label: string, entryDeadline?: Date) =>
      (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'cambridge', month: 'june', year: Y + 1, label, ...(entryDeadline ? { entryDeadline } : {}) } })))!.id;
    seriesA = await mk(`s08-${RUN}`, cairoAt(shift(dueDay, 60), 23, 59));
    seriesProv = await mk(`s08-prov-${RUN}`, cairoAt(shift(dueDay, 60), 23, 59));
    priorSeries = (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'cambridge', month: 'june', year: Y, label: `s08-prior-${RUN}` } })))!.id;
    subjAName = `Biology (08s ${RUN})`;
    subjA = (await apiResponse(adm.api.v1.subjects.$post({ json: { name: subjAName, code: `S08A-${RUN}`, council: 'cambridge', courseFee: 1000, registrationFee: 500, isOfferedAtSchool: true, isCore: false } })))!.id;
    const subjP = (await apiResponse(adm.api.v1.subjects.$post({ json: { name: `Chemistry (08s ${RUN})`, code: `S08P-${RUN}`, council: 'cambridge', courseFee: 1000, registrationFee: 500, isOfferedAtSchool: true, isCore: false } })))!.id;
    await apiResponse(adm.api.v1['board-fees'].$put({ query: { seriesId: seriesA }, json: { rows: [{ keyKind: 'subject', keyId: subjA, amount: 500, provisional: false }] } }));
    await apiResponse(adm.api.v1['board-fees'].$put({ query: { seriesId: seriesProv }, json: { rows: [{ keyKind: 'subject', keyId: subjP, amount: 500, provisional: true }] } }));
    feeProv = (await one<{ id: string }>(`select id from board_fee where board_series_id = $1 and key_id = $2`, [seriesProv, subjP])).id;
    const offer = async (subjectId: string, seriesId: string) => (await apiResponse(adm.api.v1.sessions[':id'].offers.$post({
      param: { id: sessionA }, json: {
        subjectId, courseFee: 1000, teachers: [{ teacherId, mode: 'in_school' }],
        items: [{ label: 'Whole subject', kind: 'whole', enters: { kind: 'subject' }, boardSeriesId: seriesId, availability: 'open', requiredInSeries: false }],
      },
    })))!.items[0]!;
    itemA = await offer(subjA, seriesA);
    itemProv = await offer(subjP, seriesProv);
  });

  // ─── The seeded rules, the templates, the settings ────────────────────────────

  it('one rule per kind for every session, seeded with the defaults; the school texts in English and Arabic; WhatsApp has no sender', async () => {
    const { rules, settings } = await apiResponse(finadmin.api.v1.reminders.rules.$get());
    const global = Object.fromEntries(rules.filter((r) => r.sessionId === null).map((r) => [r.kind, r]));
    expect(global.payment_due).toMatchObject({ offsetsDays: [-7, -3, 0, 3], repeatEveryDays: 3, until: 'paid', channels: ['in_app', 'email'], templateId: TPL.paymentDue, overdueTemplateId: TPL.paymentOverdue, active: true });
    expect(global.session_closing).toMatchObject({ offsetsDays: [-14, -7, -1], repeatEveryDays: null, until: 'closed' });
    expect(global.entry_deadline).toMatchObject({ offsetsDays: [-14, -1], channels: ['in_app'], until: 'deadline' });
    expect(global.school_fee_due).toMatchObject({ offsetsDays: [-14, -7, 0], repeatEveryDays: 7, until: 'paid' });
    expect(global.declared_retakes_to_verify).toMatchObject({ offsetsDays: [-14, -7, -3, -1], until: 'verified' });
    expect(settings).toEqual({ enabled: true, sendAtHour: 9 });
    const templates = await apiResponse(officer.api.v1.messages.templates.$get());
    const due = templates.find((t) => t.key === 'payment_due')!;
    expect(due.titleEn).toBe('Payment due — {session}');
    expect(due.titleAr).toBe('موعد الدفع — {session}');
    // WhatsApp is a channel with no sender: refused wherever it is asked for.
    const wa = await refused(adm.api.v1.messages.$post({ json: { audience: { definition: { kind: 'direct', userIds: [coordinator.id] } }, title: 'A message on WhatsApp', body: 'This should not go out on WhatsApp.', channels: ['in_app', 'whatsapp'] } }));
    expect(wa.status).toBe(400);
    expect(wa.error).toContain('WhatsApp is not connected yet');
    expect((await refused(finadmin.api.v1.reminders.rules.$put({ json: { kind: 'payment_due', sessionId: null, offsetsDays: [-7], repeatEveryDays: null, channels: ['whatsapp'], templateId: TPL.paymentDue, active: true, reason: 'try WhatsApp' } }))).status).toBe(400);
  });

  // ─── A payment reminder at −7, −3, 0, +3, repeating until paid ───────────────

  describe('a payment reminder: −7, −3, the day, +3, then every 3 days until paid', () => {
    let fPays: Family, fOwes: Family, linePays: string, lineOwes: string;

    beforeAll(async () => {
      fPays = await onboard(officer, `s08-pays-${RUN}`, 11);
      fOwes = await onboard(officer, `s08-owes-${RUN}`, 11);
      linePays = await reserveUnpaid(fPays, itemA);
      lineOwes = await reserveUnpaid(fOwes, itemA);
      // Due on the session's payment date, as dueDateFor makes it.
      expect(cairoDay(new Date((await one<{ d: string }>(`select due_at as d from registration where id = $1`, [lineOwes])).d))).toBe(dueDay);
    });

    it('nothing before its day in Cairo, nothing before the send hour; at 09:00 Cairo on day −7 both families are reminded, once', async () => {
      await step(cairoAt(shift(dueDay, -8), 23, 59));
      expect(await offsetsOf(lineOwes)).toEqual([]);
      await step(cairoAt(shift(dueDay, -7), 8, 59));
      expect(await offsetsOf(lineOwes)).toEqual([]);
      await step(cairoAt(shift(dueDay, -7), 9, 0));
      expect(await offsetsOf(lineOwes)).toEqual([-7]);
      expect(await offsetsOf(linePays)).toEqual([-7]);
      // The parent and the student each have it in the app.
      const [n] = await notificationsFor(fOwes.parent.email, 'PAYMENT_REMINDER');
      expect(n!.title).toBe(`Payment due — ${sessionAName} · موعد الدفع — ${sessionAName}`);
      expect(n!.body).toContain(`Dear Parent s08-owes-${RUN}, EGP 1,500 for Student s08-owes-${RUN} (${subjAName}) is due on ${enDay(dueDay)}.`);
      expect(n!.body).toContain(`مبلغ 1,500 جنيه الخاص بـ Student s08-owes-${RUN} (${subjAName}) مستحق في ${arDay(dueDay)}`);
      expect(await reminderCount(fOwes.student.email)).toBe(1);
      // The same minute again, and the next hour: claimed already, nothing more.
      await step(cairoAt(shift(dueDay, -7), 9, 0));
      await step(cairoAt(shift(dueDay, -7), 10, 0));
      expect(await offsetsOf(lineOwes)).toEqual([-7]);
      expect(await reminderCount(fOwes.parent.email)).toBe(1);
    });

    it('a day whose hour passed while nothing ran goes out at the next tick, once; the days between are quiet', async () => {
      await step(cairoAt(shift(dueDay, -5), 12));
      expect(await offsetsOf(lineOwes)).toEqual([-7]);
      // Day −3: the step did not run at 09:00; at 10:30 it catches up.
      await step(cairoAt(shift(dueDay, -3), 10, 30));
      await step(cairoAt(shift(dueDay, -3), 10, 31));
      expect(await offsetsOf(lineOwes)).toEqual([-7, -3]);
      expect(await offsetsOf(linePays)).toEqual([-7, -3]);
      expect(await reminderCount(fOwes.parent.email)).toBe(2);
    });

    it('the line paid between two days stops its reminders; the unpaid one is reminded on the day, then with the overdue text at +3, +6, +9', async () => {
      await payAtDesk(fPays, [linePays]);
      expect((await one<{ status: string }>(`select status from registration where id = $1`, [linePays])).status).toBe('confirmed');
      await step(cairoAt(dueDay, 9));
      expect(await offsetsOf(linePays)).toEqual([-7, -3]);
      expect(await offsetsOf(lineOwes)).toEqual([-7, -3, 0]);
      await step(cairoAt(shift(dueDay, 3), 9));
      await step(cairoAt(shift(dueDay, 5), 9));
      await step(cairoAt(shift(dueDay, 6), 9));
      await step(cairoAt(shift(dueDay, 7), 9));
      await step(cairoAt(shift(dueDay, 9), 9, 30));
      expect(await offsetsOf(lineOwes)).toEqual([-7, -3, 0, 3, 6, 9]);
      expect(await offsetsOf(linePays)).toEqual([-7, -3]);
      const all = await notificationsFor(fOwes.parent.email, 'PAYMENT_REMINDER');
      expect(all).toHaveLength(6);
      expect(all.at(-1)!.title).toBe(`Payment overdue — ${sessionAName} · دفعة متأخرة — ${sessionAName}`);
      expect(all.at(-1)!.body).toContain(`EGP 1,500 for Student s08-owes-${RUN} (${subjAName}) was due on ${enDay(dueDay)} and is still unpaid.`);
      expect(await reminderCount(fPays.parent.email)).toBe(2);
      // Each send claimed under the rule for every session, each claim on its anchor day.
      expect((await claimsOf(lineOwes)).every((c) => c.kind === 'payment_due' && c.anchor_on === dueDay)).toBe(true);
    });

    it('what went out: the reminders list and the log, each message with its deliveries per channel', async () => {
      const sent = await apiResponse(finadmin.api.v1.reminders.sent.$get({ query: { kind: 'payment_due', sessionId: sessionA } }));
      expect(sent.length).toBeGreaterThanOrEqual(6);
      const msgIds = (await sql<{ message_id: string }>(`select message_id from reminder_sent where target_id = $1`, [lineOwes])).map((r) => r.message_id);
      const one9 = sent.find((s) => s.messageId === msgIds.at(-1))!;
      expect(one9.offsets).toContain(9);
      for (const id of msgIds) await emailsSettled(id);
      const d = await apiResponse(finadmin.api.v1.messages.deliveries.$get({ query: { messageId: msgIds.at(-1)! } }));
      const mine = d.deliveries.filter((x) => x.student?.id === fOwes.studentId);
      expect(mine.map((x) => [x.recipient.name, x.channel, x.status]).sort()).toEqual([
        [`Parent s08-owes-${RUN}`, 'email', 'sent'], [`Parent s08-owes-${RUN}`, 'in_app', 'sent'],
        [`Student s08-owes-${RUN}`, 'email', 'sent'], [`Student s08-owes-${RUN}`, 'in_app', 'sent'],
      ].sort());
      // The log lists the reminder with its counts; the finance officer sees the payment reminders too.
      const log = await apiResponse(officer.api.v1.messages.$get({ query: { source: 'reminder', limit: '200' } }));
      const row = log.find((m) => m.id === msgIds.at(-1))!;
      expect(row.audience.label).toMatch(/^Reminder: Payment due/);
      expect(row.deliveries.in_app.sent).toBeGreaterThanOrEqual(2);
      // Every send audited in its transaction.
      expect((await sql(`select 1 from audit_log where action = 'REMINDERS_SENT' and entity_id = any(string_to_array($1, ','))`, [msgIds.join(',')])).length).toBe(msgIds.length);
    });
  });

  // ─── Two scheduler instances at once ─────────────────────────────────────────

  it('two scheduler instances running the step at the same minute send once: the second waits on the first one\'s claim and finds it taken', async () => {
    const f = await onboard(officer, `s08-race-${RUN}`, 11);
    const line = await reserveUnpaid(f, itemA);
    const at = cairoAt(shift(dueDay, -7), 9, 5);
    const p = await pauseAtAudits(['REMINDERS_SENT']);
    try {
      const first = step(at);
      await p.paused('REMINDERS_SENT');
      const second = step(at);
      // The second instance is held by the first's uncommitted claim (and the first by the pause).
      await lockWaiters(2);
      await p.releaseAll();
      await Promise.all([first, second]);
    } finally {
      await p.releaseAll();
    }
    expect(await offsetsOf(line)).toEqual([-7]);
    expect(await reminderCount(f.parent.email)).toBe(1);
    expect(await reminderCount(f.student.email)).toBe(1);
    const inApp = await sql(`select 1 from message_delivery where student_id = $1 and recipient_id = $2 and channel = 'in_app'`, [f.studentId, f.parent.id]);
    expect(inApp).toHaveLength(1);
  });

  // ─── A provisional line ──────────────────────────────────────────────────────

  it('a line on a provisional board fee is not reminded (it cannot be paid yet); confirmed, it is reminded once', async () => {
    const f = await onboard(officer, `s08-prov-${RUN}`, 11);
    const line = await reserveUnpaid(f, itemProv);
    expect((await one<{ p: boolean }>(`select price_provisional as p from registration where id = $1`, [line])).p).toBe(true);
    await step(cairoAt(shift(dueDay, -7), 9, 10));
    expect(await offsetsOf(line)).toEqual([]);
    await apiResponse(finadmin.api.v1['board-fees'][':seriesId'].confirm.$post({ param: { seriesId: seriesProv }, json: { rows: [{ feeId: feeProv }], reason: 'the board published its fee' } }));
    expect((await one<{ p: boolean; d: string }>(`select price_provisional as p, due_at as d from registration where id = $1`, [line])).p).toBe(false);
    // Its due date is still the session's (the confirmation plus the grace is earlier): reminded on day −3, once.
    await step(cairoAt(shift(dueDay, -3), 9, 10));
    await step(cairoAt(shift(dueDay, -3), 9, 11));
    expect(await offsetsOf(line)).toEqual([-3]);
    expect(await reminderCount(f.parent.email)).toBe(1);
  });

  // ─── An instalment and a charge, by the same rule ────────────────────────────

  it('an instalment and a charge are reminded by the payment rule, together; the line its plan pays is not', async () => {
    const f = await onboard(officer, `s08-plan-${RUN}`, 11);
    const line = await reserveUnpaid(f, itemA);
    const firstDue = cairoAt(shift(cairoDay(new Date()), 12), 12);
    const plan = await apiResponse(finadmin.api.v1.exceptions.$post({
      json: { policyKey: 'plan.instalments', studentId: f.studentId, scope: { registrationId: line }, reason: 'paying in two instalments',
        value: [{ dueAt: firstDue.toISOString(), amount: 750 }, { dueAt: cairoAt(shift(cairoDay(new Date()), 20), 12).toISOString(), amount: 750 }] },
    }));
    const [inst1] = await sql<{ id: string }>(`select id from charge where plan_exception_id = $1 order by instalment_no`, [plan.id]);
    const custom = await apiResponse(finadmin.api.v1.charges.$post({ json: { studentId: f.studentId, kind: 'custom', amount: 200, description: 'A replacement ID card', dueAt: firstDue, reason: 'lost the card' } }));
    // Day −7 of the first instalment's date.
    await step(cairoAt(shift(cairoDay(firstDue), -7), 9, 0));
    expect(await offsetsOf(inst1!.id)).toEqual([-7]);
    expect(await offsetsOf(custom.id)).toEqual([-7]);
    expect(await offsetsOf(line)).toEqual([]);
    const [n] = await notificationsFor(f.parent.email, 'PAYMENT_REMINDER');
    expect(n!.body).toContain(`EGP 950 for Student s08-plan-${RUN} (`);
    expect(n!.body).toContain('A replacement ID card');
    // One message, two claims (one per target) under the payment rule.
    const claims = await sql<{ message_id: string; rule_id: string }>(`select message_id, rule_id from reminder_sent where target_id in ($1, $2)`, [inst1!.id, custom.id]);
    expect(new Set(claims.map((c) => c.message_id)).size).toBe(1);
    expect(claims.every((c) => c.rule_id === 'rule-payment-due')).toBe(true);
  });

  // ─── A session's own rule ────────────────────────────────────────────────────

  it("a session's own rule overrides the rule for every session there; switched off, nothing goes; dropped, the session follows every session's rule again", async () => {
    const sessionB = (await apiResponse(adm.api.v1.sessions.$post({
      json: { type: 'june', year: Y + 1, label: `s08b-${RUN}`, startDate: new Date(Date.now() - DAY).toISOString(), endDate: sessionAEnd.toISOString(), courseStartsOn: cairoDay(new Date()), paymentDueAt: cairoAt(dueDay, 12).toISOString() },
    })))!.id;
    const itemB = (await apiResponse(adm.api.v1.sessions[':id'].offers.$post({
      param: { id: sessionB }, json: { subjectId: subjA, courseFee: 1000, teachers: [{ teacherId, mode: 'in_school' }], items: [{ label: 'Whole subject', kind: 'whole', enters: { kind: 'subject' }, boardSeriesId: seriesA, availability: 'open', requiredInSeries: false }] },
    })))!.items[0]!;
    const fB = await onboard(officer, `s08-ovr-${RUN}`, 11);
    const fA = await onboard(officer, `s08-glob-${RUN}`, 11);
    const lineB = await reserveUnpaid(fB, itemB, sessionB);
    const lineA = await reserveUnpaid(fA, itemA);
    const put = (json: Parameters<typeof finadmin.api.v1.reminders.rules.$put>[0]['json']) => apiResponse(finadmin.api.v1.reminders.rules.$put({ json }));
    const own = await put({ kind: 'payment_due', sessionId: sessionB, offsetsDays: [-10], repeatEveryDays: null, channels: ['in_app'], templateId: TPL.paymentDue, active: true, reason: 'this session reminds ten days ahead' });
    const audit = await one<{ n: Record<string, unknown> }>(`select new_data as n from audit_log where action = 'REMINDER_RULE_SET' and entity_id = $1`, [own.id]);
    expect(audit.n).toMatchObject({ kind: 'payment_due', sessionId: sessionB, offsetsDays: [-10] });
    await step(cairoAt(shift(dueDay, -10), 9));
    expect(await offsetsOf(lineB)).toEqual([-10]);
    expect(await offsetsOf(lineA)).toEqual([]);
    await step(cairoAt(shift(dueDay, -7), 9, 20));
    expect(await offsetsOf(lineB)).toEqual([-10]);
    expect(await offsetsOf(lineA)).toEqual([-7]);
    // In the app only, as its own rule says.
    const ovrMsg = (await one<{ message_id: string }>(`select message_id from reminder_sent where target_id = $1`, [lineB])).message_id;
    expect((await sql<{ channel: string }>(`select distinct channel from message_delivery where message_id = $1 and student_id = $2`, [ovrMsg, fB.studentId])).map((r) => r.channel)).toEqual(['in_app']);
    // Switched off for this session: the day itself passes in silence there.
    await put({ kind: 'payment_due', sessionId: sessionB, offsetsDays: [-10, 0], repeatEveryDays: null, channels: ['in_app'], templateId: TPL.paymentDue, active: false, reason: 'not this session' });
    await step(cairoAt(dueDay, 9, 20));
    expect(await offsetsOf(lineB)).toEqual([-10]);
    expect(await offsetsOf(lineA)).toEqual([-7, 0]);
    // Dropped: the session follows the rule for every session (+3, the overdue day).
    await put({ kind: 'payment_due', sessionId: sessionB, offsetsDays: [-10], repeatEveryDays: null, channels: ['in_app'], templateId: TPL.paymentDue, active: true, inherit: true, reason: 'back to the school rule' });
    await step(cairoAt(shift(dueDay, 3), 9, 20));
    expect(await offsetsOf(lineB)).toEqual([-10, 3]);
    const rules = (await apiResponse(finadmin.api.v1.reminders.rules.$get())).rules;
    expect(rules.some((r) => r.sessionId === sessionB)).toBe(false);
    // A kind that is the school's, not a session's, has no override; only a payment runs after its date.
    expect((await refused(finadmin.api.v1.reminders.rules.$put({ json: { kind: 'school_fee_due', sessionId: sessionB, offsetsDays: [-7], repeatEveryDays: null, channels: ['in_app'], templateId: 'tpl-school-fee-due', active: true, reason: 'not possible' } }))).status).toBe(400);
    expect((await refused(finadmin.api.v1.reminders.rules.$put({ json: { kind: 'session_closing', sessionId: null, offsetsDays: [-7, 2], repeatEveryDays: null, channels: ['in_app'], templateId: 'tpl-session-closing', active: true, reason: 'after the close' } }))).status).toBe(400);
    // The finance officer does not set rules.
    expect((await refused(officer.api.v1.reminders.rules.$get())).status).toBe(403);
  });

  // ─── Audiences ───────────────────────────────────────────────────────────────

  it('"parents of grade 11" is an audience: the parents of every grade-11 student today, not a parent of grade 10, not the students', async () => {
    const g11 = await onboard(officer, `s08-g11-${RUN}`, 11);
    const g10 = await onboard(officer, `s08-g10-${RUN}`, 10);
    const r = await apiResponse(adm.api.v1.messages.audiences.resolve.$post({ json: { audience: { savedId: 'aud-parents-grade-11' } } }));
    const expected = await one<{ n: string }>(`select count(distinct l.parent_id) as n from parent_student_link l join "user" s on s.id = l.student_id join "user" p on p.id = l.parent_id
      where l.status = 'approved' and s.role = 'student' and s.left_on is null and coalesce(s.banned, false) = false and coalesce(p.banned, false) = false
        and school_grade(s.cohort_year, school_academic_year_start(now())) = 11`);
    expect(r.people).toBe(Number(expected.n));
    expect(r.label).toBe('Parents of grade 11');
    expect(r.fills).toEqual(expect.arrayContaining(['guardian', 'student']));
    const sent = await apiResponse(adm.api.v1.messages.$post({ json: {
      audience: { savedId: 'aud-parents-grade-11' }, title: 'Grade 11 parents evening', body: 'Dear {guardian}, the grade 11 parents evening is on Thursday. Please come with {student}.', language: 'en', channels: ['in_app'],
    } }));
    expect(sent).toMatchObject({ status: 'sent', people: Number(expected.n) });
    const [n] = await notificationsFor(g11.parent.email, 'BULK_ANNOUNCEMENT');
    expect(n).toMatchObject({ title: 'Grade 11 parents evening', body: `Dear Parent s08-g11-${RUN}, the grade 11 parents evening is on Thursday. Please come with Student s08-g11-${RUN}.` });
    expect(await notificationsFor(g10.parent.email, 'BULK_ANNOUNCEMENT')).toEqual([]);
    expect(await notificationsFor(g11.student.email, 'BULK_ANNOUNCEMENT')).toEqual([]);
    await one(`select 1 from audit_log where action = 'MESSAGE_SENT' and entity_id = $1`, [sent.id]);
    // The audience as it was resolved is kept with the message.
    expect((await one<{ c: number; k: string }>(`select a.resolved_count as c, a.kind as k from message m join message_audience a on a.id = m.audience_id where m.id = $1`, [sent.id]))).toEqual({ c: Number(expected.n), k: 'broadcast' });
  });

  it("a batch to a session's unpaid families (the Money tab's \"Remind\", sent by the finance officer): the families who owe, with what they owe; not the family that paid; only those ticked", async () => {
    const owes1 = await onboard(officer, `s08-rem1-${RUN}`, 12);
    const owes2 = await onboard(officer, `s08-rem2-${RUN}`, 12);
    const paid = await onboard(officer, `s08-rem3-${RUN}`, 12);
    await reserveUnpaid(owes1, itemA);
    await reserveUnpaid(owes2, itemA);
    await payAtDesk(paid, [await reserveUnpaid(paid, itemA)]);
    const definition = { kind: 'batch' as const, list: 'session_unpaid' as const, sessionId: sessionA, include: 'both' as const, filter: 'unpaid' as const, who: 'families' as const };
    const preview = await apiResponse(officer.api.v1.messages.audiences.resolve.$post({ json: { audience: { definition } } }));
    const ids = preview.students.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining([owes1.studentId, owes2.studentId]));
    expect(ids).not.toContain(paid.studentId);
    expect(preview.students.find((s) => s.id === owes1.studentId)).toMatchObject({ amount: 1500 });
    expect(preview.fills).toEqual(expect.arrayContaining(['amount', 'due', 'items', 'session', 'closes']));
    // "Remind" with one family unticked.
    const sent = await apiResponse(officer.api.v1.messages.$post({ json: {
      audience: { definition: { ...definition, studentIds: [owes1.studentId] } }, templateId: TPL.paymentDue, channels: ['in_app', 'email'],
    } }));
    expect(sent.status).toBe('sent');
    const [n] = await notificationsFor(owes1.parent.email, 'PAYMENT_REMINDER');
    expect(n!.body).toContain(`EGP 1,500 for Student s08-rem1-${RUN} (${subjAName}) is due on ${enDay(dueDay)}`);
    expect(await notificationsFor(owes2.parent.email, 'PAYMENT_REMINDER')).toEqual([]);
    expect(await notificationsFor(paid.parent.email, 'PAYMENT_REMINDER')).toEqual([]);
    // Finance sends to the money lists only, and reads only those messages.
    const bc = await refused(officer.api.v1.messages.$post({ json: { audience: { savedId: 'aud-parents' }, title: 'From the finance office', body: 'A broadcast the finance office may not send.', channels: ['in_app'] } }));
    expect(bc).toEqual({ status: 403, error: "Finance sends to a money list only: a session's unpaid families or the holders of a charge" });
    const broadcastId = (await one<{ id: string }>(`select m.id from message m join message_audience a on a.id = m.audience_id where a.kind = 'broadcast' and m.source = 'staff' order by m.created_at desc limit 1`)).id;
    expect((await refused(officer.api.v1.messages.deliveries.$get({ query: { messageId: broadcastId } }))).status).toBe(403);
    expect((await apiResponse(officer.api.v1.messages.$get({ query: { limit: '200' } }))).some((m) => m.id === broadcastId)).toBe(false);
  });

  it('a direct message to chosen people; a variable an audience cannot fill is refused before anything is sent', async () => {
    const f = await onboard(officer, `s08-dir-${RUN}`, 10);
    const json = { audience: { definition: { kind: 'direct' as const, userIds: [f.parent.id, coordinator.id] } }, title: 'A word about the timetable', body: 'Dear {guardian}, the timetable changes next week.', language: 'en' as const, channels: ['in_app' as const] };
    const r = await refused(adm.api.v1.messages.$post({ json }));
    expect(r.status).toBe(400);
    expect(r.error).toContain('This audience cannot fill {guardian}');
    expect(await notificationsFor(f.parent.email, 'SCHOOL_MESSAGE')).toEqual([]);
    const sent = await apiResponse(adm.api.v1.messages.$post({ json: { ...json, body: 'The timetable changes next week: see the board in the lobby.' } }));
    expect(sent).toMatchObject({ status: 'sent', people: 2 });
    expect(await notificationsFor(f.parent.email, 'SCHOOL_MESSAGE')).toEqual([{ type: 'SCHOOL_MESSAGE', title: 'A word about the timetable', body: 'The timetable changes next week: see the board in the lobby.' }]);
    expect(await notificationsFor(coordinator.email, 'SCHOOL_MESSAGE')).toHaveLength(1);
    expect(await notificationsFor(f.student.email, 'SCHOOL_MESSAGE')).toEqual([]);
  });

  // ─── Scheduled ───────────────────────────────────────────────────────────────

  it('a scheduled message is sent by the tick at its time and not before; a cancelled one is never sent; a sent one cannot be cancelled', async () => {
    const g = await onboard(officer, `s08-sch-${RUN}`, 10);
    const when = new Date(Date.now() + 2 * 3_600_000);
    const s = await apiResponse(adm.api.v1.messages.$post({ json: {
      audience: { savedId: 'aud-parents-grade-10' }, title: 'Tomorrow: the grade 10 trip', body: 'The grade 10 trip leaves at 8:00 from the main gate.', language: 'en', channels: ['in_app', 'email'], scheduledAt: when,
    } }));
    expect(s).toMatchObject({ status: 'scheduled' });
    const c = await apiResponse(adm.api.v1.messages.$post({ json: {
      audience: { savedId: 'aud-parents-grade-10' }, title: 'A notice we cancel', body: 'This notice is cancelled before its time.', language: 'en', channels: ['in_app'], scheduledAt: when,
    } }));
    await apiResponse(adm.api.v1.messages[':id'].cancel.$post({ param: { id: c.id }, json: { reason: 'sent by mistake' } }));
    await step(new Date(when.getTime() - 60_000));
    expect((await one<{ status: string }>(`select status from message where id = $1`, [s.id])).status).toBe('scheduled');
    expect(await sql(`select 1 from message_delivery where message_id = $1`, [s.id])).toEqual([]);
    expect(await notificationsFor(g.parent.email, 'BULK_ANNOUNCEMENT')).toEqual([]);
    await step(new Date(when.getTime() + 1000));
    expect((await one<{ status: string }>(`select status from message where id = $1`, [s.id])).status).toBe('sent');
    expect(await notificationsFor(g.parent.email, 'BULK_ANNOUNCEMENT')).toEqual([{ type: 'BULK_ANNOUNCEMENT', title: 'Tomorrow: the grade 10 trip', body: 'The grade 10 trip leaves at 8:00 from the main gate.' }]);
    await emailsSettled(s.id);
    expect((await one<{ status: string }>(`select status from message_delivery where message_id = $1 and recipient_id = $2 and channel = 'email'`, [s.id, g.parent.id])).status).toBe('sent');
    // A second tick sends nothing more.
    await step(new Date(when.getTime() + 61_000));
    expect(await notificationsFor(g.parent.email, 'BULK_ANNOUNCEMENT')).toHaveLength(1);
    expect((await one<{ status: string }>(`select status from message where id = $1`, [c.id])).status).toBe('cancelled');
    expect(await sql(`select 1 from message_delivery where message_id = $1`, [c.id])).toEqual([]);
    expect((await refused(adm.api.v1.messages[':id'].cancel.$post({ param: { id: s.id }, json: { reason: 'too late' } })))).toEqual({ status: 409, error: 'This message was already sent: only a scheduled message can be cancelled' });
    await one(`select 1 from audit_log where action = 'MESSAGE_CANCELLED' and entity_id = $1`, [c.id]);
    await one(`select 1 from audit_log where action = 'MESSAGE_SENT' and entity_id = $1 and new_data->>'dispatchedBy' = 'scheduler'`, [s.id]);
  });

  // ─── Nobody deletes ──────────────────────────────────────────────────────────

  it('families cannot delete a message or a notification: there is no such route; marking read keeps every row, the student\'s too', async () => {
    const routes = (await app()).routes.filter((r) => /^\/v1\/(notifications|messages)/.test(r.path));
    expect(routes.filter((r) => r.method === 'DELETE')).toEqual([]);
    const f = await onboard(officer, `s08-del-${RUN}`, 11);
    const sent = await apiResponse(adm.api.v1.messages.$post({ json: {
      audience: { definition: { kind: 'direct', userIds: [f.parent.id, f.studentId] } }, title: 'Kept in your notifications', body: 'This message stays in your notifications.', language: 'en', channels: ['in_app'],
    } }));
    for (const who of [f.parent, f.student]) {
      const mine = await apiResponse(who.api.v1.notifications.$get({ query: {} }));
      const n = mine.find((x) => (x.data as { messageId?: string } | null)?.messageId === sent.id)!;
      await apiResponse(who.api.v1.notifications[':id'].read.$put({ param: { id: n.id } }));
      const row = await one<{ read_at: string | null }>(`select read_at from notification where id = $1`, [n.id]);
      expect(row.read_at).not.toBeNull();
    }
    expect((await sql(`select 1 from message_delivery where message_id = $1 and status = 'sent'`, [sent.id])).length).toBe(2);
  });

  // ─── Templates ───────────────────────────────────────────────────────────────

  it('a template with every variable renders in both languages for each family', async () => {
    const f = await onboard(officer, `s08-tpl-${RUN}`, 12);
    await reserveUnpaid(f, itemA);
    const tpl = await apiResponse(adm.api.v1.messages.templates.$post({ json: {
      name: `Every variable (08s ${RUN})`,
      titleEn: '{session}: {student}', bodyEn: 'Dear {guardian}, {amount} for {student} ({items}) is due on {due}; reservations close on {closes}.',
      titleAr: '{session}: {student}', bodyAr: 'عزيزي {guardian}، مبلغ {amount} لـ {student} ({items}) مستحق في {due}؛ ويغلق الحجز في {closes}.',
      reason: 'a template for the test',
    } }));
    await one(`select 1 from audit_log where action = 'MESSAGE_TEMPLATE_SAVED' and entity_id = $1`, [tpl.id]);
    await apiResponse(adm.api.v1.messages.$post({ json: {
      audience: { definition: { kind: 'batch', list: 'session_unpaid', sessionId: sessionA, include: 'both', filter: 'unpaid', studentIds: [f.studentId], who: 'parents' } },
      templateId: tpl.id, channels: ['in_app'],
    } }));
    const [n] = await notificationsFor(f.parent.email, 'PAYMENT_REMINDER');
    const student = `Student s08-tpl-${RUN}`;
    const closes = cairoDay(sessionAEnd);
    expect(n!.title).toBe(`${sessionAName}: ${student} · ${sessionAName}: ${student}`);
    expect(n!.body).toBe(
      `Dear Parent s08-tpl-${RUN}, EGP 1,500 for ${student} (${subjAName}) is due on ${enDay(dueDay)}; reservations close on ${enDay(closes)}.\n\n` +
      `عزيزي Parent s08-tpl-${RUN}، مبلغ 1,500 جنيه لـ ${student} (${subjAName}) مستحق في ${arDay(dueDay)}؛ ويغلق الحجز في ${arDay(closes)}.`,
    );
    // An unknown name in braces is refused, so a typo never goes out as written.
    expect((await refused(adm.api.v1.messages.templates.$post({ json: { name: `Typo (08s ${RUN})`, titleEn: 'Hello {studnet}', bodyEn: 'A text with a typo in it.', titleAr: 'مرحبا', bodyAr: 'نص فيه خطأ مطبعي.', reason: 'a typo' } }))).status).toBe(400);
  });

  // ─── A failed email ──────────────────────────────────────────────────────────

  it('a failed email is recorded on its delivery, the in-app copy is still delivered, and the others are sent', async () => {
    const bad = await onboard(officer, `s08-bad-${RUN}`, 12);
    const good = await onboard(officer, `s08-good-${RUN}`, 12);
    // A family whose address on file is not an address (the school's sheet has some).
    await sql(`update "user" set email = $1 where id = $2`, [`not-an-address-${RUN}`, bad.parent.id]);
    try {
      const sent = await apiResponse(adm.api.v1.messages.$post({ json: {
        audience: { definition: { kind: 'direct', userIds: [bad.parent.id, good.parent.id] } }, title: 'Results day', body: 'Results are published on Thursday at noon.', language: 'en', channels: ['in_app', 'email'],
      } }));
      await emailsSettled(sent.id);
      const d = await apiResponse(adm.api.v1.messages.deliveries.$get({ query: { messageId: sent.id } }));
      const of = (who: string, channel: string) => d.deliveries.find((x) => x.recipient.id === who && x.channel === channel)!;
      expect(of(bad.parent.id, 'email')).toMatchObject({ status: 'failed', error: 'The email address on file is not a valid address', address: `not-an-address-${RUN}` });
      expect(of(bad.parent.id, 'in_app')).toMatchObject({ status: 'sent' });
      expect(of(good.parent.id, 'email')).toMatchObject({ status: 'sent', error: null });
      const mine = await apiResponse(bad.parent.api.v1.notifications.$get({ query: {} }));
      expect(mine.find((x) => (x.data as { messageId?: string } | null)?.messageId === sent.id)).toMatchObject({ title: 'Results day', emailSentAt: null });
      const log = (await apiResponse(adm.api.v1.messages.$get({ query: { source: 'staff', limit: '200' } }))).find((m) => m.id === sent.id)!;
      expect(log.deliveries).toEqual({ in_app: { sent: 2, failed: 0, waiting: 0 }, email: { sent: 1, failed: 1, waiting: 0 } });
    } finally {
      await sql(`update "user" set email = $1 where id = $2`, [bad.parent.email, bad.parent.id]);
    }
  });

  // ─── Staff reminders ─────────────────────────────────────────────────────────

  it('staff reminders: the closing of a session to families; a board deadline to the staff with how many lines wait; a declared retake to the coordinator until verified', async () => {
    const f = await onboard(officer, `s08-staff-${RUN}`, 12);
    // A declared retake of the board's previous June: listed To verify, its deadline the series' entry deadline.
    const desk = await apiResponse(officer.api.v1.registrations.desk.$post({
      json: { studentId: f.studentId, sessionId: sessionA, lines: [{ offerItemId: itemA, attempt: 'retake', mode: 'in_school', teacherId, priorSittingSeriesId: priorSeries }], consent: CONSENT },
    }));
    const declared = desk.registrations[0]!.id;
    expect((await one<{ s: string }>(`select prior_sitting_source as s from registration where id = $1`, [declared])).s).toBe('declared_by_desk');
    const deadlineDay = cairoDay(new Date((await one<{ d: string }>(`select entry_deadline as d from board_series where id = $1`, [seriesA])).d));
    // Day −14 of the series' deadline: the staff hear of the waiting lines, the coordinator of the sitting to verify.
    await step(cairoAt(shift(deadlineDay, -14), 9, 0));
    const staffNote = (await notificationsFor(adm.email, 'STAFF_REMINDER')).find((n) => n.title.includes(`(s08-${RUN})`))!;
    expect(staffNote.title).toContain(`the board's entry deadline is ${enDay(deadlineDay)}`);
    const waiting = await one<{ n: string }>(`select count(*) as n from registration r where r.board_series_id = $1 and r.status in ('pending_approval', 'pending_payment')`, [seriesA]);
    expect(staffNote.body).toContain(`${waiting.n} lines in it are still unpaid`);
    const coord = (await notificationsFor(coordinator.email, 'STAFF_REMINDER')).filter((n) => n.title.startsWith(sessionAName));
    expect(coord).toHaveLength(1);
    expect(coord[0]!.title).toMatch(new RegExp(`^${sessionAName.replace(/[()]/g, '\\$&')}: \\d+ declared sittings to verify`));
    expect(await offsetsOf(declared, 'declared_retakes_to_verify')).toEqual([-14]);
    // Verified: no more reminders about it.
    await apiResponse(coordinator.api.v1.registrations[':id']['verify-prior'].$post({ param: { id: declared }, json: { outcome: 'verified', reason: 'the board statement of results' } }));
    await step(cairoAt(shift(deadlineDay, -7), 9, 0));
    expect(await offsetsOf(declared, 'declared_retakes_to_verify')).toEqual([-14]);
    // The session's closing, 14 days before its end: to the families.
    await step(cairoAt(shift(cairoDay(sessionAEnd), -14), 9, 0));
    const closing = (await notificationsFor(f.parent.email, 'SESSION_CLOSING_SOON')).filter((n) => n.title.startsWith(sessionAName));
    expect(closing).toHaveLength(1);
    expect(closing[0]!.title).toBe(`${sessionAName}: reservations close on ${enDay(cairoDay(sessionAEnd))} · ${sessionAName}: ينتهي الحجز في ${arDay(cairoDay(sessionAEnd))}`);
    expect(await offsetsOf(sessionA, 'session_closing')).toEqual([-14]);
  });

  it('reminders off (the setting): nothing goes out, and nothing missed meanwhile is sent as a backlog', async () => {
    const f = await onboard(officer, `s08-off-${RUN}`, 11);
    const line = await reserveUnpaid(f, itemA);
    await apiResponse(adm.api.v1.settings[':key'].$put({ param: { key: 'reminders.enabled' }, json: { value: false, reason: 'a quiet week' } }));
    try {
      await step(cairoAt(shift(dueDay, -7), 9, 30));
      await step(cairoAt(shift(dueDay, -3), 9, 30));
      expect(await offsetsOf(line)).toEqual([]);
    } finally {
      await apiResponse(adm.api.v1.settings[':key'].$put({ param: { key: 'reminders.enabled' }, json: { value: true, reason: 'back on' } }));
    }
    await step(cairoAt(shift(dueDay, -2), 9, 30));
    expect(await offsetsOf(line)).toEqual([-3]);
    expect(money((await one<{ n: string }>(`select count(*) as n from notification n join "user" u on u.id = n.user_id where u.email = $1 and n.type = 'PAYMENT_REMINDER'`, [f.parent.email])).n)).toBe(1);
  });
  // ─── Claims under concurrency: a scheduled message, a cancel, an email ───────

  it('two ticks at the same minute send a scheduled message once: the second finds it locked and leaves it', async () => {
    const g = await onboard(officer, `s08-tick2-${RUN}`, 10);
    const when = new Date(Date.now() + 3 * 3_600_000);
    const s = await apiResponse(adm.api.v1.messages.$post({ json: {
      audience: { definition: { kind: 'direct', userIds: [g.parent.id] } }, title: 'Sent once by two ticks', body: 'Two scheduler ticks run at once; this goes out once.', language: 'en', channels: ['in_app'], scheduledAt: when,
    } }));
    const p = await pauseAtAudits(['MESSAGE_SENT']);
    try {
      const first = step(new Date(when.getTime() + 1000));
      await p.paused('MESSAGE_SENT');
      // The second tick runs to its end while the first holds the message: it skips it (were the
      // message not claimed by its lock, the second would queue behind the first instead).
      const second = step(new Date(when.getTime() + 1000));
      await Promise.race([second, lockWaiters(2)]);
      await p.releaseAll();
      const [a, b] = await Promise.all([first, second]);
      expect([a.scheduledSent, b.scheduledSent].sort()).toEqual([0, 1]);
    } finally {
      await p.releaseAll();
    }
    expect(await notificationsFor(g.parent.email, 'SCHOOL_MESSAGE')).toHaveLength(1);
    expect(await sql(`select 1 from message_delivery where message_id = $1`, [s.id])).toHaveLength(1);
  });

  it('a cancel landing while the tick sends the message waits for it, and is refused: the message was sent', async () => {
    const g = await onboard(officer, `s08-cxl-${RUN}`, 10);
    const when = new Date(Date.now() + 4 * 3_600_000);
    const s = await apiResponse(adm.api.v1.messages.$post({ json: {
      audience: { definition: { kind: 'direct', userIds: [g.parent.id] } }, title: 'Cancelled too late', body: 'The admin cancels this while the tick is sending it.', language: 'en', channels: ['in_app'], scheduledAt: when,
    } }));
    const p = await pauseAtAudits(['MESSAGE_SENT']);
    let cancel: Awaited<ReturnType<typeof refused>> | null = null;
    try {
      const ticking = step(new Date(when.getTime() + 1000));
      await p.paused('MESSAGE_SENT');
      const cancelling = refused(adm.api.v1.messages[':id'].cancel.$post({ param: { id: s.id }, json: { reason: 'changed my mind' } }));
      await lockWaiters(2);
      await p.releaseAll();
      [, cancel] = await Promise.all([ticking, cancelling]);
    } finally {
      await p.releaseAll();
    }
    expect(cancel).toEqual({ status: 409, error: 'This message was already sent: only a scheduled message can be cancelled' });
    expect((await one<{ status: string }>(`select status from message where id = $1`, [s.id])).status).toBe('sent');
    expect(await notificationsFor(g.parent.email, 'SCHOOL_MESSAGE')).toHaveLength(1);
    expect(await sql(`select 1 from audit_log where action = 'MESSAGE_CANCELLED' and entity_id = $1`, [s.id])).toEqual([]);
  });

  it('an email claimed by a sender that stopped half way is marked failed at the next tick, never sent again', async () => {
    const g = await onboard(officer, `s08-stop-${RUN}`, 10);
    const when = new Date(Date.now() + 5 * 3_600_000);
    const s = await apiResponse(adm.api.v1.messages.$post({ json: {
      audience: { definition: { kind: 'direct', userIds: [g.parent.id] } }, title: 'A sender stopped', body: 'The process sending this email stopped half way.', language: 'en', channels: ['in_app', 'email'], scheduledAt: when,
    } }));
    const { dispatchScheduledMessages } = await import('../src/services/message.services');
    await dispatchScheduledMessages(new Date(when.getTime() + 1000));
    // The aftermath of a crash between the claim and the send, built by hand (as expireByHand builds one).
    await sql(`update message_delivery set status = 'sending', attempts = 1, updated_at = now() - interval '20 minutes' where message_id = $1 and channel = 'email'`, [s.id]);
    await step(new Date(when.getTime() + 60_000));
    const d = await one<{ status: string; attempts: number; error: string }>(`select status, attempts, error from message_delivery where message_id = $1 and channel = 'email'`, [s.id]);
    expect(d).toEqual({ status: 'failed', attempts: 1, error: 'Interrupted while sending: it may or may not have reached the person, and it is not sent again' });
  });

  it("a session the old 24-hour closing reminder already reached is not reminded again on its day −1", async () => {
    const f = await onboard(officer, `s08-n002-${RUN}`, 12);
    const end = cairoAt(shift(dueDay, 20), 23, 59);
    const legacy = (await apiResponse(adm.api.v1.sessions.$post({
      json: { type: 'june', year: Y + 1, label: `s08-n002-${RUN}`, startDate: new Date(Date.now() - DAY).toISOString(), endDate: end.toISOString(), courseStartsOn: cairoDay(new Date()), paymentDueAt: cairoAt(dueDay, 12).toISOString() },
    })))!.id;
    // NOT-002 ran before step D: it set reminder_sent_at. The rule still reminds 7 days before; its day −1 was NOT-002's.
    await sql(`update registration_session set reminder_sent_at = now() where id = $1`, [legacy]);
    await step(cairoAt(shift(cairoDay(end), -7), 9, 0));
    expect(await offsetsOf(legacy, 'session_closing')).toEqual([-7]);
    await step(cairoAt(shift(cairoDay(end), -1), 9, 0));
    expect(await offsetsOf(legacy, 'session_closing')).toEqual([-7]);
    expect((await notificationsFor(f.parent.email, 'SESSION_CLOSING_SOON')).filter((n) => n.title.includes(`s08-n002-${RUN}`))).toHaveLength(1);
  });
  it('a pushed school fee is reminded by the school-fee rule, 14 days before its date; paid, its reminders stop', async () => {
    const next = academicYearLabel(academicYearStartOf() + 1);
    const [existing] = await sql<{ id: string }>(`select id from school_fee_schedule where academic_year = $1 and grade is null`, [next]);
    const made = existing ? null : await apiResponse(finadmin.api.v1['school-fees'].schedules.$post({ json: { academicYear: next, amount: 5000, opensAt: new Date(Date.now() - DAY).toISOString() } }));
    try {
      const f = await onboard(officer, `s08-fee-${RUN}`, 11);
      const feeDay = shift(cairoDay(new Date()), 25);
      await apiResponse(finadmin.api.v1['school-fees'].push.$post({ json: { academicYear: next, studentIds: [f.studentId], dueAt: cairoAt(feeDay, 12) } }));
      const push = (await one<{ id: string; amount: string }>(`select id, amount from charge where student_id = $1 and kind = 'school_fee_push'`, [f.studentId]));
      await step(cairoAt(shift(feeDay, -14), 9, 0));
      expect(await offsetsOf(push.id, 'school_fee_due')).toEqual([-14]);
      const [n] = await notificationsFor(f.parent.email, 'PAYMENT_REMINDER');
      expect(n!.title).toBe(`School fee due — Student s08-fee-${RUN} · موعد الرسوم المدرسية — Student s08-fee-${RUN}`);
      expect(n!.body).toContain(`the school fee for Student s08-fee-${RUN}, EGP ${Number(push.amount).toLocaleString('en-US')}, is due on ${enDay(feeDay)}`);
      // Paid at the desk through the school-fee path, which settles the push: nothing more.
      await apiResponse(officer.api.v1['school-fees']['desk-pay'].$post({ json: { studentId: f.studentId, instrumentUsed: 'cash', academicYear: next } }));
      expect((await one<{ status: string }>(`select status from charge where id = $1`, [push.id])).status).toBe('paid');
      await step(cairoAt(shift(feeDay, -7), 9, 0));
      await step(cairoAt(feeDay, 9, 0));
      expect(await offsetsOf(push.id, 'school_fee_due')).toEqual([-14]);
    } finally {
      // The schedule gates every suite that registers in that year: it never outlives this test (as 08q's).
      if (made) await sql(`delete from school_fee_schedule where id = $1`, [made.id]);
    }
  });
});
