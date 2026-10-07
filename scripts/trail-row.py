#!/usr/bin/env python3
"""Append one row to a decision trail in .audit/<trail>.tsv.

A trail row records one event at the time it happened. Twice a batch of rows
written at the end of a piece of work was given one timestamp for events that
happened at different times (features-plan 28 Sep, state-audit 29 Sep), so this
is the only way rows are written:

  python3 scripts/trail-row.py <trail> <phase> <result> \\
      --decision "what was done or decided" --why "why" --evidence "where the proof is"

The row takes the current UTC time. A row written after its event must say when
the event happened and where that time comes from (the session log, a file's
modification time, a CI run):

  ... --at 2026-09-29T18:41:13Z --source "session log: the red run"

and a row whose time equals the previous row's is refused unless it is the same
event (--same-event), so a batch cannot share one time by accident.
"""
import argparse
import datetime
import os
import re
import sys

HEADER = 'ts\tphase\tdecision\twhy\tevidence\tresult\n'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('trail', help='trail name: .audit/<trail>.tsv')
    p.add_argument('phase')
    p.add_argument('result')
    p.add_argument('--decision', required=True)
    p.add_argument('--why', required=True)
    p.add_argument('--evidence', required=True)
    p.add_argument('--at', help='the event time (UTC, YYYY-MM-DDTHH:MM:SSZ) when written after the event')
    p.add_argument('--source', help='where --at comes from (required with --at)')
    p.add_argument('--same-event', action='store_true', help='allow the previous row\'s time: this row records the same event')
    a = p.parse_args()

    if not re.fullmatch(r'[a-z0-9][a-z0-9-]*', a.trail):
        sys.exit(f'trail name must be kebab-case: {a.trail}')
    for name in ('phase', 'result', 'decision', 'why', 'evidence', 'source'):
        v = getattr(a, name)
        if v is not None and ('\t' in v or '\n' in v):
            sys.exit(f'--{name} must not contain tabs or newlines')

    now = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0)
    if a.at:
        if not a.source:
            sys.exit('--at needs --source: say where the event time comes from')
        if not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ', a.at):
            sys.exit('--at must be YYYY-MM-DDTHH:MM:SSZ')
        at = datetime.datetime.strptime(a.at, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc)
        if at > now:
            sys.exit('--at is in the future')
        ts = a.at
        evidence = f'{a.evidence} (time from {a.source})'
    else:
        ts = now.strftime('%Y-%m-%dT%H:%M:%SZ')
        evidence = a.evidence

    path = os.path.join(ROOT, '.audit', f'{a.trail}.tsv')
    # Any row, not only the last: a row written with --at for a past event may sit between
    # two live rows stamped in the same second (7 Oct 2026), so the guard reads every time.
    seen = set()
    if os.path.exists(path):
        with open(path) as f:
            rows = [l for l in f.read().splitlines() if l and not l.startswith('ts\t')]
        seen = {r.split('\t', 1)[0] for r in rows}
    if ts in seen and not a.same_event:
        sys.exit(f'a row already has {ts}: write each row when its event happens, '
                 'give a past event its own time with --at/--source, or pass --same-event')

    new = not os.path.exists(path)
    with open(path, 'a') as f:
        if new:
            f.write(HEADER)
        f.write('\t'.join([ts, a.phase, a.decision, a.why, evidence, a.result]) + '\n')
    print(f'{path}: {ts} {a.phase} {a.result}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
