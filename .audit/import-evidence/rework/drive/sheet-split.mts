/**
 * The review of 8 Oct, items 2 and 4: a synthetic sheet of placeholder families (students n … n+2)
 * on the drive's winter session — a line naming two units the session offers as items (split), a
 * line naming one unit it offers and one it does not (staff choose that code's item), and a plain
 * line. node sheet-split.mts <first student number> <out.xlsx>.
 */
import { writeFileSync } from 'node:fs';
import { workbook, type Cell } from '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/agent-acf43230a4e06e8b4/apps/api/test/import-fixtures';

const first = Number(process.argv[2] ?? 31);
const outPath = process.argv[3] ?? '/tmp/f7/drive/split-sheet.xlsx';
const C = 'I confirm my registration';
const header: Cell[] = ['Student Name', 'Class & Grade', 'Specification', 'Subject', 'Teacher', 'Student No.', 'Student Email', '', 'Parent Email', 'Parent No.', '', '', ''];
const line = (k: number, spec: string, subj: string, t: string, self: 'Yes' | 'No', note = ''): Cell[] => {
  const n = first + k - 1;
  return [`Demo Student ${n}`, '11A', spec, subj, t, `010100000${String(n).padStart(2, '0')}`, `demo.student${n}@example.test`, `Demo Parent ${n}`, `demo.parent${n}@example.test`, `010200000${String(n).padStart(2, '0')}`, C, self, note];
};
writeFileSync(outPath, workbook([
  { name: 'Nov 2026', rows: [['Nov. 2026 Session'], header,
    line(1, 'A.S.', 'Mathematics (P1 & P2)', 'Teacher Demo A', 'No'),
    line(2, 'A.S.', 'Mathematics (P1 & P5)', 'Teacher Demo A', 'No'),
    line(3, 'O.L.', 'Demo Biology', 'Teacher Demo A', 'No'),
  ] },
]));
console.log('sheet', outPath);
