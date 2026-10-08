// Step C's refund preview (refundFor) for the lines named in LINE_IDS, as JSON — run against the
// same copy after step C's migrations (the "after" of the proof). Evidence only (git-ignored).
import { previewRefund } from '../../../apps/api/src/services/refund.services';

(async () => {
const ids = (process.env.LINE_IDS ?? '').split(',').filter(Boolean);
const out: Record<string, unknown>[] = [];
for (const id of ids) {
  const p = await previewRefund(id);
  out.push({ id, percentage: p.percentage, amount: p.amount, fullPrice: p.fullPrice, basis: p.basis });
}
console.log(`PROOF ${JSON.stringify(out)}`);
process.exit(0);
})();
