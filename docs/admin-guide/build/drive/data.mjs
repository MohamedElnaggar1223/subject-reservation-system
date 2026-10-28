// What the drive types into the screens: the practice copy's accounts (invented names, never a real person's,
// no phone numbers), the school's fee lists as printed (packages/db/scripts/fee-lists.ts, the lists the owner
// shared), and the school's own figures the guide uses as placeholders (course fees, the board date the admin
// enters, the session's dates).
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
export const WT = process.env.WT ?? path.resolve(here, '../../../..');
const { SCHOOL_FEE_LISTS } = await import(pathToFileURL(path.join(WT, 'packages/db/dist/scripts/fee-lists.js')).href);

export const ADMIN = { email: 'admin@igcse.local', password: 'AdminPass1', name: 'School Admin' };
export const TEMP_PASSWORD = 'Welcome2027';
export const COORDINATOR = { name: 'Nadia Coordinator', email: 'coordinator@igcse.local', role: 'coordinator' };
export const OFFICER = { name: 'Mona Desk', email: 'desk@igcse.local', role: 'finance_officer' };
export const STAFF = [COORDINATOR, OFFICER];

// Families made through the desk (the desk's own sign-up of a family): a parent of two, and a walk-in.
export const FAMILY_PASSWORD = 'Family2027';
export const PARENT = { name: 'Hala Two', email: 'parent.two@igcse.local' };
export const CHILDREN = [
  { name: 'Laila Two', email: 'laila@igcse.local', grade: 11 },
  { name: 'Karim Two', email: 'karim@igcse.local', grade: 12 },
];
export const WALKIN_PARENT = { name: 'Tarek Walkin', email: 'parent.walkin@igcse.local' };
export const WALKIN = { name: 'Yousef Walkin', email: 'yousef@igcse.local', grade: 11 };

// The school's own figures, placeholders in the pictures (no list the school shared holds them).
export const COURSE_FEE = { 'O.L.': 6000, 'A.S./A.L.': 9000 };
export const TYPED_EXAM_FEE = 9500; // an exam fee no list we hold prints (OxfordAQA, a code to check)
export const CAMBRIDGE_JUNE_2027_ENTRY = '2027-02-21'; // the admin's date, when Cambridge publishes it
export const JUNE_2028_ENTRY = { cambridge: '2028-02-21', pearson_edexcel: '2028-03-21', oxford: '2028-03-01' };
export const DATES_2027 = { payBy: '2026-12-31', firstLesson: '2026-10-01' };

/** A board's list as the school's PDF prints it: code, name and amount on a line. */
export const listText = (name) => {
  const l = SCHOOL_FEE_LISTS.find((x) => x.name === name);
  if (!l) throw new Error(`no fee list ${name}`);
  return l.rows.map((r) => `${r.printed}    ${r.name}    ${r.amount.toLocaleString('en-US')}`).join('\n');
};
export const FEE_LISTS = SCHOOL_FEE_LISTS;
