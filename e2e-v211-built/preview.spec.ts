import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';

const button = (page: Page, name: string) => page.getByRole('button', {name, exact: true}).filter({visible: true});
async function configure(page: Page) {
  await page.clock.setFixedTime(new Date('2026-11-11T09:00:00Z'));
  await page.goto('/');
  await button(page, 'ابدئي التجربة').click();
  await button(page, 'متابعة التجربة المحلية').click();
  await button(page, 'التالي: الخطة').click();
  await page.getByLabel('هدف تكرارات الحفظ').fill('1');
  await page.getByLabel('مدة دورة التعاهد بالأيام').fill('1');
  await page.getByLabel('بداية دورة التعاهد').fill('2026-11-11');
  await button(page, 'مراجعة الخطة').click();
  await button(page, 'تأكيد الخطة').click();
  await expect(page.getByRole('heading', {name: 'كل يوم، أقرب إلى وردك'})).toBeVisible();
}
async function exportJournal(page: Page) {
  await button(page, 'الإعدادات').click();
  const pending = page.waitForEvent('download');
  await button(page, 'تنزيل ملخص التجربة').click();
  const download = await pending;
  return JSON.parse(await readFile((await download.path())!, 'utf8'));
}

test('built private artifact runs a durable journey and exports the actual local journal under restrictive headers', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const response = await request.get('/');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(response.headers()['x-robots-tag']).toBe('noindex, nofollow');
  const manifest = await (await request.get('/preview-manifest.json')).json();
  expect(manifest).toMatchObject({kind: 'v211-private-synthetic-preview', productionReady: false, quranDisplay: false});
  for (const asset of manifest.files) {
    const body = await (await request.get('/' + asset.path)).body();
    expect(createHash('sha256').update(body).digest('hex'), asset.path).toBe(asset.sha256);
  }
  for (const path of ['/content/06l2/tanzil-uthmani-1.1.txt', '/src/testing/v211.tsx', '/.git/config', '/content/06l2/review.html']) expect((await request.get(path)).status(), path).toBe(404);
  expect((await request.get('/', {headers: {host: 'mulazama.com'}})).status()).toBe(403);
  expect((await request.post('/')).status()).toBe(405);
  await configure(page);
  await button(page, 'بدء الحفظ').click();
  await button(page, 'إضافة تكرار غيبي').click();
  await expect(page.getByLabel('عدد التكرارات المحفوظ', {exact: true})).toHaveText('١');
  await page.reload();
  await expect(page.getByLabel('عدد التكرارات المحفوظ', {exact: true})).toHaveText('١');
  const exported = await exportJournal(page);
  expect(exported).toMatchObject({namespace: 'mulazama.product.v2.1.1', synthetic: true, productionReady: false});
  expect(exported.state.sessions[0]).toMatchObject({kind: 'hifz', count: 1, state: 'completed'});
  expect(exported.events.filter((event: {command: {type: string}}) => event.command.type === 'add-repetition')).toHaveLength(1);
  expect(exported.outbox.length).toBe(exported.events.length);
  expect(Object.keys(exported.receipts)).toHaveLength(exported.events.length);
  expect(exported.outbox.every((item: {status: string}) => item.status === 'pending')).toBe(true);
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => performance.getEntriesByType('resource').some(entry => entry.name.includes('/@vite/')))).toBe(false);
});
