# P2 fix round — evidence summary (L13)

Branch `claude/coordinator-p2`, code at 75da52e (the review's fixes), driven headless (Chromium through Playwright, axe-core 4.10.2 injected, every rule) on the dev stack of this container: `igcse_p2_dev` on postgres:17.5, `seed:reference` (3 boards, 36 sittings, 27 subjects, 61 rows) and `seed:june-2027` (25 subjects, placeholder teachers). Each flow starts from the pre-load restored from its dump. The drive scripts and their raw outputs stay in the session's scratchpad; this file is their summary.

An action is one click that changes something or moves screen, or one field filled; sign-in is not counted. Course fees are not in the counts (the forms do not hold them; the lead's acceptance of the mock).

## The five acceptance flows

| Flow | Her actions | Admin actions | Screens checked with axe | axe violations | Console lines | Forbidden words | Read back |
|---|---|---|---|---|---|---|---|
| review | 22 | 2 | 3 (admin Home; Home; Session) | 0 | 0 | 0 | {"status":"active","blocked":false,"left":{"price_not_set":25,"teacher_tbc":1,"carried_from_too_old":1}} |
| arabic | 7 | 0 | 2 (Session subjects; editor arabic) | 0 | 0 | 0 | {"dialog":0,"status":"Saved. / Not offered to families until every price is set. / Saved.","teachers":["T-ARABIC-OL-1","T-ARABIC-OL-2","T-ARABIC-OL-3"],"rows":["All papers: firstInSchool+retakeInSchool+retakeSelfStudy","Paper 1 only: retakeInSchool+retakeSelfStudy [june 2027]","Paper 2 only: retakeInSchool+retakeSelfStudy [june 2027]"]} |
| biology | 8 | 0 | 2 (Session subjects; editor biology) | 0 | 0 | 0 | {"dialog":0,"status":"Saved. / Not offered to families until every price is set. / Saved.","teachers":["T-BIOLOGY-AL-1"],"rows":["Unit 1 (WBI11): retakeSelfStudy","Unit 2 (WBI12): retakeSelfStudy","Unit 3 (WBI13): retakeSelfStudy","Unit 4 (WBI14): retakeSelfStudy","Unit 5 (WBI15): firstInSchool+retakeSelfStudy","Unit 6 (WBI16): firstInSchool+retakeSelfStudy"]} |
| physics | 10 | 0 | 3 (Session subjects; editor physics; editor physics, More options) | 0 | 0 | 0 | {"dialog":0,"status":"November 2026 is 19 months before this exam: older than Cambridge International carries a result forward (13 months). It stays, since your list wins; the board may refuse the entry. / Saved. / Not offered to families until every price is set. / Saved.","teachers":["T-PHYSICS-OL-1"],"rows":["A.S.: firstInSchool+retakeInSchool+retakeSelfStudy","A.2. (carry forward): retakeSelfStudy+firstSelfStudy [june 2027, november 2026]","A.L.: —"]} |
| copy | 14 | 6 | 6 (Home; Sessions; New session; Session (copy); Prices; Prices, a list read) | 0 | 0 | 0 | {"name":"June 2028","status":"active","pricesFinal":true,"offerings":25,"offered":0,"copiedFrom":"June 2027","left":{"price_not_set":25,"teacher_tbc":1,"carried_from_too_old":1}} |

- **review** — the pre-loaded June 2027: the admin enters Cambridge's June 2027 entry deadline (date, Save the date); she presses Looks right 19 times on Home (one for the 33 default ticks on 23 subjects, 18 for the pre-load's notes), Keep them, Open June 2027, the Accepting switch.
- **arabic, biology, physics** — from scratch in an empty June 2028: pick from the board's list and Add, then her form's differences, Save; each read back from the API as above (the earlier exams after unticking November 2027; Physics adds November 2026, warned as older than Cambridge carries a result forward, and kept).
- **copy** — June 2028 by copying June 2027: All sessions, New session, Create (June, 2028 and the copy picked for her), Keep them, Prices, the Cambridge list pasted, Read, Use, Pearson Edexcel, its list pasted, Read, Use, Prices final, the Accepting switch; the admin enters the three boards' June 2028 deadlines (six actions).

Targets (COORDINATOR_REWORK.md §13 P2): 40, 10 each, 30. The same counts as the first round (22 + 2, 7, 8, 10, 14 + 6).

## Her screens, toured

On June 2027 open with five lines in several states: Home, Sessions, the Subjects, Prices, What families agree to and Reservations tabs, and three subject editors with More options open — as the coordinator in English (9 screens) and Arabic, and as the admin; finance's Money, Prices and Reservations.

- axe: 0 violations on all 30.
- Console: no line on any.
- Forbidden words on the rendered pages (text, aria-label, placeholder, title, optgroup label): none on her screens; finance's Money tab keeps its "Series" column (finance's and the admin's screen, not hers; recorded in the first round).

## Each item's drive

| Item | What was driven | Result |
|---|---|---|
| S1 | a question added to Business O.L., closed a day ago with 2 unpaid lines | asks "This changes 2 reservations…"; the text stays while asking and after Cancel; cleared once saved; Remove goes the same way |
| S2, L2, Lead 2, L11 | the defaults' Looks right with two subjects answered by a route (saved:false, 409); an unknown code, a disagreeing late date, three subjects off the list injected; a lookalike teacher | 23 saves tried; "These were not saved: Business O.L.: This changes 2 reservations… · Chemistry O.L.: …"; list re-read; the API's sentences shown; one not-on-the-list line; the doubt worded; English and Arabic |
| S3, S7, L14 | the coordinator and the admin on a draft; a typed close date then Clear | no Delete for her; the admin deletes June 2028 with a reason and lands on Sessions; the close date's line under the field; one PUT {closesAt:null} |
| Review's Clear paths | (A) a Payment due typed then Clear; (B) Clear then leaving the field; (C) Clear pressed while the due date's save asks (a route) | (A) due saved, then the close cleared; (B) one PUT, no error; (C) the question stays, Save it, then the clear |
| S4, S6 | another tab changes the course fee (7000, then 8000 while she is in the field); a June row's Closes on | the field follows the stored fee; leaving it untouched sends nothing; a typed 9000 is saved; Closes on 5 March 2027 saved and shown |
| S5, L1 | the share picked then cancelled; arrows then Enter | the select goes back to 50; arrows walk (55, 60) with no save; Enter asks |
| L12 | four lines expired, prices final on | the switch locked with "Families have reserved: prices stay final."; the API refuses final:false |
| Lead 1 | two subjects renamed to "Mathematics A.S./A.L." and "Arabic OL" | read once, "Arabic O.L.", on the tiles, Home and the editor, English and Arabic |
| L3, L4 | the coordinator opening five parked screens by URL; per-role answers | each lands on Sessions; /today stays; /exams/candidates hidden for admin and coordinator, shown for finance |
| L6, L7 | five lines in each live status; the session closed with one line waiting, then with none | the statuses in plain words, "Arabic O.L.", "November 2027 declared"; Home's block while a line waits, none after |
| L11 (optgroup) | the editor's teacher list in Arabic | "معلمو المدرسة" |
| L15 | another tab adds a row and sets the course fee while she edits | "Changed elsewhere since you opened this subject" names both, nothing sent; Reload shows them; the next save goes through |

## The words check

`node apps/web/scripts/check-setup-words.mjs`: 18 files (her 11 screens and the 7 shared components she meets), lib/i18n-setup.ts, the Arabic every lib/i18n* dictionary gives her phrases, and 21 names imported from @repo/validations — none of award, suite, series, sitting, component, mapping, option code. Its controls, `node --test apps/web/scripts/check-setup-words.test.mjs`: pass 7, fail 0.

## Gates (this container, on 7d544fb; Gate 2 and the words again on 75da52e)

Gate 0 clean; reference:check OK; Gate 1 exit 0; Gate 2 exit 0; Gate 3: Test Files 47 passed (47), Tests 883 passed, 1 todo (884), 838.6 s.
