import { describe, expect, it } from 'vitest';
import { VERSIONS, type LearningEvent } from '../core/types';
import { MemoryEventStore, validateEvent } from './event-store';

function event(id = 'e1', commandId = 'c1'): LearningEvent {
  return { eventId: id, commandId, operationId: commandId, userId: 'local-user', unitId: null,
    type: 'SessionStarted', occurredAt: '2026-11-05T10:00:00.000Z', receivedAt: '2026-11-05T10:00:00.000Z',
    zoneId: 'Asia/Riyadh', source: 'product', coverage: [], versions: VERSIONS, data: { confirmed: true } };
}

describe('transactional reference event store', () => {
  it('ES01 records a committed batch exactly once even on a stale retry', async () => {
    const s = new MemoryEventStore(); const events = [event(), event('e2')];
    const first = await s.append(events, 0);
    expect(first.revision).toBe(1); expect(first.events).toHaveLength(2);
    expect(await s.append(events, 0)).toEqual(first);
  });
  it('ES02 rejects changed event content and preserves raw history', async () => {
    const s = new MemoryEventStore(); const first = await s.append([event()], 0);
    await expect(s.append([{ ...event(), data: { confirmed: false } }], 1)).rejects.toMatchObject({ code: 'EVENT_CONFLICT' });
    expect(await s.load()).toEqual(first);
  });
  it('ES03 rejects a command retried with a new event identity', async () => {
    const s = new MemoryEventStore(); await s.append([event()], 0);
    await expect(s.append([event('another-event')], 1)).rejects.toMatchObject({ code: 'EVENT_CONFLICT' });
  });
  it('ES04 accepts unique future commands only at the current revision', async () => {
    const s = new MemoryEventStore(); await s.append([event()], 0);
    await expect(s.append([event('e2', 'c2')], 0)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect((await s.load()).events).toHaveLength(1);
  });
  it('ES05 failure before commit does not publish counters or events', async () => {
    const s = new MemoryEventStore(() => { throw new Error('simulated media failure'); });
    await expect(s.append([event()], 0)).rejects.toThrow('simulated media failure');
    expect(await s.load()).toEqual({ revision: 0, events: [] });
  });
  it('ES06 snapshots and inputs cannot mutate stored events', async () => {
    const s = new MemoryEventStore(), input = event(); await s.append([input], 0);
    input.data.confirmed = false; const first = await s.load(); first.events[0].data.confirmed = false;
    expect((await s.load()).events[0].data.confirmed).toBe(true);
  });
  it('ES07 validates every event before an atomic append', async () => {
    const s = new MemoryEventStore();
    await expect(s.append([event(), { ...event('e2', 'c2'), occurredAt: 'invalid' }], 0)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect((await s.load()).events).toHaveLength(0);
  });
  it('ES08 restore is a replacement and retry cannot merge or duplicate', async () => {
    const s = new MemoryEventStore(); await s.append([event()], 0);
    const restored = await s.replace([event('restored', 'restored-command')], 1);
    expect(restored.events.map(e => e.eventId)).toEqual(['restored']);
    expect(await s.replace(restored.events, restored.revision)).toEqual(restored);
  });
  it('ES09 duplicate identities in a restore are rejected before mutation', async () => {
    const s = new MemoryEventStore(); const first = await s.append([event()], 0);
    await expect(s.replace([event('e2', 'c2'), event('e2', 'c2')], 1)).rejects.toMatchObject({ code: 'EVENT_CONFLICT' });
    expect(await s.load()).toEqual(first);
  });
  it('ES10 failed restore preserves previous complete dataset', async () => {
    let fail = false; const s = new MemoryEventStore(() => { if (fail) throw new Error('write failed'); });
    const first = await s.append([event()], 0); fail = true;
    await expect(s.replace([event('restored', 'restore')], 1)).rejects.toThrow('write failed');
    expect(await s.load()).toEqual(first);
  });
  it('ES11 deletion has revision protection and removes the raw stream', async () => {
    const s = new MemoryEventStore(); await s.append([event()], 0);
    await expect(s.clear(0)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await s.clear(1); expect(await s.load()).toEqual({ revision: 2, events: [] });
  });
  it('ES12 a closed store never silently falls back to volatile memory', async () => {
    const s = new MemoryEventStore(); s.close(); await expect(s.load()).rejects.toMatchObject({ code: 'WRITE_NOT_CONFIRMED' });
  });
  it.each([NaN, Infinity, undefined, new Date(), () => true])('ES13 rejects non-JSON event data (%s)', bad => {
    expect(() => validateEvent({ ...event(), data: { bad } })).toThrow();
  });
  it('ES14 rejects cyclic data, invalid timezones, unsupported schema', () => {
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    expect(() => validateEvent({ ...event(), data: cyclic })).toThrow();
    expect(() => validateEvent({ ...event(), zoneId: 'Invalid/Zone' })).toThrow();
    expect(() => validateEvent({ ...event(), versions: { ...VERSIONS, schema: 2 } })).toThrow();
  });
});
