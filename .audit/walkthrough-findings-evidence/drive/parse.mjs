// Does the Fees tab's paste recognise the Edexcel papers' own rows, as Pearson's list writes them?
import { apiAs, ADMIN, out } from './lib.mjs';
const admin = await apiAs(...ADMIN);
const sessions = await admin('GET', '/v1/sessions');
const june = (Array.isArray(sessions) ? sessions : sessions.sessions).find((s) => s.sessionType === 'june' && s.seriesYear === 2027);
const detail = june;
const pearson = detail.boardSeries.find((s) => s.boardCode === 'pearson_edexcel');
const r = await admin('POST', `/v1/board-fees/${pearson.id}/parse`, { text: '4MA1/1H 4,600\n4MA1/2H 4,600\n4MA1 1H 4,600\n4WM1H 4,600' });
out(JSON.stringify({ matched: r.matched.map((m) => [m.line ?? m.code, m.keyKind, m.amount]), unknown: r.unknown.map((u) => u.line) }));
process.exit(0);
