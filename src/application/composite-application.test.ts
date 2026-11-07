// @vitest-environment node
import { describe, it, expect } from "vitest";
import { CompositeApplication, replayComposite } from "./composite-application";
import { ApplicationService } from "./service";
import { MemoryEventStore } from "../persistence/event-store";
import { createSyntheticLearningAccess } from "../testing/learning-access";
import { currentRiyadhDate } from "../domain/state";
import type { EventStore } from "../core/types";
const unit = {
  id: "test-composite-unit",
  editionId: "test-composite-edition",
  probeProfileVersionId: "chunk-P0-1",
  words: 10,
  coverage: ["test:composite:1"],
};
const password = "composite-long-test-password-2026";
async function setup(store: EventStore = new MemoryEventStore()) {
  const access = await createSyntheticLearningAccess([unit]),
    app = await CompositeApplication.open(store, { access });
  await app.product.dispatch({
    type: "config",
    config: { ...app.product.state.config, minutes: 60, configured: true },
  });
  await app.adapter.register(unit, { commandId: crypto.randomUUID() });
  await app.adapter.send(
    { type: "start", unitId: unit.id, sessionId: "test-session" },
    { commandId: crypto.randomUUID(), expectedRevision: app.adapter.revision },
  );
  await app.adapter.send(
    { type: "repeat", sessionId: "test-session", mode: "reading" },
    { commandId: crypto.randomUUID(), expectedRevision: app.adapter.revision },
  );
  return { app, store, access };
}
describe("05C unified product/learning backup and configuration — atomic reference store", () => {
  it("CA01 one encrypted backup restores both raw streams, identities and original-time receipts without duplication", async () => {
    const { app, store } = await setup(),
      original = await store.load(),
      state = replayComposite(original),
      backup = await app.exportBackup(password);
    expect(state.product.profileId).toBe(state.learning.userId);
    await app.product.dispatch({
      type: "preferences",
      patch: { dark: !state.product.preferences.dark },
    });
    await app.adapter.send(
      { type: "repeat", sessionId: "test-session", mode: "reading" },
      { commandId: crypto.randomUUID() },
    );
    expect((await app.inspectBackup(backup, password)).compatible).toBe(true);
    await app.replaceFromBackup(backup, password, true);
    expect((await store.load()).events).toEqual(original.events);
    expect(app.product.state).toEqual(state.product);
    expect(app.adapter.state).toEqual(state.learning);
    await app.replaceFromBackup(backup, password, true);
    expect((await store.load()).events).toEqual(original.events);
  });
  it("CA02 partial product backup is rejected before writing a composite database", async () => {
    const { app, store } = await setup(),
      standalone = await ApplicationService.open(new MemoryEventStore()),
      partial = await standalone.exportBackup(password),
      before = await store.load();
    expect((await app.inspectBackup(partial, password)).compatible).toBe(false);
    await expect(
      app.replaceFromBackup(partial, password, true),
    ).rejects.toMatchObject({ code: "AGGREGATE_BACKUP_REQUIRED" });
    expect(await store.load()).toEqual(before);
  });
  it("CA03 wrong password and modified ciphertext preserve both streams unchanged", async () => {
    const { app, store } = await setup(),
      backup = await app.exportBackup(password),
      before = await store.load(),
      file = JSON.parse(backup);
    file.ciphertext =
      (file.ciphertext[0] === "A" ? "B" : "A") + file.ciphertext.slice(1);
    await expect(
      app.replaceFromBackup(backup, "different-password-long-2026", true),
    ).rejects.toMatchObject({ code: "CONTENT_INTEGRITY_FAILURE" });
    await expect(
      app.replaceFromBackup(JSON.stringify(file), password, true),
    ).rejects.toMatchObject({ code: "CONTENT_INTEGRITY_FAILURE" });
    expect(await store.load()).toEqual(before);
  });
  it("CA04 failed atomic replacement leaves both original streams and displayed projections intact", async () => {
    let fail = false;
    const store = new MemoryEventStore(() => {
        if (fail) throw new Error("replace-failed-test");
      }),
      { app } = await setup(store),
      backup = await app.exportBackup(password);
    await app.adapter.send(
      { type: "repeat", sessionId: "test-session", mode: "reading" },
      { commandId: crypto.randomUUID() },
    );
    const before = await store.load(),
      p = app.product.state,
      h = app.adapter.state;
    fail = true;
    await expect(app.replaceFromBackup(backup, password, true)).rejects.toThrow(
      "replace-failed-test",
    );
    expect(await store.load()).toEqual(before);
    expect(app.product.state).toEqual(p);
    expect(app.adapter.state).toEqual(h);
  });
  it("CA05 a concurrent product write during restore triggers CAS and preserves that write plus the live learning stream", async () => {
    const root = new MemoryEventStore();
    let beforeReplace: (() => Promise<void>) | null = null;
    const store: EventStore = {
      load: () => root.load(),
      append: (events, revision) => root.append(events, revision),
      replace: async (events, revision) => {
        if (beforeReplace) {
          const hook = beforeReplace;
          beforeReplace = null;
          await hook();
        }
        return root.replace(events, revision);
      },
      clear: (revision) => root.clear(revision),
      close: () => root.close(),
    };
    const { app } = await setup(store),
      backup = await app.exportBackup(password);
    beforeReplace = async () => {
      await app.product.dispatch({
        type: "preferences",
        patch: { dark: true },
      });
    };
    await expect(
      app.replaceFromBackup(backup, password, true),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    const after = replayComposite(await root.load());
    expect(after.product.preferences.dark).toBe(true);
    expect(after.learning.sessions["test-session"].repetitions).toBe(1);
  });
  it("CA06 standalone scoped export/restore/reset cannot omit or erase the peer stream", async () => {
    const { app, store } = await setup(),
      before = await store.load();
    await expect(app.product.exportBackup(password)).rejects.toMatchObject({
      code: "AGGREGATE_BACKUP_REQUIRED",
    });
    await expect(
      app.product.replaceFromBackup("{}", password, true),
    ).rejects.toMatchObject({ code: "AGGREGATE_BACKUP_REQUIRED" });
    await expect(app.product.dispatch({ type: "reset" })).rejects.toMatchObject(
      { code: "AGGREGATE_BACKUP_REQUIRED" },
    );
    expect(await store.load()).toEqual(before);
  });
  it("CA07 user configuration and today override reach replan with explicit spent time and cost instead of fixture values", async () => {
    const { app } = await setup(),
      at = new Date().toISOString();
    await app.product.dispatch({
      type: "plan.todayBudget",
      minutes: 15,
      localDate: currentRiyadhDate(new Date(at)),
    });
    await app.adapter.replanFromProduct(
      {
        at,
        spentMinutes: 5,
        costs: { [unit.id]: 20 },
        costModelVersion: "test-explicit-estimate",
      },
      {
        commandId: crypto.randomUUID(),
        expectedRevision: app.adapter.revision,
      },
    );
    const plan = app.adapter.state.plans.at(-1)!;
    expect(plan.minutes).toBe(15);
    expect(plan.spentMinutes).toBe(5);
    expect(plan.tasks).toHaveLength(0);
    expect(plan.deferred.map((x) => x.unitId)).toContain(unit.id);
    expect(plan.deferred[0].outcome).toBe("not_measured");
  });
  it("CA08 reset clears BOTH histories atomically and retains settings under one fresh identity", async () => {
    const { app, store } = await setup(),
      oldId = app.product.state.profileId;
    await app.product.dispatch({ type: "preferences", patch: { dark: true } });
    await expect(app.reset(false)).rejects.toMatchObject({
      code: "CONSENT_REQUIRED",
    });
    await app.reset(true);
    const reset = replayComposite(await store.load());
    expect((await store.load()).events).toHaveLength(2);
    expect(reset.product.profileId).not.toBe(oldId);
    expect(reset.product.profileId).toBe(reset.learning.userId);
    expect(reset.product.config.minutes).toBe(60);
    expect(reset.product.preferences.dark).toBe(true);
    expect(reset.learning.units).toEqual({});
    expect(reset.learning.sessions).toEqual({});
    expect(reset.product.ranges).toEqual([]);
  });
  it("CA09 concurrent writes within the SAME scope conflict instead of being silently merged", async () => {
    const { app, store, access } = await setup(),
      other = await CompositeApplication.open(store, { access });
    await app.product.dispatch({ type: "preferences", patch: { dark: true } });
    await expect(
      other.product.dispatch({
        type: "preferences",
        patch: { largeText: true },
      }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(
      replayComposite(await store.load()).product.preferences.largeText,
    ).toBe(false);
  });
});
