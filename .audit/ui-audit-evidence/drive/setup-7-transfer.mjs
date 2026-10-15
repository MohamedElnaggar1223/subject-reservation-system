// F6 dev data, part 7: family B pays Mathematics P1 by InstaPay and gives its reference (a transfer the
// admin confirms on Payments); family C asks for 10,000 of its wallet back (a withdrawal on Escrow).
import { signIn, out } from './api.mjs';
const [b1, mathsLine, c2] = process.argv.slice(2);
const parentB = await signIn('parent.b@igcse.local');
const p = await parentB('POST', '/v1/payments/initiate', { registrationIds: [mathsLine], paymentMethod: 'instapay' });
out('initiated', JSON.stringify(p).slice(0, 300));
out('reference', JSON.stringify(await parentB('POST', `/v1/payments/${p.id}/instapay-reference`, { reference: 'IPX-PLACEHOLDER-0001' }, { raw: true })).slice(0, 300));
const parentC = await signIn('parent.c@igcse.local');
out('withdrawal', JSON.stringify(await parentC('POST', '/v1/escrow/withdraw', { studentId: c2, amount: 10000 }, { raw: true })).slice(0, 300));
