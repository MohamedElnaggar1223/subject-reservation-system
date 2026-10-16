import os, re
src = open('/tmp/f8/gen_all.py').read()
used = set(re.findall(r"img='([^']+)'", src))
used |= set('p2-' + x for x in re.findall(r"\('(s\d+b?-[a-z0-9-]+)'", src))
shots = {f[:-4] for f in os.listdir('/tmp/f8-pw/shots')}
print('unused:', sorted(shots - used))
total = sum(os.path.getsize(os.path.join('/tmp/f8/repo/docs/walkthrough/img', f)) for f in os.listdir('/tmp/f8/repo/docs/walkthrough/img'))
big = [f for f in os.listdir('/tmp/f8/repo/docs/walkthrough/img') if os.path.getsize(os.path.join('/tmp/f8/repo/docs/walkthrough/img', f)) > 150 * 1024]
print('img total KB', total // 1024, 'files', len(os.listdir('/tmp/f8/repo/docs/walkthrough/img')), 'over 150 KB', big)
print('index.html KB', os.path.getsize('/tmp/f8/repo/docs/walkthrough/index.html') // 1024)
