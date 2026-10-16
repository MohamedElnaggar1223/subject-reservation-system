#!/usr/bin/env python3
"""Commit the walkthrough-cycle working tree onto refs/heads/feature/walkthrough-cycle.

Run from the lead-env worktree (the harness pins git there; lead-env's own HEAD,
index and files are never touched): builds the tree in a temporary index from
the branch tip plus the working files of the walkthrough-cycle worktree, then
commit-tree and update-ref. Adapted from /tmp/rf/commit.py (F6b), /tmp/sw/commit.py (F6a) and agent A's
/tmp/rwa/commit.py. Usage: commit.py "message" [--dry] [--parent2 <sha>]
"""
import os, subprocess, sys
WT = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/walkthrough-cycle'
REF = 'refs/heads/feature/walkthrough-cycle'
IDX = '/tmp/f8/index'
ENV = dict(os.environ, GIT_INDEX_FILE=IDX)
SKIP_DIRS = {'node_modules', '.git', '.next', 'dist', '.turbo', '.uploads', 'coverage', 'build', 'out'}
FORCE = ['.audit/walkthrough-cycle.tsv']
EVID = '.audit/walkthrough-cycle-evidence/'


def git(*args, input=None, env=None):
    return subprocess.run(['git', *args], input=input, env=env or os.environ, capture_output=True, text=True, check=True).stdout


args = sys.argv[1:]
msg = args[0]
dry = '--dry' in args
parent2 = args[args.index('--parent2') + 1] if '--parent2' in args else None
tip = git('rev-parse', REF).strip()
git('read-tree', tip, env=ENV)
tracked = {}
for line in git('ls-tree', '-r', '--full-tree', tip).splitlines():
    meta, path = line.split('\t', 1)
    mode, _t, sha = meta.split()
    tracked[path] = (mode, sha)
changed = []
present = [p for p in tracked if os.path.isfile(os.path.join(WT, p)) and not os.path.islink(os.path.join(WT, p))]
removed = [p for p in tracked if p not in present and not os.path.islink(os.path.join(WT, p))]
if present:
    hashes = git('hash-object', '-w', '--stdin-paths', input='\n'.join(os.path.join(WT, p) for p in present) + '\n').split()
    for p, h in zip(present, hashes):
        mode = tracked[p][0]
        if h != tracked[p][1]:
            git('update-index', '--cacheinfo', f'{mode},{h},{p}', env=ENV)
            changed.append(('M', p))
for p in removed:
    git('update-index', '--force-remove', p, env=ENV)
    changed.append(('D', p))
cands = []
for root, dirs, files in os.walk(WT):
    dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
    for f in files:
        rel = os.path.relpath(os.path.join(root, f), WT)
        if rel not in tracked and rel != '.git':
            cands.append(rel)
ignored = set()
if cands:
    r = subprocess.run(['git', 'check-ignore', '--no-index', '--stdin'], input='\n'.join(cands) + '\n', capture_output=True, text=True)
    ignored = set(r.stdout.split('\n'))
new = [p for p in cands if p not in ignored] + [p for p in FORCE if p in cands and p in ignored] \
    + [p for p in cands if p in ignored and p.startswith(EVID)]
too_big = [p for p in new if p.startswith('.audit/') and os.path.getsize(os.path.join(WT, p)) > 300 * 1024]
if too_big:
    sys.exit('over 300 KB under .audit: ' + ', '.join(too_big))
img_big = [p for c, p in [('A', q) for q in new] + changed if p.startswith('docs/walkthrough/img/') and os.path.isfile(os.path.join(WT, p)) and os.path.getsize(os.path.join(WT, p)) > 150 * 1024]
if img_big:
    sys.exit('walkthrough image over 150 KB: ' + ', '.join(img_big))
for p in new:
    full = os.path.join(WT, p)
    h = git('hash-object', '-w', full).strip()
    mode = '100755' if os.access(full, os.X_OK) else '100644'
    git('update-index', '--add', '--cacheinfo', f'{mode},{h},{p}', env=ENV)
    changed.append(('A', p))
for c, p in sorted(changed, key=lambda x: x[1]):
    print(c, p)
if not changed and not parent2:
    print('nothing to commit')
    sys.exit(0)
if dry:
    print('(dry run)')
    sys.exit(0)
tree = git('write-tree', env=ENV).strip()
cargs = ['commit-tree', tree, '-p', tip] + (['-p', parent2] if parent2 else [])
commit = git(*cargs, input=msg + '\n').strip()
git('update-ref', REF, commit, tip)
print('committed', commit[:7], 'on', REF)
