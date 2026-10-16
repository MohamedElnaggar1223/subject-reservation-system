#!/usr/bin/env python3
"""Undo a guard, run the given test files, keep the summary and the failures, put the guard back.
Usage: control.py <name> <file> <spec-file> <test filters...>
The spec file holds the guard as it is (@@@NOW … @@@UNDONE …@@@END)."""
import sys, subprocess, os, re
ROOT = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/cycle-decisions'
name, path, spec, *tests = sys.argv[1:]
full = os.path.join(ROOT, path)
src = open(full, encoding='utf-8').read()
s = open(spec, encoding='utf-8').read()
now = s.split('@@@NOW\n', 1)[1].split('\n@@@UNDONE\n', 1)[0]
undone = s.split('\n@@@UNDONE\n', 1)[1].split('\n@@@END', 1)[0]
assert src.count(now) == 1, f'guard text found {src.count(now)} times'
open(full, 'w', encoding='utf-8').write(src.replace(now, undone))
try:
    env = dict(os.environ, TEST_DB_NAME='igcse_decisions_test')
    p = subprocess.run(['pnpm', '--filter', '@repo/api', 'test', '--', *tests], cwd=ROOT, env=env, capture_output=True, text=True)
    out = p.stdout + p.stderr
finally:
    open(full, 'w', encoding='utf-8').write(src)
keep = [l for l in out.splitlines() if re.search(r'^\s+(×|→)|Test Files|^\s+Tests |AssertionError', l)]
os.makedirs(os.path.join(ROOT, '.audit/cycle-decisions-evidence/controls'), exist_ok=True)
log = os.path.join(ROOT, '.audit/cycle-decisions-evidence/controls', f'{name}.log')
open(log, 'w').write(f'control {name}: {path} guard undone, tests {tests}\n' + '\n'.join(keep[:60]) + '\n')
print('\n'.join(keep[:30]))
print('restored:', open(full, encoding='utf-8').read() == src)
