import { describe, expect, it } from 'vitest';
import { VERSIONS, type LearningEvent } from '../core/types';
import { commandIndexMigrationDecision, compareEventIdUtf16, MemoryEventStore, validateEvent, type CommandIndexRow } from './event-store';

function event(id = 'e1'): LearningEvent {
  return { eventId: id, commandId: id, operationId: id, userId: 'synthetic-05b', unitId: null,
    type: 'SessionStarted', occurredAt: '2026-11-05T10:00:00.000Z', receivedAt: '2026-11-05T10:00:00.000Z',
    zoneId: 'Asia/Riyadh', source: 'product', coverage: [], versions: VERSIONS, data: { confirmed: true } };
}

describe('05B persistent-envelope regressions (reference store, not browser IndexedDB)', () => {
  it.each(['2026-02-30T10:00:00.000Z', '2026-11-05T24:00:00.000Z', '2025-02-29T10:00:00Z'])(
    'P05B01 rejects impossible UTC instants atomically: %s', async occurredAt => {
      const store = new MemoryEventStore();
      await expect(store.append([{ ...event(), occurredAt }], 0)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      expect(await store.load()).toEqual({ revision: 0, events: [] });
    });
  it('P05B02 rejects accessor data without invoking it or persisting a changed value', async () => {
    let reads = 0; const data = { get confirmed() { reads++; return reads; } };
    const store = new MemoryEventStore();
    await expect(store.append([{ ...event(), data }], 0)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(reads).toBe(0); expect((await store.load()).events).toHaveLength(0);
  });
  it.each([
    () => { const values = [1]; values[2] = 3; return { values }; },
    () => { const values = [1] as number[] & { note?: string }; values.note = 'not in JSON'; return { values }; },
    () => Object.defineProperty({ confirmed: true }, 'hidden', { value: 'not in JSON', enumerable: false }),
    () => ({ confirmed: true, [Symbol('hidden')]: 'not in JSON' }),
    () => JSON.parse('{"__proto__":{"admin":true}}') as Record<string, unknown>,
  ])('P05B03 rejects values that cannot round-trip as safe plain JSON', data => {
    expect(() => validateEvent({ ...event(), data: data() })).toThrowError(/JSON/);
  });
  it('P05B04 accepts leap-day timestamps and all supported fractional precisions unchanged', async () => {
    for (const occurredAt of ['2024-02-29T10:00:00Z', '2024-02-29T10:00:00.1Z', '2024-02-29T10:00:00.12Z', '2024-02-29T10:00:00.123Z']) {
      const store = new MemoryEventStore(); await store.append([{ ...event(), occurredAt }], 0);
      expect((await store.load()).events[0].occurredAt).toBe(occurredAt);
    }
  });
  it('P05B05 durable ordering is UTF-16 and independent of human-language collation', () => {
    const ids = ['id-z', 'id-ä', 'id-ا', 'id-a', 'id-2', 'id-10'];
    expect([...ids].sort(compareEventIdUtf16)).toEqual(['id-10', 'id-2', 'id-a', 'id-z', 'id-ä', 'id-ا']);
    expect(['id-z', 'id-ä'].sort((a, b) => a.localeCompare(b, 'en'))).not.toEqual(['id-z', 'id-ä'].sort(compareEventIdUtf16));
    expect(compareEventIdUtf16('same', 'same')).toBe(0);
  });
  const row = (commandId: string, fingerprint = 'authenticated-old-index'): CommandIndexRow => ({ commandId, fingerprint, eventIds: [commandId] });
  it('P05B06 permits a proven old index despite object-store key order', () => {
    const old = [row('b'), row('a')];
    expect(commandIndexMigrationDecision([event('a'), event('b')], old, [...old].reverse())).toBe('migrate');
  });
  it('P05B07 flags an unproven Unicode legacy index for manual shadow review', () => {
    expect(commandIndexMigrationDecision([event('id-ä')], [row('command', 'old-locale')], [row('command', 'current-locale')])).toBe('review-required');
  });
  it('P05B08 never regenerates a mismatched baseline UUID index as if proven valid', () => {
    expect(commandIndexMigrationDecision([event('84b9475e-05be-423b-a874-d383fe10ca03')], [row('command', 'changed')], [row('command')])).toBe('corrupt');
  });
  it('P05B09 treats unknown ASCII mixed-case collation as a review case too', () => {
    expect(commandIndexMigrationDecision([event('id-I'), event('id-i')], [row('command', 'old-collation')], [row('command')])).toBe('review-required');
  });
});
