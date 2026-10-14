"""F6a's controls: each guard undone once, 08u run, its failures kept, the guard put back and 08u run green.

Usage: python3 controls.py [name ...]   (default: all). Logs: /tmp/sw/controls/<name>.log (the vitest
summary and the failing tests with their messages only).
"""
import os, re, subprocess, sys
WT = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/session-words'
API = f'{WT}/apps/api'
OUT = '/tmp/sw/controls'
os.makedirs(OUT, exist_ok=True)

CONTROLS = {
    'one-paper-rule': ('apps/api/src/services/line-rules.services.ts',
        "    if (!recheck && it.kind === 'one_paper' && l.attempt === 'first') {",
        "    if (false && !recheck && it.kind === 'one_paper' && l.attempt === 'first') {"),
    'one-paper-read': ('apps/api/src/services/offers-read.services.ts',
        "      const firstEntries = !c.retakeOnly && i.kind !== 'one_paper';",
        "      const firstEntries = !c.retakeOnly;"),
    'lines-stand-subject': ('apps/api/src/services/offer.services.ts',
        "        if (change.availability === 'closed' && reserved > 0 && !form.linesStand) throw new OfferError(linesStandRefusal(subjectRow.name, reserved), 409);",
        "        if (false && change.availability === 'closed' && reserved > 0 && !form.linesStand) throw new OfferError(linesStandRefusal(subjectRow.name, reserved), 409);"),
    'lines-stand-paper': ('apps/api/src/services/offer.services.ts',
        "        if (data.availability === 'closed' && (live.get(item.id) ?? 0) > 0 && !form.linesStand) {",
        "        if (false && data.availability === 'closed' && (live.get(item.id) ?? 0) > 0 && !form.linesStand) {"),
    'idempotent': ('apps/api/src/services/offer.services.ts',
        "      if (Object.keys(change).length) {\n        // \"Not offered this cycle\" while it has reservations: said, not silent.",
        "      if (true) {\n        // \"Not offered this cycle\" while it has reservations: said, not silent."),
    'audit-in-transaction': ('apps/api/src/services/offer.services.ts',
        "    { ...fields, teachers: teachers.map((t) => t.teacherId), reason: reason ?? null, ...(zeroFeeReason ? { zeroFeeReason } : {}) }, ctx, tx);",
        "    { ...fields, teachers: teachers.map((t) => t.teacherId), reason: reason ?? null, ...(zeroFeeReason ? { zeroFeeReason } : {}) }, ctx);"),
    'line-audit-per-move': ('apps/api/src/services/offer.services.ts',
        "  await logActions(lines.map((l) => ({\n    userId: actorId, action: 'LINE_SERIES_MOVED' as const,",
        "  if (false) await logActions(lines.map((l) => ({\n    userId: actorId, action: 'LINE_SERIES_MOVED' as const,"),
    'preview-role-gate': ('apps/api/src/routes/registration.routes.ts',
        "  .get('/offers/preview',\n    requireRole(ROLES.ADMIN, ROLES.COORDINATOR),",
        "  .get('/offers/preview',\n    requireAuth(),"),
    'preview-coordinator-grant': ('apps/api/src/lib/role-grants.ts',
        "    'GET /v1/registrations/offers/preview',\n",
        ""),
}


def run_08u(log):
    env = dict(os.environ, TEST_DB_NAME='igcse_words_test')
    r = subprocess.run(['pnpm', 'exec', 'vitest', 'run', 'test/08u-session-form.test.ts'], cwd=API, env=env, capture_output=True, text=True)
    text = re.sub(r'\x1b\[[0-9;]*m', '', r.stdout + r.stderr)
    keep = []
    lines = text.splitlines()
    for i, l in enumerate(lines):
        if re.search(r'^\s*(✓|×)|FAIL |AssertionError|Error:|→|Test Files|Tests  |expected', l):
            keep.append(l.rstrip()[:400])
    open(log, 'w').write('\n'.join(keep) + '\n')
    return r.returncode, keep


names = sys.argv[1:] or list(CONTROLS)
for name in names:
    rel, old, new = CONTROLS[name]
    path = f'{WT}/{rel}'
    src = open(path).read()
    assert src.count(old) == 1, (name, 'guard text not found once')
    open(path, 'w').write(src.replace(old, new, 1))
    try:
        code, keep = run_08u(f'{OUT}/{name}-red.log')
    finally:
        open(path, 'w').write(src)
    tests = [l for l in keep if 'Tests  ' in l]
    print(f'{name}: undone -> exit {code} {tests[-1].strip() if tests else ""}')
code, keep = run_08u(f'{OUT}/after-controls-green.log')
tests = [l for l in keep if 'Tests  ' in l]
print(f'all guards back -> exit {code} {tests[-1].strip() if tests else ""}')
