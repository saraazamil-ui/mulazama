/** Actual IndexedDB/Web Crypto QA only. Not imported by the product entrypoint. */
import { IndexedDbEventStore } from './event-store';
import { runPersistenceChecks } from './browser-tests';
import { canonical, VERSIONS, type LearningEvent } from '../core/types';

type Result = { name: string; passed: boolean; milliseconds: number };
function event(id: string, commandId = id): LearningEvent {
  return { eventId: id, commandId, operationId: commandId, userId: 'synthetic-05b', unitId: null,
    type: 'SessionStarted', occurredAt: '2026-11-05T10:00:00.000Z', receivedAt: '2026-11-05T10:00:00.000Z',
    zoneId: 'Asia/Riyadh', source: 'product', coverage: [], versions: VERSIONS, data: { synthetic: true } };
}
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function rejected(task: Promise<unknown>, code: string) {
  try { await task; } catch (e) { assert((e as {code?: string}).code === code, `Expected ${code}: ${(e as Error).message}`); return; }
  throw new Error(`Expected ${code}`);
}
function req<T>(r: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
function done(tx: IDBTransaction): Promise<void> { return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); }

/** Constructs the documented v2 encrypted disk shape independently of the v3 adapter. */
async function legacyV2(name: string, events: LearningEvent[], locale?: string) {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const encoder = new TextEncoder();
  const rows = await Promise.all(events.map(async (value, i) => {
    const sequence = i + 1, iv = crypto.getRandomValues(new Uint8Array(12)), encoding = 'aes-gcm-v1';
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128,
      additionalData: encoder.encode(canonical({ eventId: value.eventId, sequence, encoding })) }, key, encoder.encode(canonical(value)));
    return { eventId: value.eventId, sequence, encoding, iv, ciphertext };
  }));
  const groups = new Map<string, LearningEvent[]>();
  for (const value of events) { const group = groups.get(value.commandId) ?? []; group.push(value); groups.set(value.commandId, group); }
  const commands = await Promise.all([...groups].map(async ([commandId, group]) => {
    const sorted = [...group].sort((a, b) => a.eventId.localeCompare(b.eventId, locale));
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(canonical(sorted)));
    return { commandId, eventIds: sorted.map(value => value.eventId), fingerprint: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('') };
  }));
  const opening = indexedDB.open(name, 2); opening.onupgradeneeded = () => {
    for (const table of ['events', 'commands', 'meta', 'keys']) opening.result.createObjectStore(table, { keyPath: table === 'events' ? 'eventId' : table === 'commands' ? 'commandId' : 'key' });
  };
  const db = await req(opening), tx = db.transaction(['events', 'commands', 'meta', 'keys'], 'readwrite'), finish = done(tx);
  tx.objectStore('keys').put({ key: 'data-key', value: key });
  tx.objectStore('meta').put({ key: 'head', revision: 9, nextSequence: rows.length + 1, format: 2 });
  for (const row of rows) tx.objectStore('events').put(row);
  for (const command of commands) tx.objectStore('commands').put(command);
  await finish; db.close();
  return rows.map(row => ({ ...row, iv: [...row.iv], ciphertext: [...new Uint8Array(row.ciphertext)] }));
}
async function rawRows(name: string) {
  const db = await req(indexedDB.open(name)), tx = db.transaction(['events', 'meta'], 'readonly'), finish = done(tx);
  const [rows, head, marker] = await Promise.all([req(tx.objectStore('events').getAll()), req(tx.objectStore('meta').get('head')), req(tx.objectStore('meta').get('migration-command-index'))]);
  await finish; const version = db.version; db.close();
  return { version, head, marker, rows: rows.map(row => ({ ...row, iv: [...row.iv], ciphertext: [...new Uint8Array(row.ciphertext)] })) };
}

/** Runs the original 12 checks plus nine adversarial/migration browser-only checks. */
export async function runPersistence05BChecks(): Promise<Result[]> {
  const results = await runPersistenceChecks();
  const prefix = `mulazama-05b-qa-${crypto.randomUUID()}`, names: string[] = [];
  const test = async (name: string, run: (dbName: string) => Promise<void>) => {
    const dbName = `${prefix}-${names.length}`; names.push(dbName); const start = performance.now();
    await run(dbName); results.push({ name, passed: true, milliseconds: performance.now() - start });
  };
  try {
    await test('IDB13 command-index mutation is rejected without resetting history', async name => {
      const s = await IndexedDbEventStore.open(name); await s.append([event('preserve')], 0); s.close();
      let db = await req(indexedDB.open(name)); let tx = db.transaction('commands', 'readwrite'); let finish = done(tx);
      tx.objectStore('commands').put({ commandId: 'preserve', fingerprint: '0'.repeat(64), eventIds: ['preserve'] }); await finish; db.close();
      await rejected(IndexedDbEventStore.open(name), 'DATABASE_CORRUPT');
      db = await req(indexedDB.open(name)); tx = db.transaction('events', 'readonly'); finish = done(tx);
      assert(await req(tx.objectStore('events').count()) === 1, 'Corrupt index reset the raw stream'); await finish; db.close();
    });
    await test('IDB14 an AES-128 replacement key is rejected even for an empty stream', async name => {
      const s = await IndexedDbEventStore.open(name); s.close();
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 128 }, false, ['encrypt', 'decrypt']);
      const db = await req(indexedDB.open(name)), tx = db.transaction('keys', 'readwrite'), finish = done(tx);
      tx.objectStore('keys').put({ key: 'data-key', value: key }); await finish; db.close();
      await rejected(IndexedDbEventStore.open(name), 'DATABASE_CORRUPT');
    });
    await test('IDB15 malformed stream sequence is rejected without replacing records', async name => {
      const s = await IndexedDbEventStore.open(name); await s.append([event('preserve')], 0); s.close();
      const db = await req(indexedDB.open(name)), tx = db.transaction('meta', 'readwrite'), finish = done(tx);
      tx.objectStore('meta').put({ key: 'head', format: 2, revision: 1, nextSequence: 999 }); await finish; db.close();
      await rejected(IndexedDbEventStore.open(name), 'DATABASE_CORRUPT');
    });
    await test('IDB16 invalid timestamps never become acknowledged browser writes', async name => {
      const s = await IndexedDbEventStore.open(name);
      await rejected(s.append([{ ...event('invalid'), occurredAt: '2026-02-30T10:00:00Z' }], 0), 'INVALID_INPUT');
      assert((await s.load()).revision === 0, 'Invalid date incremented revision'); s.close();
    });
    await test('IDB17 deleting learning data removes event and command rows after reopen', async name => {
      const s = await IndexedDbEventStore.open(name); await s.append([event('a'), event('b')], 0); await s.clear(1); s.close();
      const reopened = await IndexedDbEventStore.open(name), snapshot = await reopened.load();
      assert(snapshot.revision === 2 && snapshot.events.length === 0, 'Deleted data reappeared'); reopened.close();
      const db = await req(indexedDB.open(name)), tx = db.transaction(['events', 'commands'], 'readonly'), finish = done(tx);
      const counts = await Promise.all([req(tx.objectStore('events').count()), req(tx.objectStore('commands').count())]); await finish;
      assert(counts.every(n => n === 0), 'Raw deleted event or command index remained'); db.close();
    });
    await test('IDB18 partial command retries cannot silently duplicate or truncate a batch', async name => {
      const s = await IndexedDbEventStore.open(name); await s.append([event('a', 'command'), event('b', 'command')], 0);
      await rejected(s.append([event('a', 'command')], 0), 'EVENT_CONFLICT');
      await rejected(s.append([event('a', 'command'), event('b', 'command'), event('c', 'command')], 1), 'EVENT_CONFLICT');
      const snapshot = await s.load(); assert(snapshot.revision === 1 && snapshot.events.length === 2, 'Partial retry changed history'); s.close();
    });
    await test('IDB19 explicit v2-to-v3 index migration preserves ciphertext and raw revision', async name => {
      const events = [event('old-b', 'old-command'), event('old-a', 'old-command')];
      const before = await legacyV2(name, events);
      const s = await IndexedDbEventStore.open(name), snapshot = await s.load(); s.close();
      assert(snapshot.revision === 9 && canonical(snapshot.events) === canonical(events), 'Index migration changed events or revision');
      const after = await rawRows(name);
      assert(after.version === 3 && after.head.commandIndexFormat === 'utf16-v1' && !after.marker, 'Index format migration did not commit');
      assert(canonical(after.rows.sort((a, b) => a.sequence - b.sequence)) === canonical(before), 'Index migration rewrote ciphertext');
    });
    await test('IDB20 unknown legacy Unicode collation requires review and preserves ciphertext', async name => {
      const events = [event('id-z', 'old-command'), event('id-ä', 'old-command')];
      const local = events.map(value => value.eventId).sort((a, b) => a.localeCompare(b));
      const other = ['en', 'sv'].find(locale => canonical([...local].sort((a, b) => a.localeCompare(b, locale))) !== canonical(local));
      assert(other, 'The locale fixture could not select a distinct collation');
      const before = await legacyV2(name, events, other);
      await rejected(IndexedDbEventStore.open(name), 'INDEX_MIGRATION_REVIEW_REQUIRED');
      const after = await rawRows(name);
      assert(after.head.revision === 9 && after.head.commandIndexFormat === undefined && after.marker?.status === 'pending', 'Unproven migration marked itself complete');
      assert(canonical(after.rows.sort((a, b) => a.sequence - b.sequence)) === canonical(before), 'Review-required migration changed raw ciphertext');
    });
    await test('IDB21 interrupted v2 index migration resumes only from a valid durable marker', async name => {
      await legacyV2(name, [event('preserved')]);
      const opening = indexedDB.open(name, 3); opening.onupgradeneeded = () => opening.transaction!.objectStore('meta').put({ key: 'migration-command-index', from: 'locale-v1', to: 'utf16-v1', status: 'pending' });
      const intermediate = await req(opening); intermediate.close();
      const s = await IndexedDbEventStore.open(name), snapshot = await s.load(); s.close();
      assert(snapshot.revision === 9 && snapshot.events[0].eventId === 'preserved', 'Interrupted index migration lost history');
      const after = await rawRows(name); assert(!after.marker && after.head.commandIndexFormat === 'utf16-v1', 'Pending migration did not complete atomically');
    });
    return results;
  } finally { for (const name of names) await req(indexedDB.deleteDatabase(name)); }
}

/**
 * Synthetic stress data; 20,000 events is a selected engineering load, not a
 * measured prediction of any person's years of use. No latency pass threshold.
 */
export async function measureSyntheticIndexedDb05B(eventCount = 20_000) {
  if (!Number.isSafeInteger(eventCount) || eventCount < 1 || eventCount > 100_000) throw new Error('Invalid synthetic event count');
  const name = `mulazama-05b-stress-${crypto.randomUUID()}`;
  let store: IndexedDbEventStore | undefined;
  try {
    const start = performance.now(); store = await IndexedDbEventStore.open(name); const opened = performance.now();
    const events = Array.from({ length: eventCount }, (_, i) => event(`synthetic-${i}`));
    const writeStart = performance.now(); await store.append(events, 0); const written = performance.now();
    store.close(); store = undefined;
    const reopenStart = performance.now(); store = await IndexedDbEventStore.open(name); const reopened = performance.now();
    const snapshot = await store.load(); const loaded = performance.now();
    assert(snapshot.events.length === eventCount && snapshot.revision === 1, 'Synthetic history was not preserved');
    const estimate = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
    return { synthetic: true, eventCount, userAgent: navigator.userAgent, initialOpenMs: opened - start,
      atomicBatchAppendMs: written - writeStart, reopenWithIntegrityCheckMs: reopened - reopenStart,
      loadWithIntegrityCheckMs: loaded - reopened, originStorageEstimate: estimate, physicalPowerLossTested: false };
  } finally { store?.close(); await req(indexedDB.deleteDatabase(name)); }
}
