# The guide's words, part by part. Run by gen.py with L() (a label as the screen writes it), table(), chapter() and
# step() in scope. [[key]] links to a step, [[ch:id]] to a part, [[count:A]] is the number of steps in part A.
# Every label below was read on the screens of this branch and driven on a local run (build/drive/); the pictures
# named in img= are that run's screenshots.

ADDRESS = 'https://subject-reservation-system.vercel.app'
ADMIN = 'The admin'

TITLE = 'June 2027, reviewed and opened — and June 2028 made from it'
BRAND = 'The coordinator’s guide'
SUB = 'Review, open, copy: step by step'

HEADER = f'''<p>This guide is for you, the coordinator: the person who sets up each session's subjects, teachers, prices and dates,
the work the school's Google Forms used to do. <b>June 2027 is already on the system</b>, made from your 25 forms (17 O.L. and
8 A.S./A.L.): every subject, what each can be entered as, how it is studied, its teachers, and the exam fees from your latest
fee lists. You do not build it. You check it, add what no form holds (the school's course fees and your dates), and open it to
families. Next year you make June 2028 by copying it.</p>
<div class="score">
<div><b>[[count:A]] steps</b>Part A: review the pre-loaded June 2027 and open it.</div>
<div><b>[[count:C]] steps</b>Part C: make June 2028 by copying June 2027.</div>
</div>
<p>Part B, in between, shows what families and the desk see once the session is open; you do none of it. A few steps are the
admin's, not yours: they are marked <span class="lbl" style="background:#5b3a8c;color:#fff">The admin</span>. Taking payments
is the desk's and the finance office's, never yours.</p>
<p><b>How to read a step.</b> Words <span class="lbl">shaded like this</span> are written exactly as the screen writes them: look
for those words. <b>Where you are</b> names the screen. The numbered lines are what to click or type, in order. <b>You see</b> says
what the screen shows when it worked. Where your form had something to say, the yellow box quotes it. In the pictures, a
<span class="redframe">red frame</span> marks what to click; it is drawn on the picture only, never on your screen. Everything
saves as you go: you can stop after any step and come back.</p>
<p class="note"><b>About the pictures.</b> They were taken on a practice copy of the system on its October 2026 version, set up
exactly as this guide says. The teachers' names in them (<i>T-ARABIC-OL-1</i>, <i>T-CHEMISTRY-OL-3-FORM</i>…) stand in for the
names on your forms; your screen shows the real names. The staff and the families are invented. The course fees (EGP 6,000 an
O.L. subject, EGP 9,000 an A.S./A.L. subject), the exam fees typed by hand (EGP 9,500), the dates (pay by 15 January 2027, first
lesson 1 November 2026) and the boards' entry deadlines are placeholders: type your own. The lists pasted are the school's
Cambridge and Edexcel June 2026 lists, the newest it has; Part C pastes them again because June 2027's are not published yet.</p>'''

# ═══════════════════════════════════════ Before you start ═══════════════════════════════════════
chapter('start', 'Before you start',
        'What to have on your desk, the account the admin gives you, and the address of the system.', prefix='0.')

step('Have these at hand', do=f'''<ul>
<li><b>The boards' fee lists</b>, the PDFs the school receives: Cambridge's “Registration Fees” list and Edexcel's. The June
2027 lists are not published yet; until they are, the June 2026 lists are the ones to use (the session already carries their
fees, so you only paste them again if a figure changed). When June 2027's arrive, you paste them the same way.</li>
<li><b>The school's course fee for each subject</b> this cycle: the school's own figure, on top of the board's exam fee.
No list holds it, so you type it.</li>
<li><b>Your dates:</b> the day families should pay by, the first lesson (the refund weeks count from it) and, if you want one,
a day reservations close.</li>
<li><b>Your forms and the links sheet</b>, to compare with what the system shows. You will not need to copy anything from
them.</li>
</ul>''')

step('An account for you', who=ADMIN, where=f'{L("Team")} in the column on the left.', do=f'''<ol>
<li>{L("Name")}: the coordinator's name.</li>
<li>{L("Email")}: the email she signs in with.</li>
<li>{L("Temp. password")}: a first password of at least 8 characters with a capital letter and a digit.</li>
<li>{L("Role")}: {L("Coordinator")}. (The line under the form still describes the role's old duties. Since the change, the
coordinator sets up the sessions, subjects, teachers, prices and dates, and reads who reserved and who paid.)</li>
<li>Click {L("Create Account")}, and give her the address below, her email and the password yourself.</li></ol>
<p>The desk gets its account the same way, with {L("Role")}: {L("Finance Officer")}.</p>''',
     see=f'{L("Account created for")} and her email. She appears in the {L("Staff")} list.', img='team-coordinator')

step('Open the system', do=f'''<ol>
<li>On a computer (the screens are wide; a laptop is fine), open Chrome, Edge, Safari or Firefox.</li>
<li>Type this address and press Enter: <code>{ADDRESS}</code></li></ol>
<p class="note">After a quiet spell the first page can take up to a minute to appear. Wait for it; do not click again.</p>
<p>There is no screen yet to change the temporary password: keep it to yourself.</p>''')

# ═══════════════════════════════════════ Part A ═══════════════════════════════════════
chapter('review', 'Part A — Review and open June 2027',
        'June 2027 waits on the system as a draft: families cannot see it. Its check list says everything to look at '
        'before it opens, one line at a time, each with the button that deals with it. You go down the list, add the '
        'prices no form holds and your dates, read what families agree to, and open it. Two lines block opening: your dates, '
        'and Cambridge’s June 2027 entry deadline, which only the admin enters ([[admin-date]]).',
        prefix='A', counted=True, limit=40)

step('Sign in', where='the sign-in page.', do=f'''<ol>
<li>{L("Email address")}: your email.</li>
<li>{L("Password")}: the password the admin gave you.</li>
<li>Click {L("Sign in")}.</li></ol>''', see='your Home (next step).', img='a-sign-in', key='sign-in')

step('Open June 2027', where='Home.', do=f'''<p>Home shows June 2027 with {L("Draft — families cannot see it")}, its dates, and
{L("Check before you open (24)")}: every line to look at before families can reserve.</p>
<ol><li>Click {L("Open June 2027")}.</li></ol>''',
     see=f'''the session. At the top, the two switches families feel, {L("Accepting reservations")} and {L("Prices final")}, with
{L("Opening waits for: Cambridge International's entry deadline (the admin); the dates")} under the first, and the three dates. Under
it, the same check list. A red dot and {L("Blocks opening")} mark the two lines that stop it opening; an amber dot is worth a look
and stops nothing. At the bottom, the tabs {L("Subjects (25)")}, {L("Prices")}, {L("What families agree to")} and
{L("Reservations (0)")}.''', img=['a-home', 'a-session'])

step('The ticks a default made', where=f'the session, the check list line {L("Ticked by a default, not by your forms: 33 ticks on 23 subjects.")}',
     do=f'''<p>On your forms a retaker who picks a teacher is retaking in school, so the system ticked {L("retake in school")}
wherever {L("first entry in school")} is ticked, unless the form priced retakes another way.</p>
<ol><li>Click {L("Show the list")}: each subject and the row where it was ticked for you.</li>
<li>Where the school does <b>not</b> take retakes in school, click {L("Open the subject")} beside it, untick the box under
{L("Retake in school")} on that row, click {L("Save")}, then {L("← June 2027")} at the top to come back.</li>
<li>Click {L("Looks right")}.</li></ol>''',
     see='the line leaves the list.',
     form=['Arabic O.L., the only form that spells it out: “Retake in School 100% fees (All Papers)”.',
           'The other forms offer a teacher, or “Self Study 50% (ONLY 2nd entry)”.'],
     img='a-check-defaults')

step("A teacher's name", where='the session, the check list.', do=f'''<p>Six lines say a teacher's name differs between your form and
the links sheet: {L("One teacher, two spellings: …")} or {L("Two names for one teacher: …")}, on Combined Science O.L., English as a
Second Language O.L., Global Perspectives O.L., Global Citizenship O.L., Mathematics O.L. and Chemistry A.S./A.L.</p>
<ol><li>On each, click {L("Open the subject")}.</li>
<li>Under {L("Teachers")} is the name families will read. If it is the right person, spelt right, click {L("← June 2027")}.</li>
<li>If not: {L("×")} beside the name takes it off; {L("Add a teacher…")} picks the right one from the school's list, or
{L("A new teacher…")} adds a name the list does not have (the screen asks before adding a name that looks like one it holds);
then {L("Save")} and {L("← June 2027")}.</li></ol>
<p>If the list ever says {L("… looks like …: one person or two?")}, it has found two names that may be one person: open a subject
that uses either and keep the right one.</p>''',
     see='the subject: at the top, under To look at, the same note; then what can be entered and how it is studied, the teachers, the earlier exams a retake carries from, and on the right What families see.',
     img=['a-check-doubt', 'a-editor-teachers'], key='teacher-name')

step('Every note: Looks right', where='the session, the check list: the lines that start with a subject’s name.', do=f'''<p>Each note
says what was done where your form was unclear, or what the system could not find. Three kinds:</p>
<ul><li><b>How your form was read</b>, for example Arabic O.L.: {L("Your June form offers a one-paper retake from June 2026 without asking which paper; the Paper 1 and Paper 2 rows follow your November form.")}
If that is not what you meant, {L("Open the subject")} and change the ticks.</li>
<li><b>A teacher's name</b>: checked in [[teacher-name]].</li>
<li><b>A code or a price source</b>, for example {L("Code to check: …")} or {L("Price source: the Edexcel November 2026 list; no June list prices 4HB1.")}
These are for us, who keep the boards' lists: a wrong code shows on the family's page, never in a price. Tell us if one is
wrong ([[ch:wrong]]).</li></ul>
<ol><li>On each of the 18 lines, click {L("Looks right")} once you agree with it. Each line leaves when you click.</li></ol>''',
     see='the notes gone. Left: the teacher to be confirmed and the older exam (next two steps), the prices, the dates and the admin\'s date.', img='a-check-note')

step('A teacher to be confirmed', where=f'the session, the line {L("Computer Science A.S./A.L.: teacher to be confirmed.")}', do=f'''<p>The form
names no teacher; the November links sheet says External. Families read {L("teacher to be announced")} until you name one.</p>
<ol><li>When you know who teaches it: click {L("Open the subject")}, then under {L("Teachers")} pick the name in
{L("Add a teacher…")} (or {L("A new teacher…")}, with the {L("external team")} tag for a team from outside), switch off
{L("Teacher to be confirmed")}, and click {L("Save")}.</li>
<li>Until then, leave it: it does not stop the session opening.</li></ol>''',
     see='the subject with No teacher yet and Teacher to be confirmed switched on (the practice copy leaves it so).',
     img=['a-check-tbc', 'a-editor-tbc'])

step('An older exam: Keep it', where=f'the session, the line {L("Physics A.S./A.L. — A.2. (carry forward): November 2025 is older than Cambridge International carries a result forward.")}',
     do=f'''<p>Your form lets a student carry an A.S. result from November 2025. That is more than the 13 months Cambridge carries a
result forward, so Cambridge may refuse such an entry. Your list wins: it stays offered unless you take it off.</p>
<ol><li>Click {L("Keep it")}. (Or, to stop offering it, {L("Open the subject")}, untick November 2025 under
{L("Earlier exams a retake carries from")}, and {L("Save")}.)</li></ol>''',
     form=['Physics A.S./A.L.: “A.2. Self Study 50% (Carry forward on November 2025)”.'],
     see=f'''the line leaves. Four lines are left: {L("Waiting for the admin: …")} (the admin's, [[admin-date]]), the dates
([[pay-by]]), the prices (next step) and the teacher to be confirmed.''', img=['a-check-keep', 'a-check-reviewed'])

step('Prices', where='the session.', do=f'''<ol><li>Click the tab {L("Prices")} under the check list. (The check list's
{L("Go to Prices")} works from Home; on this screen use the tab.)</li></ol>
<p>The exam fees came pre-loaded from your latest lists: Cambridge June 2026, Edexcel June 2026, and Edexcel November 2026 where
the June list has none. What no list holds is missing, and no course fee is set yet: a subject is not offered to families until
every price it needs is set.</p>''',
     see=f'''{L("Price lists in use")} ({L("None yet in this session.")}), {L("Paste a list as printed")},
{L("Missing exam fees (9)")}, {L("Course fees")} and {L("Every exam fee")}.''', img='a-prices')

step("Paste Cambridge's list", where=f'{L("Prices")}, the box {L("Paste a list as printed")}.', do=f'''<ol>
<li>{L("Board")}: {L("Cambridge International")}.</li>
<li>{L("The board's fees for")}: the list you have, {L("June 2026")} today ({L("June 2027")} once Cambridge publishes it).
{L("Its name:")} shows the name the list will carry.</li>
<li>In the PDF, select the table's lines (code, name and amount on each), copy them, click in {L("The list, pasted")} and
paste. As it is: no tidying, old codes such as 9608 and pairs such as “9700 S1 / S2” are understood.</li>
<li>Click {L("Read the list")}.</li></ol>''', img='a-paste-cambridge', key='cambridge-paste')

step('Check it, then use it', where=f'{L("Prices")}, under the pasted list.', do=f'''<p>Nothing is saved yet. The screen shows:</p>
<ul><li>{L("Matched")}: each line, the subject and row it {L("Goes to")}, and {L("Now")}: {L("same")} when the fee does not change,
the old amount when it does, {L("not set")} when the row had none.</li>
<li>{L("To check")} (when there is one): a line the system is not sure of. It stays out unless you pick {L("Use it: …")} in
{L("This line")}.</li>
<li>{L("Not used")}: lines for subjects or rows the school does not offer this session.</li></ul>
<ol><li>Click {L("Use these prices")}.</li></ol>''',
     see=f'''{L("Used: 2 rows priced from Cambridge International June 2026.")} Only rows whose fee changed are counted. Here every
row the school offers already had the list's fee; the 2 are rows it does not offer, which had none. The list appears under
{L("Price lists in use")}.''', img=['a-read-cambridge', 'a-lists-in-use'], key='cambridge-use')

step("Edexcel's list", where=f'{L("Prices")}, the box {L("Paste a list as printed")}.', do=f'''<ol>
<li>{L("Board")}: {L("Pearson Edexcel")}, and {L("The board's fees for")}: the list you have.</li>
<li>Paste Edexcel's list as in [[^cambridge-paste]], click {L("Read the list")}, check it, and click {L("Use these prices")}.</li></ol>
<p>Human Biology O.L. and Biology A.S./A.L.'s units 1–4 keep the Edexcel November 2026 figures they came with: the June list does
not print them. OxfordAQA sends the school no list: its two subjects' fees are typed in the next step.</p>''',
     img='a-read-edexcel')

step('The exam fees no list holds', where=f'{L("Prices")}, {L("Missing exam fees (9)")}.', do=f'''<p>Nine rows have no fee on any
list the school has: the two OxfordAQA subjects, the subjects whose code is still to check (Environmental Management, Global
Perspectives, Global Citizenship, French and Psychology A.S./A.L.) and Arabic A.S./A.L.'s GCE A Level.</p>
<ol><li>On each row, type the fee in {L("Amount (EGP)")} and press Enter. Where {L("Fill it by")} offers a figure (the sum of a
subject's units, another list's amount), picking it fills the row instead.</li></ol>
<p>A fee left empty is “not set”, not zero: the subject stays off the families' page until it is set.</p>''',
     see=f'each row leaves as it is saved, then {L("Every ticked row has its exam fee.")}', img='a-missing', key='missing-fees')

step('Course fees', where=f'{L("Prices")}, {L("Course fees")}.', do=f'''<ol><li>For each subject, type the school's course fee in
{L("The subject's course fee (EGP)")} and press Enter.</li></ol>
<p>A family pays the exam fee plus the course fee; self study pays a share of the course fee (50%, [[agree-more]]) and the whole
exam fee. A row with a fee of its own (a unit, a one-paper retake) gets it in the subject's editor, under
{L("Its own course fee (EGP)")}.</p>''',
     see=f'''every subject with its fee. Back at the top, the header says {L("25 offered to families")} and the prices line has left
the check list.''', img='a-course-fees')

step('Pay by', where='the session, the dates in the header (scroll to the top).', do=f'''<ol>
<li>{L("Pay by")}: the day families should pay by. Pick it in the calendar or type it; it saves when you click elsewhere.</li></ol>
<p>Under it: {L("Last day to pay: 3 days after it. Unpaid reservations are cancelled after that.")} (the 3 days are set in
[[agree-more]]). A family that reserves after the pay-by date has a few days of its own to pay.</p>
<p>If the dates already shown are the ones you want, click {L("Keep them")} on the check list's dates line instead of
[[^pay-by]] to [[close-date]].</p>''', img='a-date-pay-by', key='pay-by')

step('First lesson', where='the session, the dates.', do=f'''<ol><li>{L("First lesson")}: the day teaching starts. {L("The refund weeks count from it.")}</li></ol>''',
     see='the check list\'s dates line has left: you set the dates.', img='a-date-first')

step('Reservations close (optional)', where='the session, the dates.', do=f'''<p>Leave {L("Reservations close (optional)")} empty
to close by hand: Home then says {L("Reservations close when you switch them off")}. You can also close one subject at a time, as you
close your forms one at a time: its tile's switch on {L("Subjects")}, or its own {L("Closes on (optional)")} in its editor.</p>
<ol><li>To close on a day, pick it: {L("Switches Accepting off at the end of that day.")}</li></ol>
<p>{L("Reservations already made can still be paid, each until its last day to pay: closing cancels nothing.")}</p>''',
     img='a-date-close', key='close-date')

step('The refund policy', where='the session.', do=f'''<ol><li>Click the tab {L("What families agree to")}.</li>
<li>{L("Refund policy")}: the rows {L("Up to")} week 2, 100%; {L("Then to")} week 3, 50%; {L("From week 4")}, 0%; and the
sentence families read, made from the rows: {L("Families read: 100% to week 2 · 50% in week 3 · 0% from week 4")}. If the school's
policy changed, pick another week or percent in a row, or {L("Add a step")} / {L("Remove")}.</li></ol>
<p>{L("Declaration")}: one text for the whole school, set by the admin. Families agree to both once for the session; each
agreement keeps a copy. Once a family has agreed, the policy cannot change for this session.</p>''',
     form=['June form: “100% of the course fees if dropped within 2 weeks from the first lesson; 50% from 3 weeks from the first lesson; 0% from 4 weeks from the beginning of the course.”',
           '“I confirm that the information given in this form is true, complete and accurate.”'],
     img='a-agree', key='refund')

step('Self study, grades, last day to pay', where=f'{L("What families agree to")}, further down.', do=f'''<ul>
<li>{L("Self study pays")}: {L("50% of the course fee")}, and the whole exam fee, as on your forms (“Self Study 50% fees”).</li>
<li>{L("Grades that may reserve")}: {L("Grade 11")}, {L("Grade 12")} and {L("Graduates retaking")}. No form lists a grade-10
class.</li>
<li>{L("Last day to pay")}: {L("3 days after the pay-by date")}. Unpaid reservations are cancelled after it, or at the board's
deadline if that is earlier.</li>
<li>{L("Extra questions")} (optional): a question you want families to answer; the answers go into the reservations export and
never change a price or who may reserve.</li></ul>
<ol><li>Change any of them only if the school's rule changed; each saves when changed.</li></ol>''', img='a-agree-more', key='agree-more')

step("Cambridge's June 2027 entry deadline", who=ADMIN, where='Home, signed in as the admin.', do=f'''<p>Cambridge publishes its
June 2027 dates in its 2027 handbook (expected in November 2026). Until the date is entered the session cannot open: the system
needs it to stop taking money for an entry Cambridge would refuse. You, the coordinator, see {L("Waiting for the admin: …")} and
have nothing to do.</p>
<ol><li>On the line {L("Cambridge International has not published its June 2027 entry deadline yet.")}, type Cambridge's date in
{L("Entry deadline")}. Leave {L("Retake deadline (if the board has one)")} empty: Cambridge's June series has none.</li>
<li>Click {L("Save the date")}.</li></ol>
<p>It is entered once, for every session that uses Cambridge June 2027. If a saved date turns out wrong, tell us.</p>''',
     see='the line leaves; Opening waits for nothing more.', img='a-admin-date', key='admin-date')

step('Prices final', where='the session, the header.', do=f'''<ol><li>When the prices are the ones families will pay, switch
{L("Prices final")} on.</li></ol>
<p>Before it, families can reserve but cannot pay. Once a family has reserved it stays on; a price you change later shows what it
does to families (re-priced, or listed for the finance office) before it is saved.</p>''', img='a-prices-final')

step('Open', where='the session, the header.', do=f'''<ol><li>Switch {L("Accepting reservations")} on.</li></ol>''',
     see=f'''{L("Accepting reservations")} beside the name, {L("25 offered to families")}, and the list now called
{L("Needs a look (1)")}: the teacher to be confirmed. Home says {L("What families are doing: 0 reservations · 0 paid · 0 waiting for payment")}.
To close later, switch it off: closing cancels nothing.''', img=['a-accepting', 'a-open', 'a-home-open'])

# ═══════════════════════════════════════ Part B ═══════════════════════════════════════
chapter('families', 'Part B — What families and the desk see',
        'For reference: what your set-up becomes for a family and for the desk, so you know what they are looking at when '
        'they ask. You do none of it. Families reserve on one page per child and pay at the school or by InstaPay; the desk '
        'reserves on a family\'s behalf on the same page and takes the money.', prefix='B')

step('A parent: Reserve subjects', where="the parent's Home.", do=f'''<p>Home lists each child with the next step:
{L("June 2027 is open for reservations.")} and {L("Reserve subjects")}.</p>''', img='b-parent-home')

step('One page per child', where=f'{L("Reserve")}, {L("Reserve for Laila Two")}.', do=f'''<p>Every subject open to the child,
grouped O.L. then A.S. / A.L., each with its choices in the school's words and the price beside each:
{L("First entry · in school · all papers")} EGP 16,850 (the exam fee plus the course fee). A student the school has no earlier
exam for sees first entries; {L("Sat it before? Show the retake choices")} opens the retakes. A subject not fully priced, or
switched off, is not on the page.</p>''', img='b-reserve-picks')

step('Agree once, reserve', where=f'the bottom of the page, {L("Reserving for Laila Two")}.', do=f'''<p>The subjects picked, their
teachers, one total ({L("3 subjects · Total EGP 47,900")}), and the two ticks: the refund policy, in the sentence made from your
rows, and the declaration. Then {L("Reserve now (3)")}.</p>''', see=f'{L("Reserved: 3 reservations waiting for payment.")} and a button to reserve for the other child.',
     img=['b-reserve-agree', 'b-reserved'])

step('The second child, with a retake', where=f'{L("Reserve for Karim Two")}.', do=f'''<p>The same page for the other child. A
retake asks what your form asked: {L("When did your child sit it?")}, from the earlier exams you allowed. Each choice shows the
exam fee and the course fee.</p>''', img='b-reserve-retake')

step('Pay: at the school or by InstaPay', where="the parent's Home, then the checkout.", do=f'''<p>Home now says
{L("June 2027: EGP 47,900 to pay — pay by 15 Jan 2027")} and {L("Last day to pay: 18 Jan 2027; after it the subject can no longer be paid.")}
{L("Pay now")} opens the checkout: the subjects, the total, and the way to pay: {L("Pay at School")} or {L("InstaPay")}.</p>''',
     img=['b-pay-now', 'b-checkout'])

step('A reference to quote at the desk', where=f'{L("Payment started")}.', do=f'''<p>Paying at the school gives a reference,
{L("SCH-…")}, with {L("Quote this reference (or the student's name) at the desk.")} Home shows it too.</p>''', img='b-payment-started')

step('The desk: a walk-in family', where=f'{L("The Desk")}, signed in as the finance officer.', do=f'''<p>The officer types in
{L("Type a student's name, email, ID, or a payment reference…")}, opens the student, and clicks {L("+ Reserve")}.</p>''',
     img=['b-desk-search', 'b-desk-student'])

step('Reserve and collect', where="the desk, the student's page.", do=f'''<p>The same page the family sees. The officer picks the
subjects, ticks {L("Refund policy and declaration read and signed by the parent")}, picks {L("Paid with")} and clicks
{L("Reserve and collect EGP 53,350")}: one payment for every subject, with a receipt for each.</p>''',
     see=f'{L("Collected EGP 53,350.")}', img=['b-desk-reserve', 'b-desk-collected'])

step('A payment the family started', where=f'{L("The Desk")}.', do=f'''<p>A parent who chose Pay at School quotes the reference. The
officer types it in the search, opens the student, and under the student finds {L("Pay at the school, started by the family · reference SCH-…")}
marked {L("The reference quoted")}, with its subjects and amount. {L("Paid with")}, then {L("Take it EGP 47,900")}.</p>''',
     see=f'{L("Taken at the desk EGP 47,900 · reference SCH-…")}, the subjects paid, the receipts under {L("Reservations")}.',
     img=['b-desk-reference', 'b-desk-take', 'b-desk-taken'])

# ═══════════════════════════════════════ Part C ═══════════════════════════════════════
chapter('copy', 'Part C — Make June 2028 by copying',
        'A year on, June 2028 starts as a copy of June 2027: every subject, row, tick, teacher, note, question, refund policy '
        'and share comes across; the earlier exams and the dates move on a year; the prices come across as last year’s, not '
        'final. You change what changed, paste the boards’ new lists, and open it.', prefix='C', counted=True, limit=30)

step('New session', where=f'{L("Sessions")} in the column on the left.', do=f'''<ol><li>Click {L("New session")}.</li></ol>''',
     img='c-sessions')

step('Create June 2028', where=f'the box {L("New session")}.', do=f'''<p>It comes filled in: {L("Type")} {L("June")},
{L("Year")} 2028, {L("Start from")} {L("Copy the last June session (June 2027)")}. The name is made for you.</p>
<ol><li>Click {L("Create June 2028")}.</li></ol>''',
     see=f'''June 2028 with {L("copied from June 2027")}, and its check list: the three boards' June 2028 deadlines
{L("Waiting for the admin")} ([[copy-admin]]), {L("The copy moved the dates one year: …")}, {L("The prices are last cycle's, copied: paste this year's lists, check what is left, then switch prices final.")},
and the teacher still to be confirmed.''', img=['c-new-session', 'c-session'])

step('The dates, a year on', where='June 2028, the check list.', do=f'''<ol><li>If the dates shown are right, click
{L("Keep them")}. If not, set {L("Pay by")} and {L("First lesson")} in the header as in [[pay-by]].</li></ol>''',
     see='the line leaves.', img='c-dates')

step('The subjects, as copied', where=f'June 2028, the tab {L("Subjects")}.', do=f'''<ul>
<li>A subject not taught this cycle: switch it off at the foot of its tile (it then reads {L("Switched off")}); families do not see it.</li>
<li>A new subject: {L("Add a subject")}, {L("Pick from the board's list…")}, {L("Add")}; then tick its rows in its editor.
{L("Not on the list")} is for a subject the board's list lacks: tell us too.</li>
<li>A change on a subject (a teacher, a row, a tick): open its tile, change it, {L("Save")}.</li></ul>
<ol><li>Change only what changed since June 2027.</li></ol>''', img='c-subjects')

step('Prices', where='June 2028.', do=f'''<ol><li>Click the tab {L("Prices")}.</li></ol>''', img='c-prices')

step("Paste Cambridge's new list", where=f'{L("Prices")}, {L("Paste a list as printed")}.', do=f'''<ol>
<li>{L("Board")}: {L("Cambridge International")}; {L("The board's fees for")}: the newest list ({L("June 2027")} here).</li>
<li>Paste the list as printed and click {L("Read the list")}.</li></ol>''', img='c-paste-cambridge')

step('Use it', where=f'{L("Prices")}, under the pasted list.', do=f'''<ol><li>Check {L("Matched")} and {L("Now")} as in
[[cambridge-use]], then click {L("Use these prices")}.</li></ol>''',
     see=f'''{L("Used: … rows priced from Cambridge International June 2027.")} (0 in the picture: the practice copy pasted the same
figures again.)''', img='c-read-cambridge')

step("Edexcel's new list", where=f'{L("Prices")}, {L("Paste a list as printed")}.', do=f'''<ol><li>{L("Board")}:
{L("Pearson Edexcel")}, paste, {L("Read the list")}, {L("Use these prices")}.</li></ol>''')

step('What is left: missing fees and course fees', where=f'{L("Prices")}.', do=f'''<p>The fees you typed last year came across:
{L("Missing exam fees (0)")} unless the school added a row. The course fees came across too.</p>
<ol><li>Change a course fee that changed (type it, Enter); fill any missing exam fee as in [[missing-fees]].</li></ol>''',
     img='c-missing-course')

step('What families agree to', where=f'the tab {L("What families agree to")}.', do=f'''<ol><li>The refund policy, self study,
grades and last day to pay came across: change only what changed ([[refund]], [[agree-more]]).</li></ol>''', img='c-agree')

step("The boards' June 2028 deadlines", who=ADMIN, where='June 2028, the check list, signed in as the admin.', do=f'''<ol>
<li>On each of the three lines (Cambridge International, OxfordAQA, Pearson Edexcel), type the board's June 2028 entry deadline in
{L("Entry deadline")} and click {L("Save the date")}.</li></ol>''', see='the three lines leave.', img='c-admin-dates', key='copy-admin')

step('Prices final', where='June 2028, the header.', do=f'''<ol><li>When the prices are this year's, switch {L("Prices final")}
on. The line about last cycle's prices leaves.</li></ol>''')

step('Open', where='June 2028, the header.', do=f'''<ol><li>Switch {L("Accepting reservations")} on.</li></ol>''',
     see=f'''{L("Accepting reservations")}; on {L("Sessions")}, June 2028 {L("copied from June 2027")} beside June 2027 and its
reservations.''', img=['c-final-accepting', 'c-open', 'c-sessions-after'])

# ═══════════════════════════════════════ If something looks wrong ═══════════════════════════════════════
chapter('wrong', 'If something looks wrong',
        'Who to tell, by what went wrong. Nothing here needs you to work around the system.', prefix='W',
        body=f'''<ul class="wrong">
<li><b>The boards' lists: tell us</b> (the system's team). A subject missing from {L("Pick from the board's list…")}, a code
that is wrong on a family's page, a line of a pasted list {L("not recognised")} or left {L("To check")}, a board rule that looks
wrong (how long a result carries forward, how a one-paper retake is priced). We keep those lists; you never edit them.</li>
<li><b>A board's date: the admin</b>, for a date still missing ({L("Waiting for the admin")}); <b>us</b>, for a date already saved
that turns out wrong.</li>
<li><b>An account or a password: the admin</b> ({L("Team")}).</li>
<li><b>Money: the finance office.</b> A payment, a receipt, a refund, a family's balance. A price you change after families
reserved asks first ({L("Before this is saved")}): unpaid reservations take the new price and their families are told; paid ones
are listed for the finance office to settle.</li>
<li><b>A screen that does not do what this guide says: us</b>, with the step's number (A12, C4…) and what you saw.</li></ul>''')
