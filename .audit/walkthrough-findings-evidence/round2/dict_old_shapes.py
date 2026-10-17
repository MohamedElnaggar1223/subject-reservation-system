#!/usr/bin/env python3
"""Review item 6: every dictionary entry or rule that still matches a sentence round 1 rewrote (its old amount or
method shape: "N.00 EGP", "EGP N.00", "via instapay", "escrow"). Reads the round-1 diff of apps/api/src (e90850d..744e553)
for removed sentences, takes their literal fragments, and looks for each in the web's dictionaries."""
import re, subprocess, glob
WT = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/walkthrough-findings/'
diff = subprocess.run(['git', 'diff', 'e90850d', '744e553', '--', 'apps/api/src'], capture_output=True, text=True,
                      cwd='/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/lead-env').stdout
removed = [l[1:] for l in diff.splitlines() if l.startswith('-') and not l.startswith('---')]
added = '\n'.join(l[1:] for l in diff.splitlines() if l.startswith('+') and not l.startswith('+++'))
frags = set()
for l in removed:
    for lit in re.findall(r"`([^`]*)`|'([^']*)'", l):
        s = lit[0] or lit[1]
        for part in re.split(r'\$\{[^}]*\}', s):
            part = part.strip(' .,:;()—-')
            if len(part) >= 14 and re.search(r'[A-Za-z]{3}', part) and part not in added:
                frags.add(part)
files = sorted(glob.glob(WT + 'apps/web/lib/i18n*.ts') + glob.glob(WT + 'apps/web/lib/i18n-*/*.ts'))
texts = {f: open(f).read() for f in files}
def variants(p):
    yield p
    yield re.sub(r'([.()?+*\[\]])', r'\\\1', p)
hits = []
for p in sorted(frags):
    for f, t in texts.items():
        for v in variants(p):
            i = t.find(v)
            if i >= 0:
                line = t.count('\n', 0, i) + 1
                hits.append((f.replace(WT, ''), line, p))
                break
for h in sorted(set(hits)):
    print(f'{h[0]}:{h[1]}\t{h[2]}')
print(len(frags), 'fragments,', len(set(hits)), 'hits')
