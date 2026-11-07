import { canonical, LEARNING_VERSIONS, type LearningVersions, type EventSnapshot } from "../core/types";
import { instant } from "../core/hme";
import type { Rating } from "../core/hme-types";
import type { FsrsReview, FsrsState } from "../core/fsrs";
import { ReferenceFsrsAdapter, REFERENCE_FSRS_PROVENANCE } from "../core/fsrs-reference";
import { replayHistory } from "./history-application";
import { learningSchedulingMode, type LearningCommand } from "./learning";
import { learningVersionsFor } from "../core/types";

export interface AdaptiveShadowReview {
  attemptId: string;
  sessionId: string;
  assessmentRevision: number;
  at: string;
  effectiveRating: Rating;
  testOpportunityId: string;
  evidenceClusterId: string;
  /** Direct attempt/session/assessment evidence; unit-wide basis is retained separately. */
  sourceEventIds: string[];
  result: FsrsReview;
}
export interface AdaptiveShadowExclusion {
  attemptId: string;
  assessmentRevision: number;
  sourceEventIds: string[];
  reasonCodes: string[];
}
export interface AdaptiveUnitShadow {
  identity: { userId: string; unitId: string; editionId: string; probeProfileVersionId: string };
  status: "no-eligible-review" | "rebuilt-shadow";
  sourceEventIds: string[];
  reviews: AdaptiveShadowReview[];
  exclusions: AdaptiveShadowExclusion[];
  memory: FsrsState | null;
  rawDueAt: string | null;
}
export interface AdaptiveSchedulingShadow {
  kind: "engineering-shadow";
  projectionVersion: "06-E1-adaptive-shadow-1";
  executable: false;
  migrated: false;
  sourceWatermark: number;
  sourceEventCount: number;
  sourceEventIds: string[];
  sourceInterpretation: LearningVersions;
  target: typeof REFERENCE_FSRS_PROVENANCE;
  units: Record<string, AdaptiveUnitShadow>;
}

/** A pure, explicit comparison projection. It never takes a stored memory state
 * as the seed of the corrected algorithm, rewrites events, opens a session, or
 * replaces a historical plan's due date. The source is first replayed under its
 * original version so old embedded plan references keep their original meaning. */
export function rebuildAdaptiveSchedule(snapshot: EventSnapshot): AdaptiveSchedulingShadow {
  const { learning } = replayHistory(snapshot);
  const result: AdaptiveSchedulingShadow = {
    kind: "engineering-shadow", projectionVersion: "06-E1-adaptive-shadow-1",
    executable: false, migrated: false,
    sourceWatermark: snapshot.revision, sourceEventCount: snapshot.events.length,
    sourceEventIds: snapshot.events.map(event => event.eventId),
    sourceInterpretation: structuredClone(learningVersionsFor(learningSchedulingMode(snapshot))),
    target: structuredClone(REFERENCE_FSRS_PROVENANCE), units: Object.create(null),
  };
  if (!learning) return result;

  const unitEvents = new Map<string, string[]>(), attemptEvents = new Map<string, string[]>();
  const unitRegistered = new Map<string, string>(), sessionStarted = new Map<string, string>();
  const activeAttempt = new Map<string, string>();
  const addAttemptEvent = (attemptId: string | undefined, eventId: string) => {
    if (attemptId) {
      const ids = attemptEvents.get(attemptId) ?? [];
      ids.push(eventId); attemptEvents.set(attemptId, ids);
    }
  };
  for (const event of snapshot.events) {
    if (event.data.scope !== "hme") continue;
    const command = event.data.command as LearningCommand | undefined;
    if (!command) continue;
    const unitId = command.type === "UnitRegistered" ? command.unit.id : event.unitId;
    if (unitId) {
      const ids = unitEvents.get(unitId) ?? [];
      ids.push(event.eventId); unitEvents.set(unitId, ids);
    }
    if (command.type === "UnitRegistered") unitRegistered.set(command.unit.id, event.eventId);
    else if (command.type === "SessionStarted") sessionStarted.set(command.sessionId, event.eventId);
    else if (command.type === "RecallAttemptStarted" || command.type === "RecallAttemptRestarted") {
      if (command.type === "RecallAttemptRestarted") addAttemptEvent(activeAttempt.get(command.sessionId), event.eventId);
      const attempt = learning.attempts[command.attemptId];
      const ids = [unitRegistered.get(attempt.unitId), sessionStarted.get(attempt.sessionId)].filter((id): id is string => !!id);
      attemptEvents.set(command.attemptId, [...ids, event.eventId]);
      activeAttempt.set(command.sessionId, command.attemptId);
    } else if ("attemptId" in command && command.attemptId) {
      addAttemptEvent(command.attemptId, event.eventId);
    } else if ("sessionId" in command) {
      addAttemptEvent(activeAttempt.get(command.sessionId), event.eventId);
    }
  }
  for (const unit of Object.values(learning.units)) {
    const definition = unit.definition;
    result.units[definition.id] = {
      identity: { userId: learning.userId!, unitId: definition.id, editionId: definition.editionId,
        probeProfileVersionId: definition.probeProfileVersionId },
      status: "no-eligible-review", sourceEventIds: unitEvents.get(definition.id) ?? [],
      reviews: [], exclusions: [], memory: null, rawDueAt: null,
    };
  }
  const adapter = new ReferenceFsrsAdapter({ desiredRetention: LEARNING_VERSIONS.desiredRetention });
  const opportunityKeys = new Set<string>(), clusterKeys = new Set<string>();
  // Stable sorting matches the legacy interpreter for equal original instants;
  // captured zone does not alter elapsed absolute time.
  const attempts = Object.values(learning.attempts).sort((a, b) => instant(a.startedAt) - instant(b.startedAt));
  for (const attempt of attempts) {
    const unit = learning.units[attempt.unitId], shadow = result.units[attempt.unitId];
    const assessment = learning.assessments[attempt.id];
    const sourceEventIds = attemptEvents.get(attempt.id) ?? [];
    const identity = [learning.userId, unit.definition.id, unit.definition.editionId, unit.definition.probeProfileVersionId];
    const opportunityKey = canonical([...identity, attempt.testOpportunityId]);
    const clusterKey = canonical([...identity, attempt.evidenceClusterId]);
    const reasons: string[] = [];
    if ((unit.definition.probeType ?? "chunk") !== "chunk") reasons.push("FSRS_PROBE_PROFILE_NOT_APPROVED");
    if (!attempt.assessment || !assessment) reasons.push("NO_ASSESSMENT");
    else if (!assessment.eligible || !assessment.effectiveRating)
      reasons.push("ASSESSMENT_NOT_ELIGIBLE", ...assessment.reasonCodes);
    if (opportunityKeys.has(opportunityKey)) reasons.push("DUPLICATE_TEST_OPPORTUNITY");
    if (clusterKeys.has(clusterKey)) reasons.push("DUPLICATE_EVIDENCE_CLUSTER");
    if (reasons.length) {
      shadow.exclusions.push({ attemptId: attempt.id, assessmentRevision: attempt.revision,
        sourceEventIds, reasonCodes: [...new Set(reasons)] });
      continue;
    }
    opportunityKeys.add(opportunityKey); clusterKeys.add(clusterKey);
    const review = adapter.review(shadow.memory, assessment.effectiveRating!, attempt.startedAt);
    shadow.reviews.push({ attemptId: attempt.id, sessionId: attempt.sessionId, assessmentRevision: attempt.revision,
      at: attempt.startedAt, effectiveRating: assessment.effectiveRating!,
      testOpportunityId: attempt.testOpportunityId, evidenceClusterId: attempt.evidenceClusterId,
      sourceEventIds, result: review });
    shadow.status = "rebuilt-shadow"; shadow.memory = review.state; shadow.rawDueAt = review.rawDueAt;
  }
  return result;
}
