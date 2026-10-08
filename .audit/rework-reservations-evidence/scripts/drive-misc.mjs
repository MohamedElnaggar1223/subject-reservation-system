// Credentials of the local dev container and its demo accounts are read from the environment (DEV_PASSWORD, DEV_ADMIN_PASSWORD, DEV_PG_ADMIN_URL, DEV_PG_BASE_URL).
// The remaining screens: a student's reservation (a request to the parent) and the parent's
// approval; the parent's swap dialog naming the new line; the admin's verification setting.
// drive-misc.mjs <lang> <studentTag> <swapTag>. Placeholder accounts only.
import { readFileSync } from 'node:fs';
import { browser, signedIn, shot, WEB } from './lib.mjs';

const demo = JSON.parse(readFileSync('/tmp/rwb/demo-B.json', 'utf8'));
const lang = process.argv[2] ?? 'en';
const tag = process.argv[3];
const swapTag = process.argv[4];
const step = async (name, fn) => { try { await fn(); } catch (e) { console.log(`[step failed] ${name}: ${String(e.message).split('\n')[0]}`); } };

const b = await browser();
if (tag) {
  await step('student request', async () => {
    const page = await signedIn(b, `student.${tag}@igcse.local`, process.env.DEV_PASSWORD, lang);
    await page.goto(`${WEB}/register`);
    await page.waitForSelector('#reserve-session', { timeout: 30000 });
    if ((await page.locator('#reserve-session').inputValue()) !== demo.sessionId) await page.selectOption('#reserve-session', demo.sessionId);
    await page.getByRole('checkbox', { name: /Mathematics O\.L\./ }).check();
    const boxes = page.locator('input[type="checkbox"]');
    const n = await boxes.count();
    await boxes.nth(n - 2).check();
    await boxes.nth(n - 1).check();
    await shot(page, `student-request-filled-${lang}`);
    await page.getByRole('button', { name: /^Reserve|^الحجز|^Send|^إرسال/ }).last().click();
    await page.waitForTimeout(2500);
    await shot(page, `student-request-done-${lang}`);
  });
  await step('parent approval', async () => {
    const page = await signedIn(b, `parent.${tag}@igcse.local`, process.env.DEV_PASSWORD, lang);
    await page.goto(`${WEB}/approvals`);
    await page.waitForTimeout(3000);
    await shot(page, `parent-approvals-${lang}`);
    await page.getByText(/Mathematics O\.L\./).first().click();
    await page.waitForTimeout(500);
    await shot(page, `parent-approvals-ticked-${lang}`);
    await page.getByRole('button', { name: /Approve Selected|اعتماد المحدد|الموافقة على المحدد/ }).first().click();
    await page.waitForTimeout(800);
    await shot(page, `parent-approve-modal-${lang}`);
    await page.getByRole('button', { name: /Confirm Approval|تأكيد/ }).last().click();
    await page.waitForTimeout(2500);
    await shot(page, `parent-approved-${lang}`);
  });
}
if (swapTag) {
  await step('parent swap dialog', async () => {
    const page = await signedIn(b, `parent.${swapTag}@igcse.local`, process.env.DEV_PASSWORD, lang);
    await page.goto(`${WEB}/registrations`);
    await page.waitForTimeout(3000);
    await shot(page, `parent-registrations-${lang}`);
    await page.getByRole('button', { name: /^Swap$|^تبديل$/ }).first().click();
    await page.waitForTimeout(1500);
    await shot(page, `parent-swap-modal-${lang}`);
    const to = page.locator('select').filter({ has: page.locator('option', { hasText: /Chemistry O\.L\./ }) }).first();
    const value = await to.locator('option', { hasText: /Chemistry O\.L\./ }).first().getAttribute('value');
    await to.selectOption(value);
    await page.waitForTimeout(1500);
    await shot(page, `parent-swap-chosen-${lang}`);
    await page.getByRole('button', { name: /Confirm Swap|تأكيد/ }).click();
    await page.waitForTimeout(3000);
    await shot(page, `parent-swap-done-${lang}`);
  });
}
await step('settings', async () => {
  const page = await signedIn(b, 'admin@igcse.local', process.env.DEV_ADMIN_PASSWORD, lang);
  await page.goto(`${WEB}/settings`);
  await page.waitForTimeout(3000);
  const v = page.getByText(/Verification|التحقق/).first();
  if (await v.count()) await v.scrollIntoViewIfNeeded();
  await shot(page, `settings-${lang}`);
});
await b.close();
