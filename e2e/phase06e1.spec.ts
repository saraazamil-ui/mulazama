import { test, expect, type Page } from '@playwright/test';
async function seed(page: Page) {
  await page.goto('/#S14');
  await expect(page.getByRole('region', { name: 'ملخص التقدم' })).toBeVisible();
  const raw = await page.evaluate(async () => {
    const { IndexedDbEventStore } = await import(/* @vite-ignore */ '/src/persistence/event-store.ts');
    const { historyFixture06d2 } = await import(/* @vite-ignore */ '/src/testing/history-fixture06d2.ts');
    const store = await IndexedDbEventStore.open('mulazama-development-learning-v1');
    try { return await store.replace(historyFixture06d2().events, (await store.load()).revision); }
    finally { store.close(); }
  });
  await page.reload();
  await expect(page.locator('.progress-attempts li')).toHaveCount(1);
  return raw;
}
async function inspect(page: Page, at: string) {
  return page.evaluate(async at => {
    const { HistoryApplication, replayHistory } = await import(/* @vite-ignore */ '/src/application/history-application.ts');
    const { IndexedDbEventStore } = await import(/* @vite-ignore */ '/src/persistence/event-store.ts');
    const store = await IndexedDbEventStore.open('mulazama-development-learning-v1');
    const owner = await HistoryApplication.open(store);
    try {
      const before = await store.load();
      return { memory: await owner.readPersonalMemory(new Date(at)), shadow: await owner.readAdaptiveSchedule(),
        legacy: replayHistory(before).learning, before, after: await store.load(),
        gates: owner.product.releaseGates, executionMethods: 'learning' in owner || 'adapter' in owner };
    } finally { owner.close(); }
  }, at);
}

test('E1WEB01 personal memory and corrected scheduling rebuild are deterministic on real encrypted IndexedDB without rewriting legacy history', async ({ page }, info) => {
  const seeded = await seed(page), at = new Date().toISOString(), first = await inspect(page, at);
  expect(first.before).toEqual(seeded); expect(first.after).toEqual(seeded);
  expect(first.memory.units[0].counts.attempts).toBe(1);
  expect(first.memory.units[0].documentedMemorization.status).toBe('unavailable');
  expect(first.memory.units[0].scheduling.futureSchedule).toBe('unavailable');
  expect(first.shadow.executable).toBe(false); expect(first.shadow.migrated).toBe(false);
  expect(first.shadow.units['synthetic-history-unit'].memory.algorithmVersion).toBe('hme-fsrs6-ts542-round8-0.1.0');
  expect(first.legacy.units['synthetic-history-unit'].memory.algorithmVersion).toBe('hme-fsrs6-research-binary64-0.1.0');
  expect(first.executionMethods).toBe(false);
  expect(first.gates.every((gate: any) => gate.status !== 'passed')).toBe(true);
  await page.reload();
  expect(await inspect(page, at)).toEqual(first);
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await info.attach('E1-browser-rebuild.json', { body: JSON.stringify({ unchangedRawEvents: seeded.events.length,
    deterministic: true, historicalVersionPreserved: true, correctedVersionSeparate: true, executable: false }), contentType: 'application/json' });
});

test('E1WEB02 corrected assessment and duplicate transport rebuild memory once at original review time', async ({ page }, info) => {
  const seeded = await seed(page);
  const result = await page.evaluate(async () => {
    const { IndexedDbEventStore } = await import(/* @vite-ignore */ '/src/persistence/event-store.ts');
    const store = await IndexedDbEventStore.open('mulazama-development-learning-v1');
    try {
      const before = await store.load(), source = before.events.at(-1), at = new Date().toISOString(), id = 'synthetic-e1-correction';
      const event = { ...source, eventId: id, commandId: id, operationId: id, type: 'AssessmentCorrected',
        occurredAt: at, receivedAt: at, data: { scope: 'hme', command: { type: 'AssessmentCorrected', attemptId: 'synthetic-history-attempt',
          expectedAssessmentRevision: 1, reason: 'Synthetic E1 correction', observation: { completion: 'complete', attemptedWords: 10, errors: 0, effort: 'normal', gapVerified: false } } } };
      const committed = await store.append([event], before.revision), retry = await store.append([event], before.revision);
      return { committed, retry };
    } finally { store.close(); }
  });
  expect(result.committed).toEqual(result.retry); expect(result.committed.events.slice(0, 7)).toEqual(seeded.events);
  const after = await inspect(page, new Date().toISOString());
  const unit = after.shadow.units['synthetic-history-unit'];
  expect(unit.reviews).toHaveLength(1); expect(unit.reviews[0].effectiveRating).toBe(3);
  expect(unit.reviews[0].at).toBe(seeded.events.find((event: any) => event.type === 'RecallAttemptStarted').occurredAt);
  expect(after.memory.units[0].counts.corrections).toBe(1);
  expect(after.memory.units[0].attempts[0].assessmentHistory).toHaveLength(2);
  expect(after.before).toEqual(result.committed); expect(after.after).toEqual(result.committed);
  await page.goto('/#S08');
  await expect(page.getByRole('heading', { name: 'النص المعتمد ينتظر الإضافة' })).toBeVisible();
  await info.attach('E1-browser-correction.json', { body: JSON.stringify({ events: 8, correctedReviews: 1,
    rating: unit.reviews[0].effectiveRating, at: unit.reviews[0].at, duplicateCounted: false, rawUnchanged: true }), contentType: 'application/json' });
});
