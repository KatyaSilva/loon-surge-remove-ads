// Run with PLAYWRIGHT_MODULE pointing to an installed Playwright package.
// All paperclip.test requests use the offline harness; all other network is blocked.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { evaluate, ORIGIN } from './harness.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: 'light' });
const page = await context.newPage();
const store = new Map(), pageErrors = [], consoleErrors = [], blocked = [], checks = [];
let active = 0, maximumActive = 0, failModule = '';
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push({ text: message.text(), url: message.location().url }); });
await context.route('**/*', async (route) => {
  const req = route.request();
  if (!req.url().startsWith(ORIGIN + '/')) { blocked.push(req.url()); await route.abort(); return; }
  const check = req.url().endsWith('/api/check');
  const data = req.postData() ? JSON.parse(req.postData()) : {};
  if (check) { active++; maximumActive = Math.max(maximumActive, active); checks.push(data); }
  try {
    const value = await evaluate({ url: req.url(), method: req.method(), headers: req.headers(), body: req.postData() || undefined }, { store });
    let reply = value.response;
    if (check && data.module === failModule) reply = { status: 502, headers: reply.headers, body: JSON.stringify({ ok: false, error: '离线测试：模拟来源不可用' }) };
    await route.fulfill({ status: reply.status, headers: reply.headers, body: reply.body });
  } finally { if (check) active--; }
});
try {
  await page.goto(ORIGIN + '/ipquality');
  await page.locator('#policy:not([disabled])').waitFor();
  assert.equal(await page.locator('#options input').count(), 15);
  assert.equal(await page.locator('#run').isDisabled(), true);
  assert.equal(checks.length, 0, 'loading the page must not start probes');
  await page.locator('#policy').selectOption('POLICY::fixture-external');
  await page.locator('[data-preset="basic"]').click();
  await page.locator('#mask').check();
  await page.locator('#run').click();
  await page.waitForFunction(() => document.querySelector('#progress').textContent.includes('1 项检测结束'));
  assert.equal(checks[0].module, 'basic'); assert.equal(checks[0].mask, true);
  await page.locator('iframe.frame').scrollIntoViewIfNeeded();
  const frame = page.frameLocator('iframe.frame');
  await frame.locator('.report-root').waitFor();
  assert.ok(!(await frame.locator('body').innerText()).includes('203.0.113.24'));
  assert.ok((await page.locator('iframe.frame').boundingBox()).height > 150);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const output = process.env.BROWSER_OUTPUT_DIR || '/private/tmp/ipquality-browser';
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: output + '/light-mobile.png', fullPage: true });

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: output + '/dark-mobile.png', fullPage: true });
  assert.equal(await frame.locator('body').evaluate((body) => getComputedStyle(body).backgroundColor), 'rgb(28, 28, 30)');

  failModule = 'scores';
  await page.locator('[data-preset="risk"]').click();
  await page.locator('#run').click();
  await page.waitForFunction(() => document.querySelector('#progress').textContent.includes('3 项检测结束'));
  assert.equal(await page.locator('.result[data-state="success"]').count(), 2);
  assert.equal(await page.locator('.result[data-state="error"]').count(), 1);
  assert.ok(maximumActive <= 2);
  await page.locator('#clear').click();
  assert.equal(await page.locator('iframe.frame').count(), 0);
  await page.reload();
  await page.locator('#policy:not([disabled])').waitFor();
  assert.equal(await page.locator('#mask').isChecked(), true);
  assert.equal(await page.locator('#policy').inputValue(), 'POLICY::fixture-external');
  assert.equal(await page.locator('#options input:checked').count(), 3);
  assert.deepEqual(blocked, []);
  assert.deepEqual(pageErrors, []);
  assert.equal(consoleErrors.length, 1, JSON.stringify(consoleErrors));
  assert.ok(consoleErrors[0].text.includes('502'), 'only the deliberately simulated source failure is expected');
  assert.ok(consoleErrors[0].url.endsWith('/ipquality/api/check'));
  console.log('Browser checks passed: mobile layout, dark report, masking, persistence, two-worker limit, partial failure, no unexpected network.');
  console.log('Screenshots: ' + output);
} finally { await browser.close(); }
