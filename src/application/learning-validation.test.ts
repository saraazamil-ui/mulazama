// @vitest-environment node
// These are synthetic application-service regressions, not Quran/browser/device verification.
import { describe, expect, it } from 'vitest';
import { LearningApplication, replayLearning } from './learning';
import type { LearningCommand } from './learning';
import { MemoryEventStore } from '../persistence/event-store';
import { VERSIONS } from '../core/types';
import { createSyntheticLearningAccess } from '../testing/learning-access';

const unit={id:'synthetic-alpha',editionId:'synthetic-test-only',probeProfileVersionId:'synthetic-chunk-P0',words:100,coverage:['synthetic:0:100']};
const clean={attemptedWords:100,errors:0,completion:'complete' as const,effort:'normal' as const,gapVerified:true};
async function setup(){
 const store=new MemoryEventStore();const app=await LearningApplication.open(store,{access:await createSyntheticLearningAccess([unit])});
 let at=Date.now()+1000;
 const send=(c:LearningCommand,advance=1000)=>app.send(c,{at:new Date(at+=advance).toISOString()});
 await send({type:'UnitRegistered',unit});await send({type:'SessionStarted',unitId:unit.id,sessionId:'s'});
 return {app,store,send};
}
async function finish(s:Awaited<ReturnType<typeof setup>>,attemptId:string){
 await s.send({type:'RecallAttemptCompleted',sessionId:'s',termination:'completed'});
 await s.send({type:'AssessmentSubmitted',attemptId,observation:clean});
}

describe('05B HME application evidence validation regressions',()=>{
 it.each(['source','unitId','coverage','zoneId'])('HV01 rejects a %s envelope inconsistent with its learning command',async field=>{
  const s=await setup();await s.send({type:'RecallAttemptStarted',sessionId:'s',attemptId:'a'});await finish(s,'a');
  const snapshot=await s.store.load();const e=snapshot.events.find(e=>e.type==='AssessmentSubmitted')!;
  if(field==='source')e.source='V4';else if(field==='unitId')e.unitId='synthetic-other';else if(field==='coverage')e.coverage=['synthetic:100:200'];else e.zoneId='Invalid/Zone';
  expect(()=>replayLearning(snapshot)).toThrow();
 });
 it('HV02 rejects unknown assessment fields rather than silently reinterpreting claimed verification',async()=>{
  const s=await setup();await s.send({type:'RecallAttemptStarted',sessionId:'s',attemptId:'a'});
  await s.send({type:'RecallAttemptCompleted',sessionId:'s',termination:'completed'});
  const before=await s.store.load();
  await expect(s.send({type:'AssessmentSubmitted',attemptId:'a',observation:{...clean,source:'V4'}} as unknown as LearningCommand)).rejects.toThrow();
  expect(await s.store.load()).toEqual(before);
 });
 it('HV03 one named physical opportunity/cluster has one scheduler effect',async()=>{
  const s=await setup();
  const start=(attemptId:string)=>({type:'RecallAttemptStarted',sessionId:'s',attemptId,testOpportunityId:'physical-opportunity',evidenceClusterId:'physical-cluster'} as LearningCommand);
  await s.send(start('a'));await finish(s,'a');const memory=s.app.state.units[unit.id].memory;
  await s.send(start('b'));await finish(s,'b');
  expect(s.app.state.units[unit.id].memory).toEqual(memory);
  expect(s.app.state.units[unit.id].state.successfulEvidence).toHaveLength(1);
  expect(s.app.state.attempts.b.assessment?.firstAttempt).toBe(false);
 });
 it('HV04 ending interrupted recall carries exposure and uncertainty into a different session',async()=>{
  const s=await setup();await s.send({type:'ExposureCompleted',sessionId:'s',mode:'reading'});
  await s.send({type:'RecallAttemptStarted',sessionId:'s',attemptId:'abandoned'},86400000);
  await s.send({type:'SessionEnded',sessionId:'s'},600000);
  const end=s.app.state.sessions.s.updatedAt;
  await s.send({type:'SessionStarted',unitId:unit.id,sessionId:'s2'});
  await s.send({type:'RecallAttemptStarted',sessionId:'s2',attemptId:'fresh'});
  await s.send({type:'RecallAttemptCompleted',sessionId:'s2',termination:'completed'});
  await s.send({type:'AssessmentSubmitted',attemptId:'fresh',observation:clean});
  expect(s.app.state.attempts.fresh.lastExposureAt).toBe(end);
  expect(s.app.state.attempts.fresh.assessment?.gapVerified).toBe(false);
  expect(s.app.state.attempts.abandoned.assessment).toBeNull();
 });
 it('HV05 refresh cannot turn an imported active recall into a completed success',async()=>{
  const s=await setup();const observer=await LearningApplication.open(s.store,{access:await createSyntheticLearningAccess([unit])});
  await s.send({type:'RecallAttemptStarted',sessionId:'s',attemptId:'active-elsewhere'});
  await observer.refresh();
  await expect(observer.send({type:'RecallAttemptCompleted',sessionId:'s',termination:'completed'},{at:new Date(Date.now()+100000).toISOString()})).rejects.toThrow();
 });
 it('HV06 a unit cannot silently accept duplicate coverage keys',async()=>{
  const s=await setup();
  await expect(s.send({type:'UnitRegistered',unit:{...unit,id:'duplicate-coverage',coverage:[...unit.coverage,...unit.coverage]}})).rejects.toThrow();
 });
 it('HV07 planning cannot forge unknown unit coverage or due dates',async()=>{
  const s=await setup();
  await expect(s.send({type:'PlanRecomputed',minutes:30,spentMinutes:0,futureLoadFeasible:true,candidates:[{id:'forged',unitId:'nonexistent',kind:'review',costMinutes:3,priority:0,coverageKeys:['forged'],originalDueAt:'2001-01-01T00:00:00.000Z'}]})).rejects.toThrow();
 });
 it('HV08 a physical cluster cannot gain a second scheduler effect under a new opportunity ID',async()=>{
  const s=await setup();
  await s.send({type:'RecallAttemptStarted',sessionId:'s',attemptId:'a',testOpportunityId:'op-a',evidenceClusterId:'same-recording'});await finish(s,'a');
  const memory=s.app.state.units[unit.id].memory;
  await s.send({type:'RecallAttemptStarted',sessionId:'s',attemptId:'b',testOpportunityId:'op-b',evidenceClusterId:'same-recording'});await finish(s,'b');
  expect(s.app.state.units[unit.id].memory).toEqual(memory);expect(s.app.state.units[unit.id].state.successfulEvidence).toHaveLength(1);
 });
 it('HV09 duplicated one-event learning command fails replay, including an authenticated restore validator',async()=>{
  const s=await setup();await s.send({type:'RepetitionCompleted',sessionId:'s',mode:'reading'});
  const original=await s.store.load(),event=structuredClone(original.events.at(-1)!);
  event.eventId='synthetic-second-envelope';original.events.push(event);
  expect(()=>replayLearning(original)).toThrowError(/عملية تعلم مكررة/);
 });
 it('HV10 exact duplicate event replay has one effect and conflicting event identity is rejected',async()=>{
  const s=await setup();await s.send({type:'RepetitionCompleted',sessionId:'s',mode:'reading'});
  const original=await s.store.load(),event=structuredClone(original.events.at(-1)!);original.events.push(event);
  expect(replayLearning(original).sessions.s.repetitions).toBe(1);
  (event.data.command as {mode:string}).mode='listening';expect(()=>replayLearning(original)).toThrowError(/معرف واقعة متعارض/);
 });
 it.each(['rawModelDueAt','policyDueAt','originalDueAt'] as const)('HV11 planning cannot overwrite an existing %s',async field=>{
  const s=await setup();await s.send({type:'RecallAttemptStarted',sessionId:'s',attemptId:'a'});await finish(s,'a');
  const before=await s.store.load();
  await expect(s.send({type:'PlanRecomputed',minutes:30,spentMinutes:0,futureLoadFeasible:false,candidates:[{id:'due',unitId:unit.id,kind:'early_review',costMinutes:3,priority:0,[field]:null}]})).rejects.toMatchObject({code:'REFERENCE_MISMATCH'});
  expect(await s.store.load()).toEqual(before);
 });
 it('HV12 a due review cannot disappear from both planned and deferred work',async()=>{
  const s=await setup();await s.send({type:'RecallAttemptStarted',sessionId:'s',attemptId:'a'});await finish(s,'a');
  await expect(s.send({type:'PlanRecomputed',minutes:0,spentMinutes:0,futureLoadFeasible:false,candidates:[]},8*86400000)).rejects.toMatchObject({code:'REFERENCE_MISMATCH'});
 });
 it('HV13 05A learning history needs explicit migration rather than silent evidence reinterpretation',async()=>{
  const s=await setup();const original=await s.store.load(),legacy=structuredClone(original);for(const e of legacy.events)e.versions=VERSIONS;
  expect(()=>replayLearning(legacy)).toThrowError(/هجرة مراجعة صريحة/);expect(await s.store.load()).toEqual(original);
 });
 it('HV14 backward capture clock rejects the operation without changing raw history',async()=>{
  const s=await setup(),before=await s.store.load();
  await expect(s.app.send({type:'RepetitionCompleted',sessionId:'s',mode:'reading'},{at:'2001-01-01T00:00:00.000Z'})).rejects.toMatchObject({code:'CLOCK_UNCERTAIN'});
  expect(await s.store.load()).toEqual(before);
 });
 it('HV15 command and clock options are captured before caller mutation during the queued write',async()=>{
  const s=await setup();const command:Extract<LearningCommand,{type:'RepetitionCompleted'}>={type:'RepetitionCompleted',sessionId:'s',mode:'reading'};
  const options={at:new Date(Date.now()+100000).toISOString()},originalAt=options.at;
  const pending=s.app.send(command,options);command.mode='listening';options.at='2001-01-01T00:00:00.000Z';await pending;
  const last=(await s.store.load()).events.at(-1)!;expect(last.occurredAt).toBe(originalAt);expect(last.data.command).toMatchObject({mode:'reading'});
 });
 it('HV16 canonical candidate coverage cannot be replaced even for a known unit',async()=>{
  const s=await setup();await expect(s.send({type:'PlanRecomputed',minutes:30,spentMinutes:0,futureLoadFeasible:false,candidates:[{id:'bad-coverage',unitId:unit.id,kind:'diagnostic',costMinutes:3,priority:0,coverageKeys:['synthetic:300:400']}]})).rejects.toMatchObject({code:'REFERENCE_MISMATCH'});
 });
 it.each(['link','connected','random_start'] as const)('HV17 %s assessments cannot update permanent chunk-model FSRS before profile approval',async probeType=>{
  const definition={...unit,probeType,probeProfileVersionId:`synthetic-${probeType}-profile`},store=new MemoryEventStore();
  const app=await LearningApplication.open(store,{access:await createSyntheticLearningAccess([definition])});let clock=Date.now()+1000;
  const send=(c:LearningCommand)=>app.send(c,{at:new Date(clock+=1000).toISOString()});
  await send({type:'UnitRegistered',unit:definition});await send({type:'SessionStarted',unitId:unit.id,sessionId:'probe'});
  await send({type:'RecallAttemptStarted',sessionId:'probe',attemptId:'probe-a'});await send({type:'RecallAttemptCompleted',sessionId:'probe',termination:'completed'});
  await send({type:'AssessmentSubmitted',attemptId:'probe-a',observation:clean});
  expect(app.state.assessments['probe-a'].strictPass).toBe(true);
  expect(app.state.assessments['probe-a'].reasonCodes).toContain('FSRS_PROBE_PROFILE_NOT_APPROVED');
  expect(app.state.units[unit.id]).toMatchObject({memory:null,dates:null,schedulerStatus:'profile-not-approved'});
 });
});
