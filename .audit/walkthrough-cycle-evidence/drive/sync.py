#!/usr/bin/env python3
"""Copy the F8 files authored in /tmp/f8/repo into the walkthrough-cycle worktree (the harness lets this
session write only in lead-env with its file tools). Prints what it copied; never deletes."""
import os, shutil, filecmp
SRC = '/tmp/f8/repo'
DST = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/walkthrough-cycle'
n = 0
for root, _dirs, files in os.walk(SRC):
    for f in files:
        s = os.path.join(root, f)
        rel = os.path.relpath(s, SRC)
        d = os.path.join(DST, rel)
        if os.path.exists(d) and filecmp.cmp(s, d, shallow=False):
            continue
        os.makedirs(os.path.dirname(d), exist_ok=True)
        shutil.copy2(s, d)
        print('copied', rel)
        n += 1
print(n, 'files copied')
