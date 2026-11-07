import { test, expect } from '@playwright/test';
test('L1OFF01 first setup is committed offline and survives reload; policy assets remain available', async ({ page, context }, info) => {
  await page.goto('/#S02');
  await expect(page.getByRole('button', { name: 'التالي: المحفوظات والهدف' })).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.getByRole('radio', { name: 'لدي محفوظات سابقة وأريد مراجعتها' }).click();
  await page.getByRole('button', { name: 'التالي: المحفوظات والهدف' }).click();
  await page.getByRole('button', { name: 'أضف إلى اختياراتي' }).click();
  await page.getByRole('button', { name: 'التالي: الوقت المناسب' }).click();
  await page.getByRole('button', { name: 'احفظ واذهب إلى الرئيسية' }).click();
  await expect(page.locator('main[data-screen="S05"]')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'ذاكرة الحافظ', exact: true })).toBeVisible();
  await page.goto('/#S14');
  await expect(page.getByText('١ نطاقًا معلنًا محفوظًا محليًا.', { exact: false })).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  for (const [file, title] of [['support', 'المساعدة والدعم'], ['privacy', 'الخصوصية في النسخة الحالية'], ['terms', 'حدود استخدام النسخة الحالية']]) {
    await page.goto('/' + file + '.html?offline-check=1');
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  }
  await page.goto('/#S08');
  await expect(page.getByRole('heading', { name: 'النص المعتمد ينتظر الإضافة' })).toBeVisible();
  await info.attach('offline-setup.json', { body: JSON.stringify({ setupCommittedWhileOffline: true, declaredRangePreserved: true, policiesCached: true, sessionsBlocked: true }), contentType: 'application/json' });
});
