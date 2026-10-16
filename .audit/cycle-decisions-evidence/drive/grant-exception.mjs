// The review of dd68598, item 2, on the screens: the finance admin grants student B1 (parent B's child) the exception
// "self-study on a first entry" (what the Exceptions page posts); the drive then reads the Reserve page.
import { signIn, out } from './api.mjs';
import fs from 'node:fs';
const S = JSON.parse(fs.readFileSync(new URL('./state.json', import.meta.url), 'utf8'));
const finadmin = await signIn('finadmin.rana@igcse.local');
const r = await finadmin('POST', '/v1/exceptions', { policyKey: 'gate.selfStudyFirstEntry', studentId: S.b1, reason: 'Studies abroad this term (cycle decisions drive)' }, { raw: true });
out('grant', r.status, JSON.stringify(r.json).slice(0, 200));
