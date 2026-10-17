// F8-03's check through the API: a subject marked core, deactivated. Main refuses until the core flag is removed;
// the branch deactivates it and clears the flag. Placeholder subject.
import { apiAs, ADMIN, out } from './lib.mjs';
const PHASE = process.env.PHASE ?? 'after';
const admin = await apiAs(...ADMIN);
const code = `CORE-SAMPLE-${PHASE.toUpperCase()}`;
const made = await admin('POST', '/v1/subjects', { name: `Core sample (${PHASE})`, code, council: 'cambridge', qualificationLevel: 'igcse', courseFee: 1000, registrationFee: 0, isOfferedAtSchool: true, isCore: true });
let result;
try { result = await admin('DELETE', `/v1/subjects/${made.id}`); } catch (e) { result = String(e.message); }
const cat = await admin('GET', '/v1/catalogue');
out(JSON.stringify({ phase: PHASE, made: { id: made.id, isCore: made.isCore }, deactivate: typeof result === 'string' ? result : { isActive: result.isActive, isCore: result.isCore }, unmappedCount: cat.unmappedCount, unmappedActive: cat.registrable.filter((r) => !r.mapped && r.isActive).length, unmappedAll: cat.registrable.filter((r) => !r.mapped).length }));
process.exit(0);
