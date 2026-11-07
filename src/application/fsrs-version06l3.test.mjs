// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { loadTsFsrsReference } from '../../scripts/fsrs-reference-loader.mjs';
import { FSRS_WEIGHTS, FSRS_PROVENANCE } from '../core/fsrs';
import { REFERENCE_FSRS_PROVENANCE } from '../core/fsrs-reference';
import { LEARNING_VERSIONS, REFERENCE_LEARNING_VERSIONS, canonical, learningVersionsFor } from '../core/types';
import { LearningApplication, replayLearning, learningSchedulingMode } from './learning';
import { CompositeApplication, replayComposite } from './composite-application';
import { HistoryApplication, replayHistory } from './history-application';
import { rebuildAdaptiveSchedule } from './adaptive-scheduling';
import { reviewFsrsTransition06l2 } from './fsrs-transition06l2';
import { MemoryEventStore } from '../persistence/event-store';
import { validateBackupSnapshot, exportEncryptedBackup, inspectEncryptedBackup } from '../persistence/backup';
import { createSyntheticLearningAccess } from '../testing/learning-access';
import { createBlockedLearningAccess } from '../release/access';
import { fsrsUnit06l2, rubricScenarios06l2, recordFsrsAttempt06l2, baseTime06l2, offset06l2, clean06l2 } from '../testing/fsrs-integration06l2';
let reference;
beforeAll(async () => { reference = await loadTsFsrsReference(resolve('references/ts-fsrs-5.4.2-verified/package'), 'references/ts-fsrs-5.4.2-verified/receipt.json', FSRS_WEIGHTS); });
const upstream = (grades, times) => reference.probe.run({initial:null,desiredRetention:.9,reviews:grades.map((grade,index)=>({grade,at:times[index]}))});
const memory = app => app.learning.state.units[fsrsUnit06l2.id];
const fromUpstream = (result, at) => ({ stability:result.stability, difficulty:result.difficulty, lastReviewAt:at, model:'FSRS-6', algorithmVersion:REFERENCE_FSRS_PROVENANCE.algorithmVersion });
async function setup(scheduling='reference-06e1') {
  const store=new MemoryEventStore(),access=await createSyntheticLearningAccess([fsrsUnit06l2]);
  const app=await CompositeApplication.open(store,{access,scheduling});
  await app.learning.send({type:'UnitRegistered',unit:fsrsUnit06l2},{at:offset06l2(baseTime06l2,-10000)});
  return {store,access,app};
}
const correction = (attemptId,observation=clean06l2) => ({type:'AssessmentCorrected',attemptId,expectedAssessmentRevision:1,reason:'synthetic self-assessment correction',observation});

describe('06-L3 explicit versioned HME scheduling with unchanged legacy interpretation',()=>{
  it('L3FSRS01 a corrected stream is explicit, every HME event carries its version, no product event is relabeled',async()=>{
    const s=await setup();
    expect(s.app.learning.schedulingMode).toBe('reference-06e1');
    expect(s.app.learning.versions).toEqual(REFERENCE_LEARNING_VERSIONS);
    const raw=await s.store.load();
    expect(raw.events.filter(e=>e.data.scope==='hme').every(e=>canonical(e.versions)===canonical(REFERENCE_LEARNING_VERSIONS))).toBe(true);
    expect(raw.events.find(e=>e.data.scope==='product').versions.fsrsImplementation).toBe(FSRS_PROVENANCE.algorithmVersion);
    expect(learningSchedulingMode(raw)).toBe('reference-06e1');
    expect(()=>validateBackupSnapshot(raw)).not.toThrow();
  });
  for(const scenario of rubricScenarios06l2)it(`L3FSRS literal self-report ${scenario.id} maps to ${scenario.expectedRating} and independently correct memory`,async()=>{
    const s=await setup();
    const id=await recordFsrsAttempt06l2(s,scenario),unit=memory(s.app);
    expect(s.app.learning.state.assessments[id].effectiveRating).toBe(scenario.expectedRating);
    expect(s.app.learning.state.assessments[id].independentVerification).toBe(false);
    if(scenario.expectedRating===null) {expect(unit.memory).toBeNull();expect(unit.dates).toBeNull();}
    else {const expected=upstream([scenario.expectedRating],[baseTime06l2])[0];expect(unit.memory).toEqual(fromUpstream(expected,baseTime06l2));expect(unit.dates.rawModelDueAt).toBe(expected.rawDueAt);}
    const snapshot=await s.store.load();expect(replayHistory(snapshot).learning).toEqual(s.app.learning.state);
  });
  it('L3FSRS15 all four results change scheduling at UTC 23/25/24-hour boundaries with stable capture-zone replay',async()=>{
    const s=await setup(),times=[0,23,48,72].map(h=>offset06l2(baseTime06l2,h*3600000)),expected=upstream([1,2,3,4],times);
    for(let i=0;i<4;i++){
      await recordFsrsAttempt06l2(s,rubricScenarios06l2[i],times[i]);
      expect(memory(s.app).memory).toEqual(fromUpstream(expected[i],times[i]));
      expect(memory(s.app).dates.rawModelDueAt).toBe(expected[i].rawDueAt);
    }
    const raw=await s.store.load();
    for(const zone of ['Asia/Riyadh','America/New_York','Pacific/Kiritimati']) {
      const copy=structuredClone(raw);for(const e of copy.events)if(e.data.scope==='hme')e.zoneId=zone;
      expect(replayHistory(copy).learning.units[fsrsUnit06l2.id].memory).toEqual(memory(s.app).memory);
    }
    expect(expected.map(x=>x.elapsedDays)).toEqual([0,0,1,1]);
  });
  it('L3FSRS16 correction replays original instants and idempotent retry does not append or reschedule twice',async()=>{
    const s=await setup(),times=[0,2,365].map(d=>offset06l2(baseTime06l2,d*86400000));
    for(const [i,scenario]of[rubricScenarios06l2[1],rubricScenarios06l2[2],rubricScenarios06l2[0]].entries())await recordFsrsAttempt06l2(s,scenario,times[i]);
    const before=await s.store.load(),cmd=correction('synthetic-06l2-attempt-clean-hard',{...clean06l2,effort:'easy'}),opts={commandId:'test-l3-correction',at:offset06l2(times[2],86400000)};
    await s.app.learning.send(cmd,opts);const after=await s.store.load();await s.app.learning.send(cmd,opts);
    expect(await s.store.load()).toEqual(after);expect(after.events.slice(0,before.events.length)).toEqual(before.events);
    expect(memory(s.app).memory).toEqual(fromUpstream(upstream([4,3,1],times).at(-1),times[2]));
    expect(memory(s.app).dates.rawModelDueAt).toBe(upstream([4,3,1],times).at(-1).rawDueAt);
    await expect(s.app.learning.send({...cmd,observation:clean06l2},opts)).rejects.toMatchObject({code:'EVENT_CONFLICT'});
    expect(await s.store.load()).toEqual(after);
  });
  it('L3FSRS17 unknown correction retracts the review and keeps original events and correction',async()=>{
    const s=await setup(),id=await recordFsrsAttempt06l2(s,rubricScenarios06l2[2]);const before=await s.store.load();
    await s.app.learning.send(correction(id,{...clean06l2,errors:null}),{at:offset06l2(baseTime06l2,86400000)});
    expect(memory(s.app).memory).toBeNull();expect(memory(s.app).dates).toBeNull();
    expect((await s.store.load()).events.slice(0,before.events.length)).toEqual(before.events);
  });
  it('L3FSRS18 duplicate opportunity/cluster cannot double count reviews',async()=>{
    const s=await setup(),times=[0,1,2].map(d=>offset06l2(baseTime06l2,d*86400000));
    await recordFsrsAttempt06l2(s,rubricScenarios06l2[1],times[0],'same-opportunity','same-cluster');
    await recordFsrsAttempt06l2(s,rubricScenarios06l2[2],times[1],'same-opportunity','new-cluster');
    await recordFsrsAttempt06l2(s,rubricScenarios06l2[3],times[2],'new-opportunity','same-cluster');
    expect(memory(s.app).memory).toEqual(fromUpstream(upstream([2],[times[0]])[0],times[0]));
  });
  it('L3FSRS19 legacy streams keep exact bytes and default interpreter; opt-in on an existing stream rejects without writes',async()=>{
    const s=await setup('legacy');await recordFsrsAttempt06l2(s,rubricScenarios06l2[2]);const before=await s.store.load();
    expect(memory(s.app).memory.algorithmVersion).toBe(FSRS_PROVENANCE.algorithmVersion);
    await expect(CompositeApplication.open(s.store,{access:s.access,scheduling:'reference-06e1'})).rejects.toMatchObject({code:'SCHEDULER_TRANSITION_REQUIRED'});
    expect(await s.store.load()).toEqual(before);
    const reopened=await CompositeApplication.open(s.store,{access:s.access});expect(reopened.learning.schedulingMode).toBe('legacy');expect(reopened.learning.state).toEqual(s.app.learning.state);
    expect(await s.store.load()).toEqual(before);
  });
  it('L3FSRS20 reopen infers corrected mode from original envelopes, preserves plans and does not write',async()=>{
    const s=await setup();await recordFsrsAttempt06l2(s,rubricScenarios06l2[2]);const unit=memory(s.app);
    await s.app.learning.send({type:'PlanRecomputed',minutes:10,spentMinutes:0,futureLoadFeasible:false,candidates:[{id:'test-l3-due',unitId:fsrsUnit06l2.id,kind:'review',priority:90,costMinutes:3,protected:true,coverageKeys:fsrsUnit06l2.coverage,rawModelDueAt:unit.dates.rawModelDueAt,policyDueAt:unit.dates.policyDueAt,originalDueAt:unit.dates.originalDueAt}]},{at:offset06l2(baseTime06l2,8*86400000)});
    const before=await s.store.load(),reopened=await CompositeApplication.open(s.store,{access:s.access});
    expect(reopened.learning.schedulingMode).toBe('reference-06e1');expect(reopened.learning.state).toEqual(s.app.learning.state);expect(await s.store.load()).toEqual(before);
    await expect(CompositeApplication.open(s.store,{access:s.access,scheduling:'legacy'})).rejects.toMatchObject({code:'SCHEDULER_TRANSITION_REQUIRED'});expect(await s.store.load()).toEqual(before);
  });
  it('L3FSRS21 mixed or unknown event versions cannot replay or restore; source remains unchanged',async()=>{
    const s=await setup();await recordFsrsAttempt06l2(s,rubricScenarios06l2[2]);const before=await s.store.load();
    const mixed=structuredClone(before);mixed.events.filter(e=>e.data.scope==='hme').at(-1).versions=structuredClone(LEARNING_VERSIONS);
    expect(()=>replayComposite(mixed)).toThrow();
    const unknown=structuredClone(before);unknown.events.find(e=>e.data.scope==='hme').versions.fsrsImplementation='unregistered-model';
    expect(()=>validateBackupSnapshot(unknown)).toThrow();expect(()=>replayLearning(unknown)).toThrow();expect(await s.store.load()).toEqual(before);
  });
  it('L3FSRS22 a blocked capability cannot initialize corrected HME or accept a guessed mode',async()=>{
    const store=new MemoryEventStore();
    await expect(LearningApplication.open(store,{access:createBlockedLearningAccess(),scheduling:'reference-06e1'})).rejects.toMatchObject({code:'RELEASE_CONTEXT_INVALID'});
    expect(await store.load()).toEqual({revision:0,events:[]});
    await expect(LearningApplication.open(store,{scheduling:'unknown'})).rejects.toMatchObject({code:'UNSUPPORTED_VERSION'});
    expect(()=>learningVersionsFor('unknown')).toThrow();expect(await store.load()).toEqual({revision:0,events:[]});
  });
  it('L3FSRS23 encrypted export/inspection/restore roundtrips corrected and product events exactly',async()=>{
    const s=await setup();await recordFsrsAttempt06l2(s,rubricScenarios06l2[2]);const snapshot=await s.store.load(),password='synthetic-password-06l3';
    const encrypted=await s.app.exportBackup(password);const inspected=await inspectEncryptedBackup(encrypted,password,replayComposite);expect(inspected.snapshot.events).toEqual(snapshot.events);
    const targetStore=new MemoryEventStore(),target=await CompositeApplication.open(targetStore,{access:s.access,scheduling:'reference-06e1'});
    await target.replaceFromBackup(encrypted,password,true);expect((await targetStore.load()).events).toEqual(snapshot.events);expect(target.learning.state).toEqual(s.app.learning.state);expect(target.learning.schedulingMode).toBe('reference-06e1');
    expect(await s.store.load()).toEqual(snapshot);
    const historical=await HistoryApplication.open(s.store);expect((await historical.readAdaptiveSchedule()).sourceInterpretation).toEqual(REFERENCE_LEARNING_VERSIONS);expect(rebuildAdaptiveSchedule(snapshot).executable).toBe(false);
  });
  it('L3FSRS24 a denied restore leaves the target intact and cannot authorize sessions from stored versions',async()=>{
    const s=await setup();await recordFsrsAttempt06l2(s,rubricScenarios06l2[2]);const encrypted=await exportEncryptedBackup(await s.store.load(),'synthetic-password-06l3');
    const targetStore=new MemoryEventStore(),target=await HistoryApplication.open(targetStore),before=await targetStore.load();
    await expect(target.replaceFromBackup(encrypted,'synthetic-password-06l3',true)).rejects.toMatchObject({code:'RELEASE_CONTEXT_INVALID'});expect(await targetStore.load()).toEqual(before);
  });
  it('L3FSRS25 explicit composite reset keeps the chosen interpreter while replacing only by the consented reset',async()=>{
    const s=await setup();await recordFsrsAttempt06l2(s,rubricScenarios06l2[2]);await s.app.reset(true);
    expect(s.app.learning.schedulingMode).toBe('reference-06e1');expect(s.app.learning.state.units).toEqual({});
    expect((await s.store.load()).events.find(e=>e.data.scope==='hme').versions).toEqual(REFERENCE_LEARNING_VERSIONS);
  });
  it('L3FSRS26 history reset does not silently return a corrected profile to legacy mode',async()=>{
    const s=await setup();await recordFsrsAttempt06l2(s,rubricScenarios06l2[2]);const owner=await HistoryApplication.open(s.store);await owner.reset(true);
    const raw=await s.store.load();expect(learningSchedulingMode(raw)).toBe('reference-06e1');expect(replayHistory(raw).learning.units).toEqual({});
  });
  it('L3FSRS27 impact review reports the actual stored interpreter without electing or migrating it',async()=>{
    const s=await setup();await recordFsrsAttempt06l2(s,rubricScenarios06l2[2]);const before=await s.store.load();
    const report=await reviewFsrsTransition06l2(before);
    expect(report.source.historicalAlgorithm).toBe(REFERENCE_FSRS_PROVENANCE.algorithmVersion);
    expect(report.summary.unitsWithChangedStateNumbers).toBe(0);expect(report.summary.unitsWithChangedRawDue).toBe(0);
    expect(report.executionAllowed).toBe(false);expect(report.migrationPerformed).toBe(false);expect(report.productionElectionChanged).toBe(false);
    expect(await s.store.load()).toEqual(before);
  });

  it('L3FSRS28 zero-unit reference backups still require their own scheduler capability on both owners',async()=>{
    const source=new MemoryEventStore(),access=await createSyntheticLearningAccess([fsrsUnit06l2]);
    const app=await CompositeApplication.open(source,{access,scheduling:'reference-06e1'}),password='synthetic-password-06l3';
    const encrypted=await app.exportBackup(password);
    for(const kind of ['history','composite']) {
      const store=new MemoryEventStore(),owner=kind==='history'?await HistoryApplication.open(store):await CompositeApplication.open(store),before=await store.load();
      await expect(owner.replaceFromBackup(encrypted,password,true)).rejects.toMatchObject({code:'RELEASE_CONTEXT_INVALID'});
      expect(await store.load()).toEqual(before);
    }
  });
  it('L3FSRS29 last plan event is durable, latest-only and detached from service-owned state',async()=>{
    const s=await setup();expect(s.app.learning.lastPlanEvent).toBeNull();
    const command=minutes=>({type:'PlanRecomputed',minutes,spentMinutes:0,futureLoadFeasible:false,candidates:[]});
    for(const [i,minutes]of[15,20,15].entries())await s.app.learning.send(command(minutes),{commandId:'test-l3-plan-'+i,at:offset06l2(baseTime06l2,i*1000)});
    const latest=s.app.learning.lastPlanEvent;expect(latest.commandId).toBe('test-l3-plan-2');expect(latest.data.command.minutes).toBe(15);
    latest.data.command.minutes=999;expect(s.app.learning.lastPlanEvent.data.command.minutes).toBe(15);
    const reopened=await CompositeApplication.open(s.store,{access:s.access});expect(reopened.learning.lastPlanEvent).toEqual(s.app.learning.lastPlanEvent);
    expect(s.app.learning.state.plans).toHaveLength(3);
  });

});
