/** Non-Quran engineering scenarios. Never imported by the application entry. */
import { CompositeApplication } from '../application/composite-application';
import type { LearningCommand } from '../application/learning';
import { MemoryEventStore } from '../persistence/event-store';
import type { EventStore } from '../core/types';
import { createSyntheticLearningAccess } from './learning-access';
export const fsrsUnit06l2 = { id: 'synthetic-06l2-fsrs-unit', editionId: 'synthetic-06l2-edition',
  probeProfileVersionId: 'chunk-P0-1', words: 10, coverage: ['synthetic:06l2:token'] };
export const baseTime06l2 = '2032-03-13T17:00:00.000Z';
export const clean06l2 = { attemptedWords: 10, errors: 0, completion: 'complete' as const, effort: 'normal' as const, gapVerified: true };
type Observation = Extract<LearningCommand, { type: 'AssessmentSubmitted' }>['observation'];
export type Scenario06l2 = { id: string; observation?: Partial<Observation>; termination?: Extract<LearningCommand, { type: 'RecallAttemptCompleted' }>['termination']; hint?: 'hint' | 'reveal'; suspected?: boolean; expectedRating: 1 | 2 | 3 | 4 | null; };
// Literal engineering expectations, declared before invoking HME or upstream.
// They verify the existing P0 mapping, not its scientific validity.
export const rubricScenarios06l2: Scenario06l2[] = [
  { id: 'failure-errors', observation: { errors: 1 }, expectedRating: 1 },
  { id: 'clean-hard', observation: { effort: 'hard' }, expectedRating: 2 },
  { id: 'clean-normal', expectedRating: 3 },
  { id: 'clean-easy', observation: { effort: 'easy' }, expectedRating: 4 },
  { id: 'hint', hint: 'hint', expectedRating: 1 },
  { id: 'reveal', hint: 'reveal', expectedRating: 1 },
  { id: 'memory-failure', termination: 'memory_failure', observation: { attemptedWords: 2, completion: 'partial' }, expectedRating: 1 },
  { id: 'technical-stop', termination: 'technical_failure', observation: { errors: 2 }, expectedRating: null },
  { id: 'user-stop', termination: 'user_stop', observation: { errors: 2 }, expectedRating: null },
  { id: 'unknown-errors', observation: { errors: null }, expectedRating: null },
  { id: 'unknown-effort', observation: { effort: 'unknown' }, expectedRating: null },
  { id: 'partial-clean', observation: { completion: 'partial', attemptedWords: 4 }, expectedRating: null },
  { id: 'suspected-word', suspected: true, expectedRating: null },
];
export async function setupFsrs06l2(store: EventStore = new MemoryEventStore()) {
  const access = await createSyntheticLearningAccess([fsrsUnit06l2]);
  const app = await CompositeApplication.open(store, { access });
  await app.learning.send({ type: 'UnitRegistered', unit: fsrsUnit06l2 }, { at: offset06l2(baseTime06l2, -10000) });
  return { app, store, access };
}
export const offset06l2 = (at: string, milliseconds: number) => new Date(Date.parse(at) + milliseconds).toISOString();
export async function recordFsrsAttempt06l2(state: Awaited<ReturnType<typeof setupFsrs06l2>>, scenario: Scenario06l2,
  at = baseTime06l2, opportunity?: string, cluster?: string) {
  const sessionId = `synthetic-06l2-session-${scenario.id}`, attemptId = `synthetic-06l2-attempt-${scenario.id}`;
  await state.app.learning.send({ type: 'SessionStarted', unitId: fsrsUnit06l2.id, sessionId }, { at: offset06l2(at, -1000) });
  await state.app.learning.send({ type: 'RecallAttemptStarted', sessionId, attemptId,
    ...(opportunity ? { testOpportunityId: opportunity } : {}), ...(cluster ? { evidenceClusterId: cluster } : {}) }, { at });
  if (scenario.hint) await state.app.learning.send({ type: 'HintUsed', sessionId, reveal: scenario.hint === 'reveal' }, { at: offset06l2(at, 1000) });
  await state.app.learning.send({ type: 'RecallAttemptCompleted', sessionId, termination: scenario.termination ?? 'completed' }, { at: offset06l2(at, 2000) });
  if (scenario.suspected) await state.app.learning.send({ type: 'ProductMistakeDraftRecorded', attemptId, mistakeType: 'word', location: 'synthetic location', certainty: 'suspected' }, { at: offset06l2(at, 2500) });
  await state.app.learning.send({ type: 'AssessmentSubmitted', attemptId, observation: { ...clean06l2, ...scenario.observation } }, { at: offset06l2(at, 3000) });
  await state.app.learning.send({ type: 'SessionEnded', sessionId }, { at: offset06l2(at, 4000) });
  return attemptId;
}
