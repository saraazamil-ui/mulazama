import {describe, expect, it} from 'vitest';
import {IndexedDbProductStore, MemoryProductStore, type ProductCommit} from './product-v211-store';

type State = {revision: number; count: number};
type Event = {id: string; revision: number; amount: number};
const write = (revision = 1, commandId = `command-${revision}`): ProductCommit<State, Event> => ({
  expectedRevision: revision - 1,
  state: {revision, count: revision},
  event: {id: `event-${revision}`, revision, amount: 1},
  receipt: {commandId, eventIds: [`event-${revision}`], revision, durability: 'local'},
  payloadHash: `payload-${revision}`,
});

describe('V2.1.1 local product journal', () => {
  it('commits event, projection, local receipt and pending outbox together', async () => {
    const store = new MemoryProductStore<State, Event>();
    expect(await store.load()).toEqual({state: null, events: [], receipts: {}, outbox: []});
    const input = write();
    await store.commit(input);
    expect(await store.load()).toEqual({
      state: input.state, events: [input.event], receipts: {'command-1': input.receipt},
      outbox: [{commandId: 'command-1', payloadHash: 'payload-1', status: 'pending', attemptCount: 0}],
    });
  });

  it('replays the same receipt after lost acknowledgement without a duplicate event', async () => {
    const store = new MemoryProductStore<State, Event>();
    const first = await store.commit(write());
    await store.commit(write(2));
    expect(await store.commit(write())).toEqual(first);
    expect((await store.load()).events).toHaveLength(2);
  });

  it('rejects a reused command with changed payload and leaves every record intact', async () => {
    const store = new MemoryProductStore<State, Event>();
    await store.commit(write());
    const before = await store.load();
    await expect(store.commit({...write(), payloadHash: 'different'})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    expect(await store.load()).toEqual(before);
  });

  it('accepts only one of two stale concurrent writers', async () => {
    const store = new MemoryProductStore<State, Event>();
    const result = await Promise.allSettled([store.commit(write()), store.commit(write(1, 'other-command'))]);
    expect(result.map(item => item.status)).toEqual(['fulfilled', 'rejected']);
    expect((result[1] as PromiseRejectedResult).reason.message).toBe('REVISION_CONFLICT');
    const snapshot = await store.load();
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.outbox).toHaveLength(1);
  });

  it('isolates committed records from caller and reader mutation', async () => {
    const store = new MemoryProductStore<State, Event>();
    const input = write();
    const receipt = await store.commit(input);
    input.state.count = 900;
    input.event.amount = 900;
    receipt.eventIds.push('forged');
    const read = await store.load();
    read.state!.count = 1000;
    read.events[0].amount = 1000;
    expect((await store.load()).state).toEqual({revision: 1, count: 1});
    expect((await store.load()).events[0].amount).toBe(1);
    expect((await store.load()).receipts['command-1'].eventIds).toEqual(['event-1']);
  });

  it('rejects mismatched receipt and event revisions before any write', async () => {
    const store = new MemoryProductStore<State, Event>();
    const input = write();
    input.receipt.eventIds = ['wrong-event'];
    await expect(store.commit(input)).rejects.toThrow('INVALID_INPUT');
    expect((await store.load()).events).toHaveLength(0);
  });

  it('refuses legacy or arbitrary database identities', async () => {
    await expect(IndexedDbProductStore.open('mulazama-production')).rejects.toThrow('INVALID_SYNTHETIC_DATABASE');
    await expect(IndexedDbProductStore.open('mulazama-engineering-06l3-123')).rejects.toThrow('INVALID_SYNTHETIC_DATABASE');
  });
});
