import { test, expect } from '@playwright/test';

test('V211 preview keeps unapproved corpus and review tools outside the served application', async ({ page, request }) => {
  for (const path of [
    '/content/06l2/tanzil-uthmani-1.1.txt',
    '/content/06l2/source-slice-index.json',
    '/content/06l2/review.html',
    '/content/v211/candidate-manifest.json',
    '/references/ts-fsrs-5.4.2-verified/package/package.json',
    '/@fs/workspace/mulazama/content/06l2/tanzil-uthmani-1.1.txt',
  ]) {
    const response = await request.get(path);
    expect([403, 404], path).toContain(response.status());
    expect((await response.body()).length, path).toBeLessThan(2048);
  }
  await page.addInitScript(() => {
    localStorage.setItem('mulazama-v211-synthetic-db', 'mulazama-real-learner');
    localStorage.setItem('quranApproved', 'true');
    localStorage.setItem('productionReady', 'true');
  });
  await page.goto('/v211.html?quranApproved=true&content=approved');
  await expect(page.getByRole('heading', { name: 'رحلة تستحقّ الملازمة', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('mulazama-v211-synthetic-db'))).toMatch(/^mulazama-v211-synthetic-[a-f0-9-]{36}$/);
  expect(await page.evaluate(async () => (await indexedDB.databases()).map(db => db.name))).not.toContain('mulazama-real-learner');
  await page.getByRole('button', { name: 'عن المصحف', exact: true }).filter({ visible: true }).click();
  await expect(page.getByText('النص القرآني محجوب في هذه المعاينة', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: /Tanzil/ })).toHaveAttribute('href', 'https://tanzil.net/');
});
