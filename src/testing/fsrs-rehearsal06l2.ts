/** Real IndexedDB copy/restore/rollback rehearsal on freshly-created QA stores.
 * No production DB name, real learner input, or engine election is accepted. */
import { IndexedDbEventStore } from '../persistence/event-store';
import { HistoryApplication, replayHistory } from '../application/history-application';
import { reviewFsrsTransition06l2 } from '../application/fsrs-transition06l2';
import { exportEncryptedBackup, restoreEncryptedBackup } from '../persistence/backup';
import { rebuildAdaptiveSchedule } from '../application/adaptive-scheduling';
import { canonical } from '../core/types';
import { historyFixture06d2 } from './history-fixture06d2';
import { addCompanionAttempt, unitId } from '../companion/test-fixture';
export async function runFsrsRehearsal06l2() {
  const prefix = 'mulazama-06l2-fsrs-rehearsal-', sourceName = prefix + 'source-' + crypto.randomUUID(), targetName = prefix + 'target-' + crypto.randomUUID();
  const stores: IndexedDbEventStore[] = [];
  const open = async (name: string) => { const store = await IndexedDbEventStore.open(name); stores.push(store); return store; };
  try {
    const sourceStore = await open(sourceName), targetStore = await open(targetName);
    const fixture = historyFixture06d2('2032-03-13T17:00:00.000Z');
    fixture.events.at(-1)!.data.command = { type: 'AssessmentSubmitted', attemptId: 'synthetic-history-attempt',
      observation: { attemptedWords: 10, errors: 0, completion: 'complete', effort: 'hard', gapVerified: true } };
    addCompanionAttempt(fixture, 'synthetic-06l2-second', 'synthetic-06l2-second', 'synthetic-06l2-second', '2032-03-16T17:00:00.000Z');
    fixture.events.at(-1)!.data.command = { type: 'AssessmentSubmitted', attemptId: 'synthetic-06l2-second',
      observation: { attemptedWords: 10, errors: 0, completion: 'complete', effort: 'normal', gapVerified: true } };
    await sourceStore.replace(fixture.events, 0);
    const sourceOwner = await HistoryApplication.open(sourceStore);
    const password = 'synthetic-06l2-rehearsal-password';
    const source = await sourceStore.load(), sourceReview = await reviewFsrsTransition06l2(source);
    await HistoryApplication.open(targetStore); const originalTarget = await targetStore.load();
    const rollbackBackup = await exportEncryptedBackup(originalTarget, password), backup = await sourceOwner.exportBackup(password);
    await restoreEncryptedBackup(targetStore, backup, password, { confirmed: true, expectedRevision: originalTarget.revision, validateReplay: replayHistory });
    targetStore.close();
    const reopened = await open(targetName), owner = await HistoryApplication.open(reopened), copy = await reopened.load();
    const copiedReview = await reviewFsrsTransition06l2(copy);
    const copiedCorrected = (await owner.readAdaptiveSchedule()).units[unitId];
    const originalCorrected = rebuildAdaptiveSchedule(source).units[unitId];
    // Public HistoryApplication still rejects activation/restore of gated learning
    // data. Low-level restore above operates only on these disposable QA stores.
    const refused = await owner.inspectBackup(backup, password);
    await restoreEncryptedBackup(reopened, rollbackBackup, password, { confirmed: true, expectedRevision: copy.revision, validateReplay: replayHistory });
    const restoredOriginal = await reopened.load();
    return {
      kind: 'synthetic-indexeddb-copy-restore-rollback-rehearsal', realLearnerDataUsed: false,
      sourceEventsUnchanged: canonical(await sourceStore.load()) === canonical(source),
      copiedEventsEqual: canonical(copy.events) === canonical(source.events),
      sourceDigestPreserved: sourceReview.source.eventDigest === copiedReview.source.eventDigest,
      correctedProjectionStableAfterReopen: canonical(originalCorrected) === canonical(copiedCorrected),
      rollbackEventsEqual: canonical(restoredOriginal.events) === canonical(originalTarget.events),
      legacyAlgorithmPreserved: replayHistory(copy).learning!.units[unitId].memory!.algorithmVersion === 'hme-fsrs6-research-binary64-0.1.0',
      productionHistoryRestoreStillBlocked: !refused.compatible,
      releaseGatesStillBlocked: owner.product.releaseGates.every(gate => gate.status !== 'passed'),
      engineMigrationPerformed: false, sourceEventCount: source.events.length,
      sourceEventDigest: sourceReview.source.eventDigest,
      cleanupDatabaseNames: [sourceName, targetName],
    };
  } finally {
    for (const store of stores) store.close();
    for (const name of [sourceName, targetName]) await new Promise<void>((resolve, reject) => {
      const deletion = indexedDB.deleteDatabase(name);
      deletion.onsuccess = () => resolve(); deletion.onerror = () => reject(deletion.error);
      deletion.onblocked = () => reject(Error('QA database cleanup blocked'));
    });
  }
}
