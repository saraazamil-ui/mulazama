import { projectProgress } from "../progress/projection";
import type { ProgressReadModel } from "../progress/projection";
import { ApplicationService, replayProduct } from "./service";
import { LearningApplication, replayLearning, learningSchedulingMode } from "./learning";
import type { LearningCommand, LearningProjection } from "./learning";
import { LearningUiAdapter } from "./learning-ui-adapter";
import type { EventStore, EventSnapshot, LearningEvent } from "../core/types";
import {
  canonical,
  DomainError,
  VERSIONS,
  LEARNING_VERSIONS,
  type LearningSchedulingMode,
  learningVersionsFor,
} from "../core/types";
import {
  exportEncryptedBackup,
  inspectEncryptedBackup,
  restoreEncryptedBackup,
  validateBackupSnapshot,
} from "../persistence/backup";
import type { LearningReleaseAccess } from "../release/access";
import { createRuntimeLearningAccess } from "../release/runtime";
import type { PrototypeState } from "../domain/contracts";

type Scope = "product" | "hme";
function scoped(snapshot: EventSnapshot, scope: Scope): EventSnapshot {
  return {
    revision: snapshot.revision,
    events: snapshot.events.filter((e) => e.data.scope === scope),
  };
}
/** Both domains live in ONE atomic EventStore. A scoped service cannot replace/clear the other domain. */
class ScopedEventStore implements EventStore {
  readonly backupScope = "aggregate-only" as const;
  private fingerprints = new Map<number, string>();
  constructor(
    private readonly root: EventStore,
    private readonly scope: Scope,
  ) {}
  private remember(snapshot: EventSnapshot) {
    const view = scoped(snapshot, this.scope);
    this.fingerprints.set(snapshot.revision, canonical(view.events));
    if (this.fingerprints.size > 32)
      this.fingerprints.delete(this.fingerprints.keys().next().value!);
    return view;
  }
  async load() {
    return this.remember(await this.root.load());
  }
  async append(events: LearningEvent[], expectedRevision: number) {
    if (events.some((e) => e.data.scope !== this.scope))
      throw new DomainError(
        "REFERENCE_MISMATCH",
        "محاولة كتابة واقعة خارج نطاقها.",
      );
    const snapshot = await this.root.load();
    // Another domain may have advanced the aggregate revision. Only its unchanged
    // peer stream may be merged; concurrent changes in our own stream still conflict.
    if (
      snapshot.revision !== expectedRevision &&
      this.fingerprints.get(expectedRevision) !==
        canonical(scoped(snapshot, this.scope).events)
    )
      throw new DomainError(
        "REVISION_CONFLICT",
        "تغير سجل هذا النطاق؛ أعد تحميل الحالة.",
      );
    return this.remember(await this.root.append(events, snapshot.revision));
  }
  async replace(
    _events: LearningEvent[],
    _expectedRevision: number,
  ): Promise<EventSnapshot> {
    throw new DomainError(
      "AGGREGATE_BACKUP_REQUIRED",
      "استبدال البيانات يتطلب النسخة الموحدة التي تشمل الإعداد والتعلم معًا.",
    );
  }
  async clear(_expectedRevision: number): Promise<void> {
    throw new DomainError(
      "AGGREGATE_BACKUP_REQUIRED",
      "حذف البيانات يتطلب العملية الموحدة؛ لم يُحذف أي سجل.",
    );
  }
  close() {} // The aggregate owner closes the shared physical store exactly once.
}
export interface CompositeDataController {
  readProgress?(now?: Date): Promise<ProgressReadModel>;
  exportBackup(password: string): Promise<string>;
  inspectBackup(
    serialized: string,
    password: string,
  ): Promise<{ compatible: boolean; reason: string; eventCount: number }>;
  replaceFromBackup(
    serialized: string,
    password: string,
    confirmed: boolean,
  ): Promise<PrototypeState>;
  reset(confirmed: boolean): Promise<PrototypeState>;
}
/** Strictly validate both raw domains before any aggregate replacement. A single-
 * domain backup cannot silently erase a learning stream, or settings, by omission. */
export function replayComposite(snapshot: EventSnapshot) {
  validateBackupSnapshot(snapshot);
  if (
    snapshot.events.some(
      (e) => !["product", "hme"].includes(e.data.scope as string),
    )
  )
    throw new DomainError(
      "UNSUPPORTED_VERSION",
      "النسخة تحتوي نطاقًا غير مدعوم.",
    );
  const product = scoped(snapshot, "product"),
    learning = scoped(snapshot, "hme");
  if (!product.events.length || !learning.events.length)
    throw new DomainError(
      "AGGREGATE_BACKUP_REQUIRED",
      "النسخة الموحدة يجب أن تحتوي سجل الإعداد والتعلم كاملين.",
    );
  const result = {
    product: replayProduct(product),
    learning: replayLearning(learning),
  };
  if (result.product.profileId !== result.learning.userId)
    throw new DomainError(
      "REFERENCE_MISMATCH",
      "هوية التعلم لا تطابق ملف الإعداد في النسخة الموحدة.",
    );
  return result;
}
/** Engineering integration owner. Instantiation grants no release access. */
export class CompositeApplication implements CompositeDataController {
  product!: ApplicationService;
  learning!: LearningApplication;
  adapter!: LearningUiAdapter;
  private queue: Promise<unknown> = Promise.resolve();
  private constructor(
    private readonly store: EventStore,
    private readonly access: LearningReleaseAccess,
  ) {}
  static async open(
    store: EventStore,
    options: { access?: LearningReleaseAccess; scheduling?: LearningSchedulingMode } = {},
  ) {
    const access = options.access ?? (await createRuntimeLearningAccess()),
      app = new CompositeApplication(store, access),
      before = await store.load();
    validateBackupSnapshot(before);
    if (
      before.events.some(
        (e) => !["product", "hme"].includes(e.data.scope as string),
      )
    )
      throw new DomainError(
        "UNSUPPORTED_VERSION",
        "قاعدة البيانات تحتوي نطاقًا غير مدعوم.",
      );
    const p = scoped(before, "product"),
      h = scoped(before, "hme");
    if (h.events.length && !p.events.length)
      throw new DomainError(
        "AGGREGATE_BACKUP_REQUIRED",
        "سجل تعلم منفرد يحتاج نقلًا صريحًا مع إعداداته.",
      );
    if (p.events.length) replayProduct(p);
    if (h.events.length) replayComposite(before);
    app.product = await ApplicationService.open(
      new ScopedEventStore(store, "product"),
    );
    app.learning = await LearningApplication.open(
      new ScopedEventStore(store, "hme"),
      { access, userId: app.product.state.profileId, scheduling: options.scheduling },
    );
    await app.product.refresh();
    app.adapter = new LearningUiAdapter(
      {
        get state() {
          return app.learning.state;
        },
        get revision() {
          return app.learning.revision;
        },
        send: (command, sendOptions) => app.sendLearning(command, sendOptions),
        refresh: async () => {
          await app.refresh();
          return app.learning.state;
        },
      },
      app.product,
    );
    return app;
  }
  private serialize<T>(run: () => Promise<T>) {
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }
  async refresh() {
    await this.product.refresh();
    await this.learning.refresh();
  }
  sendLearning(
    command: LearningCommand,
    options: Parameters<LearningApplication["send"]>[1],
  ): Promise<LearningProjection> {
    return this.serialize(async () => {
      const before = canonical(this.learning.state),
        revision = this.learning.revision;
      await this.product.refresh();
      await this.learning.refresh();
      if (
        options?.expectedRevision !== undefined &&
        (options.expectedRevision !== revision ||
          before !== canonical(this.learning.state))
      )
        throw new DomainError(
          "REVISION_CONFLICT",
          "تغير سجل التعلم؛ أعد تحميل الحالة.",
        );
      return this.learning.send(command, {
        ...options,
        ...(options?.expectedRevision !== undefined
          ? { expectedRevision: this.learning.revision }
          : {}),
      });
    });
  }
  /** Reads both durable streams without granting release access or storing ratios. */
  readProgress(now?: Date): Promise<ProgressReadModel> {
    return this.serialize(async () => {
      const snapshot = await this.store.load();
      return projectProgress(snapshot, now ?? new Date());
    });
  }
  readPersonalMemory(now?: Date) {
    return this.serialize(async () => {
      const { projectPersonalMemory } = await import("../memory/personal-memory");
      return projectPersonalMemory(await this.store.load(), now ?? new Date());
    });
  }
  exportBackup(password: string) {
    return this.serialize(async () => {
      const snapshot = await this.store.load();
      replayComposite(snapshot);
      return exportEncryptedBackup(snapshot, password);
    });
  }
  async inspectBackup(serialized: string, password: string) {
    try {
      const info = await inspectEncryptedBackup(
        serialized,
        password,
        replayComposite,
      );
      return {
        compatible: true,
        reason:
          "نسخة موحدة مشفرة تشمل الإعداد ووقائع التعلم؛ الاستعادة استبدال ذري كامل.",
        eventCount: info.eventCount,
      };
    } catch (e) {
      return {
        compatible: false,
        reason: e instanceof Error ? e.message : "تعذر فحص النسخة.",
        eventCount: 0,
      };
    }
  }
  replaceFromBackup(serialized: string, password: string, confirmed: boolean) {
    return this.serialize(async () => {
      const before = await this.store.load();
      await restoreEncryptedBackup(this.store, serialized, password, {
        confirmed,
        expectedRevision: before.revision,
        validateReplay: async (snapshot) => {
          const { learning } = replayComposite(snapshot);
          const versions = learningVersionsFor(learningSchedulingMode(snapshot));
          await this.access.authorize({ operation: "restore-scheduler", versions });
          for (const unit of Object.values(learning.units))
            await this.access.authorize({
              operation: "restore",
              unit: unit.definition, versions,
            });
        },
      });
      await this.product.refresh();
      await this.learning.reloadDataProjection();
      return this.product.state;
    });
  }
  reset(confirmed: boolean) {
    return this.serialize(async () => {
      if (!confirmed)
        throw new DomainError("CONSENT_REQUIRED", "يلزم تأكيد الحذف الكامل.");
      const before = await this.store.load(),
        current = replayComposite(before).product,
        at = new Date().toISOString(),
        profileId = crypto.randomUUID();
      function init(
        type: string,
        scope: Scope,
        versions: LearningEvent["versions"],
        data: Record<string, unknown>,
      ): LearningEvent {
        const id = crypto.randomUUID();
        return {
          eventId: id,
          commandId: id,
          operationId: id,
          userId: profileId,
          unitId: null,
          type,
          occurredAt: at,
          receivedAt: at,
          zoneId: "Asia/Riyadh",
          source: "product",
          coverage: [],
          versions,
          data: { scope, ...data },
        };
      }
      const events = [
        init("ProfileInitialized", "product", VERSIONS, {
          config: current.config,
          preferences: current.preferences,
        }),
        init("LearnerInitialized", "hme", this.learning.versions, {}),
      ];
      replayComposite({ revision: before.revision + 1, events });
      await this.store.replace(events, before.revision);
      await this.product.refresh();
      await this.learning.reloadDataProjection();
      return this.product.state;
    });
  }
  close() {
    this.store.close();
  }
}
