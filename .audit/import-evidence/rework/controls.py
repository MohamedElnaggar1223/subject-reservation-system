"""F7 on the reworked model: negative controls. Each guard is undone once, the tests that prove it
are run (red expected), and the source is restored. Usage: python3 controls.py [C26 C27 ...]

Each log keeps the run's proof only (CLAUDE.md, the evidence rule): the failing tests with their
messages and the vitest summary — never the request log of the run."""
import os
import re
import subprocess
import sys

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
            "      w.problems.push({ code: 'fee_missing', severity: 'error', detail: err.message });", '      void err;', ['08n-import']),
    'C32': ('flag 1b on the new model: the shared refusal of an item with no fee row on every path (priceLine, A\'s)', P,
            '  if (missing.length) {', '  if (false && missing.length) {', ['03-v3', '08n-import']),
    'C33': ('s9: a provisional fee row prices the line provisional at its amount, never 0 (priceLine reads provisional rows)', P,
            "  const boardFeeBase = round2(fee.rows.reduce((s, r) => s + r.amount, 0));\n  const boardPercent = input.mode === 'self_study'",
            "  const boardFeeBase = round2(fee.rows.filter((r) => !r.provisional).reduce((s, r) => s + r.amount, 0));\n  const boardPercent = input.mode === 'self_study'", ['08n-import']),
    'C34': ('s9: the sheet\'s confirmation is the line\'s consent on the imported channel', C,
            "  await writeConsents(tx, inserted.map((i) => i.id), { channel: 'imported', confirmedBy: actor.id, at: now });",
            "  await writeConsents(tx, inserted.map((i) => i.id), { channel: 'desk', confirmedBy: actor.id, at: now });", ['08n-import']),
    'C35': ('s9: a line with no confirmation on the sheet is an error (consent_missing)', V,
            "    if (d.confirm !== 'confirm') w.problems.push({ code: 'consent_missing'", "    if (false) w.problems.push({ code: 'consent_missing'", ['08n-import']),
    'C36': ('the lead\'s Q2: a sitting from the student\'s history is the legacy source', V,
            "      attempt = 'retake'; prior = { month: legacy.type, year: legacy.year, source: 'legacy', from: 'history' };",
            "      attempt = 'retake'; prior = { month: legacy.type, year: legacy.year, source: 'declared_by_desk', from: 'history' };", ['08n-import']),
    'C37': ('the lead\'s Q2: a retake that names no sitting is an error (retake_sitting_missing)', V,
            "        w.problems.push({ code: 'retake_sitting_missing', severity: 'error',", "        void ({ code: 'retake_sitting_missing', severity: 'error',", ['08n-import']),
    'C38': ('the lead\'s addition: self-study on a first entry of a taught item is an error, never priced at the share silently', V,
            "        w.problems.push({ code: 'self_study_on_taught', severity: 'error', detail: 'Self-study on a first entry needs the exception",
            "        w.problems.push({ code: 'self_study_on_taught', severity: 'info', detail: 'Self-study on a first entry needs the exception", ['08n-import']),
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
    if src.count(old) != 1:
        print(f'{name}\tSKIP\tpattern found {src.count(old)} times in {rel}')
        return
    open(path, 'w').write(src.replace(old, new, 1))
    try:
        env = dict(os.environ, TEST_DB_NAME='igcse_import_ctl_test')
        out = subprocess.run(['pnpm', 'test', '--', *files], cwd=API, env=env, capture_output=True, text=True)
        log = out.stdout + out.stderr
        open(f'{OUT}/control-{name}.log', 'w').write(f'# {name}: {desc}\n# undone in apps/api/{rel}\n' + trim(log))
        failed = [l.strip() for l in log.splitlines() if l.strip().startswith('× ')]
        summary = [l.strip() for l in log.splitlines() if l.strip().startswith('Tests ')]
        verdict = 'RED' if out.returncode != 0 else 'GREEN'
        print(f'{name}\t{verdict}\t{desc}\t{summary[-1] if summary else ""}\t{failed[0][:200] if failed else ""}', flush=True)
    finally:
        open(path, 'w').write(src)


for n in sys.argv[1:] or list(CONTROLS):
    run(n)
