"""The review round's controls (findings 1, 3, 6, 7): each fix undone once, its suite red, put back, green.

Usage: python3 controls2.py [name ...]. Logs: /tmp/sw/controls/<name>-red.log and review-controls-green-<suite>.log.
"""
import os, re, subprocess, sys
WT = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/session-words'
API = f'{WT}/apps/api'
OUT = '/tmp/sw/controls'
os.makedirs(OUT, exist_ok=True)
OFFER = 'apps/api/src/services/offer.services.ts'
VIEW = 'apps/api/src/services/import/view.ts'

CONTROLS = {
    'review-1-whole-joins-paper-group': ('test/08u-session-form.test.ts', [(OFFER,
        "          if (!grouped) {\n            for (const w of wholes.filter((x) => !x.exclusiveGroup)) {",
        "          if (false && !grouped) {\n            for (const w of wholes.filter((x) => !x.exclusiveGroup)) {")]),
    'review-3-import-one-paper-retake': ('test/08n-import.test.ts', [
        (VIEW, "    const saysRetake = onePaper || e.attempt === 'retake' || (e.attempt !== 'first' && (d.noteRetake || d.noteOnePaper));",
               "    const saysRetake = e.attempt === 'retake' || (e.attempt !== 'first' && (d.noteRetake || d.noteOnePaper || onePaper));"),
        (VIEW, "    } else if (e.attempt === 'first' && !onePaper) {", "    } else if (e.attempt === 'first') {"),
        (VIEW, "      if (!onePaper && out.mode === 'self_study' && !c.selfStudyOnly && rule) {", "      if (out.mode === 'self_study' && !c.selfStudyOnly && rule) {"),
    ]),
    'review-6-paper-named-twice': ('test/08u-session-form.test.ts', [(OFFER,
        "  if (new Set(ids).size !== ids.length || new Set(paperUnitIds).size !== paperUnitIds.length) {",
        "  if (new Set(ids).size !== ids.length) {")]),
    'review-7-item-diff': ('test/08u-session-form.test.ts', [(OFFER,
        "        if (Object.keys(data).length) itemChanges.push(",
        "        if (true) itemChanges.push(")]),
}


def run(test, log):
    env = dict(os.environ, TEST_DB_NAME='igcse_words_test')
    r = subprocess.run(['pnpm', 'exec', 'vitest', 'run', test], cwd=API, env=env, capture_output=True, text=True)
    text = re.sub(r'\x1b\[[0-9;]*m', '', r.stdout + r.stderr)
    keep = [l.rstrip()[:400] for l in text.splitlines()
            if re.match(r'^\s*(✓|×|❯) ', l) and ('×' in l or 'test/' in l) or re.search(r'FAIL |AssertionError|^Error:|^\s+→ |Test Files|Tests  ', l)]
    open(log, 'w').write('\n'.join(keep) + '\n')
    tests = [l for l in keep if 'Tests  ' in l]
    return r.returncode, tests[-1].strip() if tests else ''


names = sys.argv[1:] or list(CONTROLS)
suites = set()
for name in names:
    test, patches = CONTROLS[name]
    suites.add(test)
    originals = {}
    try:
        for rel, old, new in patches:
            path = f'{WT}/{rel}'
            src = originals.setdefault(path, open(path).read())
            cur = open(path).read()
            assert cur.count(old) == 1, (name, old[:80])
            open(path, 'w').write(cur.replace(old, new, 1))
        code, tests = run(test, f'{OUT}/{name}-red.log')
    finally:
        for path, src in originals.items():
            open(path, 'w').write(src)
    print(f'{name}: undone -> exit {code} {tests}')
for test in sorted(suites):
    code, tests = run(test, f'{OUT}/review-controls-green-{os.path.basename(test).split(".")[0]}.log')
    print(f'{test} with every fix back -> exit {code} {tests}')
