// The session's data the drive types into the screens: docs/admin-guide/build/guide-data.json, the file gen.py reads.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
export const D = JSON.parse(fs.readFileSync(process.env.GUIDE_DATA ?? path.join(here, '..', 'guide-data.json'), 'utf8'));
// The practice copy's admin (a local run only; never the deployed system).
export const ADMIN = { email: 'admin@igcse.local', password: 'AdminPass1' };
export const bySubject = (code) => D.subjects.find((s) => s.code === code);
