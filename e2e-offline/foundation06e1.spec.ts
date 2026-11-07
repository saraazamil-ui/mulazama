import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let harness = '';
test.beforeAll(async () => {
  const { build } = await import(createRequire(require.resolve('vite')).resolve('esbuild'));
  const compiled = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { IndexedDbEventStore } from './src/persistence/event-store';
    import { historyFixture06d2 } from './src/testing/history-fixture06d2';
    import { HistoryApplication } from './src/application/history-application';
    export async function seed() {
      const store = await IndexedDbEventStore.open('mulazama-learning-v1');
      try { return await store.replace(historyFixture06d2().events, (await store.load()).revision); }
      finally { store.close(); }
    }
    export async function read(at) {
      const store = await IndexedDbEventStore.open('mulazama-learning-v1'), app = await HistoryApplication.open(store);
      try { const before = await store.load(); return { before, memory: await app.readPersonalMemory(new Date(at)),
        scheduling: await app.readAdaptiveSchedule(), after: await store.load(), gates: app.product.releaseGates }; }
      finally { app.close(); }
    }
  ` }, bundle: true, format: 'iife', platform: 'browser', globalName: '__e1QA',
    define: { 'import.meta.env.MODE': '"production"' }, write: false, logLevel: 'silent' });
  harness = compiled.outputFiles[0].text;
});

test('06-E1 personal memory and corrected core reproduce offline in a reopened encrypted store while the built app keeps sessions blocked', async ({ page, context }, info) => {
  await page.goto('/#S14');
  await expect(page.getByRole('region', { name: 'ملخص التقدم' })).toBeVisible();
  // Engineering source harness executes in a NEW test context only; it neither
  // ships in the app nor supplies a learning execution capability.
  await page.addScriptTag({ content: harness });
  const raw = await page.evaluate(() => (window as any).__e1QA.seed());
  const at = new Date().toISOString();
  const online = await page.evaluate(at => (window as any).__e1QA.read(at), at);
  expect(online.before).toEqual(raw); expect(online.after).toEqual(raw);
  expect(online.scheduling.executable).toBe(false); expect(online.scheduling.migrated).toBe(false);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  const reopened = await context.newPage();
  await reopened.goto('http://127.0.0.1:4174/#S14');
  await expect(reopened.locator('.progress-attempts li')).toHaveCount(1);
  await reopened.addScriptTag({ content: harness });
  const offline = await reopened.evaluate(at => (window as any).__e1QA.read(at), at);
  expect(offline).toEqual(online);
  expect(offline.memory.units[0].documentedMemorization.at).toBeNull();
  expect(offline.scheduling.units['synthetic-history-unit'].memory.algorithmVersion).toBe('hme-fsrs6-ts542-round8-0.1.0');
  expect(offline.gates.every((gate: any) => gate.status !== 'passed')).toBe(true);
  await reopened.goto('http://127.0.0.1:4174/#S07');
  await expect(reopened.getByRole('heading', { name: 'النص المعتمد ينتظر الإضافة' })).toBeVisible();
  await info.attach('E1-offline-memory-receipt', { body: JSON.stringify({
    networkDisabled: true, rawEvents: raw.events.length, rawUnchanged: true,
    deterministicMemoryAndCorrectedCore: true, executable: false, migrated: false,
    harness: 'source module compiled into test only; actual built app shell and IndexedDB reopened offline',
  }), contentType: 'application/json' });
});
