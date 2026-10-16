#!/usr/bin/env python3
"""Commit the cycle-decisions worktree's files onto refs/heads/feature/cycle-decisions with git plumbing run
from lead-env (the harness pins git to lead-env): a temporary index read from the branch, every tracked file
whose content differs and every new file under the given roots hashed in, write-tree, commit-tree with the
branch as parent, update-ref guarded by the old value. Nothing of lead-env's checkout, index or HEAD is touched.
Usage: commit.py <message-file> [new-root ...]   (new roots: paths relative to the worktree, files or dirs)"""
import os, subprocess, sys

LEAD = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/lead-env'
WT = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/cycle-decisions'
BRANCH = 'refs/heads/feature/cycle-decisions'
INDEX = '/tmp/cd/commit.index'

def git(*args, env=None, input=None):
    e = dict(os.environ, **(env or {}))
    p = subprocess.run(['git', '-C', LEAD, *args], capture_output=True, text=True, env=e, input=input)
    if p.returncode != 0:
        raise SystemExit(f'git {" ".join(args)}: {p.stderr}')
    return p.stdout

msg_file, *roots = sys.argv[1:]
parent = git('rev-parse', BRANCH).strip()
idx = {'GIT_INDEX_FILE': INDEX}
if os.path.exists(INDEX):
    os.remove(INDEX)
git('read-tree', parent, env=idx)

# Tracked files: (mode, blob, path).
tracked = {}
for line in git('ls-tree', '-r', '-z', parent).split('\0'):
    if not line:
        continue
    meta, path = line.split('\t', 1)
    mode, _, blob = meta.split(' ')
    tracked[path] = (mode, blob)

# Hash every tracked file as it is in the worktree (no write), compare.
paths = [p for p in tracked if os.path.isfile(os.path.join(WT, p))]
missing = [p for p in tracked if not os.path.exists(os.path.join(WT, p))]
hashes = git('hash-object', '--stdin-paths', input='\n'.join(os.path.join(WT, p) for p in paths) + '\n').split()
changed = [p for p, h in zip(paths, hashes) if h != tracked[p][1]]

# New files under the roots given.
new = []
for r in roots:
    full = os.path.join(WT, r)
    files = [full] if os.path.isfile(full) else [os.path.join(d, f) for d, _, fs in os.walk(full) for f in fs]
    for f in files:
        rel = os.path.relpath(f, WT)
        if rel not in tracked and rel not in new:
            new.append(rel)

entries = []
for rel in changed + new:
    blob = git('hash-object', '-w', os.path.join(WT, rel)).strip()
    mode = tracked.get(rel, ('100755' if os.access(os.path.join(WT, rel), os.X_OK) and rel.endswith(('.sh', '.py')) else '100644',))[0]
    entries.append(f'{mode} {blob}\t{rel}')
for rel in missing:
    entries.append(f'0 {"0" * 40}\t{rel}')
if not entries:
    raise SystemExit('nothing to commit')
git('update-index', '--index-info', env=idx, input='\n'.join(entries) + '\n')
tree = git('write-tree', env=idx).strip()
commit = git('commit-tree', tree, '-p', parent, '-F', msg_file).strip()
git('update-ref', BRANCH, commit, parent)
print(f'committed {commit} on {parent[:7]}: {len(changed)} changed, {len(new)} new, {len(missing)} removed')
for rel in changed:
    print('  M', rel)
for rel in new:
    print('  A', rel)
for rel in missing:
    print('  D', rel)
