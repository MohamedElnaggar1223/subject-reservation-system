#!/usr/bin/env python3
"""F6 review fix 6: every Tailwind colour class (with its variant prefix) in apps/web now that main
(d6c6715) never used — a new shade is a new colour."""
import re, subprocess, os
LEAD = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/lead-env'
WT = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/ui-audit'
PAT = re.compile(r'(?<![\w-])((?:[a-z0-9-]+:)*(?:bg|text|border|ring|from|to|via|fill|stroke|outline|divide|decoration|accent|caret|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|brand)-\d{2,3}(?:/\d+)?)')
main_files = subprocess.run(['git', '-C', LEAD, 'ls-tree', '-r', '--name-only', 'd6c6715', 'apps/web'], capture_output=True, text=True).stdout.split()
main_text = ''
for f in main_files:
    if f.endswith(('.tsx', '.ts', '.css')):
        main_text += subprocess.run(['git', '-C', LEAD, 'show', f'd6c6715:{f}'], capture_output=True, text=True).stdout
main_classes = set(PAT.findall(main_text))
new = {}
for root, _, files in os.walk(os.path.join(WT, 'apps/web')):
    if 'node_modules' in root or '.next' in root:
        continue
    for name in files:
        if name.endswith(('.tsx', '.ts', '.css')):
            p = os.path.join(root, name)
            for c in PAT.findall(open(p, encoding='utf-8').read()):
                if c not in main_classes:
                    new.setdefault(c, set()).add(os.path.relpath(p, WT))
for c, ps in sorted(new.items()):
    print(c, '->', ', '.join(sorted(ps)))
print('classes on main:', len(main_classes), '| new:', len(new))
