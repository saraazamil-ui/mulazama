import { canonical, DomainError, learningModeForVersions, learningVersionsFor } from '../core/types';
import type { LearningEvent, EventStore, EventSnapshot, LearningSchedulingMode } from '../core/types';
import { assessRecall, advanceUnit, initialUnitState, computeDueDates, planDay, recoveryPlan, instant, recordExposure } from '../core/hme';
import type { RecallInput, RecallAssessment, UnitState, DueDates, PlanCandidate, ProbeType } from '../core/hme-types';
import { fsrsAdapter } from '../core/fsrs';
import { ReferenceFsrsAdapter } from '../core/fsrs-reference';
import type { FsrsState } from '../core/fsrs';
import { validateLearningCommand } from './learning-validation';
import { validateLearningEventEnvelope } from './learning-event-validation';
import { requireLearningAccess } from '../release/access';
import type { LearningReleaseAccess } from '../release/access';
import { createRuntimeLearningAccess } from '../release/runtime';

export interface CanonicalUnit {id:string;editionId:string;probeProfileVersionId:string;words:number;coverage:string[];probeType?:ProbeType;}
interface ActiveAttempt {id:string;sessionId:string;unitId:string;startedAt:string;endedAt:string|null;hints:number;revealed:boolean;termination:RecallInput['termination']|null;assessment:RecallInput|null;revision:number;lastExposureAt:string|null;gapUncertain:boolean;testOpportunityId:string;evidenceClusterId:string;firstAttempt:boolean;zoneIdAtCapture:string;}
interface Checkpoint {id:string;unitId:string;phase:'training'|'recall'|'assessment'|'paused'|'ended';previousPhase:'training'|'recall'|'assessment';repetitions:number;attemptId:string|null;updatedAt:string;}
interface UnitProjection {definition:CanonicalUnit;state:UnitState;memory:FsrsState|null;dates:DueDates|null;lastExposureAt:string|null;exposureGapUncertain:boolean;schedulerStatus:'not-reviewed'|'active'|'profile-not-approved';}
export interface LearningProjection {
  userId:string|null; units:Record<string,UnitProjection>; sessions:Record<string,Checkpoint>;
  attempts:Record<string,ActiveAttempt>; assessments:Record<string,RecallAssessment>;
  mistakes:Array<{attemptId:string|null;type:string;location:string|null;certainty:string}>;
  plans:ReturnType<typeof planDay>[]; recoveries:Array<ReturnType<typeof recoveryPlan>&{costModelVersion:string;costModelValidated:false;costAssumption:string}>;
}
export type LearningCommand =
 | {type:'UnitRegistered';unit:CanonicalUnit}
 | {type:'SessionStarted';unitId:string;sessionId:string}
 | {type:'ExposureCompleted';sessionId:string;mode:'reading'|'listening'|'assisted_recall'|'unassisted_training'}
 | {type:'RepetitionCompleted';sessionId:string;mode:'reading'|'listening'|'assisted_recall'|'unassisted_training'}
 | {type:'RecallAttemptStarted';sessionId:string;attemptId:string;testOpportunityId?:string;evidenceClusterId?:string}
 | {type:'RecallAttemptRestarted';sessionId:string;attemptId:string;testOpportunityId?:string;evidenceClusterId?:string}
 | {type:'HintUsed';sessionId:string;reveal:boolean}
 | {type:'RecallAttemptCompleted';sessionId:string;termination:RecallInput['termination']}
 | {type:'AssessmentSubmitted';attemptId:string;observation:Pick<RecallInput,'attemptedWords'|'errors'|'completion'|'effort'|'gapVerified'>}
 | {type:'AssessmentCorrected';attemptId:string;expectedAssessmentRevision:number;reason:string;observation:Pick<RecallInput,'attemptedWords'|'errors'|'completion'|'effort'|'gapVerified'>}
 | {type:'SessionPaused'|'SessionResumed'|'SessionEnded';sessionId:string}
 | {type:'ProductMistakeDraftRecorded';attemptId:string|null;mistakeType:'word'|'link'|'confusion'|'unknown';location:string|null;certainty:'observed'|'suspected'|'disputed'}
 | {type:'PlanRecomputed';minutes:number;spentMinutes:number;candidates:PlanCandidate[];futureLoadFeasible:boolean}
 | {type:'RecoveryStarted';absenceDays:number;seed:number;minutes:number};
const clone=<T>(v:T):T=>structuredClone(v);
const fail=(code:string,message:string):never=>{throw new DomainError(code,message);};
function getSession(p:LearningProjection,id:string):Checkpoint {return p.sessions[id]??fail('REFERENCE_MISMATCH','الجلسة غير موجودة.');}
function getAttempt(p:LearningProjection,id:string):ActiveAttempt {return p.attempts[id]??fail('REFERENCE_MISMATCH','المحاولة غير موجودة.');}
function validId(id:unknown):asserts id is string {if(typeof id!=='string'||!id.length||id.length>200||['__proto__','constructor','prototype'].includes(id))fail('INVALID_INPUT','معرف غير صالح.');}
function buildRaw(p:LearningProjection,a:ActiveAttempt,c:Extract<LearningCommand,{type:'AssessmentSubmitted'|'AssessmentCorrected'}>):RecallInput {
  if(!a.endedAt||!a.termination) return fail('INVALID_INPUT','أكمل المحاولة قبل تقييمها.');
  const u=p.units[a.unitId].definition;
  const related=p.mistakes.filter(m=>m.attemptId===a.id);
  const observation=clone(c.observation);
  return {...observation,id:a.id,at:a.startedAt,requestedWords:u.words,hints:a.hints,revealed:a.revealed,
    termination:a.termination,source:'V1',firstAttempt:a.firstAttempt,probeType:u.probeType??'chunk',lastExposureAt:a.lastExposureAt,
    testOpportunityId:a.testOpportunityId,evidenceClusterId:a.evidenceClusterId,zoneIdAtCapture:a.zoneIdAtCapture,
    // Nullable drafts lack the full canonical mistake contract. They prevent a clean claim,
    // but cannot fabricate lexical errors. A link draft belongs to separate continuity evidence.
    suspectedMistakes:related.some(m=>m.type!=='link'),gapVerified:observation.gapVerified&&!a.gapUncertain};
}
/** Read the explicitly persisted choice without ever changing the supplied events. */
export function learningSchedulingMode(snapshot: EventSnapshot): LearningSchedulingMode {
  const first = snapshot.events.find(event => event.data.scope === 'hme');
  return first ? learningModeForVersions(first.versions) : 'legacy';
}
/** Canonical event replay. Corrections rebuild original-time reviews instead of adding a review today. */
export function replayLearning(snapshot:EventSnapshot):LearningProjection {
  const p:LearningProjection={userId:null,units:Object.create(null),sessions:Object.create(null),attempts:Object.create(null),assessments:Object.create(null),mistakes:[],plans:[],recoveries:[]};
  const scheduling = learningSchedulingMode(snapshot), versions = learningVersionsFor(scheduling);
  let previousAt=-Infinity;
  const eventIds=new Map<string,string>(),commandIds=new Map<string,string>();
  for(const e of snapshot.events) {
    if(e.data.scope!=='hme')continue;
    validateLearningEventEnvelope(e);
    const serialized=canonical(e),seen=eventIds.get(e.eventId);
    if(seen!==undefined){if(seen!==serialized)fail('EVENT_CONFLICT','معرف واقعة متعارض.');continue;}
    if(commandIds.has(e.commandId))fail('EVENT_CONFLICT','عملية تعلم مكررة في وقائع مختلفة.');
    eventIds.set(e.eventId,serialized);commandIds.set(e.commandId,serialized);
    if(canonical(e.versions)!==canonical(versions))fail('UNSUPPORTED_VERSION','لا يجوز مزج نسخ الجدولة داخل سجل تعلم واحد؛ يلزم انتقال معتمد دون تعديل الأصل.');
    try{new Intl.DateTimeFormat('en',{timeZone:e.zoneId});}catch{fail('INVALID_INPUT','منطقة التقاط غير صالحة.');}
    const at=instant(e.occurredAt); if(at<previousAt)fail('CLOCK_UNCERTAIN','تراجع الساعة؛ عُزل السجل دون كتابة.'); previousAt=at;
    if(e.type==='LearnerInitialized') {if(p.userId)fail('EVENT_CONFLICT','ملف تعلم مكرر.');if(e.source!=='product'||e.unitId!==null||e.coverage.length)fail('REFERENCE_MISMATCH','غلاف تهيئة غير متوافق.');validId(e.userId);p.userId=e.userId;continue;}
    if(!p.userId||e.userId!==p.userId)fail('REFERENCE_MISMATCH','هوية مستخدم غير متوافقة.');
    const c=e.data.command as LearningCommand;
    if(!c||c.type!==e.type)fail('INVALID_INPUT','الواقعة لا تطابق الأمر.');
    validateLearningCommand(c);
    const unitId='unitId' in c?c.unitId:'sessionId' in c?getSession(p,c.sessionId).unitId:'attemptId' in c&&c.attemptId?getAttempt(p,c.attemptId).unitId:null;
    const coverage=unitId?p.units[unitId]?.definition.coverage??fail('REFERENCE_MISMATCH','تغطية وحدة غير موجودة.'):[];
    if(e.unitId!==unitId||canonical(e.coverage)!==canonical(coverage)||e.source!==(c.type.startsWith('Assessment')?'V1':'product'))fail('REFERENCE_MISMATCH','غلاف الواقعة لا يطابق المصدر والوحدة والتغطية الفعلية.');
    switch(c.type) {
      case 'UnitRegistered': {
        const u=c.unit;validId(u.id);validId(u.editionId);validId(u.probeProfileVersionId);
        if(p.units[u.id]||!Number.isSafeInteger(u.words)||u.words<=0||!Array.isArray(u.coverage)||!u.coverage.length)fail('INVALID_INPUT','وحدة غير صالحة أو مسجلة سابقًا.');
        u.coverage.forEach(validId);
        p.units[u.id]={definition:clone(u),state:initialUnitState(u.id,false,u.probeType??'chunk'),memory:null,dates:null,lastExposureAt:null,exposureGapUncertain:false,schedulerStatus:(u.probeType??'chunk')==='chunk'?'not-reviewed':'profile-not-approved'};break;
      }
      case 'SessionStarted': {
        validId(c.sessionId);if(!p.units[c.unitId]||p.sessions[c.sessionId])fail('REFERENCE_MISMATCH','مرجع وحدة أو جلسة غير صالح.');
        if(Object.values(p.sessions).some(s=>s.phase!=='ended'))fail('REVISION_CONFLICT','أنهِ الجلسة المفتوحة أولًا.');
        p.sessions[c.sessionId]={id:c.sessionId,unitId:c.unitId,phase:'training',previousPhase:'training',repetitions:0,attemptId:null,updatedAt:e.occurredAt};
        break;
      }
      case 'ExposureCompleted': case 'RepetitionCompleted': {
        const s=getSession(p,c.sessionId);
        if(s.phase!=='training'||!['reading','listening','assisted_recall','unassisted_training'].includes(c.mode))fail('INVALID_INPUT','التعرض متاح داخل التدريب فقط.');
        if(c.type==='RepetitionCompleted')s.repetitions++;
        p.units[s.unitId].lastExposureAt=e.occurredAt;p.units[s.unitId].exposureGapUncertain=false;s.updatedAt=e.occurredAt;break;
      }
      case 'RecallAttemptStarted': case 'RecallAttemptRestarted': {
        const s=getSession(p,c.sessionId);validId(c.attemptId);
        if(c.type==='RecallAttemptRestarted') {
          if(!s.attemptId||!['recall','paused'].includes(s.phase)||(s.phase==='paused'&&s.previousPhase!=='recall'))fail('INVALID_INPUT','لا توجد محاولة منقطعة.');
          const previous=getAttempt(p,s.attemptId!);
          if(previous.assessment)fail('INVALID_INPUT','المحاولة السابقة مقيمة.');
          previous.endedAt=previous.endedAt??e.occurredAt;previous.termination=previous.termination??'user_stop';p.units[s.unitId].lastExposureAt=e.occurredAt;p.units[s.unitId].exposureGapUncertain=true;s.phase='training';
        }
        if(!['training','assessment'].includes(s.phase)||p.attempts[c.attemptId])fail('INVALID_INPUT','لا يمكن بدء المحاولة.');
        if(c.type==='RecallAttemptStarted'&&s.attemptId&&!p.attempts[s.attemptId].assessment)fail('INVALID_INPUT','المحاولة السابقة غير مقيمة.');
        const testOpportunityId=c.testOpportunityId??(c.type==='RecallAttemptRestarted'?getAttempt(p,s.attemptId!).testOpportunityId:c.attemptId);
        const evidenceClusterId=c.evidenceClusterId??(c.type==='RecallAttemptRestarted'?getAttempt(p,s.attemptId!).evidenceClusterId:c.attemptId);
        const firstAttempt=!Object.values(p.attempts).some(a=>a.unitId===s.unitId&&a.testOpportunityId===testOpportunityId);
        p.attempts[c.attemptId]={id:c.attemptId,sessionId:s.id,unitId:s.unitId,startedAt:e.occurredAt,endedAt:null,hints:0,revealed:false,termination:null,assessment:null,revision:0,lastExposureAt:p.units[s.unitId].lastExposureAt,gapUncertain:c.type==='RecallAttemptRestarted'||p.units[s.unitId].exposureGapUncertain,testOpportunityId,evidenceClusterId,firstAttempt,zoneIdAtCapture:e.zoneId};
        s.attemptId=c.attemptId;s.phase='recall';s.previousPhase='recall';s.updatedAt=e.occurredAt;break;
      }
      case 'HintUsed': {
        const s=getSession(p,c.sessionId);if(s.phase!=='recall'||!s.attemptId||typeof c.reveal!=='boolean')fail('INVALID_INPUT','لا توجد محاولة نشطة.');
        const a=getAttempt(p,s.attemptId!);a.hints++;a.revealed ||= c.reveal;p.units[s.unitId].lastExposureAt=e.occurredAt;break;
      }
      case 'RecallAttemptCompleted': {
        const s=getSession(p,c.sessionId);if(s.phase!=='recall'||!s.attemptId||!['completed','memory_failure','user_stop','technical_failure'].includes(c.termination))fail('INVALID_INPUT','نهاية المحاولة غير صالحة.');
        const a=getAttempt(p,s.attemptId!);a.endedAt=e.occurredAt;a.termination=c.termination;
        p.units[s.unitId].lastExposureAt=e.occurredAt;p.units[s.unitId].exposureGapUncertain=c.termination==='technical_failure'||c.termination==='user_stop';s.phase='assessment';s.previousPhase='assessment';s.updatedAt=e.occurredAt;break;
      }
      case 'AssessmentSubmitted': case 'AssessmentCorrected': {
        const a=getAttempt(p,c.attemptId);
        if(c.type==='AssessmentSubmitted'&&a.assessment)fail('REVISION_CONFLICT','استخدم تصحيح التقييم مع سبب.');
        if(c.type==='AssessmentCorrected'&&(!a.assessment||c.expectedAssessmentRevision!==a.revision||!c.reason?.trim()))fail('REVISION_CONFLICT','نسخة التصحيح أو سببه غير صالح.');
        const raw=buildRaw(p,a,c);assessRecall(raw);a.assessment=raw;a.revision++;break;
      }
      case 'SessionPaused': {
        const s=getSession(p,c.sessionId);if(s.phase==='ended'||s.phase==='paused')fail('INVALID_INPUT','لا يمكن إيقاف الجلسة.');
        s.previousPhase=s.phase as Checkpoint['previousPhase'];s.phase='paused';s.updatedAt=e.occurredAt;break;
      }
      case 'SessionResumed': {
        const s=getSession(p,c.sessionId);if(s.phase!=='paused')fail('INVALID_INPUT','لا توجد جلسة متوقفة.');
        if(s.previousPhase==='recall')fail('INSUFFICIENT_EVIDENCE','التسميع المنقطع يحتاج محاولة جديدة.');
        s.phase=s.previousPhase;s.updatedAt=e.occurredAt;break;
      }
      case 'SessionEnded': {
        const s=getSession(p,c.sessionId);if(s.phase==='ended')fail('INVALID_INPUT','الجلسة منتهية.');
        if(s.attemptId){const a=getAttempt(p,s.attemptId);if(!a.endedAt){a.endedAt=e.occurredAt;a.termination='user_stop';p.units[s.unitId].lastExposureAt=e.occurredAt;p.units[s.unitId].exposureGapUncertain=true;}}
        s.phase='ended';s.updatedAt=e.occurredAt;break;
      }
      case 'ProductMistakeDraftRecorded': {
        if(c.attemptId!==null)getAttempt(p,c.attemptId);
        if(!['word','link','confusion','unknown'].includes(c.mistakeType)||!['observed','suspected','disputed'].includes(c.certainty)||(c.location!==null&&typeof c.location!=='string'))fail('INVALID_INPUT','بلاغ الخطأ غير صالح.');
        p.mistakes.push({attemptId:c.attemptId,type:c.mistakeType,location:c.location,certainty:c.certainty});break;
      }
      case 'PlanRecomputed': {
        rebuildLearningState(p, scheduling);
        const candidates=c.candidates.map(candidate=>{
          const u=p.units[candidate.unitId]??fail('REFERENCE_MISMATCH','مرشح خطة لوحدة غير مسجلة.');
          if(candidate.coverageKeys&&canonical([...candidate.coverageKeys].sort())!==canonical([...u.definition.coverage].sort()))fail('REFERENCE_MISMATCH','تغطية مرشح لا تطابق الوحدة.');
          for(const field of ['rawModelDueAt','policyDueAt','originalDueAt'] as const)if(candidate[field]!==undefined&&candidate[field]!== (u.dates?.[field]??null))fail('REFERENCE_MISMATCH','لا يجوز تعديل أصل الاستحقاق عبر التخطيط.');
          if(['review','early_review'].includes(candidate.kind)&&!u.dates)fail('REFERENCE_MISMATCH','مراجعة بلا استحقاق فعلي.');
          return {...candidate,coverageKeys:clone(u.definition.coverage),...(u.dates?{rawModelDueAt:u.dates.rawModelDueAt,policyDueAt:u.dates.policyDueAt,originalDueAt:u.dates.originalDueAt}:{})};
        });
        for(const u of Object.values(p.units))if(u.dates?.policyDueAt&&instant(u.dates.policyDueAt)<=at&&!candidates.some(x=>x.unitId===u.definition.id&&x.kind!=='new'))fail('REFERENCE_MISMATCH','تجب المحافظة على المراجعة المستحقة ضمن المخطط أو المؤجل.');
        p.plans.push(planDay({...c,candidates,at:e.occurredAt}));break;
      }
      case 'RecoveryStarted': {
        rebuildLearningState(p, scheduling);
        const units=Object.values(p.units).map(u=>({id:u.definition.id,stratum: ['NeedsReinforcement','Relearning'].includes(u.state.phase)?'recent_weak' as const:u.dates?.policyDueAt&&instant(u.dates.policyDueAt)<=at?'old_due' as const:'unknown' as const,costMinutes:3}));
        p.recoveries.push({...recoveryPlan({...c,units}),costModelVersion:'recovery-fallback-3-minutes-05a',costModelValidated:false,costAssumption:'Three minutes per target is an unvalidated fallback, not measured user time.'});break;
      }
      default: fail('UNSUPPORTED_VERSION','نوع واقعة تعلم غير مدعوم.');
    }
  }
  rebuildLearningState(p, scheduling);
  return p;
}
function rebuildLearningState(p:LearningProjection, scheduling:LearningSchedulingMode):void {
  const adapter = scheduling === 'reference-06e1' ? new ReferenceFsrsAdapter() : fsrsAdapter;
  for(const u of Object.values(p.units)){u.state=initialUnitState(u.definition.id,false,u.definition.probeType??'chunk');u.memory=null;u.dates=null;u.schedulerStatus=(u.definition.probeType??'chunk')==='chunk'?'not-reviewed':'profile-not-approved';}
  p.assessments=Object.create(null);
  // Only physically completed, explicitly assessed attempts update memory, at their original occurrence time.
  const reviewKeys=new Set<string>(),clusterKeys=new Set<string>();
  const assessed=Object.values(p.attempts).filter(a=>a.assessment).sort((a,b)=>instant(a.startedAt)-instant(b.startedAt));
  for(const a of assessed) {
    const raw=clone(a.assessment!);
    if(p.mistakes.some(m=>m.attemptId===a.id&&m.type!=='link'))raw.suspectedMistakes=true;
    const u=p.units[a.unitId];
    const assessment=assessRecall(raw);if((u.definition.probeType??'chunk')!=='chunk')assessment.reasonCodes.push('FSRS_PROBE_PROFILE_NOT_APPROVED');p.assessments[a.id]=assessment;
    u.state=advanceUnit(u.state,raw);
    const schedulerKey=[p.userId,u.definition.id,u.definition.editionId,u.definition.probeProfileVersionId];
    const key=canonical([...schedulerKey,raw.testOpportunityId]),clusterKey=canonical([...schedulerKey,raw.evidenceClusterId]);
    if((u.definition.probeType??'chunk')==='chunk'&&assessment.eligible&&assessment.effectiveRating&&!reviewKeys.has(key)&&!clusterKeys.has(clusterKey)) {
      reviewKeys.add(key);clusterKeys.add(clusterKey);const review=adapter.review(u.memory,assessment.effectiveRating,raw.at);u.memory=review.state;u.schedulerStatus='active';
      u.dates=computeDueDates({at:raw.at,rawModelDueAt:review.rawDueAt,phase:u.state.phase,independentlyVerified:assessment.independentVerification,failure:assessment.strictPass===false,initialRecallOutstanding:u.state.phase==='EarlyReview'&&u.state.successfulEvidence.length<=2,delayedSuccessCount:u.state.successfulEvidence.filter(x=>x.gapVerified&&(x.gapMs??0)>=86400000).length});
    }
  }
  for(const u of Object.values(p.units)) if(u.lastExposureAt&&(!u.state.lastExposureAt||instant(u.lastExposureAt)>instant(u.state.lastExposureAt)))u.state=recordExposure(u.state,u.lastExposureAt);
}

/** Platform-independent learning service: release evidence is enforced before any learning write. */
export class LearningApplication {
  private snapshot:EventSnapshot={revision:0,events:[]};
  private projection!:LearningProjection;
  private scheduling:LearningSchedulingMode='legacy';
  private interruptedAttemptIds=new Set<string>();
  private queue:Promise<unknown>=Promise.resolve();
  private constructor(private store:EventStore,private access:LearningReleaseAccess){requireLearningAccess(access);}
  static async open(store:EventStore,options:{access?:LearningReleaseAccess;userId?:string;scheduling?:LearningSchedulingMode}={}):Promise<LearningApplication>{
    const access=options.access??await createRuntimeLearningAccess();requireLearningAccess(access);if(options.userId!==undefined)validId(options.userId);
    // An explicit choice is accepted only for a new stream, or the exact stored interpreter.
    if(options.scheduling!==undefined)learningVersionsFor(options.scheduling);
    const app=new LearningApplication(store,access);app.snapshot=await store.load();
    const existing=app.snapshot.events.some(e=>e.data.scope==='hme');
    app.scheduling=existing?learningSchedulingMode(app.snapshot):(options.scheduling??'legacy');
    if(existing&&options.scheduling!==undefined&&options.scheduling!==app.scheduling)
      fail('SCHEDULER_TRANSITION_REQUIRED','السجل يستخدم نسخة جدولة أخرى؛ لم تنفذ هجرة أو كتابة.');
    if(app.scheduling==='reference-06e1')await app.authorizeScheduler('open');
    if(app.snapshot.events.length&&!app.snapshot.events.some(e=>e.data.scope==='hme'))fail('UNSUPPORTED_VERSION','لا يجوز إضافة سجل تعلم إلى مخزن من نطاق مختلف.');
    if(!app.snapshot.events.some(e=>e.data.scope==='hme')) {
      const id=crypto.randomUUID(),at=new Date().toISOString();
      const e:LearningEvent={eventId:id,commandId:id,operationId:id,userId:options.userId??crypto.randomUUID(),unitId:null,type:'LearnerInitialized',occurredAt:at,receivedAt:at,zoneId:'Asia/Riyadh',source:'product',coverage:[],versions:app.versions,data:{scope:'hme'}};
      app.snapshot=await store.append([e],app.snapshot.revision);
    }
    app.projection=replayLearning(app.snapshot);
    if(options.userId!==undefined&&app.projection.userId!==options.userId)fail('REFERENCE_MISMATCH','هوية التعلم لا تطابق ملف المستخدم؛ يلزم نقل صريح.');
    for(const attempt of Object.values(app.projection.attempts))if(!attempt.endedAt)app.interruptedAttemptIds.add(attempt.id);
    for(const unit of Object.values(app.projection.units))await app.access.authorize({operation:'open',unit:unit.definition,versions:app.versions});
    return app;
  }
  /** Last durable plan request, for restart-safe latest-request deduplication only. */
  get lastPlanEvent():LearningEvent|null {
    for(let index=this.snapshot.events.length-1;index>=0;index--) {
      const event=this.snapshot.events[index];
      if(event.data.scope==='hme'&&event.type==='PlanRecomputed')return clone(event);
    }
    return null;
  }
  get schedulingMode():LearningSchedulingMode{return this.scheduling;}
  get versions(){return learningVersionsFor(this.scheduling);}
  private authorizeScheduler(operation:string){
    return this.access.authorize({operation:'scheduler:'+operation,versions:this.versions});
  }
  get state():LearningProjection{return clone(this.projection);}
  /** Read-only recovery state for the current attempt, including validated restores. */
  isAttemptInterrupted(attemptId:string):boolean{return this.interruptedAttemptIds.has(attemptId);}
  get revision():number{return this.snapshot.revision;}
  async refresh():Promise<LearningProjection>{
    const s=await this.store.load(),p=replayLearning(s);
    if(learningSchedulingMode(s)!==this.scheduling)fail('SCHEDULER_TRANSITION_REQUIRED','تغيرت نسخة السجل؛ أعد فتحه بعد استعادة معتمدة.');
    if(this.scheduling==='reference-06e1')await this.authorizeScheduler('refresh');
    for(const unit of Object.values(p.units))await this.access.authorize({operation:'refresh',unit:unit.definition,versions:this.versions});
    for(const attempt of Object.values(p.attempts))if(!attempt.endedAt&&!this.projection.attempts[attempt.id])this.interruptedAttemptIds.add(attempt.id);
    this.snapshot=s;this.projection=p;return this.state;
  }
  /** Reload after an already validated atomic restore/reset. This grants no write
   * capability: every send still checks release access, and imported active
   * recall is always interrupted. Data recovery must not lie about commit if
   * release evidence expires immediately after the atomic replacement. */
  async reloadDataProjection():Promise<LearningProjection>{
    const snapshot=await this.store.load(),projection=replayLearning(snapshot);
    this.interruptedAttemptIds.clear();
    for(const attempt of Object.values(projection.attempts))if(!attempt.endedAt)this.interruptedAttemptIds.add(attempt.id);
    this.scheduling=learningSchedulingMode(snapshot);this.snapshot=snapshot;this.projection=projection;return this.state;
  }
  send(command:LearningCommand,options:{commandId?:string;at?:string;expectedRevision?:number}={}):Promise<LearningProjection>{
    try{validateLearningCommand(command);command=clone(command);options=clone(options);}catch(error){return Promise.reject(error);}
    const run=async()=>{
      await this.access.authorize({operation:command.type,versions:this.versions});
      const commandId=options.commandId??crypto.randomUUID();
      const old=this.snapshot.events.find(e=>e.commandId===commandId);
      if(old){if(canonical(old.data.command)!==canonical(command))fail('EVENT_CONFLICT','عملية مكررة بمحتوى مختلف.');return this.state;}
      if(options.expectedRevision!==undefined&&options.expectedRevision!==this.snapshot.revision)fail('REVISION_CONFLICT','تغيّرت البيانات.');
      if(command.type==='UnitRegistered')await this.access.authorize({operation:command.type,unit:command.unit});
      if(command.type==='RecallAttemptCompleted') {
        const session=this.projection.sessions[command.sessionId];
        if(session?.attemptId&&this.interruptedAttemptIds.has(session.attemptId)&&command.termination==='completed')fail('INSUFFICIENT_EVIDENCE','التسميع المنقطع يحتاج محاولة جديدة؛ لا يمكن افتراض إتمامه.');
      }
      const at=options.at??new Date().toISOString();instant(at);
      const unitId='unitId' in command?command.unitId:'sessionId' in command?this.projection.sessions[command.sessionId]?.unitId??null:'attemptId' in command&&command.attemptId?this.projection.attempts[command.attemptId]?.unitId??null:null;
      if(unitId&&this.projection.units[unitId])await this.access.authorize({operation:command.type,unit:this.projection.units[unitId].definition});
      const e:LearningEvent={eventId:crypto.randomUUID(),commandId,operationId:commandId,userId:this.projection.userId!,unitId,type:command.type,occurredAt:at,receivedAt:new Date().toISOString(),zoneId:'Asia/Riyadh',source:command.type.startsWith('Assessment')?'V1':'product',coverage:unitId?this.projection.units[unitId]?.definition.coverage??[]:[],versions:this.versions,data:{scope:'hme',command:clone(command)}};
      const candidate={revision:this.snapshot.revision+1,events:[...this.snapshot.events,e]};const projected=replayLearning(candidate);
      const committed=await this.store.append([e],this.snapshot.revision);this.snapshot=committed;this.projection=projected;return this.state;
    };
    const pending=this.queue.then(run,run);this.queue=pending.catch(()=>undefined);return pending;
  }
}
