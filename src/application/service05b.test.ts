// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ApplicationService, replayProduct } from './service';
import { DomainError, VERSIONS, type EventSnapshot, type LearningEvent } from '../core/types';
import { initialState } from '../domain/state';
import { MemoryEventStore } from '../persistence/event-store';
import { exportEncryptedBackup } from '../persistence/backup';

/** All payloads are product settings/declarations, not Quran or learning evidence. */
function fact(type: string, eventId: string, commandId: string, data: Record<string, unknown>): LearningEvent {
  return { eventId, commandId, operationId: commandId, userId: 'local-user-05b', unitId: null, type,
    occurredAt: '2026-11-05T10:00:00.000Z', receivedAt: '2026-11-05T10:00:00.000Z',
    zoneId: 'Asia/Riyadh', source: 'product', coverage: [], versions: { ...VERSIONS }, data: { scope: 'product', ...data } };
}
function fixture(): EventSnapshot {
  return { revision: 2, events: [fact('ProfileInitialized', 'evt-init', 'cmd-init', {}),
    fact('PreferencesRevised', 'evt-prefs', 'cmd-prefs', { action: { type: 'preferences', patch: { dark: true } }, generatedIds: [] })] };
}
const changed = (change: (s: EventSnapshot) => void) => { const s = fixture(); change(s); return s; };
const rejects = (snapshot: EventSnapshot) => expect(() => replayProduct(snapshot)).toThrow(DomainError);

describe('05B product raw replay and backup governance', () => {
  it('PR05B01 preserves valid legacy 05A product settings and declaration history', () => {
    const snapshot = fixture(), before = structuredClone(snapshot), state = replayProduct(snapshot);
    expect(state.profileId).toBe('local-user-05b'); expect(state.preferences.dark).toBe(true);
    expect(state.attempts).toEqual([]); expect(snapshot).toEqual(before);
  });
  it('PR05B02 rejects identical duplicate event IDs in the raw stream', () => {
    rejects(changed(s => s.events.push(structuredClone(s.events[1]))));
  });
  it('PR05B03 rejects conflicting duplicate event IDs', () => {
    rejects(changed(s => { const e = structuredClone(s.events[1]); e.commandId = e.operationId = 'cmd-other'; e.data.action = { type: 'preferences', patch: { dark: false } }; s.events.push(e); }));
  });
  it('PR05B04 rejects a duplicate product command under a fresh event ID even if its payload matches', () => {
    rejects(changed(s => { const e = structuredClone(s.events[1]); e.eventId = 'evt-duplicate-command'; s.events.push(e); }));
  });
  it('PR05B05 rejects reuse of the initialization command as a later mutation', () => {
    rejects(changed(s => { s.events[1].commandId = s.events[1].operationId = 'cmd-init'; }));
  });
  it('PR05B06 rejects a different payload under the same command identity', () => {
    rejects(changed(s => { const e = structuredClone(s.events[1]); e.eventId = 'evt-other'; e.data.action = { type: 'preferences', patch: { dark: false } }; s.events.push(e); }));
  });
  it('PR05B07 binds operationId to the product command', () => {
    rejects(changed(s => { s.events[1].operationId = 'another-operation'; }));
  });
  it.each(['V1', 'V2', 'V4'] as const)('PR05B08 product preference facts cannot claim learning assessment source %s', source => {
    rejects(changed(s => { s.events[1].source = source; }));
  });
  it('PR05B09 product preferences cannot claim observed text coverage or unit evidence', () => {
    rejects(changed(s => { s.events[1].coverage = ['fabricated-observed-range']; }));
    rejects(changed(s => { s.events[1].unitId = 'fabricated-learning-unit'; }));
  });
  it.each(['not-a-time', '2026-02-30T10:00:00.000Z', '2026-11-05', '2026-11-05T10:00:00+03:00'])('PR05B10 raw event time must be a real UTC instant: %s', occurredAt => {
    rejects(changed(s => { s.events[0].occurredAt = occurredAt; }));
    rejects(changed(s => { s.events[1].receivedAt = occurredAt; }));
  });
  it('PR05B11 does not reorder valid facts when a device clock moves backwards', () => {
    const snapshot = fixture(); snapshot.events[1].occurredAt = snapshot.events[1].receivedAt = '2026-11-04T10:00:00.000Z';
    expect(replayProduct(snapshot).preferences.dark).toBe(true);
  });
  it('PR05B12 enforces the supported product capture zone rather than silently ignoring a different zone', () => {
    rejects(changed(s => { s.events[1].zoneId = 'Not/AZone'; }));
    rejects(changed(s => { s.events[1].zoneId = 'Europe/Paris'; }));
  });
  it.each([-1, NaN, Infinity, 1.5])('PR05B13 rejects malformed snapshot revision %s', revision => {
    rejects(changed(s => { s.revision = revision; }));
  });
  it('PR05B14 rejects unknown algorithm versions and extra version fields', () => {
    rejects(changed(s => { (s.events[1].versions as unknown as Record<string, unknown>).algorithm = 'unknown-engine'; }));
    rejects(changed(s => { (s.events[1].versions as unknown as Record<string, unknown>).unreviewedInterpreter = 'silently-upgraded'; }));
  });
  it('PR05B15 applies the runtime config schema to initialized profiles too', () => {
    rejects(changed(s => { s.events[0].data.config = { ...initialState().config, hiddenOverride: true }; }));
    rejects(changed(s => { s.events[0].data.config = { ...initialState().config, days: [0, 0] }; }));
  });
  it('PR05B16 rejects unsupported initialization payload fields instead of discarding them', () => {
    rejects(changed(s => { s.events[0].data.approved = true; }));
    rejects(changed(s => { s.events[0].data.action = { type: 'session.start', kind: 'new', rangeLabel: 'not-approved' }; }));
  });
  it('PR05B17 rejects unsupported metadata or claim fields in a stored command body', () => {
    rejects(changed(s => { (s.events[1].data.action as Record<string, unknown>).now = '2026-11-06T10:00:00.000Z'; }));
    rejects(changed(s => { (s.events[1].data.action as Record<string, unknown>).commandId = 'hidden-other-command'; }));
    rejects(changed(s => { s.events[1].data.mastery = 'verified'; }));
  });
  it('PR05B18 validates generated identifiers, their uniqueness and exact consumption', () => {
    rejects(changed(s => { s.events[1].data.generatedIds = ['unused']; }));
    const snapshot = fixture(); snapshot.events[1] = fact('ProductMistakeDraftRecorded', 'evt-mistake-a', 'cmd-mistake-a', {
      action: { type: 'mistake.add', draft: { attemptId: null, location: null, type: 'unknown', certainty: 'suspected', selfCorrected: null, assistanceUsed: null, note: '' } }, generatedIds: ['same-generated-id'] });
    const duplicate = structuredClone(snapshot.events[1]); duplicate.eventId = 'evt-mistake-b'; duplicate.commandId = duplicate.operationId = 'cmd-mistake-b'; snapshot.events.push(duplicate);
    rejects(snapshot);
  });
  it('PR05B19 refuses hidden or accessor-bearing raw envelopes without evaluating getters', () => {
    const snapshot = fixture(), getter = vi.fn(() => ({ ...VERSIONS }));
    Object.defineProperty(snapshot.events[0], 'versions', { enumerable: true, get: getter });
    rejects(snapshot); expect(getter).not.toHaveBeenCalled();
  });
  it('PR05B20 malformed encrypted product backup cannot replace current user data', async () => {
    const liveStore = new MemoryEventStore(), service = await ApplicationService.open(liveStore);
    await service.dispatch({ type: 'preferences', patch: { largeText: true } });
    const before = await liveStore.load(), password = 'synthetic-recovery-secret-05b';
    const adversarial = changed(s => { s.events[1].source = 'V4'; s.events[1].coverage = ['invented-covered-range']; });
    const encrypted = await exportEncryptedBackup(adversarial, password);
    expect((await service.inspectBackup(encrypted, password)).compatible).toBe(false);
    await expect(service.replaceFromBackup(encrypted, password, true)).rejects.toThrow(DomainError);
    expect(await liveStore.load()).toEqual(before); expect(service.state.preferences.largeText).toBe(true);
  });
  it('PR05B21 accepts the exact legacy reset initialization shape, preserving config and preferences', () => {
    const defaults = initialState(), config = { ...defaults.config, persona: 'complete' as const, minutes: 60, goal: 'maintain' as const, configured: true };
    const preferences = { ...defaults.preferences, largeText: true, reducedMotion: true };
    // A store CAS revision is not a raw event count and may increase on restore/reset.
    const snapshot: EventSnapshot = { revision: 42, events: [fact('ProfileInitialized', 'evt-reset-init', 'cmd-reset', { config, preferences })] };
    const restored = replayProduct(snapshot);
    expect(restored.config).toEqual(config); expect(restored.preferences).toEqual(preferences);
    expect(restored.ranges).toEqual([]); expect(restored.mistakes).toEqual([]); expect(restored.attempts).toEqual([]);
  });
});
