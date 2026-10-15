// Print an API read as an account: node peek.mjs <email> <password> <path> [jq-ish key path]
import { signIn } from './api.mjs';
const [email, password, path, keys] = process.argv.slice(2);
const call = await signIn(email, password);
let v = await call('GET', path);
for (const k of (keys ?? '').split('.').filter(Boolean)) v = v?.[k];
console.log(JSON.stringify(v, null, 1).slice(0, Number(process.env.MAX ?? 6000)));
