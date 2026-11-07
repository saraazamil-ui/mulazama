import { test, expect } from '@playwright/test';

// Both cases create private, temporary BrowserContexts. They never use a
// persistent browser profile. Closing the context discards every test database.
test('L2SECWEB01 a stale second tab cannot resurrect the former profile after confirmed deletion', async ({ browser }, info) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', locale: 'ar-SA', timezoneId: 'Asia/Riyadh' });
  try {
    const page = await context.newPage();
    await page.goto('/#S01');
    await expect(page.locator('main[data-screen="S01"]')).toBeVisible();
    const database = 'mulazama-l2-security-' + crypto.randomUUID();
    const original = await page.evaluate(async name => {
      const { IndexedDbEventStore } = await import(/* @vite-ignore */ '/src/persistence/event-store.ts');
      const { HistoryApplication } = await import(/* @vite-ignore */ '/src/application/history-application.ts');
      const store = await IndexedDbEventStore.open(name), owner = await HistoryApplication.open(store);
      (window as any).__l2Security = { store, owner };
      await owner.product.configureOnboarding({ commandId: 'synthetic-l2-setup', config: { ...owner.product.state.config, configured: true },
        ranges: [{ id: 'synthetic-l2-range', kind: 'surah', start: 1, end: 1, editionId: 'prototype-unverified', status: 'declared_unassessed' }] });
      return { snapshot: await store.load(), profileId: owner.product.state.profileId, config: owner.product.state.config };
    }, database);
    const second = await context.newPage();
    await second.goto('/#S01');
    await expect(second.locator('main[data-screen="S01"]')).toBeVisible();
    await second.evaluate(async name => {
      const { IndexedDbEventStore } = await import(/* @vite-ignore */ '/src/persistence/event-store.ts');
      const { HistoryApplication } = await import(/* @vite-ignore */ '/src/application/history-application.ts');
      const store = await IndexedDbEventStore.open(name), owner = await HistoryApplication.open(store);
      (window as any).__l2Security = { store, owner };
    }, database);
    const reset = await page.evaluate(async () => {
      const { store, owner } = (window as any).__l2Security;
      await owner.reset(true);
      return { snapshot: await store.load(), state: owner.product.state };
    });
    expect(reset.state.profileId).not.toBe(original.profileId);
    expect(reset.state.config).toEqual(original.config);
    expect(reset.state.ranges).toEqual([]);
    const stale = await second.evaluate(async () => {
      const { store, owner } = (window as any).__l2Security;
      let rejection: string | null = null;
      try { await owner.product.dispatch({ type: 'preferences', patch: { largeText: true } }); }
      catch (error) { rejection = (error as { code: string }).code; }
      const afterRejectedWrite = await store.load();
      await owner.product.refresh();
      let sessionRejection: string | null = null;
      try { await owner.product.dispatch({ type: 'session.start', kind: 'review', rangeLabel: 'synthetic' }); }
      catch (error) { sessionRejection = (error as { code: string }).code; }
      return { rejection, sessionRejection, afterRejectedWrite, final: await store.load(), state: owner.product.state };
    });
    expect(stale.rejection).toBe('REVISION_CONFLICT');
    expect(stale.sessionRejection).toBe('RELEASE_GATES_BLOCKED');
    expect(stale.afterRejectedWrite).toEqual(reset.snapshot);
    expect(stale.final).toEqual(reset.snapshot);
    expect(stale.state.profileId).toBe(reset.state.profileId);
    expect(stale.state.ranges).toEqual([]);
    expect(stale.final.events.every((event: any) => event.userId !== original.profileId)).toBe(true);
    await info.attach('stale-tab-reset-receipt.json', { body: JSON.stringify({ separateBrowserPages: 2, formerProfileNotResurrected: true,
      staleWriteRejected: stale.rejection, gatesStillBlocked: stale.sessionRejection, originalEvents: original.snapshot.events.length,
      postResetEvents: reset.snapshot.events.length, postRejectionEvents: stale.final.events.length, temporaryBrowserContext: true }), contentType: 'application/json' });
    for (const tab of [page, second]) await tab.evaluate(() => { (window as any).__l2Security?.owner.close(); delete (window as any).__l2Security; });
  } finally { await context.close(); }
});

test('L2SECWEB02 a report entered through the UI remains inert text after IndexedDB reopen', async ({ browser }, info) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', locale: 'ar-SA', timezoneId: 'Asia/Riyadh' });
  try {
    const page = await context.newPage();
    const probe = '/__l2_untrusted_report_probe__';
    const text = `<img src="${probe}" onerror="window.__l2Executed=true"><script>window.__l2Executed=true</script>`;
    const requests: string[] = [];
    page.on('request', request => { if (request.url().includes(probe)) requests.push(request.url()); });
    await page.goto('/#S12');
    await expect(page.locator('main[data-screen="S12"]')).toBeVisible();
    // Use only ordinary UI commands; this test never replaces a database.
    await page.getByRole('textbox', { name: /^الموضع إن كنت تعرفه/ }).fill(text);
    await page.getByLabel('ملاحظة اختيارية', { exact: true }).fill(text);
    await page.getByRole('button', { name: 'احفظ البلاغ', exact: true }).click();
    await expect(page.locator('.mistake-item')).toHaveCount(1);
    const beforeReload = await page.evaluate(async () => {
      const { IndexedDbEventStore } = await import(/* @vite-ignore */ '/src/persistence/event-store.ts');
      const store = await IndexedDbEventStore.open('mulazama-development-learning-v1');
      try { return await store.load(); } finally { store.close(); }
    });
    await page.reload();
    const report = page.locator('.mistake-item');
    await expect(report.getByRole('heading', { level: 3 })).toHaveText(text);
    await expect(report.locator('script,img,iframe,object')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__l2Executed ?? false)).toBe(false);
    expect(requests).toEqual([]);
    const retained = await page.evaluate(async () => {
      const { IndexedDbEventStore } = await import(/* @vite-ignore */ '/src/persistence/event-store.ts');
      const store = await IndexedDbEventStore.open('mulazama-development-learning-v1');
      try { return await store.load(); } finally { store.close(); }
    });
    expect(retained).toEqual(beforeReload);
    expect(retained.events.every((event: any) => event.data.scope === 'product')).toBe(true);
    await page.goto('/#S14');
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__l2Executed ?? false)).toBe(false);
    expect(requests).toEqual([]);
    // Explicit product deletion, confined to the disposable context's test data.
    await page.goto('/#S18');
    await page.getByRole('button', { name: 'احذف بيانات التعلم كاملة', exact: false }).click();
    await page.getByRole('button', { name: 'تأكيد الحذف', exact: true }).click();
    await expect(page.locator('main[data-screen="S01"]')).toBeVisible();
    await page.goto('/#S12');
    await expect(page.locator('.mistake-item')).toHaveCount(0);
    await info.attach('inert-report-receipt.json', { body: JSON.stringify({ inputPath: 'ordinary UI', databaseReplacement: false,
      untrustedReportPreservedExactly: true, rawHistoryUnchangedOnReload: true, executableNodesInReport: 0, probeRequests: requests.length,
      scriptExecuted: false, temporaryBrowserContext: true, testDataRemovedThroughUI: true }), contentType: 'application/json' });
  } finally { await context.close(); }
});
