
# ═══════════════════════════════════════════ THE PAGE ═══════════════════════════════════════════
FINDINGS = [
    ('The seed', "On a fresh database the seed's 17 sample subjects carry older Cambridge syllabus codes (0610 Biology …) and are not mapped (the catalogue's backfill ran before them), and its two sessions are of 2026: June 2026 closes at the scheduler's first tick; November 2026 – January 2027 stays a draft whose reserving ended on 1 Oct 2026. Home leads with that draft (\"Being prepared … from 1 Jul 2026 to 1 Oct 2026\", \"Add the subjects\") and no screen removes a draft session."),
    ('Adding a subject', "The forms' subjects the database lacks are added only on Subjects (/admin/subjects), which the decisions of 16 Oct hid from the sidebar: the Catalogue maps subjects but cannot add one. Its form and its CSV still ask the old Registration Fee and Core columns that the session's fees and grade-10 core replaced."),
    ('Retiring samples', "Deactivating a sample marked core is refused until \"Remove core designation\" is clicked; deactivated subjects still count in the Catalogue's \"N subjects are not mapped yet\" (16 after this walkthrough)."),
    ('Arabic A.L.', "The second qualification under one subject (GCE 9AA0 beside IAL YAA01, \"the teacher choice chooses the qualification\") has no screen: only the item endpoint makes it (decision 4). The demo script adds it; the form then shows and edits both."),
    ('One paper only', "A one-paper retake is priced with the syllabus's whole board fee (Q-13): Cambridge Paper 41/42 with 10,850; Edexcel Mathematics 1H alone with 9,200 where the list prices a paper at 4,600. The fee list must name the syllabus twice (\"0970 CX\" for All papers, \"0970\" for the paper)."),
    ('Form options with no shape of their own', "Computer Science O.L.'s \"Paper 41/42\" (left from last year's form: 0984 has no Paper 4) is not offered; Physics A.S./A.L.'s three A.2. choices are one route with the sitting named by the family; the forms' separate \"Self Study (ONLY 2nd entry)\" Yes/No question is the entry choice \"Retake, self-study\"."),
    ('Fee lists and codes', "The lists in hand are June 2026's (June 2027's were not published); the rows no list has are typed as placeholders, not published. Oxford's and Global Citizenship's codes are the school's, not the boards'; Environmental Management, Global Perspectives and Global Citizenship have no option code, so their entries would be flagged."),
    ('Home after an InstaPay reference', "The family's Home keeps counting the lines whose transfer awaits verification (EGP 60,900) and its Pay now opens the checkout of all three, which stops at \"Payment already started\": the other board's line is paid from My Registrations (tick, Pay Selected)."),
    ('The desk and a transfer in progress', "The desk's \"To collect now\" lists and ticks lines whose InstaPay transfer is waiting for finance, and \"Owes now\" counts them; Collect is then refused (\"These subjects already have a transfer in progress — confirm it or reject it in the Finance Workbench first\")."),
    ("Codes on families' screens", "The statement's payments read \"(cash)\", \"(instapay)\"; notifications \"Payment of EGP 21200.00 via in_school\" and \"Escrow balance credited … New balance: EGP 16850.00\"; Pending Requests \"16850.00 EGP\"; the workbench's dialog \"39700.00 EGP\". In Arabic the statement's receipt states (\"With Parent\", \"Returned to School\") stay English."),
    ("The school's name", "The reservation slip and the receipt print \"IGCSE Subject Reservation System\", not the school's name (decision 15 covers the sign-in pages)."),
    ('Words on staff screens', "Settings' refund policy card names an internal file, \"(SCHOOL_FORMS.md §2.1)\"; the exception's sentence shows \"by 2026-12-20\" and \"1 due dates moved.\"; My Registrations' Request Drop and Drop dialogs have no dialog role."),
    ('The seed\'s draft elsewhere', "The seed's stale November 2026 – January 2027 draft also shows on a student's record as an \"exam series open now\" (\"Being prepared · May register\")."),
    ('Profile', "The admin's Profile offers \"Linked Parents — View and manage parent connections\", a student's link."),
    ('Documents', "README.md says uploads fail without R2 keys, but in development they go to LOCAL_UPLOAD_DIR; .env.example still lists AUTO_GRADE_PROGRESSION (removed by F0a) and lacks LOCAL_UPLOAD_DIR."),
]

ACCOUNTS = [('Admin', 'admin@igcse.local', 'AdminPass1'), ('Coordinator', 'coordinator@igcse.local', 'TestPass1'), ('Finance officer', 'finance@igcse.local', 'TestPass1'),
            ('Teacher 1 … 33', 'teacher1@igcse.local …', 'TestPass1'), ('Parent One / Student One (Parts 3, 4)', 'parent1@ / student1@igcse.local', 'TestPass1'),
            ('Parent Two / Student Two (the desk)', 'parent2@ / student2@igcse.local', 'TestPass1')]

def build():
    # Number the steps and resolve [[key]] references.
    keys, n_steps, n_imgs = {}, 0, 0
    for p_i, p in enumerate(PARTS, 1):
        k = 0
        for g in p['groups']:
            for s in g['steps']:
                k += 1
                s['num'] = f'{p_i}.{k}'
                s['anchor'] = f's{p_i}-{k}'
                if s.get('key'):
                    keys[s['key']] = s
    def refs(text):
        def sub(m):
            s = keys.get(m.group(1))
            if not s:
                sys.exit(f'unknown step key {m.group(1)}')
            return f'<a href="#{s["anchor"]}">{s["num"]}</a>'
        return re.sub(r'\[\[([a-z0-9-]+)\]\]', sub, text)
    img_dir = os.path.join(OUT, 'img')
    if os.path.isdir(img_dir):
        shutil.rmtree(img_dir)
    os.makedirs(img_dir)
    nav, body = [], []
    for p in PARTS:
        nav.append(f'<h2><a href="#{p["id"]}">{html.escape(p["title"].split(" — ")[0])}</a></h2><ol>')
        body.append(f'<section class="part" id="{p["id"]}"><h2>{html.escape(p["title"])}</h2><p>{p["intro"]}</p>')
        for g in p['groups']:
            nav.append(f'<h3>{html.escape(g["title"])}</h3>')
            body.append(f'<h3 class="group">{html.escape(g["title"])}</h3>')
            for s in g['steps']:
                n_steps += 1
                nav.append(f'<li><a href="#{s["anchor"]}"><span>{s["num"]}</span>{html.escape(s["title"])}</a></li>')
                form = ''
                if s['form']:
                    form = '<aside class="form"><div class="t">The school\'s form says</div>' + ''.join(f'<p>{html.escape(x)}</p>' for x in s['form']) + '</aside>'
                cols = 'cols' if form else 'cols single'
                fig = ''
                if s['img']:
                    src = os.path.join(SHOTS, s['img'] + '.jpg')
                    if not os.path.exists(src):
                        sys.exit(f'missing shot {src}')
                    slug = re.sub(r'^p[1-4]-(s?\d+[a-z]?-)?', '', s['img'])
                    name = f'{s["num"].replace(".", "-")}-{slug}.jpg'
                    shutil.copyfile(src, os.path.join(img_dir, name))
                    n_imgs += 1
                    alt = f'{s["num"]} {s["title"]}'
                    cls = ' class="tall"' if s['tall'] else ''
                    cap = f'<figcaption>{s["cap"]}</figcaption>' if s['cap'] else ''
                    fig = f'<figure><img{cls} loading="lazy" src="img/{name}" alt="{html.escape(alt)}">{cap}</figure>'
                body.append(f'<section class="step" id="{s["anchor"]}"><h4><span class="n">{s["num"]}</span>{html.escape(s["title"])}</h4>'
                            f'<div class="{cols}"><div class="do">{refs(s["do"])}</div>{form}</div>{fig}</section>')
        nav.append('</ol>')
        body.append('</section>')
    nav.append('<h2><a href="#findings">What the screens could not do</a></h2><h2><a href="#demo">Rebuilding the demo</a></h2>')
    acc = ''.join(f'<tr><td>{a}</td><td><code>{e}</code></td><td><code>{pw}</code></td></tr>' for a, e, pw in ACCOUNTS)
    findings = ''.join(f'<div class="finding"><b>{html.escape(t)}{"" if t.endswith(".") else "."}</b> {html.escape(d)}</div>' for t, d in FINDINGS)
    page = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>The June 2027 cycle, from a clean clone to the families — a walkthrough</title>
<style>{CSS}</style></head>
<body>
<nav aria-label="Steps"><p class="brand">The June 2027 cycle</p><p class="sub">A walkthrough of the reservation system, step by step</p>{''.join(nav)}</nav>
<main>
<header class="top">
<h1>The June 2027 cycle, from a clean clone to the families</h1>
<p>The school registered each cycle with a links sheet and one Google Form per subject — 25 for June 2027 — and took the money at the desk with no price on any form. This page builds that same cycle in the system and runs it: <b>Part 1</b> installs the system from a clean clone; <b>Part 2</b> is the admin, rebuilding the June 2027 cycle exactly as the forms describe it and running it — the desk, the money, the follow-up, the entries to the board; <b>Part 3</b> is a student and <b>Part 4</b> a parent, doing what the forms asked of them.</p>
<p>Every step names the label to click as the screen writes it (<span class="lbl">like this</span>); beside it, in yellow, the school's own form says the same thing in its words; under it, the screen at that step. Every step was done in this order on a running system, and every screenshot was taken at its step (16 Oct 2026, the code of <code>feature/walkthrough-cycle</code> at the merge of main 9a38c3d). Names are placeholders; no school data, no phone number, no real person.</p>
<table class="t"><tr><th>Demo account</th><th>Email</th><th>Password (local demo only)</th></tr>{acc}</table>
<p class="note">To look at the cycle without driving Part 2 by hand, run the demo script after Part 1 (<a href="#demo">Rebuilding the demo</a>): it makes Part 2's set-up through the API, and the desk and the families can then be followed from step <a href="#{keys['desk-start']['anchor']}">{keys['desk-start']['num']}</a> on.</p>
</header>
{''.join(body)}
<section class="part" id="findings"><h2>What the screens could not do as the forms describe it</h2>
<p>Found while building and driving this walkthrough; each is recorded in <code>docs/features/WALKTHROUGH.md</code>.</p>{findings}</section>
<section class="part" id="demo"><h2>Rebuilding the demo</h2>
<p><code>docs/walkthrough/demo/build-june-2027.mjs</code> rebuilds Part 2's set-up through the API — the school's name, the team, the catalogue, the June 2027 session and its 25 subjects in the forms' words, the fees, the dates, the session opened and the reminders on — from a database Part 1 has set up (migrated, the first admin promoted by the seed). Placeholders only; a second run changes nothing. Proven on a second database: what it makes is, line for line, what the screens of Part 2 made.</p>
<pre>node docs/walkthrough/demo/build-june-2027.mjs                       <span class="c"># API on :3001, web on :3000</span>
API=http://localhost:3191 ORIGIN=http://localhost:3190 node docs/walkthrough/demo/build-june-2027.mjs</pre>
<p>The data both share is <code>docs/walkthrough/demo/cycle-data.mjs</code>. The placeholder sheet of step <a href="#{keys['import-start']['anchor']}">{keys['import-start']['num']}</a> is <code>docs/walkthrough/demo/june-2027-placeholder-sheet.xlsx</code> (made by <code>make-placeholder-sheet.mts</code> in the same folder).</p>
</section>
</main></body></html>'''
    with open(os.path.join(OUT, 'index.html'), 'w') as f:
        f.write(page)
    print(f'{n_steps} steps, {n_imgs} images')
    for p in PARTS:
        ns = sum(len(g['steps']) for g in p['groups'])
        ni = sum(1 for g in p['groups'] for s in g['steps'] if s['img'])
        print(f'  {p["title"].split(" — ")[0]}: {ns} steps, {ni} screenshots')

build()
