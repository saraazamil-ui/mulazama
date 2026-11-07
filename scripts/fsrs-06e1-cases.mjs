/** Additional inputs only. Expected outputs always execute pristine upstream. */
const initial = (stability, difficulty = 5, at = '2026-01-01T00:00:00Z') => ({ stability, difficulty, lastReviewAt: at });
const one = (id, seed, grade, at, desiredRetention = .9) => ({ id, branch: 'state-boundaries', initial: seed, reviews: [{ grade, at }], desiredRetention });
export const FSRS06E1_EDGE_CASES = Object.freeze([
  one('E1-FSRS-INTERVAL-HALF-R95', initial(3.7261647303774827), 2, '2026-01-01T00:00:00Z', .95),
  one('E1-FSRS-INTERVAL-HALF-LARGE-R95', initial(12421.791156168401), 2, '2026-01-01T00:00:00Z', .95),
  one('E1-FSRS-INTERVAL-HALF-R99', initial(152.84201823805714), 2, '2026-01-01T00:00:00Z', .99),
  one('E1-FSRS-DST-SPRING-23H', initial(5, 5, '2026-03-07T12:00:00-05:00'), 3, '2026-03-08T12:00:00-04:00'),
  one('E1-FSRS-DST-FALL-25H', initial(5, 5, '2026-10-31T12:00:00-04:00'), 3, '2026-11-01T12:00:00-05:00'),
  one('E1-FSRS-LOW-SUCCESS', initial(.001, 10), 4, '2026-01-02T00:00:00Z'),
  one('E1-FSRS-HIGH-LAPSE', initial(36500, 1), 1, '2026-01-02T00:00:00Z'),
  { id: 'E1-FSRS-REPLAY-256', branch: 'historical-replay', initial: null, desiredRetention: .95,
    reviews: Array.from({ length: 256 }, (_, i) => ({ grade: [1, 2, 3, 4][i % 4], at: new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString() })) },
]);
