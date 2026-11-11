/** Test the deployed private synthetic app. Supply a Sites service token via stdin only. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium, request, expect } from '@playwright/test';
import { chromiumLaunchOptions } from './playwright-browser.mjs';

const profile = JSON.parse(await readFile(new URL('../deployment/v211-private.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(await readFile(new URL('../dist-v211/preview-manifest.json', import.meta.url), 'utf8'));
let input = '';
for await (const chunk of process.stdin) input += chunk;
const { token } = JSON.parse(input);
assert.equal(typeof token, 'string');
assert.ok(token.length > 10);
input = '';
const origin = profile.origin;
const api = await request.newContext({
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
  timeout: 30000,
});
const get = (path, options = {}) => {
  const url = new URL(path, origin);
  assert.equal(url.origin, origin, 'Never send the service credential to another origin');
  return api.fetch(url.href, {
    ...options, maxRedirects: 0,
    headers: { 'OAI-Sites-Authorization': `Bearer ${token}` },
  });
};
const report = { url: origin, testedAt: new Date().toISOString(), syntheticOnly: true, quranDisplay: false, productionReady: false, authentication: 'owner-only Sites gate; authorized QA uses an in-memory, exact-origin service header', anonymous: [], hashes: [], paths: [], mobile: {} };
let browser;
try {
  for (const path of ['/', '/' + manifest.files.find(f => f.path.endsWith('.js')).path]) {
    const response = await api.get(origin + path, { maxRedirects: 0 });
    report.anonymous.push({ path, status: response.status() });
    assert.ok([301, 302, 303, 307, 308, 401, 403].includes(response.status()), 'Anonymous request must not serve the application');
  }
  const root = await get('/');
  assert.equal(root.status(), 200, 'Authenticated root must respond');
  assert.ok(root.headers()['content-security-policy'].includes("frame-ancestors 'none'"));
  assert.equal(root.headers()['cache-control'], 'no-store');
  const deployed = await (await get('/preview-manifest.json')).json();
  assert.deepEqual(deployed, manifest);
  for (const file of manifest.files) {
    const response = await get('/' + file.path);
    assert.equal(response.status(), 200);
    assert.equal(createHash('sha256').update(await response.body()).digest('hex'), file.sha256);
    report.hashes.push({ path: file.path, sha256: file.sha256, match: true });
  }
  for (const path of ['/content/06l2/tanzil-uthmani-1.1.txt', '/src/testing/v211.tsx', '/.git/config', '/content/06l2/review.html', '/api/sync']) {
    const response = await get(path);
    assert.equal(response.status(), 404, path);
    report.paths.push({ path, status: response.status() });
  }
  assert.equal((await get('/', { method: 'POST' })).status(), 405);
  report.writesBlocked = true;
  browser = await chromium.launch({ ...chromiumLaunchOptions(), headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ar-SA', timezoneId: 'Asia/Riyadh', serviceWorkers: 'block' });
  const unexpectedOrigins = [];
  // Fulfil with actual deployed HTTPS responses, keeping credentials out of the browser
  // and refusing redirects. No traces/HAR/storage state containing secrets are recorded.
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { unexpectedOrigins.push(url.origin); await route.abort(); return; }
    const response = await get(url.pathname + url.search, { method: route.request().method() });
    assert.equal(response.status(), 200, `Browser resource ${url.pathname}`);
    await route.fulfill({ response });
  });
  let page = await context.newPage();
  const errors = [];
  const observe = p => p.on('pageerror', error => errors.push(error.message));
  observe(page);
  const button = name => page.getByRole('button', { name, exact: true }).filter({ visible: true });
  await page.goto(origin);
  await button('ابدئي التجربة').click();
  await button('متابعة التجربة المحلية').click();
  await button('التالي: الخطة').click();
  await page.getByLabel('هدف تكرارات الحفظ').fill('2');
  await page.getByLabel('مدة دورة التعاهد بالأيام').fill('2');
  await page.getByLabel('بداية دورة التعاهد').fill('2026-11-11');
  await button('مراجعة الخطة').click();
  await button('تأكيد الخطة').click();
  await expect(page.getByRole('heading', { name: 'كل يوم، أقرب إلى وردك' })).toBeVisible();
  report.mobile.onboarding = 'passed';
  await button('بدء الحفظ').click();
  await button('إضافة تكرار غيبي').click();
  await expect(page.getByLabel('عدد التكرارات المحفوظ', { exact: true })).toHaveText('١');
  await button('توقف واحفظ').click();
  await expect(page.getByRole('heading', { name: 'كل يوم، أقرب إلى وردك' })).toBeVisible();
  await page.close();
  page = await context.newPage(); observe(page);
  await page.goto(origin);
  await button('متابعة الحفظ').click();
  await expect(page.getByLabel('عدد التكرارات المحفوظ', { exact: true })).toHaveText('١');
  report.mobile.pauseAndReopen = 'passed';
  await button('إضافة تكرار غيبي').click();
  await expect(page.getByLabel('عدد التكرارات المحفوظ', { exact: true })).toHaveText('٢');
  await page.reload();
  await expect(page.getByLabel('عدد التكرارات المحفوظ', { exact: true })).toHaveText('٢');
  report.mobile.completionAndReload = 'passed';
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  report.mobile.viewport = { width: 390, height: 844, overflow: false };
  await mkdir(new URL('../docs/v211/evidence/', import.meta.url), { recursive: true });
  await page.screenshot({ path: new URL('../docs/v211/evidence/https-preview-mobile.png', import.meta.url).pathname, fullPage: true });
  await button('الإعدادات').click();
  const pending = page.waitForEvent('download');
  await button('تنزيل ملخص التجربة').click();
  const download = await pending;
  const journal = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(journal.synthetic, true);
  assert.equal(journal.namespace, 'mulazama.product.v2.1.1');
  assert.equal(journal.productionReady, false);
  assert.equal(journal.state.sessions[0].count, 2);
  assert.equal(journal.state.sessions[0].state, 'completed');
  assert.equal(journal.events.filter(event => event.command.type === 'add-repetition').length, 2);
  assert.equal(journal.outbox.length, journal.events.length);
  assert.ok(journal.outbox.every(item => item.status === 'pending'));
  report.mobile.durableJournalExport = 'passed';
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpectedOrigins, []);
  report.mobile.pageErrors = errors;
  report.mobile.externalRequests = unexpectedOrigins;
  report.result = 'passed';
  await writeFile(new URL('../docs/v211/evidence/https-preview.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await api.dispose();
}
