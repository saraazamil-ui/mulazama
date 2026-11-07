/** Synthetic event fixture for component/read-model tests; contains no Quran. */
import type { LearningCommand } from "../application/learning";
import { LEARNING_VERSIONS, type EventSnapshot, type LearningEvent } from "../core/types";
import { historyFixture06d2 } from "../testing/history-fixture06d2";
export const companionNow = new Date("2030-01-31T00:00:00.000Z");
export const companionFixture = () => historyFixture06d2("2030-01-01T20:59:00.000Z");
export const unitId = "synthetic-history-unit", sessionId = "synthetic-history-session", attemptId = "synthetic-history-attempt";
export const observation = { completion: "complete" as const, attemptedWords: 10, errors: 1, effort: "normal" as const, gapVerified: false };
export function appendCompanionEvent(snapshot: EventSnapshot, command: LearningCommand,
  options: { at?: string; zone?: string; unit?: string | null; coverage?: string[] } = {}) {
  const id = `synthetic-companion-event-${snapshot.events.length}`;
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
export function addCompanionReport(snapshot: EventSnapshot, id = attemptId, location: string | null = "موضع تجريبي", certainty: "observed" | "suspected" | "disputed" = "observed") {
  return appendCompanionEvent(snapshot, { type: "ProductMistakeDraftRecorded", attemptId: id, mistakeType: "word", location, certainty });
}
export function addCompanionAttempt(snapshot: EventSnapshot, id: string, opportunity = id, cluster = id, at = "2030-01-02T20:59:00.000Z") {
  appendCompanionEvent(snapshot, { type: "RecallAttemptStarted", sessionId, attemptId: id,
    testOpportunityId: opportunity, evidenceClusterId: cluster }, { at });
  appendCompanionEvent(snapshot, { type: "RecallAttemptCompleted", sessionId, termination: "completed" });
  appendCompanionEvent(snapshot, { type: "AssessmentSubmitted", attemptId: id, observation: { ...observation, gapVerified: true } });
}
