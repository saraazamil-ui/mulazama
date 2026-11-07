import { ApplicationService, replayProduct } from "./service";
import { replayLearning } from "./learning";
import type { CompositeDataController } from "./composite-application";
import type { EventSnapshot, EventStore, LearningEvent } from "../core/types";
import { canonical, DomainError, LEARNING_VERSIONS, VERSIONS } from "../core/types";
import { exportEncryptedBackup, inspectEncryptedBackup, restoreEncryptedBackup, validateBackupSnapshot } from "../persistence/backup";
import { IndexedDbEventStore } from "../persistence/event-store";
import { createRuntimeLearningAccess, runtimeDatabaseName } from "../release/runtime";
import { requireLearningAccess, type LearningReleaseAccess } from "../release/access";
import { projectProgress } from "../progress/projection";

/** Reading already stored observations is distinct from authorizing a new Quran
 * session. This validator grants no execution capability and interprets only
 * the unchanged, explicitly supported event versions. */
export function replayHistory(snapshot: EventSnapshot) {
  validateBackupSnapshot(snapshot);
  const commands = new Set<string>();
  for (const event of snapshot.events) {
    if (!["product", "hme"].includes(event.data.scope as string))
      throw new DomainError("UNSUPPORTED_VERSION", "السجل يحتوي نطاقًا غير مدعوم؛ لم تُهمل أي وقائع.");
    if (commands.has(event.commandId))
      throw new DomainError("EVENT_CONFLICT", "معرف أمر مكرر بين وقائع السجل.");
    commands.add(event.commandId);
  }
  const product = replayProduct(productSnapshot(snapshot));
  const events = snapshot.events.filter(event => event.data.scope === "hme");
  const learning = events.length ? replayLearning({ revision: snapshot.revision, events }) : null;
  if (learning && learning.userId !== product.profileId)
    throw new DomainError("REFERENCE_MISMATCH", "هوية سجل التعلم لا تطابق ملف المستخدم.");
  return { product, learning };
}

const productSnapshot = (snapshot: EventSnapshot): EventSnapshot => ({
  revision: snapshot.revision, events: snapshot.events.filter(event => event.data.scope === "product"),
});

/** Product commands can append to their own stream, but never replace or clear
 * the aggregate. Validation sees BOTH streams before accepting a scoped view. */
class HistoryProductStore implements EventStore {
  readonly backupScope = "aggregate-only" as const;
  private fingerprints = new Map<number, string>();
  constructor(private readonly root: EventStore) {}
  private view(snapshot: EventSnapshot) {
    if (snapshot.events.length) replayHistory(snapshot);
    else validateBackupSnapshot(snapshot);
    const product = productSnapshot(snapshot);
    this.fingerprints.set(snapshot.revision, canonical(product.events));
    if (this.fingerprints.size > 32) this.fingerprints.delete(this.fingerprints.keys().next().value!);
    return product;
  }
  async load() { return this.view(await this.root.load()); }
  async append(events: LearningEvent[], expectedRevision: number) {
    if (events.some(event => event.data.scope !== "product"))
      throw new DomainError("REFERENCE_MISMATCH", "لا يمكن كتابة وقائع تعلم عبر خدمة الإعداد.");
    const before = await this.root.load();
    if (before.events.length) replayHistory(before);
    else validateBackupSnapshot(before);
    if (before.revision !== expectedRevision &&
        this.fingerprints.get(expectedRevision) !== canonical(productSnapshot(before).events))
      throw new DomainError("REVISION_CONFLICT", "تغير سجل الإعداد؛ أعد قراءته قبل الحفظ.");
    replayHistory({ revision: before.revision + 1, events: [...before.events, ...events] });
    return this.view(await this.root.append(events, before.revision));
  }
  async replace(): Promise<EventSnapshot> {
    throw new DomainError("AGGREGATE_BACKUP_REQUIRED", "الاستبدال متاح عبر النسخة الكاملة فقط.");
  }
  async clear(): Promise<void> {
    throw new DomainError("AGGREGATE_BACKUP_REQUIRED", "الحذف متاح عبر إدارة البيانات الكاملة فقط.");
  }
  close() {} // The aggregate owner closes the physical store.
}

/** Production history owner: no LearningApplication, no adapter, no learned
 * state initialization and no new HME writes. Historical activity may be read
 * while release gates remain blocked. Restore retains the existing gate check. */
export class HistoryApplication implements CompositeDataController {
  product!: ApplicationService;
  private queue: Promise<unknown> = Promise.resolve();
  private constructor(private readonly store: EventStore, private readonly access: LearningReleaseAccess) {}
  static async open(store?: EventStore, options: { access?: LearningReleaseAccess } = {}) {
    const root = store ?? await IndexedDbEventStore.open(runtimeDatabaseName());
    try {
      const access = options.access ?? await createRuntimeLearningAccess();
      requireLearningAccess(access);
      const app = new HistoryApplication(root, access);
      app.product = await ApplicationService.open(new HistoryProductStore(root));
      return app;
    } catch (error) { root.close(); throw error; }
  }
  private serialize<T>(run: () => Promise<T>) {
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }
  readProgress(now?: Date) {
    return this.serialize(async () => {
      const snapshot = await this.store.load();
      replayHistory(snapshot);
      return projectProgress(snapshot, now ?? new Date());
    });
  }
  /** Factual per-unit foundation; no persistence or prediction is introduced. */
  readPersonalMemory(now?: Date) {
    return this.serialize(async () => {
      const snapshot = await this.store.load();
      const { projectPersonalMemory } = await import('../memory/personal-memory');
      return projectPersonalMemory(snapshot, now ?? new Date());
    });
  }
  /** Explicit engineering comparison, never a session/plan execution authority. */
  readAdaptiveSchedule() {
    return this.serialize(async () => {
      const snapshot = await this.store.load();
      const { rebuildAdaptiveSchedule } = await import('./adaptive-scheduling');
      return rebuildAdaptiveSchedule(snapshot);
    });
  }
  exportBackup(password: string) {
    return this.serialize(async () => {
      const snapshot = await this.store.load();
      replayHistory(snapshot);
      return exportEncryptedBackup(snapshot, password);
    });
  }
  private async validateRestore(snapshot: EventSnapshot, before: EventSnapshot) {
    const incoming = replayHistory(snapshot), current = replayHistory(before);
    if (current.learning && !incoming.learning)
      throw new DomainError("AGGREGATE_BACKUP_REQUIRED", "النسخة الجزئية لا تشمل سجل التعلم الحالي؛ لم يُحذف التاريخ.");
    for (const unit of Object.values(incoming.learning?.units ?? {}))
      await this.access.authorize({ operation: "restore", unit: unit.definition });
  }
  async inspectBackup(serialized: string, password: string) {
    try {
      const before = await this.store.load();
      const result = await inspectEncryptedBackup(serialized, password, snapshot => this.validateRestore(snapshot, before));
      return { compatible: true, eventCount: result.eventCount,
        reason: "نسخة مشفرة متوافقة تشمل كامل السجل؛ الاستعادة استبدال كامل بعد التأكيد." };
    } catch (error) {
      return { compatible: false, eventCount: 0, reason: error instanceof Error ? error.message : "تعذر فحص النسخة." };
    }
  }
  replaceFromBackup(serialized: string, password: string, confirmed: boolean) {
    return this.serialize(async () => {
      const before = await this.store.load();
      await restoreEncryptedBackup(this.store, serialized, password, { confirmed,
        expectedRevision: before.revision, validateReplay: snapshot => this.validateRestore(snapshot, before) });
      return this.product.refresh();
    });
  }
  /** Existing explicit data-control action; never called by opening/read/replay. */
  reset(confirmed: boolean) {
    return this.serialize(async () => {
      if (!confirmed) throw new DomainError("CONSENT_REQUIRED", "يلزم تأكيد الحذف الكامل.");
      const before = await this.store.load(), current = replayHistory(before);
      const userId = crypto.randomUUID(), at = new Date().toISOString();
      const initialize = (scope: "product" | "hme", data: Record<string, unknown>): LearningEvent => {
        const id = crypto.randomUUID();
        return { eventId: id, commandId: id, operationId: id, userId, unitId: null,
          type: scope === "product" ? "ProfileInitialized" : "LearnerInitialized",
          occurredAt: at, receivedAt: at, zoneId: "Asia/Riyadh", source: "product", coverage: [],
          versions: scope === "product" ? VERSIONS : LEARNING_VERSIONS, data: { scope, ...data } };
      };
      const events = [initialize("product", { config: current.product.config, preferences: current.product.preferences })];
      if (current.learning) events.push(initialize("hme", {}));
      replayHistory({ revision: before.revision + 1, events });
      await this.store.replace(events, before.revision);
      return this.product.refresh();
    });
  }
  close() { this.store.close(); }
}
