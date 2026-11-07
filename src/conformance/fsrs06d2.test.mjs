// @vitest-environment node
/** Actual pinned upstream bytes; all learner records are isolated synthetic facts. */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadTsFsrsReference } from '../../scripts/fsrs-reference-loader.mjs';
import { FSRS06D2_CASES } from '../../scripts/fsrs-06d2-cases.mjs';
import { FSRS_WEIGHTS, FSRS_PROVENANCE } from '../core/fsrs';
import { RoundedFsrsAdapter } from '../core/fsrs-rounded';
import { roundedCandidateProbe } from './fsrs-rounded-probe';
import { compareFsrsReference } from './fsrs-conformance';
import { FSRS_CONFORMANCE_CASES } from './fsrs-suite';
import { CompositeApplication } from '../application/composite-application';
import { replayLearning } from '../application/learning';
import { MemoryEventStore } from '../persistence/event-store';
import { createSyntheticLearningAccess } from '../testing/learning-access';
import { LEARNING_VERSIONS } from '../core/types';
let reference, library;
const observations = [];
const digestEvents = events => createHash('sha256').update(JSON.stringify(events)).digest('hex');
afterAll(async () => {
  await writeFile('docs/06d2/evidence/fsrs-integration-observations.json', JSON.stringify({ syntheticOnly: true, checkedAt: new Date().toISOString(), assertions: 'See fsrs-integration-tests.json or final suite results; these records are observations, not production approval', observations }, null, 2) + '\n');
});
beforeAll(async () => {
  reference = await loadTsFsrsReference(resolve('references/ts-fsrs-5.4.2-verified/package'), 'references/ts-fsrs-5.4.2-verified/receipt.json', FSRS_WEIGHTS);
  library = await import(pathToFileURL(reference.entryPath).href);
});
const unit = { id: 'test-d2-fsrs-unit', editionId: 'test-d2-fsrs-edition', probeProfileVersionId: 'chunk-P0-1', words: 10, coverage: ['test:d2:fsrs:1'] };
const times = ['2030-11-06T21:00:00.000Z', '2030-11-09T21:00:00.000Z', '2030-11-20T21:00:00.000Z'];
const clean = { attemptedWords: 10, errors: 0, completion: 'complete', effort: 'normal', gapVerified: true };
const atOffset = (at, delta) => new Date(Date.parse(at) + delta).toISOString();
async function setup() {
  const store = new MemoryEventStore(), access = await createSyntheticLearningAccess([unit]);
  const app = await CompositeApplication.open(store, { access });
  await app.learning.send({ type: 'UnitRegistered', unit }, { at: atOffset(times[0], -10000) });
  return { store, access, app };
}
async function complete(s, index, observation = clean) {
  const sessionId = 'test-d2-fsrs-session-' + index, attemptId = 'test-d2-fsrs-attempt-' + index, at = times[index];
  await s.app.learning.send({ type: 'SessionStarted', unitId: unit.id, sessionId }, { at: atOffset(at, -1000) });
  await s.app.learning.send({ type: 'RecallAttemptStarted', sessionId, attemptId }, { at });
  await s.app.learning.send({ type: 'RecallAttemptCompleted', sessionId, termination: 'completed' }, { at: atOffset(at, 1000) });
  await s.app.learning.send({ type: 'AssessmentSubmitted', attemptId, observation }, { at: atOffset(at, 2000) });
  await s.app.learning.send({ type: 'SessionEnded', sessionId }, { at: atOffset(at, 3000) });
}
function expectedFor(grades, indexes = grades.map((_, i) => i)) {
  return reference.probe.run({ id: 'independent-expected-only', branch: 'historical-replay', initial: null, desiredRetention: .9,
    reviews: grades.map((grade, i) => ({ grade, at: times[indexes[i]] })) });
}
function numericalMismatch(memory, expected) {
  const tolerance = 1e-12 + 1e-12 * Math.max(Math.abs(memory.stability), Math.abs(expected.stability));
  return Math.abs(memory.stability - expected.stability) > tolerance || Math.abs(memory.difficulty - expected.difficulty) > 1e-12 + 1e-12 * Math.max(Math.abs(memory.difficulty), Math.abs(expected.difficulty));
}

describe('06-D2 pinned-library independent arithmetic and HME shadow evidence', () => {
  it('D2F01 executes verified upstream bytes and checks actual settings against project versions', () => {
    expect(reference.identity).toMatchObject({ name: 'ts-fsrs', version: '5.4.2', filesVerified: 13, executed: true });
    expect(reference.sourceBinding.cryptographicProvenanceVerified).toBe(false);
    expect([...FSRS_WEIGHTS]).toEqual(library.default_w);
    const parameters = library.fsrs({ w: [...FSRS_WEIGHTS], request_retention: .9, maximum_interval: 36500, enable_fuzz: false, enable_short_term: true, learning_steps: [], relearning_steps: [] }).parameters;
    expect(parameters).toMatchObject({ w: [...FSRS_WEIGHTS], request_retention: .9, maximum_interval: 36500, enable_fuzz: false, enable_short_term: true, learning_steps: [], relearning_steps: [] });
    expect(LEARNING_VERSIONS).toMatchObject({ desiredRetention: .9, effectiveReviewTime: 'recall-start-v1', modelTimePolicy: 'floor-elapsed-seconds-divided-by-86400-0.1.0', fsrsImplementation: 'hme-fsrs6-research-binary64-0.1.0' });
    const expected = reference.probe.run({ initial: null, desiredRetention: .9, reviews: [{ grade: 2, at: times[0] }] });
    expect(expected[0]).toMatchObject({ stability: 1.2931, difficulty: 5.11217071, roundedIntervalDays: 1 });
  });
  it('D2F02 distinguishes successful mismatch detection from conformance: selected still fails 30/32', () => {
    const report = compareFsrsReference(reference, undefined, [...FSRS_CONFORMANCE_CASES, ...FSRS06D2_CASES]);
    expect(report.status).toBe('nonconformant');
    expect(report.summary).toEqual({ passed: 2, failed: 30, blocked: 0 });
    expect(report.cases.every(x => x.expected !== null)).toBe(true);
    expect(FSRS_PROVENANCE.approvedForProduction).toBe(false);
  });
  for (const input of FSRS06D2_CASES) it(input.id + ' candidate only exactly matches freshly executed upstream', () => {
    expect(roundedCandidateProbe.run(input)).toEqual(reference.probe.run(input));
  });
  it('D2F03 offset-equivalent instants and local midnight do not invent a whole elapsed day', () => {
    const equivalent = reference.probe.run(FSRS06D2_CASES[0]);
    expect(equivalent.map(x => x.elapsedDays)).toEqual([0, 0, 0]);
    expect(reference.probe.run(FSRS06D2_CASES[1])[0].elapsedDays).toBe(0);
    expect(reference.probe.run(FSRS06D2_CASES[2])[0].elapsedDays).toBe(1);
    const utc = structuredClone(FSRS06D2_CASES[0]);
    utc.reviews = utc.reviews.map(r => ({ ...r, at: new Date(r.at).toISOString() }));
    expect(reference.probe.run(utc)).toEqual(equivalent);
    expect(roundedCandidateProbe.run(utc)).toEqual(equivalent);
  });
  it('D2F04 correcting the earliest HME review rebuilds the whole historical sequence, with external mismatch still visible', async () => {
    const s = await setup(); for (let i = 0; i < 3; i++) await complete(s, i);
    const original = await s.store.load(), previous = s.app.learning.state.units[unit.id].memory;
    expect(Object.values(s.app.learning.state.assessments).map(x => x.effectiveRating)).toEqual([3, 3, 3]);
    await s.app.learning.send({ type: 'AssessmentCorrected', attemptId: 'test-d2-fsrs-attempt-0', expectedAssessmentRevision: 1, reason: 'synthetic correction', observation: { ...clean, errors: 1 } }, { at: '2030-11-21T10:00:00.000Z', commandId: 'test-d2-correction' });
    const current = s.app.learning.state, expected = expectedFor([1, 3, 3]);
    expect(Object.values(current.assessments).map(x => x.effectiveRating)).toEqual([1, 3, 3]);
    expect(current.units[unit.id].memory.lastReviewAt).toBe(times[2]);
    expect(current.units[unit.id].memory).not.toEqual(previous);
    observations.push({ scenario: 'correct-earliest', literalExpectedRatings: [1,3,3], originalTimes: times, correctionAt: '2030-11-21T10:00:00.000Z', expectedFromUpstream: expected, actualSelectedMemory: current.units[unit.id].memory, actualRawDueAt: current.units[unit.id].dates.rawModelDueAt, interpretation: 'selected arithmetic nonconformant; original-time correction verified separately' });
    expect(numericalMismatch(current.units[unit.id].memory, expected.at(-1))).toBe(true);
    expect((await s.store.load()).events.slice(0, original.events.length)).toEqual(original.events);
    // Expected outputs come from upstream, never from HME. Candidate is evaluated only in shadow.
    expect(roundedCandidateProbe.run({ initial: null, desiredRetention: .9, reviews: [1, 3, 3].map((grade, i) => ({ grade, at: times[i] })) })).toEqual(expected);
    const beforeRetry = await s.store.load();
    await s.app.learning.send({ type: 'AssessmentCorrected', attemptId: 'test-d2-fsrs-attempt-0', expectedAssessmentRevision: 1, reason: 'synthetic correction', observation: { ...clean, errors: 1 } }, { at: '2030-11-21T10:00:00.000Z', commandId: 'test-d2-correction' });
    expect(await s.store.load()).toEqual(beforeRetry);
  });
  it('D2F05 retracting a middle review to unknown removes it from memory replay instead of adding a review today', async () => {
    const s = await setup(); for (let i = 0; i < 3; i++) await complete(s, i);
    await s.app.learning.send({ type: 'AssessmentCorrected', attemptId: 'test-d2-fsrs-attempt-1', expectedAssessmentRevision: 1, reason: 'unknown errors', observation: { ...clean, errors: null } }, { at: '2030-11-21T10:00:00Z' });
    const projection = s.app.learning.state;
    expect(projection.assessments['test-d2-fsrs-attempt-1']).toMatchObject({ eligible: false, effectiveRating: null });
    const expected = expectedFor([3, 3], [0, 2]);
    observations.push({ scenario: 'retract-middle', literalExpectedRatings: [3,3], originalTimes: [times[0], times[2]], expectedFromUpstream: expected, actualSelectedMemory: projection.units[unit.id].memory });
    expect(projection.units[unit.id].memory.lastReviewAt).toBe(times[2]);
    expect(numericalMismatch(projection.units[unit.id].memory, expected.at(-1))).toBe(true);
    expect(roundedCandidateProbe.run(FSRS06D2_CASES.find(x => x.id === 'D2-FSRS-RETRACT-MIDDLE'))).toEqual(expected);
  });
  it('D2F06 encrypted aggregate restore and reopening preserve raw versioned history and the same independent comparison', async () => {
    const s = await setup(); for (let i = 0; i < 3; i++) await complete(s, i);
    await s.app.learning.send({ type: 'AssessmentCorrected', attemptId: 'test-d2-fsrs-attempt-0', expectedAssessmentRevision: 1, reason: 'correct before backup', observation: { ...clean, errors: 1 } }, { at: '2030-11-21T10:00:00Z' });
    const raw = await s.store.load(), before = s.app.learning.state.units[unit.id], password = 'test-d2-fsrs-backup-password';
    const backup = await s.app.exportBackup(password);
    await s.app.product.dispatch({ type: 'preferences', patch: { dark: true } });
    await s.app.replaceFromBackup(backup, password, true);
    expect((await s.store.load()).events).toEqual(raw.events);
    const reopened = await CompositeApplication.open(s.store, { access: s.access });
    expect(reopened.learning.state.units[unit.id]).toEqual(before);
    observations.push({ scenario: 'restore-and-reopen', rawEventsBeforeSha256: digestEvents(raw.events), rawEventsRestoredSha256: digestEvents((await s.store.load()).events), algorithmVersion: reopened.learning.state.units[unit.id].memory.algorithmVersion, expectedFromUpstream: expectedFor([1,3,3]).at(-1), actualSelectedMemory: reopened.learning.state.units[unit.id].memory });
    expect(numericalMismatch(reopened.learning.state.units[unit.id].memory, expectedFor([1, 3, 3]).at(-1))).toBe(true);
    expect((await s.store.load()).events.every(e => e.versions.fsrsImplementation === FSRS_PROVENANCE.algorithmVersion)).toBe(true);
    expect((await reopened.readProgress(new Date('2030-11-22T00:00:00Z'))).review.due).toBeNull();
  });
  it('D2F07 historical evidence or memory cannot silently migrate to the rounded candidate', async () => {
    const s = await setup(); await complete(s, 0); const original = await s.store.load();
    const changed = structuredClone(original);
    const event = changed.events.find(e => e.data.scope === 'hme' && e.type === 'AssessmentSubmitted');
    event.versions.fsrsImplementation = 'hme-fsrs6-ts542-round8-0.1.0';
    expect(() => replayLearning(changed)).toThrow();
    expect(() => new RoundedFsrsAdapter().review(s.app.learning.state.units[unit.id].memory, 3, times[1])).toThrow(/migration/);
    expect(await s.store.load()).toEqual(original);
  });
});
