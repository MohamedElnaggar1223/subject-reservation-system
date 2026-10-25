# The guide's words, chapter by chapter. Run by gen.py with L() (a label as the screen writes it), paste(),
# table(), chapter(), step() and D (guide-data.json) in scope. [[key]] links to a step, [[ch:id]] to a chapter.
# Every label below was read in the screen's source on this branch and driven on a local run (the drive in
# build/drive/); the pictures named in img= are that run's screenshots.

ADDRESS = 'https://subject-reservation-system.vercel.app'
S = {s['code']: s for s in D['subjects']}
fmt = lambda n: f'{n:,}'

HEADER = f'''<p>This guide is for you, the school's admin. It builds, on the system, the June 2027 session exactly as the school's
25 Google Forms describe it (17 O.L. forms and 8 A.S./A.L. forms): the people who work with you, the subjects and their teachers,
what each subject enters with its board, the session itself, each subject's form option by option, the boards' fees and dates, and
finally the session opened to families. Work through it from the top, with the system open beside it. Every chapter starts with what
it builds and why the next one needs it, and no step needs anything a later step makes.</p>
<p><b>How to read a step.</b> Words <span class="lbl">shaded like this</span> are written exactly as the screen writes them: look for
those words. <b>Where you are</b> says which screen to be on, named as the column on the left of the screen names it. The numbered
lines are what to click and type, in order. <b>You see</b> says what the screen shows when it worked. Beside each subject of
chapter 8, the yellow box quotes the school's own form, and the values to type are worked out from it option by option. In the
pictures, a <span class="redframe">red frame</span> marks what to click; it is drawn on the picture only, never on your screen.</p>
<p class="note"><b>About the pictures.</b> They were taken on a practice copy of the system, built step by step exactly as this
guide says, on the same version of the system the school uses (October 2026). The names <i>Teacher 1</i>, <i>Teacher 2</i>… and <i>Coordinator One</i>, the school's
name, the email addresses, the course fees, the board fees typed by hand and the boards' dates in the pictures are placeholders.
Your screen shows what you typed. The board fees pasted in the pictures are the boards' June 2026 lists, the last ones the school has.</p>'''

# ═══════════════════════════════════════ 1. Before you start ═══════════════════════════════════════
chapter('start', 'Before you start',
        'This chapter gathers what you need on your desk and signs you in. Everything after it happens on the system, '
        'in the order the screens need it.')
step('Have these at hand', do=f'''<ul>
<li><b>The June 2027 links sheet</b> (the list of the 25 subjects with their board and teachers) and <b>the 25 forms</b>
themselves. You will open each form beside its step in [[ch:sheet]].</li>
<li><b>The names of the teachers</b> each form names, written as you want families to read them. (The forms call them T1, T2, T3;
this guide does the same.)</li>
<li><b>The names and email addresses of the two people who will sign in with you:</b> the coordinator and the finance officer.</li>
<li><b>The school's name</b>, exactly as it should appear on the sign-in page.</li>
<li><b>The school's course fee for each subject this cycle</b>, and its fee for a one-paper retake and for one unit of an IAL
subject. These are the school's own figures: no list the school has shared holds them, so this guide cannot give them to you.</li>
<li><b>The boards' fee lists.</b> The June 2027 lists are not published yet; until they are, use the last ones the school has
(Cambridge "Registration Fees June 2026 (Year 11 &amp; 12)", Edexcel June 2026, and the Edexcel November 2026 lists).
[[^ch:fees]] says what to do now and what to do when the June 2027 lists arrive.</li>
<li><b>The boards' key dates for June 2027:</b> each board's entry deadline, and Cambridge's later date for retakes.</li>
<li><b>Your own dates for the session:</b> the first day families may reserve, the last day, the first lesson, and the day
payment is due.</li>
</ul>
<p>Plan on a few sittings. Everything is saved as you go: you can stop after any step and come back to the next one.</p>''')
step('Open the system', do=f'''<ol>
<li>On a computer (the screens are wide; a laptop is fine), open Chrome, Edge, Safari or Firefox.</li>
<li>Type this address in the address bar and press Enter: <code>{ADDRESS}</code></li>
</ol>
<p class="note">After a quiet spell the system takes a moment to wake up: <b>the first page can take up to a minute to appear.</b>
Wait for it; do not click again. Once it is awake, every page opens at once.</p>''')
step('Sign in', where='the sign-in page.', do=f'''<ol>
<li>{L("Email address")}: the email of the account you were given.</li>
<li>{L("Password")}: its password.</li>
<li>Click {L("Sign in")}.</li></ol>''', see='your Home page (next step).', img='sign-in-filled', key='sign-in')
step('Your Home page and the column on the left', where='Home.', do=f'''<p>Home says where each session stands and what it
still needs. Today it says {L("No session is open or being prepared.")} Leave its button {L("Start the next session")} alone: it
copies the last session, and there is none yet.</p>
<p>The column on the left lists the screens. Everything in this guide is under its first heading, {L("SET UP")}:
{L("Sessions")}, {L("Exam Catalogue")}, {L("Board Series")}, {L("Board Services")}, {L("School Fees")}, {L("Settings")},
{L("Day-one Import")} and {L("Team")}. {L("Home")} is above them. At the bottom are your name and {L("Sign Out")}.</p>''',
     img='home-empty')

# ═══════════════════════════════════════ 2. The school's name ═══════════════════════════════════════
chapter('name', "The school's name",
        "This puts the school's name on the sign-in page, so a family knows the account is the school's. It is the first thing "
        "anyone sees, so it comes first; nothing later depends on it.")
step("Open the school's name", where=f'{L("Settings")} in the left column.', do=f'''<ol>
<li>Click {L("Settings")} in the left column.</li>
<li>The first card is {L("The school's name")}. It says {L("Not set: the sign-in page shows the app's name alone")}.</li>
<li>Click its {L("Change")}.</li></ol>''', img='settings-school-name')
step('Type the name', where=f'{L("Settings")}, the card {L("The school\'s name")}.', do=f'''<ol>
<li>{L("New value")}: the school's name as it should print.</li>
<li>{L("Reason")}: a few words, for example <i>The school's name on the sign-in page</i>. Every change on Settings asks why;
the reason is kept in the record of changes.</li>
<li>Click {L("Save change")}.</li></ol>''', img='settings-school-name-typed')
step('Saved', where=f'{L("Settings")}.', see=f'the card shows the name and {L("Last changed")} with the date and your name.',
     img='settings-school-name-saved')
step('The sign-in page carries it', do=f'''<p>To look, click {L("Sign Out")} at the bottom of the left column, then sign in
again as in [[sign-in]].</p>''', see="the school's name above the system's name on the sign-in page.", img='sign-in-with-school-name')

# ═══════════════════════════════════════ 3. Your team ═══════════════════════════════════════
chapter('team', 'Your team',
        'This gives an account to the two people who run the session with you: the coordinator, who keeps the sheet and checks '
        'declared retakes, and the finance officer, who works the desk. Teachers do not need an account for the session: they get '
        'their names on the system in the next chapter.')
step('Open Team', where=f'{L("Team")} in the left column.', do=f'''<p>Click {L("Team")}. The page {L("Team & Accounts")}
has the form to make an account at the top and, under it, everyone who has one ({L("Staff")}, {L("Students")},
{L("Parents")}). Today the list holds only you.</p>''', img='team-open')
step('The coordinator', where=f'{L("Team")}.', do=f'''<ol>
<li>{L("Name")}: the coordinator's name.</li>
<li>{L("Email")}: the email they will sign in with.</li>
<li>{L("Temp. password")}: a first password of at least 8 characters with a capital letter and a digit (the box says
{L("Min 8, 1 upper, 1 digit")}).</li>
<li>{L("Role")}: {L("Coordinator")}.</li>
<li>{L("Teaches as")}: leave {L("Does not teach")}.</li>
<li>Click {L("Create Account")}.</li></ol>''',
     see=f'{L("Account created for")} and their email, with {L("Share the temporary password with them directly.")}',
     img='team-coordinator-filled', key='team-coordinator')
step('The finance officer', where=f'{L("Team")}.', do=f'''<p>The same, with {L("Role")}: {L("Finance Officer")} (the line
under the form says what the role does: {L("Runs the desk: payments, receipts and registrations on a family’s behalf.")}).
Choose {L("Finance Admin")} instead for a person who also handles refunds, exceptions and fee schedules.</p>''',
     img='team-finance_officer-filled')
step('Your staff', where=f'{L("Team")}, the {L("Staff")} list.', do='''<p>Give each person the address of the system
(<a href="#s1-2">step 1.2</a>), their email and their temporary password yourself.</p>''',
     see='the coordinator, the finance officer and you, each with their role.', img='team-list')

# ═══════════════════════════════════════ 4. Subjects and teachers ═══════════════════════════════════════
subj_lines = ['name,code,board,level,course fee'] + [f"{s['name']},{s['code']},{s['board']},{s['level']},0" for s in D['subjects']]

def teacher_cell(s):
    if s.get('external'):
        return 'none here: an external team teaches it; you name the team on its form in [[ch:sheet]]'
    n = len(s['teachers'])
    forms = {
        '3180': 'T1, T2, T3', '0970': 'T1, T2, T3', '0971': 'T1, T2, T3', '4MA1': 'T1, T2, T3',
        'ESL-OXFORD': 'T1 (Oxford), T2 (Oxford)', 'ARABIC-AL': 'T1 "(Edexcel YAA01)", T2 "(Edexcel 9AA01)"',
        'IAL-MATHS': 'T1 and T2 (named unit by unit)', '0972': 'T1', 'PHYS-ASAL': 'T1 (inside the A.S. option)',
    }
    return f"{n} — {forms.get(s['code'], 'the one teacher named in the form\'s description')}"

chapter('subjects', 'The 25 subjects and their teachers',
        "This puts on the system the 25 subjects of the June 2027 links sheet and, for each, the teachers its form names. The session's "
        'sheet in [[ch:sheet]] can only list a subject that exists here, and it offers each subject the teachers you give it here.')
step('Open the subject list', where=f'{L("Exam Catalogue")} in the left column.', do=f'''<ol>
<li>Click {L("Exam Catalogue")}.</li>
<li>Click {L("Import several from a list")} (on the right, above the empty list).</li></ol>
<p>The page {L("Subject Management")} opens with the box {L("Import subjects from Excel")}. This page is not in the left column:
this button is the way to it, and it is the way back to it later in this chapter.</p>''', img='catalogue-import-button', key='subjects-open')
step('Paste the 25 subjects', where=f'{L("Subject Management")}, the box {L("Import subjects from Excel")}.', do=f'''<ol>
<li>Click <b>Copy</b> on the block below.</li>
<li>Click in the big empty box on the screen and paste (Ctrl+V, or ⌘+V on a Mac).</li>
<li>Click {L("Import")}.</li></ol>
{paste(subj_lines)}
<p>Each line is one form: the subject's <b>name</b> as families will read it (the O.L. subjects keep their plain names: the
sheet and the families' page put them under "O.L."), its <b>code</b> (the board's syllabus code where the boards' lists have one;
a short code of the school's own where they do not, such as <code>ESL-OXFORD</code>), its <b>board</b>, its <b>level</b>, and a
<b>course fee</b> of 0. The 0 is only a starting value: you type each subject's real course fee on the session in [[ch:sheet]],
which is the fee families pay. You may change a name before you click {L("Import")} (for example <i>Business Studies</i> for
<i>Business</i>); keep the four commas of each line.</p>''', img='subjects-paste')
step('Imported', where=f'{L("Subject Management")}.', see=f'''{L("Imported 25 subject(s).")} and the 25 subjects in the list
below, each {L("Active")}, with {L("Edit")}, {L("Teachers")} and {L("Deactivate")} on its row. A line the page could not take
is listed under {L("Problems:")} with the reason; correct that line and paste it alone. Pasting a line twice changes nothing:
the second time it says the code {L("is already in use")}.''', img='subjects-imported')
step("A subject's teachers: Arabic", where=f'{L("Subject Management")}.', do=f'''<ol>
<li>Click {L("Close Import")} at the top to put the box away.</li>
<li>On the row <b>Arabic</b>, click {L("Teachers")}.</li></ol>''', img='subjects-teachers-button', key='teachers-first')
step('Type the names', where=f'the window {L("Teachers — Arabic")}.', do=f'''<ol>
<li>Click in the box {L("Teacher name — or paste several, one per line")}.</li>
<li>Type the three teachers your Arabic O.L. form names (T1, T2, T3 on the form), each as the form names them, one per line
(press Enter between two names).</li>
<li>Click {L("Add")}.</li></ol>
<p class="note">The forms list "Self study (Only for 2nd entry ONLY)" or "Self Study 50%" among the teachers. That is not a
teacher: do not type it. It is the retake in self study, which every subject offers once you choose its {L("Offered as")} in
[[ch:sheet]].</p>''', form=['Teacher: T1, T2, T3, "Self study (Only for 2nd entry ONLY)"'], img='teachers-arabic-typed')
step('Save the teachers', where=f'the window {L("Teachers — Arabic")}.', do=f'''<p>The names are in the list, ticked.
Click {L("Save Teachers")}.</p>''', see=f'the window closes. Arabic now has its three teachers.', img='teachers-arabic-added')
step('The other subjects', where=f'{L("Subject Management")}.', do=f'''<p>Do the same for each subject below: its row's
{L("Teachers")}, the names its form gives, {L("Add")}, {L("Save Teachers")}. The window lists every teacher already on the
system: <b>a teacher who teaches a second subject is ticked, not typed again</b> — find the name in the list and tick it.</p>
{table(['Subject', 'Teachers its form names — what to type'], [[esc(s['name']), teacher_cell(s)] for s in D['subjects']])}
<p>For Arabic A.L. give both teachers here: the one who teaches the IAL (YAA01) and the one who teaches the GCE (9AA01 on
the form). [[^sheet-arabic-al-2]] gives each its qualification.</p>''',
     see="each subject's own teachers ticked when you open its window again.", img='teachers-later-subject',
     cap='Mathematics opened again: its three teachers ticked among every name on the system.')
step('If a teacher must sign in (not needed for this session)', where=f'{L("Team")} in the left column.', do=f'''<p>A
teacher's name is all the session needs. A teacher's own account has, today, only {L("Home")}, {L("Notifications")} and
{L("Profile")}; you do not need to make one. If the school wants a teacher to sign in all the same:</p>
<ol><li>{L("Name")}, {L("Email")}, {L("Temp. password")} as in [[team-coordinator]].</li>
<li>{L("Role")}: {L("Teacher")}.</li>
<li>{L("Teaches as")}: pick the teacher's name in the list (the name you made in this chapter), not
{L("New teacher record (this name)")}, which would make a second one.</li>
<li>{L("Create Account")}.</li></ol>''', see=f'the account in the {L("Staff")} list, with the teacher\'s name under {L("Teaches as")}.',
     img='team-teacher-account')

# ═══════════════════════════════════════ 5. Exam Catalogue ═══════════════════════════════════════
def award_rows():
    BOARD = {'cambridge': 'Cambridge International', 'pearson_edexcel': 'Pearson Edexcel', 'oxford': 'OxfordAQA'}
    LEVEL = {'igcse': 'IGCSE', 'as_level': 'AS Level', 'a_level': 'A Level'}
    METHOD = {'qualification': 'Entered by its code', 'units_cash_in': 'Units, then a cash-in for the award', 'syllabus_option': 'Syllabus with an option code'}
    return [[BOARD[a['board']], f"<code>{esc(a['code'])}</code>", esc(a['title']), LEVEL[a['level']], esc(a['suite'] or '—'), esc(a['area']), METHOD[a['method']]] for a in D['awards']]

def option_rows(levels):
    rows = []
    for a in D['awards']:
        if a['board'] != 'cambridge' or a['level'] not in levels:
            continue
        for o in a.get('options', []):
            rows.append([f"<code>{esc(a['code'])}</code> {esc(a['title'])}", f"<code>{esc(o['code'])}</code>", esc(o['label']), 'ticked' if o['cf'] else '—'])
    return rows

award_label = lambda s: 'The award it enters' if s['level'] == 'IGCSE' else 'The award it enters (leave empty for units or papers only)'

def map_rows():
    out = []
    for code, m in D['maps']:
        s = S[code]
        if 'award' in m:
            a = next(a for a in D['awards'] if a['code'] == m['award'] and (a['level'] == {'IGCSE': 'igcse', 'AS Level': 'as_level', 'A Level': 'a_level'}[s['level']]))
            what = f"{L(award_label(s))}: <code>{esc(a['code'])} — {esc(a['title'])}</code>"
        else:
            what = f"{L(award_label(s))}: {L('None')}; tick " + ', '.join(f'<code>{u}</code>' for u in m['units'])
        out.append([esc(s['name']), f"<code>{esc(code)}</code>", what])
    return out

chapter('catalogue', 'What each subject enters with its board (the Exam Catalogue)',
        'This tells the system what each subject enters with its board: a Cambridge syllabus and its option code, the papers of a '
        "one-paper retake, the Pearson IAL units, the A.S., A.2. and A.L. routes. The session's sheet in [[ch:sheet]] builds each "
        "subject's choices from what you set here, and the boards' fees in [[ch:fees]] are matched by these codes.")
step('Load the two Pearson IAL sets', where=f'{L("Exam Catalogue")} in the left column.', do=f'''<p>At the top, the box
{L("Load a starter set from the research")} holds the Pearson International A Level units of Mathematics and Biology, with their
boards' codes, ready made.</p>
<ol><li>Click {L("Pearson IAL Mathematics")}.</li><li>Click {L("Pearson IAL Biology")}.</li></ol>
<p>Clicking one twice changes nothing.</p>''',
     see=f'{L("Added")} with the number of units and awards (for Biology, {L("Added 6 units and 2 awards.")}); the Pearson Edexcel card counts them. The units have the boards\' codes: <code>WMA11</code> P1 … <code>WST01</code> S1, <code>WBI11</code> Unit 1 … <code>WBI16</code> Unit 6.',
     form=['Mathematics A.S./A.L.: "P1 … P4 · M1 · S1"', 'Biology A.S./A.L.: "A.S. Paper 1 (WBI11/01) … A.2. Paper 6 (WBI16/01)"'],
     img=['catalogue-starter-buttons', 'catalogue-starter-loaded'])
paper_rows = [[esc(p['board_label']), f"<code>{esc(p['code'])}</code>", esc(p['short']), esc(p['title']), esc(p['for'])] for p in D['papers']]
step('The papers of the one-paper retakes', where=f'{L("Exam Catalogue")}, the tab {L("Units and papers")}.', do=f'''<p>Seven forms
offer a retake of one paper only (Arabic, Biology, Chemistry, Combined Science, ICT, Mathematics and Physics O.L.). Each paper is added once, here.</p>
<ol><li>Click the tab {L("Units and papers")}.</li>
<li>In the green box {L("Add a unit or paper")}: {L("Board")}, {L("Code")}, {L("School's name")} and {L("Title")} from the
first line of the table; {L("Its own level")}: {L("IGCSE / O Level")}; {L("Tier (where the syllabus fixes it)")}: leave
{L("None")}; {L("Kind")}: {L("Component (paper)")}.</li>
<li>Click {L("Add the unit")}. The box says {L("Added")} with the code, keeps the board, level and kind, and waits for the next
code: type the next line's code, name and title, and press Enter.</li>
<li>For the last two lines choose {L("Board")} {L("Pearson Edexcel")}: the {L("Kind")} then turns to {L("Unit")} on its own; set it back to {L("Component (paper)")}.</li></ol>
{table(['Board', 'Code', "School's name", 'Title', 'For the form'], paper_rows)}''',
     form=['"Retake Self Study 50% fees (Paper 41/42 ONLY)": From June 2026 / From November 2026 / None',
           '"Retake Self Study 50% fees (Theory Paper ONLY)"', '"Retake Self Study 50% fees (One Paper ONLY)": 1H / 2H / None',
           '"Retake in School 100% fees (One paper ONLY) From June 2026"'], img='units-add-paper')
step('The papers, added', where=f'{L("Exam Catalogue")}, {L("Units and papers")}.', do=f'''<p>Choose
{L("Cambridge International")} in {L("Board")} above the list to see the seven Cambridge papers; Pearson Edexcel holds 1H and 2H
beside the IAL units.</p>''', see=f'each paper with its code, its {L("School\'s name")} in grey, {L("Component (paper)")} and {L("IGCSE / O Level")}.',
     img='units-papers-added')
step('An award: Biology', where=f'{L("Exam Catalogue")}, the tab {L("Qualifications")}.', do=f'''<p>An award is what the board
issues: a Cambridge syllabus, a Pearson qualification. Each subject needs its award.</p>
<ol><li>Click the tab {L("Qualifications")}.</li>
<li>In {L("Add an award")}: {L("Board")} {L("Cambridge International")}; {L("Code (cash-in or syllabus)")} <code>0970</code>;
{L("Title")} <i>Biology</i>; {L("Level")} {L("IGCSE")}; {L("Suite")} {L("Cambridge IGCSE")}; {L("Subject (AS and A Level share it)")}
<i>Biology</i>; {L("How the board takes the entry")} {L("Syllabus with an option code")}; {L("Tier (only if the syllabus fixes it)")}:
leave {L("Chosen per entry")}.</li>
<li>Click {L("Add the award")}.</li></ol>''', see='the card "0970 Biology" under Cambridge International.', img='award-add-0970', key='award-first')
step('The other awards', where=f'{L("Exam Catalogue")}, {L("Qualifications")}.', do=f'''<p>Add each award of the table the same
way (Biology is in it too). The box keeps nothing between two awards: choose the {L("Board")} first, since the {L("Suite")} list
follows it.</p>
{table(['Board', 'Code', 'Title', 'Level', 'Suite', 'Subject (AS and A Level share it)', 'How the board takes the entry'], award_rows())}
<p>Why two awards for some subjects:</p><ul>
<li>A Cambridge A level has two awards under one code: its AS Level and its A Level (9701, 9618, 9898, 9702). Type the same
{L("Subject (AS and A Level share it)")} for both.</li>
<li>Arabic A.L. has two qualifications, one per teacher: the International A Level <code>YAA01</code> and the GCE A Level
<code>9AA0</code> (the form writes "9AA01"). The GCE has no suite in the list: leave {L("Suite")} at {L("—")}, and type
<i>Arabic</i> as the subject for both.</li>
<li>The two Pearson IAL subjects need no award here: their units came with the starter sets.</li></ul>''',
     form=['Arabic A.L.: "T1 (Edexcel YAA01)", "T2 (Edexcel 9AA01)" — the teacher choice chooses the qualification'],
     img=['award-add-9aa0', 'awards-pearson'], cap=['The GCE award of Arabic A.L.: no suite.', 'The Pearson Edexcel awards once added (beside the starter sets\' four).'])
step("Each award's papers", where=f'{L("Exam Catalogue")}, {L("Qualifications")}.', do=f'''<ol>
<li>On the card <b>0970 Biology</b>, click {L("Edit units")}.</li>
<li>Tick <code>0970/41</code> {L("Paper 41/42")}; leave {L("Required")} beside it.</li>
<li>Click {L("Save the units")}.</li></ol>
<p>The same for each award with a paper:</p>
{table(['Award', 'Tick'], [[f"<code>{esc(a['code'])}</code> {esc(a['title'])}", ', '.join(f'<code>{u}</code>' for u in a['units'])] for a in D['awards'] if a.get('units')])}''',
     see='the card lists the paper with "Required".', img='award-0970-units')
step('The option codes of the O.L. syllabi', where=f'{L("Exam Catalogue")}, {L("Qualifications")}.', do=f'''<p>Cambridge enters a
syllabus with an option code, the one its fee list prints beside the syllabus (Biology <code>0970 CX</code>).</p>
<ol><li>On the card <b>0970 Biology</b>, under {L("OPTION CODES")}, click {L("Add an option")}.</li>
<li>In the small box (it shows <i>AX</i> in grey) type <code>CX</code>; in the long box beside it type <i>All papers</i>.</li>
<li>Leave {L("Components it enters")} and {L("Carries forward marks from an earlier series")} unticked.</li>
<li>Click {L("Add the option")}.</li></ol>
{table(['Award', 'Small box', 'Long box', 'Carries forward…'], option_rows(['igcse']))}
<p>Environmental Management, Global Perspectives and Global Citizenship have no option code in the lists the school has: they get
none (the board fee is then typed against the syllabus itself in [[ch:fees]]).</p>''', img=['award-0970-option', 'award-0970-done'],
     cap=[None, 'Biology, done: its paper and its option code.'])
step('The A level routes: A.S., A.2. and A.L.', where=f'{L("Exam Catalogue")}, {L("Qualifications")}.', do=f'''<p>The Cambridge
A level forms offer "A.S.", "A.2. (Carry forward)" and "A.L.". Each is an option code of the A level's two awards, and families
read the words you type in the long box. Add these options the same way; on each A.2. option also tick
{L("Carries forward marks from an earlier series")}.</p>
{table(['Award', 'Small box', 'Long box (families read it)', 'Carries forward…'], option_rows(['as_level', 'a_level']))}
<p>Psychology A.L. (<code>9990</code>) has one route, the full A level: it gets no option.</p>''',
     form=['Computer Science A.S./A.L.: "Computer Science A.S. · A.2. (Carry forward on June) · A.2. (Carry forward on November) · A.L."',
           'Chemistry A.S.: "Chemistry A.S. / Chemistry A.L."'], img=['award-9702-al-option-carry', 'award-9702-done'],
     cap=[None, 'Physics: A.S. on its AS award; A.2. (Carry forward) and A.L. on its A Level award.'])
step('Map each subject: what it enters', where=f'{L("Exam Catalogue")}, the tab {L("Subjects families register")}.', do=f'''<p>The last
part ties each of the 25 subjects to its award or units. The tab says {L("25 to map")}, and {L("Only subjects not mapped yet")} is
ticked, so the list shrinks as you go.</p>
<ol><li>Click the tab {L("Subjects families register")}.</li>
<li>In {L("Search")}, type the subject's code (Arabic: <code>3180</code>).</li>
<li>Click {L("Map it")} on its row.</li></ol>''', img='map-button', key='map-first')
step('Biology', where=f'the window {L("What Biology enters")}.', do=f'''<ol>
<li>{L("Board it is entered with")} is already chosen (Cambridge International). Leave it.</li>
<li>{L("The award it enters")}: <code>0970 — Biology</code>.</li>
<li>Leave {L("Components (optional)")} unticked and {L("Note (optional, kept in the audit log)")} empty.</li>
<li>Click {L("Save")}, then {L("Close")}.</li></ol>''', see=f'{L("Saved")} and {L("No registration had to move.")}', img='map-biology')
step('An IAL subject: Mathematics A.S./A.L.', where=f'the window {L("What Mathematics A.S./A.L. enters")}.', do=f'''<ol>
<li>{L("The award it enters (leave empty for units or papers only)")}: leave {L("None")}.</li>
<li>Under {L("Units or papers it is made of")}, tick <code>WMA11</code> P1, <code>WMA12</code> P2, <code>WMA13</code> P3,
<code>WMA14</code> P4, <code>WME01</code> M1 and <code>WST01</code> S1 — the six units the form offers. Leave M2, S2 and D1.</li>
<li>{L("Save")}, {L("Close")}.</li></ol>
<p>Biology A.S./A.L. the same way, with <code>WBI11</code> to <code>WBI16</code> (Units 1 to 6).</p>''',
     form=['Mathematics A.S./A.L.: one question per unit — "P1 · P2 · P3 · P4 · M1 · S1"'], img='map-ial-maths')
step('A Cambridge A level: Chemistry A.S.', where=f'the window {L("What Chemistry A.S. enters")}.', do=f'''<p>A Cambridge A level
subject enters its AS award; its A.2. and A.L. routes come with it.</p>
<ol><li>{L("The award it enters (leave empty for units or papers only)")}: <code>9701 — Chemistry (AS Level)</code>.</li>
<li>{L("Save")}, {L("Close")}.</li></ol>''', img='map-chemistry-as')
step('Every subject, mapped', where=f'{L("Exam Catalogue")}, {L("Subjects families register")}.', do=f'''<p>Map the rest from this
table (the ones above are in it too):</p>
{table(['Subject', 'Search', 'In the window'], map_rows())}''',
     see=f'''no more {L("to map")} on the tab and no warning; untick {L("Only subjects not mapped yet")} to see all 25, each with what it
enters and its {L("School's code")} ({L("O.L.")}, {L("A.S.")}, {L("A.L.")}, {L("A.S./A.2.")}), worked out for you.''',
     img='catalogue-all-mapped')

# ═══════════════════════════════════════ 6. Settings ═══════════════════════════════════════
chapter('settings', 'The settings the forms set',
        "This checks the two rules the forms state for the whole session: what self study costs and the June refund policy. A new June "
        'session copies the refund policy when it is made in the next chapter, so check it first.')
step('Self study: 50% of the course fee', where=f'{L("Settings")}, the group {L("Prices")}.', do=f'''<p>Scroll to
{L("Prices")} (or click it in {L("ON THIS PAGE")}).</p>
<ul><li>{L("Self-study: share of the course fee")}: {L("50%")} — the forms' "Self Study 50% School fees".</li>
<li>{L("Self-study: share of the board fee")}: {L("100%")} — the forms halve the school's fee only; the board's fee is paid in
full.</li></ul><p>Both are already so: <b>nothing to change.</b></p>''',
     form=['"Self Study 50% fees (ONLY 2nd entry)"', '"Self Study 50% School fees (2nd entry ONLY)"'], img='settings-self-study')
step('The June refund policy', where=f'{L("Settings")}, the group {L("Refunds")}.', do=f'''<p>{L("Refund policy of a new June session")}
reads {L("100% to week 2 · 50% in week 3 · 0% from week 4")}, counted from the first lesson — the June forms' policy.
<b>Nothing to change.</b> The first lesson is the session's {L("Course starts")} date ([[session-new]]).</p>''',
     form=['Refund Policy: "100% of the course fees if dropped within 2 weeks from the first lesson; 50% from 3 weeks from the first lesson; 0% from 4 weeks from the beginning of the course."'],
     img='settings-refund-june')

# ═══════════════════════════════════════ 7. The session ═══════════════════════════════════════
chapter('session', 'The June 2027 session',
        'This makes the session itself: its name, the days families may reserve, the first lesson, the payment date and its refund '
        "policy. The next chapter fills its sheet, subject by subject.")
step('New session', where=f'{L("Sessions")} in the left column.', do=f'''<p>Click {L("Sessions")}: {L("No sessions yet")}.
Click {L("New session")}.</p>''', img='sessions-empty')
step('The dates', where=f'the window {L("New session")}.', key='session-new', do=f'''<ol>
<li>{L("Type")}: {L("June")}. {L("June of")}: <code>2027</code>. The grey box says {L("It will be called June 2027.")} and its
refunds.</li>
<li>{L("Reserve from")}: the day and hour families may start reserving.</li>
<li>{L("Reserve to")}: the last day and hour families may reserve (before the boards' entry deadlines).</li>
<li>{L("Course starts")}: the first lesson. The refund weeks count from it.</li>
<li>{L("Payment due")}: when families must have paid.</li>
<li>{L("Copy from")}: {L("Start empty")}.</li>
<li>Click {L("Create session")}.</li></ol>
<p class="warn"><b>Choose a {L("Reserve from")} day after the day you expect to finish this guide.</b> A session whose reserving
starts today or earlier opens to families at once — before its sheet is ready. Until that day it stays a draft, and when you are
ready you can open it earlier yourself ([[open-now]]). Every date can be changed later with {L("Edit")} on the session.</p>''',
     see='the Session screen of June 2027 (next step).', img='session-new-filled')
step('The Session screen', where=f'{L("Sessions")} → June 2027.', do=f'''<p>This screen is where the rest of the guide happens.
At the top: the name, {L("Draft")}, the dates and the refunds, and the buttons {L("Edit")}, {L("Open now")},
{L("Correct the sitting")} and {L("Delete this draft")}. Under them the {L("Deadlines")} line, which says
{L("No sittings yet: a subject's sitting is added with the subject.")} Then the tabs {L("Subjects")}, {L("Fees")},
{L("Money")}, {L("Grade 10")} and {L("To verify")}. The {L("Subjects")} tab is the links sheet; today it says
{L("No subjects on this sheet yet")}.</p>
<p>To come back to it later: {L("Sessions")} in the left column, then <b>June 2027</b> (or its {L("Open")}).</p>''', img='session-empty-sheet')

# ═══════════════════════════════════════ 8. The sheet ═══════════════════════════════════════
OFFERED = f'{L("Offered as")}: {L("First entry and retakes")}'
def fee_line(s, what='this subject'):
    return f'{L("Course fee (EGP)")}: the course fee the school charges for {what} this cycle. Beside it the screen shows {L("Self Study 50% School fees:")} and half that fee'

def teachers_line(s, n_word):
    return f'{L("Teachers this cycle")}: tick {n_word}'

SHEET_FORMS = {
 '3180': ['Teacher: T1, T2, T3, "Self study (Only for 2nd entry ONLY)"', 'Please choose from below: "First Entry in School 100% fees (All Papers)" · "Retake in School 100% fees (All Papers)" · "Retake Self Study 50% fees (All Papers)" · "Retake in School 100% fees (One paper ONLY) From June 2026" · "Retake Self Study 50% fees (One paper ONLY) From June 2026"'],
 '0970': ['Teacher: T1, T2, T3, "Self Study 50% (Second entry ONLY)"', '"Retake Self Study 50% fees (All Papers)" Yes / No', '"Retake Self Study 50% fees (Paper 41/42 ONLY)": From June 2026 / From November 2026 / None'],
 '0986': ['One teacher, named in the description', '"Self Study 50% fees (ONLY 2nd entry)" Yes / No'],
 '0971': ['Teacher: T1, T2, T3, "Self Study 50%"', '"Retake Self Study 50% fees (All Papers)" Yes / No', '"Retake Self Study 50% fees (Paper 41/42 ONLY)": From June 2026 / From November 2026 / None'],
 '0653': ['One teacher, named in the description', '"Retake Self Study 50% fees (All Papers)" Yes / No', '"Retake Self Study 50% fees (Paper 41/42 ONLY)": From June 2026 / From November 2026 / None'],
 '0984': ['One teacher, named in the description: the external team of the links sheet', '"Retake Self Study 50% fees (All Papers)" Yes / No', '"Paper 41/42" with "From June 2025 / From November 2025"'],
 'ESL-OXFORD': ['Teacher: T1 (Oxford), T2 (Oxford), "Self Study 50% (ONLY 2nd entry)"', '"Self Study 50% fees (ONLY 2nd entry)" Yes / No'],
 '0680': ['One teacher, named in the description', '"Self Study 50% fees (ONLY 2nd entry)" Yes / No'],
 '7156': ['One teacher, named in the description', '"Self Study 50% fees (ONLY 2nd entry)" Yes / No'],
 '7159': ['One teacher, named in the description', '"Self Study 50% fees (ONLY 2nd entry)" Yes / No'],
 '0457': ['One teacher, named in the description, "(ONLINE ONLY)"', '"Self Study 50% fees (ONLY 2nd entry)" Yes / No'],
 'GLOBAL-CIT': ['One teacher, named in the description', '"Self Study 50% fees (ONLY 2nd entry)" Yes / No', 'The refund box, without the policy\'s text'],
 '4HB1': ['One teacher, named in the description', '"Self Study 50% fees (ONLY 2nd entry)" Yes / No'],
 '0983': ['One teacher, named in the description: the external team of the links sheet', '"Retake Self Study 50% fees (All Papers)" Yes / No', '"Retake Self Study 50% fees (Theory Paper ONLY)": From June 2026 / From November 2026 / None'],
 '4MA1': ['Teacher: T1, T2, T3, "Self Study 50% (ONLY 2nd entry)"', '"Retake Self Study 50% fees (All Papers)" Yes / No', '"Retake Self Study 50% fees (One Paper ONLY)": 1H / 2H / None'],
 '0972': ['Teacher: T1, "Self Study 50%"', '"Retake Self Study 50% fees (All Papers)" Yes / No', '"Retake Self Study 50% fees (Paper 41/42 ONLY)": From June 2026 / From November 2026 / None'],
 'PSY-OXFORD': ['One teacher, named in the description', '"Self Study 50% fees (ONLY 2nd entry)" Yes / No'],
 'ARABIC-AL': ['Teacher: T1 "(Edexcel YAA01)", T2 "(Edexcel 9AA01)", "Self Study 50% (second entry only)"', '"Self Study 50% fees (ONLY 2nd entry)" Yes / No'],
 'IAL-BIOLOGY': ['One teacher, named in the description', 'Any number of: "A.2. Paper 5 (WBI15/01) First entry 100% June 2027" · "A.2. Paper 6 (WBI16/01) First entry 100% June 2027"', '"A.S. Paper 1 (WBI11/01) Self Study 50% 2nd entry ONLY" · "A.S. Paper 2 (WBI12/01) SS 50%" · "A.S. Paper 3 (WBI13/01) SS 50%" · "A.2. Paper 4 (WBI14/01) SS 50%" · "A.2. Paper 5 (WBI15/01) SS 50%" · "A.2. Paper 6 (WBI16/01) SS 50%"'],
 'CHEM-AS': ['One teacher, named in the description', '"Kindly specify the Components": Chemistry A.S. / Chemistry A.L.', '"Self Study (ONLY 2nd entry)" Yes / No'],
 'CS-ASAL': ['No teacher listed (the links sheet: "External")', 'Components: "Computer Science A.S." · "A.2. (Carry forward on June)" · "A.2. (Carry forward on November)" · "A.L."', '"Self Study (ONLY 2nd entry)" Yes / No'],
 'FRENCH-ASAL': ['One teacher, named in the description', 'Components: "French A.S." / "French A.L."', '"Self Study (ONLY 2nd entry)" Yes / No'],
 'IAL-MATHS': ['One optional question per unit: "P1: T1 (ONLINE ONLY) / Self Study 50% School fees (2nd entry ONLY)" · "P2: the same" · "P3: T1 / SS" · "P4: T1 / SS" · "M1: T2 / T1 / SS" · "S1: T2 / T1 / SS"', '"Self Study (ONLY 2nd entry)" Yes / No'],
 'PHYS-ASAL': ['Components: "Physics A.S. in School 100% fees (T1)" · "Physics A.2. (Self Study 50% fees in June 2027)" · "A.2. Self Study 50% (Carry forward on June 2026)" · "A.2. Self Study 50% (Carry forward on November 2025)"', '"Self Study (ONLY 2nd entry)" Yes / No'],
 'PSY-AL': ['One teacher, named in the description', '"Self Study 50% fees (ONLY 2nd entry)" Yes / No'],
}
SS_YN = f'The form\'s "Self Study 50% fees (ONLY 2nd entry)" Yes / No is the retake in self study that {L("First entry and retakes")} already offers: nothing more to set.'
ALL_YN = f'"Retake Self Study 50% fees (All Papers)" Yes / No is the whole-subject retake in self study that {L("First entry and retakes")} offers.'
ONE_PAPER_FEE = f'In the box beside it, the school\'s course fee for one paper. Left empty, a one-paper retake costs the whole subject\'s course fee; the self-study share applies to it'
FROM_SITTING = 'The form\'s "From June 2026 / From November 2026" is asked of the family on its Reserve page: a one-paper retake asks "Carried from the sitting…" and the school verifies it; "None" is simply not ticking it'

TEACHER_WORDS = {'3180': 'T1, T2, T3', '0970': 'T1, T2, T3', '0971': 'T1, T2, T3', '4MA1': 'T1, T2, T3', 'ESL-OXFORD': 'T1 (Oxford), T2 (Oxford)',
                 '0972': 'the teacher your form names (T1 on the form)', 'PHYS-ASAL': 'the teacher your form names (T1 on the form, inside the A.S. option)'}
FORM_SHORT = lambda s: s['form'].split(' (')[0]

def ss_note(code):
    q = 'Self Study (ONLY 2nd entry)' if S[code]['group'] != 'O.L.' and code not in ('ARABIC-AL', 'PSY-AL') else 'Self Study 50% fees (ONLY 2nd entry)'
    return f'The form\'s "{q}" Yes / No is the retake in self study that {L("First entry and retakes")} already offers: nothing more to set.'

def sheet_do(code):
    s = S[code]
    sh = s['sheet']
    n = len(s.get('teachers', []))
    items = [f'Click {L("Add subject")}, type <code>{esc(code)}</code> and click <b>{esc(s["name"])}</b> in the list.']
    words = {1: 'the one teacher', 2: 'the two teachers', 3: 'the three teachers'}
    if s.get('external'):
        pass
    elif code == 'ARABIC-AL':
        items.append(f'{L("Teachers this cycle")}: tick only the IAL teacher (T1 on the form, "(Edexcel YAA01)"). Leave the GCE teacher unticked: that teacher is added with the GCE qualification once the subject is added.')
    elif code == 'IAL-MATHS':
        items.append(f'{L("Teachers this cycle")}: tick both teachers the form names (T1 and T2). Each unit gets its own below.')
    elif n == 1:
        who = TEACHER_WORDS.get(code, f"the teacher named in your {esc(FORM_SHORT(s))} form's description")
        items.append(f'{L("Teachers this cycle")}: {who} comes already ticked, since the subject has only one teacher. Leave it ticked.')
    else:
        items.append(f'{L("Teachers this cycle")}: tick {words[n]} your {esc(FORM_SHORT(s))} form names ({TEACHER_WORDS[code]} on the form).')
    if code == '0457':
        items.append(f'Beside the teacher, tick {L("online only")}: families see "(online)" after the teacher\'s name.')
    if s.get('external'):
        if code == '0984':
            items.append(f'{L("An external team")}: type the team\'s name as the links sheet gives it, click {L("Add")}. It appears under the list, marked {L("External team")}. Leave the teachers in the list above it unticked: since no teacher was given to this subject in [[ch:subjects]], the list shows everyone. (In the picture, the team is <i>External Team</i>.)')
        else:
            items.append(f'{L("Teachers this cycle")}: the team you named for Computer Science O.L. is now in the list, marked {L("External team")}: tick it. (The list shows every teacher, since no teacher was given to this subject in [[ch:subjects]].)')
    items.append(f'{OFFERED}.')
    unit = {'IAL-BIOLOGY': 'one unit of Biology A.S./A.L.', 'IAL-MATHS': 'one unit of Mathematics A.S./A.L.'}.get(code, f'{esc(s["name"])}{" O.L." if s["group"] == "O.L." else ""}')
    items.append(fee_line(s, unit) + '.')
    more = sh.get('papers') or sh.get('routes') or sh.get('units') or sh.get('second')
    items.append(f'Click {L("Add subject")}.' + (' The form stays open and shows what comes next.' if more else ''))
    PAPER = {'retake_only': 'Retake in school or self study', 'self_study_only': 'Retake self study only'}
    for p, (avail, _) in (sh.get('papers') or {}).items():
        code_u = next(x['code'] for x in D['papers'] if x['short'] == p and x['code'].startswith(s['code'][:4]))
        items.append(f'{L("One paper only")}, the line {L(p + " only")} <code>({code_u})</code>: choose {L(PAPER[avail])}. {ONE_PAPER_FEE}.')
    ROUTE = {'open': 'Offered', 'self_study_only': 'Self study only', 'closed': 'Not offered this cycle'}
    RW = {'A.S.': 'A.S.', 'A.2.': 'A.2. (carry forward on an earlier June or November)', 'A.L.': 'A.L.'}
    for r, avail in (sh.get('routes') or {}).items():
        items.append(f'{L("Components")}, {L(RW[r])}: {L(ROUTE[avail])}.')
    UNIT = {'open': 'Taught by', 'self_study_only': 'Self study only'}
    for u, spec in (sh.get('units') or {}).items():
        avail = spec[0]
        short = {'WBI11': 'Unit 1', 'WBI12': 'Unit 2', 'WBI13': 'Unit 3', 'WBI14': 'Unit 4', 'WBI15': 'Unit 5', 'WBI16': 'Unit 6',
                 'WMA11': 'P1', 'WMA12': 'P2', 'WMA13': 'P3', 'WMA14': 'P4', 'WME01': 'M1', 'WST01': 'S1'}[u]
        t = ''
        if avail == 'open':
            names = spec[1]
            online = spec[2] if len(spec) > 2 else []
            if code == 'IAL-MATHS':
                who = 'T1' if len(names) == 1 else 'both T2 and T1'
                t = f' Under {L("Its teachers (none ticked: the subject\'s)")}, tick {who}' + (f' and {L("online only")} beside T1' if online else '') + '.'
            else:
                t = f' Its teacher is the subject\'s (T1): leave {L("Its teachers (none ticked: the subject\'s)")} as it is, or tick that teacher.'
        items.append(f'{L("Units")}, <b>{short}</b> <code>({u})</code>: {L(UNIT[avail])}.{t}')
    if sh.get('papers') or sh.get('routes') or sh.get('units'):
        items.append(f'Click {L("Save")}.')
    return '<ol>' + ''.join(f'<li>{i}</li>' for i in items) + '</ol>'

SHEET_NOTES = {
 '3180': f'<p>Every option of the form has its place: the first three are {L("First entry and retakes")}; the two "(One paper ONLY)" options are Paper 1 and Paper 2 "in school or self study" (the form does not ask which paper; the family chooses Paper 1 or Paper 2 here). The teacher list\'s "Self study" is the retake in self study. {FROM_SITTING}.</p>',
 '0970': f'<p>{ALL_YN} "(Paper 41/42 ONLY)" is the paper you added in [[ch:catalogue]], offered in self study only, as the form says. {FROM_SITTING}.</p>',
 '0986': f'<p>{ss_note('0986')}</p>', '0680': f'<p>{ss_note('0680')}</p>', '7156': f'<p>{ss_note('7156')}</p>', '7159': f'<p>{ss_note('7159')}</p>', '4HB1': f'<p>{ss_note('4HB1')}</p>',
 'PSY-OXFORD': f'<p>{ss_note('PSY-OXFORD')}</p>', 'PSY-AL': f'<p>{ss_note('PSY-AL')}</p>', 'ESL-OXFORD': f'<p>{ss_note('ESL-OXFORD')} The form\'s title carries no session; it is this June 2027 sheet\'s.</p>',
 '0971': f'<p>{ALL_YN} Paper 41/42 in self study only, as the form says. {FROM_SITTING}.</p>',
 '0653': f'<p>{ALL_YN} Paper 41/42 in self study only. {FROM_SITTING}.</p>',
 '0972': f'<p>{ALL_YN} Paper 41/42 in self study only. {FROM_SITTING}.</p>',
 '0984': f'<p>{ALL_YN}</p><p class="warn"><b>The form\'s "Paper 41/42" question has nothing to set.</b> It was left from last year\'s form: its options name the 2025 sittings, and Computer Science <code>0984</code> has no Paper 4. Offer no one-paper retake for it. If the school does take a one-paper retake of Computer Science, ask the coordinator which paper, add it on {L("Units and papers")} and tick it in the 0984 award\'s {L("Edit units")} ([[ch:catalogue]]); it then appears here under {L("One paper only")}.</p>',
 '0457': f'<p>{ss_note('0457')}</p>',
 'GLOBAL-CIT': f'<p>{ss_note('GLOBAL-CIT')} The form shows the refund box without the policy\'s text; on its Reserve page every family reads the session\'s policy before it reserves ([[ch:preview]]).</p>',
 '0983': f'<p>{ALL_YN} The "Theory Paper ONLY" retake is the paper <code>0983/01</code>, in self study only. {FROM_SITTING}.</p>',
 '4MA1': f'<p>{ALL_YN} "(One Paper ONLY): 1H / 2H / None" are the two papers, each in self study only; "None" is not ticking them. Here the form names the paper; the family\'s Reserve page also asks which sitting the other paper comes from, and the school verifies it.</p>',
 'ARABIC-AL': f'<p>{ss_note('ARABIC-AL')} The second teacher and the GCE qualification are the next step.</p>',
 'IAL-BIOLOGY': f'<p>In June only Units 5 and 6 are taught; the four others (and 5 and 6 again) are self-study retakes. {L("Taught by")} offers a unit for a first entry, a retake in school and a retake in self study; {L("Self study only")} offers it in self study only. Each unit is reserved and priced on its own, so the course fee is for one unit.</p>',
 'CHEM-AS': f'<p>The form offers A.S. or the full A level in one sitting, not A.2.: so {L("A.2. (carry forward on an earlier June or November)")} is not offered this cycle. {ss_note('CHEM-AS')}</p>',
 'CS-ASAL': f'<p>All three routes are offered. The form\'s two A.2. options, "Carry forward on June" and "Carry forward on November", are one route here: the family names the sitting its A.S. result comes from, and the school verifies it. {ss_note('CS-ASAL')}</p>',
 'FRENCH-ASAL': f'<p>French has no A.2. route (you gave it no A.2. option in [[ch:catalogue]]): only {L("A.S.")} and {L("A.L.")} appear. {ss_note('FRENCH-ASAL')}</p>',
 'IAL-MATHS': f'<p>Each unit has its own teachers, as the form asks unit by unit: P1 and P2 by T1 online only, P3 and P4 by T1, M1 and S1 by T2 or T1 (the family chooses). A unit left with none ticked is taught by the subject\'s teachers. Each unit is reserved and priced on its own, so the course fee is for one unit. Every unit is also offered as a self-study retake, the form\'s "Self Study 50% School fees (2nd entry ONLY)".</p>',
 'PHYS-ASAL': f'<p>A.S. is taught by the subject\'s teacher (T1 on the form). The form\'s three A.2. options are all the A.2. in self study in June 2027; two of them name the sitting the A.S. result is carried from (June 2026, November 2025). On the sheet they are one route, {L("A.2. (carry forward on an earlier June or November)")} in self study only: the family names the sitting its A.S. comes from, and the school verifies it. The full A level in one sitting is not on the form, so {L("A.L.")} is not offered. {ss_note('PHYS-ASAL')}</p>',
}

chapter('sheet', 'The sheet: the 25 forms, one subject each',
        "This turns each of the 25 forms into one row of the session's sheet: its teachers, how it is offered, its course fee and its "
        "papers, components or units, in the form's words. Families see exactly these choices, and the board fees of the next chapter "
        'are added to the rows made here.')
step('Add a subject', where=f'{L("Sessions")} → June 2027, the tab {L("Subjects")}.', do=f'''<ol>
<li>Click {L("Add subjects")} (once the sheet has one, the button is {L("Add subject")}, top right).</li>
<li>In {L("Subject")}, type the subject's code or name.</li>
<li>Click the subject. Its form opens on the right.</li></ol>''', img=['sheet-add-button', 'sheet-add-search'], key='sheet-add')
step("The subject's form, part by part", where="the subject's form, on the right of the Session screen.", do=f'''<p>Every
subject's form has the same parts, in the order of a Google Form:</p>
<ul><li>{L("Teachers this cycle")}: the subject's teachers from [[ch:subjects]]. Tick each one who teaches it this cycle. Beside a
ticked teacher, tick {L("online only")} if that teacher teaches online. {L("Show every teacher")} lists everyone on the system.
{L("An external team")}: an outside team by the name the links sheet gives, then {L("Add")}.</li>
<li>{L("Offered as")}: {L("First entry and retakes")} for every June 2027 form (a first entry, a retake in school and a retake in
self study). The other choices are for a subject offered to re-sitters only ({L("Retakes only")}, {L("Retake (Self Study ONLY)")});
no June 2027 form is.</li>
<li>{L("Course fee")}: the school's course fee, with the self-study half beside it.</li>
<li>Then {L("Add subject")}. Once added, the form shows what the Catalogue gave the subject: {L("One paper only")},
{L("Components")}, {L("Units")} or {L("Qualifications")}. Set them and click {L("Save")}.</li>
<li>{L("Grade 10 core")}, {L("Course starts (if not the session's)")} and {L("Notes")}: leave them.</li></ul>
<p>The form closes with the cross at its top right, or the Esc key. Click a subject's name on the sheet to open its form again.</p>''',
     img='sheet-form-new', tall=True)
for s in D['subjects']:
    code = s['code']
    n = f"{s['n']:02d}"
    sh = s['sheet']
    more = sh.get('papers') or sh.get('routes') or sh.get('units')
    if code == '3180':
        imgs = [f'sheet-{n}-{code.lower()}-a', f'sheet-{n}-{code.lower()}-b']
    elif code == 'ARABIC-AL':
        imgs = [f'sheet-{n}-{code.lower()}-a']
    else:
        imgs = [f'sheet-{n}-{code.lower()}-b' if more else f'sheet-{n}-{code.lower()}']
    title = f"{s['form']}"
    see = f'''{L("Added.")} at the top of the form{' (after ' + L("Save") + ', ' + L("Saved.") + ')' if more else ''}; on the sheet, the row <b>{esc(s["name"])}</b> under {L("O.L.") if s["group"] == "O.L." else L("A.S. / A.L.")} with its teachers and its entry options in the forms' words; {L("Board fee not set")} until [[ch:fees]].'''
    step(title, where=f'{L("Sessions")} → June 2027, {L("Subjects")}.', do=sheet_do(code) + SHEET_NOTES.get(code, ''), see=see,
         form=SHEET_FORMS[code], img=imgs, tall=True, key=f'sheet-{code.lower()}')
    if code == 'ARABIC-AL':
        step('Arabic A.L.: its second qualification, with its teacher', where='the form of Arabic A.L., still open.', key='sheet-arabic-al-2', do=f'''<p>The form
chooses the qualification through the teacher: T1 teaches the International A Level (YAA01), T2 the GCE A Level (9AA01 on the form,
<code>9AA0</code> on the system).</p>
<ol><li>Under {L("Another qualification")}, click {L("Add a qualification:")} <b>Edexcel 9AA0 (Arabic (GCE A Level))</b>.</li>
<li>Under {L("Its teacher (the family chooses the qualification with the teacher)")}, click {L("Show every teacher")} and tick the
GCE teacher (T2 on the form).</li>
<li>{L("Its course fee (EGP)")}: leave it empty (the subject's), or type the school's fee for the GCE if it differs.</li>
<li>Click {L("Add the qualification")}.</li></ol>''',
             see=f'''{L("Added Edexcel 9AA0.")} and, under {L("Qualifications")}, both: <b>Arabic (International A Level) (YAA01)</b> and
<b>Arabic (GCE A Level) (9AA0)</b>, the GCE with its teacher ticked. The family's form then reads "T1 (Edexcel YAA01)" and
"T2 (Edexcel 9AA0)" ([[preview-arabic]]).''', form=SHEET_FORMS['ARABIC-AL'][:1],
             img=['sheet-18-arabic-al-b', 'sheet-18-arabic-al-c', 'sheet-18-arabic-al-d'], tall=True)
step('The sheet, all 25', where=f'{L("Sessions")} → June 2027, {L("Subjects")}.', see=f'''{L("25 subjects")}: 17 under
{L("O.L.")} and 8 under {L("A.S. / A.L.")}, each with its teachers, its entry options, its course fee and the self-study half.
Each row also says {L("Board fee not set")} and {L("Dates not set")}: the next chapters.''', img='sheet-after-25')

# ═══════════════════════════════════════ 9. Fees ═══════════════════════════════════════
typed_rows = [
 ['Cambridge International', '<code>0680</code>', 'Environmental Management', 'not on the June 2026 list'],
 ['Cambridge International', '<code>0457</code>', 'Global Perspectives', 'not on the June 2026 list'],
 ['Cambridge International', '<code>GLOBAL-CIT</code>', 'Global Citizenship', 'not on the list; the code is the school\'s own'],
 ['Cambridge International', '<code>9898 S1</code>, <code>9898 AX</code>', 'French A.S. and A.L.', 'not on the June 2026 list'],
 ['Cambridge International', '<code>9990</code>', 'Psychology A.L.', 'not on the June 2026 list'],
 ['Pearson Edexcel', '<code>WBI11</code> to <code>WBI14</code>', 'Biology A.S./A.L. Units 1 to 4', 'the June 2026 list prices Units 5 and 6 only (the January and November lists price Units 1 to 4)'],
 ['Pearson Edexcel', '<code>4HB1</code>', 'Human Biology', 'on the November 2026 list, not June\'s'],
 ['Pearson Edexcel', '<code>9AA0</code>', 'Arabic GCE A Level', 'on no list the school has'],
 ['OxfordAQA', '<code>ESL-OXFORD</code>, <code>PSY-OXFORD</code>', 'English as a Second Language, Psychology', 'no OxfordAQA list in hand'],
]
chapter('fees', "The boards' fees",
        "This puts each board's own fee beside every row of the sheet, from the boards' lists. A family's price is the course fee you "
        "typed plus this board fee, and a subject with no board fee cannot be reserved, so this comes before the session opens.")
step('The Fees tab', where=f'{L("Sessions")} → June 2027, the tab {L("Fees")}.', do=f'''<p>Click the tab {L("Fees")}. It has one
block per board's sitting the sheet uses: Cambridge International June 2027, OxfordAQA June 2027 and Pearson Edexcel June 2027.
Each row is a code the subjects read ({L("Code")}, {L("Title")}, {L("Used by")}); every row says {L("No fee")} for now.</p>''',
     img='fees-empty')
step('Which list, now and later', do=f'''<p>The boards have not published their June 2027 fees yet. Until they do, the school's
lists are last cycle's (June 2026). This guide pastes those now, marked as <b>not the board's published fees</b>: the rows are then
{L("provisional")}. Families can reserve those subjects but cannot pay for them until you confirm the fees.</p>
<p>When a board publishes its June 2027 list, paste it again into the same block with {L("These are the board's published fees")}
ticked ([[fees-later]]). If the school prefers to take payment before then, at last cycle's fees, that is the setting
{L("Take payment while a board fee is provisional")} under {L("Settings")} → {L("Prices")} — the school's decision; this guide does
not change it.</p>''')
step('Paste the Cambridge list', where=f'the {L("Fees")} tab, the block <b>Cambridge International June 2027</b>.', key='fees-cambridge', do=f'''<ol>
<li>Click {L("Paste the fee list")} on the Cambridge block.</li>
<li>Copy the block below and paste it into the box: one fee per line, a code and an amount, as the box asks.</li>
<li>Click {L("Read the list")}.</li></ol>
{paste(D['fees']['cambridge_paste'])}
<p>These are the June 2026 list's lines for the session's Cambridge subjects, written with the codes the Exam Catalogue holds: the syllabus and its
option code, then the fee. Two differences from the printed list: the A.S. of Computer Science is printed under its old code
<code>9608 SY</code> and is pasted under <code>9618 SY</code>; where the list prints two option codes (<code>BX / CQ</code>,
<code>AX / HX</code>), the line takes the one you added in [[ch:catalogue]]. The one-paper retakes (Paper 41/42, the ICT theory
paper, Arabic Paper 1 and 2) need no line of their own: Cambridge prices the syllabus, and they read its fee.</p>''',
     form=['Cambridge Registration Fees June 2026 (Year 11 & 12): "IGCSE Biology 0970 CX 10,850" · "AS Level 9700/9701/9702 S1/S2 14,100" · "A2 Level BY/CT 11,400" · "A Level AX/HX 18,600" · "AS Computer Science 9608 SY 11,400" · "A2 9618 BY/CT 12,450" · "A Level 9618 AY 16,950"'],
     img='fees-paste-cambridge_typed' if False else 'fees-paste-cambridge-typed')
step('Check, then add', where=f'the window {L("Paste the fee list")}.', do=f'''<ol>
<li>Read the count: {L("19 matched · 0 not recognised")}. A line marked {L("Not recognised")} has a code the Catalogue does not
know as written: compare it with [[ch:catalogue]] and correct it.</li>
<li><b>Untick</b> {L("These are the board's published fees")}: this is last cycle's list.</li>
<li>Click {L("Add these fees")}.</li></ol>''', see=f'the Cambridge rows with their amounts, each {L("provisional")}.', img='fees-paste-cambridge-read')
step('Paste the Edexcel list', where=f'the {L("Fees")} tab, the block <b>Pearson Edexcel June 2027</b>.', do=f'''<p>The same:
{L("Paste the fee list")}, paste, {L("Read the list")} ({L("12 matched · 0 not recognised")}), untick
{L("These are the board's published fees")}, {L("Add these fees")}.</p>
{paste(D['fees']['edexcel_paste'])}
<ul><li>Pearson prices each unit and each paper: <code>WMA11</code> to <code>WST01</code> are the IAL Mathematics units,
<code>WBI15</code> and <code>WBI16</code> Biology's Units 5 and 6.</li>
<li><code>4MA1/1H</code> and <code>4MA1/2H</code> are the list's two IGCSE Mathematics paper rows (4,600 each): the one-paper
retakes read them. <code>4MA1 9,200</code>, the whole subject, is the two added together, since the list prints no row for the
subject itself.</li>
<li><code>YAA01 18,300</code> is the list's two IAL Arabic units added together (<code>WAA01</code> 8,950 + <code>WAA02</code> 9,350).</li></ul>''',
     form=['Edexcel June 2026: "IAL Mathematics P1–P4 WMA11–WMA14 4,800 each; M1, M2, S1 4,450 each" · "IAL Biology Paper 5, Paper 6 WBI15, WBI16 4,450 each" · "IGCSE Mathematics one row per paper 4,600 each" · "IAL Arabic WAA01 / WAA02 8,950 / 9,350"'],
     img='fees-paste-pearson_edexcel-read')
step('The rows no list has', where=f'the {L("Fees")} tab.', key='fees-typed', do=f'''<p>The rows still {L("No fee")} come first in
each block. No list the school has prices them:</p>
{table(['Block', 'Code', 'Subject', 'Why it is not pasted'], typed_rows)}
<ol><li>Type each fee in its {L("Amount")} box, from the board's list or its website.</li>
<li>Leave {L("These are the board's published fees")} (at the foot of the block) unticked, unless it is the board's published June
2027 fee.</li>
<li>Click {L("Save fees")} at the foot of the block. Do it for each block.</li></ol>
<p class="warn"><b>A row you cannot price yet:</b> leave it. It keeps {L("No fee")}; on the sheet its subject says
{L("Board fee not set")}, and families see it with {L("board fee not set yet")} and cannot reserve it until you type the fee.
Everything else works meanwhile.</p>''', img=['fees-cambridge-no-fee', 'fees-cambridge-typed'],
     cap=['The rows without a fee, first in the block.', 'Typed (the amounts in the picture are placeholders), before Save fees.'])
step('Every row priced', where=f'the {L("Fees")} tab.', see=f'''each block with its rows {L("provisional")} and a button
{L("Confirm all")} with their number. The sheet's {L("Board fee")} column now shows each fee with {L("not published yet")}.''',
     img=['fees-cambridge-priced', 'fees-pearson_edexcel-priced', 'fees-oxford-priced'])
step("When a board publishes its June 2027 list", key='fees-later', where=f'the {L("Fees")} tab, the board\'s block.', do=f'''<ol>
<li>Click {L("Paste the fee list")} and paste the board's new list, written as in [[fees-cambridge]] (with the Exam Catalogue's codes).</li>
<li>Leave {L("These are the board's published fees")} <b>ticked</b>.</li>
<li>{L("Read the list")}, {L("Add these fees")}.</li></ol>
<p>Each row becomes {L("confirmed")} at the new amount, and families can pay. For rows typed by hand, type the published amount
in the box and click {L("Confirm all")}. Once a fee is confirmed it changes only by its {L("Change")} and {L("Confirm")}; if
families had already reserved at another price, the block offers {L("Re-price unpaid lines")}.</p>''')

# ═══════════════════════════════════════ 10. Board Services, School Fees ═══════════════════════════════════════
chapter('services', 'Board Services and School Fees',
        "Two screens sit beside the sheet: what a reservation can carry besides the subject (a board's cash-in or certificate split), "
        'and the school\'s yearly fee. The June 2027 forms ask for neither, so this chapter only checks that both are empty.')
step('Board Services', where=f'{L("Board Services")} in the left column.', do=f'''<p>Each board's services ({L("Cash-in (claim the award)")},
{L("Late cash-in")}, {L("Certificate split")}) with, under {L("Dates and fees in a series")}, each one's fee in a sitting.
No June 2027 form offers a service: <b>leave it as it is.</b> If the school later offers one, it is priced here per sitting.</p>''',
     img='board-services')
step('School Fees', where=f'{L("School Fees")} in the left column.', do=f'''<p>It says {L("No fee schedules yet — the registration gate is off.")}
A school-fee row would stop every family from reserving until that fee is paid. The forms ask no school fee: <b>add nothing.</b></p>''',
     img='school-fees')

# ═══════════════════════════════════════ 11. Dates ═══════════════════════════════════════
chapter('dates', "The boards' dates",
        "This sets each board's June 2027 entry deadline: the school's hard stop, past which nothing more is entered, paid or confirmed "
        'for that sitting. A sitting with no dates takes no reservation, so the dates come before the session opens.')
step('The Deadlines line', where=f'{L("Sessions")} → June 2027.', do=f'''<p>Under the session's dates, {L("Deadlines")} has a
button per sitting, each saying {L("Dates not set")}. Click <b>Cambridge International June 2027</b>.</p>''',
     form=["The forms never mention a deadline: the boards' dates come from the boards' key-dates documents."], img='dates-button')
step("Cambridge's dates", where=f'the window {L("The board\'s dates")}.', do=f'''<ol>
<li>{L("Deadline (your clock)")}: Cambridge's entry deadline for June 2027, day and time.</li>
<li>{L("Retakes until (your clock)")}: Cambridge's later date for retakes of its previous sitting.</li>
<li>{L("Reason")}: for example <i>Cambridge key dates for June 2027</i>.</li>
<li>{L("The board's other dates (information)")}: leave it closed; the school rarely needs them.</li>
<li>Click {L("Save the dates")}.</li></ol>''', img='dates-cambridge')
step('Pearson Edexcel and OxfordAQA', where=f'{L("Sessions")} → June 2027.', do=f'''<p>The same for the two other buttons, with
each board's entry deadline. They have no retake date: leave {L("Retakes until (your clock)")} empty.</p>''',
     see=f'''each button now says {L("entries by")} and the date (Cambridge also {L("retakes by")}); the sheet's rows no longer say
{L("Dates not set")}.''', img='dates-set')
step('Board Series', where=f'{L("Board Series")} in the left column.', do=f'''<p>The same dates, sitting by sitting, for the academic
year, with the days left and the next entry deadline at the top. {L("Dates")} on a row opens the same window. Nothing to do here.</p>''',
     img='board-series')

# ═══════════════════════════════════════ 12. Grade 10 ═══════════════════════════════════════
chapter('grade10', 'Grade 10',
        'The session has a tab for the grade-10 core, the subjects every grade-10 student sits in June. No June 2027 form lists a grade-10 '
        'class, so the session leaves it empty.')
step('The Grade 10 tab', where=f'{L("Sessions")} → June 2027, the tab {L("Grade 10")}.', do=f'''<p>{L("The core")} lists the O.L.
subjects with a box each. The forms' classes run from 11A to 12D: no June 2027 form registers grade 10, so <b>leave every box
empty.</b> If the school decides to register its grade 10 for June 2027, the boxes ticked here become the subjects every grade-10
student must reserve; agree that with the coordinator first.</p>''', form=['"Grade Level & Class": 11A … 11E, 12A … 12D — no grade-10 class on any form'],
     img='grade-10')

# ═══════════════════════════════════════ 13. Preview ═══════════════════════════════════════
chapter('preview', "Check the family's form",
        'Before families see the session, look at each subject the way a family will, and hold it beside the school\'s form. A difference '
        "is fixed on the subject's form ([[ch:sheet]]); look again after.")
step("Preview the family's form", where=f'{L("Sessions")} → June 2027, {L("Subjects")}.', do=f'''<p>Under each subject's name on the
sheet, click {L("Preview the family's form")}. The window {L("The family's form")} shows the subject as a family sees it on its
Reserve page, every choice open, with its price. Nothing is reserved from it; close it with {L("Close")}.</p>
<p>The prices are the course fee plus the board fee; ⓟ marks a price whose board fee is provisional. The ones in the pictures come
from the placeholders.</p>''', img='preview-link')
step('Biology', where=f'{L("The family\'s form")}, Biology.', do=f'''<p>Beside the form: the teacher choice ({L("No preference")} or a
teacher), the entries {L("First entry, in school")}, {L("Retake, in school — name the sitting")} and
{L("Retake, self-study — name the sitting")} for all papers; then {L("Paper 41/42 only (retake)")}, self study only, with
{L("Carried from the sitting…")}; at the foot, the refund policy and the declaration.</p>''',
     form=['Biology O.L.: Teacher T1, T2, T3, "Self Study 50% (Second entry ONLY)"', '"Retake Self Study 50% fees (All Papers)" Yes / No',
           '"Retake Self Study 50% fees (Paper 41/42 ONLY)": From June 2026 / From November 2026 / None',
           '"I confirm that I read the refund policy" · "I confirm that the information given in this form is true, complete and accurate."'],
     img='preview-biology')
step('Arabic A.L.', key='preview-arabic', where=f'{L("The family\'s form")}, Arabic A.L.', do='''<p>Two lines, one per qualification,
each with its own teacher: the family chooses the qualification by choosing the teacher, as on the form.</p>''',
     form=['Teacher: T1 "(Edexcel YAA01)", T2 "(Edexcel 9AA01)"'], img='preview-arabic-al')
step('Computer Science A.S./A.L.', where=f'{L("The family\'s form")}, Computer Science A.S./A.L.', do=f'''<p>{L("A.S.")},
{L("A.2. (Carry forward)")} with {L("Carried from the sitting…")} (June or November, the form's two A.2. options), and
{L("A.L.")}, each by the external team.</p>''', form=['Components: "Computer Science A.S. · A.2. (Carry forward on June) · A.2. (Carry forward on November) · A.L."'],
     img='preview-cs-asal')
step('Mathematics A.S./A.L.', where=f'{L("The family\'s form")}, Mathematics A.S./A.L.', do='''<p>One line per unit, each with its
teacher: P1 and P2 "(online)", M1 and S1 with a choice of two teachers, every unit also as a self-study retake.</p>''',
     form=['"P1: T1 (ONLINE ONLY) / Self Study 50% School fees (2nd entry ONLY)" · "P2: the same" · "P3: T1 / SS" · "P4: T1 / SS" · "M1: T2 / T1 / SS" · "S1: T2 / T1 / SS"'],
     img='preview-ial-maths')
step('Physics A.S./A.L.', where=f'{L("The family\'s form")}, Physics A.S./A.L.', do=f'''<p>{L("A.S.")} taught by the teacher;
{L("A.2. (Carry forward)")} in self study only, with the sitting the A.S. result comes from.</p>''',
     form=['"Physics A.S. in School 100% fees (T1)" · "Physics A.2. (Self Study 50% fees in June 2027)" · "A.2. Self Study 50% (Carry forward on June 2026)" · "A.2. Self Study 50% (Carry forward on November 2025)"'],
     img='preview-physics-asal')

# ═══════════════════════════════════════ 14. Open ═══════════════════════════════════════
chapter('open', 'Open the session',
        "This opens June 2027 to families and turns on the reminders that follow up their payments. Do it once the sheet, the fees and the "
        'dates are as you want them.')
step('Home, before opening', where=f'{L("Home")} in the left column.', do=f'''<p>Home now shows June 2027 {L("Draft")}:
{L("Being prepared: not open to families yet.")} with the reserving dates, {L("What the sheet still needs")} and the boards'
deadlines under {L("ENTRIES TO THE BOARD")}.</p>
<p>The line {L("board fees not published yet")} counts the provisional fees of [[ch:fees]]: it stays until the boards publish and you confirm
them. Anything else listed there (a subject with no teacher, a fee or a date not set) is worth doing before you open.</p>''',
     img='home-before-opening')
step('Open now', key='open-now', where=f'{L("Sessions")} → June 2027.', do=f'''<p>The session opens on its own on its
{L("Reserve from")} day. To open it now instead:</p>
<ol><li>Click {L("Open now")} at the top of the Session screen.</li>
<li>The window {L("Open this session now")} says what it does. Click its {L("Open now")}.</li></ol>''',
     img=['open-now-button', 'open-now-dialog'])
step('Open', where=f'{L("Sessions")} → June 2027.', see=f'''{L("Open")} beside the name; the buttons are now {L("Edit")},
{L("Close")} and {L("Correct the sitting")}. Families can reserve from this moment.''', img='session-open')
step('Turn the reminders on', where=f'{L("Settings")}, the group {L("Reminders")}.', do=f'''<p>The reminders (payment due, reservations
closing, the boards' deadlines) are off until you turn them on.</p>
<ol><li>{L("Send reminders automatically")} → {L("Change")}.</li>
<li>{L("New value")}: {L("On")}.</li>
<li>{L("Reason")}: for example <i>June 2027 is open: its sheet and fees are checked</i>.</li>
<li>{L("Save change")}.</li></ol>''', see=f'the card says {L("On")}. {L("Hour the day\'s reminders go out")} (Cairo time) is under it.',
     img=['reminders-on', 'reminders-saved'])

# ═══════════════════════════════════════ 15. Next ═══════════════════════════════════════
chapter('next', 'What happens next',
        'The session is built and open. What follows is the families\' part and the school\'s daily work, which this guide does not cover.')
step('The session is running', where=f'{L("Home")}.', do=f'''<p>Families reserve from the same address: a parent or a student signs
up, they link to each other, and they reserve on their Reserve page the choices you just previewed. At the desk, the finance officer
reserves for a family that walks in and takes the payment. Home now adds {L("What families are doing")}.</p>
<p>The desk, the Finance Workbench, the follow-up of unpaid families and the reminders are shown step by step in the full walkthrough
of the system, which the owner has: ask the owner for it. Two things in this guide come back later: when a board publishes its June 2027
fees ([[fees-later]]) and if a board's date changes ([[ch:dates]]).</p>''', img='home-open')
