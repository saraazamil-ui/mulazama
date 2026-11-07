import { projectProgress } from "../progress/projection";
import type { Action } from '../domain/state';
import { initialState, transition, effectiveBudget, currentRiyadhDate, validateConfig } from '../domain/state';
import type { PrototypeState, ContractId, ContractRequestMap, ContractResponseMap, Result, QueryMeta } from '../domain/contracts';
import { VERSIONS, DomainError, canonical } from '../core/types';
import type { EventStore, EventSnapshot, LearningEvent } from '../core/types';
import { IndexedDbEventStore } from '../persistence/event-store';
import { exportEncryptedBackup, inspectEncryptedBackup, restoreEncryptedBackup } from '../persistence/backup';
import { validateProductAction, validateViewQuery } from './validation';
import { validateProductReplaySnapshot } from './product-replay-validation';
import { createRuntimeLearningAccess,runtimeDatabaseName } from '../release/runtime';
import type { LearningReleaseAccess } from '../release/access';

const TYPE: Record<Action['type'], string> = {
  config:'UserPlanConfigRevised', 'plan.todayBudget':'PlanRecomputed',
  'range.add':'PriorKnowledgeDeclared', 'range.remove':'PriorKnowledgeDeclarationRemoved',
  'session.start':'SessionStarted', 'session.pause':'SessionPaused', 'session.resume':'SessionResumed',
  'session.end':'SessionEnded', 'session.repeat':'RepetitionCompleted', 'session.startRecall':'RecallAttemptStarted',
  'session.restartRecall':'RecallAttemptRestarted', 'session.finishedBeforeStop':'CompletionReportedAfterInterruption',
  'attempt.hint':'HintUsed', 'attempt.reveal':'HintUsed', 'attempt.finish':'RecallAttemptCompleted',
  'attempt.assess':'AssessmentSubmitted', 'attempt.correct':'AssessmentCorrected',
  'mistake.add':'ProductMistakeDraftRecorded', 'mistake.correct':'MistakeCorrected',
  preferences:'PreferencesRevised', 'recovery.report':'ExternalMaintenanceReported', reset:'LearningDataReset',
};
const copy = <T>(value:T):T => structuredClone(value);
const uuid = () => crypto.randomUUID();
function envelope(type:string, commandId:string, userId:string, data:Record<string,unknown>, at:string):LearningEvent {
  return {eventId:uuid(),commandId,operationId:commandId,userId,unitId:null,type,occurredAt:at,receivedAt:at,zoneId:'Asia/Riyadh',source:'product',coverage:[],versions:VERSIONS,data};
}
/** Rebuild the product projection from facts; generated IDs are recorded as command evidence. */
export function replayProduct(snapshot:EventSnapshot):PrototypeState {
  validateProductReplaySnapshot(snapshot);
  let state:PrototypeState|null = null;
  for(const event of snapshot.events) {
    if(canonical(event.versions)!==canonical(VERSIONS)) throw new DomainError('UNSUPPORTED_VERSION','نسخة سجل الأحداث غير مدعومة؛ لم تُغيّر البيانات.');
    if(event.data.scope !== 'product') throw new DomainError('UNSUPPORTED_VERSION','سجل غير مدعوم في نسخة الواجهة الحالية.');
    if(event.type === 'ProfileInitialized') {
      if(state) throw new DomainError('EVENT_CONFLICT','يوجد أكثر من ملف مستخدم في سجل واحد.');
      state=initialState(()=>event.userId);
      if(event.data.config) {
        const config=event.data.config as PrototypeState['config'];
        if(validateConfig(config)) throw new DomainError('INVALID_INPUT','إعدادات النسخة غير صالحة.');
        state.config=copy(config);
      }
      if(event.data.preferences) {
        const preferences=event.data.preferences as PrototypeState['preferences'];
        if(Object.keys(preferences).sort().join(',')!=='dark,largeText,reducedMotion,reminder'||Object.values(preferences).some(v=>typeof v!=='boolean')) throw new DomainError('INVALID_INPUT','تفضيلات النسخة غير صالحة.');
        state.preferences=copy(preferences);
      }
      continue;
    }
    if(!state || state.profileId!==event.userId) throw new DomainError('REFERENCE_MISMATCH','مرجع المستخدم في السجل غير صالح.');
    const action=copy(event.data.action as Action);
    validateProductAction(action);
    if(!action || TYPE[action.type]!==event.type) throw new DomainError('INVALID_INPUT','نوع الواقعة لا يطابق الأمر.');
    if(action.type.startsWith('session.') || action.type.startsWith('attempt.')) throw new DomainError('CONTENT_UNAVAILABLE','سجل جلسة واجهة دون محتوى معتمد غير مقبول.');
    const ids=event.data.generatedIds as string[];
    if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string')) throw new DomainError('INVALID_INPUT','معرفات الأمر غير صالحة.');
    let cursor=0;
    const result=transition(state,{...action,commandId:event.commandId,expectedRevision:state.revision,now:event.occurredAt},()=>{
      const id=ids[cursor++]; if(!id) throw new DomainError('EVENT_CONFLICT','معرف واقعة مفقود.'); return id;
    });
    if(!result.ok || cursor!==ids.length) throw new DomainError('INVALID_INPUT',result.ok?'معرفات زائدة.':result.error);
    state=result.state;
  }
  if(!state) throw new DomainError('INVALID_INPUT','السجل لا يحتوي ملف مستخدم صالحًا.');
  return state;
}

/** Production web boundary: no LocalStorage, no mock fixtures, acknowledgement after commit only. */
export class ApplicationService {
  private snapshot:EventSnapshot={revision:0,events:[]};
  private current!:PrototypeState;
  private queue:Promise<unknown>=Promise.resolve();
  get releaseGates(){return this.access.summary();}
  private constructor(private readonly store:EventStore,private readonly access:LearningReleaseAccess) {}
  static async open(store?:EventStore):Promise<ApplicationService> {
    const service=new ApplicationService(store??await IndexedDbEventStore.open(runtimeDatabaseName()),await createRuntimeLearningAccess());
    let snapshot=await service.store.load();
    if(!snapshot.events.length) {
      const profile=uuid(), command=uuid();
      try { snapshot=await service.store.append([envelope('ProfileInitialized',command,profile,{scope:'product'},new Date().toISOString())],snapshot.revision); }
      catch(error) {
        if(!(error instanceof DomainError)||error.code!=='REVISION_CONFLICT') throw error;
        snapshot=await service.store.load();
      }
    }
    service.accept(snapshot);
    return service;
  }
  private accept(snapshot:EventSnapshot):void { const state=replayProduct(snapshot); this.snapshot=snapshot; this.current=state; }
  get state():PrototypeState { return copy(this.current); }
  get revision():number { return this.snapshot.revision; }
  get eventCount():number { return this.snapshot.events.length; }
  /** Read-only progress from the last committed event snapshot. */
  readProgress(now = new Date()) { return projectProgress(this.snapshot, now); }
  /** Background observation never replaces the service snapshot or command state. */
  async readProgressFresh(now?: Date) {
    const snapshot = await this.store.load();
    return projectProgress(snapshot, now ?? new Date());
  }
  refresh():Promise<PrototypeState> {
    // Refresh participates in the same queue as writes, so a slow load cannot
    // replace a newer committed projection after restore or a tab refresh.
    const run=async()=>{this.accept(await this.store.load());return this.state;};
    const pending=this.queue.then(run,run);this.queue=pending.catch(()=>undefined);return pending;
  }
  dispatch(action:Action):Promise<PrototypeState> {
    validateProductAction(action);
    // Optional form fields are omitted from the wire JSON; undefined is never persisted.
    action=JSON.parse(JSON.stringify(action)) as Action;
    const execute=()=>this.perform(action);
    const pending=this.queue.then(execute,execute); this.queue=pending.catch(()=>undefined); return pending;
  }
  private async perform(action:Action):Promise<PrototypeState> {
    if(action.type.startsWith('session.')||action.type.startsWith('attempt.')){
      await this.access.authorize({operation:action.type});
      throw new DomainError('CONTRACT_NOT_IMPLEMENTED','لم يعتمد ربط واجهة الجلسة بخدمة التعلم بعد.');
    }
    const commandId=action.commandId??uuid();
    const {commandId:_command, expectedRevision:_revision, now:_now, ...payload}=action;
    const previous=this.snapshot.events.find(e=>e.commandId===commandId);
    if(previous) {
      if(canonical(previous.data.action)!==canonical(payload)) throw new DomainError('EVENT_CONFLICT','استُخدم معرف العملية بمحتوى مختلف.');
      return this.state;
    }
    if(action.expectedRevision!==undefined&&action.expectedRevision!==this.current.revision) throw new DomainError('REVISION_CONFLICT','تغيّرت البيانات. أعد تحميل الحالة ثم حاول.');
    const generatedIds:string[]=[];
    const at=action.now??new Date().toISOString();
    const result=transition(this.current,{...payload,commandId,now:at},prefix=>{const id=(prefix??'id')+'-'+uuid();generatedIds.push(id);return id;});
    if(!result.ok) throw new DomainError('INVALID_INPUT',result.error);
    if(action.type==='reset') {
      // Atomic replacement removes personal raw history and internal rollback data, retaining current preferences only.
      const init=envelope('ProfileInitialized',commandId,result.state.profileId,{scope:'product',config:result.state.config,preferences:result.state.preferences},at);
      this.accept(await this.store.replace([init],this.snapshot.revision));
    } else {
      const event=envelope(TYPE[action.type],commandId,this.current.profileId,{scope:'product',action:payload,generatedIds},at);
      // Validate the exact future stream BEFORE mutation; I/O failure never advances the displayed state.
      replayProduct({revision:this.snapshot.revision+1,events:[...this.snapshot.events,event]});
      this.accept(await this.store.append([event],this.snapshot.revision));
    }
    return this.state;
  }
  async exportBackup(password:string):Promise<string> { if(this.store.backupScope==='aggregate-only')throw new DomainError('AGGREGATE_BACKUP_REQUIRED','تصدير سجل منفرد قد يفقد وقائع التعلم؛ استخدم النسخة الموحدة.');return exportEncryptedBackup(this.snapshot,password); }
  async inspectBackup(serialized:string,password:string):Promise<{compatible:boolean;reason:string;eventCount:number}> {
    try {
      if(this.store.backupScope==='aggregate-only')throw new DomainError('AGGREGATE_BACKUP_REQUIRED','افحص النسخة الموحدة عبر خدمة إدارة البيانات.');
      const result=await inspectEncryptedBackup(serialized,password,replayProduct);
      return {compatible:true,reason:'نسخة مشفرة متوافقة؛ الاستعادة استبدال كامل بعد التأكيد.',eventCount:result.eventCount};
    } catch(error) { return {compatible:false,reason:error instanceof Error?error.message:'تعذر فحص النسخة.',eventCount:0}; }
  }
  async replaceFromBackup(serialized:string,password:string,confirmed:boolean):Promise<PrototypeState> {
    if(this.store.backupScope==='aggregate-only')throw new DomainError('AGGREGATE_BACKUP_REQUIRED','استعادة سجل منفرد محجوبة؛ استخدم النسخة الموحدة.');
    if(!confirmed) throw new DomainError('CONSENT_REQUIRED','يلزم تأكيد الاستبدال الكامل.');
    const run=async()=>{
      const snapshot=await restoreEncryptedBackup(this.store,serialized,password,{confirmed:true,expectedRevision:this.snapshot.revision,validateReplay:replayProduct});
      this.accept(snapshot); return this.state;
    };
    const result=this.queue.then(run,run); this.queue=result.catch(()=>undefined); return result;
  }
  close():void {this.store.close();}
  query<K extends ContractId>(id:K,input:ContractRequestMap[K]):Result<ContractResponseMap[K]> {
    try { validateViewQuery(id,input); }
    catch(error) { return {ok:false,error:{code:'INVALID_INPUT',scope:id,retryable:false,message:error instanceof Error?error.message:'مدخل غير صالح.',action:'صحح بيانات الطلب.'}}; }
    const state=this.current;
    const meta:QueryMeta={asOf:new Date().toISOString(),projectionVersion:'05B-product-1',sourceWatermark:this.snapshot.revision,source:'event-store',learningEvidence:false,versions:{prototype:'05-B',algorithmVersion:VERSIONS.algorithm,policyVersion:VERSIONS.policy,rubricVersion:VERSIONS.rubric,methodVersion:'hybrid-P0-1',editionId:'prototype-unverified',tokenizationVersion:null}};
    const missing={value:null,status:'not_measured',reason:'لم يختبر هذا النطاق بمحتوى معتمد.',evidenceIds:[]};
    const unavailable='لا تتوفر حزمة قرآن معتمدة؛ لم تُنشأ مهام أو أدلة تعلم افتراضية.';
    let value:unknown;
    switch(id) {
      case 'C01': value={meta,status:'unavailable',editionId:'prototype-unverified',quranText:null,pageMap:null,source:null,license:null,hash:null,reason:unavailable}; break;
      case 'C02':
        if((input as ContractRequestMap['C02']).operation==='save') return {ok:false,error:{code:'INVALID_INPUT',scope:id,retryable:false,message:'الحفظ أمر مستقل عن الاستعلام.',action:'استخدم أمر حفظ الإعداد.'}};
        value={meta,config:copy(state.config)};break;
      case 'C03': value={meta,reason:(input as ContractRequestMap['C03']).operation,sample:[],untested:copy(state.ranges),source:'event-store',outsideReview:state.recoveryReport};break;
      case 'C04': value={meta,revision:this.snapshot.revision,tasks:[],deferred:[],capacityStatus:'uncertain',reason:unavailable+' الوقت المتاح: '+effectiveBudget(state,(input as ContractRequestMap['C04']).localDate??currentRiyadhDate())+' دقيقة.',plannedMinutes:0};break;
      case 'C05': value={meta,checkpoint:null};break;
      case 'C06': value={meta,confirmedRepetitions:0,mastery:null};break;
      case 'C07': return {ok:false,error:{code:'CONTENT_UNAVAILABLE',scope:id,retryable:false,message:unavailable,action:'اعتماد المحتوى قبل تفعيل الجلسات.'}};
      case 'C08': value={meta,drafts:copy(state.mistakes.filter(m=>!(input as ContractRequestMap['C08']).attemptId||m.attemptId===(input as ContractRequestMap['C08']).attemptId))};break;
      case 'C09': value={meta,declaredRanges:copy(state.ranges),acquired:missing,stable:missing,links:missing,globalCoverage:missing,attemptCount:0,source:'V1',parts:Array.from({length:30},(_,i)=>({juz:i+1,status:state.ranges.some(r=>r.kind==='juz'&&r.start<=i+1&&r.end>=i+1)?'declared_unassessed':'not_measured',label:'معلن غير مختبر أو غير مقاس؛ لا يعمم التشخيص.'}))};break;
      case 'C10': value={meta,status:'insufficient_data',reason:'لا تتوفر بيانات كافية لتقدير التقدم المتوقع بصورة موثوقة',horizons:{1:null,3:null,6:null,12:null},initialCompletionDate:null,previewMinutes:(input as ContractRequestMap['C10']).minutes??state.config.minutes,changesPlan:false};break;
      case 'C11': value={meta,preferences:copy(state.preferences),engineAvailable:false,migrationAvailable:false,releaseGates:this.releaseGates};break;
      case 'C12': value={compatible:false,encrypted:true,productionBackup:false,state:null,reason:'فحص النسخة المشفرة يتطلب كلمة الاستعادة. استخدم خدمة الفحص غير المتزامنة.'};break;
      case 'C13': value={meta,permission:'not_requested',scheduled:false,candidates:[],reason:'الإشعارات النظامية غير مفعّلة؛ لا تعمل جدولة مؤجلة مضمونة من صفحة ويب مغلقة.'};break;
      case 'C14': value={meta,available:false,recordingRef:null,microphoneRequested:false,reason:'لا صوت مرجعي معتمد ولا تسجيل مفعّل؛ لم يطلب إذن الميكروفون.'};break;
      default: throw new DomainError('INVALID_INPUT','عقد غير معروف.');
    }
    return {ok:true,value:value as ContractResponseMap[K]};
  }
}
