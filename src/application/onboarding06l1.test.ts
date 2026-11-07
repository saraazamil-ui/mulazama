// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { HistoryApplication, replayHistory } from "./history-application";
import type { OnboardingSubmission } from "./service";
import { MemoryEventStore } from "../persistence/event-store";
import type { EventStore } from "../core/types";
import { historyFixture06d2 } from "../testing/history-fixture06d2";

async function setup(store: EventStore = new MemoryEventStore()) {
  const app = await HistoryApplication.open(store);
  const input: OnboardingSubmission = { commandId: "onboard-example", config: { ...app.product.state.config, persona: "returning", goal: "maintain", configured: true }, ranges: [
    { id: "declared-a", kind: "juz", start: 1, end: 3, editionId: "prototype-unverified", status: "declared_unassessed" },
    { id: "declared-b", kind: "juz", start: 3, end: 5, editionId: "prototype-unverified", status: "declared_unassessed" },
  ] };
  return { app, input, store };
}

describe("06-L1 transactional initial setup through real aggregate owner", () => {
  it("L1O01 commits declarations and config in one append, replays and reopens without fabricating learning", async () => {
    const { app, input, store } = await setup();
    const before = await store.load(), append = vi.spyOn(store, "append");
    const state = await app.product.configureOnboarding(input);
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0][0].map(event => event.type)).toEqual(["PriorKnowledgeDeclared", "PriorKnowledgeDeclared", "UserPlanConfigRevised"]);
    const after = await store.load();
    expect(after.events.slice(0, before.events.length)).toEqual(before.events);
    expect(new Set(after.events.map(event => event.commandId)).size).toBe(after.events.length);
    expect(state.ranges.map(range => [range.start, range.end, range.status])).toEqual([[1, 5, "declared_unassessed"]]);
    expect(replayHistory(after).product).toEqual(state);
    expect((await HistoryApplication.open(store)).product.state).toEqual(state);
    expect((await app.readProgress()).memorization.percent).toBeNull();
    expect((await app.readProgress()).review.due).toBeNull();
    expect(state.attempts).toEqual([]);
    await expect(app.product.dispatch({ type: "session.start", kind: "review", rangeLabel: "declared" })).rejects.toMatchObject({ code: "RELEASE_GATES_BLOCKED" });
  });
  it("L1O02 a failed commit leaves the whole profile unchanged; retry writes only once", async () => {
    let fail = false;
    const store = new MemoryEventStore(() => { if (fail) throw Error("storage full"); });
    const { app, input } = await setup(store), before = await store.load(); fail = true;
    await expect(app.product.configureOnboarding(input)).rejects.toThrow("storage full");
    expect(await store.load()).toEqual(before); expect(app.product.state.config.configured).toBe(false); expect(app.product.state.ranges).toEqual([]);
    fail = false; await app.product.configureOnboarding(input);
    const saved = await store.load(); await app.product.configureOnboarding(input);
    expect(await store.load()).toEqual(saved);
    await expect(app.product.configureOnboarding({ ...input, config: { ...input.config, minutes: 99 } })).rejects.toMatchObject({ code: "EVENT_CONFLICT" });
    await expect(app.product.configureOnboarding({ ...input, ranges: input.ranges.slice(0, 1) })).rejects.toMatchObject({ code: "EVENT_CONFLICT" });
    expect(await store.load()).toEqual(saved);
  });
  it("L1O03 interrupted acknowledgement is reconciled on retry without duplicate events", async () => {
    const root = new MemoryEventStore(); let interrupt = false;
    const store: EventStore = { load: root.load.bind(root), replace: root.replace.bind(root), clear: root.clear.bind(root), close() {},
      append: async (events, revision) => { const result = await root.append(events, revision); if (interrupt) { interrupt = false; throw Error("ack interrupted"); } return result; } };
    const { app, input } = await setup(store); interrupt = true;
    await expect(app.product.configureOnboarding(input)).rejects.toThrow("ack interrupted");
    const committed = await root.load(); expect(app.product.state.config.configured).toBe(false);
    await app.product.configureOnboarding(input);
    expect(await root.load()).toEqual(committed); expect(app.product.state.config.configured).toBe(true);
  });
  it("L1O04 invalid second declaration is rejected before any event is written", async () => {
    const { app, input, store } = await setup(); const before = await store.load();
    input.ranges[1].end = 31;
    await expect(async () => app.product.configureOnboarding(input)).rejects.toThrow();
    expect(await store.load()).toEqual(before);
    await expect(async () => app.product.configureOnboarding({ ...input, ranges: [], commandId: undefined as never })).rejects.toThrow();
    expect(await store.load()).toEqual(before);
  });
  it("L1O05 existing declarations are retained and an existing configured profile cannot be overwritten", async () => {
    const { app, input, store } = await setup();
    await app.product.dispatch({ type: "range.add", range: { ...input.ranges[0], id: "original", start: 20, end: 20 } });
    const before = await store.load(); await app.product.configureOnboarding(input);
    expect((await store.load()).events.slice(0, before.events.length)).toEqual(before.events);
    expect(app.product.state.ranges.map(range => [range.start, range.end])).toEqual([[1, 5], [20, 20]]);
    const saved = await store.load();
    await expect(app.product.configureOnboarding({ ...input, commandId: "different" })).rejects.toThrow();
    expect(await store.load()).toEqual(saved);
  });
  it("L1O06 input mutation after submission cannot alter a queued write", async () => {
    const { app, input } = await setup(); const promise = app.product.configureOnboarding(input);
    input.config.minutes = 999; input.ranges[0].start = 90;
    await promise;
    expect(app.product.state.config.minutes).toBe(30); expect(app.product.state.ranges[0].start).toBe(1);
  });
  it("L1O07 a product-only backup restores all setup events exactly and remains idempotent", async () => {
    const { app, input, store } = await setup(); await app.product.configureOnboarding(input);
    const before = await store.load(), password = "synthetic-06l1-restore-password";
    const backup = await app.exportBackup(password);
    await app.product.dispatch({ type: "preferences", patch: { largeText: true } });
    await app.replaceFromBackup(backup, password, true);
    expect((await store.load()).events).toEqual(before.events);
    await app.product.configureOnboarding(input);
    expect((await store.load()).events).toEqual(before.events);
  });
  it("L1O08 retained HME events remain byte-for-byte identical during initial setup", async () => {
    const root = new MemoryEventStore(); const fixture = historyFixture06d2();
    // Fixture includes no initial product config event; all HME evidence is synthetic.
    await root.replace(fixture.events, 0);
    const { app, input } = await setup(root), before = await root.load();
    expect(app.product.state.config.configured).toBe(false);
    await app.product.configureOnboarding(input);
    expect((await root.load()).events.filter(event => event.data.scope === "hme")).toEqual(before.events.filter(event => event.data.scope === "hme"));
    expect((await app.readPersonalMemory()).units.length).toBeGreaterThan(0);
  });
});
