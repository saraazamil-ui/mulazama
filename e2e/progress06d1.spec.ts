import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Actual app/IndexedDB, without synthetic learning authorization.
for (const width of [320, 390, 1440]) {
  test('D1WEB responsive RTL and accessible progress ' + width + 'px', async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['S05', 'S14']) {
      await page.goto('/#' + route);
      const summary = page.getByRole('region', { name: 'ملخص التقدم' });
      await expect(summary).toBeVisible();
      for (const name of ['إنجاز ورد اليوم', 'تقدم الحفظ', 'المراجعة اليوم', 'ثبات الحفظ']) {
        await expect(summary.getByRole('heading', { name, exact: true })).toBeVisible();
      }
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(summary.getByRole('progressbar')).toHaveCount(0);
      await expect(summary).not.toContainText(/(?:\d|[٠-٩])[%٪]/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(result.violations).toEqual([]);
      await page.screenshot({ path: info.outputPath(route + '-' + width + '.png'), fullPage: true });
    }
  });
}

test('D1WEB real saved mistake and correction update progress without acquiring mastery', async ({ page }) => {
  await page.goto('/#S12');
  await page.getByLabel('الموضع إن كنت تعرفه', { exact: false }).fill('مرجع اختبار هندسي بلا نص قرآني');
  await page.getByRole('combobox', { name: 'درجة التأكد', exact: true }).selectOption('observed');
  await page.getByRole('button', { name: 'احفظ البلاغ', exact: true }).click();
  await expect(page.locator('.mistake-item')).toHaveCount(1);
  await page.goto('/#S14');
  await expect(page.getByText('مرجع اختبار هندسي بلا نص قرآني', { exact: true })).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('مرجع اختبار هندسي بلا نص قرآني', { exact: true })).toBeVisible();
  await page.goto('/#S12');
  await page.locator('.mistake-item').getByRole('button', { name: /صحح/ }).click();
  await page.getByRole('combobox', { name: 'درجة التأكد', exact: true }).selectOption('disputed');
  await page.getByRole('button', { name: 'احفظ تصحيح الخطأ', exact: true }).click();
  await expect(page.locator('.mistake-item')).toContainText('مصحح / منفي');
  await page.goto('/#S14');
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'تقدمي', exact: true })).toBeVisible();
  await expect(page.locator('.progress-locations')).toContainText('مختلف عليه');
});

test('D1WEB keyboard navigation reload and direct route never unlock learning', async ({ page }) => {
  await page.goto('/#S05');
  const link = page.getByRole('button', { name: /تفاصيل تقدمي/ });
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'تقدمي', exact: true })).toBeFocused();
  const summary = page.getByRole('region', { name: 'ملخص التقدم' });
  await expect(summary).toBeVisible();
  const content = await summary.innerText();
  await page.reload();
  await expect(summary).toHaveText(content, { useInnerText: true });
  await page.goto('/#S08');
  await expect(page.getByRole('heading', { name: 'النص المعتمد ينتظر الإضافة' })).toBeVisible();
  await expect(page.getByRole('button', { name: /أنهيت التسميع|اعرض تلميحًا/ })).toHaveCount(0);
});
