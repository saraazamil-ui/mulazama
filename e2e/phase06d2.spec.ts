import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** Each Playwright test owns a fresh browser context. These synthetic records
 * are seeded into that context's development DB, never a user's persistent DB.
 * No synthetic learning capability is minted or injected into main.tsx. */
async function seedHistory(page: Page) {
  await page.goto('/#S14');
  await expect(page.getByRole('heading', { name: 'تقدم الحفظ', exact: true })).toBeVisible();
  const seeded = await page.evaluate(async () => {
    const { historyFixture06d2 } = await import(/* @vite-ignore */ '/src/testing/history-fixture06d2.ts');
    const { IndexedDbEventStore } = await import(/* @vite-ignore */ '/src/persistence/event-store.ts');
    const { runtimeDatabaseName } = await import(/* @vite-ignore */ '/src/release/runtime.ts');
    const store = await IndexedDbEventStore.open(runtimeDatabaseName());
    try {
      const before = await store.load(), fixture = historyFixture06d2();
      return await store.replace(fixture.events, before.revision);
    } finally { store.close(); }
  });
  await page.reload();
  await expect(page.locator('.progress-attempts li')).toHaveCount(1);
  return seeded;
}
async function readRaw(page: Page) {
  return page.evaluate(async () => {
    const { IndexedDbEventStore } = await import(/* @vite-ignore */ '/src/persistence/event-store.ts');
    const { runtimeDatabaseName } = await import(/* @vite-ignore */ '/src/release/runtime.ts');
    const store = await IndexedDbEventStore.open(runtimeDatabaseName());
    try { return await store.load(); } finally { store.close(); }
  });
}

test('D2WEB01 main reads persisted HME history and reopening preserves exact raw facts without enabling ratios', async ({ page }, info) => {
  const seeded = await seedHistory(page);
  await expect(page.locator('.progress-totals dd').last()).toHaveText('١');
  await expect(page.locator('.progress-attempts li')).toContainText('كامل بحسب البلاغ');
  await expect(page.locator('.progress-attempts li')).toContainText('الأخطاء المبلّغ عنها: ١');
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  const content = await page.locator('.progress-attempts').innerText();
  const before = await readRaw(page);
  await page.reload();
  await expect(page.locator('.progress-attempts')).toHaveText(content, { useInnerText: true });
  await expect(page.locator('.progress-totals dd').last()).toHaveText('١');
  expect(await readRaw(page)).toEqual(before);
  expect(before).toEqual(seeded);
  await info.attach('history-reload-receipt', { body: JSON.stringify({ eventCount: before.events.length, revision: before.revision, unchangedAfterReopen: true, completedSessions: 1 }), contentType: 'application/json' });
});

test('D2WEB02 a valid historical correction recomputes the original day and an identical append retry cannot double count', async ({ page }, info) => {
  const seeded = await seedHistory(page);
  const originalDate = await page.locator('.progress-attempts time').getAttribute('datetime');
  const result = await page.evaluate(async () => {
    const { IndexedDbEventStore } = await import(/* @vite-ignore */ '/src/persistence/event-store.ts');
    const { runtimeDatabaseName } = await import(/* @vite-ignore */ '/src/release/runtime.ts');
    const store = await IndexedDbEventStore.open(runtimeDatabaseName());
    try {
      const before = await store.load(), source = before.events.find(event => event.type === 'AssessmentSubmitted')!;
      const id = 'synthetic-d2-browser-correction', at = new Date().toISOString();
      const correction = { ...source, eventId: id, commandId: id, operationId: id, type: 'AssessmentCorrected', occurredAt: at, receivedAt: at,
        data: { scope: 'hme', command: { type: 'AssessmentCorrected', attemptId: 'synthetic-history-attempt', expectedAssessmentRevision: 1,
          reason: 'synthetic correction of scope', observation: { completion: 'partial', attemptedWords: 5, errors: 1, effort: 'normal', gapVerified: false } } } };
      const first = await store.append([correction], before.revision);
      const retry = await store.append([correction], before.revision);
      return { first, retry };
    } finally { store.close(); }
  });
  expect(result.retry).toEqual(result.first);
  expect(result.first.events).toHaveLength(8);
  expect(result.first.events.slice(0, 7)).toEqual(seeded.events);
  await page.reload();
  await expect(page.locator('.progress-totals dd').last()).toHaveText('٠');
  await expect(page.locator('.progress-attempts li')).toHaveCount(1);
  await expect(page.locator('.progress-attempts li')).toContainText('جزئي بحسب البلاغ');
  await expect(page.locator('.progress-attempts li')).toContainText('نسخة التقييم ٢');
  await expect(page.locator('.progress-attempts time')).toHaveAttribute('datetime', originalDate!);
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.progress-totals dd').last()).toHaveText('٠');
  expect(await readRaw(page)).toEqual(result.first);
  await info.attach('corrected-original-day-receipt', { body: JSON.stringify({ originalDate, finalEventCount: 8, correctionCount: 1, completedSessions: 0, unchangedRetry: true }), contentType: 'application/json' });
});

test('D2WEB03 stored history never authorizes blocked routes or internal learning commands', async ({ page }, info) => {
  const before = await seedHistory(page);
  for (const route of ['S07', 'S08', 'S09', 'S10', 'S11']) {
    await page.goto('/#' + route);
    await expect(page.getByRole('heading', { name: 'النص المعتمد ينتظر الإضافة' })).toBeVisible();
    await expect(page.getByRole('button', { name: /أنهيت تكرارًا|بدء محاولة غيبية|أكملت المحاولة|حفظ الدليل اليدوي|بدء الوحدة/ })).toHaveCount(0);
  }
  const result = await page.evaluate(async () => {
    const { HistoryApplication } = await import(/* @vite-ignore */ '/src/application/history-application.ts');
    const app = await HistoryApplication.open();
    try {
      let code: string | null = null;
      try { await app.product.dispatch({ type: 'session.start', kind: 'review', rangeLabel: 'synthetic blocked call' }); }
      catch (error) { code = (error as { code?: string }).code ?? 'untyped'; }
      return { code, progress: await app.readProgress() };
    } finally { app.close(); }
  });
  expect(result.code).toBe('RELEASE_GATES_BLOCKED');
  expect(result.progress.activity.completedSessions).toBe(1);
  expect(result.progress.review.due).toBeNull();
  expect(await readRaw(page)).toEqual(before);
  await info.attach('history-does-not-authorize-learning', { body: JSON.stringify({ rejectedCode: result.code, learningEventsUnchanged: true, reviewDue: null }), contentType: 'application/json' });
});

test('D2WEB04 semantic corruption is rejected without deleting history or creating a fallback profile', async ({ page }, info) => {
  await seedHistory(page);
  const invalid = await page.evaluate(async () => {
    const { IndexedDbEventStore } = await import(/* @vite-ignore */ '/src/persistence/event-store.ts');
    const { runtimeDatabaseName } = await import(/* @vite-ignore */ '/src/release/runtime.ts');
    const store = await IndexedDbEventStore.open(runtimeDatabaseName());
    try {
      const before = await store.load();
      const events = structuredClone(before.events);
      const assessment = events.find(event => event.type === 'AssessmentSubmitted')!;
      // Authenticated bytes containing an invalid semantic observation; this is
      // distinct from the existing AES ciphertext-corruption tests.
      (assessment.data.command as { observation: { errors: number } }).observation.errors = -1;
      return await store.replace(events, before.revision);
    } finally { store.close(); }
  });
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('لم ننشئ سجلًا بديلًا ولم نمسح بياناتك');
  await expect(page.getByRole('region', { name: 'ملخص التقدم' })).toHaveCount(0);
  expect(await readRaw(page)).toEqual(invalid);
  await page.reload();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await readRaw(page)).toEqual(invalid);
  await info.attach('corruption-preservation-receipt', { body: JSON.stringify({ eventCount: invalid.events.length, unchangedAfterTwoFailedOpens: true, profileInitializations: invalid.events.filter(event => event.type === 'ProfileInitialized').length }), contentType: 'application/json' });
});

test('D2WEB05 populated progress at 320px supports RTL, keyboard and automated accessibility', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await seedHistory(page);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const skip = page.getByRole('link', { name: 'تجاوز إلى المحتوى' });
  await skip.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  const source = page.locator('.progress-evidence summary');
  await source.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.progress-evidence')).toHaveAttribute('open', '');
  await page.keyboard.press('Enter');
  await expect(page.locator('.progress-evidence')).not.toHaveAttribute('open', '');
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(result.violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('D2-progress-history-320.png'), fullPage: true });
});
