#!/usr/bin/env python3
"""F6: the accessibility and console results of the before and after drives, per axe rule (records and
nodes) and per kind of console error, for UI_AUDIT.md §5."""
import json, collections
E = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/ui-audit/.audit/ui-audit-evidence/'
for phase in ('before', 'after'):
    d = json.load(open(E + f'drive-{phase}.json'))
    recs = list(d.values())
    rules = collections.defaultdict(lambda: [0, 0, set()])
    errs = collections.Counter()
    err_recs = 0
    hydr = 0
    for r in recs:
        for v in r.get('axe', []):
            x = rules[v['id']]
            x[0] += 1; x[1] += v['nodes']; x[2].add(r['id'])
        es = r.get('errors', [])
        if es: err_recs += 1
        if any('Hydration' in e for e in es): hydr += 1
        for e in es:
            k = 'hydration' if 'Hydration' in e else ('getSession' if 'getSession' in e else ('duplicate key' if 'same key' in e or 'key' in e.lower() else e[:70]))
            errs[k] += 1
    langs = collections.Counter(r['lang'] for r in recs)
    screens = len({r['id'] for r in recs})
    viol = sum(1 for r in recs if r.get('axe'))
    print(f'== {phase}: {len(recs)} records ({screens} screens; {dict(langs)}); with an axe violation: {viol}; with a console error: {err_recs}; hydration: {hydr}')
    for k, (n, nodes, ids) in sorted(rules.items(), key=lambda kv: -kv[1][1]):
        print(f'   {k}: {n} records, {nodes} nodes, {len(ids)} screens')
    for k, n in errs.most_common():
        print(f'   error {n}x: {k}')
