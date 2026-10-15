#!/usr/bin/env python3
"""Identifiers named in the follow-ups' added comments (in backticks or as name()) that no code defines."""
import os, re, subprocess
ROOT = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/ui-audit'
diff = open('/tmp/ui-audit/followups.diff', encoding='utf-8').read().splitlines()
names = set()
for l in diff:
    if not l.startswith('+') or l.startswith('+++'):
        continue
    body = l[1:].strip()
    if not (body.startswith('//') or body.startswith('*') or body.startswith('/**') or body.startswith('{/*')):
        continue
    names.update(re.findall(r'`([A-Za-z_][A-Za-z0-9_]*)`', body))
    names.update(re.findall(r'\b([a-z][A-Za-z0-9_]{3,})\(', body))
src = []
for d in ('apps/api/src', 'apps/web', 'packages/validations/src', 'packages/db/src'):
    for dp, dn, fn in os.walk(os.path.join(ROOT, d)):
        if 'node_modules' in dp or '.next' in dp:
            continue
        for f in fn:
            if f.endswith(('.ts', '.tsx')):
                src.append(open(os.path.join(dp, f), encoding='utf-8').read())
code = '\n'.join(src)
for n in sorted(names):
    if not re.search(r'(function\s+%s\b|const\s+%s\b|let\s+%s\b|\b%s\s*[:=(]|export\s+\{[^}]*\b%s\b)' % ((re.escape(n),) * 5), code):
        print('undefined?', n)
