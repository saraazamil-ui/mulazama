import { test, expect } from '@playwright/test';

test('V211 storage commits events, checkpoint, receipt and outbox atomically; retries and conflicts preserve history', async ({ page }) => {
  await page.goto('/v211.html');
  const result = await page.evaluate(async () => {
    const { IndexedDbProductStore } = await import('/src/persistence/product-v211-store.ts');
    const name = 'mulazama-v211-synthetic-storage-' + crypto.randomUUID();
    const first = await IndexedDbProductStore.open(name);
    const command = (revision: number, id: string, payloadHash = id) => ({
      expectedRevision: revision - 1,
      state: { revision, count: revision },
      event: { id: 'event-' + id, revision },
      receipt: { commandId: id, eventIds: ['event-' + id], revision, durability: 'local' as const },
      payloadHash,
    });
    const one = command(1, 'one');
    const receipt = await first.commit(one);
    const retry = await first.commit(one);
    let changedPayload = '';
    try { await first.commit({ ...one, payloadHash: 'changed' }); }
    catch (error) { changedPayload = (error as Error).message; }
    first.close();
    const reopened = await IndexedDbProductStore.open(name);
    const restored = await reopened.load();
    const competing = await IndexedDbProductStore.open(name);
    const race = await Promise.allSettled([reopened.commit(command(2, 'two')), competing.commit(command(2, 'competing'))]);
    const afterRace = await reopened.load();
    const duplicate = command(3, 'duplicate');
    duplicate.event.id = 'event-one';
    duplicate.receipt.eventIds = ['event-one'];
    let duplicateRejected = false;
    try { await reopened.commit(duplicate); } catch { duplicateRejected = true; }
    const afterAbort = await reopened.load();
    let legacyRejected = false;
    try { await IndexedDbProductStore.open('mulazama-production'); } catch { legacyRejected = true; }
    reopened.close(); competing.close();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
    });
    return { receipt, retry, changedPayload, restored, race: race.map(item => ({ status: item.status, error: item.status === 'rejected' ? String(item.reason.message) : null })), afterRace, duplicateRejected, afterAbort, legacyRejected };
  });
  expect(result.retry).toEqual(result.receipt);
  expect(result.changedPayload).toBe('IDEMPOTENCY_CONFLICT');
  expect(result.restored.state).toEqual({ revision: 1, count: 1 });
  expect(result.restored.events).toHaveLength(1);
  expect(result.restored.outbox).toEqual([{ commandId: 'one', payloadHash: 'one', status: 'pending', attemptCount: 0 }]);
  expect(result.race.filter(item => item.status === 'fulfilled')).toHaveLength(1);
  expect(result.race.filter(item => item.error === 'REVISION_CONFLICT')).toHaveLength(1);
  expect(result.afterRace.events).toHaveLength(2);
  expect(result.afterRace.outbox).toHaveLength(2);
  expect(Object.keys(result.afterRace.receipts)).toHaveLength(2);
  expect(result.duplicateRejected).toBe(true);
  expect(result.afterAbort).toEqual(result.afterRace);
  expect(result.legacyRejected).toBe(true);
});
