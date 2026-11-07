import type { PersonalMemoryAttempt, PersonalMemoryReadModel, PersonalMemoryUnit } from "../memory/personal-memory";

export type LinkedReportState = "consistent-report" | "conflicts-with-latest-result" | "unresolved-report";
export interface CompanionReport {
  eventId: string;
  attemptId: string;
  testOpportunityId: string;
  evidenceClusterId: string;
  location: string | null;
  type: string;
  certainty: string;
  state: LinkedReportState;
}
export interface CompanionLocation {
  /** Only exact reported text within the complete unit identity; never a canonical verse. */
  location: string;
  type: string;
  reports: CompanionReport[];
  consistentAttempts: number;
  opportunityCount: number;
  clusterCount: number;
  repeatedReport: boolean;
}
export interface CompanionUnit {
  identity: PersonalMemoryUnit["identity"];
  attempts: PersonalMemoryAttempt[];
  locations: CompanionLocation[];
  unlocatedReports: CompanionReport[];
  assessedAttempts: number;
  corrections: number;
  /** A timed observation is not evidence that recall is stable or weak. */
  timedObservations: number;
  sourceEventIds: string[];
}
export interface CompanionReadModel {
  meta: PersonalMemoryReadModel["meta"] & { companionVersion: "06-L1-factual-companion-1" };
  units: CompanionUnit[];
  totals: { attempts: number; assessedAttempts: number; corrections: number; linkedReportedLocations: number; repeatedReportedLocations: number; timedObservations: number };
  unlinkedMistakeEventIds: string[];
  sufficiency: "not-established";
}

export function hasTimedObservation(attempt: PersonalMemoryAttempt): boolean {
  return attempt.latestObservation !== null && attempt.latestObservation.gapVerified
    && !attempt.exposureGapUncertain && attempt.lastRelevantExposureEventId !== null
    && attempt.millisecondsSinceRelevantExposure !== null && attempt.millisecondsSinceRelevantExposure > 0;
}

function reportState(attempt: PersonalMemoryAttempt, certainty: string, eventId: string): LinkedReportState {
  // A total corrected to zero conflicts with the old location report. Retain both
  // sources; neither delete the draft nor silently count it as current failure.
  if (attempt.latestObservation?.errors === 0) return "conflicts-with-latest-result";
  const lastRevision = attempt.assessmentHistory.at(-1);
  if (lastRevision?.kind === "corrected") {
    const reportPosition = attempt.sourceEventIds.indexOf(eventId);
    const correctionPosition = attempt.sourceEventIds.indexOf(lastRevision.eventId);
    // Aggregate corrections contain no location-level verdict. Even a positive
    // new total cannot certify that a draft recorded before it is still current.
    if (reportPosition < 0 || correctionPosition < 0 || reportPosition <= correctionPosition) return "unresolved-report";
  }
  if (certainty === "observed" && attempt.latestObservation?.errors !== null
    && attempt.latestObservation?.errors !== undefined && attempt.latestObservation.errors > 0)
    return "consistent-report";
  return "unresolved-report";
}

/** Presentation-only derivation of the existing E1 replay. No persisted model,
 * content lookup, threshold for mastery, scheduling or authorization is added.
 * Product-only drafts remain unlinked; no ID/coverage string is decoded. */
export function projectCompanion(memory: PersonalMemoryReadModel): CompanionReadModel {
  const units = memory.units.map((unit): CompanionUnit => {
    const locations = new Map<string, CompanionReport[]>();
    const unlocatedReports: CompanionReport[] = [];
    for (const attempt of unit.attempts) for (const draft of attempt.reportedMistakes) {
      const report: CompanionReport = { ...structuredClone(draft), attemptId: attempt.attemptId,
        testOpportunityId: attempt.testOpportunityId, evidenceClusterId: attempt.evidenceClusterId,
        state: reportState(attempt, draft.certainty, draft.eventId) };
      if (draft.location === null || draft.location === "") unlocatedReports.push(report);
      else {
        // Deliberately do not trim, normalize, merge coverage, parse or resolve text.
        const key = JSON.stringify([draft.location, draft.type]);
        locations.set(key, [...(locations.get(key) ?? []), report]);
      }
    }
    return {
      identity: { ...unit.identity }, attempts: structuredClone(unit.attempts),
      locations: [...locations.values()].map(reports => {
        const consistent = reports.filter(report => report.state === "consistent-report");
        const consistentAttempts = new Set(consistent.map(report => report.attemptId)).size;
        const opportunityCount = new Set(consistent.map(report => report.testOpportunityId)).size;
        const clusterCount = new Set(consistent.map(report => report.evidenceClusterId)).size;
        return { location: reports[0].location!, type: reports[0].type, reports, consistentAttempts,
          opportunityCount, clusterCount, repeatedReport: opportunityCount > 1 && clusterCount > 1 };
      }),
      unlocatedReports,
      assessedAttempts: unit.attempts.filter(attempt => attempt.latestObservation !== null).length,
      corrections: unit.attempts.reduce((sum, attempt) => sum + attempt.assessmentHistory.filter(revision => revision.kind === "corrected").length, 0),
      timedObservations: unit.attempts.filter(hasTimedObservation).length,
      sourceEventIds: [...unit.sourceEventIds],
    };
  });
  return { meta: { ...memory.meta, companionVersion: "06-L1-factual-companion-1" }, units,
    totals: { attempts: units.reduce((n, unit) => n + unit.attempts.length, 0),
      assessedAttempts: units.reduce((n, unit) => n + unit.assessedAttempts, 0),
      corrections: units.reduce((n, unit) => n + unit.corrections, 0),
      linkedReportedLocations: units.reduce((n, unit) => n + unit.locations.length, 0),
      repeatedReportedLocations: units.reduce((n, unit) => n + unit.locations.filter(location => location.repeatedReport).length, 0),
      timedObservations: units.reduce((n, unit) => n + unit.timedObservations, 0) },
    unlinkedMistakeEventIds: [...memory.unlinkedMistakeEventIds], sufficiency: "not-established" };
}
