# P4a — the UI pass: evidence summary

Written by the lead from the implementer's two reports (the subagent harness refused report files) and the lead's own drive, 28 Oct 2026.

## Final walk
140 visits: every changed screen as each role (coordinator, admin, finance admin, a parent of two, a parent of one, two students, the desk), in English and Arabic, at 1280 and 360 px. Every visit: axe 0 violations, console 0 errors, no horizontal scroll. English left on Arabic pages is data only (names, codes, board names).

## Acceptance numbers (driven from fresh restores)
| Flow | Target | P2/P3 | P4a |
|---|---|---|---|
| Review the pre-loaded June 2027 | ≤ 40 | 22 + 2 admin | 23 + 2 admin (+1: Keep it) |
| Arabic O.L. from scratch | ≤ 10 | 7 | 7 |
| Biology A.S./A.L. from scratch | ≤ 10 | 8 | 8 |
| Physics A.S./A.L. from scratch | ≤ 10 | 10 | 10 (11 with the editor's Keep it) |
| June 2028 by copying | ≤ 30 | 14 + 6 admin | 14 + 6 admin |
| Parent of two, 10 subjects, 360 px | ≤ 30 | 23 | 19 (English and Arabic) |
| Desk walk-in: find, reserve 3, collect | count | 9 | 8 |
| A family's started pay-at-school payment taken at the desk | — | not possible | 3 (subjects); 5 for a charge and the subjects |

## Words checks
- check-setup-words: 18 files clean, controls 7/7.
- check-reservation-words: 35 files clean (Home, history, registrations, My requests, the receipt print and Approvals added); it now forbids "payment due", "pending payment", "board fee(s)" and "registration(s)" in the family screens' own rendered strings; controls 9/9. Run over the screens before the fixes, the rule found 38 strings.

## Gates
Gate 0 clean; reference:check OK; Gates 1 and 2 exit 0; Gate 3 local 47/47 files, 831 passed, 1 todo; CI 40620662956 green on 51f7aff.

## The lead's drive
- The desk took Karim's started pay-at-school payment (SCH-C6757162, EGP 24,850) from the reference typed in lowercase: 3 actions; the payment completed, Physics confirmed with its receipt, the day's takings up.
- Her "Keep it" on the pre-loaded June 2027: the older-exam line left the check list (24 → 23).
