// @vitest-environment node
import { describe, expect, it } from "vitest";
import { canonical } from "../core/types";
import { projectPersonalMemory } from "../memory/personal-memory";
import { MemoryEventStore } from "../persistence/event-store";
import { HistoryApplication, replayHistory } from "../application/history-application";
import { exportEncryptedBackup, restoreEncryptedBackup } from "../persistence/backup";
import { projectCompanion } from "./projection";
import { addCompanionAttempt, addCompanionReport, appendCompanionEvent, attemptId, companionFixture, companionNow, observation, sessionId } from "./test-fixture";

const read = (snapshot = companionFixture()) => projectCompanion(projectPersonalMemory(snapshot, companionNow));
describe("06-L1 companion derives factual observations from E1 without a new memory model", () => {
  it("L1C01 product-only new user has no fabricated memory or plan", () => {
    const snapshot = companionFixture(); snapshot.events = snapshot.events.slice(0, 1); snapshot.revision = 1;
    const model = read(snapshot);
    expect(model.units).toEqual([]);
    expect(model.totals).toEqual({ attempts: 0, assessedAttempts: 0, corrections: 0, linkedReportedLocations: 0, repeatedReportedLocations: 0, timedObservations: 0 });
    expect(model.sufficiency).toBe("not-established");
    expect(JSON.stringify(model)).not.toMatch(/"(dueAt|mastery|retrievability|recommendation|percentage)":/);
  });
  it("L1C02 repeated drafts in one attempt count as one reported location and one opportunity", () => {
    const snapshot = companionFixture(); addCompanionReport(snapshot); addCompanionReport(snapshot);
    const model = read(snapshot), location = model.units[0].locations[0];
    expect(model.totals.linkedReportedLocations).toBe(1);
    expect(location).toMatchObject({ consistentAttempts: 1, opportunityCount: 1, clusterCount: 1, repeatedReport: false });
    expect(location.reports).toHaveLength(2);
  });
  it("L1C03 exact linked reports across distinct opportunities and clusters describe repetition only", () => {
    const snapshot = companionFixture(); addCompanionReport(snapshot);
    addCompanionAttempt(snapshot, "next-attempt"); addCompanionReport(snapshot, "next-attempt");
    const model = read(snapshot);
    expect(model.units[0].locations[0]).toMatchObject({ consistentAttempts: 2, opportunityCount: 2, clusterCount: 2, repeatedReport: true });
    expect(model.totals.repeatedReportedLocations).toBe(1);
    expect(model.sufficiency).toBe("not-established");
  });
  it.each([["same", "other"], ["other", "same"]])("L1C04 overlapping opportunity/cluster %s %s never becomes repeated evidence", (opportunity, cluster) => {
    const snapshot = companionFixture(); addCompanionReport(snapshot);
    addCompanionAttempt(snapshot, "next-attempt", opportunity === "same" ? attemptId : "other", cluster === "same" ? attemptId : "other");
    addCompanionReport(snapshot, "next-attempt");
    expect(read(snapshot).units[0].locations[0].repeatedReport).toBe(false);
  });
  it("L1C05 exact location and type are not normalized, parsed or merged from opaque coverage", () => {
    const snapshot = companionFixture(); addCompanionReport(snapshot, attemptId, "2:255");
    addCompanionReport(snapshot, attemptId, " 2:255");
    appendCompanionEvent(snapshot, { type: "ProductMistakeDraftRecorded", attemptId, mistakeType: "link", location: "2:255", certainty: "observed" });
    const model = read(snapshot);
    expect(model.units[0].locations.map(item => [item.location, item.type])).toEqual([["2:255", "word"], [" 2:255", "word"], ["2:255", "link"]]);
    expect(model.units[0].identity.unitId).toBe("synthetic-history-unit");
    expect(JSON.stringify(model.units[0])).not.toMatch(/"(surah|ayah|verse|canonicalLocation)":/);
  });
  it("L1C06 correction to zero withdraws repetition, retains all drafts and does not add a recall", () => {
    const snapshot = companionFixture(); addCompanionReport(snapshot);
    addCompanionAttempt(snapshot, "next-attempt"); addCompanionReport(snapshot, "next-attempt");
    expect(read(snapshot).totals.repeatedReportedLocations).toBe(1);
    appendCompanionEvent(snapshot, { type: "AssessmentCorrected", attemptId, expectedAssessmentRevision: 1,
      reason: "تصحيح اختباري", observation: { ...observation, errors: 0 } });
    const model = read(snapshot);
    expect(model.totals).toMatchObject({ attempts: 2, assessedAttempts: 2, corrections: 1, repeatedReportedLocations: 0 });
    expect(model.units[0].locations[0].reports.map(report => report.state)).toEqual(["conflicts-with-latest-result", "consistent-report"]);
    expect(model.units[0].attempts[0].assessmentHistory).toHaveLength(2);
  });
  it("L1C07 correction with a positive total cannot certify an older location report", () => {
    const snapshot = companionFixture(); addCompanionReport(snapshot);
    appendCompanionEvent(snapshot, { type: "AssessmentCorrected", attemptId, expectedAssessmentRevision: 1,
      reason: "عدد مصحح لا يحدد الموضع", observation: { ...observation, errors: 2 } });
    expect(read(snapshot).units[0].locations[0].reports[0].state).toBe("unresolved-report");
    addCompanionReport(snapshot);
    expect(read(snapshot).units[0].locations[0].reports.map(report => report.state)).toEqual(["unresolved-report", "consistent-report"]);
  });
  it("L1C08 unknown errors and disputed reports never become evidence of repeated failure", () => {
    const snapshot = companionFixture(); addCompanionReport(snapshot, attemptId, "مشتبه", "suspected");
    addCompanionReport(snapshot, attemptId, "مختلف", "disputed");
    addCompanionReport(snapshot);
    appendCompanionEvent(snapshot, { type: "AssessmentCorrected", attemptId, expectedAssessmentRevision: 1,
      reason: "غير معلوم", observation: { ...observation, errors: null, attemptedWords: null, completion: "unknown", effort: "unknown" } });
    expect(read(snapshot).units[0].locations.every(item => item.consistentAttempts === 0 && !item.repeatedReport)).toBe(true);
    expect(read(snapshot).units[0].attempts[0].latestObservation!.errors).toBeNull();
  });
  it("L1C09 unlinked and unlocated drafts retain provenance without invented locations", () => {
    const snapshot = companionFixture();
    const unlocated = addCompanionReport(snapshot, attemptId, null);
    const unlinked = appendCompanionEvent(snapshot, { type: "ProductMistakeDraftRecorded", attemptId: null, mistakeType: "word", location: "موضع غير مربوط", certainty: "observed" });
    const model = read(snapshot);
    expect(model.unlinkedMistakeEventIds).toEqual([unlinked.eventId]);
    expect(model.units[0].unlocatedReports[0].eventId).toBe(unlocated.eventId);
    expect(model.units[0].locations).toEqual([]);
  });
  it("L1C10 timed observation follows verified actual milliseconds across a date boundary", () => {
    const snapshot = companionFixture();
    addCompanionAttempt(snapshot, "midnight-attempt", "midnight-attempt", "midnight-attempt", "2030-01-01T21:01:00.000Z");
    const model = read(snapshot);
    expect(model.units[0].attempts[1].millisecondsSinceRelevantExposure).toBe(120000);
    expect(model.totals.timedObservations).toBe(1);
    const changedZone = structuredClone(snapshot); changedZone.events.slice(-3).forEach(event => { event.zoneId = "America/New_York"; });
    expect(read(changedZone).totals).toEqual(model.totals);
    appendCompanionEvent(snapshot, { type: "AssessmentCorrected", attemptId: "midnight-attempt", expectedAssessmentRevision: 1,
      reason: "سحب تحقق الفاصل", observation: { ...observation, gapVerified: false } });
    expect(read(snapshot).totals.timedObservations).toBe(0);
  });
  it("L1C11 unfinished attempts are visible without a result or evidence score", () => {
    const snapshot = companionFixture();
    appendCompanionEvent(snapshot, { type: "RecallAttemptStarted", sessionId, attemptId: "unfinished" });
    addCompanionReport(snapshot, "unfinished");
    const model = read(snapshot);
    expect(model.totals).toMatchObject({ attempts: 2, assessedAttempts: 1 });
    expect(model.units[0].locations[0].reports[0].state).toBe("unresolved-report");
  });
  it("L1C12 idempotent append and replay cannot inflate the companion; duplicate raw streams fail closed", async () => {
    const snapshot = companionFixture(); addCompanionReport(snapshot);
    const store = new MemoryEventStore(); await store.replace(snapshot.events, 0);
    const before = await store.load(); await store.append([snapshot.events.at(-1)!], before.revision);
    expect(read(await store.load())).toEqual(read(before));
    const duplicate = structuredClone(before); duplicate.events.push(structuredClone(duplicate.events.at(-1)!));
    expect(() => read(duplicate)).toThrow();
  });
  it("L1C13 repeated projection is deterministic, read only and detached", () => {
    const snapshot = companionFixture(); addCompanionReport(snapshot);
    const memory = projectPersonalMemory(snapshot, companionNow), before = canonical(memory), model = projectCompanion(memory);
    expect(projectCompanion(memory)).toEqual(model);
    model.units[0].attempts[0].assessmentHistory[0].reportedObservation.errors = 99;
    model.units[0].locations[0].reports[0].location = "تغيير";
    expect(canonical(memory)).toBe(before);
    expect(read(structuredClone(snapshot))).toEqual(read(snapshot));
  });
  it("L1C14 corrupt or future source events fail at the existing E1 validation boundary", () => {
    const snapshot = companionFixture(); snapshot.events.at(-1)!.userId = "wrong-user";
    expect(() => read(snapshot)).toThrow();
    expect(() => projectPersonalMemory(companionFixture(), new Date("2029-01-01"))).toThrow();
  });
  it("L1C15 identical reports in different unit identities never merge", () => {
    const snapshot = companionFixture(); addCompanionReport(snapshot);
    appendCompanionEvent(snapshot, { type: "SessionEnded", sessionId });
    const otherUnit = "synthetic-other-unit", otherSession = "synthetic-other-session", otherAttempt = "synthetic-other-attempt";
    appendCompanionEvent(snapshot, { type: "UnitRegistered", unit: { id: otherUnit, editionId: "synthetic-other-edition",
      probeProfileVersionId: "chunk-P0-1", words: 10, coverage: ["synthetic:history:token1", "synthetic:history:token2"] } });
    appendCompanionEvent(snapshot, { type: "SessionStarted", sessionId: otherSession, unitId: otherUnit }, { unit: otherUnit });
    appendCompanionEvent(snapshot, { type: "RecallAttemptStarted", sessionId: otherSession, attemptId: otherAttempt }, { unit: otherUnit });
    appendCompanionEvent(snapshot, { type: "RecallAttemptCompleted", sessionId: otherSession, termination: "completed" }, { unit: otherUnit });
    appendCompanionEvent(snapshot, { type: "AssessmentSubmitted", attemptId: otherAttempt, observation }, { unit: otherUnit });
    appendCompanionEvent(snapshot, { type: "ProductMistakeDraftRecorded", attemptId: otherAttempt, mistakeType: "word", location: "موضع تجريبي", certainty: "observed" }, { unit: otherUnit });
    const model = read(snapshot);
    expect(model.units).toHaveLength(2);
    expect(model.totals).toMatchObject({ linkedReportedLocations: 2, repeatedReportedLocations: 0 });
    expect(model.units.map(unit => unit.identity.editionId)).toEqual(["synthetic-history-edition", "synthetic-other-edition"]);
  });
  it("L1C16 encrypted restore reproduces derived memory while preserving original events", async () => {
    const snapshot = companionFixture(); addCompanionReport(snapshot);
    appendCompanionEvent(snapshot, { type: "AssessmentCorrected", attemptId, expectedAssessmentRevision: 1,
      reason: "تصحيح محفوظ للاستعادة", observation: { ...observation, errors: 0 } });
    const password = "companion-synthetic-backup-password";
    const serialized = await exportEncryptedBackup(snapshot, password), store = new MemoryEventStore();
    // Synthetic primitive restore tests aggregate integrity, not production authorization.
    await restoreEncryptedBackup(store, serialized, password, { confirmed: true, expectedRevision: 0, validateReplay: replayHistory });
    const restored = await store.load();
    expect(restored.events).toEqual(snapshot.events);
    expect(read(restored).units).toEqual(read(snapshot).units);
    expect(read(restored).totals).toEqual(read(snapshot).totals);
  });
  it("L1C17 the production history controller can read factual memory but still rejects gated restore", async () => {
    const snapshot = companionFixture(), store = new MemoryEventStore(); await store.replace(snapshot.events, 0);
    const before = await store.load(), app = await HistoryApplication.open(store);
    const memory = await app.readPersonalMemory(companionNow);
    expect(projectCompanion(memory)).toEqual(read(before));
    const password = "companion-blocked-restore-password", serialized = await app.exportBackup(password);
    await expect(app.replaceFromBackup(serialized, password, true)).rejects.toThrow();
    expect(await store.load()).toEqual(before);
    expect(projectCompanion(await app.readPersonalMemory(companionNow))).toEqual(read(before));
    expect("learning" in app).toBe(false);
  });
});
