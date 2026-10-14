/**
 * The drive's synthetic sheet for another set of placeholder families (students n+1 … n+4), the same
 * shapes as seed.mts writes: node sheet.mts <first student number> <out.xlsx>.
 */
import { writeFileSync } from 'node:fs';
import { workbook, type Cell } from '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/agent-acf43230a4e06e8b4/apps/api/test/import-fixtures';

const first = Number(process.argv[2] ?? 5);
const outPath = process.argv[3] ?? '/tmp/f7/drive/demo-sheet-2.xlsx';
const C = 'I confirm my registration';
const header: Cell[] = ['Student Name', 'Class & Grade', 'Specification', 'Subject', 'Teacher', 'Student No.', 'Student Email', '', 'Parent Email', 'Parent No.', '', '', ''];
const line = (k: number, spec: string, subj: string, t: string, self: 'Yes' | 'No', note = '', cls = '11A'): Cell[] => {
  const n = first + k - 1;
  return [`Demo Student ${n}`, cls, spec, subj, t, `010100000${String(n).padStart(2, '0')}`, `demo.student${n}@example.test`, `Demo Parent ${n}`, `demo.parent${n}@example.test`, `010200000${String(n).padStart(2, '0')}`, C, self, note];
};
writeFileSync(outPath, workbook([
  { name: 'Nov 2026', rows: [['Nov. 2026 Session'], header,
    line(1, 'O.L.', 'Demo Biology', 'Teacher Demo A', 'No'),
    line(1, 'O.L.', 'Demo History', 'Teacher Demo A', 'No'),
    line(1, 'O.L.', 'Demo Geography', 'Teacher Demo A', 'No'),
    line(2, 'O.L.', 'Demo Biology', '', 'Yes'),
    line(2, 'O.L.', 'Demo Chemistry', '', 'Yes', 'Retake Self Study 50% fees (All Papers) From June 2026'),
    line(2, 'O.L.', 'Demo Physics', '', 'Yes'),
    line(3, 'O.L.', 'Demo Physics', 'Teacher Demo A', 'No', 'Retake in School 100% fees (All Papers)'),
    line(3, 'A.S.', 'Pure Mathematics 1 (P1)', 'Teacher Demo A', 'No'),
    line(4, 'A.S.', 'Mathematics (P1 & P2)', 'Teacher Demo A', 'No'),
  ] },
  { name: 'June 2026', rows: [['June 2026 Session'], header, line(2, 'O.L.', 'Demo Biology', 'Teacher Demo A', 'No', '', '10A')] },
]));
console.log('sheet', outPath);
