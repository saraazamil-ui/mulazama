import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

// This harness is compiled in the test process and injected ONLY into a fresh
// Playwright context. It is never a production entry point or authorization.
const require = createRequire(import.meta.url);
let harness = '';
test.beforeAll(async () => {
  const { build } = await import(createRequire(require.resolve('vite')).resolve('esbuild'));
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { IndexedDbEventStore } from './src/persistence/event-store';
    import { historyFixture06d2 } from './src/testing/history-fixture06d2';
    import { replayHistory } from './src/application/history-application';
    const name = 'mulazama-learning-v1';
    export async function seed() {
      const store = await IndexedDbEventStore.open(name);
      try { const before = await store.load(); const next = historyFixture06d2(); replayHistory(next); return await store.replace(next.events, before.revision); }
      finally { store.close(); }
    }
    export async function read() {
      const store = await IndexedDbEventStore.open(name);
      try { const value = await store.load(); replayHistory(value); return value; }
      finally { store.close(); }
    }
    export async function correct() {
      const store = await IndexedDbEventStore.open(name);
      try {
        const before = await store.load(), prior = before.events.find(e => e.type === 'AssessmentSubmitted');
        const command = { type: 'AssessmentCorrected', attemptId: 'synthetic-history-attempt', expectedAssessmentRevision: 1,
          reason: 'Offline QA correction', observation: { completion: 'partial', attemptedWords: 5, errors: 1, effort: 'normal', gapVerified: false } };
        const at = new Date().toISOString(), id = 'synthetic-offline-correction';
        const event = { ...prior, eventId: id, commandId: id, operationId: id, type: command.type,
          occurredAt: at, receivedAt: at, data: { scope: 'hme', command } };
        replayHistory({ revision: before.revision + 1, events: [...before.events, event] });
        await store.append([event], before.revision);
        // Retrying the identical committed command must not create another row.
        return await store.append([event], before.revision);
      } finally { store.close(); }
    }
  ` }, bundle: true, platform: 'browser', format: 'iife', globalName: '__historyQA',
    define: { 'import.meta.env.MODE': '"production"' }, write: false, logLevel: 'silent' });
  harness = result.outputFiles[0].text;
});

test('06-D2 encrypted aggregate history and correction survive genuine offline reload without opening a blocked session', async ({ page, context }, testInfo) => {
  await page.goto('/#S14');
  await expect(page.getByRole('region', { name: 'ملخص التقدم' })).toBeVisible();
  await page.addScriptTag({ content: harness });
  const seeded = await page.evaluate(() => (window as any).__historyQA.seed());
  expect(seeded.events).toHaveLength(7);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(page.locator('.progress-totals div').last()).toHaveText('إجمالي الجلسات بتسميع مكتمل١');
  await context.setOffline(true);
  const offline = await context.newPage();
  await offline.goto('http://127.0.0.1:4174/#S14');
  await expect(offline.locator('.progress-totals div').last()).toHaveText('إجمالي الجلسات بتسميع مكتمل١');
  await expect(offline.getByRole('progressbar')).toHaveCount(0);
  await offline.addScriptTag({ content: harness });
  const original = await offline.evaluate(() => (window as any).__historyQA.read());
  expect(original).toEqual(seeded);
  const corrected = await offline.evaluate(() => (window as any).__historyQA.correct());
  expect(corrected.events).toHaveLength(8);
  expect(corrected.events.slice(0, 7)).toEqual(seeded.events);
  await offline.reload();
  await expect(offline.locator('.progress-totals div').last()).toHaveText('إجمالي الجلسات بتسميع مكتمل٠');
  await expect(offline.getByText('جزئي بحسب البلاغ', { exact: true })).toBeVisible();
  await offline.goto('http://127.0.0.1:4174/#S17');
  await offline.getByRole('checkbox', { name: 'تكبير النص' }).click();
  await expect(offline.getByRole('checkbox', { name: 'تكبير النص' })).toBeChecked();
  await offline.reload();
  await expect(offline.getByRole('checkbox', { name: 'تكبير النص' })).toBeChecked();
  await offline.addScriptTag({ content: harness });
  const final = await offline.evaluate(() => (window as any).__historyQA.read());
  expect(final.events).toHaveLength(9);
  expect(final.events.slice(0, 8)).toEqual(corrected.events);
  await offline.goto('http://127.0.0.1:4174/#S07');
  await expect(offline.getByText('النص المعتمد ينتظر الإضافة')).toBeVisible();
  await testInfo.attach('offline-history-receipt.json', { body: JSON.stringify({
    syntheticDataOnly: true, networkDisabled: true, initialEvents: seeded.events.length,
    correctedEvents: corrected.events.length, finalEvents: final.events.length,
    priorEventsUnchanged: true, repeatedCorrectionCountedOnce: true, blockedSession: true,
  }, null, 2), contentType: 'application/json' });
});
