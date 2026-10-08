// The conversion proof's probe (RESERVATIONS_REWORK.md §7): run with main's code on a copy
// migrated to main (before), and with the branch's code on the same copy migrated to the branch
// (after). It writes what must not change: every line's price, parts, status, series and
// payments; every wallet; the eligibility answer of every waiting line; the refund preview of
// every live line. Usage: tsx probe.mts <api dir> <out.json>
import fs from 'node:fs';

const [api, out] = process.argv.slice(2) as [string, string];
const { db, sql } = await import(`${api}/node_modules/@repo/db/dist/src/index.js`);
const { mayRegisterFor } = await import(`${api}/src/services/eligibility.services.ts`);
const { previewRefund } = await import(`${api}/src/services/refund.services.ts`);

const rows = async (q: unknown) => ((await db.execute(q)) as { rows: Record<string, unknown>[] }).rows;
const lines = await rows(sql`
  select r.id, r.status, r.price_at_registration::text as price, r.course_fee_at_registration::text as course,
    r.registration_fee_at_registration::text as board, r.board_series_id as series, r.student_id, r.session_id, r.subject_id,
    (select coalesce(json_agg(json_build_object('payment', p.id, 'status', p.status, 'amount', p.amount::text, 'escrow', p.escrow_amount_applied::text) order by p.id), '[]'::json)
       from payment_registration pr join payment p on p.id = pr.payment_id where pr.registration_id = r.id) as payments
  from registration r order by r.id`);
const wallets = await rows(sql`select student_id, balance::text, held_balance::text as held from escrow order by student_id`);
const sessions = await rows(sql`select id, status, start_date, end_date from registration_session order by id`);
const eligibility: Record<string, unknown> = {};
for (const l of lines.filter((x) => ['pending_approval', 'pending_payment', 'preregistered'].includes(String(x.status)))) {
  const e = await mayRegisterFor(String(l.student_id), String(l.session_id));
  eligibility[String(l.id)] = { allowed: e.allowed, code: e.code ?? null, grade: e.grade ?? null, academicYear: e.series?.academicYearStart ?? null };
}
const refunds: Record<string, unknown> = {};
for (const l of lines.filter((x) => !['rejected', 'expired', 'dropped'].includes(String(x.status)))) {
  const p = await previewRefund(String(l.id));
  refunds[String(l.id)] = { percentage: p.percentage, amount: p.amount };
}
fs.writeFileSync(out, JSON.stringify({ lines, wallets, sessions, eligibility, refunds }, null, 1));
console.log(`probe: ${lines.length} lines, ${wallets.length} wallets, ${Object.keys(eligibility).length} waiting, ${Object.keys(refunds).length} live`);
process.exit(0);
