#!/usr/bin/env python3
"""F6 review fix 2's control: variants of subjects-tab.client.tsx with React Query's observer notification
delayed 300 ms (its scheduler is a timer; the delay makes 'a later tick' certain instead of likely):
the fixed file and the file before the fix (feature/ui-audit at 925e36c)."""
import subprocess
W = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/ui-audit/'
P = 'apps/web/app/(app)/(sessions)/admin/sessions/[id]/subjects-tab.client.tsx'
fixed = open(W + P, encoding='utf-8').read()
old = subprocess.run(['git', '-C', '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/lead-env', 'show', f'925e36c:{P}'],
                     capture_output=True, text=True, check=True).stdout
DELAY = "import { notifyManager } from '@tanstack/react-query';\n// CONTROL ONLY (F6 review fix 2): observers told 300 ms after the cache changes.\nnotifyManager.setScheduler((cb) => { setTimeout(cb, 300); });\n"
anchor = "import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';\n"
for name, src in (('fixed', fixed), ('old', old)):
    assert src.count(anchor) == 1
    open(f'/tmp/ui-audit/subjects-tab.{name}.tsx', 'w', encoding='utf-8').write(src)
    open(f'/tmp/ui-audit/subjects-tab.{name}-delay.tsx', 'w', encoding='utf-8').write(src.replace(anchor, anchor + DELAY))
print('ok')
