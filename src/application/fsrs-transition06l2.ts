import { canonical, type EventSnapshot } from '../core/types';
import { FSRS_PROVENANCE } from '../core/fsrs';
import { REFERENCE_FSRS_PROVENANCE } from '../core/fsrs-reference';
import { replayHistory } from './history-application';
import { rebuildAdaptiveSchedule } from './adaptive-scheduling';

/** Pre-election impact review only. It has no EventStore, write operation,
 * runtime selector, or authority to expose a schedule to the learner. */
export async function reviewFsrsTransition06l2(source: EventSnapshot) {
  // Snapshot caller-owned data before the first await. Validation rejects unknown
  // versions/corruption; this function cannot "repair" or reinterpret them.
  const input = structuredClone(source);
  const historical = replayHistory(input), corrected = rebuildAdaptiveSchedule(input);
  const digest = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(canonical(value)))), byte => byte.toString(16).padStart(2, '0')).join('');
  const units = Object.keys(corrected.units).sort().map(id => {
    const next = corrected.units[id], old = historical.learning!.units[id];
    const oldRawDue = old.dates?.rawModelDueAt ?? null;
    const stateNumbersChanged = old.memory?.stability !== next.memory?.stability || old.memory?.difficulty !== next.memory?.difficulty;
    return {
      identity: next.identity,
      historical: { memory: old.memory, dueDates: old.dates, schedulerStatus: old.schedulerStatus },
      corrected: { memory: next.memory, rawDueAt: next.rawDueAt, reviewCount: next.reviews.length,
        reviewEvidence: next.reviews.map(review => ({ attemptId: review.attemptId, originalReviewAt: review.at,
          assessmentRevision: review.assessmentRevision, rating: review.effectiveRating, sourceEventIds: review.sourceEventIds })),
        exclusions: next.exclusions },
      difference: {
        stateNumbersChanged,
        stability: old.memory && next.memory ? next.memory.stability - old.memory.stability : null,
        difficulty: old.memory && next.memory ? next.memory.difficulty - old.memory.difficulty : null,
        rawDueChanged: oldRawDue !== next.rawDueAt,
        rawDueMilliseconds: oldRawDue && next.rawDueAt ? Date.parse(next.rawDueAt) - Date.parse(oldRawDue) : null,
      },
      policyAndPlanDecision: 'not-elected; historical due dates and plans remain under the historical interpreter' as const,
    };
  });
  return {
    kind: 'fsrs-transition-impact-review' as const, reviewVersion: '06-L2-1',
    executionAllowed: false as const, migrationPerformed: false as const, productionElectionChanged: false as const,
    source: { eventDigest: await digest(input.events), watermark: input.revision, eventCount: input.events.length,
      historicalAlgorithm: FSRS_PROVENANCE.algorithmVersion },
    target: REFERENCE_FSRS_PROVENANCE,
    history: { planEventIds: input.events.filter(event => event.type === 'PlanRecomputed').map(event => event.eventId),
      plansDigest: await digest(historical.learning?.plans ?? []), originalEventsRewritten: 0 },
    summary: { units: units.length, unitsWithChangedStateNumbers: units.filter(unit => unit.difference.stateNumbersChanged).length,
      unitsWithChangedRawDue: units.filter(unit => unit.difference.rawDueChanged).length,
      reviewsRebuilt: units.reduce((sum, unit) => sum + unit.corrected.reviewCount, 0) },
    units,
    electionRequirements: ['Independent approval of the corrected calculation/version and the HME rubric',
      'Explicit rule for future writes and historical plan references',
      'Encrypted backup, compare-and-swap, isolated restore and rollback evidence before any real-data migration'],
  };
}
export type FsrsTransitionReview06l2 = Awaited<ReturnType<typeof reviewFsrsTransition06l2>>;
