import { describe, expect, it } from "vitest";
import {
  CONTRACT_NAMES,
  type PrototypeState,
  type RangeSelection,
} from "./contracts";
import {
  initialState,
  transition,
  currentRiyadhDate,
  effectiveBudget,
  type Action,
} from "./state";
import { normalizeRanges, validateRange } from "./ranges";
import {
  inspectBackup,
  loadPrototype,
  savePrototype,
  STORAGE_KEY,
  validatePrototypeState,
  type StoragePort,
} from "./storage";
import { mockContracts, mockDailyPlan } from "./mock";

const apply = (state: PrototypeState, action: Action) => {
  const result = transition(state, action);
  if (!result.ok) throw new Error(result.error);
  return result.state;
};
const setup = () => {
  const state = initialState();
  return apply(state, {
    type: "config",
    config: { ...state.config, configured: true },
  });
};
const range = (
  kind: RangeSelection["kind"],
  start: number,
  end = start,
  extras: Partial<RangeSelection> = {},
): RangeSelection => ({
  id: `${kind}-${start}-${end}`,
  kind,
  start,
  end,
  editionId: "prototype-unverified",
  status: "declared_unassessed",
  ...extras,
});
function memoryStorage(): StoragePort & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}
function recall(): PrototypeState {
  return apply(setup(), {
    type: "session.start",
    kind: "review",
    rangeLabel: "نطاق تجريبي",
  });
}

describe("declarations preserve scope and missingness", () => {
  it("R04 preserves separated selections without filling earlier or intervening ranges", () => {
    let state = initialState();
    state = apply(state, { type: "range.add", range: range("surah", 2) });
    state = apply(state, { type: "range.add", range: range("surah", 18) });
    expect(state.ranges.map((r) => r.start)).toEqual([2, 18]);
    expect(state.ranges.every((r) => r.status === "declared_unassessed")).toBe(
      true,
    );
  });
  it("deduplicates overlap only on same explicit axis; never merges pages across layouts", () => {
    const actual = normalizeRanges([
      range("ayah", 1, 5, { surah: 2 }),
      range("ayah", 3, 8, { surah: 2 }),
      range("ayah", 1, 5, { surah: 18 }),
      range("page", 1, 2, { layoutId: "edition-a" }),
      range("page", 1, 2, { layoutId: "edition-b" }),
    ]);
    expect(actual).toHaveLength(4);
    expect(actual.find((r) => r.kind === "ayah" && r.surah === 2)?.end).toBe(8);
  });
  it("accepts all declaration kinds but rejects reversed bounds, missing edition and invalid structural inputs", () => {
    expect(validateRange(range("surah", 114))).toBeNull();
    expect(validateRange(range("juz", 1, 30))).toBeNull();
    expect(
      validateRange(range("page", 2, 5, { layoutId: "pending-demo-layout" })),
    ).toBeNull();
    expect(validateRange(range("ayah", 2, 5, { surah: 2 }))).toBeNull();
    for (const r of [
      range("juz", 31),
      range("surah", 115),
      range("ayah", 5, 2, { surah: 2 }),
      range("page", 1),
      range("ayah", 1),
    ])
      expect(validateRange(r)).not.toBeNull();
  });
  it("cross-kind union never invents Quran coverage", () => {
    const state = { ...setup(), ranges: [range("surah", 2), range("juz", 1)] };
    const r = mockContracts.query("C09", { operation: "read" }, state);
    expect(r.ok && r.value.globalCoverage.value).toBeNull();
    expect(r.ok && r.value.parts[0].status).toBe("declared_unassessed");
    expect(r.ok && r.value.parts[1].status).toBe("not_measured");
  });
});
describe("safe interaction state", () => {
  it("today-only budget preserves habitual time, days, attempts and corrections", () => {
    const before = recall();
    const changed = apply(before, {
      type: "plan.todayBudget",
      minutes: 15,
      localDate: "2026-11-05",
    });
    expect(changed.todayBudget).toEqual({
      localDate: "2026-11-05",
      minutes: 15,
    });
    expect(changed.config).toEqual(before.config);
    expect(changed.attempts).toEqual(before.attempts);
    expect(changed.corrections).toEqual(before.corrections);
    expect(changed.revision).toBe(before.revision + 1);
    expect(effectiveBudget(changed, "2026-11-05")).toBe(15);
    expect(effectiveBudget(changed, "2026-11-06")).toBe(before.config.minutes);
  });
  it("today override survives storage and reset clears it", () => {
    const storage = memoryStorage();
    const state = apply(setup(), {
      type: "plan.todayBudget",
      minutes: 60,
      localDate: "2026-11-05",
    });
    expect(savePrototype(state, storage).ok).toBe(true);
    expect(loadPrototype(storage).state.todayBudget).toEqual(state.todayBudget);
    expect(apply(state, { type: "reset" }).todayBudget).toBeNull();
  });
  it("rejects malformed today budgets without modifying saved state", () => {
    const state = setup();
    for (const [minutes, localDate] of [
      [-1, "2026-11-05"],
      [1.5, "2026-11-05"],
      [1441, "2026-11-05"],
      [15, "2026-02-29"],
      [15, "2026-13-01"],
      [15, "tomorrow"],
    ] as const) {
      const result = transition(state, {
        type: "plan.todayBudget",
        minutes,
        localDate,
      });
      expect(result.ok).toBe(false);
      expect(result.state).toBe(state);
    }
    expect(
      validatePrototypeState({
        ...state,
        todayBudget: { localDate: "2026-02-30", minutes: 30 },
      }),
    ).toBe(false);
  });
  it("day boundary follows Riyadh instead of the host timezone", () => {
    expect(currentRiyadhDate(new Date("2026-11-05T20:59:59Z"))).toBe(
      "2026-11-05",
    );
    expect(currentRiyadhDate(new Date("2026-11-05T21:00:00Z"))).toBe(
      "2026-11-06",
    );
  });
  it("R03 rejects invalid config and retains previous state; zero today is accepted", () => {
    const state = setup();
    expect(
      transition(state, {
        type: "config",
        config: { ...state.config, days: [] },
      }).ok,
    ).toBe(false);
    expect(
      transition(state, {
        type: "config",
        config: { ...state.config, minutes: -1 },
      }).ok,
    ).toBe(false);
    expect(
      apply(state, { type: "config", config: { ...state.config, minutes: 0 } })
        .config.minutes,
    ).toBe(0);
    const paused = apply(state, {
      type: "config",
      config: { ...state.config, minutes: 0, days: [] },
    });
    expect(mockDailyPlan(paused).tasks).toEqual([]);
  });
  it("R08/R09 repetition is idempotent and never creates a recall or mastery", () => {
    let state = apply(setup(), {
      type: "session.start",
      kind: "new",
      rangeLabel: "تدريب تجريبي",
    });
    state = apply(state, { type: "session.repeat", commandId: "press-1" });
    const repeated = apply(state, {
      type: "session.repeat",
      commandId: "press-1",
    });
    expect(repeated.session?.repeats).toBe(1);
    expect(repeated.revision).toBe(state.revision);
    expect(repeated.attempts).toHaveLength(0);
    expect(
      transition(repeated, { type: "session.pause", commandId: "press-1" }).ok,
    ).toBe(false);
    expect(
      mockContracts.query("C06", { operation: "read" }, repeated),
    ).toMatchObject({ ok: true, value: { mastery: null } });
  });
  it("R10 starts review with hidden reference and unknown errors, never default zero", () => {
    const state = recall();
    expect(state.session?.phase).toBe("recall");
    expect(state.attempts[0]).toMatchObject({
      revealed: false,
      errorObservation: "unknown",
      completion: "unknown",
      strictPass: null,
      effectiveRating: null,
    });
  });
  it("R11 hints + easy remain raw conflicting report, with no effective rating or review event", () => {
    let state = apply(recall(), { type: "attempt.hint" });
    state = apply(state, { type: "attempt.finish" });
    state = apply(state, {
      type: "attempt.assess",
      input: {
        completion: "complete",
        errorObservation: "none",
        effort: "easy",
      },
    });
    expect(state.attempts[0]).toMatchObject({
      effort: "easy",
      hints: 1,
      status: "disputed",
      strictPass: null,
      effectiveRating: null,
    });
    expect(
      mockContracts.query(
        "C07",
        { operation: "read", attemptId: state.attempts[0].id },
        state,
      ),
    ).toMatchObject({
      ok: true,
      value: { strictPass: null, effectiveRating: null, reviewEvent: null },
    });
  });
  it("R12 incomplete mistake survives dialog cancellation and blocks zero-error assumption", () => {
    let state = recall();
    state = apply(state, {
      type: "mistake.add",
      draft: {
        attemptId: state.attempts[0].id,
        location: null,
        type: "unknown",
        certainty: "suspected",
        selfCorrected: null,
        assistanceUsed: null,
        note: "",
      },
    });
    state = apply(state, { type: "attempt.finish" });
    state = apply(state, {
      type: "attempt.assess",
      input: {
        completion: "complete",
        errorObservation: "none",
        effort: "normal",
      },
    });
    expect(state.mistakes[0]).toMatchObject({
      location: null,
      selfCorrected: null,
      assistanceUsed: null,
    });
    expect(state.attempts[0].status).toBe("disputed");
  });
  it("R22 interrupted recall creates new attempt and preserves original incomplete record", () => {
    let state = apply(recall(), { type: "attempt.reveal" });
    const originalId = state.attempts[0].id;
    state = apply(state, { type: "session.pause" });
    expect(transition(state, { type: "session.resume" }).ok).toBe(false);
    state = apply(state, { type: "session.restartRecall" });
    expect(state.attempts).toHaveLength(2);
    expect(state.attempts[0]).toMatchObject({
      id: originalId,
      status: "incomplete",
      revealed: true,
      termination: "user_stop",
    });
    expect(state.session?.attemptId).not.toBe(originalId);
  });
  it("S10 prior completion keeps time uncertainty even after explicit assessment", () => {
    let state = apply(recall(), { type: "session.pause" });
    state = apply(state, { type: "session.finishedBeforeStop" });
    state = apply(state, {
      type: "attempt.assess",
      input: {
        completion: "complete",
        errorObservation: "none",
        effort: "easy",
      },
    });
    expect(state.attempts[0]).toMatchObject({
      timingUnverified: true,
      status: "disputed",
    });
  });
  it("R25 correcting preserves original snapshot and does not create another attempt", () => {
    let state = apply(recall(), { type: "attempt.finish" });
    state = apply(state, {
      type: "attempt.assess",
      input: {
        completion: "complete",
        errorObservation: "none",
        effort: "easy",
      },
    });
    state = apply(state, {
      type: "attempt.correct",
      id: state.attempts[0].id,
      input: {
        completion: "partial",
        errorObservation: "present",
        effort: "hard",
      },
      reason: "تذكرت خطأ",
    });
    expect(state.attempts).toHaveLength(1);
    expect(state.corrections).toHaveLength(1);
    expect(state.corrections[0].previous).toMatchObject({ effort: "easy" });
    expect(state.attempts[0].effort).toBe("hard");
  });
  it("ending without assessment preserves incomplete, not memory failure", () => {
    const state = apply(recall(), { type: "session.end" });
    expect(state.session).toBeNull();
    expect(state.attempts[0]).toMatchObject({
      termination: "user_stop",
      status: "incomplete",
      effectiveRating: null,
    });
  });
  it("C03 retains outside review as a report without inventing review events", () => {
    const state = apply(setup(), { type: "recovery.report", value: "yes" });
    expect(state.attempts).toEqual([]);
    expect(
      mockContracts.query("C03", { operation: "gap" }, state),
    ).toMatchObject({ ok: true, value: { outsideReview: "yes" } });
    expect(inspectBackup(JSON.stringify(state)).state?.recoveryReport).toBe(
      "yes",
    );
  });
  it("reset removes learning and command receipts, retains preferences/config with new identity", () => {
    const before = apply(recall(), {
      type: "preferences",
      patch: { dark: true, reminder: true },
      commandId: "old-command",
    });
    const state = apply(before, { type: "reset" });
    expect(state.profileId).not.toBe(before.profileId);
    expect(state.attempts).toEqual([]);
    expect(state.ranges).toEqual([]);
    expect(state.session).toBeNull();
    expect(state.processedCommands).toEqual({});
    expect(state.preferences.dark).toBe(true);
    expect(state.config).toEqual(before.config);
  });
});
describe("prototype persistence safety", () => {
  it("R21/R22 roundtrip preserves confirmed counter and paused state", () => {
    let state = apply(setup(), {
      type: "session.start",
      kind: "new",
      rangeLabel: "مثال",
    });
    for (let i = 0; i < 4; i++)
      state = apply(state, { type: "session.repeat", commandId: `count-${i}` });
    state = apply(state, { type: "session.pause" });
    const storage = memoryStorage();
    expect(savePrototype(state, storage).ok).toBe(true);
    const loaded = loadPrototype(storage);
    expect(loaded.ok).toBe(true);
    expect(loaded.state.session).toMatchObject({
      repeats: 4,
      phase: "paused",
      previousPhase: "training",
    });
  });
  it("reloading active recall preserves its marker but requires S10 before more recitation", () => {
    const storage = memoryStorage();
    const state = apply(recall(), { type: "attempt.hint" });
    savePrototype(state, storage);
    const bytes = storage.getItem(STORAGE_KEY);
    const loaded = loadPrototype(storage);
    expect(loaded.state.session).toMatchObject({
      phase: "paused",
      previousPhase: "recall",
      attemptId: state.session?.attemptId,
    });
    expect(loaded.state.attempts[0].hints).toBe(1);
    expect(transition(loaded.state, { type: "attempt.finish" }).ok).toBe(false);
    expect(transition(loaded.state, { type: "session.resume" }).ok).toBe(false);
    expect(storage.getItem(STORAGE_KEY)).toBe(bytes);
  });
  it("R23 corrupt or foreign import cannot modify current storage", () => {
    const storage = memoryStorage();
    const state = recall();
    savePrototype(state, storage);
    const original = storage.getItem(STORAGE_KEY);
    for (const value of [
      "{broken",
      "{}",
      JSON.stringify({ ...state, schemaVersion: 2 }),
      JSON.stringify({
        ...state,
        attempts: [{ ...state.attempts[0], strictPass: true }],
      }),
    ])
      expect(inspectBackup(value).compatible).toBe(false);
    expect(storage.getItem(STORAGE_KEY)).toBe(original);
  });
  it("accepts explicit prototype backup envelope and rejects foreign wrapper versions", () => {
    const state = setup();
    expect(
      inspectBackup(
        JSON.stringify({ format: "itqan-prototype", version: 1, state }),
      ),
    ).toMatchObject({
      compatible: true,
      encrypted: false,
      productionBackup: false,
      state,
    });
    expect(
      inspectBackup(
        JSON.stringify({ format: "itqan-prototype", version: 2, state }),
      ).compatible,
    ).toBe(false);
  });
  it("rejects broken references rather than creating dangling session or correction", () => {
    const state = recall();
    expect(
      validatePrototypeState({
        ...state,
        session: { ...state.session, attemptId: "missing" },
      }),
    ).toBe(false);
    expect(
      validatePrototypeState({
        ...state,
        mistakes: [{ id: "x", attemptId: "missing" }],
      }),
    ).toBe(false);
  });
  it("write failure returns failure and leaves committed version intact", () => {
    const storage = memoryStorage();
    const old = setup();
    savePrototype(old, storage);
    const next = apply(old, { type: "preferences", patch: { dark: true } });
    const failure = savePrototype(next, {
      ...storage,
      setItem: () => {
        throw new Error("quota");
      },
    });
    expect(failure.ok).toBe(false);
    expect(loadPrototype(storage).state.preferences.dark).toBe(false);
  });
  it("invalid stored value is retained for recovery, never overwritten on load", () => {
    const storage = memoryStorage();
    storage.setItem(STORAGE_KEY, "not-json");
    expect(loadPrototype(storage).ok).toBe(false);
    expect(storage.getItem(STORAGE_KEY)).toBe("not-json");
  });
});
describe("contract boundary fixtures", () => {
  it("C04 uses matching day budget, preserves zero-day deferred source obligations, and ignores old override", () => {
    const before = setup();
    before.config.persona = "regular";
    const source = mockDailyPlan(before, "normal", "2026-11-05");
    const zero = apply(before, {
      type: "plan.todayBudget",
      minutes: 0,
      localDate: "2026-11-05",
    });
    const plan = mockDailyPlan(zero, "normal", "2026-11-05");
    expect(plan.tasks).toEqual([]);
    expect(plan.deferred).toHaveLength(
      source.tasks.length + source.deferred.length,
    );
    expect(plan.deferred.map((t) => t.originalDueAt)).toEqual(
      [...source.tasks, ...source.deferred].map((t) => t.originalDueAt),
    );
    expect(mockDailyPlan(zero, "normal", "2026-11-06").tasks).toHaveLength(
      source.tasks.length,
    );
    const sixty = apply(before, {
      type: "plan.todayBudget",
      minutes: 60,
      localDate: "2026-11-05",
    });
    expect(mockDailyPlan(sixty, "normal", "2026-11-05").plannedMinutes).toBe(
      49,
    );
    expect(mockDailyPlan(sixty, "normal", "2026-11-06").plannedMinutes).toBe(
      25,
    );
    expect(before.config.minutes).toBe(30);
  });
  it("has exact C01–C14 names and no real content, audio, model, or forecast", () => {
    const state = setup();
    expect(Object.keys(CONTRACT_NAMES)).toHaveLength(14);
    expect(
      mockContracts.query("C01", { operation: "read" }, state),
    ).toMatchObject({
      ok: true,
      value: { status: "unavailable", quranText: null },
    });
    expect(
      mockContracts.query("C10", { operation: "forecast" }, state),
    ).toMatchObject({
      ok: true,
      value: { status: "insufficient_data", initialCompletionDate: null },
    });
    expect(
      mockContracts.query("C11", { operation: "read" }, state),
    ).toMatchObject({ ok: true, value: { engineAvailable: false } });
    expect(
      mockContracts.query("C13", { operation: "read" }, state),
    ).toMatchObject({ ok: true, value: { scheduled: false } });
    expect(
      mockContracts.query("C14", { operation: "read" }, state),
    ).toMatchObject({ ok: true, value: { available: false } });
  });
  it("C04 fixture plans retain original due date independently of allocation", () => {
    const state = setup();
    state.config.persona = "regular";
    for (const [minutes, planned] of [
      [30, 25],
      [60, 49],
      [120, 97],
    ]) {
      const plan = mockDailyPlan({
        ...state,
        config: { ...state.config, minutes },
      });
      expect(plan.plannedMinutes).toBe(planned);
      expect(plan.tasks[0].originalDueAt).not.toBe(plan.tasks[0].plannedAt);
    }
    const plan = mockDailyPlan(state);
    expect(plan.deferred.length).toBeGreaterThan(0);
    expect(
      plan.deferred.every(
        (t) => t.plannedAt === null && t.originalDueAt !== null,
      ),
    ).toBe(true);
  });
  it("a saved task interaction advances prototype workflow without creating mastery or closing due dates", () => {
    const ready = setup();
    ready.config.persona = "regular";
    let state = apply(ready, {
      type: "session.start",
      kind: "review",
      rangeLabel: mockDailyPlan(ready).tasks[0].rangeLabel,
      taskId: "fixture-R1",
    });
    state = apply(state, { type: "attempt.finish" });
    state = apply(state, {
      type: "attempt.assess",
      input: {
        completion: "complete",
        errorObservation: "none",
        effort: "normal",
      },
    });
    const plan = mockDailyPlan(state);
    expect(plan.tasks[0]).toMatchObject({
      executionStatus: "performed",
      outcome: "not_measured",
      originalDueAt: "2026-11-03T09:00:00.000Z",
    });
    expect(plan.tasks[1].executionStatus).toBe("pending");
    expect(state.attempts[0].effectiveRating).toBeNull();
    const changedRange = apply(state, {
      type: "config",
      config: { ...state.config, startSurah: 2 },
    });
    expect(mockDailyPlan(changedRange).tasks[0].executionStatus).toBe(
      "pending",
    );
  });
  it("AC-S02 maintenance and complete Quran personas never receive new tasks", () => {
    const state = setup();
    for (const config of [
      {
        ...state.config,
        persona: "regular" as const,
        goal: "maintain" as const,
        minutes: 120,
      },
      { ...state.config, persona: "complete" as const, minutes: 120 },
    ]) {
      const plan = mockDailyPlan({ ...state, config });
      expect(
        [...plan.tasks, ...plan.deferred].some((t) => t.kind === "new"),
      ).toBe(false);
      expect(plan.plannedMinutes).toBe(69);
    }
  });
  it("AC02 beginner without declared memory starts new-training demo and has no invented repair or diagnostic", () => {
    const ready = setup();
    const plan = mockDailyPlan(ready);
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0]).toMatchObject({
      kind: "new",
      policyDueAt: null,
      originalDueAt: null,
    });
    expect(plan.plannedMinutes).toBeNull();
    expect(plan.deferred).toEqual([]);
    let state = apply(ready, {
      type: "session.start",
      kind: "new",
      rangeLabel: plan.tasks[0].rangeLabel,
      taskId: plan.tasks[0].id,
    });
    state = apply(state, { type: "session.startRecall" });
    state = apply(state, { type: "attempt.finish" });
    state = apply(state, {
      type: "attempt.assess",
      input: {
        completion: "complete",
        errorObservation: "none",
        effort: "normal",
      },
    });
    expect(
      mockDailyPlan(state).tasks.some((t) => t.executionStatus === "pending"),
    ).toBe(false);
  });
  it("forecast preview never mutates configuration", () => {
    const state = setup();
    const before = JSON.stringify(state);
    const result = mockContracts.query(
      "C10",
      { operation: "preview", minutes: 60 },
      state,
    );
    expect(result).toMatchObject({
      ok: true,
      value: { previewMinutes: 60, changesPlan: false },
    });
    expect(JSON.stringify(state)).toBe(before);
  });
});
