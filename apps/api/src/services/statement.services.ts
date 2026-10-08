/**
 * The statement (RESERVATIONS_REWORK.md §4.5; docs/features/RESERVATIONS_LINES.md §5): per child
 * and per family, every line with its price, what was paid, what is outstanding, the due date,
 * its receipt and why the price is what it is (the pricing basis: "course 14,000 × 50% + board
 * 9,200 × 100%"); the remark fees and the school fee beside them; the payments — one per entry
 * deadline for the lines (F0b's rule, 09) — and the escrow. Every number is read from the
 * ledger: a line is paid when a completed payment covers it, a refund is an escrow credit (or a
 * refund parked on a receipt that is still out), the escrow is its balance.
 *
 * Charges (cash-in, late cash-in, certificate split, pushed school fees, instalments, price
 * adjustments) are step C's: `charges` is the extension point C fills, beside `lines`, with
 * their own price, paid and outstanding, so the totals add them.
 */

import { db, sql } from '@repo/db';
import { gradeInAcademicYear, gradeLabel, academicYearStartOf, academicYearStartFromLabel, type PricingBasis, type RefundPolicySnapshot } from '@repo/validations';
import { academicYearForDate, getSchoolFeeStanding } from './school-fee.services';

const round2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
const MONTHS: Record<string, string> = { january: 'January', june: 'June', october: 'October', november: 'November' };

/** "Pearson Edexcel June 2027", "Cambridge November 2026 (IAL)". */
export function formatSeriesName(s: { boardName: string | null; month: string; year: number; label: string | null }) {
  return `${s.boardName ?? ''} ${MONTHS[s.month] ?? s.month} ${s.year}${s.label ? ` (${s.label})` : ''}`.trim();
}

/**
 * Why a line costs what it costs, as the family reads it on hover: the course fee with its
 * percent (self-study, a retake, one paper), the board fee with its percent, and any exception.
 * A line from before the rework has no basis: its recorded split is shown.
 */
export function basisText(basis: PricingBasis | null, line: { courseFee: number; boardFee: number; provisional?: boolean }) {
  if (!basis) return `course ${fmt(line.courseFee)} + board ${fmt(line.boardFee)} (recorded before the rework)`;
  if (basis.customPrice) return `custom price ${fmt(basis.total)} (an exception; board fee included)`;
  const coursePct = round2((basis.coursePercent * (basis.itemKind === 'one_paper' ? basis.onePaperPercent : 100)) / 100);
  const parts = `course ${fmt(basis.courseFeeBase)} × ${coursePct}% + board ${fmt(basis.boardFeeBase)} × ${basis.boardPercent}%`;
  const plain = round2((basis.courseFeeBase * coursePct) / 100 + (basis.boardFeeBase * basis.boardPercent) / 100);
  // Provisional as the line is now: a fee confirmed at its amount clears the line, not its basis.
  const provisional = line.provisional ? ' (board fee provisional)' : '';
  return round2(basis.total) === plain ? `${parts}${provisional}` : `${parts} = ${fmt(plain)}, less exceptions = ${fmt(basis.total)}${provisional}`;
}

type LineRow = {
  id: string; student_id: string; session_id: string; session_name: string; status: string; subject: string; item: string; kind: string;
  attempt: string; mode: string; teacher: string | null; teacher_id: string | null; offer_item_id: string; snapshot: RefundPolicySnapshot | null;
  price: string; course_fee: string; board_fee: string; due_at: string | null;
  provisional: boolean; basis: PricingBasis | null; board_name: string | null; month: string | null; year: number | null; series_label: string | null;
  deadline: string | null; prior_board: string | null; prior_month: string | null; prior_year: number | null; prior_label: string | null;
  prior_source: string | null; prior_outcome: string | null; declaration_rejected: boolean; created_at: string;
  receipt_number: string | null; receipt_status: string | null; receipt_issued_at: string | null; receipt_created_at: string | null; receipt_parked: string | null;
  paid_payment_id: string | null; paid_at: string | null; refunded: string | null; consents: { kind: string; channel: string; at: string }[] | null;
};

/**
 * Owed now, as A's Money tab counts it (session-money.services `unpaid`): a line waiting for
 * payment, or a preregistration nobody has paid yet. A line still waiting for the parent's
 * approval is not owed until it is approved (it has a due date, not an amount owed).
 */
const OWED_STATUSES = ['pending_payment', 'preregistered'];
const DATED_STATUSES = ['pending_approval', 'pending_payment', 'preregistered'];

async function linesOf(studentIds: string[]) {
  const r = await db.execute(sql`
    select r.id, r.student_id, r.session_id, rs.name as session_name, r.status, s.name as subject, i.label as item, i.kind, r.attempt, r.mode,
      t.name as teacher, r.teacher_id, r.offer_item_id, r.refund_policy_snapshot as snapshot,
      r.price_at_registration as price, r.course_fee_at_registration as course_fee, r.registration_fee_at_registration as board_fee,
      r.due_at, r.price_provisional as provisional, r.pricing_basis as basis, b.name as board_name, bs.month, bs.year, bs.label as series_label,
      line_effective_deadline(r.attempt, r.prior_sitting_series_id, r.board_series_id, r.declaration_rejected) as deadline,
      pb.name as prior_board, ps.month as prior_month, ps.year as prior_year, ps.label as prior_label,
      r.prior_sitting_source as prior_source, r.prior_sitting_verified_outcome as prior_outcome, r.declaration_rejected, r.created_at,
      rc.receipt_number, rc.status as receipt_status, rc.issued_at as receipt_issued_at, rc.created_at as receipt_created_at,
      case when rc.status = 'return_required' then rc.refund_amount_on_return end as receipt_parked,
      (select p.id from payment_registration pr join payment p on p.id = pr.payment_id where pr.registration_id = r.id and p.status = 'completed' order by p.confirmed_at desc limit 1) as paid_payment_id,
      (select p.confirmed_at from payment_registration pr join payment p on p.id = pr.payment_id where pr.registration_id = r.id and p.status = 'completed' order by p.confirmed_at desc limit 1) as paid_at,
      (select sum(t2.amount) from escrow_transaction t2 where t2.related_registration_id = r.id and t2.type = 'credit' and t2.reason in ('drop', 'swap_refund')) as refunded,
      (select json_agg(json_build_object('kind', c.kind, 'channel', c.channel, 'at', c.at) order by c.at) from registration_consent c where c.registration_id = r.id) as consents
    from registration r
    join registration_session rs on rs.id = r.session_id
    join session_offer_item i on i.id = r.offer_item_id
    join session_offer o on o.id = i.offer_id
    join subject s on s.id = o.subject_id
    left join teacher t on t.id = r.teacher_id
    left join board_series bs on bs.id = r.board_series_id
    left join exam_board b on b.code = bs.board_code
    left join board_series ps on ps.id = r.prior_sitting_series_id
    left join exam_board pb on pb.code = ps.board_code
    left join receipt rc on rc.registration_id = r.id
    where r.student_id in (${sql.join(studentIds.map((id) => sql`${id}`), sql`, `)})
    order by rs.start_date desc, rs.name, s.name, i.sort_order, r.created_at`);
  const now = Date.now();
  return (r.rows as LineRow[]).map((l) => {
    const price = Number(l.price);
    const paid = l.paid_payment_id ? price : 0;
    const owed = OWED_STATUSES.includes(l.status) && !l.paid_payment_id;
    const outstanding = owed ? price : 0;
    const dueAt = l.due_at ? new Date(l.due_at) : null;
    const courseFee = Number(l.course_fee);
    const boardFee = Number(l.board_fee);
    return {
      id: l.id,
      studentId: l.student_id,
      session: { id: l.session_id, name: l.session_name },
      status: l.status,
      subject: l.subject,
      item: l.item,
      kind: l.kind,
      label: l.kind === 'whole' ? l.subject : `${l.subject} — ${l.item}`,
      attempt: l.attempt,
      mode: l.mode,
      teacher: l.teacher,
      price,
      courseFee,
      boardFee,
      paid,
      outstanding,
      // Escrow credits for a drop or swap, and a refund parked on a receipt that is still out.
      refunded: round2(Number(l.refunded ?? 0)),
      refundAwaitingReceipt: l.receipt_parked === null ? null : Number(l.receipt_parked),
      dueAt: DATED_STATUSES.includes(l.status) && !l.paid_payment_id ? dueAt : null,
      overdueDays: outstanding > 0 && dueAt && dueAt.getTime() < now ? Math.floor((now - dueAt.getTime()) / 86_400_000) : 0,
      provisional: l.provisional,
      basisText: basisText(l.basis, { courseFee, boardFee, provisional: l.provisional }),
      series: l.month ? formatSeriesName({ boardName: l.board_name, month: l.month, year: Number(l.year), label: l.series_label }) : null,
      deadline: l.deadline ? new Date(l.deadline) : null,
      priorSitting: l.prior_month ? {
        name: formatSeriesName({ boardName: l.prior_board, month: l.prior_month, year: Number(l.prior_year), label: l.prior_label }),
        source: l.prior_source,
        outcome: l.prior_outcome,
        declarationRejected: l.declaration_rejected,
      } : null,
      receipt: l.receipt_number ? {
        number: l.receipt_number, status: l.receipt_status!, issuedAt: l.receipt_issued_at ? new Date(l.receipt_issued_at) : null,
        createdAt: new Date(l.receipt_created_at!),
      } : null,
      paidAt: l.paid_at ? new Date(l.paid_at) : null,
      paymentId: l.paid_payment_id,
      consents: (l.consents ?? []).map((c) => ({ kind: c.kind, channel: c.channel, at: new Date(c.at) })),
      // The refund steps the family consented to (the slip prints them) and what a teacher change reads.
      refundPolicySnapshot: l.snapshot,
      offerItemId: l.offer_item_id,
      teacherId: l.teacher_id,
      reservedAt: new Date(l.created_at),
    };
  });
}

type PaymentRow = {
  id: string; student_id: string; purpose: string; status: string; method: string; instrument: string | null; amount: string; escrow: string;
  created_at: string; confirmed_at: string | null; reversed_at: string | null; reference: string | null; academic_year: string | null;
  covers: { registrationId: string; label: string; receipt: string | null }[] | null; deadline: string | null; series: string[] | null;
  remark: string | null;
};

async function paymentsOf(studentIds: string[]) {
  const r = await db.execute(sql`
    select p.id, p.student_id, p.purpose, p.status, p.payment_method as method, p.instrument_used as instrument, p.amount, p.escrow_amount_applied as escrow,
      p.created_at, p.confirmed_at, p.reversed_at, p.external_reference as reference, p.academic_year,
      (select json_agg(json_build_object('registrationId', r.id, 'label', case when i.kind = 'whole' then s.name else s.name || ' — ' || i.label end,
          'receipt', (select rc.receipt_number from receipt rc where rc.registration_id = r.id)) order by s.name)
        from payment_registration pr join registration r on r.id = pr.registration_id join session_offer_item i on i.id = r.offer_item_id
        join session_offer o on o.id = i.offer_id join subject s on s.id = o.subject_id where pr.payment_id = p.id) as covers,
      (select min(line_effective_deadline(r.attempt, r.prior_sitting_series_id, r.board_series_id, r.declaration_rejected)) from payment_registration pr join registration r on r.id = pr.registration_id where pr.payment_id = p.id) as deadline,
      (select array_agg(distinct coalesce(b.name, '') || ' ' || initcap(bs.month) || ' ' || bs.year || case when bs.label <> '' then ' (' || bs.label || ')' else '' end)
        from payment_registration pr join registration r on r.id = pr.registration_id join board_series bs on bs.id = r.board_series_id left join exam_board b on b.code = bs.board_code
        where pr.payment_id = p.id) as series,
      (select s.name || ' — ' || rr.service_type from remark_request rr join registration r on r.id = rr.registration_id join subject s on s.id = r.subject_id
        where rr.id = p.metadata->>'remarkRequestId') as remark
    from payment p
    where p.student_id in (${sql.join(studentIds.map((id) => sql`${id}`), sql`, `)})
      and p.status in ('completed', 'refunded', 'pending', 'pending_verification')
    order by coalesce(p.confirmed_at, p.created_at) desc`);
  return (r.rows as PaymentRow[]).map((p) => ({
    id: p.id,
    studentId: p.student_id,
    purpose: p.purpose,
    status: p.status,
    method: p.method,
    instrument: p.instrument,
    amount: Number(p.amount),
    escrowApplied: Number(p.escrow),
    total: round2(Number(p.amount) + Number(p.escrow)),
    at: new Date(p.confirmed_at ?? p.created_at),
    reversedAt: p.reversed_at ? new Date(p.reversed_at) : null,
    reference: p.reference,
    academicYear: p.academic_year,
    covers: p.covers ?? [],
    // One entry deadline per registration payment (F0b; 09): the date its lines share.
    deadline: p.deadline ? new Date(p.deadline) : null,
    series: p.series ?? [],
    remark: p.remark,
  }));
}

async function remarksOf(studentIds: string[]) {
  const r = await db.execute(sql`
    select rr.id, rr.student_id, rr.service_type as service, rr.status, rr.fee_charged as fee, s.name as subject, rs.name as session,
      exists (select 1 from payment p where p.metadata->>'remarkRequestId' = rr.id and p.status = 'completed') as paid
    from remark_request rr join registration r on r.id = rr.registration_id join subject s on s.id = r.subject_id
    join registration_session rs on rs.id = r.session_id
    where rr.student_id in (${sql.join(studentIds.map((id) => sql`${id}`), sql`, `)})
    order by rr.created_at desc`);
  return (r.rows as { id: string; student_id: string; service: string; status: string; fee: string; subject: string; session: string; paid: boolean }[])
    .map((x) => ({ id: x.id, studentId: x.student_id, label: `Remark: ${x.subject} (${x.session}), ${x.service.replace(/_/g, ' ')}`, status: x.status,
      fee: Number(x.fee), paid: x.paid ? Number(x.fee) : 0, outstanding: !x.paid && x.status === 'pending_payment' ? Number(x.fee) : 0 }));
}

async function escrowOf(studentIds: string[]) {
  const balances = await db.execute(sql`
    select e.student_id, e.balance, e.held_balance from escrow e where e.student_id in (${sql.join(studentIds.map((id) => sql`${id}`), sql`, `)})`)
    .then((r) => r.rows as { student_id: string; balance: string; held_balance: string }[]);
  const moves = await db.execute(sql`
    select e.student_id, t.type, t.balance_type, t.amount, t.reason, t.created_at, t.related_registration_id, t.related_payment_id
    from escrow_transaction t join escrow e on e.id = t.escrow_id
    where e.student_id in (${sql.join(studentIds.map((id) => sql`${id}`), sql`, `)})
    order by t.created_at desc limit 200`).then((r) => r.rows as {
      student_id: string; type: string; balance_type: string; amount: string; reason: string; created_at: string; related_registration_id: string | null; related_payment_id: string | null;
    }[]);
  return studentIds.map((id) => {
    const b = balances.find((x) => x.student_id === id);
    return {
      studentId: id,
      free: Number(b?.balance ?? 0),
      held: Number(b?.held_balance ?? 0),
      movements: moves.filter((m) => m.student_id === id).map((m) => ({
        type: m.type, balance: m.balance_type, amount: Number(m.amount), reason: m.reason, at: new Date(m.created_at),
        registrationId: m.related_registration_id, paymentId: m.related_payment_id,
      })),
    };
  });
}

/** The school fee of the year today falls in (and any year paid), per student, as every screen reads it (RF-10). */
async function schoolFeesOf(students: { id: string; cohortYear: number | null }[], payments: Awaited<ReturnType<typeof paymentsOf>>) {
  const year = academicYearForDate(new Date());
  return Promise.all(students.map(async (s) => {
    const years = [...new Set([year, ...payments.filter((p) => p.studentId === s.id && p.purpose === 'school_fee' && p.academicYear).map((p) => p.academicYear!)])];
    const rows = [];
    for (const y of years) {
      const start = academicYearStartFromLabel(y);
      const standing = await getSchoolFeeStanding(s.id, start === null ? null : gradeInAcademicYear(s.cohortYear, start), y);
      if (!standing.fee) continue;
      const paidBy = payments.find((p) => p.studentId === s.id && p.purpose === 'school_fee' && p.academicYear === y && p.status === 'completed');
      rows.push({
        academicYear: y, amount: standing.fee.amount, waived: standing.waived, paid: standing.paid ? standing.fee.amount : 0,
        outstanding: standing.settled ? 0 : standing.fee.amount, paidAt: paidBy?.at ?? null, paymentId: paidBy?.id ?? null,
      });
    }
    return { studentId: s.id, rows };
  }));
}

/** The statement of one student or of every child of a family (a parent's account). */
export async function statementFor(scope: { studentIds: string[]; family: { id: string; name: string } | null }) {
  const ids = [...new Set(scope.studentIds)];
  if (!ids.length) {
    return { family: scope.family, students: [], totals: { price: 0, paid: 0, outstanding: 0, escrowFree: 0, escrowHeld: 0 } };
  }
  const students = await db.execute(sql`
    select u.id, u.name, u.student_id as number, u.cohort_year as "cohortYear",
      (select sec.name from section_membership m join section sec on sec.id = m.section_id join academic_year y on y.id = m.academic_year_id
        where m.student_id = u.id and y.start_year = ${academicYearStartOf()} and m.ended_on is null limit 1) as section
    from "user" u where u.id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)}) and u.role = 'student' order by u.name`)
    .then((r) => r.rows as { id: string; name: string; number: string | null; cohortYear: number | null; section: string | null }[]);
  const [lines, payments, remarks, escrow] = await Promise.all([linesOf(ids), paymentsOf(ids), remarksOf(ids), escrowOf(ids)]);
  const fees = await schoolFeesOf(students, payments);
  const out = students.map((s) => {
    const mine = lines.filter((l) => l.studentId === s.id);
    const sessions = [...new Map(mine.map((l) => [l.session.id, l.session])).values()].map((sess) => ({ ...sess, lines: mine.filter((l) => l.session.id === sess.id) }));
    const myRemarks = remarks.filter((r) => r.studentId === s.id);
    const myFees = fees.find((f) => f.studentId === s.id)?.rows ?? [];
    // Step C adds the student's charges here, each with its price, paid and outstanding (§3.6).
    const charges: { id: string; label: string; price: number; paid: number; outstanding: number; dueAt: Date | null }[] = [];
    const live = mine.filter((l) => !['rejected', 'expired'].includes(l.status));
    const totals = {
      price: round2(live.reduce((a, l) => a + l.price, 0) + myRemarks.reduce((a, r) => a + r.fee, 0) + myFees.reduce((a, f) => a + (f.waived ? 0 : f.amount), 0) + charges.reduce((a, c) => a + c.price, 0)),
      paid: round2(mine.reduce((a, l) => a + l.paid, 0) + myRemarks.reduce((a, r) => a + r.paid, 0) + myFees.reduce((a, f) => a + f.paid, 0) + charges.reduce((a, c) => a + c.paid, 0)),
      outstanding: round2(mine.reduce((a, l) => a + l.outstanding, 0) + myRemarks.reduce((a, r) => a + r.outstanding, 0) + myFees.reduce((a, f) => a + f.outstanding, 0) + charges.reduce((a, c) => a + c.outstanding, 0)),
      refunded: round2(mine.reduce((a, l) => a + l.refunded, 0)),
    };
    const year = academicYearStartOf();
    return {
      student: { id: s.id, name: s.name, number: s.number, section: s.section, grade: gradeInAcademicYear(s.cohortYear, year), gradeLabel: gradeLabel(gradeInAcademicYear(s.cohortYear, year)) },
      sessions,
      remarks: myRemarks,
      schoolFees: myFees,
      charges,
      payments: payments.filter((p) => p.studentId === s.id),
      escrow: escrow.find((e) => e.studentId === s.id)!,
      totals,
    };
  });
  return {
    family: scope.family,
    students: out,
    totals: {
      price: round2(out.reduce((a, s) => a + s.totals.price, 0)),
      paid: round2(out.reduce((a, s) => a + s.totals.paid, 0)),
      outstanding: round2(out.reduce((a, s) => a + s.totals.outstanding, 0)),
      escrowFree: round2(out.reduce((a, s) => a + s.escrow.free, 0)),
      escrowHeld: round2(out.reduce((a, s) => a + s.escrow.held, 0)),
    },
  };
}

/** The children of a family (a parent's approved links), and the parent's name. */
export async function familyOf(parentId: string) {
  const [parent] = await db.execute(sql`select id, name, role from "user" where id = ${parentId}`).then((r) => r.rows as { id: string; name: string; role: string }[]);
  if (!parent || parent.role !== 'parent') return null;
  const kids = await db.execute(sql`select student_id from parent_student_link where parent_id = ${parentId} and status = 'approved'`)
    .then((r) => r.rows as { student_id: string }[]);
  return { family: { id: parent.id, name: parent.name }, studentIds: kids.map((k) => k.student_id) };
}
