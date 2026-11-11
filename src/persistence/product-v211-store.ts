/** Isolated, local-only V2.1.1 preview journal. Never opens a legacy learner database.
 * All four records commit together; a receipt means local durability, never cloud sync.
 * Production identity, encryption-key custody and remote synchronization remain gated.
 */
export interface ProductReceipt {
  commandId: string;
  eventIds: string[];
  revision: number;
  durability: 'local';
}
export interface ProductOutbox {
  commandId: string;
  payloadHash: string;
  status: 'pending';
  attemptCount: 0;
}
export interface ProductSnapshot<S, E> {
  state: S | null;
  events: E[];
  receipts: Record<string, ProductReceipt>;
  outbox: ProductOutbox[];
}
export interface ProductCommit<S, E> {
  expectedRevision: number;
  state: S;
  event: E;
  receipt: ProductReceipt;
  payloadHash: string;
}
export interface ProductStore<S extends {revision: number}, E extends {id: string; revision: number}> {
  load(): Promise<ProductSnapshot<S, E>>;
  commit(input: ProductCommit<S, E>): Promise<ProductReceipt>;
  close(): void;
}

type Head<S> = {key: 'head'; format: 1; revision: number; state: S};
type ReceiptRow = {commandId: string; format: 1; payloadHash: string; receipt: ProductReceipt};
type EventRow<E> = {id: string; format: 1; event: E};
const tables = ['meta', 'events', 'receipts', 'outbox'];
const copy = <T>(value: T): T => structuredClone(value);
const fail = (code: string): never => { throw new Error(code); };
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 2048;
function validate<S extends {revision: number}, E extends {id: string; revision: number}>(input: ProductCommit<S, E>) {
  const {expectedRevision, state, event, receipt, payloadHash} = input;
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
      !state || state.revision !== expectedRevision + 1 || !event || event.revision !== state.revision ||
      !identifier(event.id) || !receipt || !identifier(receipt.commandId) || !identifier(payloadHash) ||
      receipt.revision !== state.revision || receipt.durability !== 'local' ||
      !Array.isArray(receipt.eventIds) || receipt.eventIds.length !== 1 || receipt.eventIds[0] !== event.id) fail('INVALID_INPUT');
}
function snapshot<S extends {revision: number}, E extends {id: string; revision: number}>(
  head: Head<S> | undefined, eventRows: EventRow<E>[], receiptRows: ReceiptRow[], outbox: ProductOutbox[],
): ProductSnapshot<S, E> {
  if ((head && head.format !== 1) || eventRows.some(row => row.format !== 1) || receiptRows.some(row => row.format !== 1)) fail('UNSUPPORTED_VERSION');
  const events = eventRows.map(row => row.event).sort((a, b) => a.revision - b.revision);
  const revision = head?.revision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0 || revision !== events.length ||
      (head && head.state.revision !== revision) || events.some((event, index) => event.revision !== index + 1) ||
      receiptRows.length !== events.length || outbox.length !== receiptRows.length) fail('STORAGE_INTEGRITY_ERROR');
  const receipts: Record<string, ProductReceipt> = Object.create(null);
  for (const row of receiptRows) {
    const receipt = row.receipt;
    const event = events[receipt.revision - 1];
    const queued = outbox.find(item => item.commandId === row.commandId);
    if (!event || receipt.commandId !== row.commandId || receipt.durability !== 'local' || receipt.eventIds.length !== 1 ||
        receipt.eventIds[0] !== event.id || !queued || queued.payloadHash !== row.payloadHash || queued.status !== 'pending' || queued.attemptCount !== 0) fail('STORAGE_INTEGRITY_ERROR');
    receipts[row.commandId] = receipt;
  }
  return copy({state: head?.state ?? null, events, receipts, outbox});
}

export class IndexedDbProductStore<S extends {revision: number}, E extends {id: string; revision: number}> implements ProductStore<S, E> {
  private constructor(private readonly db: IDBDatabase) {}

  static async open<S extends {revision: number}, E extends {id: string; revision: number}>(name: string): Promise<IndexedDbProductStore<S, E>> {
    if (!/^mulazama-v211-synthetic-[A-Za-z0-9_-]{1,100}$/.test(name)) fail('INVALID_SYNTHETIC_DATABASE');
    if (typeof indexedDB === 'undefined') fail('STORAGE_UNAVAILABLE');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('meta', {keyPath: 'key'});
        db.createObjectStore('events', {keyPath: 'id'});
        db.createObjectStore('receipts', {keyPath: 'commandId'});
        db.createObjectStore('outbox', {keyPath: 'commandId'});
      };
      request.onerror = () => reject(request.error?.name === 'VersionError' ? new Error('UNSUPPORTED_VERSION') : request.error);
      request.onblocked = () => reject(new Error('STORAGE_BLOCKED'));
      request.onsuccess = () => resolve(request.result);
    });
    db.onversionchange = () => db.close();
    return new IndexedDbProductStore<S, E>(db);
  }

  load(): Promise<ProductSnapshot<S, E>> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(tables, 'readonly');
      const head = tx.objectStore('meta').get('head');
      const events = tx.objectStore('events').getAll();
      const receipts = tx.objectStore('receipts').getAll();
      const outbox = tx.objectStore('outbox').getAll();
      tx.onabort = () => reject(tx.error ?? new Error('STORAGE_READ_FAILED'));
      tx.oncomplete = () => {
        try { resolve(snapshot<S, E>(head.result, events.result, receipts.result, outbox.result)); }
        catch (error) { reject(error); }
      };
    });
  }

  async commit(raw: ProductCommit<S, E>): Promise<ProductReceipt> {
    const input = copy(raw);
    validate(input);
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(tables, 'readwrite');
      let failure: Error | null = null;
      let result: ProductReceipt | undefined;
      const abort = (code: string) => { failure = new Error(code); tx.abort(); };
      tx.onabort = () => reject(failure ?? (tx.error?.name === 'QuotaExceededError' ? new Error('STORAGE_FULL') : tx.error) ?? new Error('STORAGE_WRITE_FAILED'));
      tx.oncomplete = () => result ? resolve(copy(result)) : reject(new Error('STORAGE_WRITE_FAILED'));
      const prior = tx.objectStore('receipts').get(input.receipt.commandId);
      prior.onsuccess = () => {
        const previous = prior.result as ReceiptRow | undefined;
        if (previous) {
          if (previous.format !== 1) { abort('UNSUPPORTED_VERSION'); return; }
          if (previous.payloadHash !== input.payloadHash) { abort('IDEMPOTENCY_CONFLICT'); return; }
          result = previous.receipt;
          return;
        }
        const readHead = tx.objectStore('meta').get('head');
        readHead.onsuccess = () => {
          const head = readHead.result as Head<S> | undefined;
          if (head && head.format !== 1) { abort('UNSUPPORTED_VERSION'); return; }
          if ((head?.revision ?? 0) !== input.expectedRevision) { abort('REVISION_CONFLICT'); return; }
          const {event, state, receipt, payloadHash} = input;
          tx.objectStore('events').add({id: event.id, format: 1, event} satisfies EventRow<E>);
          tx.objectStore('meta').put({key: 'head', format: 1, revision: state.revision, state} satisfies Head<S>);
          tx.objectStore('receipts').add({commandId: receipt.commandId, format: 1, receipt, payloadHash} satisfies ReceiptRow);
          tx.objectStore('outbox').add({commandId: receipt.commandId, payloadHash, status: 'pending', attemptCount: 0} satisfies ProductOutbox);
          result = receipt;
        };
      };
    });
  }

  close(): void { this.db.close(); }
}

/** Same transaction semantics for domain tests; this does not masquerade as durable browser storage. */
export class MemoryProductStore<S extends {revision: number}, E extends {id: string; revision: number}> implements ProductStore<S, E> {
  private head: Head<S> | undefined;
  private events: EventRow<E>[] = [];
  private receipts: ReceiptRow[] = [];
  private outbox: ProductOutbox[] = [];
  async load(): Promise<ProductSnapshot<S, E>> { return snapshot(this.head, this.events, this.receipts, this.outbox); }
  async commit(raw: ProductCommit<S, E>): Promise<ProductReceipt> {
    const input = copy(raw);
    validate(input);
    const previous = this.receipts.find(row => row.commandId === input.receipt.commandId);
    if (previous) {
      if (previous.payloadHash !== input.payloadHash) fail('IDEMPOTENCY_CONFLICT');
      return copy(previous.receipt);
    }
    if ((this.head?.revision ?? 0) !== input.expectedRevision) fail('REVISION_CONFLICT');
    if (this.events.some(row => row.id === input.event.id)) fail('EVENT_CONFLICT');
    const {state, event, receipt, payloadHash} = input;
    this.events.push({id: event.id, format: 1, event});
    this.head = {key: 'head', format: 1, revision: state.revision, state};
    this.receipts.push({commandId: receipt.commandId, format: 1, payloadHash, receipt});
    this.outbox.push({commandId: receipt.commandId, payloadHash, status: 'pending', attemptCount: 0});
    return copy(receipt);
  }
  close(): void {}
}
