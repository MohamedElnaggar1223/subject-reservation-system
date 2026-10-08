/**
 * The session's Money tab, lines only (RESERVATIONS_REWORK.md §4.6): who has reserved what, who
 * has paid, who has not, with the amount, the due date and the days overdue; filters (unpaid,
 * overdue, by subject, by section, provisional). Charges join this list with step C; "Remind"
 * with step D. The finance workbench, takings and receipts are unchanged.
 */

import { db, sql } from '@repo/db';
import { seriesAcademicYearStart, type SessionMoneyQueryType } from '@repo/validations';

const DAY = 24 * 60 * 60 * 1000;

export async function getSessionMoney(sessionId: string, q: SessionMoneyQueryType) {
  const [session] = await db.execute(sql`select id, name, session_type, series_year, payment_due_at, status from registration_session where id = ${sessionId}`)
    .then((r) => r.rows as { id: string; name: string; session_type: string; series_year: number; payment_due_at: string | Date; status: string }[]);
  if (!session) return null;
  // The section a student is in during the session's own academic year (not today's).
  const ay = seriesAcademicYearStart(session.session_type, session.series_year);
  const rows = await db.execute(sql`
    select r.id, r.status, r.price_at_registration as price, r.course_fee_at_registration as course_fee,
      r.registration_fee_at_registration as board_fee, r.due_at, r.price_provisional, r.attempt, r.mode, r.created_at,
      u.id as student_id, u.name as student_name, u.student_id as student_number,
      s.id as subject_id, s.name as subject_name, i.id as item_id, i.label as item_label, i.kind as item_kind, o.id as offer_id,
      b.name as board_name, bs.month, bs.year, bs.label as series_label,
      line_effective_deadline(r.attempt, r.prior_sitting_series_id, r.board_series_id) as deadline,
      (select sec.name from section_membership m join section sec on sec.id = m.section_id join academic_year y on y.id = m.academic_year_id
        where m.student_id = u.id and y.start_year = ${ay} and m.ended_on is null limit 1) as section,
      (select sec.id from section_membership m join section sec on sec.id = m.section_id join academic_year y on y.id = m.academic_year_id
        where m.student_id = u.id and y.start_year = ${ay} and m.ended_on is null limit 1) as section_id,
      (select p.status from payment_registration pr join payment p on p.id = pr.payment_id
        where pr.registration_id = r.id order by p.created_at desc limit 1) as payment_status,
      exists (select 1 from payment_registration pr join payment p on p.id = pr.payment_id
        where pr.registration_id = r.id and p.status = 'completed') as funded,
      (select string_agg(pu.name, ', ' order by pu.name) from parent_student_link l join "user" pu on pu.id = l.parent_id
        where l.student_id = u.id and l.status = 'approved') as parents
    from registration r
    join "user" u on u.id = r.student_id
    join subject s on s.id = r.subject_id
    join session_offer_item i on i.id = r.offer_item_id
    join session_offer o on o.id = i.offer_id
    left join board_series bs on bs.id = r.board_series_id
    left join exam_board b on b.code = bs.board_code
    where r.session_id = ${sessionId} and r.status not in ('rejected')
    order by u.name, s.name, i.sort_order`).then((r) => r.rows as Record<string, unknown>[]);
  const now = Date.now();
  const lines = rows.map((r) => {
    const due = new Date(r.due_at as string);
    // Owed: waiting for payment, or a preregistration not yet paid. A line still waiting for the
    // parent's approval is not owed yet; a paid preregistration is paid (its money held).
    const funded = r.funded as boolean;
    const unpaid = r.status === 'pending_payment' || (r.status === 'preregistered' && !funded);
    const overdueDays = unpaid && due.getTime() < now ? Math.floor((now - due.getTime()) / DAY) : 0;
    return {
      id: r.id as string,
      status: r.status as string,
      price: Number(r.price),
      courseFee: Number(r.course_fee),
      boardFee: Number(r.board_fee),
      dueAt: due,
      deadline: r.deadline ? new Date(r.deadline as string) : null,
      overdueDays,
      provisional: r.price_provisional as boolean,
      attempt: r.attempt as string,
      mode: r.mode as string,
      paymentStatus: (r.payment_status as string | null) ?? null,
      unpaid,
      paid: r.status === 'confirmed' || (r.status === 'preregistered' && funded),
      student: { id: r.student_id as string, name: r.student_name as string, number: (r.student_number as string | null) ?? null, section: (r.section as string | null) ?? null, sectionId: (r.section_id as string | null) ?? null },
      parents: (r.parents as string | null) ?? null,
      subject: { id: r.subject_id as string, name: r.subject_name as string },
      item: { id: r.item_id as string, label: r.item_label as string, kind: r.item_kind as string, offerId: r.offer_id as string },
      series: r.board_name ? `${r.board_name} ${String(r.month).charAt(0).toUpperCase()}${String(r.month).slice(1)} ${r.year}${r.series_label ? ` (${r.series_label})` : ''}` : null,
    };
  });
  const filtered = lines.filter((l) => {
    if (q.offerId && l.item.offerId !== q.offerId) return false;
    if (q.sectionId && l.student.sectionId !== q.sectionId) return false;
    switch (q.filter) {
      case 'unpaid': return l.unpaid;
      case 'overdue': return l.overdueDays > 0;
      case 'provisional': return l.provisional && l.status !== 'confirmed';
      case 'paid': return l.paid;
      default: return l.status !== 'expired' && l.status !== 'dropped';
    }
  });
  const live = lines.filter((l) => !['expired', 'dropped', 'rejected'].includes(l.status));
  const sum = (xs: typeof lines) => Math.round(xs.reduce((a, l) => a + l.price, 0) * 100) / 100;
  const waiting = live.filter((l) => l.unpaid);
  const paid = live.filter((l) => l.paid);
  return {
    session: { id: session.id, name: session.name, paymentDueAt: new Date(session.payment_due_at), status: session.status },
    totals: {
      lines: live.length,
      paid: paid.length,
      paidAmount: sum(paid),
      awaitingApproval: live.filter((l) => l.status === 'pending_approval').length,
      unpaid: waiting.length,
      outstanding: sum(waiting),
      overdue: waiting.filter((l) => l.overdueDays > 0).length,
      overdueAmount: sum(waiting.filter((l) => l.overdueDays > 0)),
      provisional: waiting.filter((l) => l.provisional).length,
      families: new Set(waiting.map((l) => l.student.id)).size,
    },
    lines: filtered,
    // The sections the session's students are in that year, for the section filter.
    sections: [...new Map(lines.filter((l) => l.student.sectionId).map((l) => [l.student.sectionId!, l.student.section!])).entries()]
      .map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}
