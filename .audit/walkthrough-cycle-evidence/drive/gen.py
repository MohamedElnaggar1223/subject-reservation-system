#!/usr/bin/env python3
"""Generate docs/walkthrough/index.html and img/ from the steps below and the drive's screenshots.
Each step: a number (assigned in order), a title, what to do (the screen's labels marked), the school's
form wording beside it where there is one, and the screenshot taken at that step by the drive."""
import html, os, re, shutil, sys

SHOTS = '/tmp/f8-pw/shots'
OUT = '/tmp/f8/repo/docs/walkthrough'
CSS = open('/tmp/f8/gen_style.css').read()

def L(s):
    """A label on the screen."""
    return f'<span class="lbl">{html.escape(s)}</span>'

def Q(*lines):
    return lines

PARTS = []

def part(pid, title, intro):
    PARTS.append({'id': pid, 'title': title, 'intro': intro, 'groups': []})

def group(title):
    PARTS[-1]['groups'].append({'title': title, 'steps': []})

def step(title, do='', form=None, img=None, cap=None, tall=False, key=None):
    PARTS[-1]['groups'][-1]['steps'].append({'title': title, 'do': do, 'form': form, 'img': img, 'cap': cap, 'tall': tall, 'key': key})

FORM_FOOT = 'SCHOOL_FORMS.md §2'

# ═══════════════════════════════════════════ PART 1 ═══════════════════════════════════════════
part('p1', 'Part 1 — Set up from a clean clone',
     'From nothing to a running system with its first admin. Every command below was run, in this order, on a fresh clone '
     '(16 Oct 2026, the code of <code>feature/walkthrough-cycle</code> after the merge of main 9a38c3d). The walkthrough\'s own run used the ports '
     '3191 (API) and 3190 (web) and a database container on 5434 because 3000, 3001 and 5433 were taken on that machine; the commands here use the defaults.')
group('What you need')
step('Prerequisites', '''
<table class="t"><tr><th>Tool</th><th>Version</th><th>Why</th></tr>
<tr><td>Node.js</td><td>22 (the run used 22.17.1)</td><td>the API and the web app</td></tr>
<tr><td>pnpm</td><td>9 — <code>package.json</code> pins <code>"packageManager": "pnpm@9.0.0"</code>; <code>corepack enable</code> gives it</td><td>the monorepo's installer and runner</td></tr>
<tr><td>Docker</td><td>any recent (the run used 28.4)</td><td>PostgreSQL 17.5 in a container</td></tr>
<tr><td>git</td><td>any recent (the run used 2.51)</td><td>the clone</td></tr>
<tr><td>A browser</td><td>Chrome, Edge, Safari or Firefox</td><td>the app (and this page, offline)</td></tr></table>
<p>Nothing else is needed locally: email runs in stub mode (logged, never sent), uploads go to a folder on the API's disk, and no payment provider is involved (InstaPay is a bank transfer the school checks by hand).</p>''')
step('Clone the repository', '''<pre>git clone https://github.com/MohamedElnaggar1223/subject-reservation-system.git
cd subject-reservation-system</pre><p>Every later command runs from this folder.</p>''')
step('Install the dependencies', '''<pre>pnpm install
<span class="c">…
Done in 11.5s</span></pre>''')
group('The database')
step('Start PostgreSQL 17 in a container', '''<p>Name the container and choose the port (here <code>igcse-db</code> on 5433; any free port works — the walkthrough used 5434):</p>
<pre>docker run -d --name igcse-db -e POSTGRES_USER=audit -e POSTGRES_PASSWORD=auditpass \\
  -e POSTGRES_DB=igcse_audit -p 127.0.0.1:5433:5432 postgres:17.5</pre>
<p>This is the line of <code>apps/api/test/README.md</code>: the same container also serves the integration tests, which create their own database in it.</p>''')
step('Create the database', '''<pre>docker exec igcse-db createdb -U audit igcse_dev</pre>''')
group('The two environment files')
step('apps/api/.env — the API', '''<p>Create <code>apps/api/.env</code> (it is ignored by git; <code>.env.example</code> at the root lists the same variables). Generate the secret with <code>openssl rand -base64 32</code> and keep it to yourself.</p>
<pre>NODE_ENV=development
PORT=3001
DATABASE_URL=postgresql://audit:auditpass@127.0.0.1:5433/igcse_dev
BETTER_AUTH_SECRET=&lt;your own: openssl rand -base64 32&gt;
BETTER_AUTH_URL=http://localhost:3001
CORS_ORIGINS=http://localhost:3000
APP_URL=http://localhost:3000
SCHOOL_BANK_NAME=Example Bank
SCHOOL_ACCOUNT_NAME=Example School
SCHOOL_ACCOUNT_NUMBER=0000000000000000</pre>
<table class="t"><tr><th>Variable</th><th>What it is for</th><th>Local value</th></tr>
<tr><td><code>NODE_ENV</code></td><td>development, test or production; production turns on secure cookies, HSTS and email verification</td><td><code>development</code></td></tr>
<tr><td><code>PORT</code></td><td>the API's port</td><td><code>3001</code></td></tr>
<tr><td><code>DATABASE_URL</code></td><td>the database the API reads and writes</td><td>the container and database above</td></tr>
<tr><td><code>BETTER_AUTH_SECRET</code></td><td>signs the sign-in sessions; at least 32 characters — the API refuses to start without it</td><td>your own random value</td></tr>
<tr><td><code>BETTER_AUTH_URL</code></td><td>the API's own address, for the sign-in library</td><td><code>http://localhost:3001</code></td></tr>
<tr><td><code>CORS_ORIGINS</code></td><td>the web app's address(es), comma-separated; also the origins sign-in trusts</td><td><code>http://localhost:3000</code></td></tr>
<tr><td><code>APP_URL</code></td><td>the web app's address, for links in emails</td><td><code>http://localhost:3000</code></td></tr>
<tr><td><code>SCHOOL_BANK_NAME</code>, <code>SCHOOL_ACCOUNT_NAME</code>, <code>SCHOOL_ACCOUNT_NUMBER</code>, <code>SCHOOL_IBAN</code></td><td>the school's account a parent paying by InstaPay transfers to (shown on the checkout)</td><td>placeholders; <code>SCHOOL_IBAN</code> optional</td></tr>
<tr><td><code>RESEND_API_KEY</code>, <code>EMAIL_FROM</code></td><td>sending email through Resend; unset = stub mode (each email is written to the API's log)</td><td>leave unset (required in production)</td></tr>
<tr><td><code>R2_ACCOUNT_ID</code>, <code>R2_ACCESS_KEY_ID</code>, <code>R2_SECRET_ACCESS_KEY</code>, <code>R2_BUCKET_NAME</code></td><td>file storage on Cloudflare R2; unset in development, files go to <code>LOCAL_UPLOAD_DIR</code></td><td>leave unset</td></tr>
<tr><td><code>LOCAL_UPLOAD_DIR</code></td><td>where uploads go without R2 (development and tests only)</td><td>default <code>.uploads</code></td></tr>
<tr><td><code>COOKIE_DOMAIN</code></td><td>production only, when the API and the web share a parent domain</td><td>leave unset</td></tr>
<tr><td><code>REQUIRE_EMAIL_VERIFICATION</code></td><td>unset = required in production, not required elsewhere; never set it to false in production</td><td>leave unset</td></tr>
<tr><td><code>CLIENT_IP_HEADER</code></td><td>behind a proxy, the header it writes with the real address (rate limits key on it)</td><td>leave unset</td></tr>
<tr><td><code>AUTH_RATE_LIMIT_WINDOW_MS</code>, <code>AUTH_RATE_LIMIT_MAX</code>, <code>API_RATE_LIMIT_WINDOW_MS</code>, <code>API_RATE_LIMIT_MAX</code></td><td>requests allowed per address per window (defaults 50 sign-ins and 600 requests per 15 minutes)</td><td>defaults; a scripted run (the demo script several times, a test drive) may raise <code>API_RATE_LIMIT_MAX</code> locally — the walkthrough's drive used 20000</td></tr>
<tr><td><code>INSTAPAY_REFERENCE_GRACE_HOURS</code></td><td>how long after a session closes a parent can still submit an InstaPay reference</td><td>default 24</td></tr>
<tr><td><code>FAWRY_*</code>, <code>PAYMOB_*</code></td><td>payment providers, switched off since V3</td><td>leave unset</td></tr></table>''')
step('apps/web/.env.local — the web app', '''<pre>echo "NEXT_PUBLIC_API_URL=http://localhost:3001" &gt; apps/web/.env.local</pre>
<p><code>NEXT_PUBLIC_API_URL</code> is the API's address as the browser reaches it — the web app's only variable.</p>''')
group('Build, migrate, run')
step('Build the shared packages', '''<pre>pnpm build --filter=@repo/db --filter=@repo/validations --filter=@repo/storage
<span class="c"> Tasks:    3 successful, 3 total</span></pre>''')
step('Run the migrations', '''<pre>DATABASE_URL=postgresql://audit:auditpass@127.0.0.1:5433/igcse_dev pnpm --filter @repo/db db:migrate
<span class="c">[✓] migrations applied successfully!</span></pre>
<p>62 migrations (0000 to 0061). A fresh database then holds the three boards (Pearson Edexcel: January, June, October, November; Cambridge International: June, November; OxfordAQA: January, June, November), the boards' 15 services, their entry rules, the 5 reminder rules and the 7 message texts — and no subject, session, setting or account.</p>''')
step('Start the API', '''<pre>pnpm --filter @repo/api dev
<span class="c">[email] RESEND_API_KEY not set — running in stub mode (no emails sent)
[INFO] [session-closer] Session scheduler started (60s interval).
Server is running on http://localhost:3001</span></pre><p>Leave it running in its own terminal. The scheduler opens and closes sessions by their dates once a minute.</p>''')
step('Start the web app', '''<pre>pnpm --filter web dev            <span class="c"># http://localhost:3000</span></pre>
<p>On another port: <code>pnpm --filter web exec next dev --port 3190</code> (and set <code>CORS_ORIGINS</code>, <code>APP_URL</code> to match). Open <code>http://localhost:3000</code>.</p>''',
     img='p1-sign-in-fresh', cap='The sign-in page of a fresh install: the app\'s name alone until the school\'s name is set (step [[school-name]]).')
group('The first admin')
step('Create an account', f'''<p>The admin is made from an ordinary account: sign up, then the seed promotes it. On the sign-in page {L('Create one')}, then {L("I'm a Parent")}.</p>''', img='p1-sign-up-choose')
step('Sign up the first account', f'''<p>On {L('Parent Registration')}:</p>
<ol><li>{L('Full Name')}: <i>School Admin</i></li><li>{L('Email Address')}: <code>admin@igcse.local</code> — the address the seed looks for</li><li>{L('Password')} and {L('Confirm Password')}: at least 8 characters, an upper-case letter and a digit (the demo uses <code>AdminPass1</code>)</li><li>{L('Create Parent Account')}.</li></ol>''',
     img='p1-sign-up-admin-filled', cap='Parent Registration, filled for the first account.')
step('The account is a parent\'s until the seed runs', '<p>The new account lands on a parent\'s Home ("Start by linking your child"). Do nothing here: the next step makes it the admin.</p>',
     img='p1-sign-up-admin-done')
step('Run the seed', '''<pre>pnpm --filter @repo/db seed
<span class="c">Seeding 17 subjects...
Seeding 2 registration sessions...
  [session] June 2026 (june) - active (created if missing)
  [session] November 2026 – January 2027 (winter) - draft (created if missing)
Looking for user admin@igcse.local to promote to admin...
  Promoted admin@igcse.local to admin.</span></pre>
<p>It reads <code>DATABASE_URL</code> from <code>apps/api/.env</code>. Besides the promotion it makes <b>17 sample Cambridge IGCSE subjects</b> (older syllabus codes such as 0610 Biology, not yet mapped on the Catalogue) and <b>two sample sessions of 2026</b>. Running it again changes nothing.</p>''')
step('Sign in as the admin', f'<p>{L("Sign Out")}, then on the sign-in page: {L("Email address")} <code>admin@igcse.local</code>, {L("Password")}, {L("Sign in")}.</p>', img='p1-11-sign-in-admin')
step('The admin\'s Home', '<p>Home shows each session being prepared or open and what it still needs. Right after the seed it shows the seed\'s November 2026 – January 2027 session, a draft whose dates (July to October 2026) are already past.</p>', img='p1-12-admin-home')
step('What the fresh database shows', f'<p>{L("Sessions")}: the seed\'s June 2026 session is closed by the scheduler\'s first tick; November 2026 – January 2027 stays a draft. {L("Exam Catalogue")}: the three boards and the 17 sample subjects, "not mapped yet". Part 2 starts from here.</p>', img='p1-13-sessions-after-seed')
step('The Catalogue after the seed', '', img='p1-14-catalogue-after-seed')
step("Put the school's name on the sign-in page", key='school-name', do=f'''<p>{L("Settings")} → {L("The school")} → {L("The school's name")} → {L("Change")}: type the name in {L("New value")}, a {L("Reason")}, {L("Save change")}. Only the admin may change it. The demo uses the placeholder <i>Demo International School</i>.</p>''',
     img='p1-15-settings-school-name')
step('The name is saved', '', img='p1-16-settings-school-name-saved')
step('The sign-in page carries it', '<p>Every visitor now sees the school\'s name above the app\'s name on the sign-in, sign-up and password pages.</p>', img='p1-17-sign-in-with-school-name')
step('Before going live', '''<p>A local install is not a production one. Before the school uses it, work through <b>SECURITY_AUDIT.md §6, the production checklist</b>: <code>NODE_ENV=production</code>; a new random <code>BETTER_AUTH_SECRET</code>; HTTPS; <code>CORS_ORIGINS</code> and <code>COOKIE_DOMAIN</code> for the real addresses; <code>CLIENT_IP_HEADER</code> behind a proxy; the email provider (<code>RESEND_API_KEY</code>, <code>EMAIL_FROM</code>, required in production); R2 for uploads; <code>TZ=Africa/Cairo</code> for the API; one API process; <code>REQUIRE_EMAIL_VERIFICATION</code> never false; the payment providers stay off (InstaPay is checked by hand on the Finance Workbench). Replace every demo password, and do not run the demo script there.</p>''')

# ═══════════════════════════════════════════ PART 2 ═══════════════════════════════════════════
part('p2', "Part 2 — The admin's journey: the June 2027 cycle, as the 25 forms describe it",
     'The school registered June 2027 with a links sheet and 25 Google Forms — 17 O.L. and 8 A.S./A.L. (SCHOOL_FORMS.md §2.2, §2.3). '
     'Here the same cycle is built on the screens, in the order an admin works: the team, the catalogue, the settings, the session and its sheet, the fees, the dates, a look at the family\'s form, opening; then the running of the cycle. '
     'Teachers are placeholders (Teacher 1 … Teacher 33, numbered in the order the forms list them; "External Team" for the external teams). '
     'The school\'s course fees are in none of the artefacts (Q-14): the demo uses EGP 12,000 for an O.L. subject, 15,000 for a Cambridge A level, 4,000 per IAL unit and 4,000 for one paper. '
     'The boards\' fees are the lists of SCHOOL_FORMS.md §3. Every demo account other than the admin has the password <code>TestPass1</code>.')
group('The team')
step('Open Team', f'<p>{L("Team")} (under {L("Set up")}) creates every account and its role. Staff who teach get a teacher record with their account.</p>', img='p2-01-team')
step('A coordinator', f'<p>{L("Name")} <i>Coordinator One</i>, {L("Email")} <code>coordinator@igcse.local</code>, {L("Temp. password")}, {L("Role")} {L("Coordinator")}, {L("Create Account")}. The coordinator keeps the sheet, the catalogue and the declared sittings with the admin.</p>', img='p2-02-team-coordinator')
step('A finance officer', f'<p>The same with {L("Role")} {L("Finance Officer")} (<code>finance@igcse.local</code>): the desk, payments and receipts.</p>', img='p2-03-team-finance-officer')
step('The teachers of the links sheet', f'<p>For each teacher the forms name: {L("Role")} {L("Teacher")} and {L("Teaches as")} {L("New teacher record (this name)")}, {L("Create Account")}. The demo makes Teacher 1 … Teacher 33 (<code>teacher1@igcse.local</code> …). An external team needs no account: it is named on the subject\'s form (step [[cs-external]]).</p>',
     form=Q('Every form names its teachers: "T1, T2, T3", or one teacher "named in the description", or an external team.'), img='p2-04-team-teacher')
step('The team', '<p>The Staff list: the admin, the coordinator, the finance officer and the 33 teachers, each linked to their teacher record.</p>', img='p2-05-team-list')

group('The catalogue: what the forms need')
step('The forms\' subjects, in one paste', f'''<p>The Catalogue lists what families register; the subjects themselves are added on {L("Subjects")}, which is no longer in the sidebar: open it by its address, <code>/admin/subjects</code>. {L("Import CSV")}, paste one row per form (name, code, board, level, course fee), {L("Import")}:</p>
<pre>name,code,council,level,courseFee
Arabic,3180,Cambridge,IGCSE,12000
Biology,0970,Cambridge,IGCSE,12000
Business Studies,0986,Cambridge,IGCSE,12000
Chemistry,0971,Cambridge,IGCSE,12000
Combined Science,0653,Cambridge,IGCSE,12000
Computer Science,0984,Cambridge,IGCSE,12000
English as a Second Language,ESL-OXFORD,Oxford,IGCSE,12000
French,7156,Cambridge,IGCSE,12000
German,7159,Cambridge,IGCSE,12000
Global Perspectives,0457,Cambridge,IGCSE,12000
Global Citizenship,GLOBAL-CIT,Cambridge,IGCSE,12000
Human Biology,4HB1,Pearson Edexcel,IGCSE,12000
ICT,0983,Cambridge,IGCSE,12000
Mathematics,4MA1,Pearson Edexcel,IGCSE,12000
Physics,0972,Cambridge,IGCSE,12000
Psychology,PSY-OXFORD,Oxford,IGCSE,12000
Arabic A.L.,ARABIC-AL,Pearson Edexcel,A Level,12000
Biology A.S./A.L.,IAL-BIOLOGY,Pearson Edexcel,A Level,4000
Chemistry A.S.,CHEM-AS,Cambridge,AS Level,15000
Computer Science A.S./A.L.,CS-ASAL,Cambridge,AS Level,15000
French A.S./A.L.,FRENCH-ASAL,Cambridge,AS Level,15000
Mathematics A.S./A.L.,IAL-MATHS,Pearson Edexcel,A Level,4000
Physics A.S./A.L.,PHYS-ASAL,Cambridge,AS Level,15000
Psychology A.L.,PSY-AL,Cambridge,A Level,15000</pre>
<p>The codes are the syllabus codes of the boards' fee lists where the lists have them; the A.S./A.L. rows and the subjects the lists do not name carry a school code. Environmental Management (0680) came with the seed and is kept. The O.L. subjects keep their plain names: the sheet and the families' page group them under "O.L."</p>''',
     form=Q('The links sheet: "June 2027: 17 O.L. rows and 8 A.S./A.L. rows, 25 forms" — one row per subject, its board and teachers.'), img='p2-06-subjects-import')
step('Imported', '<p>"Imported 24 subject(s)." (the 25th, Environmental Management, was already there).</p>', img='p2-07-subjects-imported')
step("Deactivate the seed's samples", f'<p>The 16 sample subjects the forms do not use: {L("Deactivate")} on each row (a sample marked core is un-ticked in {L("Core")} first). They leave every list families and the sheet read.</p>', img='p2-08-subjects-samples-deactivated')
step('The IAL starter sets', f'<p>{L("Exam Catalogue")} → {L("Pearson IAL Mathematics")} and {L("Pearson IAL Biology")}: the units with the boards\' codes (WMA11 P1 … WST01 S1; WBI11 Unit 1 … WBI16 Unit 6) and their awards, in two clicks.</p>',
     form=Q('Biology A.S./A.L.: "A.2. Paper 5 (WBI15/01) … A.S. Paper 1 (WBI11/01)"', 'Mathematics A.S./A.L.: "P1 … P4 · M1 · S1"'), img='p2-09-catalogue-starter-sets')
step('The papers a one-paper retake needs', f'''<p>{L("Units and papers")} → {L("Add a unit or paper")}: {L("Board")}, {L("Code")}, {L("School's name")}, {L("Title")}, {L("Its own level")} IGCSE / O Level, {L("Kind")} Component (paper), {L("Add the unit")}. The forms\' one-paper retakes need nine:</p>
<table class="t"><tr><th>Board</th><th>Code</th><th>School's name</th><th>For the form's</th></tr>
<tr><td>Cambridge</td><td>3180/01, 3180/02</td><td>Paper 1, Paper 2</td><td>Arabic "(One paper ONLY)"</td></tr>
<tr><td>Cambridge</td><td>0970/41, 0971/41, 0653/41, 0972/41</td><td>Paper 41/42</td><td>"(Paper 41/42 ONLY)" — Biology, Chemistry, Combined Science, Physics</td></tr>
<tr><td>Cambridge</td><td>0983/01</td><td>Theory Paper</td><td>ICT "(Theory Paper ONLY)"</td></tr>
<tr><td>Pearson Edexcel</td><td>4MA1/1H, 4MA1/2H</td><td>1H, 2H</td><td>Mathematics "(One Paper ONLY): 1H / 2H"</td></tr></table>''',
     form=Q('"Retake Self Study 50% fees (Paper 41/42 ONLY)": From June 2026 / From November 2026 / None'), img='p2-10-catalogue-add-paper')
step('The awards', f'''<p>{L("Qualifications")} → {L("Add an award")}: {L("Board")}, {L("Code (cash-in or syllabus)")}, {L("Title")}, {L("Level")}, {L("Suite")}, {L("Subject (AS and A Level share it)")}, {L("How the board takes the entry")}, {L("Add the award")}. One per form subject (28): each O.L. syllabus; for a Cambridge A level two — its AS and its A Level under the same code (9701, 9618, 9898, 9702); Psychology 9990; for Arabic A.L. the IAL <code>YAA01</code> and the GCE <code>9AA0</code>.</p>''', img='p2-11-catalogue-add-award')
step('Each award\'s papers', f'<p>On the award\'s card {L("Edit units")}: tick its papers, {L("Required")}, {L("Save the units")}. Arabic 3180 takes Paper 1 and 2; Biology, Chemistry, Combined Science and Physics their Paper 41/42; ICT its Theory Paper; Mathematics 4MA1 its 1H and 2H.</p>', img='p2-12-catalogue-award-papers')
step('The option codes, with the forms\' A.S. / A.2. / A.L.', f'''<p>{L("Add an option")} on each Cambridge award: {L("Option code")}, {L("What it enters")}, and for the A2 {L("Carries forward marks from an earlier series")}; {L("Add the option")}. The O.L. syllabuses take the fee list\'s code (3180 A, 0970 CX, 0986 AX, 0971 CX, 0653 CX, 0984 AX, 7156 X, 7159 Y, 0983 DY, 0972 CX) with "All papers". The A levels take their routes, labelled in the forms\' words — families see these labels:</p>
<table class="t"><tr><th>Award</th><th>AS award</th><th>A Level award</th></tr>
<tr><td>Chemistry 9701</td><td>S1 "A.S."</td><td>BY "A.2. (Carry forward)" · AX "A.L."</td></tr>
<tr><td>Computer Science 9618</td><td>SY "A.S."</td><td>BY "A.2. (Carry forward)" · AY "A.L."</td></tr>
<tr><td>French 9898</td><td>S1 "A.S."</td><td>AX "A.L."</td></tr>
<tr><td>Physics 9702</td><td>S1 "A.S."</td><td>BX "A.2. (Carry forward)" · AX "A.L."</td></tr></table>''',
     form=Q('Computer Science A.S./A.L.: "Computer Science A.S. · A.2. (Carry forward on June) · A.2. (Carry forward on November) · A.L."'), img='p2-13-catalogue-option-carry-forward')
step('An A level with its three routes', '', img='p2-14-catalogue-a-level-routes')
step('Map each subject: what it enters', f'<p>{L("Subjects families register")} → the subject → {L("Map it")}: the board is set; choose {L("The award it enters")} (for Biology "0970 — Biology"), {L("Save")}, {L("Close")}. Each of the 25: the O.L. subjects to their syllabus, the Cambridge A levels to their AS award (the routes follow), Psychology A.L. to 9990, Arabic A.L. to YAA01.</p>', img='p2-15-catalogue-map-biology')
step('An IAL subject: its units', f'<p>For Mathematics A.S./A.L. leave {L("The award it enters")} at None and tick {L("Units or papers it is made of")}: WMA11, WMA12, WMA13, WMA14, WME01, WST01. Biology A.S./A.L.: WBI11 to WBI16.</p>',
     form=Q('Mathematics A.S./A.L.: "one optional question per unit — P1 … P4 · M1 · S1"'), img='p2-16-catalogue-map-ial-maths')
step('The subjects, mapped', '<p>Each subject now says what it enters and the school\'s code is worked out (O.L., A.S./A.2. …). Searching "Biology": the O.L. syllabus, the IAL units, Human Biology — and the seed\'s deactivated sample, which still counts as "not mapped yet" (a finding).</p>', img='p2-17-catalogue-mapped')

group('The settings the forms set')
step('Self-study: 50% of the course fee', f'<p>{L("Settings")} → {L("Prices")}: {L("Self-study: share of the course fee")} is 50% and {L("Self-study: share of the board fee")} 100% — the forms halve the school\'s fee only. Nothing to change.</p>',
     form=Q('"Self Study 50% fees (ONLY 2nd entry)"', '"Self Study 50% School fees (2nd entry ONLY)"'), img='p2-18-settings-self-study')
step('The refund policy of a June session', f'<p>{L("Refunds")} → {L("Refund policy of a new June session")}: "100% to week 2 · 50% in week 3 · 0% from week 4", counted from the first lesson. Each new June session copies it.</p>',
     form=Q('Refund Policy: "100% of the course fees if dropped within 2 weeks from the first lesson; 50% from 3 weeks from the first lesson; 0% from 4 weeks from the beginning of the course."', '"I confirm that I read the refund policy"'), img='p2-19-settings-refund-policy')

group('The June 2027 session')
step('New session', f'<p>{L("Sessions")} → {L("New session")}: {L("Type")} June, {L("June of")} 2027 (it will be called "June 2027"), {L("Reserve from")} 1 Nov 2026 08:00, {L("Reserve to")} 15 Feb 2027 23:00, {L("Course starts")} 1 Nov 2026, {L("Payment due")} 30 Nov 2026, {L("Copy from")} {L("Start empty")}, {L("Create session")}. A session whose reserving starts later stays a draft until then, or until {L("Open now")}.</p>',
     form=Q('The forms were made in September 2026 for June 2027: "registration for June opens nine months before the series" (SCHOOL_FORMS.md §1).'), img='p2-20-new-session')
step('The empty sheet', f'<p>The session\'s {L("Subjects")} tab is the links sheet. Empty: {L("Add subjects")}.</p>', img='p2-21-session-empty-sheet')
step('Add subject', f'<p>{L("Add subject")}, type the name or code, pick it. The form opens.</p>', img='p2-22-add-subject-search')
step("The subject's form", f'''<p>One form per subject, in the form\'s order: {L("Teachers this cycle")} (tick each; {L("online only")} where the form says so; {L("An external team")} by name), {L("Offered as")}, {L("Course fee")} (the self-study share shown beside it), then {L("Add subject")}. Once added, the same form shows the subject\'s papers, components or units below; set them and {L("Save")}.</p>
<p class="note">Offered as: {L("First entry and retakes")} is a taught subject — every form whose question is "Self Study 50% fees (ONLY 2nd entry)" or "Retake Self Study 50% fees (All Papers)"; {L("Retakes only")} and {L("Retake (Self Study ONLY)")} are the links sheet's "Retake (Self Study ONLY)" rows (none in June 2027; the November sheet has six).</p>''', img='p2-23-add-subject-form')
