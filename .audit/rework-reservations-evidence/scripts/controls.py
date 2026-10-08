#!/usr/bin/env python3
"""Run each guard's control: undo it, run the tests that prove it, expect red, put it back.

Usage: controls.py [name ...]  (default: all). Logs in .audit/rework-reservations-evidence/control-<name>.log
"""
import os, subprocess, sys, datetime

WT = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/rework-reservations'
EV = WT + '/.audit/rework-reservations-evidence'

CONTROLS = {
    'confirm-consent': ('apps/api/src/services/payment.services.ts',
        "    if ((await consentStanding(tx, toConfirm)).missing.length) throw new Error(CONSENT_MISSING_REFUSAL);\n",
        "    void toConfirm; // CONTROL: the confirmation's consent check undone\n",
        ['test/08o-reservation-lines.test.ts'], 'a line without consent is never paid or confirmed'),
    'consent-trigger': ('apps/api/test/08o-reservation-lines.test.ts',
        "    await expect(sql(`update registration set status = 'confirmed' where id = $1`, [l!.id])).rejects.toThrow();\n",
        "    await sql(`drop trigger registration_confirmed_has_consent on registration`); // CONTROL: 0045's trigger undone\n    await expect(sql(`update registration set status = 'confirmed' where id = $1`, [l!.id])).rejects.toThrow();\n",
        ['test/08o-reservation-lines.test.ts'], 'a line without consent is never paid or confirmed'),
    'checkout-family-consent': ('apps/api/src/services/payment.services.ts',
        "  if (consent.schoolOnly.length && !data.consent) throw new Error(FAMILY_CONSENT_NEEDED);\n\n  // Held-wallet",
        "  // CONTROL: the checkout's family-consent requirement undone\n\n  // Held-wallet",
        ['test/08o-reservation-lines.test.ts'], 'grade-10 lines carry'),
    'already-reserved': ('apps/api/src/services/reservation.services.ts',
        "  if (held.length) {\n",
        "  if (held.length && false) { // CONTROL: the already-reserved check undone\n",
        ['test/08o-reservation-lines.test.ts', 'test/08t-rework-races.test.ts'], 'a family reserves in the app|two desks'),
    'expected-price': ('apps/api/src/services/reservation.services.ts',
        "  if (inserted.some((r) => expected.has(r.offerItemId) && round2(expected.get(r.offerItemId)!) !== round2(r.priceAtRegistration))) {\n",
        "  if (false && inserted.some((r) => expected.has(r.offerItemId))) { // CONTROL: the price comparison undone\n",
        ['test/08o-reservation-lines.test.ts'], 'the price the page showed'),
    'reject-open-payment': ('apps/api/src/services/verification.services.ts',
        "      if (open) throw new VerificationError('A payment for this line is in progress: confirm or reject it in the Finance Workbench first', 409);\n",
        "      void open; // CONTROL: the open-payment refusal undone\n",
        ['test/08o-reservation-lines.test.ts', 'test/08t-rework-races.test.ts'], 'rejected on an unpaid line|the checkout first'),
    'verify-row-lock': ('apps/api/src/services/verification.services.ts',
        "  await tx.select({ id: registration.id }).from(registration).where(eq(registration.id, id)).for('update');\n  return loadLine(tx, id);",
        "  // CONTROL: the line's row lock undone\n  return loadLine(tx, id);",
        ['test/08t-rework-races.test.ts'], 'the checkout first'),
    'lock-order-line-first': ('apps/api/src/services/verification.services.ts',
        "  await tx.select({ id: receipt.id }).from(receipt).where(eq(receipt.registrationId, id)).for('update');\n  await tx.select({ id: registration.id }).from(registration).where(eq(registration.id, id)).for('update');\n",
        "  await tx.select({ id: registration.id }).from(registration).where(eq(registration.id, id)).for('update'); // CONTROL: the line first\n  await tx.select({ id: receipt.id }).from(receipt).where(eq(receipt.registrationId, id)).for('update');\n",
        ['test/08t-rework-races.test.ts'], 'rejection first'),
    'approval-line-first': ('apps/api/src/services/swap.services.ts',
        "    await tx.select({ id: receipt.id }).from(receipt).where(eq(receipt.registrationId, cr.registrationId)).for('update');\n",
        "    void receipt; // CONTROL: the approval's receipt lock undone (the line first, as before the decision)\n",
        ['test/08t-rework-races.test.ts'], 'approval first'),
    'hold-since': ('apps/api/src/services/verification.services.ts',
        "      and line_effective_deadline(r.attempt, r.prior_sitting_series_id, r.board_series_id) > ${since.at}\n    order by r.id`).then((x) => x.rows as { id: string }[]);",
        "    order by r.id`).then((x) => x.rows as { id: string }[]); // CONTROL: the since-hold filter undone (query)",
        ['test/08o-reservation-lines.test.ts'], 'unverified at the deadline'),
    'hold-since-both': ('apps/api/src/services/verification.services.ts',
        ["        if (!d.at || d.at > now || d.at <= since.at) return null;",
         "      and line_effective_deadline(r.attempt, r.prior_sitting_series_id, r.board_series_id) > ${since.at}\n    order by r.id`).then((x) => x.rows as { id: string }[]);"],
        ["        if (!d.at || d.at > now) return null; // CONTROL: the since-hold re-check undone",
         "    order by r.id`).then((x) => x.rows as { id: string }[]); // CONTROL: and the query's filter"],
        ['test/08o-reservation-lines.test.ts'], 'unverified at the deadline'),
    'statement-link': ('apps/api/src/routes/reservation.routes.ts',
        "            if (!children.some((ch) => ch.studentId === q.studentId)) return error(c, 'You are not linked to this student', 403);\n",
        "            void children; // CONTROL: the parent's link check undone\n",
        ['test/05-object-access.test.ts'], 'step B'),
    'swap-inherits': ('apps/api/src/services/swap.services.ts',
        "  if (!(await inheritConsents(tx, a.fromRegistrationId, [made!.id]))) {\n",
        "  if (false && !(await inheritConsents(tx, a.fromRegistrationId, [made!.id]))) { // CONTROL: inheritance undone\n",
        ['test/08o-reservation-lines.test.ts'], 'inherits the dropped line'),
    'teacher-pool': ('apps/api/src/services/line-teacher.services.ts',
        "        if (!pool.includes(input.teacherId)) throw new LineTeacherError(",
        "        if (false && !pool.includes(input.teacherId)) throw new LineTeacherError( // CONTROL: the offer's teacher pool undone\n",
        ['test/08o-reservation-lines.test.ts'], 'the teacher on a line'),
    'teacher-selfstudy-up': ('apps/api/src/services/line-teacher.services.ts',
        "    if (line.mode === 'self_study' && mode === 'in_school') {",
        "    if (false && line.mode === 'self_study' && mode === 'in_school') { // CONTROL: self-study to taught undone",
        ['test/08o-reservation-lines.test.ts'], 'the teacher on a line'),
    'hold-two-schedulers': ('apps/api/src/services/verification.services.ts',
        "        const line = await lockLine(tx, id);\n        if (!line || line.outcome || !(DECLARED",
        "        const line = await loadLine(tx, id); // CONTROL: the hold step's row lock undone\n        if (!line || line.outcome || !(DECLARED",
        ['test/08t-rework-races.test.ts'], 'two schedulers'),
    'hold-two-schedulers-both': (['apps/api/src/services/verification.services.ts', 'apps/api/src/services/receipt.services.ts'],
        ["        const line = await lockLine(tx, id);\n        if (!line || line.outcome || !(DECLARED",
         "and(eq(registration.id, args.registrationId), eq(registration.status, args.fromStatus ?? 'confirmed'))"],
        ["        const line = await loadLine(tx, id); // CONTROL: the hold step's row lock undone\n        if (!line || line.outcome || !(DECLARED",
         "and(eq(registration.id, args.registrationId)) /* CONTROL: and the drop's status condition */"],
        ['test/08t-rework-races.test.ts'], 'two schedulers'),
    'reject-board-sent': ('apps/api/src/services/verification.services.ts',
        "    const boardSent = !!own.at && own.at <= now;\n",
        "    const boardSent = true; void own; // CONTROL: the line's own sent state undone (always sent)\n",
        ['test/08o-reservation-lines.test.ts'], 'after the first-entry deadline'),
    'board-fee-kept': ('apps/api/src/services/reservation.services.ts',
        "  const boardFeeKept = opts.boardSent ? Math.min(line.priceAtRegistration, Math.max(0, line.registrationFeeAtRegistration)) : 0;",
        "  const boardFeeKept = 0; void opts; // CONTROL: the sent board fee refunded again",
        ['test/08o-reservation-lines.test.ts'], 'board fee the school has paid'),
    'snapshot-year-fallback': ('apps/api/src/services/reservation.services.ts',
        "  if (!windows.length && s) {",
        "  if (false && !windows.length && s) { // CONTROL: the academic year's windows not read",
        ['test/08o-reservation-lines.test.ts'], 'converted session'),
    'known-confirmed-only': ('apps/api/src/services/reservation.services.ts',
        "r.session_id <> ${sessionId} and r.status = 'confirmed'",
        "r.session_id <> ${sessionId} and r.status in ('confirmed', 'dropped') /* CONTROL: a dropped line known again */",
        ['test/08o-reservation-lines.test.ts'], 'dropped line is not a known'),
    'checkout-terms': ('apps/api/src/services/payment.services.ts',
        "        familyConsentTerms: await Promise.all(sessions.map(async (sessionId) => ({ sessionId, terms: await refundTermsFor(db, sessionId) }))),",
        "        familyConsentTerms: [] as { sessionId: string; terms: Awaited<ReturnType<typeof refundTermsFor>> }[], // CONTROL: no terms shown\n        _unused: sessions,",
        ['test/08o-reservation-lines.test.ts'], 'grade-10 lines carry'),
    'teacher-first-entry': ('apps/api/src/services/line-teacher.services.ts',
        "      && !availabilityConstraints(facts.offerAvailability, facts.itemAvailability).selfStudyOnly) {",
        "      && false && !availabilityConstraints(facts.offerAvailability, facts.itemAvailability).selfStudyOnly) { // CONTROL: staff may move a taught first entry to self-study",
        ['test/08o-reservation-lines.test.ts'], 'the teacher on a line'),
    'statement-owed': ('apps/api/src/services/statement.services.ts',
        "    const owed = OWED_STATUSES.includes(l.status) && !l.paid_payment_id;",
        "    const owed = ['pending_approval', 'pending_payment'].includes(l.status) && !l.paid_payment_id; void OWED_STATUSES; // CONTROL: the old waiting rule",
        ['test/08o-reservation-lines.test.ts'], "outstanding is the Money tab"),
    'declared-two-years': ('apps/api/src/services/reservation.services.ts',
        "        && it.year * 12 + schoolMonthIndex(it.month) - (p.year * 12 + schoolMonthIndex(p.month)) > 24) {",
        "        && false) { // CONTROL: no two-year bound",
        ['test/08o-reservation-lines.test.ts'], 'a family declares a retake'),
    'hold-from-change': ('apps/api/src/services/verification.services.ts',
        "  const sinceAt = changed ? new Date(String(changed.at)) : row?.at ?? null;",
        "  const [rowAt] = await db.select({ at: schoolSetting.updatedAt }).from(schoolSetting).where(eq(schoolSetting.key, 'verification.unverifiedAtDeadline')); void changed; void row;\n  const sinceAt = rowAt?.at ?? null; // CONTROL: the setting row's own time again",
        ['test/08o-reservation-lines.test.ts', 'test/08t-rework-races.test.ts'], 'unverified at the deadline|two schedulers'),
    'swap-price': ('apps/api/src/services/swap.services.ts',
        "      cr.priceAtRequest != null ? { ...asked, expectedPrice: Number(cr.priceAtRequest) } : asked);",
        "      asked); // CONTROL: the price the parent saw not compared",
        ['test/08o-reservation-lines.test.ts'], "a swap's new line"),
    'flag-statement': ('apps/api/src/services/statement.services.ts',
        "      line_effective_deadline(r.attempt, r.prior_sitting_series_id, r.board_series_id, r.declaration_rejected) as deadline,",
        "      line_effective_deadline(r.attempt, r.prior_sitting_series_id, r.board_series_id) as deadline, -- CONTROL: the flag not passed",
        ['test/08o-reservation-lines.test.ts'], 'a rejected declaration is a first entry'),
    'flag-deadlines-of': ('apps/api/src/services/deadline.services.ts',
        "      line_effective_deadline(r.attempt, r.prior_sitting_series_id, r.board_series_id, r.declaration_rejected) as at,",
        "      line_effective_deadline(r.attempt, r.prior_sitting_series_id, r.board_series_id) as at, -- CONTROL: the flag not passed",
        ['test/08o-reservation-lines.test.ts'], 'a rejected declaration is a first entry'),
    'flag-line-deadline-sql': ('apps/api/src/services/deadline.services.ts',
        "${alias}.board_series_id, ${alias}.declaration_rejected)`);",
        "${alias}.board_series_id)`); // CONTROL: the flag not passed",
        ['test/08o-reservation-lines.test.ts'], 'a rejected declaration is a first entry'),
    'owing-provisional-desk': ('apps/api/src/services/desk.services.ts',
        "    r.status === 'pending_payment' && (!r.priceProvisional || payOnProvisional);\n",
        "    r.status === 'pending_payment' || payOnProvisional; // CONTROL: the provisional exclusion undone\n",
        ['test/08o-reservation-lines.test.ts'], 'the desk: reserve only'),
    'owing-provisional-home': ('apps/api/src/services/home.services.ts',
        "r.status === 'pending_payment' && (!r.priceProvisional || payOnProvisional));",
        "r.status === 'pending_payment' || payOnProvisional); // CONTROL: the provisional exclusion undone",
        ['test/08o-reservation-lines.test.ts'], 'the desk: reserve only'),
}


def run(name):
    path, old, new, tests, expect_fail = CONTROLS[name]
    # One file (old/new a string or aligned lists), or several: path a list, old/new aligned lists.
    edits = list(zip(path, old, new)) if isinstance(path, list) else (
        [(path, o, n) for o, n in zip(old, new)] if isinstance(old, list) else [(path, old, new)])
    originals = {}
    for pth, o, nw in edits:
        full = os.path.join(WT, pth)
        if full not in originals:
            originals[full] = open(full).read()
        cur = open(full).read()
        assert cur.count(o) == 1, f'{name}: anchor found {cur.count(o)} times in {pth}'
        open(full, 'w').write(cur.replace(o, nw))
    log = f'{EV}/control-{name}.log'
    try:
        r = subprocess.run(['pnpm', '--filter', '@repo/api', 'exec', 'vitest', 'run', *tests], cwd=WT,
                           env=dict(os.environ, TEST_DB_NAME='igcse_rwb_test'), capture_output=True, text=True)
        out = r.stdout + r.stderr
        open(log, 'w').write(out)
    finally:
        for full, src in originals.items():
            open(full, 'w').write(src)
    failed = [l.strip() for l in out.splitlines() if l.strip().startswith('×')]
    summary = [l.strip() for l in out.splitlines() if 'Tests ' in l and ('passed' in l or 'failed' in l)]
    at = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    print(f'{at} {name}: exit {r.returncode}; {summary[-1] if summary else "?"}')
    for f in failed:
        print('   ', f[:200])
    return r.returncode != 0

names = sys.argv[1:] or list(CONTROLS)
for n in names:
    run(n)
