import { canonical, DomainError, learningVersionsFor, type LearningSchedulingMode } from '../core/types';
import { learningSchedulingMode } from './learning';
import type { LearningReleaseAccess } from '../release/access';
import { requireLearningAccess } from '../release/access';
import { requireJourneyMaterial, type JourneyMaterial, type JourneyUnit } from '../content/journey-material06l3';
import { CompositeApplication } from './composite-application';
import type { RangeSelection } from '../domain/contracts';
import { currentRiyadhDate, effectiveBudget } from '../domain/state';
import { contentHash } from '../content/content-gate';
import type { PlanCandidate } from '../core/hme-types';
import type { ManualObservation, LearningUiAction } from './learning-ui-adapter';
import type { EventStore } from '../core/types';
const inside=(entry:JourneyUnit,range:RangeSelection)=>entry.positions.every(p=>range.kind==='surah'?p.surah>=range.start&&p.surah<=range.end:range.kind==='ayah'?p.surah===range.surah&&p.ayah>=range.start&&p.ayah<=range.end:range.kind==='page'?p.page>=range.start&&p.page<=range.end:p.juz>=range.start&&p.juz<=range.end);
export type QuickObservation='clean-hard'|'clean-normal'|'clean-easy'|'memory-failure'|'unknown';
/** One owner of the existing application services. No event stream or mastery formula is duplicated. */
export class LearningJourney {
  private sequence:Promise<unknown>=Promise.resolve();
  private pending=new Map<string,string>();
  private pausedAttemptId:string|null=null;
  private entries:readonly JourneyUnit[];
  private targetUnitIds:string[]|null=null;
  private targetProfileId:string|null=null;
  private constructor(readonly app:CompositeApplication,private material:JourneyMaterial,private access:LearningReleaseAccess,private clock:()=>Date){this.entries=material.units;}
  static async open(store:EventStore,material:JourneyMaterial,access:LearningReleaseAccess,options:{scheduling?:LearningSchedulingMode;clock?:()=>Date}={}){
    requireJourneyMaterial(material);requireLearningAccess(access);
    // Verify before Composite initializes either domain. Empty/blocked data never gains HME events.
    const snapshot=await store.load(),existing=snapshot.events.some(e=>e.data.scope==='hme');
    const scheduling=existing?learningSchedulingMode(snapshot):(options.scheduling??'legacy');
    if(existing&&options.scheduling&&options.scheduling!==scheduling)throw new DomainError('SCHEDULER_TRANSITION_REQUIRED','السجل يحتفظ بنسخة جدوله الأصلية؛ يلزم انتقال معتمد قبل تغييرها.');
    await access.authorize({operation:'open-journey',versions:learningVersionsFor(scheduling)});
    for(const entry of material.units)await access.authorize({operation:'catalog',unit:entry.unit});
    const app=await CompositeApplication.open(store,{access,scheduling:options.scheduling});
    return new LearningJourney(app,material,access,options.clock??(()=>new Date()));
  }
  get kind(){return this.material.kind;}
  /** Detached catalogue metadata; reader preferences never install content or units. */
  get catalogUnits():readonly JourneyUnit[]{return structuredClone(this.entries);}
  get memorizationTarget():readonly string[]|null{return this.targetProfileId===this.app.product.state.profileId?this.targetUnitIds?.slice()??null:null;}
  /** Selection expresses intent only. Registration, planning and assessment keep their existing authorized commands. */
  setMemorizationTarget(unitIds:readonly string[]|null){
    if(unitIds===null){this.targetUnitIds=null;this.targetProfileId=null;return;}
    if(!Array.isArray(unitIds)||!unitIds.length||new Set(unitIds).size!==unitIds.length||unitIds.some(id=>typeof id!=='string'||!this.entries.some(entry=>entry.unit.id===id)))throw new DomainError('REFERENCE_MISMATCH','المقدار لا يطابق وحدات الحزمة المعتمدة.');
    const selected=new Set(unitIds),entries=this.entries.filter(entry=>selected.has(entry.unit.id));
    if(new Set(entries.map(entry=>entry.unit.editionId)).size!==1)throw new DomainError('REFERENCE_MISMATCH','لا يمكن جمع طبعات مختلفة في مقدار واحد.');
    this.targetUnitIds=entries.map(entry=>entry.unit.id);
    this.targetProfileId=this.app.product.state.profileId;
  }
  get state(){return this.app.learning.state;}
  get needsRestart(){const id=this.active?.attemptId;return !!id&&(id===this.pausedAttemptId||this.app.learning.isAttemptInterrupted(id));}
  get active(){return Object.values(this.state.sessions).find(s=>s.phase!=='ended')??null;}
  unit(id:string){const entry=this.entries.find(u=>u.unit.id===id);if(!entry)throw new DomainError('CONTENT_UNAVAILABLE','الوحدة غير متاحة في الحزمة.');return entry;}
  private async check(unitId?:string){await this.access.authorize({operation:'journey',versions:this.app.learning.versions,...(unitId?{unit:this.unit(unitId).unit}:{})});}
  private serialize<T>(action:()=>Promise<T>){const result=this.sequence.then(action,action);this.sequence=result.catch(()=>undefined);return result;}
  private at(){return this.clock().toISOString();}
  private budget(day:string){const p=this.app.product.state;return p.todayBudget?.localDate===day||p.config.days.includes(new Date(day+'T12:00:00Z').getUTCDay())?effectiveBudget(p,day):0;}
  private async command(action:LearningUiAction,key:string){
    await this.check();let id=this.pending.get(key);if(!id){id=crypto.randomUUID();this.pending.set(key,id);}
    // Retain the ID if commit succeeded but acknowledgement was lost.
    const result=await this.app.adapter.send(action,{commandId:id,at:this.at()});this.pending.delete(key);return result;
  }
  private eligible(){const product=this.app.product.state;return this.entries.filter(entry=>product.ranges.some(r=>inside(entry,r)));}
  private async register(entry:JourneyUnit){if(this.state.units[entry.unit.id])return;await this.app.adapter.register(entry.unit,{commandId:'unit:'+await contentHash(canonical(entry.unit)),at:this.at()});}
  async prepare(){return this.serialize(async()=>{
    await this.check();await this.app.refresh();const product=this.app.product.state;
    if(!product.config.configured)return this.view();
    const prior=this.eligible(),target=this.memorizationTarget,targetIds=target?new Set(target):null;
    // Resolve declarations without eagerly appending thousands of units or replays.
    // Only today's bounded candidates are registered; declaration and full history remain intact.
    let candidateBudget=this.budget(currentRiyadhDate(this.clock()));
    for(const entry of prior)if(this.state.units[entry.unit.id]&&!this.state.units[entry.unit.id].memory)candidateBudget-=entry.costMinutes;
    for(const entry of prior)if(!this.state.units[entry.unit.id]&&entry.costMinutes<=candidateBudget){await this.register(entry);candidateBudget-=entry.costMinutes;}
    // Preserve all registered history when the declared range or goal changes.
    if(targetIds){
      // Explicit reader intent does not rewrite a review-only goal or declare prior memorization.
      // Register a bounded set; the existing planner still protects due/repair work and applies capacity.
      let targetBudget=this.budget(currentRiyadhDate(this.clock()));
      const targets=this.entries.filter(entry=>targetIds.has(entry.unit.id));
      for(const entry of targets)if(this.state.units[entry.unit.id]&&!this.state.units[entry.unit.id].memory)targetBudget-=entry.costMinutes;
      for(const entry of targets)if(!this.state.units[entry.unit.id]&&entry.costMinutes<=targetBudget){await this.register(entry);targetBudget-=entry.costMinutes;}
    }else if(product.config.goal==='memorize'){
      const next=this.entries.find(entry=>entry.positions[0].surah>=product.config.startSurah&&!prior.some(p=>p.unit.id===entry.unit.id)&&!['EarlyReview','Consolidating','Maintenance'].includes(this.state.units[entry.unit.id]?.state.phase??'NotStarted'));
      if(next)await this.register(next);
    }
    const now=this.at(),day=currentRiyadhDate(new Date(now)),p=this.state,priorIds=new Set(prior.map(x=>x.unit.id));
    const candidates:PlanCandidate[]=Object.values(p.units).flatMap(u=>{
      const entry=this.unit(u.definition.id),due=!!u.dates?.policyDueAt&&Date.parse(u.dates.policyDueAt)<=Date.parse(now),weak=['NeedsReinforcement','Relearning'].includes(u.state.phase);
      if(u.memory&&!due&&!weak)return [];
      if(!u.memory&&!priorIds.has(u.definition.id)&&(targetIds?!targetIds.has(u.definition.id):product.config.goal!=='memorize'||entry.positions[0].surah<product.config.startSurah))return [];
      const kind=weak?'repair':due?'review':priorIds.has(u.definition.id)?'diagnostic':'new';
      return [{id:`day:${day}:${u.definition.id}:${due?u.dates!.policyDueAt:'initial'}`,unitId:u.definition.id,kind,costMinutes:entry.costMinutes,priority:weak?100:due?90:kind==='diagnostic'?70:50,protected:due||weak,coverageKeys:u.definition.coverage,title:entry.title,reasonCode:'COST_ESTIMATE:'+this.material.policy.version,...(u.dates?{rawModelDueAt:u.dates.rawModelDueAt,policyDueAt:u.dates.policyDueAt,originalDueAt:u.dates.originalDueAt}:{})}];
    });
    const completedSessions=Object.values(p.sessions).filter(session=>Object.values(p.attempts).some(a=>a.sessionId===session.id&&a.assessment&&a.termination!=='technical_failure'&&a.termination!=='user_stop'&&currentRiyadhDate(new Date(a.startedAt))===day));
    const spentMinutes=completedSessions.reduce((sum,session)=>sum+this.unit(session.unitId).costMinutes,0);
    const plan={type:'PlanRecomputed' as const,minutes:this.budget(day),spentMinutes,candidates,futureLoadFeasible:this.material.policy.futureLoadFeasible};
    // Exactly reproducible plan request; unchanged reloads do not append another plan event.
    const last=this.app.learning.lastPlanEvent;
    if(last&&currentRiyadhDate(new Date(last.occurredAt))===day&&canonical(last.data.command)===canonical(plan))return this.view();
    const commandId='plan:'+await contentHash(canonical({day,previousPlan:last?.eventId??null,plan}));
    await this.app.sendLearning(plan,{commandId,at:now,expectedRevision:this.app.learning.revision});
    return this.view();
  });}
  view(){
    const p=this.state,day=currentRiyadhDate(this.clock());const completed=Object.values(p.sessions).filter(s=>Object.values(p.attempts).some(a=>a.sessionId===s.id&&a.endedAt&&a.assessment&&a.termination!=='technical_failure'&&a.termination!=='user_stop'&&currentRiyadhDate(new Date(a.startedAt))===day));
    const completedUnitIds=new Set(completed.map(s=>s.unitId));const plan=p.plans.at(-1);
    const remaining=plan?.tasks.filter(t=>!completedUnitIds.has(t.unitId)||(p.units[t.unitId].dates?.policyDueAt&&Date.parse(p.units[t.unitId].dates!.policyDueAt!)<=this.clock().getTime()))??[];
    const due=Object.values(p.units).filter(u=>u.dates?.policyDueAt).map(u=>({unitId:u.definition.id,at:u.dates!.policyDueAt!})).sort((a,b)=>a.at.localeCompare(b.at));
    const assessed=Object.values(p.attempts).filter(a=>a.assessment);
    const latest=new Map<string,boolean|null>();for(const a of [...assessed].sort((a,b)=>Date.parse(a.startedAt)-Date.parse(b.startedAt)))latest.set(a.unitId,p.assessments[a.id]?.strictPass??null);
    const successful=new Set(assessed.filter(a=>p.assessments[a.id]?.strictPass===true).flatMap(a=>p.units[a.unitId].definition.coverage));
    return {day,active:this.active,next:remaining[0]??null,completed:completed.length,remaining:remaining.length,deferred:plan?.deferred.length??0,due,observations:assessed.length,successfulCoverage:successful.size,weak:Object.values(p.units).filter(u=>latest.get(u.definition.id)===false||['NeedsReinforcement','Relearning'].includes(u.state.phase)).map(u=>this.unit(u.definition.id).title),budget:this.budget(day),requiresPlan:this.app.product.state.config.configured&&!plan};
  }
  async start(){await this.prepare();return this.serialize(async()=>{
    await this.check();await this.app.refresh();if(this.active)return this.active;
    const next=this.view().next;if(!next)throw new DomainError('INVALID_INPUT','لا نشاط متاح ضمن وقت اليوم.');
    await this.check(next.unitId);const priorSessions=Object.values(this.state.sessions).filter(s=>s.unitId===next.unitId).length;
    const sessionId='journey:'+await contentHash(next.id+':'+priorSessions);
    await this.command({type:'start',unitId:next.unitId,sessionId},'start:'+sessionId);return this.active;
  });}
  action(action:LearningUiAction){return this.serialize(async()=>{const state=await this.command(action,canonical(action));if(action.type==='pause'&&this.active?.previousPhase==='recall')this.pausedAttemptId=this.active.attemptId??null;if(action.type==='restart')this.pausedAttemptId=null;return state;});}
  quick(choice:QuickObservation){return this.serialize(async()=>{
    const session=this.active;if(!session?.attemptId)throw new DomainError('INVALID_INPUT','لا تسميع جارٍ.');
    if(this.needsRestart)throw new DomainError('INSUFFICIENT_EVIDENCE','ابدأ محاولة جديدة بعد الانقطاع.');
    const attempt=this.state.attempts[session.attemptId],words=this.unit(session.unitId).unit.words;
    const observation:ManualObservation={attemptedWords:choice.startsWith('clean-')?words:null,errors:choice.startsWith('clean-')?0:null,completion:choice.startsWith('clean-')?'complete':choice==='memory-failure'?'partial':'unknown',effort:choice==='clean-hard'?'hard':choice==='clean-normal'?'normal':choice==='clean-easy'?'easy':'unknown',gapVerified:false};
    // Every field below is explicitly expressed by the selected label; no default zero or rating input.
    if(!attempt.endedAt)await this.command({type:'complete',sessionId:session.id,termination:choice==='memory-failure'?'memory_failure':'completed'},'complete:'+attempt.id);
    if(!this.state.attempts[attempt.id].assessment)await this.command({type:'assess',attemptId:attempt.id,observation},'assess:'+attempt.id+':'+choice);
    return this.state;
  });}
  finish(){return this.serialize(async()=>{const session=this.active;if(session)await this.command({type:'end',sessionId:session.id},'end:'+session.id);});}
  async text(unitId:string){await this.check(unitId);return this.unit(unitId).passages;}
  async refresh(){await this.app.refresh();return this.view();}
}
