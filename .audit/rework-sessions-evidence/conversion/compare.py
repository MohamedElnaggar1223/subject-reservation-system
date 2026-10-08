import json, sys
b = json.load(open(sys.argv[1]))
a = json.load(open(sys.argv[2]))
diffs = []
bl = {l['id']: l for l in b['lines']}
al = {l['id']: l for l in a['lines']}
if set(bl) != set(al):
    diffs.append(f"line ids differ: -{len(set(bl) - set(al))} +{len(set(al) - set(bl))}")
for k, x in bl.items():
    y = al.get(k)
    if not y:
        continue
    for f in ['status', 'price', 'course', 'board', 'series', 'student_id', 'session_id', 'subject_id', 'payments']:
        if x[f] != y[f]:
            diffs.append(f"line {k} {f}: {x[f]!r} -> {y[f]!r}")
if b['wallets'] != a['wallets']:
    diffs.append('wallets differ')
bs = {s['id']: s['status'] for s in b['sessions']}
as_ = {s['id']: s['status'] for s in a['sessions']}
if bs != as_:
    diffs.append(f'session statuses differ: {bs} -> {as_}')
for k, x in b['eligibility'].items():
    y = a['eligibility'].get(k)
    if x != y:
        diffs.append(f"eligibility {k}: {x} -> {y}")
for k, x in b['refunds'].items():
    y = a['refunds'].get(k)
    if x != y:
        diffs.append(f"refund preview {k}: {x} -> {y}")
print(f"lines {len(bl)}; wallets {len(b['wallets'])}; sessions {len(bs)}; waiting lines with an eligibility answer {len(b['eligibility'])}; live lines with a refund preview {len(b['refunds'])}")
print('statuses:', {s: sum(1 for l in bl.values() if l['status'] == s) for s in sorted({l['status'] for l in bl.values()})})
print('DIFFERENCES:', len(diffs))
for d in diffs[:50]:
    print(' ', d)
