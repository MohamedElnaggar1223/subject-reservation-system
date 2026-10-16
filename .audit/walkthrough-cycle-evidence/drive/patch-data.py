"""Give the Cambridge IGCSE awards their option codes (the fee list's) and paste the Cambridge list code first."""
p = '/tmp/f8-pw/cycle-data.mjs'
s = open(p).read()
opts = {'3180': 'A', '0970': 'CX', '0986': 'AX', '0971': 'CX', '0653': 'CX', '0984': 'AX', '7156': 'X', '7159': 'Y', '0983': 'DY', '0972': 'CX'}
import re
for code, opt in opts.items():
    pat = re.compile(r"(\{ \.\.\.CAM_IG, code: '" + code + r"', [^\n]*?)( \},)")
    m = pat.search(s)
    assert m, code
    s = s[:m.start()] + m.group(1) + f", options: [{{ code: '{opt}', label: 'All papers', cf: false }}]" + m.group(2) + s[m.end():]
old_start = s.index("  cambridge: [\n    'IGCSE Arabic")
old_end = s.index("  ],", old_start) + len("  ],")
new = """  cambridge: [
    // The list's rows, syllabus and option first, as the board writes them.
    '3180 A 9,850', '0970 CX 10,850', '0986 AX 9,850', '0971 CX 10,850', '0653 CX 10,850', '0984 AX 9,850',
    '7156 X 12,550', '7159 Y 12,550', '0983 DY 12,950', '0972 CX 10,850',
    // A one-paper retake reads the syllabus's own fee (Q-13): the syllabus once more, on its own.
    '3180 9,850', '0970 10,850', '0971 10,850', '0653 10,850', '0983 12,950', '0972 10,850',
    '9701 S1 14,100', '9701 BY 11,400', '9701 AX 18,600', '9702 S1 14,100', '9702 BX 11,400', '9702 AX 18,600',
    '9618 SY 11,400', '9618 BY 12,450', '9618 AY 16,950',
  ],"""
s = s[:old_start] + new + s[old_end:]
s = s.replace("export const SEED_KEPT", "export const CENTRES = { 'Cambridge International': 'EG999' }; // a placeholder centre number\nexport const SEED_KEPT")
open(p, 'w').write(s)
print('ok')
