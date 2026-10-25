#!/usr/bin/env python3
"""Write docs/admin-guide/index.html and docs/admin-guide/img/ from the steps (steps.py), the session's data
(guide-data.json) and the drive's screenshots (SHOTS, default /tmp/ag/shots).

Forked from the F8 walkthrough's generator (.audit/walkthrough-cycle-evidence/drive/gen*.py). Each step: a number
(given in order), a title, where the admin is, what to click or type (the screen's labels marked), what she sees, the
school's form wording beside it where there is one, and the screenshot(s) taken at that step. A screenshot missing
from SHOTS is taken from the img/ folder already there (so the words can be regenerated without the drive)."""
import glob, html, json, os, re, shutil, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
SHOTS = os.environ.get('SHOTS', '/tmp/ag/shots')
D = json.load(open(os.path.join(HERE, 'guide-data.json')))
CSS = open(os.path.join(HERE, 'style.css')).read()

def L(s):
    """A label exactly as the screen writes it."""
    return f'<span class="lbl">{html.escape(s)}</span>'

def esc(s):
    return html.escape(str(s))

CHAPTERS = []

def chapter(cid, title, intro):
    CHAPTERS.append({'id': cid, 'title': title, 'intro': intro, 'steps': []})

def step(title, where='', do='', see='', form=None, img=None, cap=None, tall=False, key=None, after=''):
    imgs = [] if img is None else (img if isinstance(img, list) else [img])
    CHAPTERS[-1]['steps'].append({'title': title, 'where': where, 'do': do, 'see': see, 'form': form, 'imgs': imgs,
                                  'cap': cap, 'tall': tall, 'key': key, 'after': after})

def paste(lines):
    """A block to copy and paste, with a Copy button (works offline; hidden in print)."""
    text = '\n'.join(lines)
    return f'<div class="paste"><button type="button" onclick="copyBlock(this)">Copy</button><pre>{esc(text)}</pre></div>'

def table(head, rows, num_cols=()):
    th = ''.join(f'<th>{h}</th>' for h in head)
    body = ''.join('<tr>' + ''.join(f'<td{" class=num" if i in num_cols else ""}>{c}</td>' for i, c in enumerate(r)) + '</tr>' for r in rows)
    return f'<table class="t"><tr>{th}</tr>{body}</table>'

NS = {**globals()}
exec(open(os.path.join(HERE, 'steps.py')).read(), NS)
HEADER = NS['HEADER']

def build():
    keys, n_steps = {}, 0
    for c_i, c in enumerate(CHAPTERS, 1):
        c['num'] = c_i
        for k, s in enumerate(c['steps'], 1):
            s['num'] = f'{c_i}.{k}'
            s['anchor'] = f's{c_i}-{k}'
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
                return f'<a href="#{c["id"]}">{"Chapter" if cap else "chapter"} {c["num"]}</a>'
            s = keys.get(k)
            if not s:
                sys.exit(f'unknown step key {k}')
            return f'<a href="#{s["anchor"]}">{"Step" if cap else "step"} {s["num"]}</a>'
        return re.sub(r'\[\[(\^?)([a-z0-9:-]+)\]\]', sub, text)

    # Images: each named by its step and the drive's shot name; a shot missing from SHOTS is kept from img/.
    img_dir = os.path.join(OUT, 'img')
    stage = tempfile.mkdtemp(prefix='admin-guide-img-')
    used, n_imgs, from_old = set(), 0, 0
    for c in CHAPTERS:
        for s in c['steps']:
            s['files'] = []
            for shot in s['imgs']:
                name = f'{s["num"].split(".")[0]}-{int(s["num"].split(".")[1]):02d}-{shot}.jpg'
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

    nav, body = [], []
    for c in CHAPTERS:
        nav.append(f'<h2><a href="#{c["id"]}">{c["num"]}. {esc(c["title"])}</a></h2><ol>')
        body.append(f'<section class="chapter" id="{c["id"]}"><h2>{c["num"]}. {esc(c["title"])}</h2><p class="intro">{refs(c["intro"])}</p>')
        for s in c['steps']:
            n_steps += 1
            nav.append(f'<li><a href="#{s["anchor"]}"><span>{s["num"]}</span>{esc(s["title"])}</a></li>')
            form = ''
            if s['form']:
                form = '<aside class="form"><div class="t">The school\'s form says</div>' + ''.join(f'<p>{esc(x)}</p>' for x in s['form']) + '</aside>'
            where = f'<p class="where"><b>Where you are:</b> {refs(s["where"])}</p>' if s['where'] else ''
            see = f'<p class="see"><b>You see:</b> {refs(s["see"])}</p>' if s['see'] else ''
            figs = ''
            for i, name in enumerate(s['files']):
                cls = ' class="tall"' if s['tall'] else ''
                cap = s['cap'][i] if isinstance(s['cap'], list) else (s['cap'] if i == len(s['files']) - 1 else None)
                capt = f'<figcaption>{refs(cap)}</figcaption>' if cap else ''
                figs += f'<figure><img{cls} loading="lazy" src="img/{name}" alt="Step {s["num"]}: {esc(s["title"])}">{capt}</figure>'
            cols = 'cols' if form else 'cols single'
            body.append(f'<section class="step" id="{s["anchor"]}"><h3><span class="n">{s["num"]}</span>{esc(s["title"])}</h3>'
                        f'<div class="{cols}"><div class="do">{where}{refs(s["do"])}{see}</div>{form}</div>{refs(s["after"])}{figs}</section>')
        nav.append('</ol>')
        body.append('</section>')
    toc = ''.join(f'<li><a href="#{c["id"]}">{c["num"]}. {esc(c["title"])}</a></li>' for c in CHAPTERS)
    page = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Building the June 2027 session — the admin's guide</title>
<style>{CSS}</style>
<script>
// Copy a block for pasting. The plain copy first: it works offline, from the file, in every browser; the newer
// clipboard call only if it fails. If both fail, the block is left selected for Ctrl+C.
function copyBlock(b){{var pre=b.nextElementSibling,t=pre.textContent,done=false;var a=document.createElement('textarea');a.value=t;a.setAttribute('readonly','');a.style.position='fixed';a.style.top='-1000px';document.body.appendChild(a);a.select();try{{done=document.execCommand('copy');}}catch(e){{done=false;}}document.body.removeChild(a);
function ok(){{b.textContent='Copied';b.className='done';setTimeout(function(){{b.textContent='Copy';b.className='';}},2000);}}
function sel(){{var r=document.createRange();r.selectNodeContents(pre);var s=window.getSelection();s.removeAllRanges();s.addRange(r);b.textContent='Press Ctrl+C';}}
if(done){{ok();return;}}if(navigator.clipboard){{navigator.clipboard.writeText(t).then(ok,sel);}}else{{sel();}}}}
</script></head>
<body>
<nav aria-label="Chapters and steps"><p class="brand">Building the June 2027 session</p><p class="sub">The admin's guide, step by step</p>{''.join(nav)}</nav>
<main>
<header class="top">
<h1>Building the June 2027 session on the system</h1>
{refs(HEADER)}
<ol class="toc">{toc}</ol>
</header>
{''.join(body)}
</main></body></html>'''
    with open(os.path.join(OUT, 'index.html'), 'w') as f:
        f.write(page)
    print(f'{len(CHAPTERS)} chapters, {n_steps} steps, {n_imgs} images ({from_old} kept from img/), index.html {len(page) // 1024} KB')
    for c in CHAPTERS:
        print(f'  {c["num"]:>2}. {c["title"]}: {len(c["steps"])} steps, {sum(len(s["files"]) for s in c["steps"])} images')

build()
