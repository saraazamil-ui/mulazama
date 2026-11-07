// @vitest-environment node
import { describe, expect, it } from "vitest";
import { projectPersonalMemory } from "./personal-memory";
import { replayHistory } from "../application/history-application";
import type { LearningCommand } from "../application/learning";
import { historyFixture06d2 } from "../testing/history-fixture06d2";
import { canonical, LEARNING_VERSIONS, type EventSnapshot, type LearningEvent } from "../core/types";
import { MemoryEventStore } from "../persistence/event-store";
import { exportEncryptedBackup, restoreEncryptedBackup } from "../persistence/backup";

const base = "2030-01-01T20:59:00.000Z", now = new Date("2030-01-31T00:00:00.000Z");
const unitId = "synthetic-history-unit", sessionId = "synthetic-history-session", attemptId = "synthetic-history-attempt";
const observation = { completion: "complete" as const, attemptedWords: 10, errors: 1, effort: "normal" as const, gapVerified: false };
const fixture = () => historyFixture06d2(base);
function append(snapshot: EventSnapshot, command: LearningCommand, options: { at?: string; zone?: string; unit?: string | null; coverage?: string[] } = {}) {
  const id = `synthetic-memory-event-${snapshot.events.length}`;
  const at = options.at ?? new Date(Date.parse(snapshot.events.at(-1)!.occurredAt) + 1000).toISOString();
  const linked = command.type !== "UnitRegistered" && command.type !== "PlanRecomputed" && command.type !== "RecoveryStarted" && !(command.type === "ProductMistakeDraftRecorded" && command.attemptId === null);
  const event: LearningEvent = { eventId: id, commandId: id, operationId: id, userId: snapshot.events[0].userId,
    unitId: linked ? options.unit ?? unitId : null, type: command.type, occurredAt: at, receivedAt: at,
    zoneId: options.zone ?? "Asia/Riyadh", source: command.type.startsWith("Assessment") ? "V1" : "product",
    coverage: linked ? options.coverage ?? ["synthetic:history:token1", "synthetic:history:token2"] : [],
    versions: LEARNING_VERSIONS, data: { scope: "hme", command: structuredClone(command) } };
  snapshot.events.push(event); snapshot.revision++;
  return event;
}
const read = (snapshot: EventSnapshot) => projectPersonalMemory(snapshot, now);
describe("06-E1 factual personal memory foundation — synthetic, read-only and non-predictive", () => {
  it("MEM01 product-only new user has no fabricated unit, history or acquisition date", () => {
    const snapshot = fixture(); snapshot.events = snapshot.events.slice(0, 1); snapshot.revision = 1;
    const before = canonical(snapshot), result = read(snapshot);
    expect(result.units).toEqual([]);
    expect(result.unlinkedMistakeEventIds).toEqual([]);
    expect(result.meta.sourceEventCount).toBe(1);
    expect(canonical(snapshot)).toBe(before);
  });
  it("MEM02 registration alone is no attempt or documented memorization", () => {
    const snapshot = fixture(); snapshot.events = snapshot.events.slice(0, 3); snapshot.revision = 3;
    const unit = read(snapshot).units[0];
    expect(unit.registration).toEqual({ eventId: snapshot.events[2].eventId, registeredAt: base });
    expect(unit.documentedMemorization).toMatchObject({ status: "unavailable", at: null });
    expect(unit.counts).toEqual({ attempts: 0, assessed: 0, ended: 0, corrections: 0 });
    expect(unit.dataAvailability.status).toBe("no-attempts");
    expect(unit.scheduling.status).toBe("no-eligible-observations");
  });
  it("MEM03 a stored assessment exposes provenance and observed facts, never model predictions", () => {
    const snapshot = fixture(), unit = read(snapshot).units[0], attempt = unit.attempts[0];
    expect(attempt.latestObservation).toMatchObject({ errors: 1, attemptedWords: 10, at: base });
    expect(attempt.assessmentHistory[0]).toMatchObject({ eventId: snapshot.events[6].eventId, effectiveReviewAt: base, kind: "submitted", revision: 1 });
    expect(attempt.sourceEventIds).toContain(snapshot.events[2].eventId);
    expect(attempt.sourceEventIds.every(id => snapshot.events.some(event => event.eventId === id))).toBe(true);
    expect(unit.scheduling).toMatchObject({ status: "requires-explicit-rebuild", futureSchedule: "unavailable", interpretation: "historical-provenance-only" });
    expect(unit.scheduling.sourceVersions[0].fsrsImplementation).toBe(LEARNING_VERSIONS.fsrsImplementation);
    expect(unit.dataAvailability.predictiveSufficiency).toBe("not-established");
    for (const forbidden of ['"stability":', '"difficulty":', '"rawDueAt":', '"retrievability":', '"mastery":'])
      expect(JSON.stringify(unit)).not.toContain(forbidden);
  });
  it("MEM04 correction retains original observation, reason, IDs and original effective review time", () => {
    const snapshot = fixture(), before = structuredClone(snapshot.events);
    const correction = append(snapshot, { type: "AssessmentCorrected", attemptId, expectedAssessmentRevision: 1,
      reason: "تصحيح صناعي لا يضيف تسميعًا", observation: { ...observation, errors: 0 } }, { at: "2030-01-10T00:00:00.000Z" });
    const unit = read(snapshot).units[0], attempt = unit.attempts[0];
    expect(unit.counts).toEqual({ attempts: 1, assessed: 1, ended: 1, corrections: 1 });
    expect(attempt.assessmentHistory.map(item => item.reportedObservation.errors)).toEqual([1, 0]);
    expect(attempt.assessmentHistory[1]).toMatchObject({ eventId: correction.eventId, recordedAt: correction.occurredAt,
      effectiveReviewAt: base, reason: "تصحيح صناعي لا يضيف تسميعًا", revision: 2 });
    expect(attempt.startedAt).toBe(base);
    expect(attempt.latestObservation!.errors).toBe(0);
    expect(snapshot.events.slice(0, before.length)).toEqual(before);
  });
  it("MEM05 unknown observations stay unknown and withdraw eligibility without dropping assessment history", () => {
    const snapshot = fixture();
    append(snapshot, { type: "AssessmentCorrected", attemptId, expectedAssessmentRevision: 1, reason: "غير معلوم",
      observation: { ...observation, errors: null, attemptedWords: null, completion: "unknown", effort: "unknown" } });
    const unit = read(snapshot).units[0];
    expect(unit.attempts[0].latestObservation!.errors).toBeNull();
    expect(unit.attempts[0].assessmentHistory).toHaveLength(2);
    expect(unit.dataAvailability).toMatchObject({ status: "observations-present",
      missingLatestFields: { unassessed: 0, errors: 1, attemptedWords: 1, completion: 1, effort: 1 } });
    expect(unit.scheduling.status).toBe("no-eligible-observations");
  });
  it("MEM06 unfinished and restarted attempts remain visible with shared opportunity, exposure uncertainty and no assessments", () => {
    const snapshot = fixture(); snapshot.events = snapshot.events.slice(0, 5); snapshot.revision = 5;
    append(snapshot, { type: "HintUsed", sessionId, reveal: true });
    const restart = append(snapshot, { type: "RecallAttemptRestarted", sessionId, attemptId: "synthetic-restart" });
    const unit = read(snapshot).units[0];
    expect(unit.counts).toEqual({ attempts: 2, assessed: 0, ended: 1, corrections: 0 });
    expect(unit.attempts[0]).toMatchObject({ termination: "user_stop", hints: 1, revealed: true, endedAt: restart.occurredAt });
    expect(unit.attempts[0].sourceEventIds).toContain(restart.eventId);
    expect(unit.attempts[1]).toMatchObject({ endedAt: null, firstAttemptInOpportunity: false, exposureGapUncertain: true, millisecondsSinceRelevantExposure: 0 });
    expect(unit.attempts[1].lastRelevantExposureEventId).toBe(restart.eventId);
    expect(unit.evidenceIdentity.opportunityIds).toEqual([attemptId]);
    expect(unit.evidenceIdentity.clusterIds).toEqual([attemptId]);
    expect(unit.dataAvailability.status).toBe("unassessed-only");
  });
  it("MEM07 capture zones and crossing Riyadh midnight do not turn two elapsed minutes into one day", () => {
    const snapshot = fixture();
    append(snapshot, { type: "RecallAttemptStarted", sessionId, attemptId: "synthetic-after-midnight" }, { at: "2030-01-01T21:01:00.000Z", zone: "America/New_York" });
    const unit = read(snapshot).units[0];
    expect(unit.attempts[1].captureZoneId).toBe("America/New_York");
    expect(unit.attempts[1].millisecondsSincePreviousAttempt).toBe(120000);
    expect(unit.attempts[1].millisecondsSinceRelevantExposure).toBe(120000);
    expect(unit.attempts[1].lastRelevantExposureEventId).toBe(snapshot.events[5].eventId);
    const changedZone = structuredClone(snapshot); changedZone.events.at(-1)!.zoneId = "Pacific/Auckland";
    expect(read(changedZone).units[0].attempts[1].millisecondsSincePreviousAttempt).toBe(120000);
  });
  it("MEM08 retry at the store is idempotent; duplicate raw imports fail rather than inflate a profile", async () => {
    const snapshot = fixture(), store = new MemoryEventStore();
    await store.replace(snapshot.events, 0); const before = await store.load();
    await store.append([snapshot.events.at(-1)!], before.revision);
    expect(await store.load()).toEqual(before);
    expect(read(await store.load()).units[0].counts.assessed).toBe(1);
    const duplicate = structuredClone(snapshot); duplicate.events.push(structuredClone(duplicate.events.at(-1)!));
    expect(() => read(duplicate)).toThrow();
  });
  it("MEM09 corrupted identity, versions, correction revision and duplicate command fail without mutation", () => {
    const snapshot = fixture();
    for (const mutate of [
      (value: EventSnapshot) => { value.events.at(-1)!.userId = "unrelated-user"; },
      (value: EventSnapshot) => { value.events.at(-1)!.versions = { ...LEARNING_VERSIONS, fsrsImplementation: "unknown-engine" } as never; },
      (value: EventSnapshot) => { value.events.at(-1)!.operationId = "unrelated-operation"; },
      (value: EventSnapshot) => { append(value, { type: "AssessmentCorrected", attemptId, expectedAssessmentRevision: 7, reason: "stale", observation }); },
    ]) {
      const invalid = structuredClone(snapshot); mutate(invalid); const raw = canonical(invalid);
      expect(() => read(invalid)).toThrow(); expect(canonical(invalid)).toBe(raw);
    }
  });
  it("MEM10 repeated rebuilds are canonical, detached from input and deterministic for equal timestamps", () => {
    const snapshot = fixture(), before = canonical(snapshot), first = read(snapshot);
    expect(canonical(read(structuredClone(snapshot)))).toBe(canonical(first));
    first.units[0].definition.coverage.push("mutated-result");
    first.units[0].attempts[0].assessmentHistory[0].reportedObservation.errors = 99;
    expect(canonical(snapshot)).toBe(before);
    expect(read(snapshot).units[0].attempts[0].latestObservation!.errors).toBe(1);
    append(snapshot, { type: "RecallAttemptStarted", sessionId, attemptId: "0-same-time" }, { at: base });
    const attempts = read(snapshot).units[0].attempts;
    expect(attempts.map(attempt => attempt.attemptId)).toEqual([attemptId, "0-same-time"]);
    expect(attempts[1].millisecondsSincePreviousAttempt).toBe(0);
  });
  it("MEM11 overlapping keys and different editions keep separate profile identities", () => {
    const snapshot = fixture();
    append(snapshot, { type: "UnitRegistered", unit: { id: "synthetic-other", editionId: "synthetic-other-edition",
      probeProfileVersionId: "chunk-P0-1", words: 10, coverage: ["synthetic:history:token1"] } });
    const result = read(snapshot);
    expect(result.units).toHaveLength(2);
    expect(result.units.map(unit => unit.identity.editionId)).toEqual(["synthetic-history-edition", "synthetic-other-edition"]);
    expect(result.units.map(unit => unit.counts.attempts)).toEqual([1, 0]);
    expect(result.units.every(unit => unit.documentedMemorization.at === null)).toBe(true);
  });
  it("MEM12 unlinked mistake drafts are never assigned to a unit by guessing", () => {
    const snapshot = fixture();
    const unlinked = append(snapshot, { type: "ProductMistakeDraftRecorded", attemptId: null, mistakeType: "word", location: "موضع غير مربوط", certainty: "suspected" });
    const linked = append(snapshot, { type: "ProductMistakeDraftRecorded", attemptId, mistakeType: "link", location: "موضع مربوط صناعي", certainty: "disputed" });
    const result = read(snapshot);
    expect(result.unlinkedMistakeEventIds).toEqual([unlinked.eventId]);
    expect(result.units[0].attempts[0].reportedMistakes).toEqual([{ eventId: linked.eventId, type: "link", location: "موضع مربوط صناعي", certainty: "disputed" }]);
    expect(result.units[0].attempts[0].sourceEventIds).toContain(linked.eventId);
  });
  it("MEM13 encrypted full restore rebuilds identical unit facts while the storage receipt may advance", async () => {
    const snapshot = fixture();
    append(snapshot, { type: "AssessmentCorrected", attemptId, expectedAssessmentRevision: 1, reason: "تصحيح محفوظ", observation: { ...observation, errors: 0 } });
    const store = new MemoryEventStore(); await store.replace(snapshot.events, 0);
    const original = await store.load(), expected = read(original), password = "memory-foundation-test-password";
    const serialized = await exportEncryptedBackup(original, password);
    const replacement = new MemoryEventStore();
    await restoreEncryptedBackup(replacement, serialized, password, { confirmed: true, expectedRevision: 0, validateReplay: replayHistory });
    const restored = await replacement.load();
    expect(restored.events).toEqual(original.events);
    expect(read(restored).units).toEqual(expected.units);
    expect(read(restored).profileId).toBe(expected.profileId);
  });
  it("MEM14 future or invalid read time never applies future corrections to a past profile", () => {
    const snapshot = fixture();
    append(snapshot, { type: "AssessmentCorrected", attemptId, expectedAssessmentRevision: 1, reason: "تاريخ لاحق", observation: { ...observation, errors: 0 } });
    expect(() => projectPersonalMemory(snapshot, new Date(base))).toThrow(/بعد وقت/);
    expect(() => projectPersonalMemory(snapshot, new Date("invalid"))).toThrow(/وقت قراءة/);
  });
  it("MEM15 a registered exposure is traceable and a later normal session end does not invent a new exposure", () => {
    const snapshot = fixture(); snapshot.events = snapshot.events.slice(0, 4); snapshot.revision = 4;
    const exposure = append(snapshot, { type: "RepetitionCompleted", sessionId, mode: "reading" });
    append(snapshot, { type: "RecallAttemptStarted", sessionId, attemptId });
    const completed = append(snapshot, { type: "RecallAttemptCompleted", sessionId, termination: "completed" });
    append(snapshot, { type: "AssessmentSubmitted", attemptId, observation });
    append(snapshot, { type: "SessionEnded", sessionId });
    append(snapshot, { type: "SessionStarted", sessionId: "synthetic-next-session", unitId });
    append(snapshot, { type: "RecallAttemptStarted", sessionId: "synthetic-next-session", attemptId: "synthetic-next-attempt" });
    const unit = read(snapshot).units[0];
    expect(unit.attempts[0].lastRelevantExposureEventId).toBe(exposure.eventId);
    expect(unit.attempts[0].sourceEventIds).toContain(exposure.eventId);
    expect(unit.sourceEventIds).toContain(exposure.eventId);
    expect(unit.attempts[1].lastRelevantExposureEventId).toBe(completed.eventId);
    expect(unit.attempts[1].lastRelevantExposureAt).toBe(completed.occurredAt);
  });
});
