import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiResponse } from '@repo/validations';
import { admin, staff, onboard, signUp, signIn, subject, session, one, sql, openWindow, type Client, reservationOf } from './helpers';

/**
 * Audit-trail completeness (security audit, RF-14 and RF-15).
 *
 * Every action that moves money, grants access to a child, or changes what
 * families are charged leaves an audit row, and the row is written before
 * the response: each check below reads the table the instant the request
 * returns, with no waiting.
 */

type Row = { action: string; user_id: string | null; previous_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null };
const rowsFor = (entityId: string) =>
  sql<Row>(`select action, user_id, previous_data, new_data from audit_log where entity_id = $1 order by created_at`, [entityId]);

/** Every .ts file under apps/api/src. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}

describe('audit writes', () => {
  it('every audit write in the API source is awaited (RF-15)', () => {
    // A structural rule, because a missing `await` passes every behaviour test
    // until a slow runner loses the race (CI run 36276996869).
    const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
    const offenders: string[] = [];
    for (const file of sourceFiles(src)) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        const where = `${path.relative(src, file)}:${i + 1}: ${line.trim()}`;
        // The scan matches the name, so an alias would hide a call from it.
        if (/logAction\s+as\s+\w+|=\s*logAction\b(?!\()/.test(line)) { offenders.push(`${where} (alias)`); return; }
        if (!line.includes('logAction(') || /function logAction\(|import .*logAction/.test(line) || /^\s*(\/\/|\*)/.test(line)) return;
        if (!/\b(await|return)\s+logAction\(/.test(line)) offenders.push(where);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe('audit trail', () => {
  let adm: Client, officer: Client, finadmin: Client, parent: Client, studentId: string, student: Client;
  let chem: string, sessionId: string;

  beforeAll(async () => {
    adm = await admin('at');
    officer = await staff(adm, 'finance_officer', 'at');
    finadmin = await staff(adm, 'finance_admin', 'at');
    ({ parent, student, studentId } = await onboard(officer, 'at', 12));
    chem = await subject(adm, 'AT-CHE', 'Chemistry (A2, audit)', { course: 1200, registration: 300 }, { qualificationLevel: 'a_level' });
    sessionId = await session(adm, 'November (A-Level, audit)', 'november', 'a_level', { ...openWindow(), activate: true });
  });

  it('a desk registration with cash is audited before the desk gets its answer', async () => {
    const r = await apiResponse(officer.api.v1.registrations.desk.$post({
      json: { studentId, sessionId, ...(await reservationOf(sessionId, [chem])), collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } },
    }));
    const actions = (await rowsFor(studentId)).map((x) => x.action);
    expect(actions).toContain('DESK_REGISTRATION');
    expect((await rowsFor(r.registrations[0]!.id)).map((x) => x.action)).toContain('REGISTRATION_CONFIRMED');
  });

  it('every step of a parent-student link is audited: request, answer, removal', async () => {
    const email = 'second.parent.at@test.local';
    await signUp('Second Parent', email);
    const second = await signIn(email);
    await apiResponse(second.api.v1.users.me['parent-setup'].$post());

    const link = await apiResponse(second.api.v1.links.$post({ json: { studentEmail: student.email } }));
    expect((await rowsFor(link!.id)).map((x) => [x.action, x.user_id])).toEqual([['LINK_REQUESTED', second.id]]);

    await apiResponse(student.api.v1.links[':id'].$put({ param: { id: link!.id }, json: { status: 'approved' } }));
    expect((await rowsFor(link!.id)).map((x) => x.action)).toEqual(['LINK_REQUESTED', 'LINK_APPROVED']);

    await apiResponse(adm.api.v1.links[':id'].$delete({ param: { id: link!.id } }));
    const removed = (await rowsFor(link!.id)).at(-1)!;
    expect(removed).toMatchObject({ action: 'LINK_REMOVED', user_id: adm.id, previous_data: { parentId: second.id, studentId, status: 'approved' } });
  });

  it('an audit row records the connection address, never a header the client chose (RF-11)', async () => {
    await apiResponse(adm.api.v1.users[':id'].$put(
      { param: { id: parent.id }, json: { name: 'Spoof Check' } },
      { headers: { 'cf-connecting-ip': '203.0.113.77', 'x-real-ip': '203.0.113.78' } }
    ));
    const row = await one<{ ip_address: string | null }>(
      `select ip_address from audit_log where entity_id = $1 and action = 'USER_UPDATED_BY_ADMIN' order by created_at desc limit 1`, [parent.id]
    );
    expect(row.ip_address).not.toBe('203.0.113.77');
    expect(row.ip_address).not.toBe('203.0.113.78');
    await apiResponse(adm.api.v1.users[':id'].$put({ param: { id: parent.id }, json: { name: 'Parent at' } }));
  });

  it('an admin changing a user records what changed, before and after', async () => {
    await apiResponse(adm.api.v1.users[':id'].$put({ param: { id: parent.id }, json: { name: 'Renamed By Admin', phone: '01222222222' } }));
    const row = (await rowsFor(parent.id)).filter((x) => x.action === 'USER_UPDATED_BY_ADMIN').at(-1)!;
    expect(row).toMatchObject({
      user_id: adm.id,
      previous_data: { name: 'Parent at', phone: '01000000000' },
      new_data: { name: 'Renamed By Admin', phone: '01222222222' },
    });
  });

  it('remark fees, deadlines and remark payments are audited', async () => {
    await apiResponse(finadmin.api.v1.remarks.fees.$put({ json: { council: 'cambridge', serviceType: 'review_of_marking', amountPerPaper: 900 } }));
    expect((await rowsFor('cambridge:review_of_marking')).at(-1)).toMatchObject({ action: 'REMARK_FEE_SET', user_id: finadmin.id, new_data: { amountPerPaper: 900 } });

    const deadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await apiResponse(finadmin.api.v1.remarks.deadlines.$put({ json: { council: 'cambridge', sessionId, serviceType: 'review_of_marking', deadline } }));
    expect((await rowsFor(`cambridge:${sessionId}:review_of_marking`)).at(-1)).toMatchObject({ action: 'REMARK_DEADLINE_SET', user_id: finadmin.id });

    const reg = (await one<{ id: string }>(`select id from registration where student_id = $1 and subject_id = $2`, [studentId, chem])).id;
    await apiResponse(officer.api.v1.remarks.results.$post({ json: { results: [{ registrationId: reg, grade: 'C' }] } }));
    const remark = await apiResponse(parent.api.v1.remarks.$post({ json: { registrationId: reg, serviceType: 'review_of_marking', papers: [{ paperCode: '9701/42' }] } }));
    await apiResponse(parent.api.v1.remarks[':id'].consent.$post({ param: { id: remark.id }, json: { attest: true } }));
    await apiResponse(parent.api.v1.remarks[':id'].pay.$post({ param: { id: remark.id }, json: { paymentMethod: 'in_school' } }));
    expect((await rowsFor(remark.id)).map((x) => x.action)).toEqual(
      expect.arrayContaining(['REMARK_REQUESTED', 'REMARK_CONSENT_CONFIRMED', 'REMARK_PAYMENT_INITIATED'])
    );
  });
});
