// Dev system only (igcse_import_dev): the drive's winter session gets one open offer at a course fee of 0,
// as one saved before the rule (MO-9), so a copy of it shows a subject coming across closed.
import pg from 'pg';
import { readFileSync } from 'node:fs';
const seed = JSON.parse(readFileSync('/tmp/f7/drive/seed.json', 'utf8'));
const c = new pg.Client({ connectionString: 'postgresql://audit:auditpass@127.0.0.1:5433/igcse_import_dev' });
await c.connect();
const r = await c.query(`update session_offer set course_fee = 0 where session_id = $1 and subject_id = $2 returning availability`, [seed.sessionId, seed.subjects.geo]);
console.log('Demo Geography offer at 0:', r.rows);
const s = await c.query(`select s.name, o.availability, o.course_fee::float as fee from session_offer o join subject s on s.id = o.subject_id where o.session_id = $1 order by s.name`, [seed.sessionId]);
console.log(s.rows);
await c.end();
