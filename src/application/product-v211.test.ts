// @vitest-environment node
import {describe, expect, it} from 'vitest';
import {MemoryProductStore, type ProductStore, type ProductCommit} from '../persistence/product-v211-store';
import {ProductV211, PRODUCT_NAMESPACE, replayProductEvents, type ProductState, type ProductEvent, type ProductCommand} from './product-v211';

const plan: Extract<ProductCommand, {type: 'configure-plan'}> = {
  type: 'configure-plan', declaredRanges: [], hifzTarget: 2, linkTarget: 2, cycleDays: 7,
  anchorDate: '2026-11-07', zoneId: 'Asia/Riyadh', startOrdinal: 0,
};
async function setup(date = '2026-11-07T12:00:00Z', configuration = plan) {
  const store = new MemoryProductStore<ProductState, ProductEvent>();
  let now = date;
  const clock = () => new Date(now);
  const service = await ProductV211.open(store, {clock});
  await service.dispatch(configuration);
  return {service, store, clock, setDate: (date: string) => { now = date; }};
}
async function finishHifz(service: ProductV211, range?: {start: number; end: number}) {
  await service.dispatch({type: 'start-hifz', ...(range ? {range} : {})});
  const session = service.view().activeHifz!;
  for (let n = session.count; n < session.targetSnapshot; n++) await service.dispatch({type: 'add-repetition', sessionId: session.id});
  return service.state.sessions.find(s => s.id === session.id)!;
}

describe('V2.1.1 durable product journey (synthetic content only)', () => {
  it('preserves fixed session targets and ranges over plan edits, pause, reopen and resume', async () => {
    const {service, store, clock} = await setup();
    await service.dispatch({type: 'start-hifz'});
    const session = service.view().activeHifz!;
    await service.dispatch({type: 'add-repetition', sessionId: session.id});
    await service.dispatch({type: 'pause-session', sessionId: session.id});
    await service.dispatch({...plan, hifzTarget: 5, startOrdinal: 16});
    const reopened = await ProductV211.open(store, {clock});
    expect(reopened.view().activeHifz).toMatchObject({id: session.id, count: 1, state: 'paused', targetSnapshot: 2, rangeSnapshot: [{start: 0, end: 8}], planVersion: 1});
    await reopened.dispatch({type: 'resume-session', sessionId: session.id});
    await reopened.dispatch({type: 'add-repetition', sessionId: session.id});
    expect(reopened.state.completions).toHaveLength(1);
    expect(reopened.state.completions[0].eligibleFrom).toBe('2026-11-14');
    expect(reopened.view().counts).toMatchObject({hifz: 1, coveredUnits: 8});
    expect((await reopened.exportData()).outbox.every(record => record.status === 'pending')).toBe(true);
  });

  it('uses command IDs for exactly-once effect, rejects altered retries, and reverses one specific repetition once', async () => {
    const {service, store} = await setup();
    await service.dispatch({type: 'start-hifz'});
    const session = service.view().activeHifz!;
    const command: ProductCommand = {type: 'add-repetition', sessionId: session.id};
    await service.dispatch(command, {commandId: 'repeat-once'});
    const revision = service.state.revision;
    await service.dispatch(command, {commandId: 'repeat-once', expectedRevision: 0});
    expect(service.state.revision).toBe(revision);
    await expect(service.dispatch({type: 'pause-session', sessionId: session.id}, {commandId: 'repeat-once'})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    const repetitionId = service.view().activeHifz!.activeRepetitionIds[0];
    await service.dispatch({type: 'undo-repetition', sessionId: session.id, repetitionId});
    await expect(service.dispatch({type: 'undo-repetition', sessionId: session.id, repetitionId})).rejects.toThrow('REPETITION_NOT_REVERSIBLE');
    const snapshot = await store.load();
    expect(snapshot.events).toHaveLength(snapshot.state!.revision);
    expect(snapshot.outbox).toHaveLength(snapshot.events.length);
    expect(service.view().activeHifz!.count).toBe(0);
  });

  it('keeps consolidation independent and requires an immediately adjacent memorized reference face', async () => {
    const {service} = await setup('2026-11-07T12:00:00Z', {...plan, declaredRanges: [{start: 0, end: 8}], startOrdinal: 8});
    const hifz = await finishHifz(service);
    await service.dispatch({type: 'start-link', hifzSessionId: hifz.id});
    const link = service.view().activeLink!;
    expect(link).toMatchObject({previousRange: {start: 0, end: 8}, newRange: {start: 8, end: 16}, targetSnapshot: 2});
    await service.dispatch({type: 'add-repetition', sessionId: link.id});
    await service.dispatch({type: 'pause-session', sessionId: link.id});
    await service.dispatch({type: 'resume-session', sessionId: link.id});
    await service.dispatch({type: 'add-repetition', sessionId: link.id});
    expect(service.view().counts).toMatchObject({hifz: 1, link: 1});
    expect(service.state.sessions.find(s => s.id === hifz.id)!.count).toBe(2);
    await service.dispatch({type: 'undo-repetition', sessionId: hifz.id});
    expect(service.state.sessions.find(s => s.id === link.id)!.state).toBe('disputed');
    await service.dispatch({type: 'add-repetition', sessionId: hifz.id});
    expect(service.state.sessions.find(s => s.id === link.id)).toMatchObject({state: 'completed', count: 2, targetSnapshot: 2});
    await expect(service.dispatch({type: 'add-repetition', sessionId: link.id})).rejects.toThrow('SESSION_NOT_ACTIVE');
    const noPrevious = await setup();
    const first = await finishHifz(noPrevious.service);
    await expect(noPrevious.service.dispatch({type: 'start-link', hifzSessionId: first.id})).rejects.toThrow('ADJACENCY_REQUIRED');
    const gap = await setup('2026-11-07T12:00:00Z', {...plan, declaredRanges: [{start: 0, end: 7}], startOrdinal: 8});
    const second = await finishHifz(gap.service);
    await expect(gap.service.dispatch({type: 'start-link', hifzSessionId: second.id})).rejects.toThrow('ADJACENCY_REQUIRED');
  });

  it('freezes one Friday snapshot, reports later completion separately, and transfers Saturday regardless of Friday completion', async () => {
    const {service, setDate, store, clock} = await setup();
    await finishHifz(service);
    setDate('2026-11-13T09:00:00Z');
    await finishHifz(service);
    await service.dispatch({type: 'start-week-review'});
    const snapshot = service.state.reviews[0];
    expect(snapshot).toMatchObject({kind: 'friday', weekStart: '2026-11-07', localDate: '2026-11-13', rangesSnapshot: [{start: 0, end: 16}], status: 'active'});
    expect(snapshot.rangeHash).toMatch(/^[a-f0-9]{64}$/);
    setDate('2026-11-13T11:00:00Z');
    await finishHifz(service);
    await service.dispatch({type: 'start-week-review'});
    expect(service.state.reviews).toHaveLength(1);
    expect(service.state.reviews[0]).toEqual(snapshot);
    expect(service.view().weeklyLateRanges).toEqual([{start: 16, end: 24}]);
    expect(service.state.tasks).toHaveLength(0);
    setDate('2026-11-15T12:00:00Z'); // App was closed on Saturday.
    const reopened = await ProductV211.open(store, {clock});
    expect(reopened.state.transferredCompletionIds).toHaveLength(3);
    expect(reopened.state.reviews[0].status).toBe('active');
    const tasks = reopened.state.tasks;
    expect(tasks[0].originalDueDate).toBe('2026-11-14');
    expect(tasks.flatMap(t => t.ranges).reduce((n, r) => n + r.end - r.start, 0)).toBe(24);
    await reopened.dispatch({type: 'refresh-taahud'});
    expect(reopened.state.tasks).toEqual(tasks);
  });

  it('uses account timezone for Friday boundary and separates daily snapshots by date', async () => {
    const {service, setDate} = await setup('2026-11-12T20:59:00Z');
    await finishHifz(service);
    await service.dispatch({type: 'start-week-review'});
    expect(service.state.reviews[0].kind).toBe('daily');
    setDate('2026-11-12T21:00:00Z');
    await service.dispatch({type: 'start-week-review'});
    expect(service.state.reviews[1]).toMatchObject({kind: 'friday', localDate: '2026-11-13', weekStart: '2026-11-07'});
    expect(service.state.reviews.filter(r => r.localDate === '2026-11-13')).toHaveLength(1);
  });

  it('keeps overdue remainder and creates an explicit next-date proposal only for the completed part', async () => {
    const {service, setDate} = await setup('2026-11-07T12:00:00Z', {...plan, cycleDays: 2, declaredRanges: [{start: 0, end: 8}]});
    const task = service.state.tasks[0];
    expect(task.ranges).toEqual([{start: 0, end: 4}]);
    setDate('2026-11-10T12:00:00Z');
    await service.dispatch({type: 'complete-taahud', taskId: task.id, completedRanges: [{start: 0, end: 2}]});
    expect(service.state.tasks[0]).toMatchObject({remainingRanges: [{start: 2, end: 4}], dueDate: '2026-11-07', originalDueDate: '2026-11-07', status: 'pending'});
    expect(service.view().overdueTasks.some(t => t.id === task.id)).toBe(true);
    const proposal = service.state.proposals[0];
    expect(proposal).toMatchObject({ranges: [{start: 0, end: 2}], dueDate: '2026-11-12', status: 'pending'});
    expect(service.state.tasks).toHaveLength(2);
    await service.dispatch({type: 'accept-proposal', proposalId: proposal.id, dueDate: '2026-11-14'});
    expect(service.state.tasks.at(-1)).toMatchObject({ranges: [{start: 0, end: 2}], dueDate: '2026-11-14', scheduleSource: 'manual'});
    await service.dispatch({...plan, cycleDays: 3, declaredRanges: [{start: 0, end: 8}]});
    expect(service.state.tasks.at(-1)).toMatchObject({dueDate: '2026-11-14', scheduleSource: 'manual'});
    const after = service.state.revision;
    await expect(service.dispatch({type: 'complete-taahud', taskId: task.id, completedRanges: [{start: 0, end: 2}]})).rejects.toThrow('INVALID_INPUT');
    expect(service.state.revision).toBe(after);
  });

  it('saves completion correction, marks its frozen weekly snapshot disputed, and suspends dependent future manual tasks without changing their date', async () => {
    const {service, setDate, store} = await setup('2026-11-13T08:00:00Z', {...plan, cycleDays: 1});
    const hifz = await finishHifz(service);
    await service.dispatch({type: 'start-week-review'});
    await service.dispatch({type: 'complete-week-review', reviewId: service.state.reviews[0].id});
    const frozen = service.state.reviews[0].rangesSnapshot;
    setDate('2026-11-14T12:00:00Z');
    await service.dispatch({type: 'refresh-taahud'});
    const task = service.state.tasks[0];
    await service.dispatch({type: 'complete-taahud', taskId: task.id, completedRanges: task.remainingRanges});
    await service.dispatch({type: 'accept-proposal', proposalId: service.state.proposals[0].id, dueDate: '2026-11-20'});
    await service.dispatch({type: 'undo-repetition', sessionId: hifz.id});
    expect(service.state.sessions[0]).toMatchObject({state: 'disputed', count: 1});
    expect(service.state.completions[0].effective).toBe(false);
    expect(service.state.reviews[0]).toMatchObject({status: 'completed', disputed: true, rangesSnapshot: frozen});
    expect(service.state.tasks.at(-1)).toMatchObject({status: 'suspended', dueDate: '2026-11-20', originalDueDate: '2026-11-20', scheduleSource: 'manual', conflict: 'COVERAGE_CHANGED'});
    expect(await replayProductEvents((await store.load()).events)).toEqual(service.state);
  });

  it('preserves gaps and suspends excluded coverage without erasing completed history', async () => {
    const {service} = await setup('2026-11-07T12:00:00Z', {...plan, cycleDays: 1, declaredRanges: [{start: 0, end: 3}, {start: 5, end: 8}]});
    const task = service.state.tasks[0];
    expect(task.ranges).toEqual([{start: 0, end: 3}, {start: 5, end: 8}]);
    await service.dispatch({type: 'complete-taahud', taskId: task.id, completedRanges: [{start: 0, end: 1}]});
    await service.dispatch({...plan, cycleDays: 1, declaredRanges: [{start: 5, end: 8}]});
    expect(service.state.tasks[0]).toMatchObject({remainingRanges: [{start: 5, end: 8}], excludedRanges: [{start: 1, end: 3}], completedRanges: [{start: 0, end: 1}]});
    expect(service.state.taahudCompletions).toHaveLength(1);
    await expect(service.dispatch({type: 'accept-proposal', proposalId: service.state.proposals[0].id})).rejects.toThrow('SCHEDULE_CONFLICT');
  });

  it('previews and confirms automatic reassignment while preserving manual dates, partial completions and pending proposals', async () => {
    const {service, store} = await setup('2026-11-07T12:00:00Z', {...plan, cycleDays: 2, declaredRanges: [{start: 0, end: 16}]});
    const [manual, automatic] = service.state.tasks;
    await service.dispatch({type: 'reschedule-taahud', taskId: manual.id, dueDate: '2026-11-14'});
    await service.dispatch({type: 'complete-taahud', taskId: automatic.id, completedRanges: [{start: 8, end: 10}]});
    const originalManual = service.state.tasks[0], originalProposal = service.state.proposals[0];
    const command: Extract<ProductCommand, {type: 'configure-plan'}> = {...plan, declaredRanges: [{start: 0, end: 16}], cycleDays: 3, anchorDate: '2026-11-10', rebalance: true};
    const before = service.state;
    const preview = await service.previewPlan(command);
    expect(preview.preservedManual).toBe(1);
    expect(preview.changes.map(change => ({oldDate: change.oldDate, newDate: change.newDate, ranges: change.ranges}))).toEqual([
      {oldDate: '2026-11-08', newDate: '2026-11-10', ranges: [{start: 10, end: 12}]},
      {oldDate: '2026-11-08', newDate: '2026-11-11', ranges: [{start: 12, end: 14}]},
      {oldDate: '2026-11-08', newDate: '2026-11-12', ranges: [{start: 14, end: 16}]},
    ]);
    expect(service.state).toEqual(before);
    expect((await store.load()).events).toHaveLength(before.revision);
    await service.dispatch(command, {expectedRevision: preview.revision});
    expect(service.state.tasks[0]).toEqual(originalManual);
    expect(service.state.proposals[0]).toEqual(originalProposal);
    expect(service.state.tasks[1]).toMatchObject({id: automatic.id, status: 'superseded', originalDueDate: '2026-11-08', completedRanges: [{start: 8, end: 10}]});
    const active = service.state.tasks.filter(task => task.status === 'pending');
    expect(active).toHaveLength(4);
    expect(active.flatMap(task => task.remainingRanges).reduce((sum, r) => sum + r.end - r.start, 0)).toBe(14);
    await service.dispatch({type: 'refresh-taahud'});
    expect(service.state.tasks.filter(task => task.status === 'pending')).toEqual(active);
    const removal = await service.previewPlan({...command, declaredRanges: []});
    expect(removal.changes.every(change => change.newDate === null)).toBe(true);
    expect(removal.changes.flatMap(change => change.ranges).reduce((sum, r) => sum + r.end - r.start, 0)).toBe(14);
  });

  it('does not present success before durable commit, and recovers a lost acknowledgement without adding a second event', async () => {
    const backing = new MemoryProductStore<ProductState, ProductEvent>();
    let failBefore = false, loseAck = false;
    const wrapped: ProductStore<ProductState, ProductEvent> = {
      load: () => backing.load(), close: () => {},
      commit: async (input: ProductCommit<ProductState, ProductEvent>) => {
        if (failBefore) throw new Error('STORAGE_FULL');
        const receipt = await backing.commit(input);
        if (loseAck) { loseAck = false; throw new Error('ACK_LOST'); }
        return receipt;
      },
    };
    const service = await ProductV211.open(wrapped);
    failBefore = true;
    await expect(service.dispatch(plan, {commandId: 'configuration'})).rejects.toThrow('STORAGE_FULL');
    expect(service.state.plan).toBeNull();
    failBefore = false; loseAck = true;
    await expect(service.dispatch(plan, {commandId: 'configuration'})).rejects.toThrow('ACK_LOST');
    expect(service.state.plan).toBeNull();
    await service.dispatch(plan, {commandId: 'configuration'});
    expect(service.state.revision).toBe(1);
    expect((await backing.load()).events).toHaveLength(1);
  });

  it('returns the persisted event IDs for simultaneous same-ID retry, and requires refresh after a real cross-tab conflict', async () => {
    const {service, store, clock} = await setup();
    const other = await ProductV211.open(store, {clock});
    const [first, second] = await Promise.all([
      service.dispatch({type: 'start-hifz'}, {commandId: 'same-session'}),
      other.dispatch({type: 'start-hifz'}, {commandId: 'same-session'}),
    ]);
    expect(first.sessions[0].id).toBe(second.sessions[0].id);
    expect(first).toEqual((await store.load()).state);
    const id = first.sessions[0].id;
    await service.dispatch({type: 'add-repetition', sessionId: id});
    await expect(other.dispatch({type: 'add-repetition', sessionId: id})).rejects.toThrow('REVISION_CONFLICT');
    await other.refresh();
    await other.dispatch({type: 'add-repetition', sessionId: id});
    expect(other.state.sessions[0].count).toBe(2);
  });

  it('rejects invalid plan values, impossible ranges and unknown replay versions without writing', async () => {
    const {service, store} = await setup();
    const revision = service.state.revision;
    for (const command of [{...plan, cycleDays: 0}, {...plan, hifzTarget: 0}, {...plan, hifzTarget: 10001}, {...plan, zoneId: 'no/such-zone'}, {...plan, anchorDate: '2026-02-30'}]) {
      await expect(service.dispatch(command)).rejects.toThrow('INVALID_INPUT');
    }
    await expect(service.dispatch({type: 'start-hifz', range: {start: 20, end: 25}})).rejects.toThrow('REFERENCE_MISMATCH');
    expect(service.state.revision).toBe(revision);
    const snapshot = await store.load();
    expect(snapshot.events[0].namespace).toBe(PRODUCT_NAMESPACE);
    const altered = structuredClone(snapshot.events);
    (altered[0] as unknown as {namespace: string}).namespace = 'future';
    await expect(replayProductEvents(altered)).rejects.toThrow('UNSUPPORTED_VERSION');
    const tampered = structuredClone(snapshot.events); tampered[0].command = {...plan, hifzTarget: 3};
    await expect(replayProductEvents(tampered)).rejects.toThrow('STORAGE_INTEGRITY_ERROR');
  });
});
