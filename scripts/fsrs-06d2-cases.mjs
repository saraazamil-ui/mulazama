/** Inputs only: expected states are executed from the pinned upstream bytes. */
const seed = { stability: 5, difficulty: 5, lastReviewAt: '2030-11-06T21:00:00.000Z' };
const reviews = (grades, times) => grades.map((grade, i) => ({ grade, at: times[i] }));
const times = ['2030-11-06T21:00:00.000Z', '2030-11-09T21:00:00.000Z', '2030-11-20T21:00:00.000Z'];
export const FSRS06D2_CASES = Object.freeze([
  { id: 'D2-FSRS-OFFSET-EQUIVALENT', branch: 'same-day', initial: null, desiredRetention: .9,
    reviews: reviews([3, 3, 1], ['2030-11-06T21:00:00Z', '2030-11-07T00:00:00+03:00', '2030-11-07T00:00:01+03:00']) },
  { id: 'D2-FSRS-FLOOR-BEFORE', branch: 'decimal-inputs', initial: seed, desiredRetention: .9,
    reviews: [{ grade: 3, at: '2030-11-07T20:59:59.999Z' }] },
  { id: 'D2-FSRS-FLOOR-AT', branch: 'decimal-inputs', initial: seed, desiredRetention: .9,
    reviews: [{ grade: 3, at: '2030-11-08T00:00:00+03:00' }] },
  { id: 'D2-FSRS-ORIGINAL-SEQUENCE', branch: 'historical-replay', initial: null, desiredRetention: .9, reviews: reviews([3, 3, 3], times) },
  { id: 'D2-FSRS-CORRECT-FIRST', branch: 'historical-replay', initial: null, desiredRetention: .9, reviews: reviews([1, 3, 3], times) },
  { id: 'D2-FSRS-RETRACT-MIDDLE', branch: 'historical-replay', initial: null, desiredRetention: .9, reviews: reviews([3, 3], [times[0], times[2]]) },
  { id: 'D2-FSRS-LEAP-DAY', branch: 'historical-replay', initial: null, desiredRetention: .9,
    reviews: reviews([3, 1, 4], ['2028-02-28T21:00:00Z', '2028-03-01T00:00:00+03:00', '2028-03-01T21:00:00Z']) },
  { id: 'D2-FSRS-RETENTION-99', branch: 'retention-target', initial: seed, desiredRetention: .99, reviews: [{ grade: 4, at: '2031-11-07T21:00:00Z' }] },
  { id: 'D2-FSRS-LONG-REPLAY', branch: 'repeatability', initial: null, desiredRetention: .9,
    reviews: Array.from({ length: 60 }, (_, i) => ({ grade: [3, 2, 3, 4, 1][i % 5], at: new Date(Date.UTC(2030, 0, 1) + i * 3 * 86400000).toISOString() })) },
]);
