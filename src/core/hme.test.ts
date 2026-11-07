import { describe,it,expect } from 'vitest';
import { P0,linkEvidenceSummary,selectRepair,recurrentMistake,applyContinuityEvidence,assessRecall,initialUnitState,advanceUnit,recordExposure,trainingDecision,computeDueDates,planDay,recoveryPlan,maintenanceCapacity,backlogAfterDay,selectAcquisition,connectedStatus,unionTokenRanges,countUniqueTokens } from './hme';
import type { RecallInput,PlanCandidate } from './hme-types';
const at=(day=0,minute=0)=>new Date(Date.UTC(2026,0,1)+day*86400000+minute*60000).toISOString();
function recall(id:string,day=0,patch:Partial<RecallInput>={}):RecallInput{return {id,at:at(day),requestedWords:100,attemptedWords:100,errors:0,hints:0,revealed:false,completion:'complete',termination:'completed',effort:'normal',source:'V1',firstAttempt:true,lastExposureAt:null,gapVerified:true,testOpportunityId:`op-${id}`,evidenceClusterId:`cluster-${id}`,...patch};}
describe('HME manual recall rubric (HME §5–7,11; PRD C07/C08)',()=>{
 it('100-word denominator includes omissions; A99 is not a strict pass',()=>{const r=assessRecall(recall('a',0,{errors:1}));expect(r.accuracy).toBe(99);expect(r.effectiveRating).toBe(1);expect(r.strictPass).toBe(false);});
 it.each(['hard','normal','easy'] as const)('clean %s maps to its own FSRS grade',effort=>{const r=assessRecall(recall('a',0,{effort}));expect(r.effectiveRating).toBe({hard:2,normal:3,easy:4}[effort]);expect(r.strictPass).toBe(true);});
 it('Easy with a hint remains Again and self-report, never independent verification',()=>{const r=assessRecall(recall('a',0,{effort:'easy',hints:1}));expect(r.effectiveRating).toBe(1);expect(r.independentVerification).toBe(false);expect(r.reasonCodes).toContain('HINT_INVALIDATES_INDEPENDENT_RECALL');});
 it('revealing text invalidates a clean independent claim',()=>expect(assessRecall(recall('a',0,{revealed:true})).effectiveRating).toBe(1));
 it.each(['technical_failure','user_stop'] as const)('incomplete %s produces no success or failure',termination=>{const r=assessRecall(recall('a',0,{completion:'partial',attemptedWords:30,termination,errors:null}));expect(r.effectiveRating).toBeNull();expect(r.strictPass).toBeNull();expect(r.eligible).toBe(false);});
 it('explicit memory failure is Again without invented error location',()=>{const r=assessRecall(recall('a',0,{completion:'partial',attemptedWords:20,termination:'memory_failure',errors:null}));expect(r.effectiveRating).toBe(1);expect(r.accuracy).toBeNull();});
 it('unknown errors never become zero',()=>{const r=assessRecall(recall('a',0,{errors:null}));expect(r.strictPass).toBeNull();expect(r.effectiveRating).toBeNull();});
 it('suspected mistakes block certification without inventing Again',()=>{const r=assessRecall(recall('a',0,{suspectedMistakes:true}));expect(r.strictPass).toBeNull();expect(r.effectiveRating).toBeNull();});
 it('disputed and non-first interpretations are not new eligible reviews',()=>{expect(assessRecall(recall('a',0,{disputed:true})).eligible).toBe(false);expect(assessRecall(recall('a',0,{firstAttempt:false})).eligible).toBe(true);expect(assessRecall(recall('a',0,{firstAttempt:false})).delayedEvidenceEligible).toBe(false);});
 it('partial coverage denominator is only the attempted reference range',()=>expect(assessRecall(recall('a',0,{completion:'partial',attemptedWords:20,errors:2,termination:'memory_failure'})).accuracy).toBe(90));
 it('rejects invalid words and negative temporal exposure',()=>{expect(()=>assessRecall(recall('a',0,{requestedWords:0}))).toThrow('INVALID_INPUT');expect(()=>assessRecall(recall('a',0,{lastExposureAt:at(1)}))).toThrow('CLOCK');});
});
describe('HME state gates and replay-safe evidence (HME §5,8,17)',()=>{
 it('40 confirmed repetitions provide no recall or maintenance state',()=>{let state=initialUnitState('synthetic-1');for(let i=0;i<40;i++)state=recordExposure(state,at(0,i));expect(state.phase).toBe('Learning');expect(state.successfulEvidence).toHaveLength(0);expect(trainingDecision({repetitions:40,consecutiveClean:0,failedAttempts:0,elapsedMinutes:10,fatigue:false}).next).toBe('recall_test');});
 it('two distinct immediate clean attempts record InitialRecall then EarlyReview, never Maintenance',()=>{let s=advanceUnit(initialUnitState('a'),recall('1'));s=advanceUnit(s,recall('2',0,{at:at(0,1)}));expect(s.phase).toBe('EarlyReview');expect(s.transitions.map(t=>t.to)).toEqual(['Learning','InitialRecall','EarlyReview']);expect(s.transitions.at(-1)?.policyVersion).toBe(P0.version);});
 it('repeated event and repeated opportunity do not create two independent successes',()=>{const a=recall('1');const s=advanceUnit(initialUnitState('a'),a);expect(advanceUnit(s,a)).toEqual(s);const next=advanceUnit(s,recall('2',0,{testOpportunityId:a.testOpportunityId}));expect(next.consecutiveClean).toBe(1);});
 it('declared prior knowledge has no FSRS/maintenance proof',()=>{const s=initialUnitState('a',true);expect(s.declaredKnown).toBe(true);expect(s.phase).toBe('NotStarted');expect(s.successfulEvidence).toEqual([]);});
 it('verified delayed evidence at days1 and3 passes early gate only',()=>{let s=advanceUnit(initialUnitState('a'),recall('1'));s=advanceUnit(s,recall('2',0,{at:at(0,1)}));s=advanceUnit(s,recall('3',1));s=advanceUnit(s,recall('4',3,{at:at(3,1)}));expect(s.phase).toBe('Consolidating');expect(s.continuityPassed).toBeNull();});
 it('midnight crossing or unverified gap cannot satisfy delayed gate',()=>{let s=advanceUnit(initialUnitState('a'),recall('1'));s=advanceUnit(s,recall('2',0,{at:at(0,1)}));s=advanceUnit(s,recall('3',1,{gapVerified:false}));s=advanceUnit(s,recall('4',3,{gapVerified:false}));expect(s.phase).toBe('EarlyReview');});
 it('recent exposure prevents a long nominal interval from certifying a gate',()=>{let s=advanceUnit(initialUnitState('a'),recall('1'));s=advanceUnit(s,recall('2',0,{at:at(0,1)}));s=advanceUnit(s,recall('3',1));s=recordExposure(s,at(3,-1));s=advanceUnit(s,recall('4',3));expect(s.phase).toBe('EarlyReview');expect(s.successfulEvidence.at(-1)?.gapMs).toBe(60000);});
 it('14-day span,7-day gap and successful connection are all required for Maintenance',()=>{let s=advanceUnit(initialUnitState('a'),recall('1'));s=advanceUnit(s,recall('2',0,{at:at(0,1)}));s=advanceUnit(s,recall('3',1));s=advanceUnit(s,recall('4',3));s=advanceUnit(s,recall('5',14));expect(s.phase).toBe('Consolidating');s=applyContinuityEvidence(s,recall('link-proof',14,{probeType:'connected',targetUnitId:'a',observedLinkIds:['a-b']}),['a-b']);s=advanceUnit(s,recall('6',21));expect(s.phase).toBe('Maintenance');});
 it('failure preserves previous phase and requires a fresh post-failure evidence window',()=>{let s=initialUnitState('a');s.phase='Maintenance';s=advanceUnit(s,recall('1',1,{errors:1}));expect(s.phase).toBe('NeedsReinforcement');expect(s.previousPhase).toBe('Maintenance');expect(s.successfulEvidence).toEqual([]);s=advanceUnit(s,recall('2',2));expect(s.phase).toBe('EarlyReview');});
 it('two broad delayed failures after repair trigger relearning, not absence alone',()=>{let s=initialUnitState('a');s.phase='Consolidating';s.lastExposureAt=at(0);s=advanceUnit(s,recall('1',1,{errors:25,afterRepair:true}));s=advanceUnit(s,recall('2',2,{errors:25,afterRepair:true}));expect(s.phase).toBe('Relearning');});
 it('unknown interruption preserves workflow without fabricated failure',()=>{let s=initialUnitState('a');s.phase='Maintenance';s=advanceUnit(s,recall('1',30,{termination:'technical_failure',errors:null}));expect(s.phase).toBe('Maintenance');expect(s.failures).toBe(0);});
 it('fatigue stops escalation at8 failures or20 minutes',()=>{expect(trainingDecision({repetitions:2,consecutiveClean:0,failedAttempts:8,elapsedMinutes:5,fatigue:false}).next).toBe('rest');expect(trainingDecision({repetitions:2,consecutiveClean:0,failedAttempts:0,elapsedMinutes:20,fatigue:false}).next).toBe('rest');});
});
describe('HME separate due dates (HME §3,11,15)',()=>{
 it('caps self-report externally without rewriting raw due or original debt',()=>{const r=computeDueDates({at:at(0),rawModelDueAt:at(17),phase:'Maintenance',independentlyVerified:false,originalDueAt:at(-1),plannedAt:at(10)});expect(r.rawModelDueAt).toBe(at(17));expect(r.policyDueAt).toBe(at(7));expect(r.plannedAt).toBe(at(10));expect(r.originalDueAt).toBe(at(-1));expect(r.reasonCodes).toContain('SELF_REPORT_INTERVAL_CAP');});
 it('failure schedules a20-minute policy probe',()=>expect(computeDueDates({at:at(0),rawModelDueAt:at(2),phase:'NeedsReinforcement',independentlyVerified:false,failure:true}).policyDueAt).toBe(at(0,20)));
 it('rejects a new raw due before last actual observation',()=>expect(()=>computeDueDates({at:at(1),rawModelDueAt:at(0),phase:'Maintenance',independentlyVerified:true})).toThrow('CLOCK'));
});
const candidates:PlanCandidate[]=[['R1','repair',6],['E1','early_review',7],['E2','early_review',5],['O1','maintenance',7],['O2','maintenance',8],['G34','link',16],['M1','review',9],['M2','review',7],['L2','link',4],['N1','new',12],['N2','new',16],['N3','new',20]].map(([id,kind,costMinutes],index)=>({id:String(id),unitId:String(id),kind:kind as PlanCandidate['kind'],costMinutes:Number(costMinutes),priority:index,protected:index<6,coverageKeys:[String(id)],originalDueAt:at(-2),policyDueAt:at(-2),rawModelDueAt:at(-3)}));
describe('HME real daily planner (HME §19b)',()=>{
 it.each([[30,25,0,44],[60,49,0,20],[120,97,28,0]])('%s-minute reference budget computes expected selection', (minutes,expected,newMinutes,deferredReviewMinutes)=>{
   const p=planDay({minutes,candidates,at:at(0),futureLoadFeasible:true});expect(p.plannedMinutes).toBe(expected);expect(p.tasks.filter(t=>t.kind==='new').reduce((s,t)=>s+t.costMinutes,0)).toBe(newMinutes);expect(p.deferred.filter(t=>t.kind!=='new').reduce((s,t)=>s+t.costMinutes,0)).toBe(deferredReviewMinutes);expect(p.tasks.some(t=>t.id==='O1')).toBe(true);expect(p.plannedMinutes).toBeLessThanOrEqual(p.remainingBudgetMinutes);expect(p.deferred.every(t=>t.outcome==='not_measured')).toBe(true);expect(p.deferred[0]?.originalDueAt).toBe(at(-2));
 });
 it('replanning deducts actual spent time and the original reserve once',()=>{const p=planDay({minutes:120,spentMinutes:6,candidates,at:at(0),futureLoadFeasible:true});expect(p.remainingBudgetMinutes).toBe(96);expect(p.reserveMinutes).toBe(18);expect(p.tasks.some(t=>t.id==='N2')).toBe(false);});
 it('zero time leaves obligations deferred without successful events',()=>{const p=planDay({minutes:0,candidates,futureLoadFeasible:true});expect(p.tasks).toEqual([]);expect(p.deferred).toHaveLength(candidates.length);expect(p.capacityStatus).toBe('infeasible');});
 it('unverified future load abstains from adding new memorization',()=>{expect(planDay({minutes:120,candidates:candidates.filter(t=>t.kind==='new')}).tasks).toEqual([]);});
 it('overlapping planned coverage is not counted twice',()=>{const a={...candidates[0],coverageKeys:['x']};const b={...candidates[1],coverageKeys:['x']};const p=planDay({minutes:60,candidates:[a,b],futureLoadFeasible:true});expect(p.tasks).toHaveLength(1);expect(p.deferred[0].decisionReason).toContain('OVERLAP');});
 it('duplicate candidate identities and NaN are rejected',()=>{expect(()=>planDay({minutes:60,candidates:[candidates[0],candidates[0]]})).toThrow('INVALID_INPUT');expect(()=>planDay({minutes:NaN,candidates:[]})).toThrow('INVALID_INPUT');});
 it('backlog examples close in6 days or grow to120, no erased dues',()=>{let b=90;for(let i=0;i<6;i++)b=backlogAfterDay(b,18,33);expect(b).toBe(0);b=90;for(let i=0;i<6;i++)b=backlogAfterDay(b,30,25);expect(b).toBe(120);});
 it('900-minute maintenance in30days needs30minutes/day, exposes10-minute deficit',()=>expect(maintenanceCapacity(900,30,20)).toEqual({requiredMinutesPerDay:30,availableMinutesPerDay:20,deficitMinutesPerDay:10,feasible:false}));
});
describe('HME recovery and noncontiguous ranges',()=>{
 const units=Array.from({length:40},(_,i)=>({id:`u${i}`,stratum:(['recent_weak','old_due','unknown'] as const)[i%3],costMinutes:5}));
 it.each([[3,3],[21,12],[90,24]])('absence%s days selects%s initial probes, never creates failure', (absenceDays,target)=>{const p=recoveryPlan({absenceDays,units,seed:1337,minutes:30});expect(p.sample).toHaveLength(target);expect(p.changesMemoryState).toBe(false);expect(p.createsFailureEvents).toBe(false);expect(p.untested).toHaveLength(40-target);expect(p.today.reduce((s,t)=>s+t.costMinutes,0)).toBeLessThanOrEqual(25.5);});
 it('seeded stratified selection resumes the same sample independent of input ordering',()=>{const a=recoveryPlan({absenceDays:21,units,seed:12,minutes:30});const b=recoveryPlan({absenceDays:21,units:[...units].reverse(),seed:12,minutes:30});expect(a.sample).toEqual(b.sample);expect(new Set(a.sample.map(x=>x.stratum)).size).toBe(3);});
 it('small collections use all units, no impossible one-day diagnosis',()=>{const p=recoveryPlan({absenceDays:90,units:units.slice(0,2),seed:1,minutes:0});expect(p.sample).toHaveLength(2);expect(p.today).toEqual([]);expect(p.later).toHaveLength(2);});
 it('overlap100+80−30 computes150 with no presumed gap coverage',()=>{expect(countUniqueTokens([{editionId:'synthetic',start:0,end:100},{editionId:'synthetic',start:70,end:150}])).toBe(150);expect(countUniqueTokens([{editionId:'synthetic',start:0,end:10},{editionId:'synthetic',start:20,end:30}])).toBe(20);});
 it('duplicate, edited, removed ranges recompute exact union; editions do not mix',()=>{const r={editionId:'e1',start:0,end:10};expect(unionTokenRanges([r,r])).toEqual([r]);expect(countUniqueTokens([r,{...r,start:5,end:20}])).toBe(20);expect(()=>countUniqueTokens([r,{...r,editionId:'e2'}])).toThrow('REFERENCE_MISMATCH');expect(countUniqueTokens([])).toBe(0);});
 it('strong separate chunks with weak or untested link never certify page connection',()=>{const chunks=[{id:'A',strictPass:true},{id:'B',strictPass:true}];expect(connectedStatus(chunks,[{id:'A→B',strictPass:false}]).eligibleForConnectedClaim).toBe(false);expect(connectedStatus(chunks,[]).eligibleForConnectedClaim).toBe(false);expect(connectedStatus(chunks,[{id:'A→B',strictPass:true}],['A→B']).eligibleForConnectedClaim).toBe(true);});
 it('acquisition cost fixture selects25words at12minutes; does not silently jump route',()=>{const r=selectAcquisition({candidates:[{id:'25',words:25,approvedBoundary:true,routeOrder:1},{id:'40',words:40,approvedBoundary:true,routeOrder:2}],minutes:13,setupMinutes:2,minutesPerWord:.4,futureLoadFeasible:true});expect(r?.id).toBe('25');expect(r?.costMinutes).toBe(12);});
});

it('same cluster cannot produce two initial successes or repeated broad failure',()=>{
 let s=advanceUnit(initialUnitState('a'),recall('1',0,{evidenceClusterId:'shared'}));
 s=advanceUnit(s,recall('2',0,{at:at(0,1),evidenceClusterId:'shared'}));expect(s.consecutiveClean).toBe(1);expect(s.phase).toBe('Learning');
});
it('technical interrupted recall with a hint records known exposure, no rating',()=>{
 let s=initialUnitState('a');s.phase='EarlyReview';s.lastExposureAt=at(0);
 s=advanceUnit(s,recall('1',3,{termination:'technical_failure',hints:1}));expect(s.lastExposureAt).toBe(at(3));expect(s.failures).toBe(0);
});
it('non-first actual clean attempt may schedule but cannot advance temporal evidence',()=>{
 const r=recall('second',1,{firstAttempt:false});expect(assessRecall(r).eligible).toBe(true);expect(assessRecall(r).delayedEvidenceEligible).toBe(false);expect(assessRecall(r).strictPass).toBeNull();
 const s=advanceUnit(initialUnitState('a'),r);expect(s.consecutiveClean).toBe(0);expect(s.lastExposureAt).toBe(at(1));
});
it('unqualified continuity flag cannot certify maintenance',()=>{
 let s=initialUnitState('a');s.phase='Consolidating';s=advanceUnit(s,recall('1',30,{continuityPassed:true,termination:'technical_failure'}));expect(s.continuityPassed).toBeNull();
});
it('link probe cannot erase or update chunk lexical scheduler state',()=>{
 expect(()=>advanceUnit(initialUnitState('a'),recall('link',1,{probeType:'link',errors:1}))).toThrow('REFERENCE_MISMATCH');
});
it('first delayed probe and post-next-day early cap use20minutes and3days',()=>{
 expect(computeDueDates({at:at(0),rawModelDueAt:at(20),phase:'InitialRecall',independentlyVerified:true}).policyDueAt).toBe(at(0,20));
 expect(computeDueDates({at:at(1),rawModelDueAt:at(20),phase:'EarlyReview',independentlyVerified:true,delayedSuccessCount:1}).policyDueAt).toBe(at(4));
});
it('future structural conflict remains infeasible even if today is empty',()=>{
 const p=planDay({minutes:60,candidates:[],futureLoadFeasible:false});expect(p.capacityStatus).toBe('infeasible');expect(p.reasonCodes).toContain('CAPACITY_CONFLICT');
});
it('protected debt always blocks new,even when allowing low-risk deferral',()=>{
 const p=planDay({minutes:30,candidates:[{...candidates[0],costMinutes:50},{...candidates[9],costMinutes:5}],futureLoadFeasible:true,allowNewWithDeferred:true});expect(p.tasks).toEqual([]);
});
it('lexical repair rank precedes a caller priority on maintenance',()=>{
 const p=planDay({minutes:10,candidates:[{...candidates[0],priority:999,protected:false},{...candidates[3],priority:0,protected:true}],futureLoadFeasible:true});expect(p.tasks[0].kind).toBe('repair');
});
it('runtime capture zone and nonexistent calendar dates are rejected',()=>{
 expect(()=>assessRecall(recall('1',0,{at:'2026-02-30T00:00:00Z'}))).toThrow('INVALID_INPUT');
 expect(()=>assessRecall(recall('1',0,{gapVerified:undefined as unknown as boolean}))).toThrow('INVALID_INPUT');
 expect(()=>assessRecall(recall('1',0,{zoneIdAtCapture:'invalid/zone'}))).toThrow('INVALID_INPUT');
});

it('link smoothing is descriptive3of4→4/6,then failure→4/7; no evidence staysnull',()=>{
 const observations=[true,true,true,false].map((strictPass,i)=>({id:`l${i}`,clusterId:`c${i}`,at:at(i),strictPass}));
 const a=linkEvidenceSummary(observations,at(5),7);expect(a.observedRate).toBe(.75);expect(a.descriptiveSmoothed).toBeCloseTo(4/6,12);
 const b=linkEvidenceSummary([...observations,{id:'l4',clusterId:'c4',at:at(4),strictPass:false}],at(5),7);expect(b.descriptiveSmoothed).toBeCloseTo(4/7,12);expect(b.calibratedProbability).toBe(false);
 expect(linkEvidenceSummary([],at(0),7).descriptiveSmoothed).toBeNull();
});
it('duplicate cluster is one link evidence and latest8window is bounded',()=>{
 const observations=Array.from({length:12},(_,i)=>({id:`l${i}`,clusterId:`c${i}`,at:at(i),strictPass:true}));
 expect(linkEvidenceSummary([...observations,observations[0]],at(15),7).sampleSize).toBe(8);
});
it('three same-location mistakes in distinct opportunities trigger localized repair',()=>{
 const observation={type:'lexical',locationId:'token-30',observed:true,testOpportunityId:'1'};
 expect(recurrentMistake({type:'lexical',locationId:'token-30',observations:[observation,observation]}).episodeCount).toBe(1);
 expect(recurrentMistake({type:'lexical',locationId:'token-30',observations:[observation,{...observation,testOpportunityId:'2'},{...observation,testOpportunityId:'3'}]}).requiresTargetedRepair).toBe(true);
 expect(recurrentMistake({type:'lexical',locationId:null,observations:[observation]}).requiresTargetedRepair).toBe(false);
});
it('repair choices distinguish lexical,link,tajwid and unapproved similar-passage content',()=>{
 expect(selectRepair({type:'transition_failure',observed:true}).action).toBe('context_then_transition_retest');
 expect(selectRepair({type:'tajwid_verified',observed:true}).action).toBe('qualified_teacher_correction');
 expect(selectRepair({type:'similar_passage_jump',observed:true}).reasonCode).toBe('CONFUSION_SOURCE_NOT_APPROVED');
 expect(selectRepair({type:'lexical',observed:false}).reasonCode).toBe('MISSING_EVIDENCE');
});

it('continuity coverage rejects duplicate chunk/link IDs and cannot infer absent approved links from counts',()=>{
 const chunks=[{id:'A',strictPass:true},{id:'B',strictPass:true},{id:'C',strictPass:true}];
 expect(()=>connectedStatus(chunks,[{id:'A-B',strictPass:true},{id:'A-B',strictPass:true}],['A-B','B-C'])).toThrow('INVALID_INPUT');
 expect(()=>connectedStatus([chunks[0],chunks[0]],[],[])).toThrow('INVALID_INPUT');
 expect(connectedStatus(chunks,[{id:'A-B',strictPass:true},{id:'X-Y',strictPass:true}],['A-B','B-C']).eligibleForConnectedClaim).toBe(false);
 expect(connectedStatus(chunks,[{id:'A-B',strictPass:true},{id:'B-C',strictPass:true}]).eligibleForConnectedClaim).toBe(false);
 expect(connectedStatus(chunks,[{id:'A-B',strictPass:true},{id:'B-C',strictPass:true}],['A-B','B-C']).eligibleForConnectedClaim).toBe(true);
 expect(connectedStatus([chunks[0]],[]).eligibleForConnectedClaim).toBe(false);expect(connectedStatus([chunks[0]],[],[]).eligibleForConnectedClaim).toBe(true);
});
it('old continuity success cannot overwrite newer observed failure or lexical failure',()=>{
 const good=recall('old-link',1,{probeType:'link',targetUnitId:'a',observedLinkIds:['A-B']});
 const bad=recall('new-link-failure',2,{probeType:'link',targetUnitId:'a',observedLinkIds:['A-B'],errors:1});
 let s=applyContinuityEvidence(initialUnitState('a'),bad,['A-B']);expect(s.continuityPassed).toBe(false);
 expect(()=>applyContinuityEvidence(s,good,['A-B'])).toThrow('CLOCK_UNCERTAIN');
 s=initialUnitState('a');s.lastFailureAt=at(3);expect(()=>applyContinuityEvidence(s,good,['A-B'])).toThrow('CLOCK_UNCERTAIN');
});
it('continuity evidence validates target,probe,identity and once-only application',()=>{
 const good=recall('link',1,{probeType:'link',targetUnitId:'a',observedLinkIds:['A-B']});
 let s=applyContinuityEvidence(initialUnitState('a'),good,['A-B']);expect(s.continuityPassed).toBe(true);expect(applyContinuityEvidence(s,good,['A-B'])).toEqual(s);
 expect(()=>applyContinuityEvidence(s,{...good,id:'b',targetUnitId:'wrong'},['A-B'])).toThrow('REFERENCE_MISMATCH');
 expect(()=>applyContinuityEvidence(s,{...good,id:'b',probeType:'chunk'},['A-B'])).toThrow('REFERENCE_MISMATCH');
 expect(()=>applyContinuityEvidence(s,{...good,id:'b',observedLinkIds:['A-B','A-B']},['A-B'])).toThrow('INVALID_INPUT');
 const incomplete=applyContinuityEvidence(initialUnitState('a'),{...good,observedLinkIds:['A-B']},['A-B','B-C']);expect(incomplete.continuityPassed).toBeNull();
});
