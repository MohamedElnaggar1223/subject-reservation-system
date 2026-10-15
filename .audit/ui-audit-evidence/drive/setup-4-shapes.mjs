// F6 dev data, part 4 (igcse_ui_dev, API 3071): the boards' June 2027 dates, and the sheet's remaining
// shapes through the subject's form endpoint (what the Session screen's form saves): Biology's Paper 4
// opened as a retake in school or self study; Chemistry "Retake (Self Study ONLY)"; Computer Science
// added with an external team and no board fee yet (a finding the landing shows). Placeholders only.
import { signIn, out } from './api.mjs';

const admin = await signIn('admin@igcse.local', 'AdminPass1');
const sessions = await admin('GET', '/v1/sessions');
const june = sessions.find((s) => s.sessionType === 'june' && s.seriesYear === 2027 && s.label === '');

// The boards' dates (the dates dialog on the session's header writes the same endpoint).
const list = await admin('GET', `/v1/sessions/${june.id}/offers`);
const seriesOf = (council) => list.offers.find((o) => o.subject.council === council).items[0].boardSeriesId;
await admin('PUT', `/v1/board-series/${seriesOf('cambridge')}`, { entryDeadline: '2027-02-20T12:00:00.000Z', retakeDeadline: '2027-03-20T12:00:00.000Z', examsStart: '2027-04-26', examsEnd: '2027-06-15', reason: 'F6 dev: the board published its June dates' });
await admin('PUT', `/v1/board-series/${seriesOf('pearson_edexcel')}`, { entryDeadline: '2027-02-25T12:00:00.000Z', examsStart: '2027-05-10', examsEnd: '2027-06-20', reason: 'F6 dev: the board published its June dates' });

const formOf = (o, change) => ({
  teachers: o.teachers.map((t) => ({ teacherId: t.teacherId, mode: t.mode })),
  availability: o.availability,
  courseFee: o.courseFee,
  items: [],
  grade10Core: o.grade10Core,
  courseStartsOn: o.courseStartsOn,
  notes: o.notes,
  ...change,
});
const offerOf = (code) => list.offers.find((o) => o.subject.code === code);

// Biology: Paper 4 only, a retake in school or self study, at its own course fee.
const bio = offerOf('0610');
const p4 = bio.items.find((i) => i.kind === 'one_paper' && i.units.some((u) => u.shortCode === 'Paper 4'));
if (p4.availability === 'closed') {
  await admin('PUT', `/v1/sessions/${june.id}/offers/${bio.id}/form`, formOf(bio, { items: [{ itemId: p4.id, availability: 'retake_only', courseFee: 7000 }] }));
}
// Chemistry: Retake (Self Study ONLY).
const chem = offerOf('0620');
if (chem.availability !== 'self_study_only') {
  await admin('PUT', `/v1/sessions/${june.id}/offers/${chem.id}/form`, formOf(chem, { availability: 'self_study_only', teachers: [] }));
}
// Computer Science: an external team, no board fee yet.
if (!offerOf('0478')) {
  await admin('POST', `/v1/sessions/${june.id}/offers`, { subjectId: 'subj_0478', courseFee: 13000, teachers: [{ providerName: 'External Team Placeholder', mode: 'in_school' }] });
}
const after = await admin('GET', `/v1/sessions/${june.id}/offers`);
out(after.offers.map((o) => `${o.subject.name} [${o.availability}] ${o.teachers.map((t) => `${t.name}/${t.mode}/${t.kind}`).join(', ')} :: ${o.items.map((i) => `${i.label}/${i.availability}`).join(', ')} :: warnings ${JSON.stringify(o.warnings ?? [])}`).join('\n'));
