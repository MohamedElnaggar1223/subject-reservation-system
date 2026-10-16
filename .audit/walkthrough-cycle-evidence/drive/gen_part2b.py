
# ── The sheet, subject by subject (appended to gen.py) ────────────────────────────────────────────
group('The sheet: the 25 forms, one subject each')
SHEET_STEPS = [
    ('s01-3180', 'Arabic O.L. (Cambridge)', f'Teachers 1, 2, 3; {L("First entry and retakes")}; 12,000. One paper only: Paper 1 and Paper 2, each {L("Retake in school or self study")} at 4,000.',
     Q('Teacher: T1, T2, T3, "Self study (Only for 2nd entry ONLY)"', '"First Entry in School 100% fees (All Papers)" · "Retake in School 100% fees (All Papers)" · "Retake Self Study 50% fees (All Papers)" · "Retake in School 100% fees (One paper ONLY) From June 2026" · "Retake Self Study 50% fees (One paper ONLY) From June 2026"')),
    ('s02-0970', 'Biology O.L. (Cambridge)', f'Teachers 4, 5, 6; first entry and retakes; 12,000. Paper 41/42: {L("Retake self study only")}, 4,000.',
     Q('Teacher: T1, T2, T3, "Self Study 50% (Second entry ONLY)"', '"Retake Self Study 50% fees (All Papers)" Yes / No', '"Retake Self Study 50% fees (Paper 41/42 ONLY)": From June 2026 / From November 2026 / None')),
    ('s03-0986', 'Business O.L. (Cambridge)', 'Teacher 7; first entry and retakes; 12,000. No paper of its own.', Q('One teacher, named in the description', '"Self Study 50% fees (ONLY 2nd entry)" Yes / No')),
    ('s04-0971', 'Chemistry O.L. (Cambridge)', 'Teachers 8, 9, 10; first entry and retakes; 12,000. Paper 41/42: retake self study only, 4,000.',
     Q('Teacher: T1, T2, T3, "Self Study 50%"', '"Retake Self Study 50% fees (All Papers)" Yes / No', '"Retake Self Study 50% fees (Paper 41/42 ONLY)": From June 2026 / From November 2026 / None')),
    ('s05-0653', 'Combined Science O.L. (Cambridge)', 'Teacher 11; first entry and retakes; 12,000. Paper 41/42: retake self study only, 4,000.',
     Q('One teacher (description)', '"Retake Self Study 50% fees (All Papers)" Yes / No', '"Retake Self Study 50% fees (Paper 41/42 ONLY)": From June 2026 / From November 2026 / None')),
    ('s06-0984', 'Computer Science O.L. (Cambridge; an external team)', f'{L("An external team")}: type <i>External Team</i>, {L("Add")}; first entry and retakes; 12,000. The form\'s "Paper 41/42" has no paper here: 0984 has no Paper 4 (the form kept last year\'s options — "From June 2025 / From November 2025").',
     Q('One teacher (description): the external team', '"Retake Self Study 50% fees (All Papers)" Yes / No', '"Paper 41/42" with "From June 2025 / From November 2025"')),
    ('s07-esl-oxford', 'English As a Second Language (Oxford)', 'Teachers 12, 13; first entry and retakes; 12,000.', Q('Teacher: T1 (Oxford), T2 (Oxford), "Self Study 50% (ONLY 2nd entry)"', '"Self Study 50% fees (ONLY 2nd entry)" Yes / No')),
    ('s08-0680', 'Environmental Management O.L. (Cambridge)', 'Teacher 14; first entry and retakes; 12,000.', Q('One teacher (description)', '"Self Study 50% fees (ONLY 2nd entry)" Yes / No')),
    ('s09-7156', 'French O.L. (Cambridge)', 'Teacher 15; first entry and retakes; 12,000.', Q('One teacher (description)', '"Self Study 50% fees (ONLY 2nd entry)" Yes / No')),
    ('s10-7159', 'German O.L. (Cambridge)', 'Teacher 16; first entry and retakes; 12,000.', Q('One teacher (description)', '"Self Study 50% fees (ONLY 2nd entry)" Yes / No')),
    ('s11-0457', 'Global Perspectives O.L. (Cambridge)', f'Teacher 17 with {L("online only")} ticked; first entry and retakes; 12,000. Families see "Teacher 17 (online)".', Q('One teacher (description), "(ONLINE ONLY)"', '"Self Study 50% fees (ONLY 2nd entry)" Yes / No')),
    ('s12-global-cit', 'Global Citizenship O.L. (Cambridge)', 'Teacher 18; first entry and retakes; 12,000.', Q('One teacher (description)', '"Self Study 50% fees (ONLY 2nd entry)" Yes / No')),
    ('s13-4hb1', 'Human Biology O.L. (Edexcel)', 'Teacher 19; first entry and retakes; 12,000.', Q('One teacher (description)', '"Self Study 50% fees (ONLY 2nd entry)" Yes / No')),
    ('s14-0983', 'ICT O.L. (Cambridge; an external team)', 'Tick <i>External Team</i> (now in the list); first entry and retakes; 12,000. Theory Paper: retake self study only, 4,000.',
     Q('One teacher (description): the external team', '"Retake Self Study 50% fees (All Papers)" Yes / No', '"Retake Self Study 50% fees (Theory Paper ONLY)": From June 2026 / From November 2026 / None')),
    ('s15-4ma1', 'Mathematics O.L. (Edexcel)', 'Teachers 20, 21, 22; first entry and retakes; 12,000. 1H and 2H: each retake self study only, 4,000.',
     Q('Teacher: T1, T2, T3, "Self Study 50% (ONLY 2nd entry)"', '"Retake Self Study 50% fees (All Papers)" Yes / No', '"Retake Self Study 50% fees (One Paper ONLY)": 1H / 2H / None')),
    ('s16-0972', 'Physics O.L. (Cambridge)', 'Teacher 23; first entry and retakes; 12,000. Paper 41/42: retake self study only, 4,000.',
     Q('Teacher: T1, "Self Study 50%"', '"Retake Self Study 50% fees (All Papers)" Yes / No', '"Retake Self Study 50% fees (Paper 41/42 ONLY)": From June 2026 / From November 2026 / None')),
    ('s17-psy-oxford', 'Psychology O.L. (Oxford)', 'Teacher 24; first entry and retakes; 12,000.', Q('One teacher (description)', '"Self Study 50% fees (ONLY 2nd entry)" Yes / No')),
    ('s18-arabic-al', 'Arabic A.L. (Edexcel)', 'Teacher 25; first entry and retakes; 12,000. The second qualification is the next step.',
     Q('Teacher: T1 "(Edexcel YAA01)", T2 "(Edexcel 9AA01)", "Self Study 50% (second entry only)"', '"Self Study 50% fees (ONLY 2nd entry)" Yes / No')),
    ('s18b-arabic-al-two-qualifications', 'Arabic A.L.: the two qualifications, each with its teacher', f'The form chooses the qualification through the teacher. No screen adds the second qualification (a finding): the demo script adds the GCE 9AA0 under Arabic A.L. through the API; then this form shows {L("Qualifications")} — Arabic (GCE A Level) (9AA0) with Teacher 26, Arabic (International A Level) (YAA01) with Teacher 25 — and edits them like any other.',
     Q('Teacher: T1 "(Edexcel YAA01)", T2 "(Edexcel 9AA01)" — "the teacher choice chooses the qualification"')),
    ('s19-ial-biology', 'Biology A.S./A.L. (Edexcel IAL)', f'Teacher 27; first entry and retakes; 4,000 a unit. {L("Units")}: Unit 1 to Unit 4 {L("Self study only")}; Unit 5 and Unit 6 {L("Taught by")} Teacher 27.',
     Q('"A.2. Paper 5 (WBI15/01) First entry 100% June 2027 · A.2. Paper 6 (WBI16/01) First entry 100% June 2027"', '"A.S. Paper 1 (WBI11/01) Self Study 50% 2nd entry ONLY · A.S. Paper 2 (WBI12/01) SS 50% · A.S. Paper 3 (WBI13/01) SS 50% · A.2. Paper 4 (WBI14/01) SS 50% · A.2. Paper 5 · A.2. Paper 6 SS 50%"')),
    ('s20-chem-as', 'Chemistry A.S. (Cambridge)', f'Teacher 28; first entry and retakes; 15,000. {L("Components")}: A.S. {L("Offered")}, A.2. (carry forward) {L("Not offered this cycle")}, A.L. {L("Offered")}.',
     Q('"Kindly specify the Components": Chemistry A.S. / Chemistry A.L.', '"Self Study (ONLY 2nd entry)" Yes / No')),
    ('s21-cs-asal', 'Computer Science A.S./A.L. (Cambridge)', 'External Team; first entry and retakes; 15,000. Components: A.S., A.2. (carry forward), A.L. all offered — the family names the sitting the A.S. is carried from (June or November).',
     Q('Components: "Computer Science A.S. · A.2. (Carry forward on June) · A.2. (Carry forward on November) · A.L."', '"Self Study (ONLY 2nd entry)" Yes / No')),
    ('s22-french-asal', 'French A.S./A.L. (Cambridge)', 'Teacher 29; first entry and retakes; 15,000. Components: A.S. and A.L. offered.', Q('Components: "French A.S. / French A.L."', '"Self Study (ONLY 2nd entry)" Yes / No')),
    ('s23-ial-maths', 'Mathematics A.S./A.L. (Edexcel IAL)', f'Teachers 30, 31; first entry and retakes; 4,000 a unit. Units, each {L("Taught by")} its own teachers: P1 and P2 Teacher 30 {L("online only")}; P3, P4 Teacher 30; M1 and S1 Teacher 31 and Teacher 30. A unit left without a tick is taught by the subject\'s teachers.',
     Q('"P1: T1 (ONLINE ONLY) / Self Study 50% School fees (2nd entry ONLY) · P2: the same · P3: T1 / SS · P4: T1 / SS · M1: T2 / T1 / SS · S1: T2 / T1 / SS"')),
    ('s24-phys-asal', 'Physics A.S./A.L. (Cambridge)', f'Teacher 32; first entry and retakes; 15,000. Components: A.S. {L("Offered")} (taught by Teacher 32); A.2. (carry forward) {L("Self study only")}; A.L. {L("Not offered this cycle")}. The form\'s three A.2. choices are one route here: the family names the sitting its A.S. comes from.',
     Q('"Physics A.S. in School 100% fees (T1) · Physics A.2. (Self Study 50% fees in June 2027) · A.2. Self Study 50% (Carry forward on June 2026) · A.2. Self Study 50% (Carry forward on November 2025)"')),
    ('s25-psy-al', 'Psychology A.L. (Cambridge)', 'Teacher 33; first entry and retakes; 15,000.', Q('One teacher (description)', '"Self Study 50% fees (ONLY 2nd entry)" Yes / No')),
]
for shot_name, title, do, form in SHEET_STEPS:
    step(title, f'<p>{do}</p>', form=form, img=f'p2-{shot_name}', tall=True, key=('cs-external' if shot_name == 's06-0984' else None))

group('The fees, from the boards\' lists')
step('The Fees tab', f'<p>{L("Fees")}: one grid per sitting the sheet uses — Cambridge International June 2027, OxfordAQA June 2027, Pearson Edexcel June 2027 — each row a code the subjects read, {L("No fee")} until set.</p>', img='p2-24-fees-empty')
step('Paste the Cambridge list', f'''<p>{L("Paste the fee list")}, paste the list\'s rows as the board writes them — syllabus, option, fee — {L("Read the list")}: every line is matched or said "not recognised". Keep {L("These are the board\'s published fees")} ticked when it is the board\'s list for this sitting (untick it for last year\'s: the rows stay "provisional" until {L("Confirm all")}). {L("Add these fees")}.</p>
<pre>3180 A 9,850
0970 CX 10,850
0986 AX 9,850
0971 CX 10,850
0653 CX 10,850
0984 AX 9,850
7156 X 12,550
7159 Y 12,550
0983 DY 12,950
0972 CX 10,850
3180 9,850
0970 10,850
0971 10,850
0653 10,850
0983 12,950
0972 10,850
9701 S1 14,100
9701 BY 11,400
9701 AX 18,600
9702 S1 14,100
9702 BX 11,400
9702 AX 18,600
9618 SY 11,400
9618 BY 12,450
9618 AY 16,950</pre>
<p>One fee per line, as above. Lines 11 to 16 repeat each syllabus that has a one-paper retake, on its own: a one-paper retake reads the syllabus\'s fee (a finding). The demo pastes the June 2026 list as if it were June 2027\'s (June 2027\'s was not published when the forms were made); the Computer Science AS row is pasted under 9618, the current AS code, where the list still writes 9608.</p>''',
     form=Q('Cambridge Registration Fees June 2026 (Year 11 & 12): IGCSE Biology 0970 CX 10,850 · AS Level 9700/9701/9702 S1/S2 14,100 · A2 Level BY/CT 11,400 · A Level AX/HX 18,600 · AS Computer Science 9608 SY 11,400 · A2 9618 BY/CT 12,450 · A Level 9618 AY 16,950'), img='p2-25-fees-paste-cambridge')
step('Paste the Edexcel list', '''<pre>WMA11 4,800
WMA12 4,800
WMA13 4,800
WMA14 4,800
WME01 4,450
WST01 4,450
WBI15 4,450
WBI16 4,450
4MA1 9,200
YAA01 18,300</pre><p>Mathematics O.L. is the two papers of the list (4,600 each); Arabic IAL its two units (WAA01 8,950 + WAA02 9,350).</p>''',
     form=Q('Edexcel June 2026: IAL Mathematics P1–P4 WMA11–WMA14 4,800 each; M1, M2, S1 4,450 each · IAL Biology Paper 5, Paper 6 WBI15, WBI16 4,450 each · IGCSE Mathematics one row per paper 4,600 each · IAL Arabic WAA01 / WAA02 8,950 / 9,350'), img='p2-25-fees-paste-pearson_edexcel')
step('The rows no list has: typed, "not published yet"', f'<p>A row still {L("No fee")} is typed in its {L("Amount")} box; leave {L("These are the board\'s published fees")} unticked and {L("Save fees")}: it is "provisional" — families can reserve the subject, not pay for it, until {L("Confirm all")}. The demo types placeholders for Environmental Management, Global Perspectives, Global Citizenship, French and Psychology A level, the Oxford subjects, Human Biology, Biology IAL units 1–4 and Arabic GCE.</p>', img='p2-26-fees-typed')
step('Cambridge June 2027, priced', '<p>Provisional rows first (to confirm when the board publishes), then the confirmed ones.</p>', img='p2-27-fees-cambridge')
step('Pearson Edexcel June 2027, priced', '', img='p2-27b-fees-pearson')
step('Board Services', f'<p>{L("Board Services")}: what a reservation can carry beside the subject — cash-in, late cash-in, a certificate split — with each board\'s fee per sitting, set the same way when the board publishes them.</p>', img='p2-84-board-services')
step('School Fees', f'<p>{L("School Fees")}: the year\'s school fee, if the school sets one, blocks reserving until it is paid and can be pushed to the families. The forms ask none: "No fee schedules yet — the registration gate is off".</p>', img='p2-85-school-fees')

group("The boards' deadlines")
step("Set each board's dates from the session", f'<p>The header\'s {L("Deadlines")} line has a button per sitting ("… June 2027: Dates not set"). Click it: {L("Deadline (your clock)")} — the entry deadline, the school\'s hard stop — and for Cambridge {L("Retakes until (your clock)")}; a {L("Reason")}; {L("Save the dates")}. The demo uses placeholders: Cambridge entries by 21 Feb 2027, retakes by 21 Mar 2027; Pearson by 13 Feb 2027; OxfordAQA by 21 Feb 2027. Type the boards\' own key dates.</p>',
     form=Q('The forms never mention a deadline (SCHOOL_FORMS.md G-30): the boards\' dates were in someone\'s head.'), img='p2-28-dates-cambridge')
step('The sheet, ready', '<p>Every subject with its board, teachers, entry options in the forms\' words, course fee with the self-study share, board fee — and the deadlines in the header.</p>', img='p2-29-dates-set')
step('The A.S./A.L. part of the sheet', '', img='p2-29b-sheet-as-al')
step('Board Series: every sitting with its dates', f'<p>The same dates live on {L("Board Series")}: every board\'s sitting of the academic year, its entry deadline with the days left, what it will close and how many reservations wait — the place for a sitting no subject uses yet.</p>', img='p2-83-board-series')
step('Grade 10', f'<p>The session\'s {L("Grade 10")} tab ticks the core subjects every grade-10 student sits in June, which the school can then reserve for its grade 10 at once. No June 2027 form has a grade-10 class (Q-10): the demo leaves it empty.</p>', form=Q('"Grade Level & Class": 11A … 12D — no grade-10 class on any form'), img='p2-86-grade-10')

group("The family's form, next to the school's")
step("Preview the family's form: Biology", f'<p>{L("Preview the family\'s form")} under a subject shows exactly what a family will see on its Reserve page, every choice open, with its price. Hold it next to the Google Form: the same teacher choice, "First entry, in school", "Retake, in school", "Retake, self-study — name the sitting", the one-paper retake "Paper 41/42 only (retake)" with "Carried from the sitting…", then the refund policy and the declaration.</p>',
     form=Q('Biology O.L.: Teacher T1, T2, T3, "Self Study 50% (Second entry ONLY)"', '"Retake Self Study 50% fees (All Papers)" Yes / No', '"Retake Self Study 50% fees (Paper 41/42 ONLY)": From June 2026 / From November 2026 / None', '"I confirm that I read the refund policy" · "I confirm that the information given in this form is true, complete and accurate."'), img='p2-30-preview-biology')
step('Mathematics A.S./A.L.: unit by unit', '', form=Q('"P1: T1 (ONLINE ONLY) / Self Study 50% School fees (2nd entry ONLY)" …'), img='p2-31-preview-ial-maths')
step('Physics A.S./A.L.: A.S. taught, A.2. self study', '', form=Q('"Physics A.S. in School 100% fees (T1) · … A.2. Self Study 50% (Carry forward on June 2026)"'), img='p2-32-preview-physics-al')

group('Opening the session')
step('Home, before opening', f'<p>Home says what June 2027 still needs ({L("Confirm the fees")} for the rows not published yet) and the boards\' deadlines.</p>', img='p2-33-home-before-opening')
step('Open now', f'<p>On the session, {L("Open now")} → {L("Open now")}: families can reserve from this moment (otherwise it opens on its own on 1 Nov 2026).</p>', img='p2-34-open-now')
step('Open', '', img='p2-35-session-open')
step('Turn the reminders on', f'<p>{L("Settings")} → {L("Reminders")} → {L("Send reminders automatically")} → {L("Change")} → {L("On")}, a reason, {L("Save change")}. They are off when the system is installed; from now on the payment, closing and deadline reminders go out on their own.</p>', img='p2-36-reminders-on')

group('The desk: a walk-in family')
step("The finance officer's desk", f'<p>Sign in as <code>finance@igcse.local</code>: the desk, with today\'s money above the search.</p>', img='p2-37-desk-today', key='desk-start')
step('A new family', f'<p>{L("+ New family")}: the parent\'s email, name and a temporary password; the student\'s email, name, temporary password and {L("Grade this year (new account)…")}; {L("Create & Link Family")}. No phone is needed. The form\'s seven identity questions are asked once, here.</p>',
     form=Q('Every form: "Student full Name · Grade Level & Class · Student Mobile Number · Student Email address · Guardian Name · Guardian Email Address · Guardian Mobile Number"'), img='p2-38-desk-new-family')
step("The family's Reserve card", '<p>The new family stays open with its Reserve card, the open session chosen.</p>', img='p2-39-desk-family-onboarded')
step('Three subjects, one a declared retake', f'<p>Tick {L("Chemistry: All papers")} and choose Teacher 9; {L("Physics: All papers")} with {L("Entry")} "Retake, self-study — name the sitting" and the sitting "Cambridge International June 2026" — declared at the desk, listed for the coordinator to verify; {L("Mathematics: All papers")} with Teacher 22.</p>',
     form=Q('"Retake Self Study 50% fees (All Papers)" Yes — the family says it sat Physics before'), img='p2-40a-desk-ticked')
step('Reserve and collect', f'<p>Tick {L("Refund policy and declaration read and signed by the parent")}, {L("Paid with")} Cash, {L("Reserve and collect EGP 60,900")}. The money is taken in one payment per entry deadline: Cambridge 39,700, Pearson 21,200.</p>',
     form=Q('Refund Policy (the June forms) and the Student Declaration — signed on the slip'), img='p2-40-desk-reserve-and-collect')
step('Collected: the receipts and the slip', f'<p>"Reserved 3 reservations. Collected EGP 60,900 in 2 payments, one per entry deadline." with the receipts to hand over and {L("Print the reservation slip")}.</p>', img='p2-41-desk-collected')
step('The reservation slip', '<p>The lines with their entry, price and basis, the refund policy and the declaration, and the two signatures.</p>', img='p2-42-reservation-slip')
step("The family's statement at the desk", f'<p>{L("Statement")} on the student\'s card: every line, what is paid, its receipt, and the payments per deadline.</p>', img='p2-43-desk-statement')
step('Hand over the receipts', f'<p>{L("Registrations")}: each paid line\'s receipt is {L("Ready to Hand Over")}; {L("Hand Over")} when the paper leaves the desk; {L("Print")} for the paper.</p>', img='p2-44-desk-receipts-to-hand-over')
step('A receipt', '', img='p2-45-receipt-print')
step('Students', f'<p>{L("Students")}: every student with the grade they are in today and where they stand; the desk family is here.</p>', img='p2-87-students')
step("A student's record", '<p>The grade, the cohort, the sessions open to the student, the record\'s changes — and buttons to the candidate\'s details and to the desk.</p>', img='p2-88-student-record')

group('The Finance Workbench: InstaPay and "pay at the desk"')
step('Payments to confirm', f'<p>{L("Finance Workbench")} lists what waits for finance. Here, from the app family of Parts 3 and 4: an InstaPay transfer with its reference, and a "Pay at School" reference for the line they pay at the desk.</p>', img='p2-48-workbench-to-confirm')
step('Confirm the InstaPay transfer', f'<p>When the transfer is on the bank statement: {L("Confirm")}, a note, {L("Confirm Payment")}. The lines are paid.</p>', img='p2-49-workbench-confirm-instapay', key='workbench')
step('Confirm the payment at the desk', f'<p>The parent quotes the reference at the desk and pays: {L("Confirm")}, {L("How did they pay?")} Cash, {L("Confirm Payment")}.</p>', img='p2-50-workbench-confirm-cash')
step('Their receipts', f'<p>{L("Receipts")}: {L("Mark Handed Over")} as each paper is handed to the parent.</p>', img='p2-51-workbench-receipts')
step('Daily Takings', f'<p>{L("Daily Takings")}: the day\'s money at the desk, by instrument, to close the drawer against.</p>', img='p2-90-daily-takings')

group('Following up')
step('To verify', f'<p>Signed in as the coordinator: the session\'s {L("To verify")} tab lists every retake declared by a family or at the desk, with its sitting and who declared it.</p>', img='p2-52-to-verify')
step('Verify a declared sitting', f'<p>{L("Verify")}: what was checked in {L("Reason")}, {L("Verify")}. ({L("Not confirmed")} would end an unpaid line, or make a paid one a first entry.)</p>', img='p2-53-verify-sitting')
step('Answered', '', img='p2-54-to-verify-answered')
step('An exception for a family', f'<p>{L("Exceptions")} → {L("Grant an exception")}: the student (Student One), {L("Policy")} {L("Payment due date")}, {L("Date")} 20 Dec 2026, the line (Arabic), a {L("Reason")}; the sentence says what it will do; {L("Grant")}.</p>',
     form=Q('The sheet\'s per-case notes ("Dropped 20% School fees" …): every rule can have an exception (the admin\'s point 9).'), img='p2-55-exception-grant')
step('Granted', '<p>"1 due dates moved." The line is now due on 20 December.</p>', img='p2-56-exception-granted')
step('The Money tab', f'<p>{L("Money")}: every line of the session with the student, the subject, the price and its basis, the due date and whether it is paid.</p>', img='p2-57-money-tab')
step("Who hasn't paid", f'<p>{L("Unpaid")}.</p>', img='p2-58-money-unpaid')
step('Remind', f'<p>{L("Remind")}: the families, what each owes and by when, the message as they will read it (English and Arabic); {L("Remind 1 family")}.</p>', img='p2-59-remind-dialog')
step('Reminded', '', img='p2-60-remind-sent')
step("A message to the session's unpaid families", f'<p>{L("Messages")} → {L("New message")} → {L("A list in the system")}: {L("List")} "A session\'s unpaid families", {L("Session")} June 2027, {L("To")} "Parents and students" (the count and the names show); {L("Title")} and {L("Message")} with {{guardian}}, {{student}}, {{amount}}, {{due}}; the preview; {L("Send to 2 people")}.</p>', img='p2-61-message-unpaid-families', tall=True)
step('Sent', f'<p>{L("Sent")}: each message with its audience and its deliveries.</p>', img='p2-62-message-sent')
step('Charges', f'<p>{L("Charges")}: what families owe beside the subjects — instalments, board services, the pushed school fee, adjustments. None in this cycle yet.</p>', img='p2-89-charges')
step('A drop: the receipt comes back', f'<p>When a family drops a paid subject (Part 4, step [[parent-drop]]), the paper receipt must come back: the desk finds the student; the dropped line says {L("Must Be Returned")}; {L("Take Back")}.</p>',
     form=Q('"I will drop the course" — "a drop follows the refund policy"'), img='p2-63-desk-take-back-receipt')
step('The refund, to the balance', '<p>"Receipt returned — any pending drop refund is released." The refund (here 100%: dropped before the first lesson) is the family\'s balance with the school, shown on the card.</p>', img='p2-64-desk-refund-to-balance')
step('The balance, taken back as cash', f'<p>If the family wants the refund in cash (Part 4, step [[parent-withdraw]]), the finance officer sees it under {L("Cash refunds to hand out")} on the Finance Workbench.</p>', img='p2-79-workbench-cash-refund')
step('Release the cash', f'<p>{L("Release Cash")}: the amount handed over, {L("Record Release")}.</p>', img='p2-80-workbench-release-cash')
step('A second person approves it', f'<p>{L("Balance withdrawals")} (the admin or the finance admin, never the one who released it): "The cash is handed over; a second person approves it" → {L("Approve")}.</p>', img='p2-81-balance-withdrawals')
step('Signed for', '', img='p2-82-balance-withdrawal-approved')

group('The entries to the board')
step('Exam Deadlines', f'<p>{L("Exam Deadlines")}: the entry and retake deadlines of every sitting, the next one first.</p>', img='p2-91-exam-deadlines')
step('Exam entries from the paid reservations', f'<p>{L("Exam Entries")}, the sitting Cambridge International June 2027, {L("Preview")}: each paid reservation becomes its entry — the syllabus with its option code; the declared retake marked. {L("Make the 3 new entries")}.</p>', img='p2-65-entries-preview')
step('The entries', '<p>Each entry says what the board would still refuse: no candidate number, no legal name, no forecast grade…</p>', img='p2-66-entries-made')
step('Candidates', f'<p>{L("Candidates")}: what the boards ask of each candidate — legal name, date of birth, gender, UCI (Pearson), ID document, candidate number.</p>', img='p2-67-candidates')
step("A candidate's details", f'<p>Open a candidate: {L("Forenames (as on the ID)")}, {L("Surname (as on the ID)")}, {L("Date of birth")}, {L("Gender")}, {L("Save the details")}.</p>', img='p2-68-candidate-details')
step('Candidate numbers', f'<p>{L("Assign candidate numbers")} → who gets which → {L("Assign these numbers")}.</p>', img='p2-69-candidate-numbers')
step("The school's centre number", f'<p>{L("Settings")} → {L("Exam entries")} → {L("Centre numbers and entry route")}: the number each board issued the school (a placeholder here), a reason, {L("Save change")}.</p>', img='p2-70a-settings-centre-number')
step('Entry lists', f'<p>{L("Entry Lists")}: the sitting\'s rows in the board portal\'s columns, with what is still flagged (here only the forecast grades, which teachers give outside this cycle) and {L("Download CSV")} of the ready rows.</p>', img='p2-70-entry-list')

group('The alternative start: the school\'s own sheet')
step('Day-one Import', f'<p>A school that already took June 2027\'s registrations in its response sheet starts from the sheet instead: {L("Day-one Import")} → {L("The school\'s registration sheet")} → {L("Choose file")} (the .xlsx; the walkthrough uses a placeholder sheet of one family and three lines in the forms\' shape, <code>docs/walkthrough/demo/june-2027-placeholder-sheet.xlsx</code>) → {L("Stage for review")}. Nothing changes until the commit.</p>',
     form=Q('The response sheet: one row per student per subject, the form\'s answers in its columns, the fee note typed by staff.'), img='p2-71-import-upload', key='import-start')
step('The review', '<p>Every problem flagged on its line, what a commit would make.</p>', img='p2-72-import-review')
step('Map the sheet\'s sitting to the session', f'<p>{L("Mapping")} → {L("Series and levels")}: the June 2027 lines → "Lines awaiting payment in June 2027".</p>', img='p2-73-import-mapping')
step('A line, as the session will hold it', '<p>The Chemistry row: the fee note "Retake Self Study 50% fees (All Papers) From June 2026" read as a self-study retake following June 2026 (declared, listed to verify), priced from the sheet.</p>',
     form=Q('"Retake Self Study 50% fees (All Papers) From June 2026" — the form\'s option as the fee note'), img='p2-74-import-line')
step('The problems, line by line', '<p>Each problem with its lines: here a subject named as the sheet writes it, the fee note read, a self-study retake, a unit registered on its own — none holds the family back.</p>', img='p2-75-import-problems')
step('Commit', f'<p>{L("Commit 1 family")} → {L("Commit")}: the accounts, the link and the lines are made, each pointing back to its row.</p>', img='p2-76-import-commit')
step('The result', '', img='p2-77-import-result')
step('Home, with the cycle running', '<p>Home now: the fees still to confirm, a declared sitting to verify, what families are doing (reserved, paid, unpaid, outstanding) and the boards\' deadlines with their entries.</p>', img='p2-78-admin-home-cycle-running')
step("The coordinator's Home", '<p>Each role lands on its own next step: the coordinator sees the same session with what the sheet still needs and the sittings to verify.</p>', img='p2-94-coordinator-home')
step("A teacher's Home", '<p>A teacher\'s screens (lessons, attendance, forecasts) come after the reservation cycle; until then a teacher has the notifications and the profile.</p>', img='p2-95-teacher-home')
step('Notifications', f'<p>Every account has {L("Notifications")} …</p>', img='p2-92-admin-notifications')
step('Profile', f'<p>… and {L("Profile")}.</p>', img='p2-93-profile')
