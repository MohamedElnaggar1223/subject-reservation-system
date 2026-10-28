#!/usr/bin/env python3
"""Write docs/admin-guide/index.html and docs/admin-guide/img/ from the steps (steps.py) and the drive's screenshots
(SHOTS, default /tmp/ag/shots).

Forked from the F8 walkthrough's generator (.audit/walkthrough-cycle-evidence/drive/gen*.py). The guide is in parts;
each part's steps are numbered with its letter (A1, A2…). A part marked counted is scored by its number of steps
(COORDINATOR_REWORK.md §13, P4): the counts are worked out here and written into the page. Each step: a title, who
does it when it is not the coordinator (the admin), where she is, what to click or type (the screen's labels marked),
what she sees, the school's form wording beside it where there is one, and the screenshot(s) taken at that step. A
screenshot missing from SHOTS is taken from the img/ folder already there (so the words can be regenerated without
the drive)."""
import glob, html, json, os, re, shutil, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
SHOTS = os.environ.get('SHOTS', '/tmp/ag/shots')
CSS = open(os.path.join(HERE, 'style.css')).read()

def L(s):
    """A label exactly as the screen writes it."""
    return f'<span class="lbl">{html.escape(s)}</span>'

def esc(s):
    return html.escape(str(s))

CHAPTERS = []

def chapter(cid, title, intro, prefix, counted=False, limit=None, body=''):
    """A part of the guide: its steps are numbered prefix + n; a counted part is scored by its steps (at most limit)."""
    CHAPTERS.append({'id': cid, 'title': title, 'intro': intro, 'prefix': prefix, 'counted': counted, 'limit': limit,
                     'body': body, 'steps': []})

def step(title, where='', do='', see='', form=None, img=None, cap=None, tall=False, key=None, after='', who=None):
    imgs = [] if img is None else (img if isinstance(img, list) else [img])
    CHAPTERS[-1]['steps'].append({'title': title, 'where': where, 'do': do, 'see': see, 'form': form, 'imgs': imgs,
                                  'cap': cap, 'tall': tall, 'key': key, 'after': after, 'who': who})

def table(head, rows, num_cols=()):
    th = ''.join(f'<th>{h}</th>' for h in head)
    body = ''.join('<tr>' + ''.join(f'<td{" class=num" if i in num_cols else ""}>{c}</td>' for i, c in enumerate(r)) + '</tr>' for r in rows)
    return f'<table class="t"><tr>{th}</tr>{body}</table>'

NS = {**globals()}
exec(open(os.path.join(HERE, 'steps.py')).read(), NS)
HEADER, TITLE, BRAND, SUB = NS['HEADER'], NS['TITLE'], NS['BRAND'], NS['SUB']

def build():
    keys, n_steps = {}, 0
    counts = {}
    for c_i, c in enumerate(CHAPTERS, 1):
        c['num'] = c_i
        counts[c['prefix']] = len(c['steps'])
        if c['counted'] and c['limit'] is not None and len(c['steps']) > c['limit']:
            sys.exit(f'part {c["prefix"]} has {len(c["steps"])} steps, over its {c["limit"]}')
        for k, s in enumerate(c['steps'], 1):
            s['num'] = f'{c["prefix"]}{k}'
            s['anchor'] = f's-{c["prefix"].lower().strip(".")}{k}'
            if s['key']:
                if s['key'] in keys:
                    sys.exit(f'step key used twice: {s["key"]}')
                keys[s['key']] = s
    def refs(text):
        def sub(m):
            cap, k = m.group(1) == '^', m.group(2)
            if k.startswith('ch:'):
                c = next((c for c in CHAPTERS if c['id'] == k[3:]), None)
                if not c:
                    sys.exit(f'unknown chapter {k}')
                return f'<a href="#{c["id"]}">{esc(c["title"])}</a>'
            if k.startswith('count:'):
                p = k[6:].upper()
                if p not in counts:
                    sys.exit(f'unknown part {k}')
                return str(counts[p])
            s = keys.get(k)
            if not s:
                sys.exit(f'unknown step key {k}')
            return f'<a href="#{s["anchor"]}">{"Step" if cap else "step"} {s["num"]}</a>'
        return re.sub(r'\[\[(\^?)([a-zA-Z0-9:-]+)\]\]', sub, text)

    # Images: each named by its step and the drive's shot name; a shot missing from SHOTS is kept from img/.
    img_dir = os.path.join(OUT, 'img')
    stage = tempfile.mkdtemp(prefix='admin-guide-img-')
    used, n_imgs, from_old = set(), 0, 0
    for c in CHAPTERS:
        for s in c['steps']:
            s['files'] = []
            for shot in s['imgs']:
                m = re.match(r'([A-Z0-9.]*?)\.?(\d+)$', s['num'])
                name = f'{m.group(1).strip(".") or "0"}{int(m.group(2)):02d}-{shot}.jpg'
                src = os.path.join(SHOTS, shot + '.jpg')
                if not os.path.exists(src):
                    old = glob.glob(os.path.join(img_dir, f'*-{shot}.jpg'))
                    if not old:
                        sys.exit(f'missing shot {shot} (not in {SHOTS}, not in img/)')
                    src = old[0]
                    from_old += 1
                if os.path.getsize(src) > 150 * 1024:
                    sys.exit(f'shot over 150 KB: {src}')
                if name in used:
                    sys.exit(f'image used twice in one step: {name}')
                used.add(name)
                shutil.copyfile(src, os.path.join(stage, name))
                s['files'].append(name)
                n_imgs += 1
    if os.path.isdir(img_dir):
        shutil.rmtree(img_dir)
    shutil.copytree(stage, img_dir)
    shutil.rmtree(stage)

    def tally(c):
        """A part's heading tail: its step count, and whether it is scored or for reference."""
        if c['counted']:
            return f'{len(c["steps"])} steps (at most {c["limit"]})'
        return f'{len(c["steps"])} steps, not counted' if c['steps'] else ''

    nav, body = [], []
    for c in CHAPTERS:
        t = tally(c)
        nav.append(f'<h2><a href="#{c["id"]}">{esc(c["title"])}</a>{f" <span>{t}</span>" if t else ""}</h2><ol>')
        head = f'<h2>{esc(c["title"])}{f" <span class=tally>{t}</span>" if t else ""}</h2>'
        body.append(f'<section class="chapter{" counted" if c["counted"] else ""}" id="{c["id"]}" data-part="{c["prefix"]}" data-steps="{len(c["steps"])}">'
                    f'{head}<p class="intro">{refs(c["intro"])}</p>{refs(c["body"])}')
        for s in c['steps']:
            n_steps += 1
            badge = f'<span class="who">{esc(s["who"])}</span>' if s['who'] else ''
            nav.append(f'<li><a href="#{s["anchor"]}"><span>{s["num"]}</span>{esc(s["title"])}{" (" + esc(s["who"]) + ")" if s["who"] else ""}</a></li>')
            form = ''
            if s['form']:
                form = '<aside class="form"><div class="t">Your form says</div>' + ''.join(f'<p>{esc(x)}</p>' for x in s['form']) + '</aside>'
            where = f'<p class="where"><b>Where you are:</b> {refs(s["where"])}</p>' if s['where'] else ''
            see = f'<p class="see"><b>You see:</b> {refs(s["see"])}</p>' if s['see'] else ''
            figs = ''
            for i, name in enumerate(s['files']):
                cls = ' class="tall"' if s['tall'] else ''
                cap = s['cap'][i] if isinstance(s['cap'], list) else (s['cap'] if i == len(s['files']) - 1 else None)
                capt = f'<figcaption>{refs(cap)}</figcaption>' if cap else ''
                figs += f'<figure><img{cls} loading="lazy" src="img/{name}" alt="Step {s["num"]}: {esc(s["title"])}">{capt}</figure>'
            cols = 'cols' if form else 'cols single'
            body.append(f'<section class="step{" admin" if s["who"] else ""}" id="{s["anchor"]}"><h3><span class="n">{s["num"]}</span>{badge}{esc(s["title"])}</h3>'
                        f'<div class="{cols}"><div class="do">{where}{refs(s["do"])}{see}</div>{form}</div>{refs(s["after"])}{figs}</section>')
        nav.append('</ol>')
        body.append('</section>')
    toc = ''.join(f'<li><a href="#{c["id"]}">{esc(c["title"])}</a>{f" — {tally(c)}" if tally(c) else ""}</li>' for c in CHAPTERS)
    page = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(TITLE)}</title>
<style>{CSS}</style>
</head>
<body>
<nav aria-label="Parts and steps"><p class="brand">{esc(BRAND)}</p><p class="sub">{esc(SUB)}</p>{''.join(nav)}</nav>
<main>
<header class="top">
<h1>{esc(TITLE)}</h1>
{refs(HEADER)}
<ol class="toc">{toc}</ol>
</header>
{''.join(body)}
</main></body></html>'''
    with open(os.path.join(OUT, 'index.html'), 'w') as f:
        f.write(page)
    print(f'{len(CHAPTERS)} parts, {n_steps} steps, {n_imgs} images ({from_old} kept from img/), index.html {len(page) // 1024} KB')
    for c in CHAPTERS:
        print(f'  {c["prefix"]:>3} {c["title"]}: {len(c["steps"])} steps{" (counted, at most " + str(c["limit"]) + ")" if c["counted"] else ""}, {sum(len(s["files"]) for s in c["steps"])} images')

build()
