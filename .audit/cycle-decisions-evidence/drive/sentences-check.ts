// The review of dd68598, item 4: decision 14's desk, finance and checkout sentences, each as its screen builds it,
// through the decisions dictionary and its rules (lib/i18n-decisions.ts). Run with the API's tsx.
import { readFileSync } from 'node:fs';
import { decisionsArabic, translateDecisionsText } from '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/cycle-decisions/apps/web/lib/i18n-decisions.ts';

const WEB = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/cycle-decisions/apps/web/';
const src = (p: string) => readFileSync(WEB + p, 'utf8');
const out: Record<string, unknown> = {};
// Static sentences: present in their screen's source exactly as the dictionary's key.
for (const [file, text] of [
  ['app/(app)/desk/desk.client.tsx', 'Transfer found — added to the balance'],
  ['app/(app)/desk/desk.client.tsx', 'Add to the balance'],
  ['app/(app)/finance/finance.client.tsx', 'Withdrawal rejected — unreleased amount returned to the balance.'],
  ['app/(app)/finance/finance.client.tsx', 'Receipt returned — any pending drop refund has been released to the balance.'],
  ['app/(app)/checkout/checkout.client.tsx', 'Only if you have not paid. What your balance paid toward it goes back to the balance.'],
] as const) {
  out[text] = { inSource: src(file).includes(text), arabic: decisionsArabic[text] ?? null };
}
// Sentences with data, built as desk.client.tsx builds them: the dialogs' labels (lines 503 and 520, formatPrice's
// "EGP 8,800" after the page's normalising of its no-break space), a reference, an amount.
const undoLabel = 'The transfer recorded today against EGP 8,800 by InstaPay';
const transferLabel = 'EGP 8,800 by InstaPay';
for (const text of [
  `${undoLabel}. Its amount is taken back from the student's balance and it leaves today's takings; the payment can then be recorded again. Possible only today, and only while that amount is unspent.`,
  `${transferLabel} (the family gave reference IPX-PLACEHOLDER-0001). The payment had already closed, so its subjects stay as they are; the amount that arrived is added to the student's balance, to use on a later payment or take back as cash. This cannot be undone. Recorded in the audit trail and in today's takings.`,
  `${transferLabel}. The payment had already closed, so its subjects stay as they are; the amount that arrived is added to the student's balance, to use on a later payment or take back as cash. This cannot be undone. Recorded in the audit trail and in today's takings.`,
  `Transfer IPX-PLACEHOLDER-0001 recorded — EGP 8,800 added to the student's balance. The family has been told.`,
  `Transfer undone — EGP 8,800 taken back from the student's balance. The payment can be recorded again.`,
]) out[text] = translateDecisionsText(text);
// The desk's templates in the source, so the rules follow the words the screen writes.
const desk = src('app/(app)/desk/desk.client.tsx');
out._templatesInSource = [
  "Its amount is taken back from the student's balance and it leaves today's takings; the payment can then be recorded again. Possible only today, and only while that amount is unspent.",
  "The payment had already closed, so its subjects stay as they are; the amount that arrived is added to the student's balance, to use on a later payment or take back as cash. This cannot be undone. Recorded in the audit trail and in today's takings.",
  "added to the student's balance. The family has been told.",
  "taken back from the student's balance. The payment can be recorded again.",
  'label: `${formatPrice(p.amount)} by InstaPay`',
  'label: `The transfer recorded today against ${formatPrice(p.amount)} by InstaPay`',
].map((t) => desk.includes(t));
console.log(JSON.stringify(out, null, 1));
