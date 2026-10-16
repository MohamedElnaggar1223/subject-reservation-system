// Decision 15's drive: set (or empty) the setting school.name as the admin, through the Settings screen's own
// endpoint, and read the public read a visitor's sign-in page asks. Usage: node school-name.mjs "<name>" | ""
import { signIn, out, API } from './api.mjs';
const name = process.argv[2] ?? '';
const admin = await signIn('admin@igcse.local', 'AdminPass1');
const r = await admin('PUT', '/v1/settings/school.name', { value: name, reason: name ? 'The sign-in page carries the school name (cycle decisions drive)' : 'Emptied again: the app name alone (cycle decisions drive)' }, { raw: true });
out('put', r.status, JSON.stringify(r.json).slice(0, 160));
const pub = await (await fetch(`${API}/v1/settings/public`)).json();
out('public read as a visitor', JSON.stringify(pub));
