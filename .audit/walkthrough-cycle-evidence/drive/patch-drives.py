"""Patch the drives for the final run: readable viewport shots in place of three tall ones, the student's
request with a teacher choice and a declared one-paper retake, the exception on that line, every declared
sitting verified."""
import re
D = '/tmp/f8-pw/'

def edit(name, old, new, count=1):
    p = D + name
    s = open(p).read()
    assert s.count(old) >= 1, (name, old[:60])
    s = s.replace(old, new, count)
    open(p, 'w').write(s)

# p4b: three viewport shots instead of one tall shot.
edit('p4b-reserve.mjs', "await tallShot(page, 'p4-07-reserve-three-subjects', mainBox(page), { fullWidth: true, quality: 64 });",
     """await toTop(page, row('Biology: All papers'), 140);
await shot(page, 'p4-07a-reserve-biology');
await toTop(page, row('Mathematics: All papers'), 140);
await shot(page, 'p4-07b-reserve-maths-physics');
await toTop(page, page.locator('label', { hasText: 'I confirm that I have read the refund policy' }), 260);
await shot(page, 'p4-07c-reserve-consents');""")
edit('p4b-reserve.mjs', "import { signIn, BASE, shot, out, errors, browser, mainText, tallShot, mainBox } from './lib.mjs';",
     "import { signIn, BASE, shot, out, errors, browser, mainText, toTop } from './lib.mjs';")

# p2h: the ticked rows before the bottom of the card.
edit('p2h-desk.mjs', "  await page.selectOption('#desk-instrument', 'cash');",
     """  await page.selectOption('#desk-instrument', 'cash');
  await toTop(page, row('Chemistry: All papers'), 140);
  await shot(page, 'p2-40a-desk-ticked');""")

# p2f: the grids as the screen shows them.
edit('p2f-fees-dates.mjs', "  await tallShot(page, 'p2-27-fees-done', mainBox(page), { fullWidth: true, quality: 60 });",
     """  await toTop(page, grid('cambridge'), 20);
  await shot(page, 'p2-27-fees-cambridge');
  await toTop(page, grid('pearson_edexcel'), 20);
  await shot(page, 'p2-27b-fees-pearson');""")
edit('p2f-fees-dates.mjs', "  await shot(page, 'p2-29-dates-set');",
     """  await shot(page, 'p2-29-dates-set');
  await toTop(page, page.getByText('A.S. / A.L.', { exact: true }).first(), 20).catch(() => {});
  await shot(page, 'p2-29b-sheet-as-al');""")

# p34b: the student's form — a teacher chosen, and a one-paper retake with its declared sitting.
s = open(D + 'p34b-request.mjs').read()
s = s.replace("""  await page.getByLabel('Business Studies: All papers', { exact: true }).check();
  await page.waitForTimeout(500);""", """  const row = (label) => page.locator('tr', { has: page.getByLabel(label, { exact: true }) }).first();
  await page.getByLabel('Arabic: All papers', { exact: true }).check();
  await page.waitForTimeout(400);
  await row('Arabic: All papers').getByLabel('Teacher').selectOption({ label: 'Teacher 2' });
  await page.getByLabel('Chemistry: Paper 41/42 only (retake)', { exact: true }).check();
  await page.waitForTimeout(400);
  await row('Chemistry: Paper 41/42 only (retake)').getByLabel('The sitting it follows').selectOption({ label: 'Cambridge International June 2026' });
  await page.waitForTimeout(500);""")
s = s.replace("""  const row = page.locator('tr', { has: page.getByLabel('Business Studies: All papers', { exact: true }) }).first();
  await row.scrollIntoViewIfNeeded();
  await shot(page, 'p3-05-student-reserve');""", """  await toTop(page, row('Arabic: All papers'), 140);
  await shot(page, 'p3-05-student-reserve');
  await toTop(page, row('Chemistry: Paper 41/42 only (retake)'), 140);
  await shot(page, 'p3-05b-student-reserve-retake');""")
s = s.replace("import { signIn, BASE, shot, out, errors, browser, mainText } from './lib.mjs';", "import { signIn, BASE, shot, out, errors, browser, mainText, toTop } from './lib.mjs';")
open(D + 'p34b-request.mjs', 'w').write(s)

# p2j: the exception on the Arabic line; every declared sitting verified.
edit('p2j-follow-up.mjs', "{ hasText: 'Business Studies' }", "{ hasText: 'Arabic' }")
edit('p2j-follow-up.mjs', "'Parent One asked for more time on Business Studies; agreed by the admin'", "'Parent One asked for more time on Arabic; agreed by the admin'")
edit('p2j-follow-up.mjs', "  if (await page.getByRole('button', { name: 'Verify', exact: true }).count()) {", "  while (await page.getByRole('button', { name: 'Verify', exact: true }).count()) {")
print('ok')
