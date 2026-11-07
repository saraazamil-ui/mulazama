// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { VERSIONS, type EventSnapshot, type LearningEvent } from '../core/types';
import { MemoryEventStore } from './event-store';
import { exportEncryptedBackup, inspectEncryptedBackup, restoreEncryptedBackup, validateBackupSnapshot } from './backup';

const password = 'local-only-recovery-secret';
function event(id = 'original'): LearningEvent {
  return { eventId: id, commandId: `command-${id}`, operationId: `command-${id}`, userId: 'private-local-profile', unitId: null,
    type: 'UserPlanConfigRevision', occurredAt: '2026-11-05T10:00:00.000Z', receivedAt: '2026-11-05T10:00:00.000Z',
    zoneId: 'Asia/Riyadh', source: 'product', coverage: [], versions: VERSIONS, data: { minutes: 30, note: 'private-learning-data' } };
}
const snapshot: EventSnapshot = { revision: 4, events: [event()] };
let encrypted: string;
beforeAll(async () => { encrypted = await exportEncryptedBackup(snapshot, password); });
describe('C12 authenticated portable backup', () => {
  it('B01 encrypts raw history and round-trips its identities, timestamps and versions', async () => {
    expect(encrypted).not.toContain('private-local-profile'); expect(encrypted).not.toContain('private-learning-data');
    const inspection = await inspectEncryptedBackup(encrypted, password);
    expect(inspection.snapshot).toEqual(snapshot); expect(inspection.eventCount).toBe(1);
    expect(inspection.encrypted).toBe(true); expect(inspection.replacementOnly).toBe(true);
    expect(inspection.payloadHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('B02 never mutates live history for a wrong recovery secret', async () => {
    const store = new MemoryEventStore(), live = await store.append([event('live')], 0);
    await expect(restoreEncryptedBackup(store, encrypted, 'wrong-secret-at-least-12', { confirmed: true, expectedRevision: live.revision, validateReplay: () => undefined }))
      .rejects.toMatchObject({ code: 'CONTENT_INTEGRITY_FAILURE' });
    expect(await store.load()).toEqual(live);
  });
  it('B03 detects ciphertext tampering before the replacement boundary', async () => {
    const parsed = JSON.parse(encrypted); parsed.ciphertext = (parsed.ciphertext[0] === 'A' ? 'B' : 'A') + parsed.ciphertext.slice(1);
    await expect(inspectEncryptedBackup(JSON.stringify(parsed), password)).rejects.toMatchObject({ code: 'CONTENT_INTEGRITY_FAILURE' });
  });
  it('B04 authenticates header metadata as well as encrypted event bytes', async () => {
    const parsed = JSON.parse(encrypted); parsed.createdAt = '2026-11-06T12:00:00.000Z';
    await expect(inspectEncryptedBackup(JSON.stringify(parsed), password)).rejects.toMatchObject({ code: 'CONTENT_INTEGRITY_FAILURE' });
  });
  it('B05 rejects a truncated file and unsupported protection versions', async () => {
    await expect(inspectEncryptedBackup(encrypted.slice(0, -8), password)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const parsed = JSON.parse(encrypted); parsed.version = 2;
    await expect(inspectEncryptedBackup(JSON.stringify(parsed), password)).rejects.toMatchObject({ code: 'UNSUPPORTED_VERSION' });
    parsed.version = 1; parsed.iterations = 2_000_000_000;
    await expect(inspectEncryptedBackup(JSON.stringify(parsed), password)).rejects.toMatchObject({ code: 'UNSUPPORTED_VERSION' });
  });
  it('B06 duplicate identities and unavailable model/content versions cannot be imported', () => {
    expect(() => validateBackupSnapshot({ ...snapshot, events: [event(), event()] })).toThrow();
    expect(() => validateBackupSnapshot({ ...snapshot, events: [{ ...event(), versions: { ...VERSIONS, model: 'FSRS-7' } }] })).toThrow();
    expect(() => validateBackupSnapshot({ ...snapshot, events: [{ ...event(), versions: { ...VERSIONS, content: 'unapproved-content' } }] })).toThrow();
    expect(() => validateBackupSnapshot({ ...snapshot, events: [{ ...event(), occurredAt: '2026-02-30T10:00:00.000Z' }] })).toThrow();
  });
  it('B07 restoration requires explicit full replacement confirmation', async () => {
    const store = new MemoryEventStore();
    await expect(restoreEncryptedBackup(store, encrypted, password, { confirmed: false, expectedRevision: 0, validateReplay: () => undefined }))
      .rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
    expect((await store.load()).events).toHaveLength(0);
  });
  it('B08 replaces instead of merging and a repeated restore does not duplicate events', async () => {
    const store = new MemoryEventStore(); const live = await store.append([event('live')], 0);
    const replay = vi.fn((value: EventSnapshot) => { expect(value.events).toEqual(snapshot.events); });
    const first = await restoreEncryptedBackup(store, encrypted, password, { confirmed: true, expectedRevision: live.revision, validateReplay: replay });
    expect(first.events).toEqual(snapshot.events); expect(first.events.some(e => e.eventId === 'live')).toBe(false);
    const second = await restoreEncryptedBackup(store, encrypted, password, { confirmed: true, expectedRevision: first.revision, validateReplay: replay });
    expect(second).toEqual(first); expect(replay).toHaveBeenCalledTimes(2);
  });
  it('B09 failed event replay does not start a replacement', async () => {
    const store = new MemoryEventStore(); const live = await store.append([event('live')], 0);
    await expect(restoreEncryptedBackup(store, encrypted, password, { confirmed: true, expectedRevision: live.revision,
      validateReplay: () => { throw new Error('unknown event type'); } })).rejects.toThrow('unknown event type');
    expect(await store.load()).toEqual(live);
  });
  it('B10 failed atomic write retains the entire previous dataset', async () => {
    let failWrite = false;
    const store = new MemoryEventStore(() => { if (failWrite) throw new Error('disk full'); });
    const live = await store.append([event('live')], 0); failWrite = true;
    await expect(restoreEncryptedBackup(store, encrypted, password, { confirmed: true, expectedRevision: live.revision, validateReplay: () => undefined })).rejects.toThrow('disk full');
    expect(await store.load()).toEqual(live);
  });
  it('B11 a concurrent write after inspection is protected by the current revision', async () => {
    const store = new MemoryEventStore(); const live = await store.append([event('live')], 0);
    await expect(restoreEncryptedBackup(store, encrypted, password, { confirmed: true, expectedRevision: live.revision,
      validateReplay: async () => { await store.append([event('concurrent')], live.revision); } })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect((await store.load()).events.map(e => e.eventId)).toEqual(['live', 'concurrent']);
  });
  it('B12 enforces the documented recovery secret constraint', async () => {
    await expect(exportEncryptedBackup(snapshot, 'short')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  it('B13 fresh salt and nonce prevent deterministic ciphertext for identical snapshots', async () => {
    const another = JSON.parse(await exportEncryptedBackup(snapshot, password)), first = JSON.parse(encrypted);
    expect(another.salt).not.toBe(first.salt); expect(another.iv).not.toBe(first.iv); expect(another.ciphertext).not.toBe(first.ciphertext);
  });
});
