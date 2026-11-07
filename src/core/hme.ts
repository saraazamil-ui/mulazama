import type { HmePolicy, RecallInput, RecallAssessment, UnitState, Phase, SuccessfulEvidence, DueDates, PlanCandidate, PlannedTask, DayPlan } from './hme-types';
export * from './hme-types';
export const HME_VERSION = 'hme-0.1-engineering-05a.1';
/** Every HME numerical threshold here is a versioned P0 hypothesis, not a validated learning constant. */
export const P0: Readonly<HmePolicy> = Object.freeze({
  version: 'P0-0.1.0', rubricVersion: 'manual-recall-0.1.0', experimental: true,
  minimumGuidedRepetitions: 2, initialCleanSuccesses: 2, maxSessionMinutes: 20,
  maxFailedAttempts: 8, restMinutes: 5, minimumDelayedMinutes: 20,
  earlyIndependentDays: 2, earlyGapHours: 24, earlyEvidenceSpanDays: 3,
  maintenanceIndependentDays: 3, maintenanceEvidenceSpanDays: 14, maintenanceGapDays: 7,
  earlyCapsDays: Object.freeze([1,3,7]), selfReportCapDays: 7,
  maintenanceCapsDays: Object.freeze([7,14,30]), reserveFraction: 0.15,
  stableRecoveryDays: 3, forecastDays: 7, recoverySampleTargets: Object.freeze([3,12,24]),
  repeatedMistakeEpisodes: 3, linkObservationWindow: 8, broadFailureFraction: 0.2, broadFailuresForRelearning: 2,
});
const DAY = 86400000;
const number = (v: number, min = 0) => Number.isFinite(v) && v >= min;
export function instant(value: string): number {
  if(typeof value!=='string')throw new Error('INVALID_INPUT: RFC3339 instant required');
  const match=/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d+)?(?:Z|([+-])(\d\d):(\d\d))$/.exec(value);
  if(!match)throw new Error('INVALID_INPUT: RFC3339 instant required');
  const [year,month,day,hour,minute,second]=match.slice(1,7).map(Number);
  const daysInMonth=new Date(Date.UTC(year,month,0)).getUTCDate();
  if(year<100||month<1||month>12||day<1||day>daysInMonth||hour>23||minute>59||second>59||Number(match[8]??0)>23||Number(match[9]??0)>59)throw new Error('INVALID_INPUT: invalid calendar date');
  const result=Date.parse(value);
  if(!Number.isFinite(result))throw new Error('INVALID_INPUT: invalid date');
  return result;
}
const iso = (at: number) => new Date(at).toISOString();
export function localDay(at: string, zone = 'Asia/Riyadh'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date(instant(at)));
  return ['year','month','day'].map(k => parts.find(x=>x.type===k)?.value).join('-');
}
export function assessRecall(input: RecallInput): RecallAssessment {
  instant(input.at);
  if (!input.id || !input.testOpportunityId || !input.evidenceClusterId || !Number.isSafeInteger(input.requestedWords) || input.requestedWords < 1 ||
    (input.attemptedWords !== null && (!Number.isSafeInteger(input.attemptedWords) || input.attemptedWords < 0 || input.attemptedWords > input.requestedWords)) ||
    (input.errors !== null && (!Number.isSafeInteger(input.errors) || input.errors < 0)) ||
    !Number.isSafeInteger(input.hints) || input.hints < 0 || typeof input.revealed !== 'boolean' || typeof input.firstAttempt !== 'boolean' || typeof input.gapVerified !== 'boolean' ||
    (input.probeType!==undefined&&!['chunk','connected','random_start','link'].includes(input.probeType)) ||
    !['complete','partial','unknown'].includes(input.completion) || !['completed','memory_failure','user_stop','technical_failure'].includes(input.termination) ||
    !['hard','normal','easy','unknown'].includes(input.effort) || !['V1','V2','V3','V4'].includes(input.source)) throw new Error('INVALID_INPUT: recall');
  try { new Intl.DateTimeFormat('en',{timeZone:input.zoneIdAtCapture??'Asia/Riyadh'}); } catch { throw new Error('INVALID_INPUT: capture zone'); }
  if (input.lastExposureAt !== null && instant(input.lastExposureAt) > instant(input.at)) throw new Error('CLOCK_UNCERTAIN: exposure follows recall');
  const result: RecallAssessment = {strictPass: null, effectiveRating: null, eligible: false, delayedEvidenceEligible: false,
    accuracy: null, accuracyDenominator: null, verification: input.source, reasonCodes: [], independentVerification: input.source === 'V3' || input.source === 'V4'};
  // The denominator is the reference range actually attempted, including omitted words, never the spoken word count.
  const denominator = input.completion === 'complete' ? input.requestedWords : input.attemptedWords;
  if (input.errors !== null && denominator !== null && denominator > 0) {
    result.accuracyDenominator = denominator;
    result.accuracy = 100 * Math.max(0, 1 - input.errors / denominator);
  }
  if (input.source === 'V1' || input.source === 'V2') result.reasonCodes.push('SELF_REPORTED_EVIDENCE');
  if (input.disputed) { result.reasonCodes.push('DISPUTED_EVIDENCE'); return result; }
  if (!input.firstAttempt) result.reasonCodes.push('NOT_FIRST_ATTEMPT_OF_OPPORTUNITY');
  if (input.termination === 'technical_failure' || input.termination === 'user_stop') {result.reasonCodes.push('INCOMPLETE_SESSION_RESUME'); return result;}
  const observedFailure = input.hints > 0 || input.revealed || (input.errors !== null && input.errors > 0) || input.termination === 'memory_failure';
  if (observedFailure) {
    result.strictPass = false;
    result.effectiveRating = 1;
    result.eligible = true;
    result.delayedEvidenceEligible = input.firstAttempt;
    result.reasonCodes.push(input.hints > 0 || input.revealed ? 'HINT_INVALIDATES_INDEPENDENT_RECALL' : 'OBSERVED_RECALL_FAILURE');
    return result;
  }
  if (input.suspectedMistakes || input.errors === null || input.completion !== 'complete' || input.attemptedWords !== input.requestedWords) {
    result.reasonCodes.push('MISSING_EVIDENCE'); return result;
  }
  result.strictPass = input.firstAttempt ? true : null;
  if (input.effort === 'unknown') {result.reasonCodes.push('MISSING_EFFORT_EVIDENCE'); return result;}
  result.effectiveRating = input.effort === 'hard' ? 2 : input.effort === 'easy' ? 4 : 3;
  result.eligible = true;
  result.delayedEvidenceEligible = input.firstAttempt;
  result.reasonCodes.push('OBSERVED_INDEPENDENT_RECALL');
  return result;
}
export function initialUnitState(unitId: string, declaredKnown = false, probeType: UnitState['probeType'] = 'chunk'): UnitState {
  if (!unitId) throw new Error('INVALID_INPUT: unitId');
  return {unitId, phase: 'NotStarted', probeType, continuityEvidenceIds: [], continuityProcessedEvidenceIds: [], continuityLastObservedAt: null, previousPhase: null, consecutiveClean: 0, failures: 0,
    broadDelayedFailuresAfterRepair: 0, successfulEvidence: [], processedEvidenceIds: [], processedOpportunityIds: [], processedClusterIds: [],
    transitions: [], lastExposureAt: null, firstInitialRecallAt: null, lastFailureAt: null,
    lastObservedAt: null, source: null, continuityPassed: null, declaredKnown};
}
function change(state: UnitState, to: Phase, at: string, code: string, ids: string[], source: RecallInput['source'] | null, policy: HmePolicy) {
  if (state.phase === to) return;
  state.transitions.push({from: state.phase, to, at, reasonCode: code, evidenceIds: ids, source, policyVersion: policy.version});
  state.phase = to;
}
export function recordExposure(state: UnitState, at: string, policy: HmePolicy = P0): UnitState {
  const time = instant(at);
  if (state.lastExposureAt !== null && time < instant(state.lastExposureAt)) throw new Error('CLOCK_UNCERTAIN: out-of-order exposure');
  const next = structuredClone(state);
  next.lastExposureAt = at;
  if (next.phase === 'NotStarted') change(next, 'Learning', at, 'ACQUISITION_STARTED', [], null, policy);
  return next;
}
function gates(state: UnitState, policy: HmePolicy, zoneId: string) {
  const successful = state.successfulEvidence.filter(x=>x.gapVerified && x.gapMs !== null && x.gapMs >= policy.minimumDelayedMinutes * 60000);
  const days = new Set(successful.map(x=>localDay(x.at, x.zoneIdAtCapture??zoneId))).size;
  const times = successful.map(x=>instant(x.at));
  const first = state.firstInitialRecallAt ? instant(state.firstInitialRecallAt) : (times[0] ?? 0);
  const span = times.length ? (Math.max(...times) - first) / DAY : 0;
  const maxGap = Math.max(0, ...successful.map(x=>x.gapMs ?? 0)) / DAY;
  const lastGap = (successful.at(-1)?.gapMs ?? 0) / 3600000;
  return {early: days >= policy.earlyIndependentDays && lastGap >= policy.earlyGapHours && span >= policy.earlyEvidenceSpanDays,
    maintenance: days >= policy.maintenanceIndependentDays && span >= policy.maintenanceEvidenceSpanDays && maxGap >= policy.maintenanceGapDays && state.continuityPassed === true && state.continuityEvidenceIds.length > 0};
}
export function advanceUnit(state: UnitState, input: RecallInput, policy: HmePolicy = P0, zoneId = 'Asia/Riyadh'): UnitState {
  if (state.processedEvidenceIds.includes(input.id)) return structuredClone(state);
  if ((input.probeType ?? 'chunk') !== state.probeType) throw new Error('REFERENCE_MISMATCH: probe type belongs to another scheduler key');
  const result = assessRecall(input);
  const next = structuredClone(state);
  if (next.lastObservedAt && instant(input.at) < instant(next.lastObservedAt)) throw new Error('CLOCK_UNCERTAIN: replay must order observations');
  next.processedEvidenceIds.push(input.id);
  next.lastObservedAt = input.at;
  next.source = input.source;
  const exposures = [next.lastExposureAt, input.lastExposureAt].filter((x): x is string => x !== null);
  const lastExposure = exposures.length ? Math.max(...exposures.map(instant)) : null;
  const gapMs = lastExposure === null ? null : instant(input.at) - lastExposure;
  if (gapMs !== null && gapMs < 0) throw new Error('CLOCK_UNCERTAIN: negative evidence gap');
  const uniqueOpportunity = !next.processedOpportunityIds.includes(input.testOpportunityId);
  if (uniqueOpportunity) next.processedOpportunityIds.push(input.testOpportunityId);
  const knownExposure = input.hints > 0 || input.revealed || (input.attemptedWords !== null && input.attemptedWords > 0);
  if (knownExposure) next.lastExposureAt = input.at;
  const uniqueCluster = !next.processedClusterIds.includes(input.evidenceClusterId);
  if(uniqueCluster)next.processedClusterIds.push(input.evidenceClusterId);
  if (!result.eligible || !result.delayedEvidenceEligible || !uniqueOpportunity || !uniqueCluster) return next;
  if (next.phase === 'NotStarted') change(next, 'Learning', input.at, 'DIAGNOSTIC_STARTED', [input.id], input.source, policy);
  if (result.strictPass === true) {
    next.consecutiveClean++;
    // One cluster can contribute once to delayed independent evidence. It may contain several nested units.
    if (!next.successfulEvidence.some(x=>x.evidenceClusterId===input.evidenceClusterId)) next.successfulEvidence.push({
      id: input.id, at: input.at, gapMs, gapVerified: input.gapVerified,
      source: input.source, zoneIdAtCapture: input.zoneIdAtCapture??zoneId, testOpportunityId: input.testOpportunityId, evidenceClusterId: input.evidenceClusterId,
    });
    if (['Learning','Relearning'].includes(next.phase) && next.consecutiveClean >= policy.initialCleanSuccesses) {
      next.firstInitialRecallAt = input.at;
      change(next, 'InitialRecall', input.at, 'INITIAL_RECALL_ACHIEVED', [input.id], input.source, policy);
      change(next, 'EarlyReview', input.at, 'EARLY_REVIEW_DUE', [input.id], input.source, policy);
    } else if (next.phase === 'NeedsReinforcement' && input.gapVerified && gapMs !== null && gapMs >= policy.minimumDelayedMinutes*60000) {
      // Old successes never certify a new post-failure window. Evidence retained outside the window in raw events.
      change(next, 'EarlyReview', input.at, 'REPAIR_DELAYED_RETEST_PASSED', [input.id], input.source, policy);
    }
    const eligible = gates(next, policy, zoneId);
    if (next.phase === 'EarlyReview' && eligible.early) change(next, 'Consolidating', input.at, 'DELAYED_EVIDENCE_GATE_PASSED', next.successfulEvidence.map(x=>x.id), input.source, policy);
    if (next.phase === 'Consolidating' && eligible.maintenance) change(next, 'Maintenance', input.at, 'TEMPORAL_AND_CONTINUITY_GATE_PASSED', next.successfulEvidence.map(x=>x.id), input.source, policy);
  } else if (result.strictPass === false) {
    next.consecutiveClean = 0;
    next.failures++;
    next.lastFailureAt = input.at;
    next.successfulEvidence = [];
    next.firstInitialRecallAt = input.at;
    const broad = input.broadFailure === true || (input.errors !== null && input.errors / input.requestedWords > policy.broadFailureFraction) ||
      (input.termination === 'memory_failure' && input.attemptedWords !== null && input.attemptedWords < input.requestedWords/2);
    if (broad && input.afterRepair && input.gapVerified && gapMs !== null && gapMs >= policy.minimumDelayedMinutes*60000) next.broadDelayedFailuresAfterRepair++;
    if (!['Learning','Relearning'].includes(next.phase)) {
      if (next.phase !== 'NeedsReinforcement') next.previousPhase = next.phase;
      change(next, 'NeedsReinforcement', input.at, input.probeType==='link' ? 'LINK_WEAKNESS' : 'OBSERVED_RECALL_FAILURE', [input.id], input.source, policy);
      if (next.broadDelayedFailuresAfterRepair >= policy.broadFailuresForRelearning) change(next, 'Relearning', input.at, 'REPEATED_BROAD_DELAYED_FAILURE', [input.id], input.source, policy);
    }
  }
  next.lastExposureAt = input.at;
  return next;
}
export function trainingDecision(input: {repetitions: number; consecutiveClean: number; failedAttempts: number; elapsedMinutes: number; fatigue: boolean}, policy: HmePolicy=P0) {
  if (![input.repetitions,input.consecutiveClean,input.failedAttempts].every(x=>Number.isSafeInteger(x)&&x>=0) || !number(input.elapsedMinutes)) throw new Error('INVALID_INPUT: training');
  if (input.fatigue || input.elapsedMinutes >= policy.maxSessionMinutes || input.failedAttempts >= policy.maxFailedAttempts) return {next:'rest' as const, reasonCode:'TRAINING_FATIGUE_CAP', restMinutes:policy.restMinutes};
  if (input.consecutiveClean >= policy.initialCleanSuccesses) return {next:'delayed_probe' as const,reasonCode:'INITIAL_RECALL_ONLY'};
  return input.repetitions >= policy.minimumGuidedRepetitions ? {next:'recall_test' as const,reasonCode:'REPETITIONS_ARE_NOT_MASTERY'} : {next:'guided_repetition' as const,reasonCode:'MINIMUM_PREPARATION'};
}
export function computeDueDates(input: {at: string; rawModelDueAt: string | null; phase: Phase; independentlyVerified: boolean; maintenanceDueAt?: string | null; originalDueAt?: string | null; plannedAt?: string | null; failure?: boolean; initialRecallOutstanding?: boolean; delayedSuccessCount?: number}, policy: HmePolicy=P0): DueDates {
  const at=instant(input.at); const constraints: Array<{at:number;reason:string}>=[];
  if (input.rawModelDueAt) constraints.push({at:instant(input.rawModelDueAt),reason:'FSRS_MODEL_DUE'});
  if (input.failure) constraints.push({at:at+policy.minimumDelayedMinutes*60000,reason:'OBSERVED_RECALL_FAILURE'});
  if (input.phase==='InitialRecall' || input.initialRecallOutstanding) constraints.push({at:at+policy.minimumDelayedMinutes*60000,reason:'INITIAL_DELAYED_PROBE_DUE'});
  else if (['EarlyReview','Learning','Relearning','NeedsReinforcement'].includes(input.phase)) constraints.push({at:at+policy.earlyCapsDays[(input.delayedSuccessCount??0)>0?1:0]*DAY,reason:'EARLY_REVIEW_DUE'});
  else if (input.phase==='Consolidating') constraints.push({at:at+policy.earlyCapsDays[2]*DAY,reason:'EARLY_REVIEW_DUE'});
  if (!input.independentlyVerified) constraints.push({at:at+policy.selfReportCapDays*DAY,reason:'SELF_REPORT_INTERVAL_CAP'});
  if (input.maintenanceDueAt) constraints.push({at:instant(input.maintenanceDueAt),reason:'MAINTENANCE_MAX_GAP'});
  if (constraints.some(x=>x.at<at)) throw new Error('CLOCK_UNCERTAIN: next due before observation');
  const min=constraints.length ? Math.min(...constraints.map(x=>x.at)):null;
  if(input.plannedAt) instant(input.plannedAt);
  if(input.originalDueAt) instant(input.originalDueAt);
  return {rawModelDueAt:input.rawModelDueAt,policyDueAt:min===null?null:iso(min),plannedAt:input.plannedAt??null,
    originalDueAt:input.originalDueAt??(min===null?null:iso(min)),reasonCodes:constraints.filter(x=>x.at===min).map(x=>x.reason)};
}
export function planDay(input: {minutes:number;spentMinutes?:number;candidates:PlanCandidate[];at?:string;futureLoadFeasible?:boolean;allowNewWithDeferred?:boolean},policy:HmePolicy=P0):DayPlan {
  const spent=input.spentMinutes??0;
  if(!number(input.minutes)||input.minutes>1440||!number(spent)||policy.reserveFraction<0||policy.reserveFraction>=1) throw new Error('INVALID_INPUT: planning budget');
  const ids=new Set<string>();
  for(const c of input.candidates) {if(!c.id||ids.has(c.id)||!number(c.costMinutes,Number.MIN_VALUE)||!number(c.priority))throw new Error('INVALID_INPUT: planning candidate');ids.add(c.id);}
  if(input.at)instant(input.at);
  const reserve=input.minutes*policy.reserveFraction;
  const budget=Math.max(0,input.minutes-reserve-spent);
  const rank=(c:PlanCandidate)=>c.kind==='repair'?0:c.kind==='early_review'?1:c.kind==='maintenance'||c.protected?2:c.kind==='review'?3:c.kind==='link'?4:c.kind==='new'?6:5;
  const sorted=[...input.candidates].sort((a,b)=>rank(a)-rank(b)||a.priority-b.priority||(a.originalDueAt??'').localeCompare(b.originalDueAt??'')||a.id.localeCompare(b.id));
  const tasks:PlannedTask[]=[];const deferred:PlannedTask[]=[];const coverage=new Set<string>();let used=0;
  const schedule=(c:PlanCandidate,accepted:boolean,reason:string)=>({...c,plannedAt:accepted?(input.at??null):null,executionStatus:accepted?'pending' as const:'deferred' as const,outcome:'not_measured' as const,decisionReason:reason});
  const reviews=sorted.filter(c=>c.kind!=='new');const fresh=sorted.filter(c=>c.kind==='new');
  for(const c of reviews) {
    const overlap=(c.coverageKeys??[]).some(x=>coverage.has(x));
    if(overlap){deferred.push(schedule(c,false,'COVERAGE_OVERLAP_REQUIRES_EXPLICIT_COMPATIBLE_GROUP'));continue;}
    if(used+c.costMinutes<=budget+1e-9){tasks.push(schedule(c,true,c.reasonCode??(c.protected?'PROTECTED_REVIEW':'DUE_REVIEW')));used+=c.costMinutes;for(const k of c.coverageKeys??[])coverage.add(k);}
    else deferred.push(schedule(c,false,'TIME_BUDGET_DEFERRED'));
  }
  const protectedDebt=deferred.some(c=>c.protected||c.kind==='repair'||c.kind==='early_review'||c.kind==='maintenance');
  const blockedByDebt=protectedDebt||(deferred.some(c=>c.kind!=='new')&&!input.allowNewWithDeferred);
  for(const c of fresh) {
    if(blockedByDebt||input.futureLoadFeasible!==true){deferred.push(schedule(c,false,blockedByDebt?'BACKLOG_NEW_PAUSED':'FUTURE_LOAD_NOT_VERIFIED'));continue;}
    if((c.coverageKeys??[]).some(x=>coverage.has(x))){deferred.push(schedule(c,false,'COVERAGE_OVERLAP'));continue;}
    if(used+c.costMinutes<=budget+1e-9){tasks.push(schedule(c,true,'NEW_WITHIN_VERIFIED_CAPACITY'));used+=c.costMinutes;for(const k of c.coverageKeys??[])coverage.add(k);}
    else deferred.push(schedule(c,false,'TIME_BUDGET_DEFERRED'));
  }
  const capacityStatus=input.futureLoadFeasible===false||deferred.some(c=>c.kind!=='new'&&c.decisionReason==='TIME_BUDGET_DEFERRED')?'infeasible':input.futureLoadFeasible===undefined?'uncertain':'feasible';
  return {policyVersion:policy.version,minutes:input.minutes,reserveMinutes:reserve,spentMinutes:spent,remainingBudgetMinutes:budget,
    plannedMinutes:used,tasks,deferred,capacityStatus,reasonCodes:[...new Set(deferred.map(c=>c.decisionReason).concat(capacityStatus==='infeasible'?['CAPACITY_CONFLICT']:[]))]};
}
export interface RecoveryUnit {id:string;stratum:'recent_weak'|'old_due'|'unknown';costMinutes:number;}
export function recoveryPlan(input:{absenceDays:number;units:RecoveryUnit[];seed:number;minutes:number;outsideReview?:'yes'|'no'|'unknown'|'skipped'},policy:HmePolicy=P0) {
  if(!number(input.absenceDays)||!Number.isSafeInteger(input.seed)||!number(input.minutes)||input.units.some(u=>!u.id||!number(u.costMinutes,Number.MIN_VALUE))||new Set(input.units.map(x=>x.id)).size!==input.units.length)throw new Error('INVALID_INPUT: recovery');
  const target=input.absenceDays>=90?policy.recoverySampleTargets[2]:input.absenceDays>=21?policy.recoverySampleTargets[1]:policy.recoverySampleTargets[0];
  let seed=input.seed>>>0;
  const rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const pools=['recent_weak','old_due','unknown'].map(stratum=>{
    const a=input.units.filter(x=>x.stratum===stratum).sort((x,y)=>x.id.localeCompare(y.id));
    for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;
  });
  const sample:RecoveryUnit[]=[];
  while(sample.length<Math.min(target,input.units.length)&&pools.some(x=>x.length))for(const pool of pools)if(pool.length&&sample.length<target)sample.push(pool.shift()!);
  const untested=input.units.filter(x=>!sample.some(s=>s.id===x.id));let spent=0;
  const today:RecoveryUnit[]=[];const later:RecoveryUnit[]=[];
  for(const u of sample){if(spent+u.costMinutes<=input.minutes*(1-policy.reserveFraction)){today.push(u);spent+=u.costMinutes;}else later.push(u);}
  return {policyVersion:policy.version,seed:input.seed,target,sample,today,later,untested,outsideReview:input.outsideReview??'unknown',
    changesMemoryState:false as const,createsFailureEvents:false as const,newMemorization:'requires_diagnostic_and_capacity_gate' as const,
    reasonCodes:['RECOVERY_DIAGNOSTIC','UNTESTED_REMAINS_UNKNOWN'],resumeNewAfterStableDays:policy.stableRecoveryDays};
}
export function maintenanceCapacity(totalMinutes:number,cycleDays:number,availableMinutesPerDay:number) {
  if(!number(totalMinutes)||!number(cycleDays,Number.MIN_VALUE)||!number(availableMinutesPerDay))throw new Error('INVALID_INPUT: maintenance');
  const requiredMinutesPerDay=totalMinutes/cycleDays;
  return {requiredMinutesPerDay,availableMinutesPerDay,deficitMinutesPerDay:Math.max(0,requiredMinutesPerDay-availableMinutesPerDay),feasible:requiredMinutesPerDay<=availableMinutesPerDay};
}
export function backlogAfterDay(backlog:number,arrivals:number,completed:number) {
  if(![backlog,arrivals,completed].every(x=>number(x)))throw new Error('INVALID_INPUT: backlog');
  return Math.max(0,backlog+arrivals-completed);
}
export function selectAcquisition(input:{candidates:Array<{id:string;words:number;approvedBoundary:boolean;routeOrder:number}>;minutes:number;setupMinutes:number;minutesPerWord:number;futureLoadFeasible:boolean}) {
  if(![input.minutes,input.setupMinutes,input.minutesPerWord].every(x=>number(x)))throw new Error('INVALID_INPUT: acquisition');
  if(!input.futureLoadFeasible)return null;
  const candidates=[...input.candidates].sort((a,b)=>a.routeOrder-b.routeOrder);
  const candidate=candidates.find(c=>c.approvedBoundary&&Number.isSafeInteger(c.words)&&c.words>0);
  if(!candidate)return null;
  const costMinutes=input.setupMinutes+candidate.words*input.minutesPerWord;
  return costMinutes<=input.minutes?{...candidate,costMinutes,reasonCode:'NEXT_APPROVED_UNIT_IN_USER_ROUTE'}:null;
}
export function connectedStatus(chunks:Array<{id:string;strictPass:boolean|null}>,links:Array<{id:string;strictPass:boolean|null}>,requiredLinkIds?:string[]) {
  const valid=(items:Array<{id:string;strictPass:boolean|null}>)=>items.every(x=>typeof x.id==='string'&&x.id.length>0&&(x.strictPass===null||typeof x.strictPass==='boolean'));
  if(!valid(chunks)||!valid(links)||new Set(chunks.map(x=>x.id)).size!==chunks.length||new Set(links.map(x=>x.id)).size!==links.length)throw new Error('INVALID_INPUT: duplicate or invalid continuity target identity');
  if(requiredLinkIds!==undefined&&(!Array.isArray(requiredLinkIds)||requiredLinkIds.some(id=>typeof id!=='string'||!id)||new Set(requiredLinkIds).size!==requiredLinkIds.length))throw new Error('INVALID_INPUT: required continuity link identities');
  // A count cannot prove which approved edge was crossed. Connected claims need the explicit approved edge set, even when that set is empty.
  const required=requiredLinkIds??[];
  const identityCoverage=requiredLinkIds!==undefined&&required.length>=Math.max(0,chunks.length-1)&&links.length===required.length&&required.every(id=>links.some(l=>l.id===id));
  return {eligibleForConnectedClaim:chunks.length>0&&identityCoverage&&chunks.every(x=>x.strictPass===true)&&links.every(x=>x.strictPass===true),
    weakLinks:links.filter(x=>x.strictPass===false).map(x=>x.id),untestedLinks:required.filter(id=>!links.some(x=>x.id===id&&x.strictPass!==null)),
    reasonCode:identityCoverage?'REQUIRED_CONTINUITY_LINKS_IDENTIFIED':'APPROVED_CONTINUITY_COVERAGE_REQUIRED'};
}
export interface TokenRange {editionId:string;start:number;end:number;}
/** Global token offsets are only legal inside the same approved edition/tokenization. */
export function unionTokenRanges(ranges:TokenRange[]):TokenRange[] {
  for(const r of ranges)if(!r.editionId||!Number.isSafeInteger(r.start)||!Number.isSafeInteger(r.end)||r.start<0||r.end<=r.start)throw new Error('INVALID_INPUT: token range');
  const result:TokenRange[]=[];
  for(const r of [...ranges].sort((a,b)=>a.editionId.localeCompare(b.editionId)||a.start-b.start||a.end-b.end)) {
    const prev=result.at(-1);
    if(prev&&prev.editionId===r.editionId&&r.start<=prev.end)prev.end=Math.max(prev.end,r.end);else result.push({...r});
  }
  return result;
}
export function countUniqueTokens(ranges:TokenRange[]):number{if(new Set(ranges.map(x=>x.editionId)).size>1)throw new Error('REFERENCE_MISMATCH: cannot sum editions without an approved content mapping');return unionTokenRanges(ranges).reduce((n,r)=>n+r.end-r.start,0);}

/** Apply a separately observed link/connected probe to continuity only; never change lexical history. */
export function applyContinuityEvidence(state:UnitState,input:RecallInput,requiredLinkIds:string[]):UnitState {
  if(input.probeType!=='link' && input.probeType!=='connected')throw new Error('REFERENCE_MISMATCH: continuity requires its own probe');
  if(input.targetUnitId!==state.unitId)throw new Error('REFERENCE_MISMATCH: continuity evidence belongs to another target');
  const result=assessRecall(input);const next=structuredClone(state);
  if(!Array.isArray(requiredLinkIds)||requiredLinkIds.length===0 || requiredLinkIds.some(id=>typeof id!=='string'||!id)||new Set(requiredLinkIds).size!==requiredLinkIds.length)throw new Error('INVALID_INPUT: continuity coverage');
  if(input.observedLinkIds!==undefined&&(!Array.isArray(input.observedLinkIds)||input.observedLinkIds.some(id=>typeof id!=='string'||!id)||new Set(input.observedLinkIds).size!==input.observedLinkIds.length))throw new Error('INVALID_INPUT: observed continuity identities');
  if(next.continuityProcessedEvidenceIds.includes(input.id))return next;
  const latest=[next.continuityLastObservedAt,next.lastFailureAt,next.lastObservedAt].filter((x):x is string=>x!==null);
  if(latest.some(at=>instant(input.at)<instant(at)))throw new Error('CLOCK_UNCERTAIN: stale continuity evidence must be applied through chronological replay');
  if(!result.eligible||!result.delayedEvidenceEligible||result.strictPass===null)return next;
  if(!input.observedLinkIds || input.observedLinkIds.length!==requiredLinkIds.length || !requiredLinkIds.every(id=>input.observedLinkIds!.includes(id)))return next;
  next.continuityProcessedEvidenceIds.push(input.id);
  next.continuityLastObservedAt=input.at;
  next.continuityPassed=result.strictPass;
  next.continuityEvidenceIds=result.strictPass?[input.id]:[];
  return next;
}
/** Descriptive link metric (HME §13); never an FSRS update or calibrated probability. */
export function linkEvidenceSummary(observations:Array<{id:string;at:string;clusterId:string;strictPass:boolean|null}>,now:string,capDays:number,windowSize=P0.linkObservationWindow) {
  if(!Number.isSafeInteger(windowSize)||windowSize<1||!number(capDays,Number.MIN_VALUE))throw new Error('INVALID_INPUT: link policy');
  const current=instant(now);const seen=new Set<string>();
  const qualified=[...observations].sort((a,b)=>instant(a.at)-instant(b.at)||a.id.localeCompare(b.id)).filter(o=>{
    if(!o.id||!o.clusterId||instant(o.at)>current)throw new Error('INVALID_INPUT: link observation');
    if(o.strictPass===null||seen.has(o.clusterId))return false;
    seen.add(o.clusterId);return true;
  }).slice(-windowSize);
  const n=qualified.length,s=qualified.filter(x=>x.strictPass===true).length;
  const last=qualified.at(-1)?.at??null;
  const descriptiveSmoothed=n===0?null:(s+1)/(n+2);
  return {successes:s,sampleSize:n,observedRate:n===0?null:s/n,descriptiveSmoothed,lastQualifiedAt:last,
    riskForPrioritization:descriptiveSmoothed===null||last===null?null:(1-descriptiveSmoothed)+Math.min((current-instant(last))/86400000/capDays,1),
    calibratedProbability:false as const,evidenceIds:qualified.map(x=>x.id)};
}
export function selectRepair(input:{type:'lexical'|'omission'|'addition'|'order'|'start_failure'|'transition_failure'|'similar_passage_jump'|'ending_confusion'|'tajwid_verified'|'unknown';observed:boolean;approvedConfusionSet?:boolean}) {
  if(!input.observed)return {action:'clarify_observation' as const,reasonCode:'MISSING_EVIDENCE'};
  switch(input.type){
    case 'start_failure':return {action:'independent_start_probe' as const,reasonCode:'START_WEAKNESS'};
    case 'transition_failure':return {action:'context_then_transition_retest' as const,reasonCode:'LINK_WEAKNESS'};
    case 'similar_passage_jump':case 'ending_confusion':return input.approvedConfusionSet?{action:'approved_contrast_then_context_recall' as const,reasonCode:'VERIFIED_CONFUSION_REPAIR'}:{action:'localized_retest_without_generated_alternative' as const,reasonCode:'CONFUSION_SOURCE_NOT_APPROVED'};
    case 'tajwid_verified':return {action:'qualified_teacher_correction' as const,reasonCode:'TAJWID_OUTSIDE_MEMORY_MODEL'};
    case 'unknown':return {action:'clarify_observation' as const,reasonCode:'MISSING_EVIDENCE'};
    default:return {action:'localized_correct_model_then_short_recall' as const,reasonCode:'LOCAL_LEXICAL_REPAIR'};
  }
}
export function recurrentMistake(input:{type:string;locationId:string|null;observations:Array<{type:string;locationId:string|null;testOpportunityId:string;observed:boolean}>},policy:HmePolicy=P0) {
  if(input.locationId===null)return {requiresTargetedRepair:false,episodeCount:0,reasonCode:'LOCATION_UNKNOWN'};
  const episodes=new Set(input.observations.filter(x=>x.observed&&x.type===input.type&&x.locationId===input.locationId).map(x=>x.testOpportunityId));
  return {requiresTargetedRepair:episodes.size>=policy.repeatedMistakeEpisodes,episodeCount:episodes.size,reasonCode:episodes.size>=policy.repeatedMistakeEpisodes?'RECURRENT_LOCAL_MISTAKE':'MONITOR_LOCAL_MISTAKE'};
}
