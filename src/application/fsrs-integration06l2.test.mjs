// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadTsFsrsReference } from '../../scripts/fsrs-reference-loader.mjs';
import { FSRS_WEIGHTS } from '../core/fsrs';
import { canonical } from '../core/types';
import { rebuildAdaptiveSchedule } from './adaptive-scheduling';
import { reviewFsrsTransition06l2 } from './fsrs-transition06l2';
import { HistoryApplication, replayHistory } from './history-application';
import { MemoryEventStore } from '../persistence/event-store';
import { exportEncryptedBackup, restoreEncryptedBackup } from '../persistence/backup';
import { fsrsUnit06l2, rubricScenarios06l2, setupFsrs06l2, recordFsrsAttempt06l2, baseTime06l2, offset06l2, clean06l2 } from '../testing/fsrs-integration06l2';
let reference;
beforeAll(async () => { reference = await loadTsFsrsReference(resolve('references/ts-fsrs-5.4.2-verified/package'), 'references/ts-fsrs-5.4.2-verified/receipt.json', FSRS_WEIGHTS); });
const view = reviews => reviews.map(({ result }) => ({ stability: result.state.stability, difficulty: result.state.difficulty,
  retrievabilityBefore: result.retrievabilityBefore, elapsedDays: result.elapsedDays,
  roundedIntervalDays: result.roundedIntervalDays, rawDueAt: result.rawDueAt }));
const upstream = (ratings, times) => reference.probe.run({ initial: null, desiredRetention: .9, reviews: ratings.map((grade, index) => ({ grade, at: times[index] })) });
const shadow = snapshot => rebuildAdaptiveSchedule(snapshot).units[fsrsUnit06l2.id];

describe('06-L2 literal HME mapping and independent corrected scheduler integration', () => {
  it('L2FSRS00 project parameters equal the independently pinned library defaults', async () => {
    const official = await import(pathToFileURL(reference.entryPath).href);
    expect([...FSRS_WEIGHTS]).toEqual([...official.default_w]);
    expect(official.default_request_retention).toBe(.9);
    expect(reference.identity.sourceCommit).toBe('bb71e35a2f5af5a5ac6cce9ef7c41ad24855721d');
  });
  for (const scenario of rubricScenarios06l2) it(`L2FSRS rubric ${scenario.id}: literal grade ${scenario.expectedRating}`, async () => {
    const state = await setupFsrs06l2();
    try {
      const id = await recordFsrsAttempt06l2(state, scenario), raw = await state.store.load();
      const assessment = replayHistory(raw).learning.assessments[id];
      expect(assessment.effectiveRating).toBe(scenario.expectedRating);
      expect(assessment.eligible).toBe(scenario.expectedRating !== null);
      const corrected = shadow(raw);
      expect(corrected.reviews.map(review => review.effectiveRating)).toEqual(scenario.expectedRating === null ? [] : [scenario.expectedRating]);
      expect(view(corrected.reviews)).toEqual(scenario.expectedRating === null ? [] : upstream([scenario.expectedRating], [baseTime06l2]));
      expect(corrected.exclusions).toHaveLength(scenario.expectedRating === null ? 1 : 0);
      expect(await state.store.load()).toEqual(raw);
    } finally { state.app.close(); }
  });
  it('L2FSRS14 all four literal ratings cross 23/25-hour boundaries without calendar-day rounding', async () => {
    const state = await setupFsrs06l2(), times = [0, 23, 48, 72].map(hours => offset06l2(baseTime06l2, hours * 3600000));
    try {
      for (let index = 0; index < 4; index++) await recordFsrsAttempt06l2(state, rubricScenarios06l2[index], times[index]);
      const raw = await state.store.load(), corrected = shadow(raw);
      expect(corrected.reviews.map(review => review.effectiveRating)).toEqual([1, 2, 3, 4]);
      expect(view(corrected.reviews)).toEqual(upstream([1, 2, 3, 4], times));
      expect(corrected.reviews.map(review => review.result.elapsedDays)).toEqual([0, 0, 1, 1]);
      for (const zone of ['Asia/Riyadh', 'America/New_York', 'Pacific/Kiritimati']) {
        const copy = structuredClone(raw); for (const event of copy.events) if (event.data.scope === 'hme') event.zoneId = zone;
        expect(view(shadow(copy).reviews)).toEqual(view(corrected.reviews));
      }
    } finally { state.app.close(); }
  });
  it('L2FSRS15 correction from hard to easy recomputes at the original time, and identical transport is a no-op', async () => {
    const state = await setupFsrs06l2(), times = [0, 2, 365].map(days => offset06l2(baseTime06l2, days * 86400000));
    try {
      for (const [index, scenario] of [rubricScenarios06l2[1], rubricScenarios06l2[2], rubricScenarios06l2[0]].entries()) await recordFsrsAttempt06l2(state, scenario, times[index]);
      const before = await state.store.load();
      const command = { type: 'AssessmentCorrected', attemptId: 'synthetic-06l2-attempt-clean-hard', expectedAssessmentRevision: 1,
        reason: 'synthetic independent grade correction', observation: { ...clean06l2, effort: 'easy' } };
      const options = { commandId: 'synthetic-l2-correction', at: offset06l2(times[2], 86400000) };
      await state.app.learning.send(command, options); const after = await state.store.load();
      await state.app.learning.send(command, options);
      expect(await state.store.load()).toEqual(after);
      expect(after.events.slice(0, before.events.length)).toEqual(before.events);
      const corrected = shadow(after);
      expect(corrected.reviews.map(review => review.effectiveRating)).toEqual([4, 3, 1]);
      expect(corrected.reviews.map(review => review.at)).toEqual(times);
      expect(view(corrected.reviews)).toEqual(upstream([4, 3, 1], times));
      const owner = await HistoryApplication.open(state.store);
      expect((await owner.readAdaptiveSchedule()).units[fsrsUnit06l2.id]).toEqual(corrected);
      expect(replayHistory(after).learning.units[fsrsUnit06l2.id].memory.algorithmVersion).toBe('hme-fsrs6-research-binary64-0.1.0');
    } finally { state.app.close(); }
  });
  it('L2FSRS16 unknown correction retracts the original review without adding a review on correction day', async () => {
    const state = await setupFsrs06l2();
    try {
      await recordFsrsAttempt06l2(state, rubricScenarios06l2[2]);
      await state.app.learning.send({ type: 'AssessmentCorrected', attemptId: 'synthetic-06l2-attempt-clean-normal', expectedAssessmentRevision: 1,
        reason: 'synthetic unknown observation', observation: { ...clean06l2, errors: null } }, { at: offset06l2(baseTime06l2, 86400000) });
      const model = shadow(await state.store.load());
      expect(model.reviews).toEqual([]); expect(model.memory).toBeNull(); expect(model.rawDueAt).toBeNull();
      expect(model.exclusions[0].reasonCodes).toContain('MISSING_EVIDENCE');
    } finally { state.app.close(); }
  });
  it('L2FSRS17 repeated opportunity and cluster keep only the first eligible review in the independent comparison', async () => {
    const state = await setupFsrs06l2(), times = [0, 1, 2].map(days => offset06l2(baseTime06l2, days * 86400000));
    try {
      await recordFsrsAttempt06l2(state, rubricScenarios06l2[1], times[0], 'same-opportunity', 'same-cluster');
      await recordFsrsAttempt06l2(state, rubricScenarios06l2[2], times[1], 'same-opportunity', 'second-cluster');
      await recordFsrsAttempt06l2(state, rubricScenarios06l2[3], times[2], 'third-opportunity', 'same-cluster');
      const corrected = shadow(await state.store.load());
      expect(view(corrected.reviews)).toEqual(upstream([2], [times[0]]));
      expect(corrected.exclusions.map(item => item.reasonCodes)).toEqual([['DUPLICATE_TEST_OPPORTUNITY'], ['DUPLICATE_EVIDENCE_CLUSTER']]);
    } finally { state.app.close(); }
  });
});

describe('06-L2 pre-election transition review and isolated backup rehearsal', () => {
  it('L2FSRS18 product-only source has no invented units, and all execution capabilities remain false', async () => {
    const store = new MemoryEventStore(), owner = await HistoryApplication.open(store);
    const raw = await store.load(), report = await reviewFsrsTransition06l2(raw);
    expect(report.summary).toEqual({ units: 0, unitsWithChangedStateNumbers: 0, unitsWithChangedRawDue: 0, reviewsRebuilt: 0 });
    expect(report).toMatchObject({ executionAllowed: false, migrationPerformed: false, productionElectionChanged: false });
    expect(owner.product.releaseGates.every(g => g.status !== 'passed')).toBe(true); expect(await store.load()).toEqual(raw);
  });
  it('L2FSRS19 report quantifies real state differences and retains historical plans unchanged', async () => {
    const state = await setupFsrs06l2();
    try {
      await recordFsrsAttempt06l2(state, rubricScenarios06l2[2]);
      const dates = state.app.learning.state.units[fsrsUnit06l2.id].dates;
      await state.app.learning.send({ type: 'PlanRecomputed', minutes: 20, spentMinutes: 0, futureLoadFeasible: false,
        candidates: [{ id: 'synthetic-l2-plan', unitId: fsrsUnit06l2.id, kind: 'review', costMinutes: 3, priority: 1,
          rawModelDueAt: dates.rawModelDueAt, policyDueAt: dates.policyDueAt, originalDueAt: dates.originalDueAt }] }, { at: offset06l2(baseTime06l2, 86400000) });
      const raw = await state.store.load(), before = canonical(raw), report = await reviewFsrsTransition06l2(raw);
      expect(report.summary.unitsWithChangedStateNumbers).toBe(1);
      expect(report.history.planEventIds).toEqual([raw.events.at(-1).eventId]);
      expect(report.units[0].historical.dueDates).toEqual(dates);
      expect(report.units[0].corrected.memory.algorithmVersion).not.toBe(report.units[0].historical.memory.algorithmVersion);
      expect(report.units[0].difference.difficulty).toBe(report.units[0].corrected.memory.difficulty - report.units[0].historical.memory.difficulty);
      expect(report.source.eventDigest).toMatch(/^[0-9a-f]{64}$/); expect(canonical(raw)).toBe(before);
      expect(await reviewFsrsTransition06l2(structuredClone(raw))).toEqual(report); expect(await state.store.load()).toEqual(raw);
    } finally { state.app.close(); }
  });
  it('L2FSRS20 copied encrypted history restores, reopens and rolls back in an isolated store without changing the source', async () => {
    const state = await setupFsrs06l2(), target = new MemoryEventStore(), password = 'synthetic-l2-backup-password';
    try {
      await recordFsrsAttempt06l2(state, rubricScenarios06l2[2]);
      const source = await state.store.load(), sourceReport = await reviewFsrsTransition06l2(source);
      await HistoryApplication.open(target); const beforeTarget = await target.load();
      const oldBackup = await exportEncryptedBackup(beforeTarget, password), copyBackup = await state.app.exportBackup(password);
      await restoreEncryptedBackup(target, copyBackup, password, { confirmed: true, expectedRevision: beforeTarget.revision, validateReplay: replayHistory });
      const reopened = await HistoryApplication.open(target), copied = await target.load(), copiedReport = await reviewFsrsTransition06l2(copied);
      expect(copied.events).toEqual(source.events); expect(copiedReport.source.eventDigest).toBe(sourceReport.source.eventDigest);
      expect(copiedReport.units).toEqual(sourceReport.units); expect(reopened.product.releaseGates.every(g => g.status !== 'passed')).toBe(true);
      await restoreEncryptedBackup(target, oldBackup, password, { confirmed: true, expectedRevision: copied.revision, validateReplay: replayHistory });
      expect((await target.load()).events).toEqual(beforeTarget.events); expect(await state.store.load()).toEqual(source);
    } finally { state.app.close(); target.close(); }
  });
  it('L2FSRS21 failed target replacement and stale revision preserve both stores', async () => {
    let fail = false; const target = new MemoryEventStore(() => { if (fail) throw Error('synthetic-target-io-failure'); });
    const state = await setupFsrs06l2(), password = 'synthetic-l2-failure-password';
    try {
      await recordFsrsAttempt06l2(state, rubricScenarios06l2[2]);
      await HistoryApplication.open(target); const before = await target.load(), source = await state.store.load(), backup = await state.app.exportBackup(password);
      fail = true;
      await expect(restoreEncryptedBackup(target, backup, password, { confirmed: true, expectedRevision: before.revision, validateReplay: replayHistory })).rejects.toThrow('synthetic-target-io-failure');
      expect(await target.load()).toEqual(before); expect(await state.store.load()).toEqual(source);
      fail = false;
      await expect(restoreEncryptedBackup(target, backup, password, { confirmed: true, expectedRevision: before.revision + 1, validateReplay: replayHistory })).rejects.toThrow();
      expect(await target.load()).toEqual(before);
    } finally { state.app.close(); target.close(); }
  });
  it('L2FSRS22 malformed or silently relabelled source versions are rejected without mutation', async () => {
    const state = await setupFsrs06l2();
    try {
      await recordFsrsAttempt06l2(state, rubricScenarios06l2[2]); const raw = await state.store.load();
      for (const alter of [value => { value.events.at(-1).versions.fsrsImplementation = 'hme-fsrs6-ts542-round8-0.1.0'; },
        value => { value.events.push(structuredClone(value.events.at(-1))); }, value => { value.events.at(-1).data.scope = 'unrecognized'; }]) {
        const bad = structuredClone(raw); alter(bad); const bytes = canonical(bad);
        await expect(reviewFsrsTransition06l2(bad)).rejects.toThrow(); expect(canonical(bad)).toBe(bytes);
      }
      expect(await state.store.load()).toEqual(raw);
    } finally { state.app.close(); }
  });
});
