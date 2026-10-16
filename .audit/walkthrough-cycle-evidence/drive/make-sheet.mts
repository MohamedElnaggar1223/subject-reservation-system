/**
 * The walkthrough's placeholder sheet for the day-one import: one family, three lines, in the shape of the
 * school's response sheet (a "June 2027 Session" tab: the forms' columns, the confirmation, the self-study
 * answer and the fee note in unlabeled columns). No phone numbers; placeholder names only.
 * Run from apps/api: pnpm exec tsx <this file> <out.xlsx>
 */
import { writeFileSync } from 'node:fs';
import { workbook, type Cell } from '../f8-clone/apps/api/test/import-fixtures';

const outPath = process.argv[2] ?? '/tmp/f8-pw/june-2027-placeholder-sheet.xlsx';
const C = 'I confirm my registration';
const header: Cell[] = ['Student Name', 'Class & Grade', 'Specification', 'Subject', 'Teacher', 'Student No.', 'Student Email', '', 'Parent Email', 'Parent No.', '', '', ''];
const line = (spec: string, subject: string, teacher: string, selfStudy: 'Yes' | 'No', note = ''): Cell[] =>
  ['Student Three', '11B', spec, subject, teacher, '', 'student3@igcse.local', 'Parent Three', 'parent3@igcse.local', '', C, selfStudy, note];
writeFileSync(outPath, workbook([
  { name: 'June 2027', rows: [['June 2027 Session'], header,
    line('O.L.', 'Biology', 'Teacher 5', 'No'),
    line('O.L.', 'Chemistry', '', 'Yes', 'Retake Self Study 50% fees (All Papers) From June 2026'),
    line('A.S.', 'Pure Mathematics 1 (P1)', 'Teacher 30', 'No'),
  ] },
]));
console.log('sheet', outPath);
