// @vitest-environment node
import { describe, it, expect } from "vitest";
import { LearningApplication } from "./learning";
import { LearningUiAdapter } from "./learning-ui-adapter";
import { MemoryEventStore } from "../persistence/event-store";
import { createSyntheticLearningAccess } from "../testing/learning-access";
const units = [
  {
    id: "test-a",
    editionId: "test-edition",
    probeProfileVersionId: "chunk-P0-1",
    words: 10,
    coverage: ["test:1:1", "test:1:2"],
  },
  {
    id: "test-b",
    editionId: "test-edition",
    probeProfileVersionId: "chunk-P0-1",
    words: 10,
    coverage: ["test:4:1"],
  },
];
async function setup() {
  const store = new MemoryEventStore(),
    access = await createSyntheticLearningAccess(units),
    app = await LearningApplication.open(store, { access }),
    adapter = new LearningUiAdapter(app);
  let time = Date.now() + 1000,
    n = 0;
  const options = () => ({
    commandId: `test-command-${++n}`,
    at: new Date((time += 1000)).toISOString(),
  });
  for (const unit of units) await adapter.register(unit, options());
  return { store, access, app, adapter, options };
}
describe("05C typed learning boundary — real HME with explicit synthetic access", () => {
  it("UIA01 repetitions use durable events, retain methodology version and never create recall evidence", async () => {
    const s = await setup();
    await s.adapter.send(
      { type: "start", unitId: "test-a", sessionId: "s" },
      s.options(),
    );
    const o = s.options();
    await s.adapter.send(
      { type: "repeat", sessionId: "s", mode: "reading" },
      o,
    );
    await s.adapter.send(
      { type: "repeat", sessionId: "s", mode: "reading" },
      o,
    );
    expect(s.adapter.state.sessions.s.repetitions).toBe(1);
    expect(s.adapter.state.units["test-a"].memory).toBeNull();
    expect(s.adapter.training("s")).toMatchObject({
      experimental: true,
      elapsedTimeProvided: false,
      reasonCode: "TRAINING_TIME_NOT_MEASURED",
    });
    expect(
      s.adapter.training("s", { elapsedMinutes: 20, fatigue: false }).next,
    ).toBe("rest");
    expect(s.adapter.progress().observed).toEqual([]);
  });
  it("UIA02 hints and nullable mistake drafts reach the HME manual evidence path", async () => {
    const s = await setup();
    await s.adapter.send(
      { type: "start", unitId: "test-a", sessionId: "s" },
      s.options(),
    );
    await s.adapter.send(
      { type: "recall", sessionId: "s", attemptId: "a" },
      s.options(),
    );
    await s.adapter.send(
      { type: "hint", sessionId: "s", reveal: true },
      s.options(),
    );
    await s.adapter.send(
      {
        type: "mistake",
        attemptId: "a",
        mistakeType: "word",
        location: null,
        certainty: "suspected",
      },
      s.options(),
    );
    await s.adapter.send(
      { type: "complete", sessionId: "s", termination: "completed" },
      s.options(),
    );
    await s.adapter.send(
      {
        type: "assess",
        attemptId: "a",
        observation: {
          attemptedWords: 10,
          errors: null,
          completion: "complete",
          effort: "normal",
          gapVerified: true,
        },
      },
      s.options(),
    );
    expect(s.adapter.state.attempts.a.hints).toBe(1);
    expect(s.adapter.state.attempts.a.assessment?.errors).toBeNull();
    expect(s.adapter.state.assessments.a.strictPass).not.toBe(true);
    expect(s.adapter.state.mistakes).toHaveLength(1);
  });
  it("UIA03 interrupted recall resumes through a new attempt, preserving exposure uncertainty and old hints", async () => {
    const s = await setup();
    await s.adapter.send(
      { type: "start", unitId: "test-a", sessionId: "s" },
      s.options(),
    );
    await s.adapter.send(
      { type: "recall", sessionId: "s", attemptId: "a" },
      s.options(),
    );
    await s.adapter.send(
      { type: "hint", sessionId: "s", reveal: true },
      s.options(),
    );
    await s.adapter.send({ type: "pause", sessionId: "s" }, s.options());
    const reopened = new LearningUiAdapter(
      await LearningApplication.open(s.store, { access: s.access }),
    );
    await expect(
      reopened.send({ type: "resume", sessionId: "s" }, s.options()),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_EVIDENCE" });
    await reopened.send(
      { type: "restart", sessionId: "s", attemptId: "b" },
      s.options(),
    );
    expect(reopened.state.attempts.a).toMatchObject({
      hints: 1,
      termination: "user_stop",
      assessment: null,
    });
    expect(reopened.state.attempts.b.gapUncertain).toBe(true);
    expect(reopened.state.units["test-a"].memory).toBeNull();
  });
  it.each([30, 60, 120])(
    "UIA04 %i-minute plans retain all actual units as planned/deferred without manufacturing reviews",
    async (minutes) => {
      const s = await setup();
      await s.adapter.replan(
        {
          minutes,
          spentMinutes: 10,
          at: s.options().at,
          costs: { "test-a": 3, "test-b": 100 },
          costModelVersion: "test-cost-v1",
        },
        s.options(),
      );
      const p = s.adapter.state.plans.at(-1)!;
      expect([...p.tasks, ...p.deferred].map((x) => x.unitId).sort()).toEqual([
        "test-a",
        "test-b",
      ]);
      expect(p.deferred.some((x) => x.unitId === "test-b")).toBe(true);
      expect(
        [...p.tasks, ...p.deferred].every((x) => x.outcome === "not_measured"),
      ).toBe(true);
      expect(s.adapter.state.attempts).toEqual({});
    },
  );
  it("UIA05 planner rejects missing costs; coverage preserves unassessed noncontiguous keys", async () => {
    const s = await setup(),
      rev = s.adapter.revision;
    await expect(
      s.adapter.replan(
        {
          minutes: 30,
          spentMinutes: 0,
          at: s.options().at,
          costs: { "test-a": 3 },
          costModelVersion: "test",
        },
        s.options(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(s.adapter.revision).toBe(rev);
    expect(s.adapter.progress().unassessed).toEqual([
      "test:1:1",
      "test:1:2",
      "test:4:1",
    ]);
  });
  it("UIA06 recovery records an explicit plan and does not fabricate failure, stable units or a completed review", async () => {
    const s = await setup();
    for (const absenceDays of [3, 21, 90])
      await s.adapter.send(
        { type: "recover", absenceDays, seed: 42, minutes: 30 },
        s.options(),
      );
    expect(s.adapter.state.recoveries.map((p) => p.target)).toEqual([
      3, 12, 24,
    ]);
    expect(s.adapter.progress().observed).toEqual([]);
    expect(s.adapter.state.units["test-b"].memory).toBeNull();
  });
  it("UIA07 manual correction rebuilds original-time evidence and exposes no direct rating/memory mutation", async () => {
    const s = await setup();
    await s.adapter.send(
      { type: "start", unitId: "test-a", sessionId: "s" },
      s.options(),
    );
    await s.adapter.send(
      { type: "recall", sessionId: "s", attemptId: "a" },
      s.options(),
    );
    await s.adapter.send(
      { type: "complete", sessionId: "s", termination: "completed" },
      s.options(),
    );
    const observation = {
      attemptedWords: 10,
      errors: 0,
      completion: "complete" as const,
      effort: "normal" as const,
      gapVerified: true,
    };
    await s.adapter.send(
      { type: "assess", attemptId: "a", observation },
      s.options(),
    );
    const time = s.adapter.state.units["test-a"].memory!.lastReviewAt;
    await s.adapter.send(
      {
        type: "correct",
        attemptId: "a",
        revision: 1,
        reason: "تصحيح العدد",
        observation: { ...observation, errors: 2 },
      },
      s.options(),
    );
    expect(s.adapter.state.units["test-a"].memory!.lastReviewAt).toBe(time);
    expect(s.adapter.state.assessments.a.strictPass).toBe(false);
    expect(Object.keys(s.adapter.state.attempts)).toHaveLength(1);
  });
  it("UIA08 failed durable append leaves the last confirmed UI projection and receipt intact", async () => {
    let fail = false;
    const store = new MemoryEventStore(() => {
        if (fail) throw new Error("disk-full-test");
      }),
      access = await createSyntheticLearningAccess(units),
      app = await LearningApplication.open(store, { access }),
      adapter = new LearningUiAdapter(app);
    await adapter.register(units[0], { commandId: "register" });
    await adapter.send(
      { type: "start", unitId: "test-a", sessionId: "s" },
      { commandId: "start" },
    );
    const before = adapter.state,
      revision = adapter.revision;
    fail = true;
    await expect(
      adapter.send(
        { type: "repeat", sessionId: "s", mode: "reading" },
        { commandId: "repeat" },
      ),
    ).rejects.toThrow("disk-full-test");
    expect(adapter.state).toEqual(before);
    expect(adapter.revision).toBe(revision);
  });
});
