/**
 * Machine-readable refusal codes (COORDINATOR_REWORK.md Appendix A; decision 2 of the P1b review).
 *
 * A refused request answers `{ success: false, error: "<the sentence a person reads>", code?: RefusalCode }`.
 * The sentence is unchanged and stays what a screen shows; the code is for a screen that acts on the
 * refusal (P3: point at the line, offer the right next step). A refusal with no code is answered as before.
 */
export const REFUSAL_CODES = [
  // Reserving (§6 "May reserve").
  /** The session is a draft: invisible to families (C4). */
  'NOT_OPEN',
  /** The session, the subject or the row takes no new reservation (closed, or past its close date). */
  'NOT_ACCEPTING',
  /** Past the exam board's deadline: nothing is reserved, paid or confirmed (C6). */
  'BOARD_DEADLINE_PASSED',
  /** The old preregistration of a session not open yet: reservations open when the session opens (C4). */
  'PREREGISTRATION_GONE',
  // Paying (§6 "May pay").
  /** An unpaid line past its last day to pay (the cut-off, C10). */
  'CUT_OFF_PASSED',
  /** The line's price is not final: the session's prices, or (prices final) this subject's price not confirmed (E6). */
  'PRICES_NOT_FINAL',
  /** The line is not waiting for payment (paid, expired, dropped, awaiting a parent's approval). */
  'NOT_WAITING',
  /** The student may no longer be paid for in this session (left the school, cohort corrected). */
  'NOT_ELIGIBLE',
  // Prices and set-up.
  /** The price the family saw is not the price now (as today). */
  'PRICE_CHANGED',
  /** Prices final refused: waiting lines of rows with no exam fee (their fees are set first). */
  'PRICE_NOT_SET',
  /** The impact counts sent back as `expected` are no longer what the change does (A3). */
  'IMPACT_CHANGED',
  // The line rules (D3–D8, D13, F2).
  /** D5: an in-school option of a subject with several teachers, no teacher chosen. */
  'TEACHER_REQUIRED',
  /** D13: a required question of the session or a subject not answered. */
  'ANSWER_REQUIRED',
  /** F2: the system knows the student sat the subject: a retake, not a first entry. */
  'RETAKE_ONLY',
  /** D3: the option's cell is not ticked on the row. */
  'OPTION_NOT_OFFERED',
  /** D3/F6a: a one-paper row is a retake: it takes no first entry. */
  'ONE_PAPER_IS_RETAKE',
  /** D3 (decision 1 of 16 Oct 2026): self study is a second entry only on this row, without the student's exception. */
  'SELF_STUDY_SECOND_ENTRY_ONLY',
  /** A retake names the sitting it follows. */
  'RETAKE_SITTING_REQUIRED',
  /** D6: a row that carries an earlier exam forward, none named. */
  'CARRIED_FROM_REQUIRED',
  /** D6: the earlier exam named is not one the row carries from (her list; else its own board, before it). */
  'CARRIED_FROM_NOT_ALLOWED',
  /** D8: options of one subject that exclude each other. */
  'EXCLUSIVE_OPTIONS',
  /** The board takes one entry per row code per sitting (`gate.sameEntryOnce`). */
  'SAME_ENTRY_ONCE',
  // Paying, again.
  /** A line under an instalment plan is paid by its instalments only (§3.10 item 7). */
  'UNDER_PLAN',
  // Reserving, again.
  /** The student already holds this row in the session (reserved meanwhile: a request, the desk, another tab). */
  'ALREADY_RESERVED',
] as const;

export type RefusalCode = (typeof REFUSAL_CODES)[number];
