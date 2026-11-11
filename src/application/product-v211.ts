import {canonical} from '../core/types';
import {contentHash} from '../content/content-gate';
import {addCivilDays, distributeTaahud, partialCompletion, subtractRanges, unionRanges, type Interval} from '../domain/taahud-v211';
import {createWeekReviewSnapshot} from '../domain/week-review-v211';
import type {ProductStore, ProductSnapshot} from '../persistence/product-v211-store';

/** Separate versioned product journal: no FSRS records, ratings, or Quran content. */
export const PRODUCT_NAMESPACE = 'mulazama.product.v2.1.1' as const;
export const SYNTHETIC_BUNDLE = 'synthetic-v211-reference-1' as const;
export const SYNTHETIC_CATALOG = Object.freeze(Array.from({length: 3}, (_, i) => Object.freeze({
  id: `synthetic-face-${i + 1}`, title: `مقدار تجريبي ${i + 1}`,
  range: Object.freeze({start: i * 8, end: (i + 1) * 8}),
})));
const TOTAL = 24;
const copy = <T>(v: T): T => structuredClone(v);
const fail = (code: string): never => { throw new Error(code); };
const count = (ranges: readonly Interval[]) => ranges.reduce((sum, range) => sum + range.end - range.start, 0);
const intersection = (a: readonly Interval[], b: readonly Interval[]) => subtractRanges(a, subtractRanges(a, b));
const includes = (a: readonly Interval[], b: readonly Interval[]) => subtractRanges(b, a).length === 0;
const validTarget = (n: number) => Number.isSafeInteger(n) && n >= 1 && n <= 10000;
function ranges(input: readonly Interval[]): Interval[] {
  if (!Array.isArray(input)) return fail('INVALID_INPUT');
  const result = unionRanges(input);
  if (result.some(range => range.end > TOTAL)) return fail('REFERENCE_MISMATCH');
  return result;
}
export function localDateAt(instant: string, zoneId: string): string {
  const at = new Date(instant);
  if (!Number.isFinite(at.getTime())) return fail('INVALID_INPUT');
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {timeZone: zoneId, year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(at);
    const part = (name: string) => parts.find(p => p.type === name)!.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  } catch { return fail('INVALID_INPUT'); }
}
export function weekStartFor(date: string): string {
  addCivilDays(date, 0);
  return addCivilDays(date, -(new Date(date + 'T12:00:00Z').getUTCDay() + 1) % 7);
}
function nextSaturday(date: string) {
  return addCivilDays(date, (6 - new Date(date + 'T12:00:00Z').getUTCDay() + 7) % 7 || 7);
}

export interface ProductPlan {
  version: number; hifzTarget: number; linkTarget: number; cycleDays: number;
  anchorDate: string; zoneId: string; startOrdinal: number;
}
export interface ProductSession {
  id: string; kind: 'hifz' | 'link'; rangeSnapshot: Interval[]; targetSnapshot: number;
  count: number; state: 'active' | 'paused' | 'completed' | 'disputed'; planVersion: number;
  activeRepetitionIds: string[]; startedAt: string; zoneId: string;
  previousRange?: Interval; newRange?: Interval; hifzSessionId?: string; completedAt?: string;
  dependencyStateBeforeDispute?: 'active' | 'paused' | 'completed';
}
export interface HifzCompletion {
  id: string; eventId: string; sessionId: string; completedAt: string;
  eligibleFrom: string; ranges: Interval[]; effective: boolean;
}
export interface ProductReview {
  id: string; kind: 'daily' | 'friday'; weekStart: string; localDate: string;
  rangesSnapshot: Interval[]; sourceWatermark: string; rangeHash: string; sourceCompletionIds: string[];
  revision: number; sourceVersion: typeof PRODUCT_NAMESPACE; startedAt: string; zoneId: string;
  status: 'active' | 'completed'; completedAt?: string; disputed?: boolean;
}
export interface TaahudTask {
  id: string; ranges: Interval[]; remainingRanges: Interval[]; completedRanges: Interval[];
  excludedRanges: Interval[]; originalDueDate: string; dueDate: string;
  status: 'pending' | 'completed' | 'suspended' | 'superseded'; scheduleSource: 'auto' | 'manual';
  cycleDays: number; cycleVersion: number; revision: number; parentId?: string;
  conflict?: 'COVERAGE_CHANGED';
  supersededBy?: string;
}
export interface NextProposal {
  id: string; taskId: string; ranges: Interval[]; dueDate: string; cycleDays: number;
  status: 'pending' | 'accepted'; acceptedDueDate?: string; eventId: string;
}
export interface TaahudCompletion {
  id: string; taskId: string; ranges: Interval[]; actualDate: string; eventId: string;
}
export interface ProductState {
  namespace: typeof PRODUCT_NAMESPACE; bundleId: typeof SYNTHETIC_BUNDLE; revision: number;
  plan: ProductPlan | null; declaredRanges: Interval[];
  sessions: ProductSession[]; completions: HifzCompletion[]; reviews: ProductReview[];
  tasks: TaahudTask[]; proposals: NextProposal[]; taahudCompletions: TaahudCompletion[];
  transferredCompletionIds: string[];
  schedules: {id: string; policyVersion: 'TAAHUD-POLICY-1.0'; inputHash: string; assignmentsHash: string; coverageRevision: number}[];
}
export type ProductCommand =
  | ({type: 'configure-plan'; declaredRanges: Interval[]; rebalance?: boolean} & Omit<ProductPlan, 'version'>)
  | {type: 'start-hifz'; range?: Interval}
  | {type: 'add-repetition'; sessionId: string}
  | {type: 'undo-repetition'; sessionId: string; repetitionId?: string}
  | {type: 'pause-session' | 'resume-session'; sessionId: string}
  | {type: 'start-link'; hifzSessionId: string; target?: number}
  | {type: 'start-week-review'}
  | {type: 'complete-week-review'; reviewId: string}
  | {type: 'refresh-taahud'}
  | {type: 'complete-taahud'; taskId: string; completedRanges: Interval[]}
  | {type: 'accept-proposal'; proposalId: string; dueDate?: string}
  | {type: 'reschedule-taahud'; taskId: string; dueDate: string};
export interface ProductEvent {
  id: string; revision: number; namespace: typeof PRODUCT_NAMESPACE; bundleId: typeof SYNTHETIC_BUNDLE;
  commandId: string; command: ProductCommand; occurredAt: string; localDate: string; zoneAtCapture: string;
  policyVersion: 'PRODUCT-POLICY-2.1.1'; payloadHash: string;
  reversedEventId?: string;
}
export function emptyProductState(): ProductState {
  return {namespace: PRODUCT_NAMESPACE, bundleId: SYNTHETIC_BUNDLE, revision: 0, plan: null, declaredRanges: [],
    sessions: [], completions: [], reviews: [], tasks: [], proposals: [], taahudCompletions: [], transferredCompletionIds: [], schedules: []};
}
export function productCoverage(state: ProductState): Interval[] {
  return unionRanges([...state.declaredRanges, ...state.completions.filter(c => c.effective).flatMap(c => c.ranges)]);
}
function eligibleCoverage(state: ProductState, date: string): Interval[] {
  return unionRanges([...state.declaredRanges, ...state.completions.filter(c => c.effective && c.eligibleFrom <= date).flatMap(c => c.ranges)]);
}
function nextRangeFor(state: ProductState): Interval | null {
  if (!state.plan) return null;
  const remaining = subtractRanges([{start: state.plan.startOrdinal, end: TOTAL}], productCoverage(state));
  if (!remaining.length) return null;
  const first = remaining[0], face = SYNTHETIC_CATALOG.find(entry => entry.range.start <= first.start && entry.range.end > first.start)!;
  return {start: first.start, end: Math.min(first.end, face.range.end)};
}
function currentCompletions(state: ProductState, date: string, at: string, zone: string) {
  const start = weekStartFor(date);
  return state.completions.filter(c => c.effective && Date.parse(c.completedAt) <= Date.parse(at) &&
    localDateAt(c.completedAt, zone) >= start && localDateAt(c.completedAt, zone) <= date);
}
function refreshCoverageDependents(state: ProductState, date: string) {
  const covered = productCoverage(state), eligible = eligibleCoverage(state, date);
  for (const session of state.sessions) {
    if (session.kind !== 'link') continue;
    if (!includes(covered, session.rangeSnapshot)) {
      if (session.state !== 'disputed') session.dependencyStateBeforeDispute = session.state;
      session.state = 'disputed';
    } else if (session.dependencyStateBeforeDispute) {
      session.state = session.count === session.targetSnapshot ? 'completed' : 'paused';
      delete session.dependencyStateBeforeDispute;
    }
  }
  for (const review of state.reviews) {
    if (review.sourceCompletionIds.some(id => !state.completions.some(c => c.id === id && c.effective))) review.disputed = true;
    else delete review.disputed;
  }
  for (const task of state.tasks) {
    if (task.status === 'superseded') continue;
    const remaining = subtractRanges(task.ranges, task.completedRanges);
    task.remainingRanges = intersection(remaining, eligible);
    task.excludedRanges = subtractRanges(remaining, eligible);
    task.status = !remaining.length ? 'completed' : task.remainingRanges.length ? 'pending' : 'suspended';
    if (task.excludedRanges.length) task.conflict = 'COVERAGE_CHANGED'; else delete task.conflict;
  }
}
async function refreshTaahud(state: ProductState, event: ProductEvent) {
  const plan = state.plan!;
  refreshCoverageDependents(state, event.localDate);
  for (const completion of state.completions) {
    if (completion.effective && completion.eligibleFrom <= event.localDate && !state.transferredCompletionIds.includes(completion.id)) {
      state.transferredCompletionIds.push(completion.id);
    }
  }
  // Previously scheduled ranges retain their lineage, original dates, and manual choices.
  const reserved = unionRanges([
    ...state.tasks.filter(t => t.status !== 'superseded' && t.status !== 'completed').flatMap(t => subtractRanges(t.ranges, t.completedRanges)),
    ...state.proposals.filter(p => p.status === 'pending').flatMap(p => p.ranges),
  ]);
  const unassigned = subtractRanges(eligibleCoverage(state, event.localDate), reserved);
  if (!unassigned.length) return;
  const newSources = state.completions.filter(c => c.effective && c.eligibleFrom <= event.localDate && intersection(c.ranges, unassigned).length);
  const eligibleDate = newSources.map(c => c.eligibleFrom).sort()[0];
  // Opening after Saturday preserves the Saturday eligibility date, not the earlier plan start.
  const baseDate = event.command.type === 'configure-plan' && event.command.rebalance ? plan.anchorDate :
    !intersection(state.declaredRanges, unassigned).length && eligibleDate ? eligibleDate :
    state.schedules.length ? event.localDate : plan.anchorDate;
  const anchorDate = plan.anchorDate > baseDate ? plan.anchorDate : baseDate;
  const input = {ranges: unassigned, cycleDays: plan.cycleDays, anchorDate};
  const distributed = distributeTaahud(input);
  state.schedules.push({id: event.id, policyVersion: distributed.policyVersion,
    inputHash: await contentHash(canonical({...input, bundleId: SYNTHETIC_BUNDLE, coverageRevision: event.revision})),
    assignmentsHash: await contentHash(canonical(distributed.assignments)), coverageRevision: event.revision});
  distributed.assignments.forEach((assignment, index) => {
    if (!assignment.count) return;
    state.tasks.push({id: `${event.id}:task:${index}`, ranges: assignment.ranges, remainingRanges: copy(assignment.ranges), completedRanges: [],
      excludedRanges: [], originalDueDate: assignment.date, dueDate: assignment.date, status: 'pending', scheduleSource: 'auto',
      cycleDays: plan.cycleDays, cycleVersion: plan.version, revision: 1});
  });
}
async function applyProductEvent(before: ProductState, event: ProductEvent): Promise<ProductState> {
  if (event.namespace !== PRODUCT_NAMESPACE || event.bundleId !== SYNTHETIC_BUNDLE || event.policyVersion !== 'PRODUCT-POLICY-2.1.1') return fail('UNSUPPORTED_VERSION');
  if (event.revision !== before.revision + 1 || !event.id || !event.commandId) return fail('STORAGE_INTEGRITY_ERROR');
  const state = copy(before), cmd = event.command;
  if (cmd.type !== 'configure-plan' && !state.plan) return fail('PLAN_REQUIRED');
  const sessionById = (id: string) => state.sessions.find(s => s.id === id) ?? fail('SESSION_NOT_FOUND');
  switch (cmd.type) {
    case 'configure-plan': {
      if (!validTarget(cmd.hifzTarget) || !validTarget(cmd.linkTarget) || !Number.isSafeInteger(cmd.cycleDays) || cmd.cycleDays < 1 || cmd.cycleDays > 366 ||
        !Number.isSafeInteger(cmd.startOrdinal) || cmd.startOrdinal < 0 || cmd.startOrdinal >= TOTAL) return fail('INVALID_INPUT');
      addCivilDays(cmd.anchorDate, 0); localDateAt(event.occurredAt, cmd.zoneId);
      state.declaredRanges = ranges(cmd.declaredRanges);
      state.plan = {version: (state.plan?.version ?? 0) + 1, hifzTarget: cmd.hifzTarget, linkTarget: cmd.linkTarget,
        cycleDays: cmd.cycleDays, anchorDate: cmd.anchorDate, zoneId: cmd.zoneId, startOrdinal: cmd.startOrdinal};
      if (cmd.rebalance) {
        // Explicitly confirmed plan diff replaces only unfinished automatic assignments.
        // Their original dates/completions remain in history; manual assignments stay fixed.
        for (const task of state.tasks) {
          if (task.scheduleSource !== 'auto' || !['pending', 'suspended'].includes(task.status)) continue;
          task.status = 'superseded'; task.supersededBy = event.id; task.remainingRanges = []; task.revision++;
        }
      }
      await refreshTaahud(state, event);
      break;
    }
    case 'start-hifz': {
      const active = state.sessions.find(s => s.kind === 'hifz' && s.state !== 'completed');
      if (active) break; // Resume the existing lineage; never duplicate it on a retry/new tab.
      const selected = cmd.range ?? nextRangeFor(state) ?? fail('NO_NEW_RANGE');
      const selectedRanges = ranges([selected]);
      if (intersection(selectedRanges, productCoverage(state)).length) return fail('RANGE_ALREADY_MEMORIZED');
      if (!SYNTHETIC_CATALOG.some(face => includes([face.range], selectedRanges))) return fail('REFERENCE_MISMATCH');
      state.sessions.push({id: `${event.id}:hifz`, kind: 'hifz', rangeSnapshot: selectedRanges,
        targetSnapshot: state.plan!.hifzTarget, count: 0, state: 'active', planVersion: state.plan!.version,
        activeRepetitionIds: [], startedAt: event.occurredAt, zoneId: event.zoneAtCapture});
      break;
    }
    case 'add-repetition': {
      const session = sessionById(cmd.sessionId);
      if (!['active', 'disputed'].includes(session.state)) return fail('SESSION_NOT_ACTIVE');
      if (session.count >= session.targetSnapshot) return fail('SESSION_COMPLETED');
      if (session.kind === 'link' && !includes(productCoverage(state), session.rangeSnapshot)) return fail('ADJACENCY_REQUIRED');
      session.activeRepetitionIds.push(event.id); session.count = session.activeRepetitionIds.length;
      if (session.count === session.targetSnapshot) {
        session.state = 'completed'; session.completedAt = event.occurredAt;
        if (session.kind === 'hifz') state.completions.push({id: `${event.id}:completion`, eventId: event.id, sessionId: session.id,
          completedAt: event.occurredAt, eligibleFrom: nextSaturday(localDateAt(event.occurredAt, session.zoneId)), ranges: copy(session.rangeSnapshot), effective: true});
      } else session.state = 'active';
      refreshCoverageDependents(state, event.localDate);
      break;
    }
    case 'undo-repetition': {
      const session = sessionById(cmd.sessionId);
      const repetition = event.reversedEventId;
      if (cmd.repetitionId && cmd.repetitionId !== repetition) return fail('STORAGE_INTEGRITY_ERROR');
      if (!repetition || session.activeRepetitionIds.at(-1) !== repetition) return fail('REPETITION_NOT_REVERSIBLE');
      const wasCompleted = session.state === 'completed';
      session.activeRepetitionIds.pop(); session.count = session.activeRepetitionIds.length;
      if (wasCompleted) {
        session.state = 'disputed'; delete session.completedAt;
        for (const completion of state.completions) if (completion.sessionId === session.id && completion.effective) completion.effective = false;
        if (session.kind === 'hifz') for (const other of state.sessions) {
          if (other.id !== session.id && other.kind === 'hifz' && other.state === 'active') other.state = 'paused';
        }
      }
      refreshCoverageDependents(state, event.localDate);
      break;
    }
    case 'pause-session': {
      const session = sessionById(cmd.sessionId);
      if (session.state === 'completed') return fail('SESSION_COMPLETED');
      session.state = 'paused'; break;
    }
    case 'resume-session': {
      const session = sessionById(cmd.sessionId);
      if (session.state === 'completed') return fail('SESSION_COMPLETED');
      if (session.kind === 'link' && !includes(productCoverage(state), session.rangeSnapshot)) return fail('ADJACENCY_REQUIRED');
      session.state = 'active'; break;
    }
    case 'start-link': {
      const hifz = sessionById(cmd.hifzSessionId);
      if (hifz.kind !== 'hifz' || hifz.state !== 'completed' || hifz.rangeSnapshot.length !== 1) return fail('HIFZ_COMPLETION_REQUIRED');
      if (state.sessions.some(s => s.kind === 'link' && s.hifzSessionId === hifz.id)) break;
      if (state.sessions.some(s => s.kind === 'link' && s.state !== 'completed')) return fail('LINK_ALREADY_ACTIVE');
      const newRange = hifz.rangeSnapshot[0], index = SYNTHETIC_CATALOG.findIndex(face => canonical(face.range) === canonical(newRange));
      const previousRange = SYNTHETIC_CATALOG[index - 1]?.range;
      if (!previousRange || previousRange.end !== newRange.start || !includes(productCoverage(state), [previousRange, newRange])) return fail('ADJACENCY_REQUIRED');
      const target = cmd.target ?? state.plan!.linkTarget;
      if (!validTarget(target)) return fail('INVALID_INPUT');
      state.sessions.push({id: `${event.id}:link`, kind: 'link', rangeSnapshot: unionRanges([previousRange, newRange]),
        previousRange: copy(previousRange), newRange: copy(newRange), hifzSessionId: hifz.id, targetSnapshot: target,
        count: 0, state: 'active', planVersion: state.plan!.version, activeRepetitionIds: [], startedAt: event.occurredAt, zoneId: event.zoneAtCapture});
      break;
    }
    case 'start-week-review': {
      const isFriday = new Date(event.localDate + 'T12:00:00Z').getUTCDay() === 5;
      const kind = isFriday ? 'friday' : 'daily', weekStart = weekStartFor(event.localDate);
      if (state.reviews.some(review => review.localDate === event.localDate)) break;
      const completions = currentCompletions(state, event.localDate, event.occurredAt, event.zoneAtCapture);
      const sourceWatermark = `${PRODUCT_NAMESPACE}:${before.revision}`;
      const snapshot = isFriday ? createWeekReviewSnapshot({startedAt: event.occurredAt, zoneId: event.zoneAtCapture,
        sourceWatermark, completions}) : {ranges: unionRanges(completions.flatMap(c => c.ranges)), sourceCompletionIds: completions.map(c => c.id).sort()};
      if (!snapshot.ranges.length) return fail('NO_WEEKLY_RANGES');
      state.reviews.push({id: `${event.id}:week`, kind, weekStart, localDate: event.localDate, rangesSnapshot: snapshot.ranges,
        sourceWatermark, rangeHash: await contentHash(canonical({bundleId: SYNTHETIC_BUNDLE, ranges: snapshot.ranges})),
        sourceCompletionIds: snapshot.sourceCompletionIds, revision: 1, sourceVersion: PRODUCT_NAMESPACE,
        startedAt: event.occurredAt, zoneId: event.zoneAtCapture, status: 'active'});
      break;
    }
    case 'complete-week-review': {
      const review = state.reviews.find(r => r.id === cmd.reviewId) ?? fail('REVIEW_NOT_FOUND');
      if (review.status === 'completed') break;
      review.status = 'completed'; review.completedAt = event.occurredAt; review.revision++;
      break;
    }
    case 'refresh-taahud': await refreshTaahud(state, event); break;
    case 'complete-taahud': {
      refreshCoverageDependents(state, event.localDate);
      const task = state.tasks.find(t => t.id === cmd.taskId) ?? fail('TASK_NOT_FOUND');
      if (task.status !== 'pending') return fail('TASK_NOT_ACTIVE');
      const completedRanges = ranges(cmd.completedRanges);
      if (!completedRanges.length || !includes(task.remainingRanges, completedRanges)) return fail('INVALID_INPUT');
      const partial = partialCompletion({dueDate: task.dueDate, actualLocalDate: event.localDate,
        cycleDays: state.plan!.cycleDays, scheduled: task.remainingRanges, completed: completedRanges});
      task.completedRanges = unionRanges([...task.completedRanges, ...completedRanges]);
      task.remainingRanges = partial.remaining.ranges; task.revision++;
      task.status = task.remainingRanges.length ? 'pending' : task.excludedRanges.length ? 'suspended' : 'completed';
      const proposal = partial.proposedNext!;
      state.proposals.push({id: `${event.id}:proposal`, taskId: task.id, ranges: proposal.ranges, dueDate: proposal.dueDate,
        cycleDays: state.plan!.cycleDays, status: 'pending', eventId: event.id});
      state.taahudCompletions.push({id: `${event.id}:taahud`, taskId: task.id, ranges: completedRanges, actualDate: event.localDate, eventId: event.id});
      break;
    }
    case 'accept-proposal': {
      refreshCoverageDependents(state, event.localDate);
      const proposal = state.proposals.find(p => p.id === cmd.proposalId) ?? fail('PROPOSAL_NOT_FOUND');
      if (proposal.status === 'accepted') break;
      if (!includes(eligibleCoverage(state, event.localDate), proposal.ranges)) return fail('SCHEDULE_CONFLICT');
      const dueDate = cmd.dueDate ?? proposal.dueDate; addCivilDays(dueDate, 0);
      if (dueDate < event.localDate) return fail('INVALID_INPUT');
      const overlapping = state.tasks.some(t => t.status === 'pending' && intersection(t.remainingRanges, proposal.ranges).length);
      if (overlapping) return fail('SCHEDULE_CONFLICT');
      proposal.status = 'accepted'; proposal.acceptedDueDate = dueDate;
      state.tasks.push({id: `${event.id}:task`, ranges: copy(proposal.ranges), remainingRanges: copy(proposal.ranges), completedRanges: [],
        excludedRanges: [], originalDueDate: dueDate, dueDate, status: 'pending', scheduleSource: cmd.dueDate ? 'manual' : 'auto',
        cycleDays: proposal.cycleDays, cycleVersion: state.plan!.version, revision: 1, parentId: proposal.taskId});
      break;
    }
    case 'reschedule-taahud': {
      const task = state.tasks.find(t => t.id === cmd.taskId) ?? fail('TASK_NOT_FOUND');
      addCivilDays(cmd.dueDate, 0);
      if (cmd.dueDate < event.localDate || task.status !== 'pending') return fail('INVALID_INPUT');
      task.dueDate = cmd.dueDate; task.scheduleSource = 'manual'; task.revision++;
      break;
    }
    default: return fail('UNSUPPORTED_VERSION');
  }
  state.revision = event.revision;
  return state;
}

export async function replayProductEvents(events: readonly ProductEvent[]): Promise<ProductState> {
  let state = emptyProductState();
  const commandIds = new Set<string>(), eventIds = new Set<string>();
  for (const event of events) {
    if (commandIds.has(event.commandId) || eventIds.has(event.id) ||
      event.localDate !== localDateAt(event.occurredAt, event.zoneAtCapture) ||
      event.payloadHash !== await contentHash(canonical(event.command))) return fail('STORAGE_INTEGRITY_ERROR');
    commandIds.add(event.commandId); eventIds.add(event.id);
    state = await applyProductEvent(state, event);
  }
  return state;
}

export class ProductV211 {
  private sequence: Promise<unknown> = Promise.resolve();
  private constructor(private readonly store: ProductStore<ProductState, ProductEvent>, private current: ProductState, private readonly clock: () => Date) {}
  static async open(store: ProductStore<ProductState, ProductEvent>, options: {clock?: () => Date} = {}): Promise<ProductV211> {
    const snapshot = await store.load();
    const replayed = await ProductV211.validate(snapshot);
    const service = new ProductV211(store, replayed, options.clock ?? (() => new Date()));
    await service.catchUpTaahud();
    return service;
  }
  private static async validate(snapshot: ProductSnapshot<ProductState, ProductEvent>) {
    const replayed = await replayProductEvents(snapshot.events);
    if (snapshot.state && canonical(replayed) !== canonical(snapshot.state)) return fail('STORAGE_INTEGRITY_ERROR');
    return replayed;
  }
  get state(): ProductState { return copy(this.current); }
  today(): string { return localDateAt(this.clock().toISOString(), this.current.plan?.zoneId ?? 'Asia/Riyadh'); }
  private async catchUpTaahud(retryConflict = true): Promise<ProductState> {
    const date = this.today();
    const pending = this.current.completions.filter(c => c.effective && c.eligibleFrom <= date && !this.current.transferredCompletionIds.includes(c.id));
    if (this.current.plan && pending.length) {
      const commandId = 'eligibility:' + await contentHash(canonical({date, sourceCompletionIds: pending.map(c => c.id).sort()}));
      try { return await this.dispatch({type: 'refresh-taahud'}, {commandId}); }
      catch (error) {
        // A competing tab may finish another legitimate action during startup.
        // Only this mechanical catch-up is retried; user commands still surface conflicts.
        if (!(error instanceof Error) || error.message !== 'REVISION_CONFLICT' || !retryConflict) throw error;
        const fresh = await ProductV211.validate(await this.store.load());
        if (fresh.revision >= this.current.revision) this.current = fresh;
        return this.catchUpTaahud(false);
      }
    }
    return this.state;
  }
  view() {
    const state = this.current, date = this.today(), at = this.clock().toISOString();
    const zone = state.plan?.zoneId ?? 'Asia/Riyadh';
    const week = currentCompletions(state, date, at, zone);
    const review = state.reviews.find(r => r.localDate === date);
    return copy({date, coverage: productCoverage(state), eligibleCoverage: eligibleCoverage(state, date), nextRange: nextRangeFor(state),
      activeHifz: state.sessions.find(s => s.kind === 'hifz' && s.state !== 'completed') ?? null,
      activeLink: state.sessions.find(s => s.kind === 'link' && s.state !== 'completed') ?? null,
      dueTasks: state.tasks.filter(t => t.status === 'pending' && t.dueDate === date),
      overdueTasks: state.tasks.filter(t => t.status === 'pending' && t.dueDate < date),
      pendingProposals: state.proposals.filter(p => p.status === 'pending'),
      weeklyRanges: unionRanges(week.flatMap(c => c.ranges)),
      weeklyLateRanges: review ? unionRanges(week.filter(c => !review.sourceCompletionIds.includes(c.id)).flatMap(c => c.ranges)) : [],
      counts: {hifz: state.completions.filter(c => c.effective).length,
        link: state.sessions.filter(s => s.kind === 'link' && s.state === 'completed').length,
        week: state.reviews.filter(r => r.status === 'completed' && !r.disputed).length,
        taahud: state.taahudCompletions.length, coveredUnits: count(productCoverage(state)), totalUnits: TOTAL}});
  }
  async previewPlan(command: Extract<ProductCommand, {type: 'configure-plan'}>): Promise<{
    changes: {taskId: string; oldDate: string | null; newDate: string | null; ranges: Interval[]}[];
    preservedManual: number; revision: number;
  }> {
    const before = this.state, occurredAt = this.clock().toISOString();
    const event: ProductEvent = {id: 'plan-preview', revision: before.revision + 1, namespace: PRODUCT_NAMESPACE,
      bundleId: SYNTHETIC_BUNDLE, commandId: 'plan-preview', command: copy(command), occurredAt,
      localDate: localDateAt(occurredAt, command.zoneId), zoneAtCapture: command.zoneId,
      policyVersion: 'PRODUCT-POLICY-2.1.1', payloadHash: await contentHash(canonical(command))};
    const after = await applyProductEvent(before, event);
    const generated = after.tasks.filter(task => task.id.startsWith(event.id + ':'));
    const changes: {taskId: string; oldDate: string | null; newDate: string | null; ranges: Interval[]}[] = generated.flatMap(task => {
      const prior = before.tasks.filter(old => old.status !== 'completed' && old.status !== 'superseded' &&
        old.scheduleSource === 'auto' && intersection(old.remainingRanges, task.ranges).length);
      const matched = prior.map(old => ({taskId: old.id, oldDate: old.dueDate as string | null, newDate: task.dueDate,
        ranges: intersection(old.remainingRanges, task.ranges)}));
      const added = subtractRanges(task.ranges, prior.flatMap(old => old.remainingRanges));
      return [...matched, ...(added.length ? [{taskId: task.id, oldDate: null, newDate: task.dueDate, ranges: added}] : [])];
    });
    const retained = after.tasks.filter(task => task.status === 'pending').flatMap(task => task.remainingRanges);
    for (const old of before.tasks.filter(task => task.status === 'pending')) {
      const removed = subtractRanges(old.remainingRanges, retained);
      if (removed.length) changes.push({taskId: old.id, oldDate: old.dueDate, newDate: null, ranges: removed});
    }
    return {changes, preservedManual: before.tasks.filter(t => t.scheduleSource === 'manual' && ['pending', 'suspended'].includes(t.status)).length, revision: before.revision};
  }
  async refresh(): Promise<ProductState> {
    const action = async () => {
      this.current = await ProductV211.validate(await this.store.load());
      return this.state;
    };
    const result = this.sequence.then(action, action);
    this.sequence = result.catch(() => undefined);
    return result.then(() => this.catchUpTaahud());
  }
  dispatch(command: ProductCommand, options: {commandId?: string; expectedRevision?: number} = {}): Promise<ProductState> {
    const capturedCommand = copy(command), commandId = options.commandId ?? crypto.randomUUID();
    const action = async () => {
      if (!commandId || commandId.length > 2048) return fail('INVALID_INPUT');
      const snapshot = await this.store.load();
      const payloadHash = await contentHash(canonical(capturedCommand));
      const previous = Object.hasOwn(snapshot.receipts, commandId) ? snapshot.receipts[commandId] : undefined;
      if (previous) {
        const existing = snapshot.events.find(event => event.id === previous.eventIds[0]);
        if (!existing || existing.payloadHash !== payloadHash) return fail('IDEMPOTENCY_CONFLICT');
        this.current = await ProductV211.validate(snapshot);
        return this.state;
      }
      const expectedRevision = options.expectedRevision ?? this.current.revision;
      if (expectedRevision !== (snapshot.state?.revision ?? 0)) return fail('REVISION_CONFLICT');
      const before = await ProductV211.validate(snapshot);
      const occurredAt = this.clock().toISOString(), zoneAtCapture = capturedCommand.type === 'configure-plan' ? capturedCommand.zoneId : before.plan?.zoneId ?? 'Asia/Riyadh';
      const event: ProductEvent = {id: crypto.randomUUID(), revision: before.revision + 1, namespace: PRODUCT_NAMESPACE, bundleId: SYNTHETIC_BUNDLE,
        commandId, command: capturedCommand, occurredAt, localDate: localDateAt(occurredAt, zoneAtCapture), zoneAtCapture,
        policyVersion: 'PRODUCT-POLICY-2.1.1', payloadHash};
      if (capturedCommand.type === 'undo-repetition') {
        event.reversedEventId = capturedCommand.repetitionId ?? before.sessions.find(s => s.id === capturedCommand.sessionId)?.activeRepetitionIds.at(-1);
      }
      const state = await applyProductEvent(before, event);
      const receipt = await this.store.commit({expectedRevision, state, event, payloadHash,
        receipt: {commandId, eventIds: [event.id], revision: event.revision, durability: 'local'}});
      // A simultaneous same-ID retry may be acknowledged by the other tab's event.
      this.current = receipt.eventIds[0] === event.id ? state : await ProductV211.validate(await this.store.load());
      return this.state;
    };
    const result = this.sequence.then(action, action);
    this.sequence = result.catch(() => undefined);
    return result;
  }
  async exportData() {
    const snapshot = await this.store.load();
    await ProductV211.validate(snapshot);
    return {namespace: PRODUCT_NAMESPACE, synthetic: true as const, productionReady: false as const, ...snapshot};
  }
  close(): void { this.store.close(); }
}
