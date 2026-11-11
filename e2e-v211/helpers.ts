import { expect, type Page } from '@playwright/test';
import type { ProductEvent, ProductState } from '../src/application/product-v211';
import type { ProductSnapshot } from '../src/persistence/product-v211-store';

export async function facts(page: Page): Promise<ProductSnapshot<ProductState, ProductEvent>> {
  return page.evaluate(async () => {
    const { IndexedDbProductStore } = await import('/src/persistence/product-v211-store.ts');
    const name = localStorage.getItem('mulazama-v211-synthetic-db');
    if (!name?.startsWith('mulazama-v211-synthetic-')) throw Error('NOT_SYNTHETIC_DATABASE');
    const store = await IndexedDbProductStore.open(name);
    try { return await store.load(); } finally { store.close(); }
  });
}

export const visibleButton = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).filter({ visible: true });

export async function openPreview(page: Page, at = '2026-11-11T09:00:00Z') {
  await page.clock.setFixedTime(new Date(at));
  await page.goto('/v211.html');
  await expect(page.locator('.v211-preview-bar')).toContainText('معاينة');
}

export async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

export async function setup(page: Page, options: {at?: string; prior?: number[]; hifzTarget?: number; linkTarget?: number; cycleDays?: number; anchor?: string} = {}) {
  await openPreview(page, options.at);
  await visibleButton(page, 'ابدئي التجربة').click();
  await visibleButton(page, 'متابعة التجربة المحلية').click();
  for (const face of options.prior ?? []) await page.getByRole('checkbox', {name: new RegExp(`مقدار تجريبي ${face}`)}).check();
  await visibleButton(page, 'التالي: الخطة').click();
  await expect(page.getByLabel('هدف تكرارات الحفظ')).toHaveValue('20');
  await expect(page.getByLabel('هدف تكرارات التثبيت')).toHaveValue('5');
  await expect(page.getByLabel('مدة دورة التعاهد بالأيام')).toHaveValue('');
  await page.getByLabel('هدف تكرارات الحفظ').fill(String(options.hifzTarget ?? 3));
  await page.getByLabel('هدف تكرارات التثبيت').fill(String(options.linkTarget ?? 2));
  await page.getByLabel('مدة دورة التعاهد بالأيام').fill(String(options.cycleDays ?? 1));
  await page.getByLabel('بداية دورة التعاهد').fill(options.anchor ?? (options.at ?? '2026-11-11').slice(0, 10));
  await visibleButton(page, 'مراجعة الخطة').click();
  expect((await facts(page)).events).toHaveLength(0);
  await visibleButton(page, 'تأكيد الخطة').click();
  await expect(page.getByRole('heading', {name: 'كل يوم، أقرب إلى وردك'})).toBeVisible();
}

export async function add(page: Page, count = 1) {
  for (let i = 0; i < count; i++) {
    const before = (await page.getByLabel('عدد التكرارات المحفوظ', {exact: true}).textContent())!;
    await visibleButton(page, 'إضافة تكرار غيبي').click();
    await expect(page.getByLabel('عدد التكرارات المحفوظ', {exact: true})).not.toHaveText(before);
  }
}
