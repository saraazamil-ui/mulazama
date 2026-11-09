import { test, expect } from '@playwright/test';

test('L2FSRSWEB01 isolated encrypted IndexedDB copy/restore/rollback preserves events and both versioned projections', async ({ browser }, info) => {
  // A fresh browser context, two fresh UUID-named QA databases, and no learner input.
  const context = await browser.newContext({ locale: 'ar-SA', timezoneId: 'Asia/Riyadh' });
  try {
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:4173/#S05');
    await expect(page.getByRole('heading', { level: 1, name: 'وردك اليوم', exact: true })).toBeVisible();
    const result = await page.evaluate(async () => {
      const { runFsrsRehearsal06l2 } = await import(/* @vite-ignore */ '/src/testing/fsrs-rehearsal06l2.ts');
      const facts = await runFsrsRehearsal06l2();
      const remaining = (await indexedDB.databases()).map(entry => entry.name).filter(name => name?.startsWith('mulazama-06l2-fsrs-rehearsal-'));
      return { facts, remainingQaDatabases: remaining };
    });
    for (const key of ['sourceEventsUnchanged', 'copiedEventsEqual', 'sourceDigestPreserved', 'correctedProjectionStableAfterReopen',
      'rollbackEventsEqual', 'legacyAlgorithmPreserved', 'productionHistoryRestoreStillBlocked', 'releaseGatesStillBlocked'] as const)
      expect(result.facts[key], key).toBe(true);
    expect(result.facts.engineMigrationPerformed).toBe(false); expect(result.facts.realLearnerDataUsed).toBe(false);
    expect(result.facts.sourceEventCount).toBe(10); expect(result.remainingQaDatabases).toEqual([]);
    await page.goto('http://127.0.0.1:4173/#S08');
    await expect(page.getByRole('heading', { name: 'النص المعتمد ينتظر الإضافة', exact: true })).toBeVisible();
    await info.attach('fsrs-integration-indexeddb-rehearsal.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  } finally { await context.close(); }
});
