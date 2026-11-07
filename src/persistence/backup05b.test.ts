// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { canonical, VERSIONS, LEARNING_VERSIONS, type EventSnapshot, type LearningEvent } from '../core/types';
import { LearningApplication, replayLearning } from '../application/learning';
import { createSyntheticLearningAccess } from '../testing/learning-access';
import { exportEncryptedBackup, inspectEncryptedBackup, restoreEncryptedBackup, validateBackupSnapshot } from './backup';
import { MemoryEventStore } from './event-store';

const secret = 'portable-backup-secret-05b';
const encoder = new TextEncoder();
const event = (): LearningEvent => ({ eventId: 'event-05b', commandId: 'command-05b', operationId: 'command-05b',
  userId: 'local-user', unitId: null, type: 'SyntheticTestEvent', occurredAt: '2026-11-05T10:00:00.000Z',
  receivedAt: '2026-11-05T10:00:00.000Z', zoneId: 'Asia/Riyadh', source: 'product', coverage: [], versions: VERSIONS, data: { marker: 'synthetic test data' } });
const snapshot = (): EventSnapshot => ({ revision: 1, events: [event()] });
let encrypted: string;
beforeAll(async () => { encrypted = await exportEncryptedBackup(snapshot(), secret); });

// Creates authenticated invalid input with a known test password. This checks the import parser,
// rather than attributing a schema rejection to a failed GCM tag on tampered ciphertext.
async function authenticatedFile(plaintext: Uint8Array): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
  const header = { format: 'MULAZAMA-ENCRYPTED-BACKUP', version: 1, cipher: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256', iterations: 600_000, salt: b64(salt), iv: b64(iv), createdAt: '2026-11-05T10:00:00.000Z' };
  const base = await crypto.subtle.importKey('raw', encoder.encode(secret), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(canonical(header)), tagLength: 128 }, key, plaintext as Uint8Array<ArrayBuffer>);
  return JSON.stringify({ ...header, ciphertext: b64(new Uint8Array(ciphertext)) });
}

describe('05-B C12 schema preservation and fail-closed imports', () => {
  it.each([['Date', new Date('2026-11-05T10:00:00Z')], ['Map', new Map([['private-value', 7]])]])(
    'BK05B01 rejects %s payloads rather than silently exporting their value as {}', async (_name, value) => {
      const input = snapshot(); input.events[0].data.value = value;
      expect(() => validateBackupSnapshot(input)).toThrow();
      await expect(exportEncryptedBackup(input, secret)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    });
  it('BK05B02 rejects unsupported JSON values before producing a backup', async () => {
    for (const value of [undefined, () => 'not JSON', Number.NaN, Number.POSITIVE_INFINITY]) {
      const input = snapshot(); input.events[0].data.value = value;
      await expect(exportEncryptedBackup(input, secret)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
  });
  it('BK05B03 rejects cycles with a domain error rather than a stack overflow', async () => {
    const input = snapshot(); input.events[0].data.self = input.events[0].data;
    await expect(exportEncryptedBackup(input, secret)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  it('BK05B04 rejects unauthenticated additional file metadata', async () => {
    const file = JSON.parse(encrypted); file.scientificallyApproved = true;
    await expect(inspectEncryptedBackup(JSON.stringify(file), secret)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  it('BK05B05 accepts exact supported envelopes and rejects unknown snapshot fields or versions', () => {
    const supported = snapshot(); supported.events[0].versions = LEARNING_VERSIONS;
    expect(() => validateBackupSnapshot(supported)).not.toThrow();
    expect(() => validateBackupSnapshot({ ...supported, events: [{ ...supported.events[0], versions: { ...LEARNING_VERSIONS, applicationEvidence: 'unknown-evidence-version' } }] })).toThrow();
    expect(() => validateBackupSnapshot({ ...snapshot(), arbitraryMetadata: 'not in format 1' })).toThrow();
  });
  it('BK05B06 rejects malformed restore options before any replacement', async () => {
    const store = new MemoryEventStore(); const live = await store.append([event()], 0);
    await expect(restoreEncryptedBackup(store, encrypted, secret, undefined as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(await store.load()).toEqual(live);
  });
  it('BK05B07 rejects ill-formed UTF-16 recovery secrets rather than aliasing their bytes', async () => {
    await expect(exportEncryptedBackup(snapshot(), 'secret-05b-\ud800')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  it('BK05B08 counts recovery-secret Unicode code points', async () => {
    await expect(exportEncryptedBackup(snapshot(), '😀😀😀😀😀😀')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  it('BK05B09 rejects authenticated malformed UTF-8 before a replacement', async () => {
    const file = await authenticatedFile(new Uint8Array([0xc3, 0x28]));
    const store = new MemoryEventStore(); const live = await store.append([event()], 0);
    await expect(restoreEncryptedBackup(store, file, secret, { confirmed: true, expectedRevision: live.revision, validateReplay: () => undefined }))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(await store.load()).toEqual(live);
  });
  it('BK05B10 rejects unknown authenticated payloads and repeated HME commands before replacement', async () => {
    const value = snapshot();
    const payloadHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(canonical(value))))]
      .map(byte => byte.toString(16).padStart(2, '0')).join('');
    const file = await authenticatedFile(encoder.encode(canonical({ snapshot: value, payloadHash, extra: 'unknown-v1-field' })));
    await expect(inspectEncryptedBackup(file, secret)).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    const store = new MemoryEventStore();
    const unit = { id: 'synthetic-unit', editionId: 'synthetic-test-only', probeProfileVersionId: 'synthetic-P0', words: 100, coverage: ['synthetic:0:100'] };
    const app = await LearningApplication.open(store, { access: await createSyntheticLearningAccess([unit]) });
    let tick = Date.now() + 1000;
    const at = () => new Date(tick += 1000).toISOString();
    await app.send({ type: 'UnitRegistered', unit }, { at: at() });
    await app.send({ type: 'SessionStarted', unitId: 'synthetic-unit', sessionId: 'synthetic-session' }, { at: at() });
    await app.send({ type: 'RepetitionCompleted', sessionId: 'synthetic-session', mode: 'reading' }, { at: at(), commandId: 'repeat-once' });
    const live = await store.load(); const duplicate = structuredClone(live);
    duplicate.events.push({ ...structuredClone(duplicate.events.at(-1)!), eventId: 'different-event-same-command' });
    const duplicateFile = await exportEncryptedBackup(duplicate, secret);
    await expect(restoreEncryptedBackup(store, duplicateFile, secret, { confirmed: true, expectedRevision: live.revision, validateReplay: replayLearning }))
      .rejects.toMatchObject({ code: 'EVENT_CONFLICT' });
    expect(await store.load()).toEqual(live);
    expect(app.state.sessions['synthetic-session'].repetitions).toBe(1);
  });
});
