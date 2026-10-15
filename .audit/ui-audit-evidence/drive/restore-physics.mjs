// After F6 review fix 2's drives: Physics A.S./A.L. back to Teacher C, as setup-1 made it (dev data only).
import { signIn } from './api.mjs';
const JUNE = '6d34f4aa-11fc-45a8-b04b-55e04a25b3a9';
const api = await signIn('admin@igcse.local', 'AdminPass1');
const o = (await api('GET', `/v1/sessions/${JUNE}/offers`)).offers.find((x) => x.subject.name === 'Physics A.S./A.L.');
const teachers = await api('GET', '/v1/teachers');
const list = Array.isArray(teachers) ? teachers : teachers.items;
const id = (n) => list.find((t) => t.name === n).id;
if (o.teachers.some((t) => t.name === 'Teacher B')) {
  await api('POST', `/v1/sessions/${JUNE}/offers/${o.id}/replace-teacher`, { fromTeacherId: id('Teacher B'), toTeacherId: id('Teacher C'), reason: 'Back as setup-1 made it (F6 review drives)' });
}
const after = (await api('GET', `/v1/sessions/${JUNE}/offers`)).offers.find((x) => x.subject.name === 'Physics A.S./A.L.');
console.log('Physics A.S./A.L. teachers:', after.teachers.map((t) => t.name));
