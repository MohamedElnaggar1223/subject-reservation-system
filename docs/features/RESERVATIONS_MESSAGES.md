# Reservations rework — step D (agent D): messages and reminders

Branch `feature/rework-messages`, from `origin/main` b76eae4 (8 Oct 2026; A's, B's and C's steps
merged), with `origin/main` 2a26557 merged in at 5c2f2bf. The design is `RESERVATIONS_REWORK.md` version 8: §3.8 (the model), §4.6 (the Money tab's
"Remind"), §4.8 (the screen), §5 (the endpoints), §7 (the migration of announcements), §8 (08s and
the 09 rule) and §9 step 3. The admin's points are SCHOOL_FORMS.md §5 points 5 and 6 (broadcast,
batch and direct; email and WhatsApp; not deletable by families; automated repeating reminders for
payments and deadlines). The trail is `.audit/rework-messages.tsv`; the evidence (suite logs as
their vitest summaries, controls, the migration proof, screenshots, the step counts) is
`.audit/rework-messages-evidence/`. The progress log is the last section.

Resources (FEATURES_PLAN.md §7): test database `igcse_rwd_test`, dev database `igcse_rwd_dev` (a
copy of `igcse_template_dev`), API 3131, web 3130.

---

## 1. The model as built

Migrations after C's 0049 (main's last): `0050_rework_messages_structure` (generated, additive),
`0051_rework_messages_backfill` (custom, idempotent: a second run inserts nothing), and after the
review of 5c2f2bf `0052_rework_messages_claim_day` (generated: `reminder_sent.sent_on`, nullable,
and its unique index), `0053_rework_messages_claim_day_backfill` (custom, idempotent: the day from
the reminder message's `context.dueAt`, else `sent_at`, in Cairo) and
`0054_rework_messages_claim_day_required` (generated: NOT NULL). Each journal `when` is later than
the one before it (0049's 1791437760565 → 1791444538626, 1791444609348, 1791453573346,
1791453585318, 1791453628209). Nothing is dropped: `scheduled_announcement` stays one release (§7
step 3), its rows moved to messages.

| Table | What it holds | Rules the database keeps |
|---|---|---|
| `message_audience` | `kind` (`broadcast`, `batch`, `direct`), the `definition` (json, `AudienceDefinition` in `@repo/validations`), `resolved_count` / `resolved_at`; a **saved** one has a `name` and is offered in the picker; `legacy` (the old recipient group it came from) | a saved name once (case-insensitive); a saved audience is named. A message's own audience is a copy, never edited, so the log says who it went to as it was resolved |
| `message_template` | the school's texts: `title_en`, `body_en`, `title_ar`, `body_ar`, `active`; a built-in one has a `key` (`payment_due`, `payment_overdue`, `session_closing`, `entry_deadline`, `school_fee_due`, `school_fee_overdue`, `declared_retakes_to_verify`) | a key once; a name once |
| `message` | the audience, a template **or** written text (`title`, `body`, optional `title_ar`, `body_ar`), `language` (`en`, `ar`, `both`), `channels` (`in_app`, `email`; `whatsapp` reserved), `context` (`{ sessionId }` for `{session}`/`{closes}`), `notification_type` (what its in-app rows are), `source` (`staff`, `reminder`, `legacy_announcement`), `reminder_rule_id`, `status` (`scheduled`, `sent`, `cancelled`, `failed`), `scheduled_at`, `sent_at`, `recipient_count`, `error`, the cancel's who/when/why, `legacy_announcement_id`, `created_by` | text present; a scheduled one has its time, a sent one its `sent_at`; a reminder has its rule and only a reminder does; channels within the three; one message per old announcement |
| `message_delivery` | one per recipient × channel × the student it is about (`student_id`: a parent's child, or the student themself): `status` (`queued`, `sending`, `sent`, `failed`), the `title` and `body` as sent, the `address` an email went to, the in-app `notification_id`, `error`, `attempts`, `sent_at` | **one** per (message, recipient, channel, student) — a unique index; a notification belongs to one delivery; a failed one says why; a sent one has its time |
| `reminder_rule` | `kind` (`payment_due`, `session_closing`, `entry_deadline`, `school_fee_due`, `declared_retakes_to_verify`), `session_id` (null: every session; a session's own rule overrides there), `offsets_days` (−7 = seven days before the anchor), `repeat_every_days` after the last offset, `until` (`paid`, `closed`, `deadline`, `verified`, the kind's), `channels`, `template_id` and `overdue_template_id` (the text for the days after the date), `active`, `inherits_at` (a session's rule dropped: the session follows every session's rule again) | one rule per kind for every session, one per kind and session; 1–12 offsets; a repeat of 1–60 days; channels within the three; the rule for every session never "inherits" |
| `reminder_sent` | **the claim**: `kind`, `target_kind` (`line`, `charge`, `session`, `series_entry`, `series_retake`, `verification`), `target_id`, `anchor_on` (the anchor's Cairo day), `offset_days`, the student, the session, the `message_id`, `sent_at`, `sent_on` (the school's day the scheduler sent it on) | **unique (kind, target kind, target, anchor day, offset)**: a second scheduler instance's insert conflicts and sends nothing (ST-06, ST-12); **unique (kind, target kind, target, anchor day, `sent_on`)**: one reminder a day per target and date, whatever rule changed during the day; a moved date is a new day, so a re-dated line is reminded on its new date |

The notification types families see gain `SCHOOL_MESSAGE` (a message to a list or chosen people),
`PAYMENT_REMINDER` (a payment or school-fee reminder, and a money list's message) and
`STAFF_REMINDER`; a broadcast stays `BULK_ANNOUNCEMENT` and a closing reminder
`SESSION_CLOSING_SOON`, as families have always received them. The audit actions gain
`MESSAGE_SENT`, `MESSAGE_SCHEDULED`, `MESSAGE_CANCELLED`, `MESSAGE_FAILED`, `REMINDERS_SENT`,
`REMINDER_RULE_SET`, `MESSAGE_TEMPLATE_SAVED`, `MESSAGE_AUDIENCE_SAVED`, `REWORK_BACKFILL_MESSAGE`.

**Settings** (F0a's store, a new group "Reminders" on the Settings screen, in English and Arabic):
`reminders.enabled` (**off when the system is installed**, decided by the lead on 8 Oct: nothing
goes out until the admin turns it on, once the first sessions and fees are checked; the first minute
after that sends each target its latest day only; admin) and `reminders.sendAtHour` (9, Cairo time,
1 to 23 — midnight does not exist on the day Egypt's summer time starts; admin, finance admin). The
production checklist (SECURITY_AUDIT.md §6) has the line.
The rules themselves are rows, edited on Messages › Reminders (decided with the lead, 8 Oct: the
same offsets are not kept in two places).

**Seeded by 0051**: the seven texts in English and Arabic; one rule per kind for every session with
the prototype's defaults — payment due −7, −3, 0, +3 then every 3 days until paid, in-app and
email, the overdue text after the date; reservations closing −14, −7, −1; the board's entry
deadline −14, −1 to staff in the app; the school fee −14, −7, 0 then every 7 days until paid;
declared retakes −14, −7, −3, −1 to the coordinator in the app; nine saved audiences: the old form's
six groups under their old names ("All Users", "All Students", "All Parents", "Grade 10/11/12
Students") and "Parents of grade 10/11/12", which the old form could not reach.

**The migration of announcements (§7)** — every `scheduled_announcement` row becomes a message
with a broadcast audience of its own (pending → `scheduled`, sent, failed, cancelled), its
deliveries the notifications it wrote (in-app) and, where it was emailed, an email delivery per row
(sent when the row's `email_sent_at` was set, else failed with "No email was recorded as sent for
this announcement (before messages)"). An announcement sent at once never had a queue row: it is
the `BULK_ANNOUNCEMENT` notifications one insert wrote (the same title, text and instant), its
recipient group read from its `ADMIN_ANNOUNCEMENT` audit row when one matches. No notification is
touched; one `REWORK_BACKFILL_MESSAGE` row per moved announcement. Proved on two copies (§3.6).

---

## 2. The contracts read from A, B and C

Nothing of A's, B's or C's services changed; step D reads through their exports, and three small
additions outside its files are listed at the end of this section.

| From | What | What step D assumes of it |
|---|---|---|
| A | `registration.due_at`, kept by `dueDateFor` and re-dated by `redateLines` / `redateSeriesLines` (`deadline.services.ts`, RESERVATIONS.md §2.6, §2.11) | the line's due date is current: the reminder's anchor is read from the row, and a re-dated line's new day is a new claim |
| A | `line_effective_deadline(...)` (SQL) and `effectiveDeadlinesOf(executor, ids)` | a line past its effective deadline is not reminded (it expires); a declared sitting's deadline is the one B's To verify list shows (the late entry of Q-20 counted) |
| A | `getSessionMoney(sessionId, { filter, offerId, sectionId })` (`session-money.services.ts`) | a session's unpaid families are the lines the Money tab shows as `unpaid` with its filter, subject and section — so "Remind" reaches exactly the families on the screen |
| A | `getTeachingDemand(academicYearId)` (`enrolment.services.ts`, F1's contract, §10) | a teaching group is the open in-school enrolments of one subject (and unit) with one teacher; F1's own group table is not on main |
| B | the To verify list's rows (declared by the family or the desk, `prior_sitting_verified_outcome` null, waiting or confirmed) — `listToVerify`'s own conditions | a declared sitting is reminded to the coordinator until it is answered |
| B | `formatSeriesName(...)` (`statement.services.ts`) | a series named as the statement names it |
| C | `charge.due_at` (C's `chargeDueAt`), `charge.status`, `payment_charge` | a charge awaiting payment with no payment open is owed; an instalment's date is its own |
| C | `chargeRules(tx, charge, now, { forPayment: true })` (`charge.services.ts`) | a charge C refuses to be paid now (its deadline, a service fee still provisional) is not reminded and not listed as owed |
| C | `listCharges({ sessionId, status }, viewer)` | a session's charges are the ones the Money tab's charges table shows |
| C | a live plan = an active `plan.instalments` exception on the line (`livePlanOf`'s condition) | a line under a live plan is paid by its instalments: the instalments are reminded, the line is not (consistent with C's later rule that a plan line owes its price less its deposits) |
| A | the lock order, §2.1: the session before its lines | the reminder step takes its groups' sessions `FOR KEY SHARE` in id order before their lines and charges: the claim's session foreign key would otherwise take the session after the lines, and `updateSession` / `correctSessionSeries` take the session `FOR UPDATE` and then its lines — a deadlock the reviewer reproduced (added to RESERVATIONS.md §2.1) |
| C | `payableAcademicYears()` (`school-fee.services.ts`) | the years a pushed school fee can be for |
| F0a | `getSetting`, `gradeTodaySql`, `parent_student_link` (approved), `user.left_on`, `user.banned` | a grade is today's; a left or banned person is not a recipient; a family is the approved links |

**Changed outside step D's own files** (each small, each named here):

1. `apps/api/src/services/notification.services.ts` and `routes/notification.routes.ts`: the
   admin's bulk announcement, its scheduled queue and its three routes (`POST /notifications/admin/
   announce`, `GET /notifications/admin/scheduled`, `DELETE /notifications/admin/scheduled/:id`) are
   removed — replaced by `/v1/messages` (decided with the lead, 8 Oct), so a scheduled announcement
   cannot bypass the message tables. Families' routes are unchanged. `integrations/email.ts`:
   `sendBulkAnnouncementEmail` replaced by `sendMessageEmail` (Arabic paragraphs right to left).
2. `apps/api/src/jobs/session-closer.ts`: NOT-002's hard-coded 24-hour closing reminder and
   `processScheduledAnnouncements` leave the tick; `runMessagesStep` joins it (§3.3).
3. `apps/api/src/services/settings.services.ts`: a setting's `unit` may be `hour` (the type cast).
4. The web: A's Money tab renders `<Remind …/>` in place of its disabled button (one line and its
   import); F0a's Settings screen gains the Reminders group and the `hour` unit; the families'
   notification page shows a message in two languages as two paragraphs, each in its own direction,
   and colours the three new types; `nav-shell.tsx` replaces "Announcements" with "Messages" (and
   adds it for finance); `/admin/notifications` redirects to `/admin/messages`.
5. The suite: `authz-policy.tsv` (the three old rows removed, thirteen added), `08f`'s settings map
   (two keys, trail row), a case in `05`, a block in `08t` and in `09`.
6. After the review of 5c2f2bf: `docs/features/RESERVATIONS.md` §2.1 (A's lock order) gains the
   reminder step's paragraph; `SECURITY_AUDIT.md` §6 (the production checklist) gains the line on
   turning reminders on.

---

## 3. As built

### 3.1 Endpoints (each has its row in `apps/api/test/authz-policy.tsv`)

| Endpoint | Who | Notes |
|---|---|---|
| `GET /v1/messages?status&source&limit` | admin; finance (officer, admin) | the log: each message with its audience as resolved, its channels, the deliveries by channel and outcome; finance sees the money lists' messages and the payment reminders only |
| `POST /v1/messages` | admin; finance for the money lists | `{ audience: { savedId } | { definition }, templateId | title, body (+ titleAr, bodyAr), language, channels, scheduledAt?, context?: { sessionId }, saveAudienceAs? }` — now (written in one transaction, emails sent after it) or scheduled |
| `POST /v1/messages/:id/cancel` | admin; finance for its own lists | `{ reason }`; only a scheduled message (409 after it was sent). Not in §5's list: the old form could cancel a scheduled announcement, the screen keeps it |
| `POST /v1/messages/audiences/resolve` | admin; finance for the money lists | how many people, how many messages (one about each child in a money list), a sample with each one's variables, the students found (the "Remind" dialog's ticks), what the audience can fill |
| `GET /v1/messages/audiences` | admin; finance (the money lists among them) | the saved audiences |
| `GET /v1/messages/lists?sessionId` | admin; finance (sessions, charge kinds, years) | what each list is built from: sessions, the year's sections, a session's offers, the year's teaching groups, the charge kinds, the school-fee years. Not in §5's list: the picker needs it |
| `GET /v1/messages/templates` | admin; finance | the school's texts |
| `POST /v1/messages/templates`, `PUT /v1/messages/templates/:id` | admin | `{ name, titleEn, bodyEn, titleAr, bodyAr, active, reason }`; a text a rule sends cannot be switched off |
| `GET /v1/messages/deliveries?messageId&status&channel` | admin; finance for the money lists' messages and the payment reminders | per recipient and channel: who, about which child, the address, the outcome and why, when, read or not |
| `GET /v1/reminders/rules` | admin, finance admin | the rules (a dropped session rule hidden) and the two settings |
| `PUT /v1/reminders/rules` | admin, finance admin | `{ kind, sessionId | null, offsetsDays, repeatEveryDays, channels, templateId, overdueTemplateId?, active, inherit?, reason }` — the rule row locked before it is read, audited in its transaction |
| `GET /v1/reminders/sent?kind&sessionId&limit` | admin, finance admin | what went out: one row per reminder message — its kind, days, how many students and people, its deliveries |

Removed: `POST /v1/notifications/admin/announce`, `GET` and `DELETE /v1/notifications/admin/
scheduled(/:id)`. **The walkthrough (F8) still shows the old `/admin/notifications` page until it
is regenerated** (the lead, 8 Oct).

### 3.2 Audiences (`message-audience.services.ts`)

Resolved when the message is sent (a grade is today's; the unpaid are those owing now):

- **Broadcast**: everyone (every active student and parent and every member of staff), all staff,
  all families, all parents (every parent account, as the old "All Parents"), all students (not
  left), and for a grade the students, the parents (of the students in that grade) or both.
- **Batch**: a session's unpaid families (A's Money tab with its filter, subject and section, and
  C's charges of the session; what cannot be paid now left out; `studentIds` narrows to the
  families ticked), a section (its open memberships), a teaching group (§2), the reservers of a
  subject offer (live, unpaid or paid lines), the holders of a charge kind (awaiting payment, or
  every live one; a pushed fee by its year). Each reaches the parents, the students or both.
- **Direct**: chosen people, any role.
- A **money list** (a session's unpaid, a charge's holders) is per child: one delivery about each
  student, carrying `{amount}` (what that student owes), `{due}` (the earliest date), `{items}`. Any
  other list is per person: a parent hears once, `{student}` naming their children in the list.
- **Variables**: `{guardian}` (a parent recipient's name; for a student's copy, the parents'),
  `{student}`, `{session}` and `{closes}` (the list's session, or the one the composer names),
  `{amount}`, `{due}`, `{items}` (money lists), `{series}`, `{count}` (staff reminders). A text
  using one the audience cannot give every recipient is refused before anything is sent, naming
  it; an unknown name in braces is refused (a typo never goes out). Dates are the school's day in
  Cairo ("22 October 2026" / "22 أكتوبر 2026"), amounts "EGP 1,500" / "1,500 جنيه".
- **Languages**: a template sends English and Arabic (two paragraphs; the title "English ·
  Arabic") or one of them; written text sends what was written, the Arabic beside it when given.
- **Finance** (the officer and the finance admin) may resolve and send only the **payment lists**
  (`isPaymentList`: a session's unpaid families, or the holders of a charge still unpaid — never the
  holders of a paid one, which with the school fee is nearly every family), and reads only their
  messages and the payment reminders (§5's "finance for payment batches"). Only a payment list's
  message is a `PAYMENT_REMINDER`; any other list's is a `SCHOOL_MESSAGE`.
- **What is owed** in a money list is what the reminder step would remind (one set of predicates,
  `payable-now.services.ts`): not a line on a provisional board fee (unless the school takes payment
  on one), paid by its instalment plan, with a payment open (a checkout, an InstaPay transfer being
  checked) or past its effective deadline; not a charge with a payment open or that C's rules
  refuse.
- **A student who has left the school** (F0a's leaving) or is barred is in no list, nor are their
  parents on their account; the step does not remind about them either.

### 3.3 The scheduler step (`messages-step.services.ts`, in `jobs/session-closer.ts`)

Every minute, each part logging its own failure and the next part still running:

1. **Scheduled messages whose time has come** (`dispatchScheduledMessages`): each claimed by its row
   (`FOR UPDATE SKIP LOCKED`, its status read again under the lock) and sent in that transaction
   (notifications, deliveries, `MESSAGE_SENT`); never before its time; one that cannot be sent is
   marked failed with why (status-guarded).
2. **Reminders** (`runReminders`, `reminder.services.ts`), when `reminders.enabled`:
   - the targets of each kind with their anchors: lines owed (`pending_payment`, or a
     preregistration nobody has paid), no payment open, no live plan, not provisional unless the
     school takes payment on one, before their effective deadline — anchor `due_at`; charges
     awaiting payment with no payment open (not a pushed fee) — anchor `due_at`; pushed school fees
     awaiting payment with no school-fee payment open; open sessions — anchor `end_date`; series
     with a line still waiting — anchors `entry_deadline` and `retake_deadline`; declared sittings
     unanswered — anchor the line's effective deadline;
   - the rule of each target: its session's own (inactive: nothing there) unless dropped, else the
     rule for every session;
   - the offset due now (`dueOffset`, `@repo/validations`): the latest of the rule's days — and the
     repeats after the last one — whose moment has come, the moment being **the anchor's Cairo day
     moved by the offset, at the send hour, Cairo time** (`reminderMoment`), never earlier,
     whatever zone the server runs in; only one after the target existed. A day whose hour passed
     while nothing ran goes out at the next tick, once; days passed over are not sent as a
     backlog (a family is never sent the −7, −3 and 0 at once);
   - what is already claimed is left out before anything is locked (`notClaimed`): the same date and
     offset, or a reminder today about the same date — so a reminder sent costs nothing on the
     minutes after it, and a rule changed during the day never sends a second one (the unique indexes
     stay the guard);
   - for each group (payment kinds: the rule and its text; a session's closing; a series' deadline;
     a session's declared sittings), one transaction: **the group's sessions `FOR KEY SHARE` in id
     order first** (A's order, the session before its lines), then the targets locked `FOR SHARE` in id order and
     **read again in a statement of their own** (under READ COMMITTED a statement sees what
     committed before it began: a payment the desk took while the lock waited is seen, and the line
     is left out), the message (source `reminder`, its batch audience naming the kind, the rule
     and the days), the claims (`INSERT … ON CONFLICT DO NOTHING RETURNING` on either unique index:
     what another scheduler claimed first, or a target already reminded today about that date, is
     skipped; nothing claimed → the transaction rolls back and nothing is written),
     the notifications and deliveries for what was claimed, `REMINDERS_SENT`;
   - recipients: a payment or school-fee reminder to the student's approved parents and the student
     (one delivery about each child; what one student owes on that day summed: `{amount}`,
     `{items}`, `{due}`); the closing of a session to every active student and every parent (as
     NOT-002 reached them); a board deadline to the admin, coordinators and finance, with `{count}`
     lines still waiting; declared sittings to the coordinators (the admin when there is none),
     with the session's count and its first deadline;
   - NOT-002's 24-hour closing reminder is the closing rule's day −1 since step D: a session it
     already reached (`registration_session.reminder_sent_at`) is not reminded again that day.
3. **Emails waiting** (`dispatchQueuedEmails`): each claimed (`queued` → `sending`, a
   status-guarded update), sent, recorded `sent` or `failed` with why ("The email address on file is
   not a valid address", or the email service's refusal); one recipient's failure never stops the
   rest; a sent email marks its in-app twin's notification `email_sent_at`. A message sent now
   starts this for itself after its commit; the tick finishes what is left.
4. **An email a stopped sender claimed** (`sending` for 15 minutes) is marked failed — "it may or may
   not have reached the person" — and never sent again (ST-12).

### 3.4 Screens

- **Messages** (`/admin/messages`; admin, finance admin, finance officer; "Messages" in their nav):
  - *New message*: who — "Everyone or a grade" (one click on a saved group, e.g. "Parents of grade
    11"), "A list in the system" (the list and its session, section, group, subject or charge; to
    parents, students or both), "Chosen people" (search and pick); the resolved count with a sample
    and, for a money list, the messages "one about each child"; keep the list under a name; the
    text (a template, or a title and message with the variables offered where the audience can
    fill them, inserted at the cursor, and an optional Arabic version); the preview of the first
    recipient's copy; the channels (in the app always, email, WhatsApp shown disabled — "no
    business account yet"); now, tomorrow 09:00, or a Cairo time. After a send the audience and
    channels stay. Finance sees only the money lists.
  - *Sent*: every message (staff, reminders, before messages) with its audience, people, the
    in-app and email outcomes, its status; cancel a scheduled one (with a reason); the deliveries
    per recipient (about which child, the channel, the address, sent or failed and why, read).
  - *Reminders* (admin, finance admin): each kind's rule for every session (or the whole school)
    in words ("7 days before, 3 days before, the day, 3 days after; then every 3 days until paid"),
    its channels and texts, on or off; Change (days, repeat, texts, channels, on, reason); a
    session's own rule (session picker, starting from the school's), and "Follow every session's
    rule" to drop it; the two settings with a link; what went out, with the deliveries.
  - *Texts*: the school's texts in both languages; the admin adds and changes them.
- **The Money tab's "Remind"** (A's tab, `remind.client.tsx`): the payment reminder to the
  families the tab shows (its subject, section; under its "Overdue" filter only what is overdue),
  each with what it owes overdue and not yet due and the dates, ticked; untick any; one click sends
  (POST /v1/messages, the payment-list path the finance officer may use) — **per line**: what is past
  its due date with the overdue text, what is not yet due with the due text, one message each (a
  family with both gets one of each). What cannot be paid now (provisional, a payment in progress,
  past its deadline) and plan lines are not in it; a plan's instalments are.
- **Settings**: a Reminders group (on/off, the hour, Cairo time).
- **The families' notifications**: unchanged, but a message in two languages reads as two
  paragraphs, each in its own direction. There is no delete anywhere.
- Arabic for all of it in `apps/web/lib/i18n-messages.ts`, merged in `lib/i18n.tsx` as A's, B's and
  C's files are; right to left checked in the screenshots (`screens/d-2*`, `d-41`).

### 3.5 Step counts (UX_AUDIT §4, RESERVATIONS_REWORK.md §11, §15), measured in headless Chrome

| Task | The school today | Our system before | This step, measured |
|---|---|---|---|
| An announcement to the parents of grade 11, and one for tomorrow | — | 5 inputs, 5 clicks, and "parents of grade 11" cannot be targeted; the form resets between the two | **4 inputs, 4 clicks** for both: the chip, title and message, Send; title and message, "Tomorrow 09:00", Schedule (the audience stays) |
| Remind unpaid families | by hand | not possible | **0 inputs, 2 clicks** from the Money tab (Remind, then "Remind N families"); or nothing at all: the rule sends it |
| A reminder rule set once | — | not possible | **2 inputs, 2 clicks** (Change; the days; a reason; Save) — then it repeats by itself |

Evidence: `measure-counts.json`, `screens/d-0*`. The Excel version: a reminder is a phone call or a
WhatsApp message typed per family from the sheet; the system sends it on its day, once, with the
amount and the date filled in.

### 3.6 Tests (the proof)

- **08s-messages-reminders** (every scenario through the typed client; the scheduler's step called
  as the scheduler calls it, at instants built from Cairo wall times, so it asserts the same in
  local time and TZ=UTC): the seeded rules, texts and settings, WhatsApp refused; a payment reminder
  — nothing before its Cairo day or before 09:00, −7 at 09:00 to the parent and the student once,
  the same minute and the next hour nothing more, a day whose hour passed caught up once, −3, the
  line paid between two days stopped, the unpaid one on the day and then with the overdue text at
  +3, +6, +9; what went out and the log with deliveries per channel; **two scheduler instances at
  once** (the first paused at its audit row, the second held on the first's claim) send once; a
  provisional line skipped, then reminded once confirmed; an instalment and a charge reminded
  together by the payment rule, the plan's line not; a pushed school fee reminded 14 days before
  its date by the school-fee rule, and nothing after it is paid through the school-fee path; a session's own rule overriding, switched off,
  dropped; "parents of grade 11" (the count against an independent query, a parent of grade 10 and
  the students not reached); "Remind" by the finance officer to a session's unpaid families (the
  paid family not, the unticked family not; finance refused a broadcast and a broadcast's
  deliveries); a direct message ({guardian} refused for staff); a scheduled message sent by the tick
  at its time and not before, a cancelled one never, a sent one not cancellable; families cannot
  delete (no DELETE route under /notifications or /messages; marking read keeps every row, the
  student's too); a template with every variable rendered in both languages, literally; a failed
  email recorded, the in-app copy delivered, the other parent's email sent; staff reminders (a
  board deadline with its count, a declared retake to the coordinator until verified, a session's
  closing to the families); reminders off — nothing, and no backlog after; two ticks at once send a
  scheduled message once; a cancel landing while the tick sends waits and is refused; an email a
  stopped sender claimed failed, not re-sent; a session NOT-002 reached not reminded again on −1.
- **08t** (step D block): a payment taken at the desk while the reminder step reads the line (the
  desk paused holding the line): the step waits and reminds nothing; a reminder claimed while the
  desk takes the payment: the payment waits, the reminder goes out once, before the confirmation;
  two senders of one queued email (both held on its row): sent once, one attempt; **the reminder
  step and the admin's change of the session's payment date at once** (the session's own rule held,
  so the step stops inside its transaction; then `PUT /v1/sessions/:id`): 200, the claim made, the
  line re-dated — with the sessions not taken first, Postgres detects the deadlock.
- **08s, after the review of 5c2f2bf**: reminders off as installed, the hour 1–23; Remind and the
  money lists leave out a line whose InstaPay transfer is being checked and a charge with its payment
  open; finance refused the holders of a paid charge (403), the admin's message to them a
  `SCHOOL_MESSAGE`; a target already reminded not locked again (the line held, the next minute's step
  finishes); a rule changed at 09:50 sends no second reminder that day (the next day's goes); a
  leaver's pending charge neither listed nor reminded; a text a session's rule sends cannot be
  switched off (the refusal names the rule); Remind per line (the overdue and the due parts, each
  with its text).
- **05**: B's parent and student cannot mark or list A's copies of a message, reach its deliveries,
  the log, an audience naming A's student, or send; finance cannot read a direct message's
  deliveries or send one.
- **09** (step D block): every reminder sent has its claim row (a reminder message has claims, each
  claim its reminder message and rule, one claim per target, day and offset, and nothing about a
  child's money went out without a claim on that child); no payment reminder was claimed after its
  line or charge was paid; every delivery belongs to a message, an in-app delivery is the
  notification it wrote and every notification a message wrote has its delivery, nothing scheduled
  or cancelled was delivered, a sent email marked its notification; every sent message has its
  audit row and counts the people its deliveries reached.
- **Controls** (each guard undone once, its test red, restored; `controls/`): the claim's unique
  index and conflict skip; the FOR SHARE before the re-read; the owed condition; the provisional
  skip; the scheduled message's row lock and the delivery index (both layers); the cancel's lock;
  the email claim; a failed email recorded; finance's lists; the fillable check; WhatsApp refused;
  the send hour in Cairo; a session's override; NOT-002's day; an interrupted email not re-sent;
  and after the review: Remind's payable-now narrowing; finance's unpaid-only charge list; the
  sessions before the lines; the claimed-target filter; one a day (filter and index); the leaver;
  the text in use; Remind's two parts; the hour 1–23 — twenty-four in all, the earlier fifteen run
  again on the fixed code.
- **The migration** (`migration/`): two copies (the template's and F0a's richer copy), each
  migrated with main's migrations and then seeded **through main's own API, before step D's code**
  (placeholder families; announcements sent at once, scheduled and sent by main's tick, pending,
  cancelled, failed): after 0050–0051 every notification row unchanged (the same digest), every
  announcement its message, every `BULK_ANNOUNCEMENT` notification exactly one delivery; 0051 a
  second time inserts nothing.

---

## 4. Decisions and why (each has its trail row)

1. **The rules are rows; two settings are settings.** "Defaults seeded as settings" read as: the
   defaults are seeded (as rule rows, edited on Messages › Reminders), and the school-wide switch
   and hour are F0a settings with English and Arabic text. Keeping the offsets also as settings
   would put one value in two places. (The lead, 8 Oct.)
2. **The old recipient groups are saved broadcast audiences**, under their old names, plus
   "Parents of grade 10/11/12": a group is resolved by role and grade when sent, which is a
   broadcast in §3.8's terms. "All Users" now reaches every member of staff too (the old one reached
   students, parents and the admin). (The lead, 8 Oct.)
3. **NOT-002 folds into the closing rule** (its −1), and the old admin announce and queue go, so no
   family gets a closing reminder twice and no announcement bypasses messages. (The lead, 8 Oct.)
4. **Recipients**: a payment reminder goes to the approved parents and the student (the student's
   own in-app copy included); a money list is per child; staff kinds to staff. (The lead, 8 Oct.)
5. **A reminder's moment is a Cairo day at the send hour**, not "anchor minus N×24 hours": a due
   date at 23:59 would otherwise remind families at midnight, and a server in UTC would remind a day
   early. Catch-up, not skip: a day whose hour passed goes out at the next tick, once. (The lead's
   note, 8 Oct.)
6. **The latest due day only, after the target existed**: a line reserved two days before its due
   date is not sent "due in 7 days" and "due in 3 days" at once; the system down for a week sends
   each target its latest reminder, not a backlog.
7. **The claim is per kind, target, the anchor's Cairo day and offset**, not per rule, **and at most
   one a day per kind, target and date** (corrected after the review of 5c2f2bf: the first key alone
   let a session's rule changed at 09:50 send its −5 on the day the −3 had gone at 09:00). A
   session's own rule replacing the school's does not re-send a day already sent; a due date moved
   (an exception, a fee confirmed) is a new date, reminded again on its own days; both keys are unique
   indexes, so the database holds the rule whatever the scheduler does.
8. **The target locked FOR SHARE, then read in a statement of its own.** A row locked and checked
   in one statement is re-evaluated only if the row itself changed; the desk takes a payment by
   locking the line and writing a payment row (the line unchanged until it confirms). Reading again
   in a new statement after the lock sees the committed payment. The FOR SHARE does not conflict
   with another reminder step's, and a payment's FOR UPDATE waits for it (08t, both orders).
9. **One message per group**, the deliveries per recipient and child: the log reads "Payment due,
   7 days before: 61 families", not 61 messages; what one student owes on the day is one
   notification ("EGP 29,000 for Student D10 (Biology and Chemistry)").
10. **Records carry the real time; `now` decides what is due.** `sent_at` on messages, deliveries
    and claims is the time they were written, so 09's "never after it was paid" compares real
    times; the suite's chosen instants only choose the day.
11. **An email is claimed before it is sent and never re-sent after a crash** (ST-12's rule for the
    old queue): an interrupted one is failed with that sentence rather than risk a second copy.
12. **A failed address is a delivery failure, not an error**: the school's sheet has missing and
    malformed emails (IMPORT_SPIKE.md); the delivery says so, the in-app copy stands, the rest go.
13. **WhatsApp is a channel with no sender**: in the model and on the screen, refused by the API with
    the reason (the owner, 7 Oct; DISCOVERY.md: no business account).
14. **The composer keeps the audience and channels after a send**: today's form reset between two
    announcements to the same people was the memory load §15 recorded.
15. **Teaching groups from F1's contract** (`getTeachingDemand`): F1's table is not on main; when it
    lands, the list reads it instead, with the same definition fields.
16. **Two endpoints beyond §5**: cancel (the old queue could cancel) and lists (the picker's
    options).
17. **Reminders are off when the system is installed** (the lead, 8 Oct): the setting's default is
    off — so a fresh and a production database start off with no setting row to seed and no audit
    gap — and the admin turns it on once the first sessions and fees are checked; the first minute
    after that sends each target its latest day only, never a backlog (decision 6). The suites turn it
    on where they run the step.
18. **One definition of "owed and payable now"** (`payable-now.services.ts`), read by the step and by
    every money list (the review of 5c2f2bf: "Remind" asked a family whose InstaPay transfer was being
    checked to pay).
19. **The step takes its sessions before its lines** (A's order): the claim's foreign key to the
    session would otherwise take the session after the lines, against an admin's session change.
20. **"Remind" per line**: what is past its due date gets the overdue text, what is not yet due the
    due text — two messages from one click when a family has both, each with its own audience in the
    log, rather than one text that is wrong for half the lines.
21. **Arabic counts agree with their number** (1, 2, 3–10, 11–99, hundreds): a count and its noun are
    one text on the screens, so the translator sees them together.

---

## 5. Not in this step

- **WhatsApp sending** — waits for the school's WhatsApp Business account (the channel is reserved).
- **A family's language preference** — there is none on the account; templates send both languages.
  When the app keeps one, `renderMessage` takes it per recipient.
- **Reminders on the statement** — the claims carry the student; the statement does not list them
  yet.
- **F1's teaching groups** — read from the enrolments until F1's table lands.
- **The walkthrough (F8)** — still shows the old `/admin/notifications` page until it is regenerated.
- **`scheduled_announcement`** — kept one release (§7 step 3), then dropped by a later migration.
- **The Arabic pages' hydration warning** — every Arabic page logs it (C's "For the lead" item 6:
  the language provider reads `localStorage` in its first render); not this step's.

---

## 6. Progress log (UTC)

- 2026-10-08 06:58 — worktree from origin/main b76eae4; 07:02 the dev copy migrated to 0049;
  07:08 baseline (28 files, 495 passed, 1 todo).
- 07:15–07:21 — the dev copy and F0a's richer copy seeded through main's own API (announcements of
  every kind) before any change; the five readings sent to the lead; the lead's answer (all five,
  three notes) at 07:19.
- 07:20–07:45 — the model (0050, 0051), validations, services, routes, the scheduler step; 08f's
  settings map (trail row).
- 07:45–07:55 — 08s written; green alone (18); WIP ce75f19 pushed.
- 08:01 — the full suite with step D: one 08s read fixed; every other file green with the step
  running over their rows.
- 08:05–08:30 — the screens (Messages, Remind, Settings, the families' paragraphs), Arabic.
- 08:11 — the migration proof on both copies.
- 08:15–08:30 — the drive in headless Chrome (screens, the step counts, Arabic); fixes (the log's
  titles, "The whole school", the audience's words translated); 05, 08t, 09 blocks; the re-read
  under the lock (found forcing the desk race); the concurrency tests (two ticks, a cancel during a
  send, two email senders, an interrupted email).
- 08:33–08:37 — fifteen controls red, restored, green (`controls/`).
- 08:46 — the suite green in local time (526 passed) on the tree before the school-fee case.
- 08:48 — ad671b0 pushed (the screens, Remind, 05/08t/09, the proof, the controls, this document).
- 08:52 — the suite green with TZ=UTC at ad671b0 (527 passed); the local run beside it hit the
  container's shared memory (an environment failure, named in the trail) and is repeated alone.
- 08:57 — the suite green in local time at ad671b0, alone (527 passed); 08:58 — CI green on ad671b0
  (run 37752256592). The dev servers left running for the lead: API 3131, web 3130, igcse_rwd_dev
  (seeded with Parent/Student D5–D10, a June 2027 session open now, sections 11A and 12A).
- 09:13 — origin/main 2a26557 (C's statement charges and a plan line owing its price less its
  deposits; the desk reservation taking the fee and the charges; B's Reserve result as sentences;
  step 4) merged in as its own commit 5c2f2bf: no conflict (main touched none of step D's files;
  money-tab.client.tsx merged hunk by hunk), no migration after 0049. The gates on the merge: check-
  types clean; the suite 528 passed in local time (09:18) and with TZ=UTC (09:23); CI green
  (37755188568).
- 09:30–10:18 — the Opus 5.5 review of 5c2f2bf (via the lead: "merge after fixes 1, 2, 3 and 4"):
  one definition of what is owed and payable now (payable-now.services.ts) for the step and the money
  lists; finance limited to the payment lists; the step's sessions FOR KEY SHARE before its lines
  (A's §2.1 updated); claimed targets left out before locking; one reminder a day per target and date
  (0052–0054: `sent_on` and its unique index); leavers left out; reminders off when installed (the
  setting's default, the production checklist); Remind per line; the hour 1–23; Arabic counts; a
  text a live rule sends kept on. Twenty-four controls red, restored. One correction row for the
  nine decision rows that shared 08:35:35Z.
