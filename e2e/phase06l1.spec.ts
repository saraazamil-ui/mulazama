import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('L1WEB01 newcomer completes three steps in four actions, reopens home, and cannot start blocked sessions', async ({ page }, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'ابدأ إعداد تجربتك' }).click();
  await page.getByRole('button', { name: 'التالي: المحفوظات والهدف' }).click();
  await page.getByRole('button', { name: 'التالي: الوقت المناسب' }).click();
  await page.getByRole('button', { name: 'احفظ واذهب إلى الرئيسية' }).click();
  await expect(page.locator('main[data-screen="S05"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'راجع هدفك ووقتك' })).toBeVisible();
  await expect(page.getByRole('button', { name: /ابدأ وردك|استأنف جلستك/ })).toHaveCount(0);
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await page.goto('/');
  await expect(page.locator('main[data-screen="S05"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ذاكرة الحافظ', exact: true })).toBeVisible();
  await info.attach('newcomer-journey.json', { body: JSON.stringify({ setupActions: 4, mainSteps: 3, defaultValuesUsed: true,
    homeOnReopen: true, actionsToStartActualWard: null, startStatus: 'blocked', humanParticipant: false }), contentType: 'application/json' });
});

test('L1WEB02 prior hafiz declares a range in six actions, with no verified memorization or HME writes', async ({ page }, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'ابدأ إعداد تجربتك' }).click();
  await page.getByRole('radio', { name: 'لدي محفوظات سابقة وأريد مراجعتها' }).click();
  await page.getByRole('button', { name: 'التالي: المحفوظات والهدف' }).click();
  await page.getByRole('button', { name: 'أضف إلى اختياراتي' }).click();
  await page.getByRole('button', { name: 'التالي: الوقت المناسب' }).click();
  await page.getByRole('button', { name: 'احفظ واذهب إلى الرئيسية' }).click();
  await expect(page.locator('main[data-screen="S05"]')).toBeVisible();
  await page.goto('/#S14');
  await expect(page.getByText('١ نطاقًا معلنًا محفوظًا محليًا.', { exact: false })).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  const facts = await page.evaluate(async () => {
    const { IndexedDbEventStore } = await import(/* @vite-ignore */ '/src/persistence/event-store.ts');
    const { HistoryApplication } = await import(/* @vite-ignore */ '/src/application/history-application.ts');
    const store = await IndexedDbEventStore.open('mulazama-development-learning-v1');
    const owner = await HistoryApplication.open(store);
    try { return { snapshot: await store.load(), config: owner.product.state.config, ranges: owner.product.state.ranges, memory: await owner.readPersonalMemory() }; }
    finally { owner.close(); }
  });
  expect(facts.config.goal).toBe('maintain'); expect(facts.ranges).toHaveLength(1);
  expect(facts.ranges[0].status).toBe('declared_unassessed'); expect(facts.memory.units).toHaveLength(0);
  expect(facts.snapshot.events.every((event: any) => event.data.scope === 'product')).toBe(true);
  await page.reload();
  await expect(page.getByText('١ نطاقًا معلنًا محفوظًا محليًا.', { exact: false })).toBeVisible();
  await info.attach('prior-hafiz-journey.json', { body: JSON.stringify({ setupActions: 6, mainSteps: 3, initialRange: 'synthetic declared surah 1',
    verifiedMemorization: false, hmeWrites: 0, humanParticipant: false }), contentType: 'application/json' });
});

test('L1WEB03 companion reads the real history owner and refreshes corrected observations without multiplying attempts', async ({ page }, info) => {
  await page.goto('/#S14');
  await expect(page.getByRole('heading', { name: 'ذاكرة الحافظ', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const { IndexedDbEventStore } = await import(/* @vite-ignore */ '/src/persistence/event-store.ts');
    const { historyFixture06d2 } = await import(/* @vite-ignore */ '/src/testing/history-fixture06d2.ts');
    const store = await IndexedDbEventStore.open('mulazama-development-learning-v1');
    try {
      const { addCompanionReport } = await import(/* @vite-ignore */ '/src/companion/test-fixture.ts');
      const fixture = historyFixture06d2();
      addCompanionReport(fixture, 'synthetic-history-attempt', 'موضع_اختبار_طويل_'.repeat(20));
      await store.replace(fixture.events, (await store.load()).revision);
    }
    finally { store.close(); }
    window.dispatchEvent(new Event('focus'));
  });
  const panel = page.locator('.companion-panel');
  await expect(panel.locator('dt', { hasText: 'محاولات لها نتيجة' }).locator('..').locator('dd')).toHaveText('١');
  const receipt = await page.evaluate(async () => {
    const { IndexedDbEventStore } = await import(/* @vite-ignore */ '/src/persistence/event-store.ts');
    const store = await IndexedDbEventStore.open('mulazama-development-learning-v1');
    try {
      const before = await store.load(), source = before.events.find((event: any) => event.type === 'AssessmentSubmitted'), at = new Date().toISOString(), id = 'l1-browser-correction';
      const event = { ...source, eventId: id, commandId: id, operationId: id, type: 'AssessmentCorrected', occurredAt: at, receivedAt: at,
        data: { scope: 'hme', command: { type: 'AssessmentCorrected', attemptId: 'synthetic-history-attempt', expectedAssessmentRevision: 1,
          reason: 'Synthetic L1 UI refresh', observation: { completion: 'complete', attemptedWords: 10, errors: 0, effort: 'normal', gapVerified: false } } } };
      const after = await store.append([event], before.revision), retry = await store.append([event], before.revision);
      return { originalEventsPreserved: JSON.stringify(after.events.slice(0, before.events.length)) === JSON.stringify(before.events),
        committed: after, retried: retry, eventCount: after.events.length };
    } finally { store.close(); window.dispatchEvent(new Event('focus')); }
  });
  expect(receipt.originalEventsPreserved).toBe(true); expect(receipt.retried).toEqual(receipt.committed);
  await expect(panel.locator('dt', { hasText: 'تصحيحات محفوظة' }).locator('..').locator('dd')).toHaveText('١');
  await expect(panel.locator('dt', { hasText: 'محاولات لها نتيجة' }).locator('..').locator('dd')).toHaveText('١');
  await page.reload();
  await expect(panel.locator('dt', { hasText: 'تصحيحات محفوظة' }).locator('..').locator('dd')).toHaveText('١');
  await page.setViewportSize({ width: 320, height: 740 });
  await panel.locator('.companion-units > li > details > summary').first().click();
  await panel.getByText('تاريخ تصحيحات هذه النتيجة', { exact: true }).click();
  await panel.getByText('هوية السجل', { exact: true }).click();
  await expect(panel.getByText('يوجد بلاغ محفوظ يتعارض', { exact: false })).toBeVisible();
  await info.attach('companion-320.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await info.attach('companion-real-idb.json', { body: JSON.stringify(receipt), contentType: 'application/json' });
});

test('L1WEB04 each setup step and policy page is accessible at 320px and keyboard operable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/#S02');
  for (const name of ['التالي: المحفوظات والهدف', 'التالي: الوقت المناسب', 'احفظ واذهب إلى الرئيسية']) {
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const button = page.getByRole('button', { name }); await button.focus(); await expect(button).toBeFocused(); await page.keyboard.press('Enter');
  }
  await expect(page.locator('main[data-screen="S05"]')).toBeVisible();
  for (const file of ['privacy', 'terms', 'support']) {
    await page.goto('/' + file + '.html');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('form')).toHaveCount(0);
  }
});
