#!/usr/bin/env python3
"""Keep each full-suite run's proof (the vitest summary: one line per file and the totals), not its log."""
import os, re, sys, time
C = sys.argv[1]
G = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/ui-audit/.audit/ui-audit-evidence/gates/'
os.makedirs(G, exist_ok=True)
for z, tz in (('local', 'local time (Africa/Cairo, UTC+3)'), ('utc', 'TZ=UTC')):
    src = f'/tmp/ui-audit/suite-{z}.log'
    lines = open(src, encoding='utf-8', errors='replace').read().splitlines()
    keep = [l for l in lines if re.search(r'^\s*(✓|❯|×|✗|FAIL)\s.*\.test\.ts|Test Files|^\s+Tests\s|Duration|exit \d', l)]
    head = [f'commit {C} (feature/ui-audit), worktree .claude/worktrees/ui-audit, TEST_DB_NAME=igcse_ui_test, {tz}',
            f'run finished {time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(os.path.getmtime(src)))} (the log file\'s modification time)']
    out = G + f'suite-{z}-' + C + '.txt'
    open(out, 'w', encoding='utf-8').write('\n'.join(head + keep) + '\n')
    print(out, len(keep), 'lines', os.path.getsize(out), 'bytes')
