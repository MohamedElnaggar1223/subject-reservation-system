import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { apiResponse, academicYearStartOf } from '@repo/validations';
import { admin, staff, onboard, subject, session, one, sql, notified, money, openWindow, futureWindow, type Client, reservationOf, swapTo } from './helpers';

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
      json: { studentId: studentAId, sessionId, ...(await reservationOf(sessionId, [phys, chem, geo])), collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } },
    }));
    const regOf = (s: string) => desk.registrations.find((r) => r.subjectId === s)!.id;
    physA = regOf(phys); chemA = regOf(chem); geoA = regOf(geo);
    deskPaymentA = desk.payment!.id;
    physReceiptA = (await one<{ id: string }>(`select id from receipt where registration_id = $1`, [physA])).id;

    // A: 1500 of free escrow the real way (desk-paid, receipt out, dropped, receipt back).
    const h = await apiResponse(officer.api.v1.registrations.desk.$post({
      json: { studentId: studentAId, sessionId, ...(await reservationOf(sessionId, [hist])), collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } },
    }));
    const hr = await one<{ id: string }>(`select id from receipt where registration_id = $1`, [h.registrations[0]!.id]);
    await apiResponse(officer.api.v1.receipts[':id'].issue.$post({ param: { id: hr.id } }));
    await apiResponse(parentA.api.v1.registrations[':id'].drop.$post({ param: { id: h.registrations[0]!.id }, json: { reason: 'setup for escrow' } }));
    await apiResponse(officer.api.v1.receipts[':id'].return.$post({ param: { id: hr.id }, json: {} }));
    expect(await escrowOf(studentAId)).toBe(1500);

    // A: a withdrawal of 200 waiting for the desk (escrow now 1300).
    withdrawalA = (await apiResponse(parentA.api.v1.escrow.withdraw.$post({ json: { studentId: studentAId, amount: 200 } }))).id;

    // A: a direct registration with a pending InstaPay payment.
    bioA = (await apiResponse(parentA.api.v1.registrations.direct.$post({ json: { sessionId, ...(await reservationOf(sessionId, [bio])), studentId: studentAId } })))[0]!.id;
    instaPaymentA = (await apiResponse(parentA.api.v1.payments.initiate.$post({
      json: { registrationIds: [bioA], paymentMethod: 'instapay', escrowAmountToApply: 0 },
    }))).id!;

    // A: a student request waiting for the parent, and a preregistration.
    econA = (await apiResponse(studentA.api.v1.registrations.request.$post({ json: { sessionId, ...(await reservationOf(sessionId, [econ])) } })))[0]!.id;
    preregA = (await apiResponse(parentA.api.v1.registrations.preregister.$post({ json: { sessionId: draftId, ...(await reservationOf(draftId, [lit])), studentId: studentAId } })))[0]!.id;

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
      json: { studentId: studentBId, sessionId, ...(await reservationOf(sessionId, [phys])), collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } },
    }));
    physB = deskB.registrations[0]!.id;
    await apiResponse(officer.api.v1.remarks.results.$post({ json: { results: [{ registrationId: physB, grade: 'C' }] } }));
    remarkB = (await apiResponse(parentB.api.v1.remarks.$post({
      json: { registrationId: physB, serviceType: 'review_of_marking', papers: [{ paperCode: '9702/42' }] },
    }))).id;
    bioB = (await apiResponse(parentB.api.v1.registrations.direct.$post({ json: { sessionId, ...(await reservationOf(sessionId, [bio])), studentId: studentBId } })))[0]!.id;
    instaPaymentB = (await apiResponse(parentB.api.v1.payments.initiate.$post({
      json: { registrationIds: [bioB], paymentMethod: 'instapay', escrowAmountToApply: 0 },
    }))).id!;
  });

  it('registrations: B cannot read, drop, swap, approve, reject, revert or register for A', async () => {
    await refusedAs('parentB GET registration A', parentB.api.v1.registrations[':id'].$get({ param: { id: physA } }));
    await refusedAs('studentB GET registration A', studentB.api.v1.registrations[':id'].$get({ param: { id: physA } }));
    await refusedAs('parentB GET history A', parentB.api.v1.registrations.history.$get({ query: { studentId: studentAId } } as never));
    // The reservations rework: the offers a student may reserve, with their prices (§5); they
    // replaced the old list of available subjects (step B removed GET /registrations/available).
    await refusedAs('parentB GET offers for A', parentB.api.v1.registrations.offers.$get({ query: { sessionId, studentId: studentAId } }));
    await refusedAs('studentB GET offers for A', studentB.api.v1.registrations.offers.$get({ query: { sessionId, studentId: studentAId } }));
    await refusedAs('parentB drop A', parentB.api.v1.registrations[':id'].drop.$post({ param: { id: physA }, json: { reason: 'not mine' } }));
    await refusedAs('parentB swap A', parentB.api.v1.registrations[':id'].swap.$post({ param: { id: physA }, json: { line: await swapTo(physA, maths), reason: 'not mine' } }));
    await refusedAs('studentB request-drop A', studentB.api.v1.registrations[':id']['request-drop'].$post({ param: { id: physA }, json: { reason: 'not mine' } }));
    await refusedAs('studentB request-swap A', studentB.api.v1.registrations[':id']['request-swap'].$post({ param: { id: physA }, json: { line: await swapTo(physA, maths), reason: 'not mine' } }));
    await refusedAs('parentB approve A request', parentB.api.v1.registrations.approve.$put({ json: { registrationIds: [econA] } }));
    await refusedAs('parentB reject A request', parentB.api.v1.registrations.reject.$put({ json: { registrationIds: [econA], comments: 'not mine' } }));
    expect(await statusOf('registration', econA)).toBe('pending_approval');
    // Only an approved student request can be reverted: A approves it, then B tries.
    await apiResponse(parentA.api.v1.registrations.approve.$put({ json: { registrationIds: [econA] } }));
    await refusedAs('parentB revert A approval', parentB.api.v1.registrations['revert-approval'].$put({ json: { registrationIds: [econA] } }));
    expect(await statusOf('registration', econA)).toBe('pending_payment');
    await refusedAs('parentB direct-register A', parentB.api.v1.registrations.direct.$post({ json: { sessionId, ...(await reservationOf(sessionId, [maths])), studentId: studentAId } }));
    await refusedAs('parentB preregister A', parentB.api.v1.registrations.preregister.$post({ json: { sessionId: draftId, ...(await reservationOf(draftId, [maths])), studentId: studentAId } }));
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
    await refusedAs('parentB cancel payment A', parentB.api.v1.payments[':id'].cancel.$post({ param: { id: instaPaymentA } }));
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

  // ─── F0a ─────────────────────────────────────────────────────────────────

  it("F0a uploads: B cannot read A's family files nor upload for A's student", async () => {
    const pdf = new File([new TextEncoder().encode('%PDF-1.4\n%%EOF\n')], 'note.pdf', { type: 'application/pdf' });
    const note = (await apiResponse(parentA.api.v1.files.upload.$post({ form: { file: pdf, purpose: 'supporting_document', studentId: studentAId } }))).id;
    const shot = (await apiResponse(parentA.api.v1.files.upload.$post({ form: { file: pdf, purpose: 'payment_evidence', studentId: studentAId } }))).id;
    for (const id of [note, shot]) {
      await refusedAs('parentB read A family file', parentB.api.v1.files[':id'].content.$get({ param: { id }, query: {} }));
      await refusedAs('studentB read A family file', studentB.api.v1.files[':id'].content.$get({ param: { id }, query: {} }));
      await refusedAs('parentB file A metadata', parentB.api.v1.files[':id'].$get({ param: { id } }));
      await refusedAs('parentB file A download', parentB.api.v1.files[':id'].download.$get({ param: { id } }));
    }
    // A's own student reads the family's supporting document.
    expect((await studentA.api.v1.files[':id'].content.$get({ param: { id: note }, query: {} })).status).toBe(200);
    const before = Number((await one<{ n: string }>(`select count(*) as n from file where student_id = $1`, [studentAId])).n);
    await refusedAs('parentB upload for student A', parentB.api.v1.files.upload.$post({ form: { file: pdf, purpose: 'supporting_document', studentId: studentAId } }));
    await refusedAs('studentB upload excuse for student A', studentB.api.v1.files.upload.$post({ form: { file: pdf, purpose: 'excuse_note', studentId: studentAId } }));
    expect(Number((await one<{ n: string }>(`select count(*) as n from file where student_id = $1`, [studentAId])).n)).toBe(before);
  });

  it("F0a eligibility: B cannot ask whether A's student may register", async () => {
    await refusedAs('parentB eligibility of student A', parentB.api.v1.registrations.eligibility.$get({ query: { studentId: studentAId, sessionId } }));
    await refusedAs('studentB eligibility of student A', studentB.api.v1.registrations.eligibility.$get({ query: { studentId: studentAId, sessionId } }));
    // A's own family may.
    expect((await apiResponse(parentA.api.v1.registrations.eligibility.$get({ query: { studentId: studentAId, sessionId } }))).allowed).toBe(true);
    expect((await apiResponse(studentA.api.v1.registrations.eligibility.$get({ query: { studentId: studentAId, sessionId } }))).allowed).toBe(true);
  });

  it("F0a another class and the gate: a teacher reaches only their own teaching; the gate only the school day", async () => {
    const coordinator = await staff(adm, 'coordinator', 'oa-class');
    const [teacherA, teacherB, gate] = await Promise.all([staff(adm, 'teacher', 'oa-a'), staff(adm, 'teacher', 'oa-b'), staff(adm, 'gate', 'oa')]);
    // A year of its own, far ahead, so no later suite's academic year is taken.
    const far = new Date().getFullYear() + 8;
    const year = await apiResponse(coordinator.api.v1.academic.years.$post({ json: { startYear: far, startsOn: `${far}-09-06`, endsOn: `${far + 1}-06-25` } }));
    const teacherAId = (await one<{ id: string }>(`select id from teacher where user_id = $1`, [teacherA.id])).id;
    const sectionA = (await apiResponse(coordinator.api.v1.academic.sections.$post({ json: { academicYearId: year.id, grade: 11, name: 'OA-11A', homeroomTeacherId: teacherAId } }))).id;

    // Another class: teacher B reads neither teacher A's section nor any student's record.
    await refusedAs('teacherB reads teacher A section', teacherB.api.v1.academic.sections[':id'].$get({ param: { id: sectionA } }));
    await refusedAs('teacherB lists sections', teacherB.api.v1.academic.sections.$get({ query: {} }));
    await refusedAs('teacherB adds to teacher A section', teacherB.api.v1.academic.sections[':id'].members.$post({ param: { id: sectionA }, json: { studentIds: [studentAId] } }));
    await refusedAs('teacherB reads student A record', teacherB.api.v1.students[':id'].$get({ param: { id: studentAId } }));
    await refusedAs('teacherB lists students', teacherB.api.v1.students.$get({ query: {} }));
    await refusedAs('teacherB reads student A at the desk', teacherB.api.v1.users[':id'].summary.$get({ param: { id: studentAId } }));
    await refusedAs('teacherB reads A family file', teacherB.api.v1.files[':id'].content.$get({ param: { id: fileA }, query: {} }));
    const mine = await apiResponse(teacherB.api.v1.teaching.me.$get());
    expect(mine?.teacher.id).not.toBe(teacherAId);
    expect(mine?.homeroomSections.some((s) => s.id === sectionA)).toBe(false);

    // The gate: the school day, and nothing about a family.
    expect((await gate.api.v1.academic.calendar.day.$get({ query: {} })).status).toBe(200);
    await refusedAs('gate reads student A record', gate.api.v1.students[':id'].$get({ param: { id: studentAId } }));
    await refusedAs('gate lists students', gate.api.v1.students.$get({ query: {} }));
    await refusedAs('gate reads student A at the desk', gate.api.v1.users[':id'].summary.$get({ param: { id: studentAId } }));
    await refusedAs('gate searches people', gate.api.v1.users.search.$get({ query: { search: 'oa-a' } }));
    await refusedAs('gate reads registrations', gate.api.v1.registrations.$get({ query: { studentId: studentAId } }));
    await refusedAs('gate reads payments', gate.api.v1.payments.$get({ query: {} }));
    await refusedAs('gate reads section A', gate.api.v1.academic.sections[':id'].$get({ param: { id: sectionA } }));
    await refusedAs('gate asks student A eligibility', gate.api.v1.registrations.eligibility.$get({ query: { studentId: studentAId, sessionId } }));
    await refusedAs('gate reads A family file', gate.api.v1.files[':id'].content.$get({ param: { id: fileA }, query: {} }));
  });

  // ─── F0b ─────────────────────────────────────────────────────────────────

  it("F0b course enrolment: B cannot read or change A's student's enrolment; a teacher reads only their own class", async () => {
    const coordinator = await staff(adm, 'coordinator', 'oa-enr');
    const [teacherA, teacherB] = [await staff(adm, 'teacher', 'oa-enr-a'), await staff(adm, 'teacher', 'oa-enr-b')];
    const teacherAId = (await one<{ id: string }>(`select id from teacher where user_id = $1`, [teacherA.id])).id;
    // Last academic year (A's student was in grade 11): later suites create this year's.
    const Y = academicYearStartOf() - 1;
    const years = await apiResponse(coordinator.api.v1.academic.years.$get());
    const yearId = years.find((y) => y.startYear === Y)?.id
      ?? (await apiResponse(coordinator.api.v1.academic.years.$post({ json: { startYear: Y, startsOn: `${Y}-09-06`, endsOn: `${Y + 1}-06-25` } }))).id;
    const e = await apiResponse(coordinator.api.v1.enrolments.$post({
      json: { academicYearId: yearId, studentId: studentAId, subjectId: phys, teacherId: teacherAId, mode: 'in_school' },
    }));
    const snapshot = () => sql(`select * from course_enrolment where student_id = $1`, [studentAId]);
    const before = await snapshot();

    // Another family: answered as not found, nothing learned, nothing changed.
    expect(await refusedAs('parentB reads A enrolment', parentB.api.v1.enrolments.student[':studentId'].$get({ param: { studentId: studentAId }, query: { academicYearId: yearId } }))).toBe(404);
    expect(await refusedAs('studentB reads A enrolment', studentB.api.v1.enrolments.student[':studentId'].$get({ param: { studentId: studentAId }, query: { academicYearId: yearId } }))).toBe(404);
    await refusedAs('parentB lists enrolments', parentB.api.v1.enrolments.$get({ query: { academicYearId: yearId, studentId: studentAId } }));
    await refusedAs('parentB checks A enrolment', parentB.api.v1.enrolments.check.$get({ query: { academicYearId: yearId, studentId: studentAId } }));
    await refusedAs('parentB ends A enrolment', parentB.api.v1.enrolments[':id'].end.$post({ param: { id: e.id }, json: { reason: 'not theirs to end' } }));
    await refusedAs('studentB changes A enrolment', studentB.api.v1.enrolments[':id'].$put({ param: { id: e.id }, json: { mode: 'self_study' } }));
    // A's own family reads it.
    expect((await apiResponse(parentA.api.v1.enrolments.student[':studentId'].$get({ param: { studentId: studentAId }, query: { academicYearId: yearId } }))).enrolments.map((x) => x.subjectId)).toEqual([phys]);
    expect((await apiResponse(studentA.api.v1.enrolments.student[':studentId'].$get({ param: { studentId: studentAId }, query: { academicYearId: yearId } }))).enrolments.map((x) => x.subjectId)).toEqual([phys]);

    // Another class: teacher B does not read teacher A's Physics class, nor enrol anyone.
    await refusedAs('teacherB reads teacher A class', teacherB.api.v1.enrolments.class.$get({ query: { subjectId: phys, academicYearId: yearId } }));
    await refusedAs('teacherB reads A enrolment', teacherB.api.v1.enrolments.student[':studentId'].$get({ param: { studentId: studentAId }, query: {} }));
    await refusedAs('teacherB enrols student A', teacherB.api.v1.enrolments.$post({ json: { academicYearId: yearId, studentId: studentAId, subjectId: chem, mode: 'in_school' } }));
    expect((await apiResponse(teacherA.api.v1.enrolments.class.$get({ query: { subjectId: phys, academicYearId: yearId } }))).students.map((x) => x.studentId)).toEqual([studentAId]);
    expect(await snapshot()).toEqual(before);
  });

  it("the reservations rework, step C: B cannot read, ask for, pay or refund A's charges; an exception for B cannot reach A's line", async () => {
    // A's charge (finance adds it).
    const charge = await apiResponse(finadmin.api.v1.charges.$post({ json: { studentId: studentAId, kind: 'custom', amount: 250, reason: 'a lost library book' } }));
    const before = await statusOf('charge', charge.id);
    await refusedAs('parentB lists A charges', parentB.api.v1.charges.$get({ query: { studentId: studentAId } }));
    await refusedAs('studentB lists A charges', studentB.api.v1.charges.$get({ query: { studentId: studentAId } }));
    expect((await apiResponse(parentB.api.v1.charges.$get({ query: {} }))).some((c) => c.studentId === studentAId)).toBe(false);
    await refusedAs('parentB asks a service for A', parentB.api.v1.charges.$post({ json: { studentId: studentAId, kind: 'cash_in', boardServiceId: 'svc-pearson-ci', registrationId: physA } }));
    await refusedAs('studentB asks a service for A', studentB.api.v1.charges.$post({ json: { studentId: studentAId, kind: 'cash_in', boardServiceId: 'svc-pearson-ci', registrationId: physA } }));
    await refusedAs('parentB pays A charge', parentB.api.v1.payments.initiate.$post({ json: { chargeIds: [charge.id], paymentMethod: 'in_school' } }));
    await refusedAs('parentB accepts A charge', parentB.api.v1.charges[':id'].accept.$post({ param: { id: charge.id }, json: { reason: 'B acting on A' } }));
    await refusedAs('parentB cancels A charge', parentB.api.v1.charges[':id'].cancel.$post({ param: { id: charge.id }, json: { reason: 'B acting on A' } }));
    await refusedAs('parentB refunds A charge', parentB.api.v1.charges[':id'].refund.$post({ param: { id: charge.id }, json: { amount: 1, reason: 'B acting on A' } }));
    expect(await statusOf('charge', charge.id)).toBe(before);
    expect((await sql(`select id from payment_charge where charge_id = $1`, [charge.id]))).toEqual([]);
    // An exception granted to family B (its parent) cannot be scoped to A's line or A's charge.
    await refusedAs('exception for B on A line', finadmin.api.v1.exceptions.$post({
      json: { policyKey: 'price.discountPercent', familyId: parentB.id, scope: { registrationId: physA }, value: 50, reason: 'B on A line' },
    }));
    await refusedAs('exception for B on A charge', finadmin.api.v1.exceptions.$post({
      json: { policyKey: 'price.discountPercent', studentId: studentBId, scope: { chargeId: charge.id }, value: 50, reason: 'B on A charge' },
    }));
    expect((await sql(`select id from exception where registration_id = $1 or charge_id = $2`, [physA, charge.id]))).toEqual([]);
    // The desk-drop is staff's: a family is refused.
    await refusedAs('parentB desk-drops A line', parentB.api.v1.registrations[':id']['desk-drop'].$post({ param: { id: physA }, json: { reason: 'B acting on A' } }));
    await apiResponse(finadmin.api.v1.charges[':id'].cancel.$post({ param: { id: charge.id }, json: { reason: 'test charge' } }));
  });

  it('F0a exceptions: each type names who may grant it — a coordinator is refused a fee waiver, a finance admin the grade-10 exception', async () => {
    const coordinator = await staff(adm, 'coordinator', 'oa');
    const exceptionsOf = async () => Number((await one<{ n: string }>(`select count(*) as n from exception where student_id = $1`, [studentBId])).n);
    const before = await exceptionsOf();
    const waiver = coordinator.api.v1.exceptions.$post({ json: { type: 'fee_waiver', studentId: studentBId, reason: 'not the coordinator\'s to grant' } });
    expect(await refusedAs('coordinator grants a fee waiver', waiver)).toBe(403);
    const g10 = finadmin.api.v1.exceptions.$post({ json: { type: 'grade10_other_series', studentId: studentBId, sessionId, reason: 'not the finance admin\'s to grant' } });
    expect(await refusedAs('finance admin grants the grade-10 exception', g10)).toBe(403);
    expect(await exceptionsOf()).toBe(before);
    // Nor may either revoke the other's type; each sees only its own types.
    const w = await apiResponse(finadmin.api.v1.exceptions.$post({ json: { type: 'fee_waiver', studentId: studentBId, reason: 'hardship case' } }));
    expect(await refusedAs('coordinator revokes a fee waiver', coordinator.api.v1.exceptions[':id'].revoke.$post({ param: { id: w.id } }))).toBe(403);
    expect(await statusOf('exception', w.id)).toBe('active');
    expect((await apiResponse(coordinator.api.v1.exceptions.$get({ query: {} }))).some((e) => e.id === w.id)).toBe(false);
    await apiResponse(finadmin.api.v1.exceptions[':id'].revoke.$post({ param: { id: w.id } }));
  });

  it("step B: B cannot read A's statement, answer a declared sitting or change a teacher on A's line; the To verify list is the school's", async () => {
    // The statement: A's child, by id or by A's family, refused to B's parent and student.
    await refusedAs('parentB statement of A', parentB.api.v1.statement.$get({ query: { studentId: studentAId } }));
    await refusedAs('studentB statement of A', studentB.api.v1.statement.$get({ query: { studentId: studentAId } }));
    await refusedAs('parentB family statement of A', parentB.api.v1.statement.$get({ query: { familyId: parentA.id } }));
    await refusedAs('studentB family statement of A', studentB.api.v1.statement.$get({ query: { familyId: parentA.id } }));
    // B's own family statement lists B's child only.
    const own = await apiResponse(parentB.api.v1.statement.$get({ query: {} }));
    expect(own.students.map((s) => s.student.id)).toEqual([studentBId]);
    expect((await apiResponse(studentB.api.v1.statement.$get({ query: {} }))).students.map((s) => s.student.id)).toEqual([studentBId]);
    // The To verify list, a declared sitting's answer and a line's teacher are staff's.
    await refusedAs('parentB to-verify', parentB.api.v1.sessions[':id']['to-verify'].$get({ param: { id: sessionId }, query: {} }));
    await refusedAs('studentB to-verify', studentB.api.v1.sessions[':id']['to-verify'].$get({ param: { id: sessionId }, query: {} }));
    const before = await one(`select status, teacher_id, prior_sitting_verified_outcome, updated_at from registration where id = $1`, [bioA]);
    await refusedAs('parentB verify-prior A', parentB.api.v1.registrations[':id']['verify-prior'].$post({ param: { id: bioA }, json: { outcome: 'rejected', reason: 'not my child at all' } }));
    await refusedAs('studentB verify-prior A', studentB.api.v1.registrations[':id']['verify-prior'].$post({ param: { id: bioA }, json: { outcome: 'verified', reason: 'not my child at all' } }));
    await refusedAs('parentB teacher of A', parentB.api.v1.registrations[':id'].teacher.$put({ param: { id: bioA }, json: { teacherId: null, reason: 'not my child at all' } }));
    await refusedAs('studentB teacher of A', studentB.api.v1.registrations[':id'].teacher.$put({ param: { id: bioA }, json: { teacherId: null, reason: 'not my child at all' } }));
    expect(await one(`select status, teacher_id, prior_sitting_verified_outcome, updated_at from registration where id = $1`, [bioA])).toEqual(before);
  });
  it("step D: B cannot read or mark A's copy of a message, reach a message's deliveries or send one; finance reads only the money lists' messages", async () => {
    // The school writes to A's family (the parent and the student), as the Messages screen does.
    const sent = await apiResponse(adm.api.v1.messages.$post({ json: {
      audience: { definition: { kind: 'direct', userIds: [parentA.id, studentAId] } }, title: 'A word to family A', body: 'This message is for family A only.', language: 'en', channels: ['in_app'],
    } }));
    const copies = await sql<{ id: string; user_id: string }>(`select id, user_id from notification where data->>'messageId' = $1 order by user_id`, [sent.id]);
    expect(copies).toHaveLength(2);
    for (const c of copies) {
      await refusedAs('parentB mark message copy of A read', parentB.api.v1.notifications[':id'].read.$put({ param: { id: c.id } }));
      await refusedAs('studentB mark message copy of A read', studentB.api.v1.notifications[':id'].read.$put({ param: { id: c.id } }));
    }
    expect(await sql(`select 1 from notification where data->>'messageId' = $1 and read_at is not null`, [sent.id])).toEqual([]);
    // B's own notifications never list A's copy.
    for (const who of [parentB, studentB]) {
      const mine = await apiResponse(who.api.v1.notifications.$get({ query: {} }));
      expect(mine.some((n) => (n.data as { messageId?: string } | null)?.messageId === sent.id)).toBe(false);
    }
    // The deliveries, the log, an audience naming A's student and a send are the school's.
    await refusedAs('parentB deliveries of A message', parentB.api.v1.messages.deliveries.$get({ query: { messageId: sent.id } }));
    await refusedAs('studentB deliveries of A message', studentB.api.v1.messages.deliveries.$get({ query: { messageId: sent.id } }));
    await refusedAs('parentB message log', parentB.api.v1.messages.$get({ query: {} }));
    await refusedAs('parentB resolve A family', parentB.api.v1.messages.audiences.resolve.$post({ json: { audience: { definition: { kind: 'batch', list: 'session_unpaid', sessionId, include: 'both', filter: 'unpaid', studentIds: [studentAId], who: 'families' } } } }));
    await refusedAs('parentB message to A', parentB.api.v1.messages.$post({ json: { audience: { definition: { kind: 'direct', userIds: [parentA.id] } }, title: 'From another family', body: 'A family may not message another family.', channels: ['in_app'] } }));
    await refusedAs('studentB message to A', studentB.api.v1.messages.$post({ json: { audience: { definition: { kind: 'direct', userIds: [studentAId] } }, title: 'From another family', body: 'A family may not message another family.', channels: ['in_app'] } }));
    // Finance passes the role gate but reads only money lists: a direct message's deliveries are refused.
    await refusedAs('officer deliveries of a direct message', officer.api.v1.messages.deliveries.$get({ query: { messageId: sent.id } }));
    await refusedAs('officer direct message', officer.api.v1.messages.$post({ json: { audience: { definition: { kind: 'direct', userIds: [parentA.id] } }, title: 'From the finance office', body: 'Finance sends to the money lists only.', channels: ['in_app'] } }));
    expect(await sql(`select 1 from message m where m.created_by = $1`, [officer.id])).toEqual([]);
  });
});
