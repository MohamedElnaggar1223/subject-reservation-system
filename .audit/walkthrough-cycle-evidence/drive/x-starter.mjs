// Exploration: load the two starter sets and list what they make.
import { apiAs } from './lib.mjs';
const admin = await apiAs('admin@igcse.local', 'AdminPass1');
for (const set of ['pearson_ial_mathematics', 'pearson_ial_biology']) console.log(set, JSON.stringify(await admin('POST', '/v1/catalogue/starter', { set })).slice(0, 300));
const cat = await admin('GET', '/v1/catalogue');
console.log(Object.keys(cat));
for (const q of cat.qualifications) console.log('Q', q.boardCode, q.code, q.level, q.entryMethod, q.title, (q.units ?? []).map((u) => `${u.code}:${u.requirement}${u.choiceGroup ? '/' + u.choiceGroup : ''}`).join(' '));
for (const u of cat.units) console.log('U', u.boardCode, u.code, u.shortCode, u.unitLevel, u.kind, u.title);
process.exit(0);
