/**
 * What a family owes that it can pay now — one set of predicates, read by the reminder step
 * (reminder.services.ts) and by every money list a message is sent to (message-audience.services.ts:
 * a session's unpaid families, the holders of an unpaid charge), so "Remind" never asks a family to
 * pay what the step would not remind it of (the review of 5c2f2bf, item 1).
 *
 * A line (alias `r`) is owed and payable now when: it waits for payment (or is a preregistration
 * nobody has paid); its board fee is confirmed, unless the school takes payment on a provisional one;
 * no payment of it is open (a checkout, an InstaPay transfer being checked); it is not paid by an
 * instalment plan (its instalments are what is owed); its effective deadline has not passed; its
 * student is still at the school and not barred. A charge (alias `c`) when: it awaits payment; no
 * payment of it is open (for a pushed school fee: no school-fee payment of that year is open); C's
 * rules let it be paid now (`chargeRules` with `forPayment`); its student is still at the school.
 */

import { db, sql, charge, eq } from '@repo/db';
import { chargeRules, ChargeError } from './charge.services';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

/** A line waiting for its money: unpaid, or a preregistration nobody has paid. */
export const OWED_LINE = sql`(r.status = 'pending_payment' or (r.status = 'preregistered' and not exists (
  select 1 from payment_registration pr join payment p on p.id = pr.payment_id where pr.registration_id = r.id and p.status = 'completed')))`;
export const NO_OPEN_LINE_PAYMENT = sql`not exists (select 1 from payment_registration pr join payment p on p.id = pr.payment_id
  where pr.registration_id = r.id and p.status in ('pending', 'pending_verification'))`;
export const NO_LIVE_PLAN = sql`not exists (select 1 from exception e where e.policy_key = 'plan.instalments' and e.status = 'active' and e.registration_id = r.id)`;
export const NO_OPEN_CHARGE_PAYMENT = sql`not exists (select 1 from payment_charge pc join payment p on p.id = pc.payment_id
  where pc.charge_id = c.id and p.status in ('pending', 'pending_verification'))`;
/** A pushed school fee (alias c) whose student has a school-fee payment open for its year: being paid. */
export const SCHOOL_FEE_PAYMENT_OPEN = sql`exists (select 1 from payment p where p.student_id = c.student_id and p.purpose = 'school_fee'
  and p.academic_year = c.academic_year and p.status in ('pending', 'pending_verification'))`;
/** A line's effective deadline (A's `line_effective_deadline`, a rejected declaration read as a first entry). */
export const LINE_DEADLINE = sql.raw('line_effective_deadline(r.attempt, r.prior_sitting_series_id, r.board_series_id, r.declaration_rejected)');
/** A student (by a column or alias) still at the school and not barred: a leaver's family is not chased (F0a). */
export const studentPresent = (column: string) => sql.raw(`exists (select 1 from "user" su where su.id = ${column} and su.left_on is null and coalesce(su.banned, false) = false)`);

/** The line predicate as one SQL fragment, for a query over `registration r`. */
export function linePayableNowSql(now: Date, payOnProvisional: boolean) {
  return sql`${OWED_LINE} and (not r.price_provisional or ${payOnProvisional}) and ${NO_OPEN_LINE_PAYMENT} and ${NO_LIVE_PLAN}
    and (${LINE_DEADLINE} is null or ${LINE_DEADLINE} > ${now}) and ${studentPresent('r.student_id')}`;
}

/** The charge predicate as one SQL fragment, for a query over `charge c` (C's rules asked after it). */
export const chargeOpenSql = sql`c.status = 'pending_payment' and ${NO_OPEN_CHARGE_PAYMENT}
  and not (c.kind = 'school_fee_push' and ${SCHOOL_FEE_PAYMENT_OPEN}) and ${studentPresent('c.student_id')}`;

const list = (ids: string[]) => sql.join(ids.map((x) => sql`${x}`), sql`, `);

/** Of these lines, those owed and payable now. */
export async function payableLines(executor: Executor, lineIds: string[], now: Date, payOnProvisional: boolean): Promise<Set<string>> {
  if (!lineIds.length) return new Set();
  const r = await executor.execute(sql`select r.id from registration r where r.id in (${list(lineIds)}) and ${linePayableNowSql(now, payOnProvisional)}`);
  return new Set((r.rows as { id: string }[]).map((x) => x.id));
}

/**
 * Whether C's rules let a charge be paid now (`chargeRules` with `forPayment`: its deadline, a
 * service fee still provisional), read in the caller's transaction or a read-only one of its own.
 */
export async function chargePayableNow(executor: Executor, chargeId: string, now: Date): Promise<boolean> {
  const check = async (tx: Tx) => {
    const [c] = await tx.select().from(charge).where(eq(charge.id, chargeId));
    if (!c || c.status !== 'pending_payment') return false;
    await chargeRules(tx, c, now, { forPayment: true });
    return true;
  };
  try {
    return executor === db ? await db.transaction(check) : await check(executor as Tx);
  } catch (e) {
    if (e instanceof ChargeError) return false;
    throw e;
  }
}

/** Of these charges, those owed and payable now. */
export async function payableCharges(executor: Executor, chargeIds: string[], now: Date): Promise<Set<string>> {
  if (!chargeIds.length) return new Set();
  const r = await executor.execute(sql`select c.id from charge c where c.id in (${list(chargeIds)}) and ${chargeOpenSql}`);
  const out = new Set<string>();
  for (const { id } of r.rows as { id: string }[]) if (await chargePayableNow(executor, id, now)) out.add(id);
  return out;
}
