"""F7 on the reworked model: negative controls. Each guard is undone once, the tests that prove it
are run (red expected), and the source is restored. Usage: python3 controls.py [C26 C27 ...]

Each log keeps the run's proof only (CLAUDE.md, the evidence rule): the failing tests with their
messages and the vitest summary — never the request log of the run."""
import os
import re
import subprocess
import sys
import time

ROOT = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/agent-acf43230a4e06e8b4'
API = ROOT + '/apps/api'
OUT = ROOT + '/.audit/import-evidence/rework'

V = 'src/services/import/view.ts'
C = 'src/services/import/commit.ts'
S = 'src/services/import.services.ts'
N = 'src/services/import/normalise.ts'
P = 'src/services/pricing.services.ts'
O = 'src/services/offer.services.ts'

CONTROLS = {
    # Review flag 3
    'C26': ('flag 3: a line\'s fixes and decision carried from earlier files whatever their bytes (by what the line says)', S,
            'const all = await tx.select().from(importRow).where(inArray(importRow.batchId, earlier.map((b) => b.id)))',
            'const all = await tx.select().from(importRow).where(inArray(importRow.batchId, earlier.filter((b) => b.fileHash === fileHash).map((b) => b.id)))', ['08n-import']),
    'C27': ('flag 3: a person\'s decisions carried by email from every earlier file', S,
            'const people = await tx.select().from(importPerson).where(inArray(importPerson.batchId, earlier.map((b) => b.id)));',
            'const people = await tx.select().from(importPerson).where(inArray(importPerson.batchId, earlier.filter((b) => b.fileHash === fileHash).map((b) => b.id)));', ['08n-import']),
    'C28': ('flag 3: a possible duplicate of an account already in the system holds its family (duplicate_account)', V,
            '      if (p.possibleAccounts.length) {', '      if (false) {', ['08n-import']),
    'C29': ('flag 3: the money-record fingerprint without the line\'s position', V,
            '    out.set(id, `${base}|${n}`);', '    out.set(id, `${base}|${n}|${id}`);', ['08n-import']),
    # Review flag 7
    'C30': ('flag 7: a self-study note against an explicit "No" is flagged (self_study_contradiction)', N,
            '  if (edits.selfStudy === undefined && answeredNo && noteSaysSelf) local.push(', '  if (false) local.push(', ['08n-import']),
    # RESERVATIONS_REWORK.md s9's F7 list
    'C31': ('s9: the review refuses a line whose item has no fee row, naming the grid (fee_missing)', V,
            "      pushOnce(w, { code: 'fee_missing', severity: 'error', detail: err.message });", '      void err;', ['08n-import']),
    'C32': ('flag 1b on the new model: the shared refusal of an item with no fee row on every path (priceLine, A\'s)', P,
            '  if (missing.length) {', '  if (false && missing.length) {', ['03-v3', '08n-import']),
    'C33': ('s9: a provisional fee row prices the line provisional at its amount, never 0 (priceLine reads provisional rows)', P,
            "  const boardFeeBase = round2(fee.rows.reduce((s, r) => s + r.amount, 0));\n  const boardPercent = input.mode === 'self_study'",
            "  const boardFeeBase = round2(fee.rows.filter((r) => !r.provisional).reduce((s, r) => s + r.amount, 0));\n  const boardPercent = input.mode === 'self_study'", ['08n-import']),
    'C34': ('s9: the sheet\'s confirmation is the line\'s consent on the imported channel', C,
            "  await writeConsents(tx, inserted.map((i) => i.id), { channel: 'imported', confirmedBy: actor.id, at: now });",
            "  await writeConsents(tx, inserted.map((i) => i.id), { channel: 'desk', confirmedBy: actor.id, at: now });", ['08n-import']),
    'C35': ('s9: a line with no confirmation on the sheet is an error (consent_missing)', V,
            "    if (d.confirm !== 'confirm') pushOnce(w, { code: 'consent_missing'", "    if (false) pushOnce(w, { code: 'consent_missing'", ['08n-import']),
    'C36': ('the lead\'s Q2: a sitting from the student\'s history is the legacy source', V,
            "    const legacyPrior = legacy ? { month: legacy.type, year: legacy.year, source: 'legacy' as const, from: 'history' as const } : null;",
            "    const legacyPrior = legacy ? { month: legacy.type, year: legacy.year, source: 'declared_by_desk' as const, from: 'history' as const } : null;", ['08n-import']),
    'C37': ('the lead\'s Q2: a retake that names no sitting is an error (retake_sitting_missing)', V,
            "        pushOnce(w, { code: 'retake_sitting_missing', severity: 'error',", "        void ({ code: 'retake_sitting_missing', severity: 'error',", ['08n-import']),
    'C38': ('the lead\'s addition: self-study on a first entry of a taught item is an error, never priced at the share silently', V,
            "        pushOnce(w, { code: 'self_study_on_taught', severity: 'error', detail: 'Self-study on a first entry needs the exception",
            "        pushOnce(w, { code: 'self_study_on_taught', severity: 'info', detail: 'Self-study on a first entry needs the exception", ['08n-import']),
    'C39': ('the student\'s gate.selfStudyFirstEntry exception lets a first entry in self-study through', V,
            '      } else if (await selfStudyException(sid, t)) {', '      } else if (false) {', ['08n-import']),
    'C40': ('the interim rule (MO-25): history is a sitting only if its series had ended when it was committed', V,
            '      && seriesEndedBy(h.sessionType, h.seriesYear, h.committedAt)).map((h) => ({ type: h.sessionType as Series[\'type\'], year: h.seriesYear })) : [];',
            ').map((h) => ({ type: h.sessionType as Series[\'type\'], year: h.seriesYear })) : [];', ['08n-import']),
    'C41': ('history is a sitting only before the item\'s series (the same series is the same sitting)', V,
            '!!t.month && t.year !== null && seriesOrder(s.type, s.year) < seriesOrder(t.month, t.year) && t.boardMonths.includes(s.type);',
            '!!t.month && t.year !== null && t.boardMonths.includes(s.type);', ['08n-import']),
    'C42': ('findOffer: a unit line finds the offer whose item enters the unit it names', O,
            '  if (!codes.length || !offers.length) return null;', '  if (true) return null;', ['08n-import']),
    'C43': ('the review asks the rules on lines as the commit will (assertLineRules, rolled back)', V,
            "    const checkable = g.rows.filter((w) => !w.problems.some((p) => p.severity === 'error') && w.plan.registration === 'live');",
            "    const checkable: Working[] = []; void g.rows;", ['08n-import']),
    'C44': ('the commit holds the student before its lines (assertMayRegisterForInTx), as every reservation path does (s6)', C,
            '  const eligibility = await assertMayRegisterForInTx(tx, studentId, sessionId);',
            "  const eligibility = await (await import('../eligibility.services')).mayRegisterFor(studentId, sessionId, tx);", ['08n-import']),
    'C45': ('reserving lines in a session is the admin\'s (the commit\'s 403)', C,
            "    if (actor.role !== 'admin' && view.rows.some((r) => readyRows.has(r.id) && r.plan.registration === 'live')) {",
            '    if (false) {', ['08n-import']),
    # The review of 8 Oct (items 1 to 7)
    'C46': ('item 1: on an item that needs a prior series, a legacy or noted sitting is the carried sitting of a first entry unless the note or staff say retake', V,
            '    if (t.needsPriorSeries && !saysRetake) {', '    if (false) {', ['08n-import']),
    'C47': ('item 2: a row naming several units or papers is split, one item per code (findItemsByCode)', V,
            '    const parts = await findItemsByCode(db, f.offerId, label, { ...where, chosen: e.codeItems ?? null });',
            "    const parts = await findItemsByCode(db, f.offerId, '', { ...where, chosen: e.codeItems ?? null });", ['08n-import']),
    'C59': ('item 2: a "one paper" note is one line, never split by the papers the subject names (the early return since 2ca07a4\'s item 1)', V,
            '    if (d.noteOnePaper) {\n      return { targets: [], offerName: f.offerName, split: null, unclear: f.onePaper.length',
            '    if (false) {\n      return { targets: [], offerName: f.offerName, split: null, unclear: f.onePaper.length', ['08n-import']),
    'C48': ('item 2: the commit makes every line of a split row', C,
            '  const wanted = rows.flatMap((r) => r.plan.lines.map((l) => ({ r, l })));',
            '  const wanted = rows.flatMap((r) => r.plan.lines.slice(0, 1).map((l) => ({ r, l })));', ['08n-import']),
    'C49': ('item 2: findOffer takes the one offer entering any unit named when none enters them all (the code left for staff)', O,
            "  return pick(every.length ? every : covering(false), 'unit');", "  return pick(every, 'unit');", ['08n-import']),
    'C50': ('item 3: a dropped course in the file is not a sitting', V,
            "isHistory(w) && historyOutcome(w.d) === 'registered'", "isHistory(w) && historyOutcome(w.d) !== 'drop_intended'", ['08n-import']),
    'C51': ('item 3: a dropped course in the system\'s history is not a sitting', V,
            "subjectIds.includes(h.subjectId) && h.outcome === 'registered'", "subjectIds.includes(h.subjectId) && h.outcome !== 'drop_intended'", ['08n-import']),
    'C52': ('item 4: the September pattern "… is not open" deleted (it read A\'s "Registration window is not open")', '../web/lib/i18n-import.ts',
            "    [/^(.+) is no longer offered$/, (m) => `${m[1]} لم تعد متاحة`],",
            "    [/^(.+) is not open$/, (m) => `${m[1]} غير مفتوحة`],\n    [/^(.+) is no longer offered$/, (m) => `${m[1]} لم تعد متاحة`],", ['08n-import']),
    'C53': ('item 4: "Add …" translated only as the import\'s own aria-label ("Add X to the catalogue")', '../web/lib/i18n-import.ts',
            '    [/^Add (.+) to the catalogue$/, (m) => `أضف ${m[1]} إلى الدليل`],', '    [/^Add (.+)$/, (m) => `أضف ${m[1]}`],', ['08n-import']),
    'C54': ('item 5: every student with lines held FOR NO KEY UPDATE in id order before the first line (both lockStudents calls undone since 2ca07a4\'s item 3 added the early one)', C,
            ("  await lockStudents(tx, studentsHere.filter((p) => p.matched?.role === 'student').map((p) => p.matched!.id));",
             "  await lockStudents(tx, [...bySession.keys()].map((k) => k.split('|')[0]!));"),
            ('  void studentsHere;', '  void lockStudents;'), ['08n-import']),
    'C55': ('item 5: the review\'s dry run reads the exception rows without a lock (a GET holds none)', V,
            '[...accepted, rl], { lockExceptions: false });', '[...accepted, rl]);', ['08n-import']),
    'C56': ('item 6: an open offer with no course fee is refused at creation, naming the subject (MO-9)', O,
            '      assertCourseFeeFor(data.availability, data.courseFee, s.name, data.zeroFeeReason);', '      void assertCourseFeeFor;', ['08n-import']),
    'C57': ('item 6: opening an offer with no course fee, or setting it to 0 while open, is refused (MO-9)', O,
            '    if (data.courseFee !== undefined || data.availability !== undefined) {\n      assertCourseFeeFor(',
            '    if (false) {\n      assertCourseFeeFor(', ['08n-import']),
    'C58': ('item 7: findOffer\'s name fallback matches the row\'s level', O,
            "  const byName = pick(atLevel(offers.filter((o) => words(o.name) === t || words(o.code) === t)), 'name')",
            "  const byName = pick(offers.filter((o) => words(o.name) === t || words(o.code) === t), 'name')", ['08n-import']),
    # C44 is green since item 5: lockStudents holds every student before the first line, so the lock
    # assertMayRegisterForInTx takes is no longer the only one. Both undone, the race must be red.
    'C60': ('item 5 with C44: the student held before the lines by neither lockStudents (both calls) nor assertMayRegisterForInTx', C,
            ("  await lockStudents(tx, studentsHere.filter((p) => p.matched?.role === 'student').map((p) => p.matched!.id));",
             "  await lockStudents(tx, [...bySession.keys()].map((k) => k.split('|')[0]!));",
             '  const eligibility = await assertMayRegisterForInTx(tx, studentId, sessionId);'),
            ('  void studentsHere;', '  void lockStudents;',
             "  const eligibility = await (await import('../eligibility.services')).mayRegisterFor(studentId, sessionId, tx);"), ['08n-import']),
    # The review of 2ca07a4 (items 1 to 4)
    'C61': ('2ca07a4 item 1: a "one paper" note is never the whole subject (the one-paper item, else staff choose)', V,
            "        if (d.noteOnePaper && !(it.item && (it.item.kind === 'one_paper' || it.item.kind === 'unit'))) {",
            "        if (false && d.noteOnePaper && !(it.item && (it.item.kind === 'one_paper' || it.item.kind === 'unit'))) {", ['08n-import']),
    'C62': ('2ca07a4 item 2: a self-study-only offer at a course fee of 0 says why', O,
            '    if (!wasZeroSelfStudy && !zeroFeeReason?.trim()) {', '    if (false) {', ['08n-import']),
    'C63': ('2ca07a4 item 2: a self-study-only offer may be 0 (with its reason); open and retakes-only may not', O,
            "  if (availability === 'self_study_only') {", '  if (false) {', ['08n-import']),
    'C64': ('2ca07a4 item 2: a copy brings an offer it would open at 0 (not self-study only) across closed, named', O,
            "    const availability = taught !== 'closed' && taught !== 'self_study_only' && !(Number(o.courseFee) > 0) ? 'closed' : taught;",
            '    const availability = taught;', ['08n-import']),
    'C65': ('2ca07a4 item 3: the family\'s students held before any row that names a subject', C,
            "  await lockStudents(tx, studentsHere.filter((p) => p.matched?.role === 'student').map((p) => p.matched!.id));",
            '  void studentsHere;', ['08n-import']),
    'C66': ('2ca07a4 item 4: "The item for …" translated only as the import\'s own aria-label', '../web/lib/i18n-import.ts',
            "    [/^The session’s item for the sheet’s code (.+)$/, (m) => `بند الجلسة لرمز الجدول ${m[1]}`],",
            "    [/^The item for (.+)$/, (m) => `بند ${m[1]}`],", ['08n-import']),
    # The harness: a race's pause counts only its own database's wait (two suites side by side).
    'C67': ('the harness: pauseAtAudits().paused counts a wait in its own database only', '../api/test/helpers.ts',
            "\n        and database = (select oid from pg_database where datname = current_database())`, [keys.get(action)!]);",
            "`, [keys.get(action)!]);", ['00-harness']),
    # F7's earlier controls, run again on the new base (their guards unchanged)
    'C1': ('the commit claim (re-run on the new base)', C,
           "sql`(${importBatch.status} in ('staged', 'partial') or (${importBatch.status} = 'committing' and ${importBatch.commitStartedAt} < now() - make_interval(mins => ${STALE_CLAIM_MINUTES})))`",
           'sql`true`', ['08n-import']),
    'C4': ('the commit module may not touch a payment table (re-run on the new base)', C,
           '  registration, registrationSession, academicYear, sessionOffer, sessionOfferItem, boardSeries,\n',
           '  registration, registrationSession, academicYear, sessionOffer, sessionOfferItem, boardSeries, payment,\n', ['08n-import']),
    'C5': ('the coordinator may not map a series to a session (re-run on the new base)', S,
           "if (actor.role !== 'admin' && Object.values(patch.series ?? {}).some((s) => s.mode === 'window')) {", 'if (false) {', ['08n-import']),
    'C6': ('a new student\'s line faces the school-fee gate (re-run on the new base)', V,
           'if (!feeCache.has(eKey)) feeCache.set(eKey, await schoolFeeGateReason(sid ?? NEW_STUDENT, el));',
           'if (!feeCache.has(eKey)) feeCache.set(eKey, sid ? await schoolFeeGateReason(sid, el) : null);', ['08n-import']),
    'C9': ('two children under one email hold their family (re-run on the new base)', V,
           'if (!s.oneChild && s.email && firsts.length > 1 && (differentChild || sections.length > 1)) {', 'if (false) {', ['08n-import']),
    'C11': ('the family\'s rows re-read under the lock (re-run on the new base)', C,
            "  const todo = new Set(locked.filter((r) => r.status !== 'committed').map((r) => r.id));",
            '  const todo = new Set(locked.map((r) => r.id));', ['08n-import']),
    'C25': ('a new link to an existing account waits for staff (re-run on the new base)', V,
            "      if (link === 'create' && existing.length && !(w.r.edits as ImportRowEditsType | null)?.confirmLink) {", '      if (false) {', ['08n-import']),
}


ANSI = re.compile(r'\x1b\[[0-9;]*m')


def trim(log: str) -> str:
    lines = ANSI.sub('', log).splitlines()
    keep = [l for l in lines if l.strip().startswith(('✓ test', '× ', '❯ test', 'Test Files', 'Tests ', 'Duration'))]
    start = next((i for i, l in enumerate(lines) if 'Failed Tests' in l), None)
    end = next((i for i, l in enumerate(lines) if start is not None and i > start and l.strip().startswith('Test Files')), len(lines))
    failures = [l for l in lines[start:end] if not l.startswith(('stdout', 'stderr', '['))][:260] if start is not None else []
    return '\n'.join(['# summary', *keep, '', '# failures (messages)', *failures]) + '\n'


def run(name: str):
    desc, rel, old, new, files = CONTROLS[name]
    path = os.path.join(API, rel)
    src = open(path).read()
    # One replacement, or several in the same file (a tuple each).
    olds, news = (old, new) if isinstance(old, tuple) else ((old,), (new,))
    patched = src
    for o, n in zip(olds, news):
        if patched.count(o) != 1:
            print(f'{name}\tSKIP\tpattern found {patched.count(o)} times in {rel}')
            return
        patched = patched.replace(o, n, 1)
    open(path, 'w').write(patched)
    try:
        env = dict(os.environ, TEST_DB_NAME='igcse_import_ctl_test')
        out = subprocess.run(['pnpm', 'test', '--', *files], cwd=API, env=env, capture_output=True, text=True)
        log = out.stdout + out.stderr
        open(f'{OUT}/control-{name}.log', 'w').write(f'# {name}: {desc}\n# undone in apps/api/{rel}\n' + trim(log))
        failed = [l.strip() for l in log.splitlines() if l.strip().startswith('× ')]
        summary = [l.strip() for l in log.splitlines() if l.strip().startswith('Tests ')]
        verdict = 'RED' if out.returncode != 0 else 'GREEN'
        print(f'{name}\t{verdict}\t{desc}\t{summary[-1] if summary else ""}\t{failed[0][:200] if failed else ""}', flush=True)
        if ROW_FOR:
            first = (failed[0] if failed else '').replace('× F7: the day-one import > ', '').replace('× V3 flows > ', '03: ')[:220]
            args = ['python3', ROOT + '/scripts/trail-row.py', 'import', 'control', verdict.lower(),
                    '--decision', f'{name} undone ({desc}) on {ROW_FOR}: {" and ".join(files)} {verdict.lower()}, {summary[-1].strip() if summary else ""}; first failing: {first}; restored',
                    '--why', 'each guard shown red once with it undone (FEATURES_PLAN s5); one row per control at the time it finished (the review of 8 Oct, item 8)',
                    '--evidence', f'.audit/import-evidence/rework/control-{name}.log']
            for _ in range(3):
                r = subprocess.run(args, capture_output=True, text=True)
                if r.returncode == 0:
                    break
                time.sleep(1.1)  # two controls finishing in one second: the next second is its own time
            print(r.stdout.strip() or r.stderr.strip(), flush=True)
    finally:
        open(path, 'w').write(src)


# --row <commit>: write each control's trail row as it finishes, naming the code it ran on.
ROW_FOR = None
argv = sys.argv[1:]
if '--row' in argv:
    ROW_FOR = argv[argv.index('--row') + 1]
    argv = [a for i, a in enumerate(argv) if a != '--row' and (i == 0 or argv[i - 1] != '--row')]
for n in argv or list(CONTROLS):
    run(n)
