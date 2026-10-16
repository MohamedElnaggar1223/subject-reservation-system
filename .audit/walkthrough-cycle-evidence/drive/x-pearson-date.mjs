import { apiAs } from './lib.mjs';
const admin = await apiAs('admin@igcse.local', 'AdminPass1');
const s = (await admin('GET', '/v1/sessions')).find((x) => x.name === 'June 2027');
const pe = (s.boardSeries ?? []).find((b) => b.boardName === 'Pearson Edexcel');
console.log(pe?.id, pe?.entryDeadline);
await admin('PUT', `/v1/board-series/${pe.id}`, { entryDeadline: new Date('2027-02-13T23:59:00+02:00'), reason: 'Pearson Edexcel key dates for June 2027' });
console.log('ok');
process.exit(0);
