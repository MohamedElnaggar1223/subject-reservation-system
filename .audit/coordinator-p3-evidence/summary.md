# P3 — evidence summary (the family's and the desk's screens)

Branch `claude/coordinator-p3`, code at 8495438, driven headless (Chromium through Playwright, axe-core 4.10.2
injected, every rule) on the dev stack of this container: `igcse_p3_dev` on postgres 17 (migrated, reference and
June 2027 pre-load seeded), the API on :3291 and the web on :3290. Families were made through the desk's onboarding,
with invented names and no phone numbers: Salma First (grade 10, a first-timer), Omar Retake (grade 12, who sat Arabic
O.L. in November 2026, recorded by a confirmed desk line in an earlier winter session), and Mona Two with Laila
(grade 11) and Karim (grade 12). Teachers are the pre-load's placeholders. The second round of drives started from a
dump of the database taken before the first. The drive scripts, their raw logs and the screenshots stay in the
session's scratchpad; this file summarises them.

An action is one click that changes something or moves to another screen, or one field filled. Signing in is not
counted.

## The flows

| Flow | Width, language | Actions | axe | Console | Result |
|---|---|---|---|---|---|
| A parent, two children, 10 subjects (prices not final) | 1280, EN | 23 | 0 | 0 | 2 reservations of 5; "You can pay once the school confirms its prices." |
| The same (prices final; one teacher preselected) | 360, EN | 23, menu included | 0 | 0 | "Reserved: 5 reservations waiting for payment." "Pay EGP 90,950" / "Pay EGP 82,840" |
| Refusals at the line | 1280, EN; 360, AR | — | 0 | the browser's 409 for the refused request | unfinished choices marked at their card and question; a subject closed while the page was open: refused at its card with "Take it off the choices", taken off on the re-read with its reason kept; the rest reserved |
| First-timer pays at the school | 1280 and 414, EN | 2 (home to reference) | 0 | 0 | one payment, EGP 36,700 for 2 subjects; the officer confirms; statement paid, receipts |
| Retaker: a known retake and a declared one, InstaPay | 1280; 414, EN | 15; 16 with the menu | 0 | 0 | "When did your child sit it?" lists November 2026 / June 2026 / November 2025 / June 2025; under verification "kept until 21 Feb 2027" on the checkout, the statement and home; confirmed; the known retake recorded as known, November 2026 |
| The desk: find the student, reserve 2 more, collect everything | 1280, EN | 9 | 0 | 0 | one payment, EGP 120,790 for 7 subjects (5 reserved at home, 2 at the desk), 7 receipts |
| The desk with subjects waiting | 1280, EN | — | 0 | 0 | the hint "5 subjects are already waiting for payment: reserve only, then collect everything in one payment"; "Reserve and collect" disabled; the balance capped at the subjects' total |
| Past the last day to pay | 1280, EN | — | 0 | the browser's 400 for the refused payment | refused at its line with "Take it off this payment"; opened again, the line is shown apart and left out of the total; "Pay by" is the earliest last day of the lines being paid |
| A student asks, the parent approves | 1280, EN | 6 (the student) | 0 | 0 | "Sent to your parent for approval: 1 reservation."; approvals show the reservation page's words; after approval the list is empty |

**The desk against the spreadsheet** (CLAUDE.md, UX_AUDIT.md §4). The same visit in the school's sheet takes
about 30 steps, with every fee remembered or looked up: find the family's row (Ctrl+F, 1–2 steps); type each subject
and its choice (2 per subject); look up each fee on the printed list and type it (2 per subject); add them up by
hand; write a receipt per subject (7) and a cash-book line. Here it takes 9 actions, and nobody types or remembers a
price, a teacher or a date.

## Every family and desk screen

The screens checked: the parent's Home, Reserve, Checkout, Registrations, Approvals, Statement, Reservation slip and
Balance; the student's Home, Reserve and Registrations; the officer's desk with the reservation page and the
statement. Each was checked in English and Arabic at 1280, 414 and 360 px, for axe violations, console errors,
sideways scrolling, and English left on the Arabic pages.

| Round | Screen visits | With an axe violation, console error or sideways scrolling |
|---|---|---|
| 1 (01:28–01:35Z) | 72 | 5: the registrations child filter and the swap selects had no label; the desk statement's teacher column had an empty header; at 414 and 360 px, the desk's scrolling tables could not be reached by keyboard. All four were fixed. |
| 2 (after the fixes) | 72 | 0 |
| 3 (the final code, 8495438; 1280 and 360 px) | 48 | 0 |

English left on the Arabic pages:

- In round 1, a split count ("registration") and the desk's internal note "[DESK] Registered at the finance desk".
  Both were fixed.
- Since then, only people's names, the English subject names (kept in English by the wording rule), the board names,
  and the app's title "نظام حجز مواد IGCSE".

## Words

- `scripts/check-reservation-words.mjs` checks 28 files, `lib/i18n-reservations.ts` and 25 names from
  `@repo/validations`. None of these words appear: award, suite, series, sitting, component, mapping, option code,
  provisional, cut-off, offer item. It also finds none of the Arabic words دورة, سلسلة, مكوّن or مؤقت.
- Its planted-word controls (`check-reservation-words.test.mjs`) pass, 7 of 7.
- P2's check (`check-setup-words.mjs`) finds nothing, and its controls pass, 7 of 7.
- Both checks run in CI.

## What was not driven

- **Online card payment:** main has no online card checkout. `ACTIVE_PAYMENT_METHODS` is `in_school` and
  `instapay`, so a card is taken at the desk ("Credit / Debit Card" under "Paid with").
- **Choices removed after a re-read:** a choice the re-read no longer offers, or two picks whose refusal names them
  alike. The locator (`lineNamedBy`) was checked on sample sentences, not in a drive.
- **Swaps:** the swap list leaving out rows the student already holds.
