// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { HistoryApplication } from './history-application';
import { MemoryEventStore } from '../persistence/event-store';
import { historyFixture06d2 } from '../testing/history-fixture06d2';
describe('06-E1 history owner read APIs', () => {
  it('E1H01 new product has no invented memory and neither read adds events', async () => {
    const store = new MemoryEventStore(), app = await HistoryApplication.open(store), before = await store.load();
    expect((await app.readPersonalMemory()).units).toEqual([]);
    expect(Object.keys((await app.readAdaptiveSchedule()).units)).toEqual([]);
    expect(await store.load()).toEqual(before);
  });
  it('E1H02 reads are reproducible across reopen without adopting corrected state or opening gates', async () => {
    const store = new MemoryEventStore(); await store.replace(historyFixture06d2().events, 0);
    const app = await HistoryApplication.open(store), at = new Date(), before = await store.load();
    const memory = await app.readPersonalMemory(at), schedule = await app.readAdaptiveSchedule();
    const reopened = await HistoryApplication.open(store);
    expect(await reopened.readPersonalMemory(at)).toEqual(memory);
    expect(await reopened.readAdaptiveSchedule()).toEqual(schedule);
    expect(schedule.executable).toBe(false); expect(schedule.migrated).toBe(false);
    expect(app.product.releaseGates.every(g => g.status !== 'passed')).toBe(true);
    expect(await store.load()).toEqual(before);
  });
  it('E1H03 failed reads do not acknowledge defaults or change raw facts', async () => {
    const root = new MemoryEventStore(); let failed = false;
    const store = { load: async () => { if (failed) throw Error('synthetic-read-failed'); return root.load(); },
      append: root.append.bind(root), replace: root.replace.bind(root), clear: root.clear.bind(root), close: () => undefined };
    const app = await HistoryApplication.open(store), before = await root.load(); failed = true;
    await expect(app.readPersonalMemory()).rejects.toThrow('synthetic-read-failed');
    await expect(app.readAdaptiveSchedule()).rejects.toThrow('synthetic-read-failed');
    expect(await root.load()).toEqual(before);
  });
});
