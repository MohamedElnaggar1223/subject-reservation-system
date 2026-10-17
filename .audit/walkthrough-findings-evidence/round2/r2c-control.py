#!/usr/bin/env python3
"""Item 6's control on the screen: the Arabic dictionary's school-fee rule put back as it was ("(N EGP)"), the drive
r2c.mjs run against the dev server (which reloads the file), then the file restored and checked."""
import subprocess, time
P = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/walkthrough-findings/apps/web/lib/i18n-import.ts'
orig = open(P).read()
new = r"school fee \(EGP (.+)\) must be paid before registering subjects$/"
old = r"school fee \((.+) EGP\) must be paid before registering subjects$/"
assert orig.count(new) == 1
open(P, 'w').write(orig.replace(new, old))
try:
    time.sleep(6)
    r = subprocess.run(['node', 'r2c.mjs'], cwd='/tmp/wf/drive', capture_output=True, text=True, timeout=300)
    print(r.stdout[-3000:], r.stderr[-1500:])
finally:
    open(P, 'w').write(orig)
assert open(P).read() == orig
print('restored')
