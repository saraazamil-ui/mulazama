// @vitest-environment node
import { describe, expect, it } from "vitest";
import { HistoryApplication, replayHistory } from "./history-application";
import { ApplicationService } from "./service";
import { MemoryEventStore } from "../persistence/event-store";
import { historyFixture06d2 } from "../testing/history-fixture06d2";
import { createSyntheticLearningAccess } from "../testing/learning-access";
import { exportEncryptedBackup, inspectEncryptedBackup } from "../persistence/backup";
import type { EventStore } from "../core/types";

const password = "synthetic-history-password-06d2";
async function seeded() {
  const store = new MemoryEventStore();
  await store.replace(historyFixture06d2().events, 0);
  return store;
}
describe("06-D2 read-only aggregate history and durable product commands", () => {
  it("H01 new profile adds only product initialization, never a learning event or migration", async () => {
    const store = new MemoryEventStore(), app = await HistoryApplication.open(store);
    const before = await store.load();
    expect(before.events.map(event => event.type)).toEqual(["ProfileInitialized"]);
    await app.readProgress(); await app.readProgress();
    expect(await store.load()).toEqual(before);
    expect((await app.readProgress()).activity.hasEvidence).toBe(false);
  });
  it("H02 a 06-D1 product-only database is reopened byte-for-byte without new events", async () => {
    const store = new MemoryEventStore(), old = await ApplicationService.open(store);
    await old.dispatch({ type: "preferences", patch: { dark: true } });
    const before = await store.load(), app = await HistoryApplication.open(store);
    expect(app.product.state.preferences.dark).toBe(true);
    expect(await store.load()).toEqual(before);
  });
  it("H03 validated historical HME activity is readable while ALL execution gates remain blocked", async () => {
    const store = await seeded(), before = await store.load(), app = await HistoryApplication.open(store);
    const progress = await app.readProgress();
    expect(progress.activity.completedSessions).toBe(1);
    expect(progress.memorization.percent).toBeNull(); expect(progress.review.due).toBeNull();
    expect(progress.attempts[0].errors).toBe(1);
    expect(app.product.releaseGates.every(gate => gate.status !== "passed")).toBe(true);
    expect("learning" in app).toBe(false); expect("adapter" in app).toBe(false);
    await expect(app.product.dispatch({ type: "session.start", kind: "review", rangeLabel: "synthetic" })).rejects.toMatchObject({ code: "RELEASE_GATES_BLOCKED" });
    expect(await store.load()).toEqual(before);
  });
  it("H04 product writes preserve every raw HME event and exact learning versions", async () => {
    const store = await seeded(), before = await store.load(), app = await HistoryApplication.open(store);
    await app.product.dispatch({ type: "preferences", patch: { largeText: true } });
    expect((await store.load()).events.filter(event => event.data.scope === "hme")).toEqual(before.events.filter(event => event.data.scope === "hme"));
    expect((await app.readProgress()).activity.completedSessions).toBe(1);
    await expect(app.product.exportBackup(password)).rejects.toMatchObject({ code: "AGGREGATE_BACKUP_REQUIRED" });
    await expect(app.product.dispatch({ type: "reset" })).rejects.toMatchObject({ code: "AGGREGATE_BACKUP_REQUIRED" });
  });
  it("H05 export includes both complete streams even while learning execution is unavailable", async () => {
    const store = await seeded(), app = await HistoryApplication.open(store), before = await store.load();
    const backup = await app.exportBackup(password), inspected = await inspectEncryptedBackup(backup, password, replayHistory);
    expect(inspected.snapshot.events).toEqual(before.events);
    expect((await app.inspectBackup(backup, password)).compatible).toBe(false);
    await expect(app.replaceFromBackup(backup, password, true)).rejects.toMatchObject({ code: "RELEASE_GATES_BLOCKED" });
    expect(await store.load()).toEqual(before);
  });
  it("H06 a product-only restore cannot silently erase an existing HME stream", async () => {
    const partial = await ApplicationService.open(new MemoryEventStore()), backup = await partial.exportBackup(password);
    const store = await seeded(), app = await HistoryApplication.open(store), before = await store.load();
    expect((await app.inspectBackup(backup, password)).compatible).toBe(false);
    await expect(app.replaceFromBackup(backup, password, true)).rejects.toMatchObject({ code: "AGGREGATE_BACKUP_REQUIRED" });
    expect(await store.load()).toEqual(before);
  });
  it("H07 authorized isolated aggregate restore/reopen replays exactly, without duplicate completion", async () => {
    const store = await seeded(), unit = Object.values(replayHistory(await store.load()).learning!.units)[0].definition;
    const access = await createSyntheticLearningAccess([unit]), app = await HistoryApplication.open(store, { access });
    const before = await store.load(), original = await app.readProgress(), backup = await app.exportBackup(password);
    await app.product.dispatch({ type: "preferences", patch: { dark: true } });
    await app.replaceFromBackup(backup, password, true);
    await app.replaceFromBackup(backup, password, true);
    expect((await store.load()).events).toEqual(before.events);
    const reopened = await HistoryApplication.open(store);
    expect((await reopened.readProgress()).activity).toEqual(original.activity);
    expect((await reopened.readProgress()).attempts).toEqual(original.attempts);
  });
  it("H08 corrupt scope, user, duplicate event/command and incompatible versions fail without writes", async () => {
    const original = historyFixture06d2();
    for (const change of [
      (snapshot: typeof original) => { snapshot.events.at(-1)!.data.scope = "unknown"; },
      (snapshot: typeof original) => { snapshot.events.at(-1)!.userId = "different"; },
      (snapshot: typeof original) => { snapshot.events.push(snapshot.events[0]); },
      (snapshot: typeof original) => { snapshot.events.at(-1)!.commandId = snapshot.events[0].commandId; },
      (snapshot: typeof original) => { snapshot.events[1].operationId = "unrelated-operation"; },
      (snapshot: typeof original) => { snapshot.events[1].data.unrecognized = true; },
      (snapshot: typeof original) => { (snapshot.events[1] as unknown as Record<string, unknown>).unrecognized = true; },
      (snapshot: typeof original) => { snapshot.events.at(-1)!.versions = { ...snapshot.events.at(-1)!.versions, schema: 99 } as never; },
    ]) {
      const snapshot = structuredClone(original); change(snapshot);
      let writes = 0;
      const store: EventStore = { load: async () => snapshot,
        append: async () => { writes++; return snapshot; }, replace: async () => { writes++; return snapshot; },
        clear: async () => { writes++; }, close: () => undefined };
      await expect(HistoryApplication.open(store)).rejects.toThrow(); expect(writes).toBe(0);
    }
  });
  it("H09 wrong password/ciphertext and unconfirmed restore preserve product-only state", async () => {
    const store = new MemoryEventStore(), app = await HistoryApplication.open(store), before = await store.load();
    const backup = await app.exportBackup(password);
    await expect(app.replaceFromBackup(backup, password, false)).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    await expect(app.replaceFromBackup(backup, "incorrect-password-06d2", true)).rejects.toMatchObject({ code: "CONTENT_INTEGRITY_FAILURE" });
    expect(await store.load()).toEqual(before);
  });
  it("H10 product-only backup keeps old encrypted format and restores without a migration", async () => {
    const store = new MemoryEventStore(), app = await HistoryApplication.open(store);
    await app.product.dispatch({ type: "preferences", patch: { dark: true } });
    const before = await store.load(), backup = await app.exportBackup(password);
    await app.product.dispatch({ type: "preferences", patch: { dark: false } });
    await app.replaceFromBackup(backup, password, true);
    expect((await store.load()).events).toEqual(before.events);
    expect(app.product.state.preferences.dark).toBe(true);
  });
  it("H11 failed aggregate restore never advances displayed or stored facts", async () => {
    let fail = false;
    const store = new MemoryEventStore(() => { if (fail) throw Error("synthetic-write-failed"); });
    const app = await HistoryApplication.open(store), backup = await app.exportBackup(password);
    await app.product.dispatch({ type: "preferences", patch: { dark: true } });
    const before = await store.load(), state = app.product.state; fail = true;
    await expect(app.replaceFromBackup(backup, password, true)).rejects.toThrow("synthetic-write-failed");
    expect(await store.load()).toEqual(before); expect(app.product.state).toEqual(state);
  });
  it("H12 an explicitly queued refresh cannot roll back a later committed command", async () => {
    const root = new MemoryEventStore(); let delay = false, release: (() => void) | undefined, captured: (() => void) | undefined;
    const ready = new Promise<void>(resolve => { captured = resolve; });
    const store: EventStore = { load: async () => { const snapshot = await root.load();
      if (delay) { delay = false; captured!(); await new Promise<void>(resolve => { release = resolve; }); } return snapshot; },
      append: (events, rev) => root.append(events, rev), replace: (events, rev) => root.replace(events, rev),
      clear: rev => root.clear(rev), close: () => undefined };
    const app = await ApplicationService.open(store); delay = true;
    const refresh = app.refresh(); await ready;
    const write = app.dispatch({ type: "preferences", patch: { dark: true } });
    release!(); await refresh; await write;
    expect(app.state.preferences.dark).toBe(true);
    expect(app.revision).toBe((await root.load()).revision);
  });
  it("H13 a different product writer conflicts rather than overwrites aggregate history", async () => {
    const store = await seeded(), a = await HistoryApplication.open(store), b = await HistoryApplication.open(store);
    await a.product.dispatch({ type: "preferences", patch: { dark: true } });
    await expect(b.product.dispatch({ type: "preferences", patch: { largeText: true } })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await b.product.refresh();
    expect(b.product.state.preferences.dark).toBe(true);
    expect((await b.readProgress()).activity.completedSessions).toBe(1);
  });
  it("H14 raw history alone cannot authorize learning restore with a forged capability", async () => {
    await expect(HistoryApplication.open(new MemoryEventStore(), { access: { authorize: async () => undefined, summary: () => [] } })).rejects.toMatchObject({ code: "RELEASE_GATES_BLOCKED" });
  });
  it("H15 a product commit during aggregate restore makes the stale restore fail without erasing either stream", async () => {
    const root = await seeded();
    const unit = Object.values(replayHistory(await root.load()).learning!.units)[0].definition;
    const access = await createSyntheticLearningAccess([unit]);
    let reached!: () => void, release!: () => void;
    const ready = new Promise<void>(resolve => { reached = resolve; });
    const resume = new Promise<void>(resolve => { release = resolve; });
    const store: EventStore = { load: () => root.load(), append: (events, revision) => root.append(events, revision),
      replace: async (events, revision) => { reached(); await resume; return root.replace(events, revision); },
      clear: revision => root.clear(revision), close: () => undefined };
    const app = await HistoryApplication.open(store, { access }), before = await root.load();
    const backup = await app.exportBackup(password);
    const restoring = app.replaceFromBackup(backup, password, true);
    const rejection = expect(restoring).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await ready;
    await app.product.dispatch({ type: "preferences", patch: { dark: true } });
    const committed = await root.load();
    release(); await rejection;
    expect(await root.load()).toEqual(committed);
    expect(committed.events.slice(0, before.events.length)).toEqual(before.events);
    expect(app.product.state.preferences.dark).toBe(true);
    expect((await app.readProgress()).activity.completedSessions).toBe(1);
  });
});
