import { ReferenceFsrsAdapter, REFERENCE_FSRS_PROVENANCE } from '../core/fsrs-reference';
import type { Probe } from './fsrs-conformance';
import type { FsrsState } from '../core/fsrs';
export const referenceFsrsProbe: Probe = { run(input) {
  const adapter = new ReferenceFsrsAdapter({ desiredRetention: input.desiredRetention });
  // Test seeds are numerical seeds, NOT a migration of historical FsrsState.
  let previous: FsrsState | null = input.initial === null ? null : { ...input.initial,
    model: 'FSRS-6' as const, algorithmVersion: REFERENCE_FSRS_PROVENANCE.algorithmVersion };
  return input.reviews.map(review => {
    const value = adapter.review(previous, review.grade, review.at); previous = value.state;
    return { stability: value.state.stability, difficulty: value.state.difficulty,
      retrievabilityBefore: value.retrievabilityBefore, elapsedDays: value.elapsedDays,
      roundedIntervalDays: value.roundedIntervalDays, rawDueAt: value.rawDueAt };
  });
} };
export const probe = referenceFsrsProbe;
