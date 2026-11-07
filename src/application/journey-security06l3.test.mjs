// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LearningJourney } from './journey06l3';
import { createEngineeringJourneyMaterial } from '../content/journey-material06l3';
import { createSyntheticLearningAccess } from '../testing/learning-access';
import { createBlockedLearningAccess } from '../release/access';
import { MemoryEventStore } from '../persistence/event-store';
import { currentRiyadhDate } from '../domain/state';

const units=Array.from({length:3},(_,i)=>({id:`test-l3-security-unit-${i+1}`,editionId:'test-l3-security-edition',probeProfileVersionId:'chunk-P0-1',words:8,coverage:Array.from({length:8},(_,n)=>`test-l3-security:${i+1}:${n}`)}));
const clean={attemptedWords:8,errors:0,completion:'complete',effort:'normal',gapVerified:false};
const range={id:'test-declaration',kind:'surah',start:1,end:1,editionId:'prototype-unverified',status:'declared_unassessed'};
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime('2026-11-07T09:00:00.000Z');});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
async function setup({minutes=15,prior=false,store=new MemoryEventStore(),configure=true}={}) {
 const material=createEngineeringJourneyMaterial(units),access=await createSyntheticLearningAccess(units);
 const journey=await LearningJourney.open(store,material,access,{scheduling:'reference-06e1'});
 if(configure)await journey.app.product.configureOnboarding({commandId:'test-onboarding',config:{...journey.app.product.state.config,configured:true,persona:prior?'returning':'beginner',goal:prior?'maintain':'memorize',minutes,days:[0,1,2,3,4,5,6]},ranges:prior?[range]:[]});
 return {journey,store,material,access};
}
async function configure(journey,patch) {return journey.app.product.dispatch({type:'config',config:{...journey.app.product.state.config,...patch}});}
async function recall(journey) {const s=await journey.start();await journey.action({type:'recall',sessionId:s.id,attemptId:crypto.randomUUID()});return journey.active;}
const planEvents=s=>s.events.filter(e=>e.data.scope==='hme'&&e.type==='PlanRecomputed');

describe('L3 journey safety: durable user actions, plan revisions and explicit self-report',()=>{
 it('L3JSEC01 blocked release and forged material fail before creating either event domain',async()=>{
  const store=new MemoryEventStore(),material=createEngineeringJourneyMaterial(units);const before=await store.load();
  for(const [scheduling,code] of [['legacy','RELEASE_GATES_BLOCKED'],['reference-06e1','RELEASE_CONTEXT_INVALID']]) {
   await expect(LearningJourney.open(store,material,createBlockedLearningAccess(),{scheduling})).rejects.toMatchObject({code});
   expect(await store.load()).toEqual(before);
  }
  await expect(LearningJourney.open(store,{...material},await createSyntheticLearningAccess(units),{scheduling:'reference-06e1'})).rejects.toMatchObject({code:'CONTENT_UNAVAILABLE'});
  expect(await store.load()).toEqual(before);
 });
 it('L3JSEC17 unsupported scheduling is rejected before creating even the product profile',async()=>{
  const store=new MemoryEventStore(),material=createEngineeringJourneyMaterial(units),access=await createSyntheticLearningAccess(units);
  const before=await store.load();await expect(LearningJourney.open(store,material,access,{scheduling:'unknown-future-interpreter'})).rejects.toMatchObject({code:'UNSUPPORTED_VERSION'});
  expect(await store.load()).toEqual(before);
 });
 it('L3JSEC18 a known but different requested interpreter never reinterprets or appends to the stored stream',async()=>{
  const {journey,store,material,access}=await setup();await journey.prepare();const before=await store.load();
  await expect(LearningJourney.open(store,material,access,{scheduling:'legacy'})).rejects.toMatchObject({code:'SCHEDULER_TRANSITION_REQUIRED'});
  expect(await store.load()).toEqual(before);
  const inferred=await LearningJourney.open(store,material,access);expect(inferred.app.learning.schedulingMode).toBe('reference-06e1');expect(await store.load()).toEqual(before);
 });
 it('L3JSEC19 restoring an unfinished recall exposes restart before permitting a self-assessment',async()=>{
  const {journey,store}=await setup();await journey.prepare();await recall(journey);const before=await store.load();
  const backup=await journey.app.exportBackup('synthetic-restore-recall-06l3');await journey.app.replaceFromBackup(backup,'synthetic-restore-recall-06l3',true);
  expect((await store.load()).events).toEqual(before.events);expect(journey.active.phase).toBe('recall');expect(journey.needsRestart).toBe(true);
  await expect(journey.quick('clean-normal')).rejects.toMatchObject({code:'INSUFFICIENT_EVIDENCE'});
  await journey.action({type:'restart',sessionId:journey.active.id,attemptId:'test-restored-restart'});expect(journey.needsRestart).toBe(false);
  await journey.quick('clean-normal');expect(journey.view().observations).toBe(1);expect((await store.load()).events.filter(e=>e.type==='AssessmentSubmitted')).toHaveLength(1);
 });
 it('L3JSEC20 ending an interrupted recall does not mark an entirely new attempt as interrupted',async()=>{
  const {journey}=await setup();await journey.prepare();const original=await recall(journey);await journey.action({type:'pause',sessionId:original.id});expect(journey.needsRestart).toBe(true);
  await journey.finish();expect(journey.needsRestart).toBe(false);const next=await recall(journey);expect(next.id).not.toBe(original.id);expect(next.attemptId).not.toBe(original.attemptId);expect(journey.needsRestart).toBe(false);
  await journey.quick('clean-normal');expect(journey.view().observations).toBe(1);
 });
 it('L3JSEC21 a recorded latest failure is visible even when P0 keeps the unit in Learning',async()=>{
  const {journey}=await setup();await journey.prepare();const active=await recall(journey);await journey.quick('memory-failure');await journey.finish();await journey.prepare();
  expect(journey.state.assessments[active.attemptId].strictPass).toBe(false);expect(journey.state.units[active.unitId].state.phase).toBe('Learning');
  expect(journey.view().weak).toContain(journey.unit(active.unitId).title);
 });
 it('L3JSEC22 a due follow-up is allowed after same-day work, but never before its due time or twice per opportunity',async()=>{
  // Five minutes leaves 4.25 usable after the existing P0 15% reserve: two real 2-minute activities fit.
  const {journey,store}=await setup({minutes:5});await journey.prepare();const first=await recall(journey);await journey.quick('memory-failure');await journey.finish();await journey.prepare();
  const due=Date.parse(journey.state.units[first.unitId].dates.policyDueAt);expect(due).toBeGreaterThan(Date.now());expect(currentRiyadhDate(new Date(due))).toBe(journey.view().day);
  expect(journey.view().next).toBeNull();expect(journey.view().completed).toBe(1);expect(journey.state.plans.at(-1).spentMinutes).toBe(2);
  vi.setSystemTime(due-1);await journey.prepare();expect(journey.view().next).toBeNull();
  vi.setSystemTime(due);await journey.prepare();expect(journey.view().next.unitId).toBe(first.unitId);expect(journey.view().next.id).toContain(journey.state.units[first.unitId].dates.policyDueAt);
  const second=await recall(journey);expect(second.id).not.toBe(first.id);await journey.quick('clean-normal');const before=await store.load();await journey.quick('clean-normal');expect(await store.load()).toEqual(before);
  await journey.finish();await journey.prepare();expect(journey.view().completed).toBe(2);expect(journey.state.plans.at(-1).spentMinutes).toBe(4);expect(journey.view().observations).toBe(2);expect(journey.view().successfulCoverage).toBe(8);expect(journey.view().next).toBeNull();
 });
 it('L3JSEC02 preparing an unconfigured profile does not fabricate a plan or learning activity',async()=>{
  const {journey,store}=await setup({configure:false});const before=await store.load();const view=await journey.prepare();
  expect(view.next).toBeNull();expect(view.observations).toBe(0);expect(await store.load()).toEqual(before);
 });
 it('L3JSEC03 repeating and reopening an unchanged plan does not append plan events or duplicate units',async()=>{
  const s=await setup();await s.journey.prepare();const before=await s.store.load();await s.journey.prepare();expect(await s.store.load()).toEqual(before);
  const reopened=await LearningJourney.open(s.store,s.material,s.access,{scheduling:'reference-06e1'});await reopened.prepare();expect(await s.store.load()).toEqual(before);
  expect(planEvents(before)).toHaveLength(1);expect(Object.keys(reopened.state.units)).toHaveLength(1);
 });
 it('L3JSEC04 changing budget 15 to 20 and back to 15 makes the last plan reflect the latest real choice',async()=>{
  const {journey,store}=await setup();await journey.prepare();await configure(journey,{minutes:20});await journey.prepare();await configure(journey,{minutes:15});await journey.prepare();
  const saved=await store.load();expect(journey.state.plans.at(-1).minutes).toBe(15);expect(planEvents(saved).map(e=>e.data.command.minutes)).toEqual([15,20,15]);
  expect(new Set(planEvents(saved).map(e=>e.commandId)).size).toBe(3);await journey.prepare();expect(await store.load()).toEqual(saved);
 });
 it('L3JSEC05 concurrent start requests create one session and repeated result clicks do not create two reviews',async()=>{
  const {journey,store}=await setup();await journey.prepare();const [a,b]=await Promise.all([journey.start(),journey.start()]);expect(a.id).toBe(b.id);
  await journey.action({type:'recall',sessionId:a.id,attemptId:'test-attempt'});await journey.quick('clean-normal');const before=await store.load();await journey.quick('clean-normal');expect(await store.load()).toEqual(before);
  expect(Object.keys(journey.state.sessions)).toHaveLength(1);expect(journey.view().observations).toBe(1);expect(journey.state.assessments['test-attempt'].independentVerification).toBe(false);
 });
 for(const termination of ['user_stop','technical_failure'])it(`L3JSEC06 ${termination} with a reported assessment is not completed daily work or spent cost`,async()=>{
  const {journey}=await setup();await journey.prepare();const s=await recall(journey);
  await journey.action({type:'complete',sessionId:s.id,termination});await journey.action({type:'assess',attemptId:s.attemptId,observation:clean});await journey.finish();await journey.prepare();
  expect(journey.view().completed).toBe(0);expect(journey.state.plans.at(-1).spentMinutes).toBe(0);expect(journey.view().next).not.toBeNull();expect(journey.state.assessments[s.attemptId].eligible).toBe(false);
 });
 it('L3JSEC07 a completed failed recall counts activity once but does not become successful coverage',async()=>{
  const {journey}=await setup();await journey.prepare();await recall(journey);await journey.quick('memory-failure');await journey.finish();await journey.prepare();
  expect(journey.view().completed).toBe(1);expect(journey.view().successfulCoverage).toBe(0);expect(journey.state.plans.at(-1).spentMinutes).toBe(2);expect(journey.view().observations).toBe(1);
 });
 it('L3JSEC08 zero daily time has no startable task and does not write a session when start is refused',async()=>{
  const {journey,store}=await setup({minutes:0});await journey.prepare();const before=await store.load();expect(journey.view().next).toBeNull();
  await expect(journey.start()).rejects.toMatchObject({code:'INVALID_INPUT'});expect(await store.load()).toEqual(before);expect(journey.view().completed).toBe(0);
 });
 it('L3JSEC09 estimated completed costs consume the same-day budget instead of resetting it on every plan',async()=>{
  const {journey}=await setup({minutes:4,prior:true});await journey.prepare();await recall(journey);await journey.quick('clean-normal');await journey.finish();await journey.prepare();
  const plan=journey.state.plans.at(-1);expect(plan.spentMinutes).toBe(2);expect(plan.plannedMinutes).toBeLessThanOrEqual(2);expect(journey.view().completed).toBe(1);
 });
 it('L3JSEC10 Riyadh midnight resets the daily view without deleting original self-reports',async()=>{
  vi.setSystemTime('2026-11-07T20:59:00.000Z');const {journey,store}=await setup();await journey.prepare();await recall(journey);await journey.quick('clean-normal');await journey.finish();const before=await store.load();
  expect(journey.view().completed).toBe(1);expect(journey.view().day).toBe('2026-11-07');
  vi.setSystemTime('2026-11-07T21:01:00.000Z');await journey.prepare();expect(journey.view().day).toBe('2026-11-08');expect(journey.view().completed).toBe(0);expect(journey.view().observations).toBe(1);expect((await store.load()).events.slice(0,before.events.length)).toEqual(before.events);
 });
 it('L3JSEC11 changing the goal and removing a declaration keeps all registered learning history',async()=>{
  const {journey,store}=await setup({prior:true});await journey.prepare();await recall(journey);await journey.quick('clean-normal');await journey.finish();const before=await store.load();const original=structuredClone(journey.state.attempts);
  await configure(journey,{goal:'memorize',startSurah:2});await journey.app.product.dispatch({type:'range.remove',id:journey.app.product.state.ranges[0].id});await journey.prepare();
  expect((await store.load()).events.slice(0,before.events.length)).toEqual(before.events);expect(journey.state.attempts).toEqual(original);expect(Object.keys(journey.state.units)).toHaveLength(3);
 });
 it('L3JSEC12 a backward clock rejects the new event and keeps durable and displayed state unchanged',async()=>{
  const {journey,store}=await setup();await journey.prepare();await journey.start();const before=await store.load(),state=journey.state;
  vi.setSystemTime('2026-11-07T08:59:59.999Z');await expect(journey.action({type:'repeat',sessionId:journey.active.id,mode:'reading'})).rejects.toMatchObject({code:'CLOCK_UNCERTAIN'});
  expect(await store.load()).toEqual(before);expect(journey.state).toEqual(state);
 });
 it('L3JSEC13 lost assessment acknowledgement retries the exact durable command once',async()=>{
  const root=new MemoryEventStore();let loseAck=false;
  const store={load:()=>root.load(),replace:(...args)=>root.replace(...args),clear:(...args)=>root.clear(...args),close(){},append:async(events,revision)=>{const result=await root.append(events,revision);if(loseAck&&events.some(e=>e.type==='AssessmentSubmitted')){loseAck=false;throw Error('test ack lost');}return result;}};
  const {journey}=await setup({store});await journey.prepare();await recall(journey);loseAck=true;
  await expect(journey.quick('clean-normal')).rejects.toThrow('test ack lost');const committed=await root.load();await journey.quick('clean-normal');
  expect(await root.load()).toEqual(committed);expect(journey.view().observations).toBe(1);expect(committed.events.filter(e=>e.type==='AssessmentSubmitted')).toHaveLength(1);
 });
 it('L3JSEC15 pausing recall requires a fresh attempt immediately, without waiting for a page reload',async()=>{
  const {journey}=await setup();await journey.prepare();const session=await recall(journey);const originalId=session.attemptId;
  await journey.action({type:'pause',sessionId:session.id});expect(journey.needsRestart).toBe(true);
  await expect(journey.quick('clean-normal')).rejects.toMatchObject({code:'INSUFFICIENT_EVIDENCE'});
  await journey.action({type:'restart',sessionId:session.id,attemptId:'test-restarted-after-pause'});
  expect(journey.needsRestart).toBe(false);expect(journey.active.attemptId).toBe('test-restarted-after-pause');expect(journey.state.attempts[originalId].assessment).toBeNull();
 });
 it('L3JSEC16 a day excluded from the selected weekly schedule has no activity unless an explicit today budget is set',async()=>{
  const {journey,store}=await setup();await configure(journey,{days:[0]});await journey.prepare();
  expect(journey.view().budget).toBe(0);expect(journey.view().next).toBeNull();const before=await store.load();await expect(journey.start()).rejects.toMatchObject({code:'INVALID_INPUT'});expect(await store.load()).toEqual(before);
  await journey.app.product.dispatch({type:'plan.todayBudget',minutes:5,localDate:currentRiyadhDate()});await journey.prepare();expect(journey.view().budget).toBe(5);expect(journey.view().next).not.toBeNull();
 });
 it('L3JSEC14 product and learning identity mismatch is rejected without erasing or repairing either domain',async()=>{
  const s=await setup();await s.journey.prepare();const raw=await s.store.load();const corrupted=structuredClone(raw.events);for(const e of corrupted)if(e.data.scope==='product')e.userId='test-other-profile';
  const target=new MemoryEventStore();await target.replace(corrupted,0);const before=await target.load();
  await expect(LearningJourney.open(target,s.material,s.access,{scheduling:'reference-06e1'})).rejects.toMatchObject({code:'REFERENCE_MISMATCH'});
  expect(await target.load()).toEqual(before);
 });
});
