// F6 dev data, part 6: family C's parent drops C2's paid Physics A.S. line (the ordinary drop; within the
// refund window the course fee is refunded to the family's wallet). The receipt, if one was printed,
// is the desk's to take back first (receipt-gated drop): the answer says so when it is.
import { signIn, out } from './api.mjs';
const parentC = await signIn('parent.c@igcse.local');
const line = process.argv[2];
out(JSON.stringify(await parentC('POST', `/v1/registrations/${line}/drop`, { reason: 'The family changed its plan' }, { raw: true })).slice(0, 800));
