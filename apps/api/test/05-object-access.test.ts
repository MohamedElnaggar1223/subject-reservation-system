import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { apiResponse } from '@repo/validations';
import {
  admin, staff, onboard, subject, session, one, sql, notified, money,
  openWindow, futureWindow, type Client,
} from './helpers';

/**
 * Object-level access (security audit, Phase 1.1).
 *
 * Two families. Family A owns real records of every kind: confirmed and
 * pending registrations, a desk payment and a pending InstaPay payment,
 * receipts, free escrow, a withdrawal, a drop request, remark requests, a
 * preregistration, a link, notifications and a file. Family B's parent and
 * student then try every endpoint that takes one of A's ids or A's student
 * id. Each attempt must be refused (a 4xx) and leave A's records exactly as
 * they were; list endpoints must not return A's rows.
 *
 * Set OBJECT_ACCESS_OUT=/path/file.tsv to write every attempt and its status.
 */

type Res = { status: number; json(): Promise<unknown> };
const attempts: string[] = [];

/** An attempt that must be refused: returns the status, asserts it is a 4xx. */
async function refusedAs(label: string, p: Promise<Res>): Promise<number> {
  const res = await p;
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  attempts.push([label, String(res.status), typeof body.error === 'string' ? body.error : ''].join('\t'));
  expect(res.status, `${label} answered ${res.status}: ${JSON.stringify(body).slice(0, 200)}`).toBeGreaterThanOrEqual(400);
  expect(res.status, `${label} answered ${res.status}`).toBeLessThan(500);
  return res.status;
}

describe('object-level access between families', () => {
  let adm: Client, officer: Client, finadmin: Client;
  let parentA: Client, studentA: Client, studentAId: string;
  let parentB: Client, studentB: Client, studentBId: string;
  let phys: string, chem: string, geo: string, hist: string, bio: string, econ: string, maths: string, lit: string;
  let sessionId: string, draftId: string;
  // Family A's records
  let physA: string, chemA: string, geoA: string, deskPaymentA: string, physReceiptA: string;
  let bioA: string, instaPaymentA: string, econA: string, preregA: string;
  let crA: string, remarkStudentA: string, remarkParentA: string, linkA: string, notificationA: string;
  let withdrawalA: string, fileA: string, fileB: string, avatarB: string;
  // Family B's own records, used to test attaching A's file
  let physB: string, bioB: string, instaPaymentB: string, remarkB: string;

  const escrowOf = async (id: string) =>
    money((await one<{ balance: string }>(`select balance from escrow where student_id = $1`, [id])).balance);
  const statusOf = async (table: string, id: string) =>
    (await one<{ status: string }>(`select status from ${table} where id = $1`, [id])).status;

  afterAll(() => {
    const out = process.env.OBJECT_ACCESS_OUT;
    if (out) writeFileSync(out, ['attempt\tstatus\terror', ...attempts].join('\n') + '\n');
  });

  beforeAll(async () => {
    adm = await admin('oa');
    officer = await staff(adm, 'finance_officer', 'oa');
    finadmin = await staff(adm, 'finance_admin', 'oa');
    const as = { qualificationLevel: 'as_level' as const };
    phys = await subject(adm, 'OA-PHY', 'Physics (AS)', { course: 1200, registration: 300 }, as);
    chem = await subject(adm, 'OA-CHE', 'Chemistry (AS)', { course: 1200, registration: 300 }, as);
    geo = await subject(adm, 'OA-GEO', 'Geography (AS)', { course: 1200, registration: 300 }, as);
    hist = await subject(adm, 'OA-HIS', 'History (AS)', { course: 1200, registration: 300 }, as);
    bio = await subject(adm, 'OA-BIO', 'Biology (AS)', { course: 1200, registration: 300 }, as);
    econ = await subject(adm, 'OA-ECO', 'Economics (AS)', { course: 1200, registration: 300 }, as);
    maths = await subject(adm, 'OA-MAT', 'Mathematics (AS)', { course: 1200, registration: 300 }, as);
    lit = await subject(adm, 'OA-LIT', 'Literature (AS)', { course: 1200, registration: 300 }, as);
    sessionId = await session(adm, 'November (AS, object access)', 'november', 'as_level', { ...openWindow(), activate: true });
    draftId = await session(adm, 'January (AS, object access)', 'january', 'as_level', futureWindow());
    await apiResponse(finadmin.api.v1.remarks.fees.$put({ json: { council: 'cambridge', serviceType: 'review_of_marking', amountPerPaper: 800 } }));

    ({ parent: parentA, student: studentA, studentId: studentAId } = await onboard(officer, 'oa-a', 12));
    ({ parent: parentB, student: studentB, studentId: studentBId } = await onboard(officer, 'oa-b', 12));

    // A: three subjects paid in cash at the desk.
    const desk = await apiResponse(officer.api.v1.registrations.desk.$post({
      json: { studentId: studentAId, sessionId, subjectIds: [phys, chem, geo], collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } },
    }));
    const regOf = (s: string) => desk.registrations.find((r) => r.subjectId === s)!.id;
    physA = regOf(phys); chemA = regOf(chem); geoA = regOf(geo);
    deskPaymentA = desk.payment!.id;
    physReceiptA = (await one<{ id: string }>(`select id from receipt where registration_id = $1`, [physA])).id;

    // A: 1500 of free escrow the real way (desk-paid, receipt out, dropped, receipt back).
    const h = await apiResponse(officer.api.v1.registrations.desk.$post({
      json: { studentId: studentAId, sessionId, subjectIds: [hist], collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } },
    }));
    const hr = await one<{ id: string }>(`select id from receipt where registration_id = $1`, [h.registrations[0]!.id]);
    await apiResponse(officer.api.v1.receipts[':id'].issue.$post({ param: { id: hr.id } }));
    await apiResponse(parentA.api.v1.registrations[':id'].drop.$post({ param: { id: h.registrations[0]!.id }, json: { reason: 'setup for escrow' } }));
    await apiResponse(officer.api.v1.receipts[':id'].return.$post({ param: { id: hr.id }, json: {} }));
    expect(await escrowOf(studentAId)).toBe(1500);

    // A: a withdrawal of 200 waiting for the desk (escrow now 1300).
    withdrawalA = (await apiResponse(parentA.api.v1.escrow.withdraw.$post({ json: { studentId: studentAId, amount: 200 } }))).id;

    // A: a direct registration with a pending InstaPay payment.
    bioA = (await apiResponse(parentA.api.v1.registrations.direct.$post({ json: { sessionId, subjectIds: [bio], studentId: studentAId } })))[0]!.id;
    instaPaymentA = (await apiResponse(parentA.api.v1.payments.initiate.$post({
      json: { registrationIds: [bioA], paymentMethod: 'instapay', escrowAmountToApply: 0 },
    }))).id!;

    // A: a student request waiting for the parent, and a preregistration.
    econA = (await apiResponse(studentA.api.v1.registrations.request.$post({ json: { sessionId, subjectIds: [econ] } })))[0]!.id;
    preregA = (await apiResponse(parentA.api.v1.registrations.preregister.$post({ json: { sessionId: draftId, subjectIds: [lit], studentId: studentAId } })))[0]!.id;

    // A: a drop request from the student on a confirmed subject.
    const cr = await apiResponse(studentA.api.v1.registrations[':id']['request-drop'].$post({ param: { id: chemA }, json: { reason: 'too much work' } }));
    crA = cr.id;

    // A: results, a student-requested remark and a parent-requested remark.
    await apiResponse(officer.api.v1.remarks.results.$post({ json: { results: [{ registrationId: physA, grade: 'C' }, { registrationId: geoA, grade: 'D' }] } }));
    remarkStudentA = (await apiResponse(studentA.api.v1.remarks.$post({
      json: { registrationId: physA, serviceType: 'review_of_marking', papers: [{ paperCode: '9702/22' }] },
    }))).id;
    remarkParentA = (await apiResponse(parentA.api.v1.remarks.$post({
      json: { registrationId: geoA, serviceType: 'review_of_marking', papers: [{ paperCode: '9696/12' }] },
    }))).id;

    linkA = (await one<{ id: string }>(`select id from parent_student_link where student_id = $1`, [studentAId])).id;
    await notified(parentA.email, 'PAYMENT_CONFIRMED', 2);
    notificationA = (await one<{ id: string }>(
      `select n.id from notification n join "user" u on u.id = n.user_id where u.email = $1 and n.type = 'PAYMENT_CONFIRMED' and n.read_at is null limit 1`,
      [parentA.email]
    )).id;

    // Files cannot be uploaded without R2, so the rows are written directly.
    fileA = randomUUID(); fileB = randomUUID(); avatarB = randomUUID();
    await sql(`insert into file (id, name, mime_type, size, storage_key, file_type, user_id) values ($1, 'a.pdf', 'application/pdf', 10, 'test/a.pdf', 'document', $2)`, [fileA, parentA.id]);
    await sql(`insert into file (id, name, mime_type, size, storage_key, file_type, user_id) values ($1, 'b.pdf', 'application/pdf', 10, 'test/b.pdf', 'document', $2)`, [fileB, parentB.id]);
    await sql(`insert into file (id, name, mime_type, size, storage_key, file_type, user_id) values ($1, 'b.webp', 'image/webp', 10, 'test/b.webp', 'avatar', $2)`, [avatarB, parentB.id]);

    // B: a confirmed, resulted subject with a remark awaiting consent, and a pending InstaPay payment.
    const deskB = await apiResponse(officer.api.v1.registrations.desk.$post({
      json: { studentId: studentBId, sessionId, subjectIds: [phys], collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } },
    }));
    physB = deskB.registrations[0]!.id;
    await apiResponse(officer.api.v1.remarks.results.$post({ json: { results: [{ registrationId: physB, grade: 'C' }] } }));
    remarkB = (await apiResponse(parentB.api.v1.remarks.$post({
      json: { registrationId: physB, serviceType: 'review_of_marking', papers: [{ paperCode: '9702/42' }] },
    }))).id;
    bioB = (await apiResponse(parentB.api.v1.registrations.direct.$post({ json: { sessionId, subjectIds: [bio], studentId: studentBId } })))[0]!.id;
    instaPaymentB = (await apiResponse(parentB.api.v1.payments.initiate.$post({
      json: { registrationIds: [bioB], paymentMethod: 'instapay', escrowAmountToApply: 0 },
    }))).id!;
  });

  it('registrations: B cannot read, drop, swap, approve, reject, revert or register for A', async () => {
    await refusedAs('parentB GET registration A', parentB.api.v1.registrations[':id'].$get({ param: { id: physA } }));
    await refusedAs('studentB GET registration A', studentB.api.v1.registrations[':id'].$get({ param: { id: physA } }));
    await refusedAs('parentB GET history A', parentB.api.v1.registrations.history.$get({ query: { studentId: studentAId } } as never));
    await refusedAs('parentB GET available subjects for A', parentB.api.v1.registrations.available.$get({ query: { sessionId, studentId: studentAId } }));
    await refusedAs('parentB drop A', parentB.api.v1.registrations[':id'].drop.$post({ param: { id: physA }, json: { reason: 'not mine' } }));
    await refusedAs('parentB swap A', parentB.api.v1.registrations[':id'].swap.$post({ param: { id: physA }, json: { newSubjectId: maths, reason: 'not mine' } }));
    await refusedAs('studentB request-drop A', studentB.api.v1.registrations[':id']['request-drop'].$post({ param: { id: physA }, json: { reason: 'not mine' } }));
    await refusedAs('studentB request-swap A', studentB.api.v1.registrations[':id']['request-swap'].$post({ param: { id: physA }, json: { newSubjectId: maths, reason: 'not mine' } }));
    await refusedAs('parentB approve A request', parentB.api.v1.registrations.approve.$put({ json: { registrationIds: [econA] } }));
    await refusedAs('parentB reject A request', parentB.api.v1.registrations.reject.$put({ json: { registrationIds: [econA], comments: 'not mine' } }));
    expect(await statusOf('registration', econA)).toBe('pending_approval');
    // Only an approved student request can be reverted: A approves it, then B tries.
    await apiResponse(parentA.api.v1.registrations.approve.$put({ json: { registrationIds: [econA] } }));
    await refusedAs('parentB revert A approval', parentB.api.v1.registrations['revert-approval'].$put({ json: { registrationIds: [econA] } }));
    expect(await statusOf('registration', econA)).toBe('pending_payment');
    await refusedAs('parentB direct-register A', parentB.api.v1.registrations.direct.$post({ json: { sessionId, subjectIds: [maths], studentId: studentAId } }));
    await refusedAs('parentB preregister A', parentB.api.v1.registrations.preregister.$post({ json: { sessionId: draftId, subjectIds: [maths], studentId: studentAId } }));
    await refusedAs('parentB cancel A prereg', parentB.api.v1.registrations[':id']['cancel-prereg'].$post({ param: { id: preregA } }));

    expect(await statusOf('registration', physA)).toBe('confirmed');
    expect(await statusOf('registration', bioA)).toBe('pending_payment');
    expect(await statusOf('registration', preregA)).toBe('preregistered');
    expect(await sql(`select 1 from registration where student_id = $1 and subject_id = $2`, [studentAId, maths])).toEqual([]);
    expect(await sql(`select 1 from change_request where registration_id = $1 and id <> $2`, [physA, crA])).toEqual([]);

    const pending = await apiResponse(parentB.api.v1.registrations.pending.$get());
    expect(pending.map((r) => r.id)).not.toContain(econA);
  });

  it('payments and receipts: B cannot read, pay, reference or preview A', async () => {
    await refusedAs('parentB GET payment A', parentB.api.v1.payments[':id'].$get({ param: { id: deskPaymentA } }));
    await refusedAs('parentB GET payment receipt PDF A', parentB.api.v1.payments[':id'].receipt.$get({ param: { id: deskPaymentA } }));
    // Payments are the parent's: even A's own student is refused, a check the
    // role matrix cannot see because it runs after the record is looked up.
    await refusedAs('studentA GET own family payment', studentA.api.v1.payments[':id'].$get({ param: { id: deskPaymentA } }));
    await refusedAs('studentA GET own family payment receipt PDF', studentA.api.v1.payments[':id'].receipt.$get({ param: { id: deskPaymentA } }));
    await refusedAs('parentB instapay-reference A', parentB.api.v1.payments[':id']['instapay-reference'].$post({ param: { id: instaPaymentA }, json: { reference: 'FT-NOT-MINE-1' } }));
    await refusedAs('parentB initiate for A', parentB.api.v1.payments.initiate.$post({ json: { registrationIds: [bioA], paymentMethod: 'in_school', escrowAmountToApply: 0 } }));
    await refusedAs('parentB checkout-summary A', parentB.api.v1.payments['checkout-summary'].$get({ query: { registrationIds: bioA } }));
    await refusedAs('parentB GET receipt A', parentB.api.v1.receipts[':id'].$get({ param: { id: physReceiptA } }));
    await refusedAs('studentB GET receipt A', studentB.api.v1.receipts[':id'].$get({ param: { id: physReceiptA } }));
    await refusedAs('parentB refund-preview A', parentB.api.v1.receipts['refund-preview'].$get({ query: { registrationId: physA } }));
    await refusedAs('parentB school-fee status A', parentB.api.v1['school-fees'].status.$get({ query: { studentId: studentAId } }));
    await refusedAs('parentB school-fee pay A', parentB.api.v1['school-fees'].pay.$post({ json: { studentId: studentAId, paymentMethod: 'in_school' } }));

    expect(await one(`select status, verification_reference from payment where id = $1`, [instaPaymentA])).toEqual({ status: 'pending', verification_reference: null });
    expect(await sql(`select 1 from payment_registration pr join payment p on p.id = pr.payment_id where pr.registration_id = $1 and p.parent_id = $2`, [bioA, parentB.id])).toEqual([]);

    const mine = await apiResponse(parentB.api.v1.payments.$get({ query: {} }));
    expect(mine.map((p) => p.studentId)).not.toContain(studentAId);
    const filtered = await parentB.api.v1.payments.$get({ query: { studentId: studentAId } });
    if (filtered.status === 200) {
      const rows = (await filtered.json() as { data: { studentId: string }[] }).data;
      expect(rows.map((p) => p.studentId)).not.toContain(studentAId);
    }
  });

  it('escrow: B cannot read, move or withdraw A money', async () => {
    const before = await escrowOf(studentAId);
    await refusedAs('parentB GET escrow A', parentB.api.v1.escrow.$get({ query: { studentId: studentAId } }));
    await refusedAs('parentB GET escrow transactions A', parentB.api.v1.escrow.transactions.$get({ query: { studentId: studentAId } }));
    await refusedAs('parentB transfer A to B', parentB.api.v1.escrow.transfer.$post({ json: { fromStudentId: studentAId, toStudentId: studentBId, amount: 100 } }));
    await refusedAs('parentB withdraw A', parentB.api.v1.escrow.withdraw.$post({ json: { studentId: studentAId, amount: 100 } }));
    expect(await escrowOf(studentAId)).toBe(before);

    const withdrawals = await parentB.api.v1.escrow.withdrawals.$get({ query: { studentId: studentAId } });
    if (withdrawals.status === 200) {
      const rows = (await withdrawals.json() as { data: { id: string }[] }).data;
      expect(rows.map((w) => w.id)).not.toContain(withdrawalA);
    }

    // A student's escrow view is their own whatever id they pass.
    const own = await apiResponse(studentB.api.v1.escrow.$get({ query: { studentId: studentAId } }));
    expect(JSON.stringify(own)).not.toContain(studentAId);
  });

  it('change requests: B cannot read, approve, reject or cancel A', async () => {
    await refusedAs('parentB GET change request A', parentB.api.v1['change-requests'][':id'].$get({ param: { id: crA } }));
    await refusedAs('studentB GET change request A', studentB.api.v1['change-requests'][':id'].$get({ param: { id: crA } }));
    await refusedAs('parentB approve change request A', parentB.api.v1['change-requests'][':id'].approve.$put({ param: { id: crA }, json: {} }));
    await refusedAs('parentB reject change request A', parentB.api.v1['change-requests'][':id'].reject.$put({ param: { id: crA }, json: { comments: 'not mine' } }));
    await refusedAs('studentB cancel change request A', studentB.api.v1['change-requests'][':id'].cancel.$put({ param: { id: crA } }));
    expect(await statusOf('change_request', crA)).toBe('pending_approval');

    const listed = await apiResponse(parentB.api.v1['change-requests'].$get({ query: { studentId: studentAId } }));
    expect(listed.map((c) => c.id)).not.toContain(crA);
  });

  it('remarks: B cannot request, decide, consent, pay or cancel for A', async () => {
    // chemA is confirmed; give it a result so the only thing standing in B's way is ownership.
    await apiResponse(officer.api.v1.remarks.results.$post({ json: { results: [{ registrationId: chemA, grade: 'B' }] } }));
    await refusedAs('parentB create remark on A', parentB.api.v1.remarks.$post({ json: { registrationId: chemA, serviceType: 'review_of_marking', papers: [{ paperCode: 'X/1' }] } }));
    await refusedAs('studentB create remark on A', studentB.api.v1.remarks.$post({ json: { registrationId: chemA, serviceType: 'review_of_marking', papers: [{ paperCode: 'X/1' }] } }));
    // Staff pass the role gate but only families may ask for a remark.
    await refusedAs('officer create remark on A', officer.api.v1.remarks.$post({ json: { registrationId: chemA, serviceType: 'review_of_marking', papers: [{ paperCode: 'X/1' }] } }));
    await refusedAs('admin create remark on A', adm.api.v1.remarks.$post({ json: { registrationId: chemA, serviceType: 'review_of_marking', papers: [{ paperCode: 'X/1' }] } }));
    await refusedAs('parentB approve remark A', parentB.api.v1.remarks[':id'].approve.$put({ param: { id: remarkStudentA }, json: {} }));
    await refusedAs('parentB reject remark A', parentB.api.v1.remarks[':id'].reject.$put({ param: { id: remarkStudentA }, json: {} }));
    await refusedAs('parentB cancel remark A', parentB.api.v1.remarks[':id'].cancel.$post({ param: { id: remarkStudentA } }));
    await refusedAs('studentB cancel remark A', studentB.api.v1.remarks[':id'].cancel.$post({ param: { id: remarkStudentA } }));
    await refusedAs('parentB consent remark A', parentB.api.v1.remarks[':id'].consent.$post({ param: { id: remarkParentA }, json: { attest: true } }));
    expect(await statusOf('remark_request', remarkStudentA)).toBe('pending_approval');
    expect(await statusOf('remark_request', remarkParentA)).toBe('pending_consent');
    expect(await sql(`select 1 from remark_request where registration_id = $1`, [chemA])).toEqual([]);

    // Once A has consented, B still cannot pay A's remark.
    await apiResponse(parentA.api.v1.remarks[':id'].consent.$post({ param: { id: remarkParentA }, json: { attest: true } }));
    await refusedAs('parentB pay remark A', parentB.api.v1.remarks[':id'].pay.$post({ param: { id: remarkParentA }, json: { paymentMethod: 'in_school' } }));
    expect(await statusOf('remark_request', remarkParentA)).toBe('pending_payment');

    const listed = await apiResponse(parentB.api.v1.remarks.$get());
    expect(listed.map((r) => r.id)).not.toContain(remarkStudentA);
    expect(listed.map((r) => r.id)).not.toContain(remarkParentA);
  });

  it('links and notifications: B cannot read or answer A link, a pending link grants nothing, B cannot mark A notification', async () => {
    await refusedAs('parentB GET link A', parentB.api.v1.links[':id'].$get({ param: { id: linkA } }));
    await refusedAs('studentB GET link A', studentB.api.v1.links[':id'].$get({ param: { id: linkA } }));
    await refusedAs('studentB answer link A', studentB.api.v1.links[':id'].$put({ param: { id: linkA }, json: { status: 'rejected' } }));
    expect(await statusOf('parent_student_link', linkA)).toBe('approved');

    // B's parent asks to link to A's student: the request exists, but grants nothing until A's student approves.
    const ask = await parentB.api.v1.links.$post({ json: { studentEmail: studentA.email } });
    expect(ask.status).toBeLessThan(300);
    const pendingLink = (await one<{ id: string }>(
      `select id from parent_student_link where parent_id = $1 and student_id = $2`, [parentB.id, studentAId]
    )).id;
    // Only A's student may answer it; B's student approving it would hand A's records to B's parent.
    await refusedAs('studentB approve link addressed to A', studentB.api.v1.links[':id'].$put({ param: { id: pendingLink }, json: { status: 'approved' } }));
    expect(await statusOf('parent_student_link', pendingLink)).toBe('pending');
    await refusedAs('parentB with pending link GET escrow A', parentB.api.v1.escrow.$get({ query: { studentId: studentAId } }));
    await refusedAs('parentB with pending link GET history A', parentB.api.v1.registrations.history.$get({ query: { studentId: studentAId } } as never));

    await refusedAs('parentB mark notification A read', parentB.api.v1.notifications[':id'].read.$put({ param: { id: notificationA } }));
    expect((await one<{ read_at: string | null }>(`select read_at from notification where id = $1`, [notificationA])).read_at).toBeNull();
  });

  it('files: B cannot read, download or delete A file', async () => {
    await refusedAs('parentB GET file A', parentB.api.v1.files[':id'].$get({ param: { id: fileA } }));
    await refusedAs('parentB download file A', parentB.api.v1.files[':id'].download.$get({ param: { id: fileA } }));
    await refusedAs('parentB delete file A', parentB.api.v1.files[':id'].$delete({ param: { id: fileA } }));
    expect(await sql(`select 1 from file where id = $1`, [fileA])).toHaveLength(1);
  });

  it('files: B cannot attach A file to B own InstaPay payment or remark consent', async () => {
    await refusedAs('parentB attach file A as InstaPay screenshot', parentB.api.v1.payments[':id']['instapay-reference'].$post({
      param: { id: instaPaymentB }, json: { reference: 'FT-B-0001', screenshotFileId: fileA },
    }));
    expect(await one(`select verification_file_id from payment where id = $1`, [instaPaymentB])).toEqual({ verification_file_id: null });

    await refusedAs('parentB attach file A as remark consent', parentB.api.v1.remarks[':id'].consent.$post({
      param: { id: remarkB }, json: { attest: true, consentFileId: fileA },
    }));
    expect(await statusOf('remark_request', remarkB)).toBe('pending_consent');

    // Evidence must be a document: B's own avatar is refused, because
    // replacing an avatar deletes the old one.
    await refusedAs('parentB attach own avatar as InstaPay screenshot', parentB.api.v1.payments[':id']['instapay-reference'].$post({
      param: { id: instaPaymentB }, json: { reference: 'FT-B-0003', screenshotFileId: avatarB },
    }));
    expect(await one(`select verification_file_id from payment where id = $1`, [instaPaymentB])).toEqual({ verification_file_id: null });

    // B's own document is accepted in both places.
    await apiResponse(parentB.api.v1.payments[':id']['instapay-reference'].$post({ param: { id: instaPaymentB }, json: { reference: 'FT-B-0002', screenshotFileId: fileB } }));
    expect(await one(`select verification_file_id from payment where id = $1`, [instaPaymentB])).toEqual({ verification_file_id: fileB });
    await apiResponse(parentB.api.v1.remarks[':id'].consent.$post({ param: { id: remarkB }, json: { attest: true, consentFileId: fileB } }));
    expect(await statusOf('remark_request', remarkB)).toBe('pending_payment');

    // Once attached, the file is evidence: its owner cannot delete it (the
    // foreign keys are ON DELETE SET NULL, so deleting would erase the link).
    const del = await parentB.api.v1.files[':id'].$delete({ param: { id: fileB } });
    const delBody = (await del.json()) as { error?: string };
    attempts.push(['parentB delete own file attached as evidence', String(del.status), delBody.error ?? ''].join('\t'));
    expect(del.status).toBe(400);
    expect(delBody.error).toBe('This file is attached to a payment or a remark request and cannot be deleted');
    expect(await sql(`select 1 from file where id = $1`, [fileB])).toHaveLength(1);
    // The database refuses it too, so no race between attach and delete can
    // erase the evidence (foreign keys are ON DELETE RESTRICT since 0027).
    await expect(sql(`delete from file where id = $1`, [fileB])).rejects.toThrow();
    expect(await sql(`select 1 from file where id = $1`, [fileB])).toHaveLength(1);
  });
});
