"""The cycle-decisions worktree's state against the branch, read from lead-env with a temporary index and
--work-tree (the coordinator's resume message): status (ignored files left out, as git status does) and diff --stat.
Nothing of lead-env's checkout, index or HEAD is touched."""
import os, subprocess
LEAD = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/lead-env'
WT = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/cycle-decisions'
INDEX = '/tmp/cd/status.index'
env = dict(os.environ, GIT_INDEX_FILE=INDEX)
def git(*a):
    p = subprocess.run(['git', '-C', LEAD, f'--work-tree={WT}', *a], capture_output=True, text=True, env=env)
    return (p.stdout + p.stderr).strip()
if os.path.exists(INDEX):
    os.remove(INDEX)
head = git('rev-parse', 'refs/heads/feature/cycle-decisions')
remote = git('rev-parse', 'refs/remotes/origin/feature/cycle-decisions')
print('branch', head)
print('origin', remote)
print(git('read-tree', head) or 'read-tree ok')
git('update-index', '-q', '--refresh')
print('--- status --porcelain (untracked: normal, ignored excluded) ---')
print(git('status', '--porcelain', '--untracked-files=normal') or '(clean)')
print('--- diff --stat against the branch ---')
print(git('diff', '--stat', head) or '(no difference)')
