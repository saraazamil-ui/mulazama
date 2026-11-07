import { DomainError, canonical, type EventSnapshot, type EventStore, type LearningEvent } from '../core/types';

const DATABASE_VERSION = 3;
const TABLES = ['events', 'commands', 'meta', 'keys'] as const;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
type Head = { key: 'head'; revision: number; nextSequence: number; format: 2; commandIndexFormat?: 'utf16-v1' };
type CipherRow = { eventId: string; sequence: number; encoding: 'aes-gcm-v1'; iv: Uint8Array; ciphertext: ArrayBuffer };
type LegacyRow = { eventId: string; sequence: number; event: LearningEvent; encoding?: 'plain-v1' };
export type CommandIndexRow = { commandId: string; fingerprint: string; eventIds: string[] };
type CommandRow = CommandIndexRow;
const emptyHead = (): Head => ({ key: 'head', revision: 0, nextSequence: 1, format: 2, commandIndexFormat: 'utf16-v1' });

function fail(code: string, message: string): never { throw new DomainError(code, message); }
function safeString(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 300; }

// A record must have the same meaning in memory, canonical JSON, backup, and
// browser structured cloning. Inspect descriptors before reading any values:
// getters can change an event between validation and the actual commit.
function jsonOnly(value: unknown, seen = new Set<object>(), depth = 0): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || seen.has(value) || depth > 64) fail('INVALID_INPUT', 'Event must contain finite, bounded JSON data');
  seen.add(value);
  const array = Array.isArray(value);
  if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) fail('INVALID_INPUT', 'Event must contain plain JSON data');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(value).length) fail('INVALID_INPUT', 'JSON data cannot contain symbol keys');
  if (array && Object.keys(descriptors).length !== value.length + 1) fail('INVALID_INPUT', 'JSON arrays cannot contain holes or additional properties');
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (array && key === 'length') continue;
    if (!('value' in descriptor) || !descriptor.enumerable || ['__proto__', 'constructor', 'prototype'].includes(key)) fail('INVALID_INPUT', 'JSON data cannot contain accessors, hidden, or reserved keys');
    if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) fail('INVALID_INPUT', 'JSON arrays cannot contain additional properties');
    jsonOnly(descriptor.value, seen, depth + 1);
  }
  seen.delete(value);
}

function absoluteInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  // Date.parse normalizes February 30 and 24:00 rather than rejecting them.
  return new Date(value).toISOString() === `${match[1]}.${(match[2] ?? '').padEnd(3, '0')}Z`;
}

/** Storage validates the envelope. Individual event payloads belong to the application contract. */
export function validateEvent(value: unknown): asserts value is LearningEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_INPUT', 'Invalid event envelope');
  jsonOnly(value);
  const e = value as LearningEvent;
  if (![e.eventId, e.commandId, e.operationId, e.userId, e.type, e.zoneId].every(safeString) ||
      !(e.unitId === null || safeString(e.unitId)) ||
      !['V1', 'V2', 'V4', 'product'].includes(e.source) ||
      !Array.isArray(e.coverage) || !e.coverage.every(safeString) ||
      !e.data || typeof e.data !== 'object' || Array.isArray(e.data) ||
      !e.versions || e.versions.schema !== 1 ||
      !['algorithm', 'policy', 'rubric', 'model', 'content'].every(k => safeString((e.versions as Record<string, unknown>)[k]))) {
    fail('INVALID_INPUT', 'Invalid or unsupported event envelope');
  }
  for (const at of [e.occurredAt, e.receivedAt]) {
    if (!absoluteInstant(at)) fail('INVALID_INPUT', 'Event time must be a valid absolute UTC instant');
  }
  try { new Intl.DateTimeFormat('en', { timeZone: e.zoneId }); } catch { fail('INVALID_INPUT', 'Invalid capture timezone'); }
}

function copy<T>(value: T): T { return structuredClone(value); }
function uniqueEvents(events: LearningEvent[]): LearningEvent[] {
  if (!Array.isArray(events) || events.length > 100_000) fail('INVALID_INPUT', 'Invalid event batch');
  const byId = new Map<string, LearningEvent>();
  for (const raw of events) {
    validateEvent(raw);
    const e = copy(raw), existing = byId.get(e.eventId);
    if (existing && canonical(existing) !== canonical(e)) fail('EVENT_CONFLICT', 'An event identifier has conflicting content');
    byId.set(e.eventId, e);
  }
  return [...byId.values()];
}

/** No locale, host language, or collation options may affect durable hashes. */
export function compareEventIdUtf16(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function groupCommands(events: LearningEvent[], order: 'utf16' | 'legacy-locale' = 'utf16'): Map<string, CommandRow> {
  const groups = new Map<string, LearningEvent[]>();
  for (const e of events) {
    const group = groups.get(e.commandId);
    if (group) group.push(e); else groups.set(e.commandId, [e]);
  }
  return new Map([...groups].map(([commandId, group]) => {
    const sorted = [...group].sort((a, b) => order === 'utf16' ? compareEventIdUtf16(a.eventId, b.eventId) : a.eventId.localeCompare(b.eventId));
    return [commandId, { commandId, fingerprint: canonical(sorted), eventIds: sorted.map(e => e.eventId) }];
  }));
}

async function hashedCommands(events: LearningEvent[], order: 'utf16' | 'legacy-locale' = 'utf16'): Promise<CommandRow[]> {
  return Promise.all([...groupCommands(events, order).values()].map(async command => ({
    ...command,
    // Never persist the canonical event body in a plaintext idempotency index.
    fingerprint: [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(command.fingerprint)))].map(b => b.toString(16).padStart(2, '0')).join(''),
  })));
}

/** Pure migration decision. Only the app's lowercase UUID domain has known fixed collation. */
export function commandIndexMigrationDecision(events: LearningEvent[], actual: CommandRow[], localLegacy: CommandRow[]): 'migrate' | 'review-required' | 'corrupt' {
  const ordered = (rows: CommandRow[]) => [...rows].sort((a, b) => compareEventIdUtf16(a.commandId, b.commandId));
  if (canonical(ordered(actual)) === canonical(ordered(localLegacy))) return 'migrate';
  const baselineUuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
  // ASCII alone is insufficient: e.g. I/i collation differs in Turkish/Danish.
  return events.some(event => !baselineUuid.test(event.eventId)) ? 'review-required' : 'corrupt';
}

function decideAppend(current: EventSnapshot, incoming: LearningEvent[], expectedRevision: number): { events: LearningEvent[]; changed: boolean } {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail('INVALID_INPUT', 'Invalid revision');
  const input = uniqueEvents(incoming), existingById = new Map(current.events.map(e => [e.eventId, e]));
  const commands = groupCommands(current.events), incomingCommands = groupCommands(input);
  const fresh: LearningEvent[] = [];
  for (const [id, command] of incomingCommands) {
    const old = commands.get(id);
    if (old && old.fingerprint !== command.fingerprint) fail('EVENT_CONFLICT', 'A command identifier has conflicting content');
  }
  for (const e of input) {
    const old = existingById.get(e.eventId);
    if (old && canonical(old) !== canonical(e)) fail('EVENT_CONFLICT', 'An event identifier has conflicting content');
    if (!old) fresh.push(e);
  }
  // A retry of an already committed transaction returns its confirmed data even with a stale CAS.
  if (!fresh.length) return { events: current.events, changed: false };
  if (expectedRevision !== current.revision) fail('REVISION_CONFLICT', 'The event stream changed; reload before retrying');
  return { events: [...current.events, ...fresh], changed: true };
}

/** An explicit test/reference store. It is never selected as a fallback after an IndexedDB error. */
export class MemoryEventStore implements EventStore {
  private snapshot: EventSnapshot = { revision: 0, events: [] };
  private closed = false;
  constructor(private beforeCommit?: () => void) {}
  private check() { if (this.closed) fail('WRITE_NOT_CONFIRMED', 'The event store is closed'); }
  async load(): Promise<EventSnapshot> { this.check(); return copy(this.snapshot); }
  async append(events: LearningEvent[], expectedRevision: number): Promise<EventSnapshot> {
    this.check(); const decision = decideAppend(this.snapshot, events, expectedRevision);
    if (decision.changed) { this.beforeCommit?.(); this.snapshot = { revision: this.snapshot.revision + 1, events: copy(decision.events) }; }
    return copy(this.snapshot);
  }
  async replace(events: LearningEvent[], expectedRevision: number): Promise<EventSnapshot> {
    this.check(); const validated = uniqueEvents(events);
    if (validated.length !== events.length) fail('EVENT_CONFLICT', 'Restore contains duplicate event identifiers');
    if (expectedRevision !== this.snapshot.revision) fail('REVISION_CONFLICT', 'The event stream changed before restore');
    if (canonical(validated) === canonical(this.snapshot.events)) return copy(this.snapshot);
    this.beforeCommit?.(); this.snapshot = { revision: this.snapshot.revision + 1, events: validated };
    return copy(this.snapshot);
  }
  async clear(expectedRevision: number): Promise<void> {
    this.check(); if (expectedRevision !== this.snapshot.revision) fail('REVISION_CONFLICT', 'The event stream changed before deletion');
    this.beforeCommit?.(); this.snapshot = { revision: this.snapshot.revision + 1, events: [] };
  }
  close() { this.closed = true; }
}

function storageError(error: unknown): DomainError {
  if (error instanceof DomainError) return error;
  const name = error instanceof Error ? error.name : '';
  return new DomainError(name === 'QuotaExceededError' ? 'STORAGE_FULL' : name === 'VersionError' ? 'UNSUPPORTED_VERSION' : 'WRITE_NOT_CONFIRMED',
    name === 'QuotaExceededError' ? 'Local storage is full; no write was confirmed' : 'Local database operation was not confirmed');
}
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(storageError(req.error)); });
}
function complete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(storageError(tx.error)); tx.onerror = () => { /* abort determines the final outcome */ }; });
}
function strictWrite(db: IDBDatabase, tables: string[]): IDBTransaction {
  let tx: IDBTransaction;
  try { tx = db.transaction(tables, 'readwrite', { durability: 'strict' }); }
  catch { fail('DURABILITY_UNAVAILABLE', 'This browser cannot request strict IndexedDB write durability'); }
  if (tx.durability !== 'strict') {
    tx.abort();
    fail('DURABILITY_UNAVAILABLE', 'This browser did not confirm strict IndexedDB write durability');
  }
  return tx;
}
function checkHead(value: unknown): Head {
  if (!value || typeof value !== 'object') fail('DATABASE_CORRUPT', 'The database head is missing');
  const h = value as Head;
  if (h.key !== 'head' || h.format !== 2 || !Number.isSafeInteger(h.revision) || h.revision < 0 || !Number.isSafeInteger(h.nextSequence) || h.nextSequence < 1) fail('DATABASE_CORRUPT', 'Invalid database head');
  if (h.commandIndexFormat !== undefined && h.commandIndexFormat !== 'utf16-v1') fail('UNSUPPORTED_VERSION', 'Unknown command index format');
  return h;
}

/**
 * Web adapter. AES-256-GCM authenticates records; its non-extractable CryptoKey is
 * kept in this origin's IndexedDB. It is NOT an OS keystore and does not protect
 * against script execution in the same origin, a compromised browser, or deletion.
 * Promise resolution follows IDBTransaction.complete, never request.success.
 */
export class IndexedDbEventStore implements EventStore {
  private closed = false;
  private constructor(private db: IDBDatabase, private key: CryptoKey) {}
  static async open(name = 'mulazama-learning-v1'): Promise<IndexedDbEventStore> {
    if (!globalThis.indexedDB || !globalThis.crypto?.subtle) fail('PLATFORM_UNAVAILABLE', 'IndexedDB and Web Crypto require a supported secure browser context');
    let db: IDBDatabase | undefined, migratedFromV1 = false;
    try {
      db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(name, DATABASE_VERSION);
        req.onupgradeneeded = (ev) => {
          const d = req.result, tx = req.transaction!;
          // Supported v1 shape: events(eventId), meta(key), optional commands/keys.
          for (const table of TABLES) if (!d.objectStoreNames.contains(table)) d.createObjectStore(table, { keyPath: table === 'events' ? 'eventId' : table === 'commands' ? 'commandId' : 'key' });
          if (ev.oldVersion === 0) tx.objectStore('meta').put(emptyHead());
          else if (ev.oldVersion === 1) {
            migratedFromV1 = true;
            const get = tx.objectStore('meta').get('head');
            get.onsuccess = () => {
              const old = get.result;
              if (!old || !Number.isSafeInteger(old.revision) || !Number.isSafeInteger(old.nextSequence)) { tx.abort(); return; }
              tx.objectStore('meta').put({ ...old, format: 2 });
              tx.objectStore('meta').put({ key: 'migration-v1', from: 1, to: 2, status: 'pending' });
            };
          }
          if (ev.oldVersion > 0 && ev.oldVersion < 3)
            tx.objectStore('meta').put({ key: 'migration-command-index', from: 'locale-v1', to: 'utf16-v1', status: 'pending' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(storageError(req.error));
        req.onblocked = () => reject(new DomainError('DATABASE_BLOCKED', 'Close other application tabs before upgrading the local database'));
      });
      db.onversionchange = () => db?.close();
      const candidate = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      const tx = strictWrite(db, ['keys', 'events', 'meta']), done = complete(tx), keys = tx.objectStore('keys');
      let key: CryptoKey = candidate;
      let keyRead = false, rowsRead = false, migrationRead = false, keyFailure: unknown;
      const get = keys.get('data-key'), eventRows = tx.objectStore('events').getAll(), migration = tx.objectStore('meta').get('migration-v1');
      const useKey = () => {
        if (!keyRead || !rowsRead || !migrationRead) return;
        try {
          if (migration.result) {
            if (migration.result.from !== 1 || migration.result.to !== 2 || migration.result.status !== 'pending') fail('UNSUPPORTED_VERSION', 'Unknown pending database migration');
            migratedFromV1 = true;
          }
          if (get.result) key = get.result.value;
          else {
            const rows: Array<CipherRow | LegacyRow> = eventRows.result;
            const knownPlainMigration = migratedFromV1 && rows.every(row => (!row.encoding || row.encoding === 'plain-v1') && 'event' in row);
            if (rows.length && !knownPlainMigration) fail('DATABASE_CORRUPT', 'Encrypted learning data exists but its encryption key is missing');
            keys.put({ key: 'data-key', value: candidate });
          }
        } catch (error) { keyFailure = error; tx.abort(); }
      };
      get.onsuccess = () => { keyRead = true; useKey(); };
      eventRows.onsuccess = () => { rowsRead = true; useKey(); };
      migration.onsuccess = () => { migrationRead = true; useKey(); };
      try { await done; } catch (error) { throw keyFailure ?? error; }
      if (!key || key.type !== 'secret' || key.extractable || key.algorithm.name !== 'AES-GCM' ||
          (key.algorithm as AesKeyAlgorithm).length !== 256 || key.usages.length !== 2 ||
          !key.usages.includes('encrypt') || !key.usages.includes('decrypt')) fail('DATABASE_CORRUPT', 'Invalid local encryption key');
      const store = new IndexedDbEventStore(db, key);
      await store.migrateLegacy(migratedFromV1);
      await store.migrateCommandIndex();
      await store.load(); // Fail closed on corrupt content, without reset or overwrite.
      return store;
    } catch (error) { db?.close(); throw storageError(error); }
  }
  private check() { if (this.closed) fail('WRITE_NOT_CONFIRMED', 'The event store is closed'); }
  private async raw(): Promise<{ head: Head; rows: Array<CipherRow | LegacyRow>; commands: CommandRow[]; indexMigration: unknown }> {
    this.check();
    try {
      const tx = this.db.transaction(['meta', 'events', 'commands'], 'readonly'), done = complete(tx);
      const [h, rows, commands, indexMigration] = await Promise.all([request(tx.objectStore('meta').get('head')), request(tx.objectStore('events').getAll()), request(tx.objectStore('commands').getAll()), request(tx.objectStore('meta').get('migration-command-index'))]);
      await done;
      const head = checkHead(h), sorted = (rows as Array<CipherRow | LegacyRow>).sort((a,b) => a.sequence - b.sequence);
      const sequences = new Set<number>();
      if (head.nextSequence !== sorted.length + 1) fail('DATABASE_CORRUPT', 'The event stream length does not match its head');
      for (let i = 0; i < sorted.length; i++) {
        const row = sorted[i];
        if (!safeString(row.eventId) || !Number.isSafeInteger(row.sequence) || row.sequence !== i + 1 || row.sequence >= head.nextSequence || sequences.has(row.sequence)) fail('DATABASE_CORRUPT', 'Invalid event sequence');
        sequences.add(row.sequence);
      }
      return { head, rows: sorted, commands, indexMigration };
    } catch (error) { throw storageError(error); }
  }
  private async encrypt(event: LearningEvent, sequence: number): Promise<CipherRow> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aad = encoder.encode(canonical({ eventId: event.eventId, sequence, encoding: 'aes-gcm-v1' }));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, this.key, encoder.encode(canonical(event)));
    return { eventId: event.eventId, sequence, encoding: 'aes-gcm-v1', iv, ciphertext };
  }
  private async decrypt(row: CipherRow | LegacyRow): Promise<LearningEvent> {
    if (row.encoding !== 'aes-gcm-v1') fail('DATABASE_CORRUPT', 'Unmigrated or unknown event encoding');
    try {
      const aad = encoder.encode(canonical({ eventId: row.eventId, sequence: row.sequence, encoding: row.encoding }));
      const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: row.iv as Uint8Array<ArrayBuffer>, additionalData: aad, tagLength: 128 }, this.key, row.ciphertext);
      const e: unknown = JSON.parse(decoder.decode(bytes)); validateEvent(e);
      if (e.eventId !== row.eventId) fail('DATABASE_CORRUPT', 'Event identity mismatch');
      return e;
    } catch { fail('DATABASE_CORRUPT', 'An authenticated event record could not be read; the database was preserved'); }
  }
  private async migrateLegacy(allowed: boolean): Promise<void> {
    const current = await this.raw();
    if (!current.rows.some(row => row.encoding !== 'aes-gcm-v1')) {
      if (allowed) await this.write([], [], current.head, { ...current.head }, false);
      return;
    }
    if (!allowed) fail('DATABASE_CORRUPT', 'Plaintext or unknown records are not accepted in the encrypted schema');
    const events: LearningEvent[] = [];
    for (const row of current.rows) {
      if (row.encoding === 'aes-gcm-v1') events.push(await this.decrypt(row));
      else if ((!row.encoding || row.encoding === 'plain-v1') && 'event' in row) { validateEvent(row.event); if (row.eventId !== row.event.eventId) fail('DATABASE_CORRUPT', 'Legacy event identity mismatch'); events.push(row.event); }
      else fail('UNSUPPORTED_VERSION', 'Unknown legacy event encoding');
    }
    const cipher = await Promise.all(events.map((e,i) => this.encrypt(e,current.rows[i].sequence)));
    await this.write(cipher, await hashedCommands(events), current.head, { ...current.head, commandIndexFormat: 'utf16-v1' }, true);
  }
  private async migrateCommandIndex(): Promise<void> {
    const current = await this.raw();
    if (current.head.commandIndexFormat === 'utf16-v1') {
      if (current.indexMigration) fail('DATABASE_CORRUPT', 'Completed command index has an unexpected pending migration');
      return;
    }
    const marker = current.indexMigration as { from?: string; to?: string; status?: string } | undefined;
    if (!marker || marker.from !== 'locale-v1' || marker.to !== 'utf16-v1' || marker.status !== 'pending') fail('UNSUPPORTED_VERSION', 'Command index migration provenance is missing or unsupported');
    const events = await Promise.all(current.rows.map(row => this.decrypt(row)));
    const legacy = await hashedCommands(events, 'legacy-locale');
    const decision = commandIndexMigrationDecision(events, current.commands, legacy);
    if (decision === 'review-required') fail('INDEX_MIGRATION_REVIEW_REQUIRED', 'The old command index may use another locale; preserve the database and review a shadow migration');
    if (decision === 'corrupt') fail('DATABASE_CORRUPT', 'Legacy command index does not match authenticated events');
    // Only the derived index and its format marker change. Raw ciphertext,
    // event chronology, stream revision, and learning evidence are preserved.
    await this.write([], await hashedCommands(events), current.head, { ...current.head, commandIndexFormat: 'utf16-v1' }, false);
  }
  async load(): Promise<EventSnapshot> {
    const { head, rows, commands } = await this.raw();
    const events = await Promise.all(rows.map(row => this.decrypt(row)));
    if (head.commandIndexFormat !== 'utf16-v1') fail('UNSUPPORTED_VERSION', 'Command index migration has not completed');
    const expected = (await hashedCommands(events)).sort((a,b) => compareEventIdUtf16(a.commandId,b.commandId));
    const actual = [...commands].sort((a,b) => compareEventIdUtf16(a.commandId,b.commandId));
    if (canonical(expected) !== canonical(actual)) fail('DATABASE_CORRUPT', 'Command index does not match the authenticated event stream');
    return { revision: head.revision, events };
  }
  private async write(rows: CipherRow[], commands: CommandRow[], old: Head, next: Head, replace: boolean): Promise<void> {
    this.check();
    try {
      const tx = strictWrite(this.db, ['events','commands','meta']), done = complete(tx);
      let domainFailure: unknown;
      const headReq = tx.objectStore('meta').get('head');
      headReq.onsuccess = () => {
        try {
          const live = checkHead(headReq.result);
          if (live.revision !== old.revision || live.nextSequence !== old.nextSequence) fail('REVISION_CONFLICT', 'The local event stream changed in another tab');
          if (replace) { tx.objectStore('events').clear(); tx.objectStore('commands').clear(); }
          for (const row of rows) tx.objectStore('events').add(row);
          for (const command of commands) tx.objectStore('commands').put(command);
          tx.objectStore('meta').put(next);
          tx.objectStore('meta').delete('migration-v1');
          if (next.commandIndexFormat === 'utf16-v1') tx.objectStore('meta').delete('migration-command-index');
        } catch (error) { domainFailure = error; tx.abort(); }
      };
      try { await done; } catch (error) { throw domainFailure ?? error; }
    } catch (error) { throw storageError(error); }
  }
  async append(incoming: LearningEvent[], expectedRevision: number): Promise<EventSnapshot> {
    const current = await this.load(), decision = decideAppend(current, incoming, expectedRevision);
    if (!decision.changed) return current;
    const fresh = decision.events.slice(current.events.length), raw = await this.raw();
    if (raw.head.revision !== current.revision) fail('REVISION_CONFLICT', 'The event stream changed while preparing the write');
    const rows = await Promise.all(fresh.map((e,i) => this.encrypt(e, raw.head.nextSequence + i)));
    await this.write(rows, await hashedCommands(fresh), raw.head, { ...raw.head, revision: current.revision + 1, nextSequence: raw.head.nextSequence + rows.length }, false);
    return { revision: current.revision + 1, events: copy(decision.events) };
  }
  async replace(incoming: LearningEvent[], expectedRevision: number): Promise<EventSnapshot> {
    const events = uniqueEvents(incoming);
    if (events.length !== incoming.length) fail('EVENT_CONFLICT', 'Restore contains duplicate event identifiers');
    const current = await this.load();
    if (expectedRevision !== current.revision) fail('REVISION_CONFLICT', 'The event stream changed before restore');
    if (canonical(events) === canonical(current.events)) return current;
    const raw = await this.raw();
    if (raw.head.revision !== current.revision) fail('REVISION_CONFLICT', 'The event stream changed while preparing restore');
    const rows = await Promise.all(events.map((e,i) => this.encrypt(e, i + 1)));
    await this.write(rows, await hashedCommands(events), raw.head, { key: 'head', format: 2, commandIndexFormat: 'utf16-v1', revision: current.revision + 1, nextSequence: rows.length + 1 }, true);
    return { revision: current.revision + 1, events };
  }
  async clear(expectedRevision: number): Promise<void> {
    const current = await this.load();
    if (expectedRevision !== current.revision) fail('REVISION_CONFLICT', 'The event stream changed before deletion');
    const raw = await this.raw();
    if (raw.head.revision !== current.revision) fail('REVISION_CONFLICT', 'The event stream changed while preparing deletion');
    // Delete raw learning records in one transaction; the non-extractable device key has no remaining ciphertext.
    await this.write([], [], raw.head, { key: 'head', format: 2, commandIndexFormat: 'utf16-v1', revision: current.revision + 1, nextSequence: 1 }, true);
  }
  close() { this.closed = true; this.db.close(); }
}
