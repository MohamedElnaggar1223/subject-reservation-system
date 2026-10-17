/**
 * Money in the families' and staff's words (F8-10; docs/features/WALKTHROUGH_FINDINGS.md §4): the API's own
 * sentences — notifications, emails, refusals — and the screens say an amount as "EGP 16,850" and a payment's
 * method in words ("by InstaPay", "in cash at the school"), never "16850.00 EGP" or a code ("in_school"). The
 * family's money with the school is its "balance" (the lead's decision 14 of 16 Oct 2026); "escrow" stays the
 * code's and the audit's word.
 */

import type { PaymentMethod, InSchoolInstrument } from './payment.validations';

/** An amount as the screens show it: "EGP 16,850"; piastres only when there are some ("EGP 1,234.50"). */
export function formatEgp(amount: number): string {
  const r = Math.round(amount * 100) / 100;
  const digits = Number.isInteger(r) ? 0 : 2;
  const text = Math.abs(r).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: 2 });
  return `${r < 0 ? '-' : ''}EGP ${text}`;
}

/** How a payment was made, as a sentence says it after the amount ("Payment of EGP 9,850 by InstaPay"). */
export const PAYMENT_METHOD_WORDS: Record<PaymentMethod, string> = {
  in_school: 'at the school',
  instapay: 'by InstaPay',
  fawry: 'through Fawry',
  card: 'by card',
  mobile_wallet: 'by mobile wallet',
  bank_transfer: 'by bank transfer',
  held_deposits: 'from the instalments held for it',
};

/** What was handed over at the finance desk, in the same place in the sentence ("in cash at the school"). */
export const IN_SCHOOL_INSTRUMENT_WORDS: Record<InSchoolInstrument, string> = {
  cash: 'in cash at the school',
  card: 'by card at the school',
  instapay: 'by InstaPay at the school',
  other: 'at the school',
};

/** A payment's method in words, with the desk's instrument where it was recorded; a code is never printed. */
export function paidByWords(method: string, instrument?: string | null): string {
  if (method === 'in_school' && instrument && instrument in IN_SCHOOL_INSTRUMENT_WORDS) {
    return IN_SCHOOL_INSTRUMENT_WORDS[instrument as InSchoolInstrument];
  }
  return PAYMENT_METHOD_WORDS[method as PaymentMethod] ?? 'by another method';
}
