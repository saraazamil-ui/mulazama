// @vitest-environment node
// No Quran text: generated identifiers/coverage and declared synthetic time costs only.
import { describe, it, expect } from 'vitest';
import { LearningApplication, replayLearning } from './learning';
import type { CanonicalUnit, LearningCommand } from './learning';
import { connectedStatus, countUniqueTokens } from '../core/hme';
import { MemoryEventStore } from '../persistence/event-store';
import { createSyntheticLearningAccess } from '../testing/learning-access';

const clean={attemptedWords:100,errors:0,completion:'complete' as const,effort:'normal' as const,gapVerified:true};
const unit=(id:string,start:number,probeType:CanonicalUnit['probeType']='chunk'):CanonicalUnit=>({id,editionId:'synthetic-test-only',probeProfileVersionId:`synthetic-${probeType}-P0`,probeType,words:100,coverage:[`synthetic:${start}:${start+100}`]});
async function harness(units:CanonicalUnit[]){
 const store=new MemoryEventStore(),access=await createSyntheticLearningAccess(units);let app=await LearningApplication.open(store,{access}),clock=Date.now()+1000;
 const send=(c:LearningCommand,elapsed=1000)=>app.send(c,{at:new Date(clock+=elapsed).toISOString()});
 for(const unit of units)await send({type:'UnitRegistered',unit});
 return {store,send,get app(){return app;},get at(){return new Date(clock).toISOString();},async reopen(){app=await LearningApplication.open(store,{access});}};
}
async function assess(s:Awaited<ReturnType<typeof harness>>,unitId:string,id:string,errors=0){
 await s.send({type:'SessionStarted',unitId,sessionId:`session-${id}`});
 await s.send({type:'RecallAttemptStarted',sessionId:`session-${id}`,attemptId:id});
 await s.send({type:'RecallAttemptCompleted',sessionId:`session-${id}`,termination:'completed'});
 await s.send({type:'AssessmentSubmitted',attemptId:id,observation:{...clean,errors}});
 await s.send({type:'SessionEnded',sessionId:`session-${id}`});
}

describe('05B five connected HME scenarios on synthetic application data',()=>{
 it('HI01 training, assessment, close, next-day due plan and actual review replay once',async()=>{
  const u=unit('synthetic-new',0),s=await harness([u]);
  await s.send({type:'SessionStarted',unitId:u.id,sessionId:'training'});
  for(let n=0;n<2;n++)await s.send({type:'RepetitionCompleted',sessionId:'training',mode:'reading'});
  expect(s.app.state.units[u.id].memory).toBeNull();await s.send({type:'SessionEnded',sessionId:'training'});
  await assess(s,u.id,'first');await assess(s,u.id,'second');
  expect(s.app.state.units[u.id].state.phase).toBe('EarlyReview');
  const due=s.app.state.units[u.id].dates!,memory=s.app.state.units[u.id].memory;
  await s.reopen();await s.send({type:'PlanRecomputed',minutes:30,spentMinutes:0,futureLoadFeasible:false,candidates:[{id:'actual-due',unitId:u.id,kind:'early_review',costMinutes:3,priority:0}]},86400000);
  expect(s.app.state.plans.at(-1)!.tasks[0]).toMatchObject({rawModelDueAt:due.rawModelDueAt,policyDueAt:due.policyDueAt,originalDueAt:due.originalDueAt,plannedAt:s.at,outcome:'not_measured'});
  expect(s.app.state.units[u.id].memory).toEqual(memory);
  await assess(s,u.id,'next-day');
  expect(s.app.state.assessments['next-day']).toMatchObject({verification:'V1',independentVerification:false});
  expect(s.app.state.units[u.id].memory?.lastReviewAt).toBe(s.app.state.attempts['next-day'].startedAt);
  expect(replayLearning(await s.store.load())).toEqual(s.app.state);
 });
 it('HI02 one sampled disjoint target leaves all untested targets and gaps unassessed',async()=>{
  const units=[unit('synthetic-prior-a',0),unit('synthetic-prior-b',300),unit('synthetic-prior-c',900)],s=await harness(units);
  expect(countUniqueTokens([{editionId:'synthetic-test-only',start:0,end:100},{editionId:'synthetic-test-only',start:300,end:400},{editionId:'synthetic-test-only',start:900,end:1000}])).toBe(300);
  await s.send({type:'RecoveryStarted',absenceDays:21,seed:17,minutes:4});
  const sampled=s.app.state.recoveries[0].today[0].id;await assess(s,sampled,'diagnostic-only');
  expect(Object.values(s.app.state.units).filter(u=>u.memory!==null).map(u=>u.definition.id)).toEqual([sampled]);
  for(const u of units.filter(u=>u.id!==sampled))expect(s.app.state.units[u.id]).toMatchObject({memory:null,state:{phase:'NotStarted',successfulEvidence:[]}});
  expect(Object.keys(s.app.state.units)).toHaveLength(3);
 });
 it('HI03 ninety-day return samples gradually without manufacturing Again or resetting untested memory',async()=>{
  const units=Array.from({length:30},(_,i)=>unit(`synthetic-return-${i}`,i*100)),s=await harness(units);
  await assess(s,units[0].id,'old-real-observation');const before=s.app.state.units[units[0].id].memory;
  const eventsBefore=(await s.store.load()).events.filter(e=>e.type==='AssessmentSubmitted').length;
  await s.send({type:'RecoveryStarted',absenceDays:90,seed:71,minutes:10},90*86400000);
  const recovery=s.app.state.recoveries[0];expect(recovery.sample).toHaveLength(24);expect(recovery.today.length).toBeLessThan(recovery.sample.length);
  expect(recovery.createsFailureEvents).toBe(false);expect(s.app.state.units[units[0].id].memory).toEqual(before);
  expect((await s.store.load()).events.filter(e=>e.type==='AssessmentSubmitted')).toHaveLength(eventsBefore);
  expect(Object.keys(s.app.state.assessments)).toEqual(['old-real-observation']);
 });
 it('HI04 successful chunks and a failed separate link never imply connected larger-unit success',async()=>{
  const a=unit('synthetic-child-a',0),b=unit('synthetic-child-b',100),link=unit('synthetic-edge-a-b',0,'link');const s=await harness([a,b,link]);
  await assess(s,a.id,'child-a');await assess(s,b.id,'child-b');await assess(s,link.id,'crossing-failed',1);
  const p=s.app.state;
  expect(p.assessments['child-a'].strictPass).toBe(true);expect(p.assessments['child-b'].strictPass).toBe(true);
  expect(p.attempts['crossing-failed'].assessment?.probeType).toBe('link');expect(p.assessments['crossing-failed'].strictPass).toBe(false);
  expect(p.units[link.id]).toMatchObject({memory:null,dates:null,schedulerStatus:'profile-not-approved'});
  expect(p.assessments['crossing-failed'].reasonCodes).toContain('FSRS_PROBE_PROFILE_NOT_APPROVED');
  expect(connectedStatus([{id:a.id,strictPass:p.assessments['child-a'].strictPass},{id:b.id,strictPass:p.assessments['child-b'].strictPass}],[{id:link.id,strictPass:p.assessments['crossing-failed'].strictPass}],[link.id]).eligibleForConnectedClaim).toBe(false);
  expect(p.units[a.id].state.failures).toBe(0);expect(p.units[b.id].state.failures).toBe(0);
  expect(Object.values(p.units).some(u=>u.state.phase==='Maintenance')).toBe(false);
 });
 it('HI05 30/60/120-minute replans preserve every due and defer without fictional completion',async()=>{
  const units=[unit('synthetic-debt-a',0),unit('synthetic-debt-b',100),unit('synthetic-debt-c',200),unit('synthetic-fresh',300)],s=await harness(units);
  for(let i=0;i<3;i++)await assess(s,units[i].id,`debt-${i}`);
  const before=s.app.state,rawCount=(await s.store.load()).events.filter(e=>e.type==='AssessmentSubmitted').length;
  for(const minutes of [30,60,120]){
   const candidates=units.map((u,i)=>({id:`candidate-${u.id}`,unitId:u.id,kind:i<3?'early_review' as const:'new' as const,costMinutes:20,priority:i}));
   await s.send({type:'PlanRecomputed',minutes,spentMinutes:0,futureLoadFeasible:true,candidates},minutes===30?2*86400000:1000);
   const plan=s.app.state.plans.at(-1)!;expect(plan.plannedMinutes).toBeLessThanOrEqual(minutes*.85);
   for(const u of units.slice(0,3)){const due=before.units[u.id].dates!;expect([...plan.tasks,...plan.deferred].find(c=>c.unitId===u.id)).toMatchObject({rawModelDueAt:due.rawModelDueAt,policyDueAt:due.policyDueAt,originalDueAt:due.originalDueAt,outcome:'not_measured'});}
   for(const task of plan.tasks)expect(task.plannedAt).toBe(s.at);for(const task of plan.deferred)expect(task.plannedAt).toBeNull();
   expect([...plan.tasks,...plan.deferred].filter(c=>c.kind==='early_review')).toHaveLength(3);
   if(minutes<120)expect(plan.tasks.some(c=>c.kind==='new')).toBe(false);
   for(const u of units)expect(s.app.state.units[u.id].memory).toEqual(before.units[u.id].memory);
  }
  expect((await s.store.load()).events.filter(e=>e.type==='AssessmentSubmitted')).toHaveLength(rawCount);
 });
});
