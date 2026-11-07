// @vitest-environment node
import { describe,it,expect } from 'vitest';
import { LearningApplication,replayLearning } from './learning';
import type { LearningCommand } from './learning';
import { MemoryEventStore } from '../persistence/event-store';
import { createSyntheticLearningAccess } from '../testing/learning-access';
const unit={id:'synthetic-unit',editionId:'synthetic-test-only',probeProfileVersionId:'chunk-P0-1',words:100,coverage:['synthetic:0:100']};
async function setup(store=new MemoryEventStore()) {
  const app=await LearningApplication.open(store,{access:await createSyntheticLearningAccess([unit])});let clock=Date.now()+1000;
  const send=(command:LearningCommand,commandId?:string)=>app.send(command,{at:new Date(clock+=1000).toISOString(),...(commandId?{commandId}:{})});
  await send({type:'UnitRegistered',unit});await send({type:'SessionStarted',unitId:unit.id,sessionId:'session-1'});
  return {app,store,send};
}
const clean={attemptedWords:100,errors:0,completion:'complete' as const,effort:'normal' as const,gapVerified:true};
async function attempt(s:Awaited<ReturnType<typeof setup>>,id='attempt-1',hints=false){
  await s.send({type:'RecallAttemptStarted',sessionId:'session-1',attemptId:id});
  if(hints)await s.send({type:'HintUsed',sessionId:'session-1',reveal:true});
  await s.send({type:'RecallAttemptCompleted',sessionId:'session-1',termination:'completed'});
  await s.send({type:'AssessmentSubmitted',attemptId:id,observation:clean});
}
describe('05A event-to-HME application integration on explicitly synthetic units',()=>{
  it('LA01 production default content gate rejects an unapproved unit',async()=>{
    const app=await LearningApplication.open(new MemoryEventStore());
    await expect(app.send({type:'UnitRegistered',unit})).rejects.toMatchObject({code:'RELEASE_GATES_BLOCKED'});
    expect(Object.keys(app.state.units)).toHaveLength(0);
  });
  it('LA02 forty repetitions are durable events and never become memory reviews or mastery',async()=>{
    const s=await setup();for(let i=0;i<40;i++)await s.send({type:'RepetitionCompleted',sessionId:'session-1',mode:'reading'});
    expect(s.app.state.sessions['session-1'].repetitions).toBe(40);
    expect(s.app.state.units[unit.id].memory).toBeNull();expect(s.app.state.units[unit.id].state.phase).toBe('Learning');
    const reopened=await LearningApplication.open(s.store,{access:await createSyntheticLearningAccess([unit])});expect(reopened.state.sessions['session-1'].repetitions).toBe(40);
  });
  it('LA03 a retried repetition command has one effect and a conflicting retry is rejected',async()=>{
    const s=await setup();const c:LearningCommand={type:'RepetitionCompleted',sessionId:'session-1',mode:'reading'};
    await s.send(c,'repeat-once');const revision=s.app.revision;await s.send(c,'repeat-once');
    expect(s.app.revision).toBe(revision);expect(s.app.state.sessions['session-1'].repetitions).toBe(1);
    await expect(s.send({...c,mode:'listening'},'repeat-once')).rejects.toMatchObject({code:'EVENT_CONFLICT'});
  });
  it('LA04 hints override an optimistic assessment while preserving its raw report',async()=>{
    const s=await setup();await attempt(s,'attempt-1',true);
    expect(s.app.state.assessments['attempt-1']).toMatchObject({effectiveRating:1,strictPass:false});
    expect(s.app.state.attempts['attempt-1'].assessment?.effort).toBe('normal');
    expect(s.app.state.units[unit.id].dates?.rawModelDueAt).toBeTruthy();
    expect(s.app.state.units[unit.id].dates?.policyDueAt).not.toBe(s.app.state.units[unit.id].dates?.rawModelDueAt);
  });
  it('LA05 two real clean attempts only reach early review',async()=>{
    const s=await setup();await attempt(s);await attempt(s,'attempt-2');
    expect(s.app.state.units[unit.id].state.phase).toBe('EarlyReview');
    expect(s.app.state.units[unit.id].state.transitions.map(t=>t.to)).toContain('InitialRecall');
    expect(s.app.state.units[unit.id].memory).not.toBeNull();
  });
  it('LA06 a crash during recall cannot become a completed success; restart preserves old hints',async()=>{
    const s=await setup();await s.send({type:'RecallAttemptStarted',sessionId:'session-1',attemptId:'interrupted'});
    await s.send({type:'HintUsed',sessionId:'session-1',reveal:true});
    const reopened=await LearningApplication.open(s.store,{access:await createSyntheticLearningAccess([unit])});
    await expect(reopened.send({type:'RecallAttemptCompleted',sessionId:'session-1',termination:'completed'})).rejects.toMatchObject({code:'INSUFFICIENT_EVIDENCE'});
    await reopened.send({type:'RecallAttemptRestarted',sessionId:'session-1',attemptId:'fresh'}, {at:new Date(Date.now()+100000).toISOString()});
    expect(reopened.state.attempts.interrupted).toMatchObject({hints:1,assessment:null,termination:'user_stop'});
    expect(reopened.state.attempts.fresh.hints).toBe(0);expect(reopened.state.units[unit.id].memory).toBeNull();
  });
  it('LA07 interrupted training restores all confirmed repetitions without a phantom completion',async()=>{
    const s=await setup();await s.send({type:'RepetitionCompleted',sessionId:'session-1',mode:'unassisted_training'});
    await s.send({type:'SessionPaused',sessionId:'session-1'});
    const reopened=await LearningApplication.open(s.store,{access:await createSyntheticLearningAccess([unit])});
    await reopened.send({type:'SessionResumed',sessionId:'session-1'},{at:new Date(Date.now()+100000).toISOString()});
    expect(reopened.state.sessions['session-1']).toMatchObject({phase:'training',repetitions:1});
    expect(Object.keys(reopened.state.assessments)).toHaveLength(0);
  });
  it('LA08 failed commit leaves counters and raw events unchanged',async()=>{
    let fail=false;const store=new MemoryEventStore(()=>{if(fail)throw Error('disk failure');});const s=await setup(store);
    const before=await store.load();fail=true;
    await expect(s.send({type:'RepetitionCompleted',sessionId:'session-1',mode:'reading'})).rejects.toThrow('disk failure');
    expect(await store.load()).toEqual(before);expect(s.app.state.sessions['session-1'].repetitions).toBe(0);
  });
  it('LA09 correction replays the original review time and retains the raw original assessment',async()=>{
    const s=await setup();await attempt(s);const original=s.app.state.units[unit.id].memory!.lastReviewAt;
    await s.send({type:'AssessmentCorrected',attemptId:'attempt-1',expectedAssessmentRevision:1,reason:'تصحيح الإقرار',observation:{...clean,errors:2}});
    expect(s.app.state.assessments['attempt-1'].effectiveRating).toBe(1);
    expect(s.app.state.units[unit.id].memory!.lastReviewAt).toBe(original);
    expect(Object.keys(s.app.state.attempts)).toHaveLength(1);
    const snapshot=await s.store.load();expect(snapshot.events.filter(e=>e.type==='AssessmentSubmitted')).toHaveLength(1);
    expect(replayLearning(snapshot)).toEqual(s.app.state);
  });
  it('LA10 a nullable word draft prevents a strict pass without manufacturing Again',async()=>{
    const s=await setup();await s.send({type:'RecallAttemptStarted',sessionId:'session-1',attemptId:'a'});
    await s.send({type:'ProductMistakeDraftRecorded',attemptId:'a',mistakeType:'word',location:null,certainty:'observed'});
    await s.send({type:'RecallAttemptCompleted',sessionId:'session-1',termination:'completed'});
    await s.send({type:'AssessmentSubmitted',attemptId:'a',observation:clean});
    expect(s.app.state.assessments.a).toMatchObject({strictPass:null,effectiveRating:null});
    expect(s.app.state.units[unit.id].memory).toBeNull();
  });
  it('LA11 a link draft cannot become a lexical failure in a chunk scheduler',async()=>{
    const s=await setup();await attempt(s);
    await s.send({type:'ProductMistakeDraftRecorded',attemptId:'attempt-1',mistakeType:'link',location:null,certainty:'observed'});
    expect(s.app.state.assessments['attempt-1'].strictPass).toBe(true);
    expect(s.app.state.units[unit.id].state.continuityPassed).not.toBe(true);
  });
  it('LA12 recovery at three days/weeks/months never creates a failed review or changes memory',async()=>{
    const s=await setup();await attempt(s);const memory=s.app.state.units[unit.id].memory;
    for(const absenceDays of [3,21,90])await s.send({type:'RecoveryStarted',absenceDays,seed:42,minutes:30});
    expect(s.app.state.recoveries.map(r=>r.target)).toEqual([3,12,24]);
    expect(s.app.state.units[unit.id].memory).toEqual(memory);expect(Object.keys(s.app.state.assessments)).toHaveLength(1);
  });
  it('LA13 reopening a previously accepted unit with no trusted package is blocked',async()=>{
    const s=await setup();await expect(LearningApplication.open(s.store)).rejects.toMatchObject({code:'RELEASE_GATES_BLOCKED'});
  });
  it('LA14 a paused recall cannot be resumed as a connected uninterrupted performance',async()=>{
    const s=await setup();await s.send({type:'RecallAttemptStarted',sessionId:'session-1',attemptId:'a'});
    await s.send({type:'SessionPaused',sessionId:'session-1'});
    await expect(s.send({type:'SessionResumed',sessionId:'session-1'})).rejects.toMatchObject({code:'INSUFFICIENT_EVIDENCE'});
    expect(s.app.state.units[unit.id].memory).toBeNull();
  });
  it('LA15 a restarted recall never certifies an old exposure-free gap',async()=>{
    const s=await setup();await s.send({type:'RecallAttemptStarted',sessionId:'session-1',attemptId:'a'});
    await s.send({type:'SessionPaused',sessionId:'session-1'});
    await s.send({type:'RecallAttemptRestarted',sessionId:'session-1',attemptId:'b'});
    await s.send({type:'RecallAttemptCompleted',sessionId:'session-1',termination:'completed'});
    await s.send({type:'AssessmentSubmitted',attemptId:'b',observation:clean});
    expect(s.app.state.attempts.b.assessment?.gapVerified).toBe(false);
    expect(s.app.state.assessments.b.effectiveRating).toBe(3);
  });
  it('LA16 time spent recalling is excluded from the preceding pedagogical gap',async()=>{
    const s=await setup();let base=Date.now()+100000;
    await s.app.send({type:'ExposureCompleted',sessionId:'session-1',mode:'reading'},{at:new Date(base).toISOString()});
    await s.app.send({type:'RecallAttemptStarted',sessionId:'session-1',attemptId:'a'},{at:new Date(base+19*60000).toISOString()});
    await s.app.send({type:'RecallAttemptCompleted',sessionId:'session-1',termination:'completed'},{at:new Date(base+21*60000).toISOString()});
    await s.app.send({type:'AssessmentSubmitted',attemptId:'a',observation:clean},{at:new Date(base+22*60000).toISOString()});
    expect(s.app.state.units[unit.id].state.successfulEvidence[0].gapMs).toBe(19*60000);
    expect(s.app.state.units[unit.id].memory?.lastReviewAt).toBe(new Date(base+19*60000).toISOString());
  });
});
