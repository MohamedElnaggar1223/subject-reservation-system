#!/usr/bin/env python3
"""F4 negative controls on the reservations rework's model: undo one guard, run the tests that
prove it, expect them red, restore the file (always).

Usage: python3 .audit/exams-evidence/rework/controls.py [C1 C2 ...]   (default: all)
Each control's log is .audit/exams-evidence/rework/controls/<id>.log, kept as its proof under the
300 KB rule (CLAUDE.md, Git): the vitest summary and the failing tests with their messages — not
the request log of the run. The summary line per control is printed.
"""
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
LOGS = os.path.join(ROOT, '.audit', 'exams-evidence', 'rework', 'controls')
os.makedirs(LOGS, exist_ok=True)

S = 'apps/api/src/services/'
R = 'apps/api/src/routes/'
X1, X2, X3, X4, O5, I9 = (f'test/{n}' for n in [
    '08x1-exam-entries.test.ts', '08x2-exam-days-results.test.ts', '08x3-exam-races.test.ts',
    '08x4-exam-entries-rework.test.ts', '05-object-access.test.ts', '09-money-invariants.test.ts'])
E = S + 'exam-entry.services.ts'

CONTROLS = [
    # ─── F4's guards as built in September, re-run on the new model ───────────
    ('C1', 'the hard stop on an entry made by hand (its own deadline) removed',
     [(E, "    if (passed(deadline)) throw new ExamError(entryStopSentence(series.name, deadline), 409);\n", '')],
     [X1, I9], ['past the deadline a new entry is refused', 'F4: no entry was made, or sent to the board, after its own deadline']),
    ('C1b', "derivation's per-line cut-off removed (a line past its deadline entered)",
     [(E, "    if (passed(d)) {\n      rows.push({ ...base, outcome: entries.every((e) => e.state === 'exists') ? 'entered' : 'past_deadline', note: entryStopSentence(series.name, d), entries });\n      continue;\n    }\n", '')],
     [X4], ['a first entry is not sent']),
    ('C2', 'the hard stop on sending a draft (its own deadline) removed',
     [(E, "    if (late) throw new ExamError(entryStopSentence(seriesById.get(late.boardSeriesId)!.name, deadlines.get(late.id)!), 409);\n", '')],
     [X1, X4], ['past the deadline a new entry is refused', 'a first entry is not sent']),
    ('C3', 'the national ID read opened to all staff (route and service)',
     [(R + 'exam-entry.routes.ts', ".get('/candidates/:studentId/identity', requireAcademic(),", ".get('/candidates/:studentId/identity', requireStaff(),"),
      (S + 'exam-candidate.services.ts', "  if (!hasRole(viewer.role, ...ACADEMIC_ROLES)) throw new ExamError('Forbidden', 403);\n  await studentOrThrow(studentId);\n  const [ident]", "  await studentOrThrow(studentId);\n  const [ident]")],
     [X1], ['are read only by the coordinator and the admin']),
    ('C4', "the national ID write lets the driver's error through (it carries the number)",
     [(S + 'exam-candidate.services.ts', "    if (err instanceof ExamError) throw err;\n    if (isUniqueViolation(err)) throw new ExamError('This document number is already recorded for another candidate — check it against the document', 409);\n    throw new ExamError('The ID document could not be saved', 400);", "    throw err;")],
     [X1], ['are read only by the coordinator and the admin']),
    ('C5', 'the forecast teacher check (teacherOf) removed',
     [(E, "      if (!t || t.userId !== actor.id) throw new ExamError('Only the candidate\\'s teacher for this subject, or the coordinator, gives this forecast', 403);\n", '')],
     [X1, X4, O5], ['flags a missing forecast grade', "the P1 teacher gives P1's, not P2's", 'F4 exam entries']),
    ('C6', "the entry list's missing-forecast flag removed",
     [(E, "    if (r.forecastRequired && !e.forecastGrade && !(selfStudy && selfStudySetting === 'not_required')) out.push('missing_forecast');\n", '')],
     [X1], ['flags a missing forecast grade']),
    ('C7', 'clash detection removed',
     [(S + 'exam-timetable.services.ts', "      if (minutes(a.startTime) < minutes(b.endTime) && minutes(b.startTime) < minutes(a.endTime)) out.push([a, b]);\n", '')],
     [X2], ['a clash across boards flagged']),
    ('C8', "the database's one-candidate-per-seat index removed (0050)",
     [('packages/db/drizzle/0050_exam_entries.sql', 'CREATE UNIQUE INDEX "examSeat_seat_idx" ON "exam_seat" USING btree ("exam_date","session","room_id","seat_label");--> statement-breakpoint\n', '')],
     [X2, X3], ['no seat holds two candidates', 'the same free seat at once']),
    ('C9', "the certificate hand-over's status guard removed",
     [(S + 'exam-certificate.services.ts', "    }).where(and(eq(examCertificate.id, id), eq(examCertificate.status, 'received'))).returning();", "    }).where(eq(examCertificate.id, id)).returning();")],
     [X3, X2], ['a certificate collected at two desks at once', 'collected once at the desk']),
    ('C10', 'results import: every line new (the latest report not compared)',
     [(S + 'exam-result.services.ts', "      outcome: !prev ? 'new' as const : same ? 'unchanged' as const : 'revised' as const,", "      outcome: 'new' as const,")],
     [X2], ['every attempt kept']),
    ('C11', "derivation's lock and conflict guard removed",
     [(E, "    await advisoryLock(tx, `exam:derive:${series.id}`);\n", ''),
      (E, "? await tx.insert(examEntry).values(values).onConflictDoNothing().returning({ id: examEntry.id })", "? await tx.insert(examEntry).values(values).returning({ id: examEntry.id })")],
     [X3], ['derive the same series at once']),
    ('C12', "candidate numbering's lock removed",
     [(S + 'exam-candidate.services.ts', "    await advisoryLock(tx, `exam:numbers:${series.id}`);\n", '')],
     [X3], ['number the same series at once']),
    ('C13', "an entry's row lock removed (withdraw and amend)",
     [(E, "  const [e] = await tx.select().from(examEntry).where(eq(examEntry.id, id)).for('update');", "  const [e] = await tx.select().from(examEntry).where(eq(examEntry.id, id));")],
     [X3], ['a withdrawal and an amendment of the same entry at once']),
    ('C14', 'a reminder sends its notices before its claim (outside the transaction)',
     [(S + 'exam-deadline.services.ts', "      try {\n        const claimed = await db.transaction(async (tx) => {", "      try {\n        if (staff.length) await db.insert(notification).values(staff.map((userId) => ({ id: randomUUID(), userId, type: 'EXAM_DEADLINE_REMINDER', title, body, data: { boardSeriesId: s.id, field, date, url: '/exams/deadlines' } })));\n        const claimed = await db.transaction(async (tx) => {")],
     [X3], ['send each deadline reminder once', 'leaves no claim and no notice behind']),
    ('C15', "a parent's link to the child not checked (family endpoints)",
     [(S + 'exam-shared.ts', "    if (!link) throw new ExamError('Student not found', 404);\n", '')],
     [O5], ['F4 exam entries']),
    ('C16', "a teacher's register not limited to the room they invigilate",
     [(S + 'exam-day.services.ts', "  if (hasRole(actor.role, ...ACADEMIC_ROLES)) return roomId ? [roomId] : 'all';", "  return roomId ? [roomId] : 'all';")],
     [X2, O5], ['a teacher keeps only the register of their own room', 'F4 exam entries']),
    ('C17', "the entry list sorted by a column Cambridge's list does not have",
     [(E, "x.entryCode.localeCompare(y.entryCode)", "x.values.entryCode!.localeCompare(y.values.entryCode!)")],
     [X1], ['a candidate with two entries in a Cambridge series lists both']),
    # ─── The guards of the reservations rework's F4 (RESERVATIONS_REWORK.md §9, §10) ───
    ('C18', "lineItemsFor reads the subject row's units, not the line's item",
     [(S + 'line.services.ts', "    r.entersKind === 'units' ? r.itemUnitIds\n", "    r.entersKind === 'units' ? r.subjectUnitIds\n")],
     [X4], ['two items of one subject are two lines']),
    ('C19', "a retake not read from the line's attempt",
     [(E, "    if (it.attempt === 'retake') for (const p of planned) Object.assign(p, { isRetake: true, retakeSource: 'registration' });\n", '')],
     [X4], ["a retake comes from the line's attempt"]),
    ('C19b', 'a rejected declaration not read as a first entry',
     [(S + 'line.services.ts', "      attempt: (r.declarationRejected ? 'first' : r.attempt) as Attempt,", "      attempt: r.attempt as Attempt,")],
     [X4], ["a retake comes from the line's attempt"]),
    ('C20', "carry forward ignores the verified sitting's previous centre and candidate number",
     [(E, "        centre: prior.previousCentre ? prior.previousCentre : here2?.centreNumber ?? centre.centreNumber,\n        number: prior.previousCentre ? prior.previousCandidateNumber : here2?.number ?? null,",
       "        centre: here2?.centreNumber ?? centre.centreNumber,\n        number: here2?.number ?? null,")],
     [X4], ['a sitting at another centre, verified with its centre and candidate number']),
    ('C20b', "carry forward not taken from the line's prior sitting (the suggest flow only)",
     [(E, "    const carries = !!prior && (it.item.needsPriorSeries || !!it.enters.option?.carryForward) && !it.declarationRejected;", "    const carries = false;")],
     [X4], ['a sitting at another centre, verified with its centre and candidate number', 'a sitting here, verified without another centre']),
    ('C21', 'a cash-in entered before it is paid (derivation)',
     [(E, "    if (c.status !== 'paid') {\n      rows.push({ ...base, outcome: 'awaiting_payment',", "    if (false) {\n      rows.push({ ...base, outcome: 'awaiting_payment',")],
     [X4], ['accepted but not paid']),
    ('C22', 'a cash-in entered by hand before it is paid',
     [(E, "      if (c.status !== 'paid') throw new ExamError(`Cash-in awaiting payment: ${c.description} is entered once it is paid`, 409);\n", '')],
     [X4], ['accepted but not paid']),
    ('C23', "refundFor's seam entrySentAt not wired to F4's mark as sent",
     [(S + 'refund.services.ts', "    const all = await sentEntriesOf(executor, l.id);\n", "    const all: Awaited<ReturnType<typeof sentEntriesOf>> = [];\n")],
     [X4], ['a two-unit line with one unit sent']),
    ('C24', "the board's results do not verify a declared sitting",
     [(S + 'exam-result.services.ts', "  const v = await verifyDeclaredSittingsFromResults(series, actor, ctx);\n", "  const v = { verified: [] as Awaited<ReturnType<typeof verifyDeclaredSittingsFromResults>>['verified'], failed: 0 };\n")],
     [X4], ["the board's results verify a declared sitting"]),
    ('C25', 'a held line (declared, unverified, hold) can be sent',
     [(E, "      if (held.length) {\n", "      if (false) {\n")],
     [X4], ['held when the school holds unverified sittings']),
    ('C26', "derivation reads the series' entry deadline, not the line's (the retake deadline ignored)",
     [(E, "    const d = lineDeadlines.get(reg.id) ?? { at: series.entryDeadline, kind: 'entry' as const };", "    const d = { at: series.entryDeadline, kind: 'entry' as const };")],
     [X4], ["a retake of the board's previous sitting is still entered and sent"]),
    ('C26b', "sending reads the series' entry deadline, not the line's",
     [(E, "    if (line) out.set(e.id, { at: line.at, kind: line.kind });\n    else if (c)", "    if (c)")],
     [X4], ["a retake of the board's previous sitting is still entered and sent"]),
    ('C27', "the desk's drop does not withdraw the line's entries (the seam withdrawEntry)",
     [(S + 'desk-drop.services.ts', "    withdrawn = await withdrawEntry(tx, registrationId, reason, staffId, ctx);\n", '')],
     [X4], ["the desk drops a paid line past its deadline"]),
    ('C28', 'teacherOf ignores the unit (the subject\'s teacher only)',
     [(S + 'enrolment.services.ts', "  const row = pickEnrolment(rows, unitId);\n", "  const row = pickEnrolment(rows, null);\n")],
     [X4], ["the P1 teacher gives P1's, not P2's"]),
    ('C29', "the database's one-live-entry-per-cash-in index removed (0050)",
     [('packages/db/drizzle/0050_exam_entries.sql', 'CREATE UNIQUE INDEX "examEntry_one_live_charge_idx" ON "exam_entry" USING btree ("charge_id") WHERE status <> \'withdrawn\' AND charge_id IS NOT NULL;--> statement-breakpoint\n', '')],
     [X4], ['a cash-in that names no line']),
    ('C30', "the carry-forward period not written to the board's own column",
     [(E, "    if (carryForwardMonths !== undefined) {\n      await tx.update(examBoard)", "    if (false) {\n      await tx.update(examBoard)")],
     [X4], ["the carry-forward period is the board's own column"]),
    ('C31', 'a held line derived anyway (no "held" outcome)',
     [(E, "    if (prior?.declared && !prior.outcome && verification === 'hold') {", "    if (false) {")],
     [X4], ['held when the school holds unverified sittings']),
    ('C32', 'the entry check does not list a declared, unverified sitting',
     [(E, "    if (e.registrationId && reg?.declaredUnverified) out.push(verification === 'hold' ? 'prior_sitting_held' : 'prior_sitting_unverified');\n", '')],
     [X4], ['entered as declared (the default)', 'held when the school holds unverified sittings']),
    ('C33', 'the entry check does not flag a cash-in no longer paid',
     [(E, "    if (e.chargeId && chargeById.get(e.chargeId)?.status !== 'paid') out.push('cash_in_not_paid');\n", '')],
     [X4], ['a cash-in whose payment is reversed is flagged']),
    # ─── The review of 093dbd1 (8 Oct): every path that ends a paid line, and what follows ───
    ('C34', '"mark as sent" sends a draft whose line is no longer confirmed or whose cash-in is not paid',
     [(E, "    if (unpaid) {\n", "    if (false) {\n")],
     [X4], ['refuses an entry whose line is no longer confirmed', 'reversed, it is flagged and not sent']),
    ('C35', "the family's direct drop leaves the line's entries live",
     [(S + 'swap.services.ts', "    withdrawn = await withdrawEntriesOfLineInTx(tx, registrationId, 'the family dropped the subject', parentId, auditCtx);\n", '')],
     [X4], ['a two-unit line with one unit sent', 'the same line with none sent', "the family's direct drop"]),
    ('C36', "a change request's approval leaves the line's entries live",
     [(S + 'swap.services.ts', "    withdrawn = await withdrawEntriesOfLineInTx(tx, cr.registrationId, cr.type === 'drop' ? 'the family dropped the subject' : 'the family swapped the subject', parentId, auditCtx);\n", '')],
     [X4], ['a drop request the parent approves', 'a swap request the parent approves', "a drop request's approval"]),
    ('C37', "the family's direct swap leaves the old line's entries live",
     [(S + 'swap.services.ts', "    withdrawn = await withdrawEntriesOfLineInTx(tx, registrationId, 'the family swapped the subject', parentId, auditCtx);\n", '')],
     [X4], ["the old line's sent entry is withdrawn with it", "the family's direct swap"]),
    ('C38', "a payment reversal leaves the reverted lines' entries live",
     [(S + 'payment.services.ts', "        withdrawnEntries.push(...await withdrawEntriesOfLineInTx(tx, r.id, `the payment was reversed: ${reason}`, financeAdminId, auditCtx));\n", '')],
     [X4], ['a payment reversal']),
    ('C39', "step B's rejection after the first-entry deadline leaves the dropped line's entries live",
     [(S + 'verification.services.ts', "    withdrawn = await withdrawEntriesOfLineInTx(tx, registrationId, 'the declared sitting was not confirmed after the first-entry deadline', actor.id, ctx);\n", '')],
     [X4], ['a declared retake rejected past the first-entry deadline']),
    ('C40', "step B's hold drop leaves the dropped line's entries live",
     [(S + 'verification.services.ts', "        const entries = await withdrawEntriesOfLineInTx(tx, id, 'the declared sitting was not verified by its deadline (the school holds such lines)', null);\n",
       "        const entries: Awaited<ReturnType<typeof withdrawEntriesOfLineInTx>> = [];\n")],
     [X4], ['the school turns hold on, the deadline passes']),
    ('C41', 'an entry withdrawn with its line is never made again (read as withdrawn by the coordinator)',
     [(E, "  const withdrawn = inSeries.filter((e) => e.status === 'withdrawn' && !e.withdrawnWithLine);", "  const withdrawn = inSeries.filter((e) => e.status === 'withdrawn');")],
     [X4], ['paid again, the next derivation makes it again']),
    ('C42', "the family's direct drop priced before the line is locked",
     [(S + 'swap.services.ts', "  const { result, quote } = await db.transaction(async (tx) => {", "  const early = await refundFor(db, registrationId, now);\n  const { result, quote } = await db.transaction(async (tx) => {"),
      (S + 'swap.services.ts', "    // V3 §6.12: the refund locks at drop time (refundFor, §3.9).\n    const quote = await refundFor(tx, registrationId, now);", "    const quote = early;")],
     [X4], ["the family's direct drop"]),
    ('C43', "a drop request's approval priced before the line is locked",
     [(S + 'swap.services.ts', "  let quote = null as Awaited<ReturnType<typeof refundFor>> | null;\n  let withdrawn: Awaited<ReturnType<typeof withdrawEntriesOfLineInTx>> = [];\n  const result = await db.transaction(async (tx) => {\n    // A swap registers",
       "  let quote = null as Awaited<ReturnType<typeof refundFor>> | null;\n  const early = await refundFor(db, cr.registrationId, now);\n  let withdrawn: Awaited<ReturnType<typeof withdrawEntriesOfLineInTx>> = [];\n  const result = await db.transaction(async (tx) => {\n    // A swap registers"),
      (S + 'swap.services.ts', "    quote = await refundFor(tx, cr.registrationId, now);", "    quote = early;")],
     [X4], ["a drop request's approval"]),
    ('C44', "the family's direct swap priced before the old line is locked",
     [(S + 'swap.services.ts', "  let quote = null as Awaited<ReturnType<typeof refundFor>> | null;\n  const result = await db.transaction(async (tx) => {\n    // Asked again with the student and window held",
       "  let quote = null as Awaited<ReturnType<typeof refundFor>> | null;\n  const early = await refundFor(db, registrationId, now);\n  const result = await db.transaction(async (tx) => {\n    // Asked again with the student and window held"),
      (S + 'swap.services.ts', "    quote = await refundFor(tx, registrationId, now);", "    quote = early;")],
     [X4], ["the family's direct swap"]),
    ('C45', "the entry check does not compare an entry with its line's answer now",
     [(E, "      if (d.retake) out.push('retake_differs_from_line');\n      if (d.carry) out.push('carry_forward_differs_from_line');\n", '')],
     [X4], ['a retake rejected after its entry was sent', 'verified at another centre after derivation', 'rejected after derivation: the draft loses']),
    ('C46', "a derivation does not bring a draft up to date with its line's answer",
     [(E, "      if (d.any) { state = 'refresh'; patch = d.patch; }\n", '')],
     [X4], ['a retake rejected after its draft was made', 'verified at another centre after derivation', 'verified here after derivation', 'rejected after derivation: the draft loses']),
    ('C47', "a declared sitting's carry forward written as confirmed before it is verified",
     [(E, "        state: prior.declared && prior.outcome !== 'verified' ? 'suggested' : 'confirmed', month: prior.month, year: prior.year,",
       "        state: 'confirmed', month: prior.month, year: prior.year,")],
     [X4], ['a carry forward declared and not verified is derived as suggested']),
    ('C48', 'a declared sitting the results on record show is not verified at declaration',
     [(S + 'reservation.services.ts', "  if (declared.length) await verifyDeclaredAtDeclarationInTx(tx, declared);\n", '')],
     [X4], ['is verified at once, by the importer']),
    ('C49', "the To verify tab's check verifies nothing",
     [(S + 'exam-result.services.ts', "  const r = await verifyMatches(open.map((x) => x.id), actor, 'results on record, from the To verify tab', ctx);",
       "  const r = await verifyMatches([], actor, 'results on record, from the To verify tab', ctx);")],
     [X4], ["the To verify tab's check answers it later"]),
    ('C50', 'any grade verifies a sitting (absent and pending too)',
     [(S + 'exam-result.services.ts', "    if (!hit || !isRealGrade(hit.grade)) continue;", "    if (!hit) continue;")],
     [X4], ['absent and pending verify nothing', 'a sitting graded absent waits']),
    ('C51', 'a verification failing after the import commits fails the import',
     [(S + 'exam-result.services.ts', "      if (err instanceof VerificationError && err.status === 409) continue;\n      failed++;", "      throw err;")],
     [X4], ['reads as results saved']),
    ('C52', 'a sitting verified at declaration is answered by someone other than the importer',
     [(S + 'exam-result.services.ts', "      actorId: m.importedBy, now: new Date(),", "      actorId: m.studentId, now: new Date(),")],
     [X4], ['is verified at once, by the importer']),
    ('C53', "step B's hold sweep counts every line's board fee not sent",
     [(S + 'verification.services.ts', "        const refund = await refundFor(tx, id, now, { neverSent: sent.length === 0 });", "        const refund = await refundFor(tx, id, now, { neverSent: true });")],
     [X4], ['the school turns hold on, the deadline passes']),
    ('C54', "a paid cash-in whose award is already entered is not linked to it",
     [(E, "    if (owner.chargeId && found && !found.chargeId) state = 'link';\n", '')],
     [X4], ['a whole-award line already entered is linked to that entry', 'entered by hand without it, is linked to that entry']),
    ('C55', "a retake the history also shows keeps the source 'history' though the line says retake",
     [(E, "    if (it.attempt === 'retake') for (const p of planned) Object.assign(p, { isRetake: true, retakeSource: 'registration' });",
       "    if (it.attempt === 'retake') for (const p of planned) if (!p.isRetake) Object.assign(p, { isRetake: true, retakeSource: 'registration' });")],
     [X4], ['is verified at once, by the importer']),
]

KEEP = re.compile(r'(FAIL|×|✓ test/|Test Files|Tests |AssertionError|Error:|expected|Expected|Received|^\s*[-+] |❯ test/)')


def trimmed(log: str) -> str:
    """The run's proof: the summary, and the failing tests with their messages (no request log)."""
    out, keep = [], False
    for line in log.splitlines():
        if 'Failed Tests' in line or 'Failed Suites' in line:
            keep = True
        if keep or KEEP.search(line):
            out.append(line)
    text = '\n'.join(out)
    return text[:120_000]


def run(control):
    cid, what, edits, files, expect = control
    originals = {}
    try:
        for path, old, new in edits:
            full = os.path.join(ROOT, path)
            current = open(full).read()
            originals.setdefault(full, current)
            if current.count(old) != 1:
                raise SystemExit(f'{cid}: the guard text is not found exactly once in {path}')
            open(full, 'w').write(current.replace(old, new, 1))
        env = dict(os.environ, TEST_DB_NAME='igcse_exams_test')
        out = subprocess.run(['pnpm', '--filter', '@repo/api', 'exec', 'vitest', 'run', *files], cwd=ROOT, env=env, capture_output=True, text=True)
        log = out.stdout + out.stderr
        fails = [l for l in log.splitlines() if l.strip().startswith('FAIL') or ' FAIL ' in l or l.strip().startswith('×')]
        red = [e for e in expect if any(e in f for f in fails)]
        ok = out.returncode != 0 and len(red) == len(expect)
        open(os.path.join(LOGS, f'{cid}.log'), 'w').write(f'# {cid}: {what}\n# undone in: {", ".join(sorted(set(p for p, _, _ in edits)))}\n# ran: {" ".join(files)}\n# expected red: {expect}\n# result: {"RED as expected" if ok else "NOT RED"}\n\n' + trimmed(log) + '\n')
        return cid, what, ok, red, fails
    finally:
        for full, text in originals.items():
            open(full, 'w').write(text)


if __name__ == '__main__':
    wanted = set(sys.argv[1:])
    for c in CONTROLS:
        if wanted and c[0] not in wanted:
            continue
        cid, what, ok, red, fails = run(c)
        print(f"{cid}\t{'RED as expected' if ok else 'NOT RED'}\t{what}\tfailed: {'; '.join(sorted(set(re.sub(r'^.*> ', '', f.strip()) for f in fails)))[:400]}")
        sys.stdout.flush()
