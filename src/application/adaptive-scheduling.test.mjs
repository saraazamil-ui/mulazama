// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { loadTsFsrsReference } from '../../scripts/fsrs-reference-loader.mjs';
import { rebuildAdaptiveSchedule } from './adaptive-scheduling';
import { CompositeApplication } from './composite-application';
import { HistoryApplication, replayHistory } from './history-application';
import { MemoryEventStore } from '../persistence/event-store';
import { createSyntheticLearningAccess } from '../testing/learning-access';
import { FSRS_WEIGHTS, FSRS_PROVENANCE } from '../core/fsrs';
import { ReferenceFsrsAdapter, REFERENCE_FSRS_PROVENANCE } from '../core/fsrs-reference';
import { canonical } from '../core/types';

const unit = { id: 'test-e1-adaptive-unit', editionId: 'test-e1-adaptive-edition',
  probeProfileVersionId: 'chunk-P0-1', words: 10, coverage: ['test:e1:adaptive:1'] };
const times = ['2030-11-06T21:00:00.000Z', '2030-11-09T21:00:00.000Z', '2030-11-20T21:00:00.000Z'];
const clean = { attemptedWords: 10, errors: 0, completion: 'complete', effort: 'normal', gapVerified: true };
const offset = (at, milliseconds) => new Date(Date.parse(at) + milliseconds).toISOString();
let reference;
beforeAll(async () => {
  reference = await loadTsFsrsReference(resolve('references/ts-fsrs-5.4.2-verified/package'),
    'references/ts-fsrs-5.4.2-verified/receipt.json', FSRS_WEIGHTS);
});
async function setup(definitions = [unit]) {
  const store = new MemoryEventStore(), access = await createSyntheticLearningAccess(definitions);
  const app = await CompositeApplication.open(store, { access });
  for (const definition of definitions)
    await app.learning.send({ type: 'UnitRegistered', unit: definition }, { at: offset(times[0], -10000) });
  return { store, access, app };
}
async function complete(s, index, { definition = unit, observation = clean, termination = 'completed', opportunity, cluster } = {}) {
  const sessionId = 'test-e1-adaptive-session-' + index, attemptId = 'test-e1-adaptive-attempt-' + index;
  await s.app.learning.send({ type: 'SessionStarted', unitId: definition.id, sessionId }, { at: offset(times[index], -1000) });
  await s.app.learning.send({ type: 'RecallAttemptStarted', sessionId, attemptId,
    ...(opportunity ? { testOpportunityId: opportunity } : {}), ...(cluster ? { evidenceClusterId: cluster } : {}) }, { at: times[index] });
  await s.app.learning.send({ type: 'RecallAttemptCompleted', sessionId, termination }, { at: offset(times[index], 1000) });
  await s.app.learning.send({ type: 'AssessmentSubmitted', attemptId, observation }, { at: offset(times[index], 2000) });
  await s.app.learning.send({ type: 'SessionEnded', sessionId }, { at: offset(times[index], 3000) });
}
function upstream(grades, indexes = grades.map((_, i) => i)) {
  return reference.probe.run({ initial: null, desiredRetention: .9,
    reviews: grades.map((grade, index) => ({ grade, at: times[indexes[index]] })) });
}
function observables(reviews) {
  return reviews.map(({ result }) => ({ stability: result.state.stability, difficulty: result.state.difficulty,
    retrievabilityBefore: result.retrievabilityBefore, elapsedDays: result.elapsedDays,
    roundedIntervalDays: result.roundedIntervalDays, rawDueAt: result.rawDueAt }));
}
function correction(index, patch, revision = 1) {
  return { type: 'AssessmentCorrected', attemptId: 'test-e1-adaptive-attempt-' + index,
    expectedAssessmentRevision: revision, reason: 'isolated engineering correction', observation: { ...clean, ...patch } };
}

describe('06-E1 explicit corrected adaptive shadow, historical events unchanged', () => {
  it('AS01 product-only and registered-but-unassessed histories do not fabricate a memory state', async () => {
    const store = new MemoryEventStore(), history = await HistoryApplication.open(store), before = await store.load();
    const empty = rebuildAdaptiveSchedule(before);
    expect(empty).toMatchObject({ kind: 'engineering-shadow', executable: false, migrated: false });
    expect(Object.keys(empty.units)).toEqual([]); expect(await store.load()).toEqual(before);
    const s = await setup(), raw = await s.store.load(), projected = rebuildAdaptiveSchedule(raw).units[unit.id];
    expect(projected).toMatchObject({ status: 'no-eligible-review', reviews: [], exclusions: [], memory: null, rawDueAt: null });
    expect(await s.store.load()).toEqual(raw); history.close();
  });
  it('AS02 literal HME grades3/3/3 run through the corrected adapter and match actual upstream outputs', async () => {
    const s = await setup(); for (let i = 0; i < 3; i++) await complete(s, i);
    const raw = await s.store.load(), before = canonical(raw), model = rebuildAdaptiveSchedule(raw), projected = model.units[unit.id];
    expect(projected.reviews.map(review => review.effectiveRating)).toEqual([3, 3, 3]);
    expect(observables(projected.reviews)).toEqual(upstream([3, 3, 3]));
    expect(model.target.algorithmVersion).toBe('hme-fsrs6-ts542-round8-0.1.0');
    expect(projected.memory.algorithmVersion).toBe(REFERENCE_FSRS_PROVENANCE.algorithmVersion);
    expect(projected.rawDueAt).toBe(upstream([3, 3, 3]).at(-1).rawDueAt);
    expect(projected).not.toHaveProperty('policyDueAt'); expect(projected).not.toHaveProperty('plans');
    expect(model.sourceWatermark).toBe(raw.revision); expect(model.sourceEventIds).toEqual(raw.events.map(event => event.eventId));
    expect(canonical(raw)).toBe(before); expect(await s.store.load()).toEqual(raw);
  });
  it('AS03 correcting the earliest result recomputes1/3/3 at original times and preserves all raw facts', async () => {
    const s = await setup(); for (let i = 0; i < 3; i++) await complete(s, i);
    const before = await s.store.load();
    await s.app.learning.send(correction(0, { errors: 1 }), { at: '2030-11-21T10:00:00.000Z', commandId: 'test-e1-correct-early' });
    const raw = await s.store.load(), projected = rebuildAdaptiveSchedule(raw).units[unit.id];
    expect(projected.reviews.map(review => review.effectiveRating)).toEqual([1, 3, 3]);
    expect(projected.reviews.map(review => review.at)).toEqual(times);
    expect(observables(projected.reviews)).toEqual(upstream([1, 3, 3]));
    expect(projected.reviews[0].assessmentRevision).toBe(2);
    expect(projected.reviews[0].sourceEventIds).toContain(raw.events.at(-1).eventId);
    expect(projected.memory.lastReviewAt).toBe(times[2]);
    expect(raw.events.slice(0, before.events.length)).toEqual(before.events);
    expect(replayHistory(raw).learning.units[unit.id].memory.algorithmVersion).toBe(FSRS_PROVENANCE.algorithmVersion);
  });
  it('AS04 retracting the middle result to unknown excludes it with reasons and keeps its correction provenance', async () => {
    const s = await setup(); for (let i = 0; i < 3; i++) await complete(s, i);
    await s.app.learning.send(correction(1, { errors: null }), { at: '2030-11-21T10:00:00.000Z' });
    const raw = await s.store.load(), projected = rebuildAdaptiveSchedule(raw).units[unit.id];
    expect(projected.reviews.map(review => review.effectiveRating)).toEqual([3, 3]);
    expect(observables(projected.reviews)).toEqual(upstream([3, 3], [0, 2]));
    expect(projected.exclusions).toHaveLength(1);
    expect(projected.exclusions[0]).toMatchObject({ attemptId: 'test-e1-adaptive-attempt-1', assessmentRevision: 2,
      reasonCodes: expect.arrayContaining(['ASSESSMENT_NOT_ELIGIBLE', 'MISSING_EVIDENCE']),
      sourceEventIds: expect.arrayContaining([raw.events.at(-1).eventId]) });
  });
  it('AS05 command retry and repeated opportunity/cluster cannot add duplicate model reviews', async () => {
    const s = await setup();
    await complete(s, 0, { opportunity: 'test-e1-same-opportunity', cluster: 'test-e1-same-cluster' });
    await complete(s, 1, { opportunity: 'test-e1-same-opportunity', cluster: 'test-e1-second-cluster' });
    await complete(s, 2, { opportunity: 'test-e1-third-opportunity', cluster: 'test-e1-same-cluster' });
    const command = correction(0, { errors: 1 }), options = { at: '2030-11-21T10:00:00.000Z', commandId: 'test-e1-idempotent-correction' };
    await s.app.learning.send(command, options); const before = await s.store.load();
    await s.app.learning.send(command, options);
    expect(await s.store.load()).toEqual(before);
    const projected = rebuildAdaptiveSchedule(before).units[unit.id];
    expect(projected.reviews).toHaveLength(1);
    expect(observables(projected.reviews)).toEqual(upstream([1]));
    expect(projected.exclusions.map(exclusion => exclusion.reasonCodes)).toEqual([
      ['DUPLICATE_TEST_OPPORTUNITY'], ['DUPLICATE_EVIDENCE_CLUSTER']]);
    const duplicated = structuredClone(before); duplicated.events.push(duplicated.events.at(-1));
    expect(() => rebuildAdaptiveSchedule(duplicated)).toThrow();
  });
  it('AS06 canonical repeated replay is deterministic and has no wall-clock mutation', async () => {
    const s = await setup(); for (let i = 0; i < 3; i++) await complete(s, i);
    const raw = await s.store.load(), bytes = canonical(raw), first = canonical(rebuildAdaptiveSchedule(raw));
    for (let i = 0; i < 8; i++) expect(canonical(rebuildAdaptiveSchedule(structuredClone(raw)))).toBe(first);
    expect(canonical(raw)).toBe(bytes);
  });
  it('AS07 encrypted aggregate restore and reopen preserve the corrected projection and legacy interpretation', async () => {
    const s = await setup(); for (let i = 0; i < 3; i++) await complete(s, i);
    await s.app.learning.send(correction(0, { errors: 1 }), { at: '2030-11-21T10:00:00.000Z' });
    const raw = await s.store.load(), units = rebuildAdaptiveSchedule(raw).units, legacy = replayHistory(raw).learning;
    const password = 'test-e1-adaptive-backup-password', backup = await s.app.exportBackup(password);
    await s.app.product.dispatch({ type: 'preferences', patch: { dark: true } });
    await s.app.replaceFromBackup(backup, password, true);
    const reopened = await CompositeApplication.open(s.store, { access: s.access }), restored = await s.store.load();
    expect(restored.events).toEqual(raw.events);
    expect(rebuildAdaptiveSchedule(restored).units).toEqual(units);
    expect(reopened.learning.state).toEqual(legacy);
    expect(rebuildAdaptiveSchedule(restored).sourceWatermark).toBe(restored.revision);
  });
  it('AS08 corrupt, unknown-version and extra-field histories fail without in-place repair', async () => {
    const s = await setup(); await complete(s, 0); const raw = await s.store.load();
    for (const change of [
      value => { value.events.at(-1).data.scope = 'unknown'; },
      value => { value.events.find(event => event.type === 'AssessmentSubmitted').operationId = 'test-unrelated'; },
      value => { value.events.find(event => event.type === 'AssessmentSubmitted').data.extra = true; },
      value => { value.events.find(event => event.type === 'AssessmentSubmitted').versions.fsrsImplementation = REFERENCE_FSRS_PROVENANCE.algorithmVersion; },
    ]) {
      const bad = structuredClone(raw); change(bad); const before = canonical(bad);
      expect(() => rebuildAdaptiveSchedule(bad)).toThrow(); expect(canonical(bad)).toBe(before);
    }
    expect(await s.store.load()).toEqual(raw);
  });
  it('AS09 legacy memory cannot be supplied as a corrected seed; the bridge always rebuilds fromnull', async () => {
    const s = await setup(); await complete(s, 0);
    const raw = await s.store.load(), legacy = replayHistory(raw).learning.units[unit.id].memory;
    expect(() => new ReferenceFsrsAdapter().review(legacy, 3, times[1])).toThrow('UNSUPPORTED_VERSION');
    expect(observables(rebuildAdaptiveSchedule(raw).units[unit.id].reviews)).toEqual(upstream([3]));
    expect(replayHistory(raw).learning.units[unit.id].memory).toEqual(legacy);
  });
  it('AS10 captured timezone changes cannot change absolute elapsed days in the shadow', async () => {
    const s = await setup(); for (let i = 0; i < 3; i++) await complete(s, i);
    const raw = await s.store.load(), expected = observables(rebuildAdaptiveSchedule(raw).units[unit.id].reviews);
    for (const zoneId of ['UTC', 'Asia/Riyadh', 'America/New_York', 'Pacific/Kiritimati']) {
      const shifted = structuredClone(raw); for (const event of shifted.events) if (event.data.scope === 'hme') event.zoneId = zoneId;
      expect(observables(rebuildAdaptiveSchedule(shifted).units[unit.id].reviews)).toEqual(expected);
    }
    expect(expected.map(result => result.elapsedDays)).toEqual([0, 3, 11]);
  });
  it('AS11 unassessed, interrupted and nonchunk attempts remain explicit exclusions', async () => {
    const other = { ...unit, id: 'test-e1-connected', probeProfileVersionId: 'test-connected-unapproved', probeType: 'connected' };
    const s = await setup([unit, other]);
    await complete(s, 0, { termination: 'user_stop' });
    await complete(s, 1, { definition: other });
    await s.app.learning.send({ type: 'SessionStarted', unitId: unit.id, sessionId: 'test-e1-unassessed-session' }, { at: times[2] });
    await s.app.learning.send({ type: 'RecallAttemptStarted', sessionId: 'test-e1-unassessed-session', attemptId: 'test-e1-unassessed' }, { at: times[2] });
    const projection = rebuildAdaptiveSchedule(await s.store.load());
    expect(projection.units[unit.id].reviews).toEqual([]); expect(projection.units[unit.id].memory).toBeNull();
    expect(projection.units[unit.id].exclusions.map(item => item.reasonCodes)).toEqual([
      expect.arrayContaining(['ASSESSMENT_NOT_ELIGIBLE', 'INCOMPLETE_SESSION_RESUME']), ['NO_ASSESSMENT']]);
    expect(projection.units[other.id].exclusions[0].reasonCodes).toContain('FSRS_PROBE_PROFILE_NOT_APPROVED');
    expect(projection.units[other.id].memory).toBeNull();
  });
  it('AS12 legacy due references remain valid and the shadow does not replace plan or product goal data', async () => {
    const s = await setup(); for (let i = 0; i < 3; i++) await complete(s, i);
    const dates = s.app.learning.state.units[unit.id].dates;
    await s.app.learning.send({ type: 'PlanRecomputed', minutes: 30, spentMinutes: 0, futureLoadFeasible: false,
      candidates: [{ id: 'test-e1-plan-task', unitId: unit.id, kind: 'review', costMinutes: 3, priority: 1,
        rawModelDueAt: dates.rawModelDueAt, policyDueAt: dates.policyDueAt, originalDueAt: dates.originalDueAt }] },
      { at: '2030-11-21T10:00:00.000Z' });
    const raw = await s.store.load(), legacy = replayHistory(raw).learning;
    const shadow = rebuildAdaptiveSchedule(raw); expect(observables(shadow.units[unit.id].reviews)).toEqual(upstream([3, 3, 3]));
    expect(replayHistory(raw).learning).toEqual(legacy); expect(await s.store.load()).toEqual(raw);
    expect(shadow.executable).toBe(false); expect(shadow).not.toHaveProperty('plans');
    await s.app.product.dispatch({ type: 'config', config: { ...s.app.product.state.config, minutes: 60 } });
    expect(rebuildAdaptiveSchedule(await s.store.load()).units).toEqual(shadow.units);
  });
  it('AS13 the same opportunity identifiers in different unit identities are not incorrectly deduplicated', async () => {
    const other = { ...unit, id: 'test-e1-second-unit', editionId: 'test-e1-second-edition' };
    const s = await setup([unit, other]);
    await complete(s, 0, { opportunity: 'test-e1-shared-key', cluster: 'test-e1-shared-cluster' });
    await complete(s, 1, { definition: other, opportunity: 'test-e1-shared-key', cluster: 'test-e1-shared-cluster' });
    const projection = rebuildAdaptiveSchedule(await s.store.load());
    expect(projection.units[unit.id].reviews).toHaveLength(1); expect(projection.units[other.id].reviews).toHaveLength(1);
    expect(projection.units[unit.id].exclusions).toEqual([]); expect(projection.units[other.id].exclusions).toEqual([]);
  });
});
