/** Isolated QA history with no Quran bytes; never imported by the app entry. */
import { LEARNING_VERSIONS, VERSIONS, type EventSnapshot, type LearningEvent } from "../core/types";

export function historyFixture06d2(at = new Date(Date.now() - 86400000).toISOString()): EventSnapshot {
  const coverage = ["synthetic:history:token1", "synthetic:history:token2"];
  const userId = "synthetic-history-profile", unitId = "synthetic-history-unit";
  let index = 0;
  const event = (scope: "product" | "hme", type: string, command?: Record<string, unknown>, unit = false): LearningEvent => {
    const id = "synthetic-history-event-" + index++;
    return { eventId: id, commandId: id, operationId: id, userId, unitId: unit ? unitId : null,
      type, occurredAt: at, receivedAt: at, zoneId: "Asia/Riyadh",
      source: type.startsWith("Assessment") ? "V1" : "product", coverage: unit ? coverage : [],
      versions: scope === "product" ? VERSIONS : LEARNING_VERSIONS,
      data: command ? { scope, command: { type, ...command } } : { scope } };
  };
  return { revision: 7, events: [
    event("product", "ProfileInitialized"),
    event("hme", "LearnerInitialized"),
    event("hme", "UnitRegistered", { unit: { id: unitId, editionId: "synthetic-history-edition",
      probeProfileVersionId: "chunk-P0-1", words: 10, coverage } }),
    event("hme", "SessionStarted", { sessionId: "synthetic-history-session", unitId }, true),
    event("hme", "RecallAttemptStarted", { sessionId: "synthetic-history-session", attemptId: "synthetic-history-attempt" }, true),
    event("hme", "RecallAttemptCompleted", { sessionId: "synthetic-history-session", termination: "completed" }, true),
    event("hme", "AssessmentSubmitted", { attemptId: "synthetic-history-attempt", observation:
      { completion: "complete", attemptedWords: 10, errors: 1, effort: "normal", gapVerified: false } }, true),
  ] };
}
