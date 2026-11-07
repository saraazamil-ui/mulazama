import { replayHistory } from "../application/history-application";
import type { LearningCommand } from "../application/learning";
import { canonical, DomainError, type EventSnapshot, type LearningEvent } from "../core/types";
import type { RecallInput } from "../core/hme-types";

type Observation = Pick<RecallInput, "attemptedWords" | "errors" | "completion" | "effort" | "gapVerified">;
export interface PersonalMemoryAssessmentRevision {
  eventId: string;
  commandId: string;
  revision: number;
  kind: "submitted" | "corrected";
  recordedAt: string;
  effectiveReviewAt: string;
  reason: string | null;
  reportedObservation: Observation;
  sourceVersions: LearningEvent["versions"];
}
export interface PersonalMemoryAttempt {
  attemptId: string;
  sessionId: string;
  startedAt: string;
  endedAt: string | null;
  captureZoneId: string;
  termination: RecallInput["termination"] | null;
  testOpportunityId: string;
  evidenceClusterId: string;
  firstAttemptInOpportunity: boolean;
  millisecondsSincePreviousAttempt: number | null;
  lastRelevantExposureAt: string | null;
  lastRelevantExposureEventId: string | null;
  millisecondsSinceRelevantExposure: number | null;
  exposureGapUncertain: boolean;
  hints: number;
  revealed: boolean;
  latestObservation: RecallInput | null;
  assessmentRevision: number;
  assessmentHistory: PersonalMemoryAssessmentRevision[];
  recordedPolicyEvaluation: {
    eligible: boolean;
    reasonCodes: string[];
    meaning: "recorded-policy-only-not-scientific-approval";
  } | null;
  reportedMistakes: Array<{ eventId: string; type: string; location: string | null; certainty: string }>;
  sourceEventIds: string[];
}
export interface PersonalMemoryUnit {
  identity: { userId: string; unitId: string; editionId: string; probeProfileVersionId: string };
  definition: { words: number; coverage: string[]; probeType: string };
  registration: { eventId: string; registeredAt: string };
  sourceEventIds: string[];
  documentedMemorization: { status: "unavailable"; at: null; reason: "NO_APPROVED_ACQUISITION_EVENT" };
  attempts: PersonalMemoryAttempt[];
  counts: { attempts: number; assessed: number; ended: number; corrections: number };
  evidenceIdentity: { opportunityIds: string[]; clusterIds: string[]; interpretation: "distinct-identifiers-not-independent-memory-evidence" };
  dataAvailability: {
    status: "no-attempts" | "unassessed-only" | "observations-present";
    missingLatestFields: { unassessed: number; attemptedWords: number; errors: number; completion: number; effort: number };
    predictiveSufficiency: "not-established";
  };
  scheduling: {
    status: "no-eligible-observations" | "requires-explicit-rebuild" | "probe-profile-not-approved";
    sourceVersions: LearningEvent["versions"][];
    futureSchedule: "unavailable";
    interpretation: "historical-provenance-only";
  };
}
export interface PersonalMemoryReadModel {
  meta: { projectionVersion: "06-E1-personal-memory-foundation-1"; asOf: string; sourceWatermark: number; sourceEventCount: number };
  profileId: string;
  units: PersonalMemoryUnit[];
  /** Product-only or unlinked drafts cannot be assigned to a unit by guessing. */
  unlinkedMistakeEventIds: string[];
}

/** Rebuild factual per-unit history; never persists, merges coverage, authorizes
 * learning, predicts mastery or exposes unapproved model state/due dates. Raw
 * duplicates are rejected by the aggregate contract rather than silently repaired. */
export function projectPersonalMemory(snapshot: EventSnapshot, now = new Date()): PersonalMemoryReadModel {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    throw new DomainError("INVALID_INPUT", "وقت قراءة ملف الذاكرة غير صالح.");
  const { product, learning } = replayHistory(snapshot);
  if (snapshot.events.some(event => Date.parse(event.occurredAt) > now.getTime()))
    throw new DomainError("CLOCK_UNCERTAIN", "توجد وقائع بعد وقت قراءة ملف الذاكرة؛ لم تُستنتج بيانات ماضية منها.");

  const registrations = new Map<string, LearningEvent>();
  const sessionStarts = new Map<string, string>();
  const activeAttempts = new Map<string, string>();
  const endedAttempts = new Set<string>();
  const unitExposures = new Map<string, LearningEvent>();
  const attemptExposures = new Map<string, LearningEvent>();
  const unitSourceIds = new Map<string, Set<string>>();
  const sourceIds = new Map<string, Set<string>>();
  const assessmentEvents = new Map<string, LearningEvent[]>();
  const mistakeEvents = new Map<string, PersonalMemoryAttempt["reportedMistakes"]>();
  const unlinkedMistakeEventIds: string[] = [];
  function addSource(attemptId: string, eventId: string) {
    const ids = sourceIds.get(attemptId) ?? new Set<string>();
    ids.add(eventId); sourceIds.set(attemptId, ids);
  }
  for (const event of snapshot.events) {
    if (event.data.scope === "product") {
      if (["ProductMistakeDraftRecorded", "MistakeCorrected"].includes(event.type)) unlinkedMistakeEventIds.push(event.eventId);
      continue;
    }
    const command = event.data.command as LearningCommand | undefined;
    if (!command) continue;
    const sourceUnit = command.type === "UnitRegistered" ? command.unit.id : event.unitId;
    if (sourceUnit) {
      const ids = unitSourceIds.get(sourceUnit) ?? new Set<string>();
      ids.add(event.eventId); unitSourceIds.set(sourceUnit, ids);
    }
    if (command.type === "UnitRegistered") registrations.set(command.unit.id, event);
    if (command.type === "SessionStarted") sessionStarts.set(command.sessionId, event.eventId);
    if (["ExposureCompleted", "RepetitionCompleted", "HintUsed", "RecallAttemptCompleted"].includes(command.type))
      unitExposures.set(event.unitId!, event);
    if (command.type === "RecallAttemptCompleted") endedAttempts.add(activeAttempts.get(command.sessionId)!);
    if (command.type === "SessionEnded") {
      const active = activeAttempts.get(command.sessionId);
      if (active && !endedAttempts.has(active)) {
        unitExposures.set(event.unitId!, event); endedAttempts.add(active);
      }
    }
    if (command.type === "RecallAttemptStarted" || command.type === "RecallAttemptRestarted") {
      // A restart is both the closure evidence for the old attempt and the start
      // of the new one. It must not make the interrupted attempt disappear.
      const old = activeAttempts.get(command.sessionId);
      if (command.type === "RecallAttemptRestarted" && old) {
        addSource(old, event.eventId); endedAttempts.add(old); unitExposures.set(event.unitId!, event);
      }
      activeAttempts.set(command.sessionId, command.attemptId);
      const exposure = unitExposures.get(event.unitId!);
      if (exposure) { attemptExposures.set(command.attemptId, exposure); addSource(command.attemptId, exposure.eventId); }
      const sessionStart = sessionStarts.get(command.sessionId);
      if (sessionStart) addSource(command.attemptId, sessionStart);
    }
    const attemptId = "attemptId" in command && command.attemptId ? command.attemptId :
      "sessionId" in command ? activeAttempts.get(command.sessionId) : undefined;
    if (attemptId) addSource(attemptId, event.eventId);
    if (command.type === "AssessmentSubmitted" || command.type === "AssessmentCorrected") {
      const events = assessmentEvents.get(command.attemptId) ?? [];
      events.push(event); assessmentEvents.set(command.attemptId, events);
    }
    if (command.type === "ProductMistakeDraftRecorded") {
      if (command.attemptId === null) unlinkedMistakeEventIds.push(event.eventId);
      else {
        const events = mistakeEvents.get(command.attemptId) ?? [];
        events.push({ eventId: event.eventId, type: command.mistakeType, location: command.location, certainty: command.certainty });
        mistakeEvents.set(command.attemptId, events);
      }
    }
  }

  const units: PersonalMemoryUnit[] = [];
  for (const unit of Object.values(learning?.units ?? {})) {
    const registration = registrations.get(unit.definition.id)!;
    // The validated stream is chronological; stable sorting preserves source
    // order for equal timestamps instead of locale-dependent identifier order.
    const rawAttempts = Object.values(learning!.attempts).filter(attempt => attempt.unitId === unit.definition.id)
      .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    const attempts: PersonalMemoryAttempt[] = rawAttempts.map((attempt, index) => {
      const evaluation = learning!.assessments[attempt.id];
      const exposure = attemptExposures.get(attempt.id);
      if (attempt.lastExposureAt !== (exposure?.occurredAt ?? null))
        throw new DomainError("REFERENCE_MISMATCH", "مصدر آخر تعرض لا يطابق إعادة بناء المحاولة.");
      const history = (assessmentEvents.get(attempt.id) ?? []).map((event, revision) => {
        const command = event.data.command as Extract<LearningCommand, { type: "AssessmentSubmitted" | "AssessmentCorrected" }>;
        return { eventId: event.eventId, commandId: event.commandId, revision: revision + 1,
          kind: command.type === "AssessmentCorrected" ? "corrected" as const : "submitted" as const,
          recordedAt: event.occurredAt, effectiveReviewAt: attempt.startedAt,
          reason: command.type === "AssessmentCorrected" ? command.reason : null,
          reportedObservation: structuredClone(command.observation), sourceVersions: structuredClone(event.versions) };
      });
      return {
        attemptId: attempt.id, sessionId: attempt.sessionId, startedAt: attempt.startedAt,
        endedAt: attempt.endedAt, captureZoneId: attempt.zoneIdAtCapture, termination: attempt.termination,
        testOpportunityId: attempt.testOpportunityId, evidenceClusterId: attempt.evidenceClusterId,
        firstAttemptInOpportunity: attempt.firstAttempt,
        millisecondsSincePreviousAttempt: index ? Date.parse(attempt.startedAt) - Date.parse(rawAttempts[index - 1].startedAt) : null,
        lastRelevantExposureAt: attempt.lastExposureAt,
        lastRelevantExposureEventId: exposure?.eventId ?? null,
        millisecondsSinceRelevantExposure: attempt.lastExposureAt === null ? null : Date.parse(attempt.startedAt) - Date.parse(attempt.lastExposureAt),
        exposureGapUncertain: attempt.gapUncertain, hints: attempt.hints, revealed: attempt.revealed,
        latestObservation: attempt.assessment ? structuredClone(attempt.assessment) : null,
        assessmentRevision: attempt.revision, assessmentHistory: history,
        recordedPolicyEvaluation: evaluation ? { eligible: evaluation.eligible, reasonCodes: [...evaluation.reasonCodes],
          meaning: "recorded-policy-only-not-scientific-approval" as const } : null,
        reportedMistakes: structuredClone(mistakeEvents.get(attempt.id) ?? []),
        sourceEventIds: [...new Set([registration.eventId, ...(sourceIds.get(attempt.id) ?? [])])],
      };
    });
    const versions = new Map<string, LearningEvent["versions"]>();
    const relevantIds = unitSourceIds.get(unit.definition.id) ?? new Set<string>();
    for (const event of snapshot.events) if (relevantIds.has(event.eventId)) versions.set(canonical(event.versions), structuredClone(event.versions));
    const assessed = attempts.filter(attempt => attempt.latestObservation !== null);
    units.push({
      identity: { userId: product.profileId, unitId: unit.definition.id, editionId: unit.definition.editionId,
        probeProfileVersionId: unit.definition.probeProfileVersionId },
      definition: { words: unit.definition.words, coverage: [...unit.definition.coverage], probeType: unit.definition.probeType ?? "chunk" },
      registration: { eventId: registration.eventId, registeredAt: registration.occurredAt },
      sourceEventIds: [...relevantIds],
      documentedMemorization: { status: "unavailable", at: null, reason: "NO_APPROVED_ACQUISITION_EVENT" },
      attempts, counts: { attempts: attempts.length, assessed: assessed.length,
        ended: attempts.filter(attempt => attempt.endedAt !== null).length,
        corrections: attempts.reduce((sum, attempt) => sum + attempt.assessmentHistory.filter(revision => revision.kind === "corrected").length, 0) },
      evidenceIdentity: { opportunityIds: [...new Set(attempts.map(attempt => attempt.testOpportunityId))],
        clusterIds: [...new Set(attempts.map(attempt => attempt.evidenceClusterId))],
        interpretation: "distinct-identifiers-not-independent-memory-evidence" },
      dataAvailability: { status: assessed.length ? "observations-present" : attempts.length ? "unassessed-only" : "no-attempts",
        missingLatestFields: { unassessed: attempts.length - assessed.length,
          attemptedWords: assessed.filter(attempt => attempt.latestObservation!.attemptedWords === null).length,
          errors: assessed.filter(attempt => attempt.latestObservation!.errors === null).length,
          completion: assessed.filter(attempt => attempt.latestObservation!.completion === "unknown").length,
          effort: assessed.filter(attempt => attempt.latestObservation!.effort === "unknown").length },
        predictiveSufficiency: "not-established" },
      scheduling: { status: (unit.definition.probeType ?? "chunk") !== "chunk" ? "probe-profile-not-approved" :
        attempts.some(attempt => attempt.recordedPolicyEvaluation?.eligible) ? "requires-explicit-rebuild" : "no-eligible-observations",
        sourceVersions: [...versions.values()], futureSchedule: "unavailable", interpretation: "historical-provenance-only" },
    });
  }
  return { meta: { projectionVersion: "06-E1-personal-memory-foundation-1", asOf: now.toISOString(),
    sourceWatermark: snapshot.revision, sourceEventCount: snapshot.events.length },
    profileId: product.profileId, units, unlinkedMistakeEventIds };
}
