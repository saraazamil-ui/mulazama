// @vitest-environment node
import { describe, expect, it } from "vitest";
import { projectProgress } from "./projection";
import { CompositeApplication } from "../application/composite-application";
import { ApplicationService } from "../application/service";
import type { LearningCommand } from "../application/learning";
import { MemoryEventStore } from "../persistence/event-store";
import { createSyntheticLearningAccess } from "../testing/learning-access";
import { LEARNING_VERSIONS, VERSIONS } from "../core/types";
import type { EventStore } from "../core/types";

const unit = { id: "test-progress-unit", editionId: "test-progress-edition", probeProfileVersionId: "chunk-P0-1", words: 10, coverage: ["test:progress:1"] };
const observation = { attemptedWords: 10, errors: 0, completion: "complete" as const, effort: "normal" as const, gapVerified: true };
const base = Date.parse("2030-11-06T12:00:00.000Z");
async function setup(store: EventStore = new MemoryEventStore()) {
  const access = await createSyntheticLearningAccess([unit]);
  const app = await CompositeApplication.open(store, { access });
  let clock = base;
  const send = (command: LearningCommand, commandId?: string, at?: string) => {
    clock = at ? Date.parse(at) : clock + 1000;
    return app.learning.send(command, { at: new Date(clock).toISOString(), ...(commandId ? { commandId } : {}) });
  };
  await send({ type: "UnitRegistered", unit });
  return { app, store, access, send, now: () => new Date(clock + 1000) };
}
async function completed(s: Awaited<ReturnType<typeof setup>>, sessionId = "test-progress-session", attemptId = "test-progress-attempt", newSession = true) {
  if (newSession) await s.send({ type: "SessionStarted", sessionId, unitId: unit.id });
  await s.send({ type: "RecallAttemptStarted", sessionId, attemptId });
  await s.send({ type: "RecallAttemptCompleted", sessionId, termination: "completed" });
  await s.send({ type: "AssessmentSubmitted", attemptId, observation });
}
const read = async (s: Awaited<ReturnType<typeof setup>>) => s.app.readProgress(s.now());
const clone = <T,>(value: T): T => structuredClone(value);

describe("06-D1 committed event progress — explicitly isolated synthetic learning fixtures", () => {
  it("P01 new product-only user needs no migration and has unknown ratios, not a fabricated zero", async () => {
    const store = new MemoryEventStore(), app = await ApplicationService.open(store), before = await store.load();
    const model = app.readProgress();
    expect(model.activity.hasEvidence).toBe(false);
    expect(model.days).toEqual([]);
    expect(model.daily.completedSessions).toBeNull();
    expect(model.daily.percent).toBeNull();
    expect(model.memorization).toMatchObject({ completed: null, target: null, percent: null });
    expect(model.review).toMatchObject({ due: null, completed: null, overdue: null });
    expect(await store.load()).toEqual(before);
  });
  it("P02 absent/changed user goal and declared partial/full Quran ranges never become verified coverage", async () => {
    const app = await ApplicationService.open(new MemoryEventStore());
    const initial = app.readProgress().memorization;
    for (const goal of ["memorize", "maintain"] as const) {
      await app.dispatch({ type: "config", config: { ...app.state.config, configured: true, goal } });
      await app.dispatch({ type: "range.add", range: { id: `declared-${goal}`, kind: "juz", start: 1, end: goal === "memorize" ? 7 : 30, editionId: "prototype-unverified", status: "declared_unassessed" } });
      expect(app.readProgress().memorization).toEqual(initial);
    }
  });
  it("P03 opening, reading, repetition and unassessed completion cannot count as completed sessions", async () => {
    const s = await setup();
    await s.send({ type: "SessionStarted", sessionId: "s", unitId: unit.id });
    await s.send({ type: "RepetitionCompleted", sessionId: "s", mode: "reading" });
    await s.send({ type: "RecallAttemptStarted", sessionId: "s", attemptId: "a" });
    await s.send({ type: "RecallAttemptCompleted", sessionId: "s", termination: "completed" });
    expect((await read(s)).activity).toMatchObject({ hasEvidence: false, completedSessions: 0, assessedAttempts: 0 });
  });
  it("P04 committed assessment updates counts with original-time provenance and does not invent task percentages", async () => {
    const s = await setup(); await completed(s);
    const model = await read(s), snapshot = await s.store.load();
    expect(model.activity).toMatchObject({ hasEvidence: true, assessedAttempts: 1, completedSessions: 1, last7Days: 1, last30Days: 1 });
    expect(model.daily.completedSessions).toBe(1);
    expect(model.daily.percent).toBeNull();
    expect(model.attempts[0].sourceEventIds).toContain(snapshot.events.find(e => e.type === "AssessmentSubmitted")!.eventId);
    expect(model.attempts[0].sourceEventIds.every(id => snapshot.events.some(e => e.eventId === id))).toBe(true);
    expect(model.review.completed).toBeNull();
  });
  it("P05 repeated attempts in a session count once; a distinct session is activity, not independent memory evidence", async () => {
    const s = await setup(); await completed(s);
    await completed(s, "test-progress-session", "a2", false);
    await s.send({ type: "SessionEnded", sessionId: "test-progress-session" });
    await completed(s, "s2", "a3");
    const model = await read(s);
    expect(model.activity.assessedAttempts).toBe(3);
    expect(model.activity.completedSessions).toBe(2);
    expect(model.stability.status).toBe("unavailable");
  });
  it("P06 errors/hints affect reported performance but do not erase execution or create mastery", async () => {
    const s = await setup();
    await s.send({ type: "SessionStarted", sessionId: "s", unitId: unit.id });
    await s.send({ type: "RecallAttemptStarted", sessionId: "s", attemptId: "a" });
    await s.send({ type: "HintUsed", sessionId: "s", reveal: true });
    await s.send({ type: "RecallAttemptCompleted", sessionId: "s", termination: "completed" });
    await s.send({ type: "AssessmentSubmitted", attemptId: "a", observation: { ...observation, errors: 2 } });
    const model = await read(s);
    expect(model.activity.completedSessions).toBe(1);
    expect(model.attempts[0]).toMatchObject({ errors: 2, hints: 1, revealed: true });
    expect(model.memorization.completed).toBeNull();
    expect(model.stability.status).toBe("unavailable");
  });
  it("P07 correction to partial retracts the session on its original date without adding a session on correction day", async () => {
    const s = await setup(); await completed(s);
    await s.send({ type: "AssessmentCorrected", attemptId: "test-progress-attempt", expectedAssessmentRevision: 1, reason: "تصحيح النطاق", observation: { ...observation, completion: "partial", attemptedWords: 5 } }, undefined, "2030-11-07T13:00:00.000Z");
    const model = await read(s);
    expect(model.activity).toMatchObject({ assessedAttempts: 1, completedSessions: 0 });
    expect(model.days).toEqual([{ localDate: "2030-11-06", assessedAttempts: 1, completedSessions: 0 }]);
    expect(model.attempts[0].revision).toBe(2);
    expect(model.attempts[0].sourceEventIds).toContain((await s.store.load()).events.at(-1)!.eventId);
  });
  it("P08 interrupted/abandoned sessions and incomplete or unknown scope are not successful execution", async () => {
    for (const mode of ["stopped", "unknown", "missing-words"] as const) {
      const s = await setup();
      await s.send({ type: "SessionStarted", sessionId: "s", unitId: unit.id });
      await s.send({ type: "RecallAttemptStarted", sessionId: "s", attemptId: "a" });
      if (mode === "stopped") await s.send({ type: "SessionEnded", sessionId: "s" });
      else await s.send({ type: "RecallAttemptCompleted", sessionId: "s", termination: "completed" });
      await s.send({ type: "AssessmentSubmitted", attemptId: "a", observation: { ...observation, completion: mode === "unknown" ? "unknown" : "complete", attemptedWords: mode === "missing-words" ? null : 10, errors: null } });
      const model = await read(s);
      expect(model.activity).toMatchObject({ assessedAttempts: 1, completedSessions: 0 });
      expect(model.attempts[0].errors).toBeNull();
    }
  });
  it("P09 exact event re-delivery does not double count and conflicts fail before any mutation", async () => {
    const s = await setup(); await completed(s);
    const original = await s.store.load(), duplicate = clone(original);
    duplicate.events.push(clone(duplicate.events.at(-1)!));
    expect(projectProgress(duplicate, s.now())).toEqual(projectProgress(original, s.now()));
    duplicate.events.at(-1)!.receivedAt = "2030-11-07T00:00:00.000Z";
    expect(() => projectProgress(duplicate, s.now())).toThrow(/متعارض/);
    expect(await s.store.load()).toEqual(original);
  });
  it("P10 retrying a command leaves both persisted evidence and displayed counts unchanged", async () => {
    const s = await setup(); await completed(s);
    const command: LearningCommand = { type: "AssessmentCorrected", attemptId: "test-progress-attempt", expectedAssessmentRevision: 1, reason: "خطأ مسجل", observation: { ...observation, errors: 1 } };
    await s.send(command, "test-progress-once"); const before = await s.store.load();
    await s.send(command, "test-progress-once");
    expect(await s.store.load()).toEqual(before);
    expect((await read(s)).activity.assessedAttempts).toBe(1);
    expect((await read(s)).activity.completedSessions).toBe(1);
  });
  it("P11 invalid payloads, mixed user identity and unsupported legacy evidence fail closed", async () => {
    const s = await setup(); await completed(s); const original = await s.store.load();
    const malformed = clone(original); malformed.events.at(-1)!.data.command = { type: "AssessmentSubmitted", attemptId: "test-progress-attempt", observation: { ...observation, errors: -1 } };
    expect(() => projectProgress(malformed, s.now())).toThrow();
    const identity = clone(original); identity.events.filter(e => e.data.scope === "hme").forEach(e => { e.userId = "different-profile"; });
    expect(() => projectProgress(identity, s.now())).toThrow(/هوية/);
    const legacy = clone(original); legacy.events.filter(e => e.data.scope === "hme").forEach(e => { e.versions = VERSIONS; });
    expect(() => projectProgress(legacy, s.now())).toThrow(/هجرة/);
    expect(await s.store.load()).toEqual(original);
  });
  it("P12 refresh/reopen yields identical facts from the same committed stream", async () => {
    const s = await setup(); await completed(s); const before = await read(s);
    const reopened = await CompositeApplication.open(s.store, { access: s.access });
    await reopened.refresh();
    expect(await reopened.readProgress(s.now())).toEqual(before);
  });
  it("P13 encrypted aggregate restore rebuilds corrected indicators and preserves the exact original raw events", async () => {
    const s = await setup(); await completed(s);
    const before = await s.store.load(), model = await read(s), at = s.now();
    const backup = await s.app.exportBackup("progress-restore-test-password-2026");
    await s.send({ type: "AssessmentCorrected", attemptId: "test-progress-attempt", expectedAssessmentRevision: 1, reason: "اختبار الاستعادة", observation: { ...observation, completion: "partial", attemptedWords: 4 } });
    expect((await read(s)).activity.completedSessions).toBe(0);
    await s.app.replaceFromBackup(backup, "progress-restore-test-password-2026", true);
    const restored = await s.app.readProgress(at);
    expect(restored.activity).toEqual(model.activity);
    expect(restored.attempts).toEqual(model.attempts);
    expect((await s.store.load()).events).toEqual(before.events);
  });
  it("P14 storage failure never adds an uncommitted assessment to progress", async () => {
    let fail = false;
    const store = new MemoryEventStore(() => { if (fail) throw Error("test-disk-failure"); }), s = await setup(store);
    await s.send({ type: "SessionStarted", sessionId: "s", unitId: unit.id });
    await s.send({ type: "RecallAttemptStarted", sessionId: "s", attemptId: "a" });
    await s.send({ type: "RecallAttemptCompleted", sessionId: "s", termination: "completed" });
    const before = await store.load(); fail = true;
    await expect(s.send({ type: "AssessmentSubmitted", attemptId: "a", observation })).rejects.toThrow("test-disk-failure");
    expect((await read(s)).activity.hasEvidence).toBe(false);
    expect(await store.load()).toEqual(before);
  });
  it("P15 Riyadh midnight uses completion time and rolling seven/thirty days have exact inclusive bounds", async () => {
    const s = await setup();
    await s.send({ type: "SessionStarted", sessionId: "s", unitId: unit.id }, undefined, "2030-11-06T20:59:55.000Z");
    await s.send({ type: "RecallAttemptStarted", sessionId: "s", attemptId: "a" }, undefined, "2030-11-06T20:59:56.000Z");
    await s.send({ type: "RecallAttemptCompleted", sessionId: "s", termination: "completed" }, undefined, "2030-11-06T20:59:59.000Z");
    await s.send({ type: "AssessmentSubmitted", attemptId: "a", observation }, undefined, "2030-11-06T21:00:01.000Z");
    expect((await read(s)).meta.localDate).toBe("2030-11-07");
    expect((await read(s)).daily.completedSessions).toBe(0);
    expect((await read(s)).days[0].localDate).toBe("2030-11-06");
    expect((await s.app.readProgress(new Date("2030-11-12T20:59:59.000Z"))).activity.last7Days).toBe(1);
    expect((await s.app.readProgress(new Date("2030-11-12T21:00:00.000Z"))).activity.last7Days).toBe(0);
    expect((await s.app.readProgress(new Date("2030-12-05T20:59:59.000Z"))).activity.last30Days).toBe(1);
    expect((await s.app.readProgress(new Date("2030-12-05T21:00:00.000Z"))).activity.last30Days).toBe(0);
  });
  it("P16 replanning/defer does not erase completed history, change denominator or invent an activity kind", async () => {
    const s = await setup(); await completed(s); const prior = await read(s);
    await s.send({ type: "PlanRecomputed", minutes: 0, spentMinutes: 0, candidates: [], futureLoadFeasible: true });
    const later = await read(s);
    expect(later.activity).toEqual(prior.activity);
    expect(later.daily.percent).toBeNull();
    expect(later.review.completed).toBeNull();
  });
  it("P17 corrected product mistake locations retain provenance and uncertainty; they do not become mastery judgements", async () => {
    const app = await ApplicationService.open(new MemoryEventStore());
    await app.dispatch({ type: "mistake.add", draft: { attemptId: null, location: null, type: "word", certainty: "suspected", selfCorrected: null, assistanceUsed: null, note: "" } });
    const id = app.state.mistakes[0].id;
    await app.dispatch({ type: "mistake.correct", id, patch: { location: "موضع أبلغ عنه المستخدم", certainty: "disputed" }, reason: "تصحيح البلاغ" });
    const model = app.readProgress();
    expect(model.reportedLocations).toHaveLength(1);
    expect(model.reportedLocations[0]).toMatchObject({ location: "موضع أبلغ عنه المستخدم", certainty: "disputed", type: "word" });
    expect(model.reportedLocations[0].sourceEventIds).toHaveLength(2);
    expect(model.activity.hasEvidence).toBe(false);
  });
  it("P18 future-dated facts/invalid read time never leak future corrections into past progress", async () => {
    const s = await setup(); await completed(s); const snapshot = await s.store.load();
    expect(() => projectProgress(snapshot, new Date(base))).toThrow(/بعد وقت القراءة/);
    expect(() => projectProgress(snapshot, new Date("invalid"))).toThrow(/وقت قراءة/);
  });
  it("P19 progress read grants no learning capability and cannot open blocked production sessions", async () => {
    const store = new MemoryEventStore(), app = await ApplicationService.open(store), before = await store.load();
    app.readProgress();
    await expect(app.dispatch({ type: "session.start", kind: "review", rangeLabel: "غير معتمد" })).rejects.toMatchObject({ code: "RELEASE_GATES_BLOCKED" });
    expect(await store.load()).toEqual(before);
    expect(app.readProgress().review.status).toBe("unavailable");
  });
  it("P20 supported 05-C raw schema remains byte-for-byte unchanged; no progress-derived facts are persisted", async () => {
    const s = await setup(); await completed(s); const before = await s.store.load();
    expect(before.events.filter(e => e.data.scope === "hme").every(e => JSON.stringify(e.versions) === JSON.stringify(LEARNING_VERSIONS))).toBe(true);
    for (let i = 0; i < 3; i++) await read(s);
    expect(await s.store.load()).toEqual(before);
  });
  it("P21 a slow background read cannot roll back a newer committed service state", async () => {
    const root = new MemoryEventStore();
    let delay = false, release: (() => void) | undefined, captured: (() => void) | undefined;
    const pending = new Promise<void>(resolve => { captured = resolve; });
    const store: EventStore = {
      load: async () => {
        const snapshot = await root.load();
        if (delay) {
          delay = false;
          captured!();
          await new Promise<void>(resolve => { release = resolve; });
        }
        return snapshot;
      },
      append: (events, revision) => root.append(events, revision),
      replace: (events, revision) => root.replace(events, revision),
      clear: revision => root.clear(revision), close: () => root.close(),
    };
    const app = await ApplicationService.open(store), initialRevision = app.revision;
    delay = true;
    const readInFlight = app.readProgressFresh();
    await pending;
    await app.dispatch({ type: "mistake.add", draft: { attemptId: null, location: "saved-after-read", type: "word", certainty: "observed", selfCorrected: null, assistanceUsed: null, note: "" } });
    release!();
    expect((await readInFlight).meta.sourceWatermark).toBe(initialRevision);
    expect(app.revision).toBe(initialRevision + 1);
    expect(app.state.mistakes).toHaveLength(1);
    expect(app.readProgress().reportedLocations[0].location).toBe("saved-after-read");
  });
  it("P22 reused command identifiers across event scopes are rejected", async () => {
    const s = await setup(); await completed(s); const snapshot = await s.store.load();
    snapshot.events.at(-1)!.commandId = snapshot.events[0].commandId;
    expect(() => projectProgress(snapshot, s.now())).toThrow(/معرف أمر مكرر/);
  });
});
