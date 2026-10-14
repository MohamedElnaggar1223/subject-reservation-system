#!/usr/bin/env python3
"""Trim B's run logs under CLAUDE.md's evidence rule: keep the vitest summary (each file's and
each listed test's result line, the totals) and, for a red run or a control, the failing tests
and their messages; drop the request log. The file keeps its name (the trail cites it)."""
import os, re, sys

EV = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.audit/rework-reservations-evidence'
EV = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/rework-reservations/.audit/rework-reservations-evidence'
ANSI = re.compile(r'\x1b\[[0-9;]*[A-Za-z]')
RESULT = re.compile(r'^\s*(✓|×|↓|❯)\s')
TOTALS = re.compile(r'^\s*(Test Files|Tests|Start at|Duration|Errors)\s')


def trim(path):
    raw = open(path, encoding='utf-8', errors='replace').read()
    if raw.startswith('# Trimmed under CLAUDE.md'):
        return len(raw), os.path.getsize(path), False
    text = ANSI.sub('', raw)
    lines = text.split('\n')
    keep = []
    # Each file's and each listed test's result, as the reporter printed them.
    for l in lines:
        if RESULT.match(l) and ('test/' in l or ' > ' in l or re.search(r'\d+ms$', l)):
            keep.append(l.rstrip())
    # The failed tests' section, printed after the run: names, assertion messages, code frames.
    failed = []
    start = next((i for i, l in enumerate(lines) if re.search(r'Failed Tests \d+', l)), None)
    if start is not None:
        end = next((i for i in range(start, len(lines)) if TOTALS.match(lines[i]) and lines[i].strip().startswith('Test Files')), len(lines))
        for l in lines[start:end]:
            s = l.rstrip()
            if s.startswith('[INFO]') or s.startswith('[WARN]') or s.startswith('stdout |') or s.startswith('stderr |'):
                continue
            failed.append(s)
    errors_section = []
    estart = next((i for i, l in enumerate(lines) if re.search(r'Unhandled Errors', l)), None)
    if estart is not None:
        errors_section = [l.rstrip() for l in lines[estart:estart + 60]]
    # A lock-order control's cause, printed by the API in the run's log: kept, once per distinct line.
    causes = []
    for l in lines:
        if 'deadlock detected' in l and l.strip()[:300] not in causes:
            causes.append(l.strip()[:300])
    totals = [l.rstrip() for l in lines if TOTALS.match(l)]
    exits = [l.rstrip() for l in lines if re.match(r'^exit \d+$', l.strip())]
    out = [f'# Trimmed under CLAUDE.md (Git): the vitest summary and, for a red run, the failing tests and their',
           f'# messages; the request log of the run removed. Original: {len(raw)} bytes, {len(lines)} lines.', '']
    out += keep
    if failed:
        out += [''] + failed
    if causes:
        out += ['', "# The API's log lines naming the cause:"] + causes
    if errors_section:
        out += [''] + errors_section
    out += [''] + totals[-6:] + exits
    open(path, 'w').write('\n'.join(out) + '\n')
    return len(raw), os.path.getsize(path), bool(failed)


names = sys.argv[1:] or sorted(f for f in os.listdir(EV) if f.endswith('.log') and (
    f.startswith('suite-') or f.startswith('control-') or f in ('run1.log', 'run2-merge.log', 'baseline-27e3233.log')))
for f in names:
    # A log trimmed once keeps its header (commit, TZ, original size): trimming it again lost them.
    if '# Trimmed under CLAUDE.md' in open(os.path.join(EV, f), errors='replace').read(4000):
        continue
    before, after, red = trim(os.path.join(EV, f))
    print(f'{f}: {before} -> {after} bytes{" (red: failures kept)" if red else ""}')
