// @vitest-environment node
import { describe, expect, it } from "vitest";
import { LearningApplication } from "./learning";
import { LearningUiAdapter } from "./learning-ui-adapter";
import { MemoryEventStore } from "../persistence/event-store";
import { createSyntheticLearningAccess } from "../testing/learning-access";
import type { CanonicalUnit } from "./learning";

const units: CanonicalUnit[] = [
  { id: "test-range-a", editionId: "test-edition", words: 10, probeProfileVersionId: "chunk-P0-1", coverage: ["test:token1", "test:token2"] },
  { id: "test-range-b", editionId: "test-edition", words: 12, probeProfileVersionId: "chunk-P0-1", coverage: ["test:token2", "test:token4"] },
];
async function setup(definitions = units) {
  const store = new MemoryEventStore(), access = await createSyntheticLearningAccess(definitions);
  const app = await LearningApplication.open(store, { access }), adapter = new LearningUiAdapter(app);
  for (const unit of definitions) await app.send({ type: "UnitRegistered", unit });
  return { app, adapter, store };
}
describe("06-D2 coverage identity — no acquisition or goal approval inferred", () => {
  it("COV01 overlapping ranges union exact keys once without filling missing keys or using words as coverage", async () => {
    const s = await setup();
    expect(s.adapter.progress().registered).toEqual(["test:token1", "test:token2", "test:token4"]);
    expect(s.adapter.progress().strictlyPassedEver).toEqual([]);
    expect(s.adapter.progress().observed).toEqual([]);
  });
  it("COV02 identical key strings from different editions cannot silently collapse", async () => {
    const s = await setup([units[0], { ...units[1], editionId: "test-other-edition" }]);
    expect(() => s.adapter.progress()).toThrow(/طبعات مختلفة/);
    expect(Object.keys(s.app.state.units)).toHaveLength(2);
  });
  it("COV03 repeating a registration command is idempotent but duplicate units/keys are invalid", async () => {
    const store = new MemoryEventStore(), access = await createSyntheticLearningAccess(units);
    const app = await LearningApplication.open(store, { access });
    const s = { app, store };
    await s.app.send({ type: "UnitRegistered", unit: units[0] }, { commandId: "test-register" });
    const before = await s.store.load();
    await s.app.send({ type: "UnitRegistered", unit: units[0] }, { commandId: "test-register" });
    expect(await s.store.load()).toEqual(before);
    await expect(s.app.send({ type: "UnitRegistered", unit: units[0] })).rejects.toThrow();
    await expect(s.app.send({ type: "UnitRegistered", unit: { ...units[1], coverage: ["test:duplicate", "test:duplicate"] } })).rejects.toThrow();
  });
  it("COV04 a corrected incomplete observation withdraws derived passed coverage without deleting raw facts", async () => {
    const s = await setup();
    await s.app.send({ type: "SessionStarted", unitId: units[0].id, sessionId: "test-session" });
    await s.app.send({ type: "RecallAttemptStarted", sessionId: "test-session", attemptId: "test-attempt" });
    await s.app.send({ type: "RecallAttemptCompleted", sessionId: "test-session", termination: "completed" });
    const observation = { attemptedWords: 10, errors: 0, completion: "complete" as const, effort: "normal" as const, gapVerified: false };
    await s.app.send({ type: "AssessmentSubmitted", attemptId: "test-attempt", observation });
    expect(s.adapter.progress().strictlyPassedEver).toEqual(units[0].coverage);
    const before = await s.store.load();
    await s.app.send({ type: "AssessmentCorrected", attemptId: "test-attempt", expectedAssessmentRevision: 1, reason: "synthetic correction", observation: { ...observation, completion: "partial", attemptedWords: 5 } });
    expect(s.adapter.progress().strictlyPassedEver).toEqual([]);
    expect((await s.store.load()).events.slice(0, before.events.length)).toEqual(before.events);
    expect(s.adapter.progress().registered).toEqual(["test:token1", "test:token2", "test:token4"]);
  });
});
