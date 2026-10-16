#!/usr/bin/env python3
"""Merge origin/main into refs/heads/feature/walkthrough-cycle with plumbing, from lead-env.

git merge-tree --write-tree computes the merged tree (refuses on a conflict), commit-tree makes the
merge commit with both parents, update-ref moves the branch, and the walkthrough-cycle worktree's
files are brought to the merged tree: every path that differs between the old tip and the merge is
written from the merge (or removed). lead-env's HEAD, index and files are never touched.
Usage: merge.py "message"
"""
import os, subprocess, sys
WT = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/walkthrough-cycle'
REF = 'refs/heads/feature/walkthrough-cycle'
OTHER = 'origin/main'


def git(*args, input=None, binary=False):
    r = subprocess.run(['git', *args], input=input, capture_output=True, check=False, text=not binary)
    if r.returncode != 0:
        sys.exit(f'git {" ".join(args)} failed: {r.stderr if not binary else r.stderr.decode()}\n{r.stdout if not binary else ""}')
    return r.stdout


msg = sys.argv[1]
tip = git('rev-parse', REF).strip()
other = git('rev-parse', OTHER).strip()
out = git('merge-tree', '--write-tree', '--name-only', '--messages', tip, other)
tree = out.split('\n', 1)[0].strip()
print('merged tree', tree)
commit = git('commit-tree', tree, '-p', tip, '-p', other, input=msg + '\n').strip()
git('update-ref', REF, commit, tip)
print('merge commit', commit[:7], 'on', REF)
changed = git('diff', '--name-status', '--no-renames', tip, commit).splitlines()
for line in changed:
    status, path = line.split('\t', 1)
    full = os.path.join(WT, path)
    if status == 'D':
        if os.path.exists(full):
            os.remove(full)
        print('D', path)
        continue
    mode = git('ls-tree', commit, '--', path).split()[0]
    data = git('cat-file', 'blob', f'{commit}:{path}', binary=True)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, 'wb') as f:
        f.write(data)
    os.chmod(full, 0o755 if mode == '100755' else 0o644)
    print(status, path)
