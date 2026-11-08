// @vitest-environment node
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { LearningJourney } from './journey06l3';
import { MushafStudyController,resolveStudyRange } from './mushaf-study10b';
import { createEngineeringJourneyMaterial } from '../content/journey-material06l3';
import { createSyntheticLearningAccess } from '../testing/learning-access';
import { MemoryEventStore } from '../persistence/event-store';

const units=Array.from({length:3},(_,i)=>({id:`test-10b-unit-${i+1}`,editionId:'test-10b-edition',probeProfileVersionId:'chunk-P0-1',words:8,coverage:Array.from({length:8},(_,n)=>`test-10b-edition:1:${i+1}:${n}`)}));
const range=(fromAyah=1,toAyah=fromAyah)=>({surah:1,fromAyah,toAyah});
const coverageForRange=r=>units.slice(r.fromAyah-1,r.toAyah).flatMap(unit=>unit.coverage);
function storage(){const data=new Map();return {data,getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime('2026-11-07T09:00:00.000Z');});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
async function setup({minutes=15,goal='maintain',store=new MemoryEventStore(),preferences=storage()}={}){
  const material=createEngineeringJourneyMaterial(units),access=await createSyntheticLearningAccess(units);
  const journey=await LearningJourney.open(store,material,access,{scheduling:'reference-06e1'});
  await journey.app.product.configureOnboarding({commandId:'test-10b-onboarding',config:{...journey.app.product.state.config,configured:true,persona:'returning',goal,minutes,days:[0,1,2,3,4,5,6]},ranges:[]});
  const controller=new MushafStudyController(journey,{databaseName:'test-10b-database',storage:preferences,coverageForRange});
  return {journey,controller,store,material,access,preferences};
}
const catalog=()=>({catalogUnits:createEngineeringJourneyMaterial(units).units});

describe('10-B exact reader selection and existing learning journey',()=>{
  it('resolves ordered whole units and handles repeated token/page positions within an ayah',()=>{
    const c=catalog();c.catalogUnits[1].positions.push({surah:1,ayah:2,page:2,juz:1});
    expect(resolveStudyRange(c,range(2,3),coverageForRange(range(2,3)))).toEqual([units[1].id,units[2].id]);
    expect(()=>resolveStudyRange(c,range(2,3),[...coverageForRange(range(2,3))].reverse())).toThrow(expect.objectContaining({code:'REFERENCE_MISMATCH'}));
  });
  it('rejects malformed ranges, gaps, and a unit crossing the requested boundary',()=>{
    for(const r of [range(0),range(3,2),{...range(),surah:115},range(1,1.5)])expect(()=>resolveStudyRange(catalog(),r)).toThrow();
    const gap=catalog();gap.catalogUnits.splice(1,1);expect(()=>resolveStudyRange(gap,range(1,3))).toThrow(/آية غير ممثلة/);
    const partial=catalog();partial.catalogUnits[0].positions.push({surah:1,ayah:2,page:1,juz:1});expect(()=>resolveStudyRange(partial,range(1))).toThrow(/يقطع وحدة/);
  });
  it('rejects mixed editions, duplicate coverage and a missing verified trailing token',()=>{
    const mixed=catalog();mixed.catalogUnits[2].unit.editionId='test-other-edition';expect(()=>resolveStudyRange(mixed,range(1))).toThrow(/طبعات مختلفة/);
    const overlap=catalog();overlap.catalogUnits[1].unit.coverage[0]=overlap.catalogUnits[0].unit.coverage[0];expect(()=>resolveStudyRange(overlap,range(1,2))).toThrow(/تغطية مكررة/);
    expect(()=>resolveStudyRange(catalog(),range(1),[...units[0].coverage,'test-10b-edition:1:1:8'])).toThrow(/جميع مواضع/);
  });
  it('selection writes no learner fact or prior-memorization declaration and getters are detached',async()=>{
    const {journey,controller,store}=await setup();const before=await store.load();
    const result=controller.select(range(2));result.unitIds[0]='foreign';result.range.fromAyah=1;
    const selected=journey.memorizationTarget;selected.push('foreign');const c=journey.catalogUnits;c[0].unit.coverage.length=0;
    expect(controller.current.range).toEqual(range(2));expect(journey.memorizationTarget).toEqual([units[1].id]);
    expect(journey.catalogUnits[0].unit.coverage).toEqual(units[0].coverage);expect(await store.load()).toEqual(before);
    expect(journey.app.product.state.ranges).toEqual([]);expect(journey.view().observations).toBe(0);expect(Object.keys(journey.state.units)).toHaveLength(0);
  });
  it('an explicit new target works with a maintenance goal without overwriting that goal or producing an assessment',async()=>{
    const {journey,controller,store}=await setup();controller.select(range(2));await journey.prepare();
    expect(journey.app.product.state.config.goal).toBe('maintain');expect(journey.view().next).toMatchObject({unitId:units[1].id,kind:'new'});
    const session=await journey.start();expect(session.unitId).toBe(units[1].id);expect(journey.state.units[units[1].id].memory).toBeNull();
    expect((await store.load()).events.filter(e=>e.type==='AssessmentSubmitted'||e.type==='MemorizedRangeDeclared')).toHaveLength(0);
  });
  it('restores only revalidated range intent and ignores supplied unit IDs',async()=>{
    const s=await setup();s.controller.select(range(3));const before=await s.store.load();
    s.preferences.setItem(s.controller.storageKey,JSON.stringify({schemaVersion:1,editionId:units[0].editionId,range:range(3),unitIds:['foreign']}));
    const reopened=await LearningJourney.open(s.store,s.material,s.access);
    const controller=new MushafStudyController(reopened,{databaseName:'test-10b-database',storage:s.preferences,coverageForRange});
    expect(controller.current).toBeNull();expect(reopened.memorizationTarget).toBeNull();
    expect(controller.restore().unitIds).toEqual([units[2].id]);expect(await s.store.load()).toEqual(before);
    await reopened.prepare();expect(reopened.view().next.unitId).toBe(units[2].id);
  });
  it('corrupt or foreign-edition preferences clear only in-memory intent and preserve all learner facts',async()=>{
    const s=await setup();s.controller.select(range(1));await s.journey.prepare();const before=await s.store.load();
    for(const raw of ['not-json',JSON.stringify({schemaVersion:1,editionId:'test-other',range:range(1)}),JSON.stringify({schemaVersion:1,editionId:units[0].editionId,range:range(99)})]){
      s.preferences.setItem(s.controller.storageKey,raw);expect(s.controller.restore()).toBeNull();expect(s.journey.memorizationTarget).toBeNull();expect(await s.store.load()).toEqual(before);
    }
  });
  it('failed preference writes or deletion leave the confirmed target unchanged',async()=>{
    const s=await setup();s.controller.select(range(1));const before=await s.store.load();
    s.preferences.setItem=()=>{throw Error('STORAGE_FULL');};
    expect(()=>s.controller.select(range(2))).toThrow('STORAGE_FULL');expect(s.controller.current.range).toEqual(range(1));expect(s.journey.memorizationTarget).toEqual([units[0].id]);
    s.preferences.removeItem=()=>{throw Error('WRITE_NOT_CONFIRMED');};expect(()=>s.controller.clear()).toThrow('WRITE_NOT_CONFIRMED');expect(s.controller.current.range).toEqual(range(1));expect(await s.store.load()).toEqual(before);
  });
  it('keeps protected due review ahead of a newly selected unit',async()=>{
    const s=await setup({minutes:5});s.controller.select(range(1));const session=await s.journey.start();
    await s.journey.action({type:'recall',sessionId:session.id,attemptId:'test-10b-due'});await s.journey.quick('memory-failure');await s.journey.finish();
    const old=await s.store.load(),due=s.journey.state.units[units[0].id].dates.policyDueAt;vi.setSystemTime(due);
    s.controller.select(range(3));await s.journey.prepare();expect(s.journey.view().next).toMatchObject({unitId:units[0].id,protected:true});
    expect((await s.store.load()).events.slice(0,old.events.length)).toEqual(old.events);expect(s.journey.app.product.state.config.goal).toBe('maintain');
  });
  it('selection respects zero budget and foreign IDs cannot register or replace a valid target',async()=>{
    const s=await setup({minutes:0});s.controller.select(range(2));const before=await s.store.load();
    for(const ids of [['foreign'],[units[0].id,units[0].id],[]])expect(()=>s.journey.setMemorizationTarget(ids)).toThrow(expect.objectContaining({code:'REFERENCE_MISMATCH'}));
    expect(s.journey.memorizationTarget).toEqual([units[1].id]);expect(await s.store.load()).toEqual(before);
    await s.journey.prepare();expect(s.journey.view().next).toBeNull();expect(Object.keys(s.journey.state.units)).toHaveLength(0);await expect(s.journey.start()).rejects.toMatchObject({code:'INVALID_INPUT'});
  });
  it('a rejected registration can retry the same intent without duplicate units or invented results',async()=>{
    const root=new MemoryEventStore();let reject=true;
    const store={load:()=>root.load(),replace:(...args)=>root.replace(...args),clear:(...args)=>root.clear(...args),close(){},append:async(events,revision)=>{if(reject&&events.some(e=>e.type==='UnitRegistered')){reject=false;throw Error('WRITE_UNCONFIRMED');}return root.append(events,revision);}};
    const s=await setup({store});s.controller.select(range(2));const before=await root.load();
    await expect(s.journey.prepare()).rejects.toThrow('WRITE_UNCONFIRMED');expect(await root.load()).toEqual(before);expect(s.controller.current.range).toEqual(range(2));
    await s.journey.prepare();await s.journey.prepare();const after=await root.load();expect(after.events.filter(e=>e.type==='UnitRegistered')).toHaveLength(1);expect(after.events.filter(e=>e.type==='AssessmentSubmitted')).toHaveLength(0);
  });
  it('existing assessment and resume APIs retain one result for a selected target across reopen',async()=>{
    const s=await setup();s.controller.select(range(2));const session=await s.journey.start();
    await s.journey.action({type:'recall',sessionId:session.id,attemptId:'test-10b-result'});await s.journey.quick('clean-normal');const before=await s.store.load();
    const reopened=await LearningJourney.open(s.store,s.material,s.access);
    expect(reopened.active.unitId).toBe(units[1].id);expect(reopened.active.phase).toBe('assessment');expect(reopened.view().observations).toBe(1);expect(reopened.state.units[units[1].id].memory).not.toBeNull();
    expect((await s.store.load()).events).toEqual(before.events);await reopened.quick('clean-normal');expect((await s.store.load()).events).toEqual(before.events);
  });
  it('preference keys isolate runtime databases and profiles and a controller requires a verified map callback',async()=>{
    const s=await setup();s.controller.select(range(1));const other=new MushafStudyController(s.journey,{databaseName:'test-other-db',storage:s.preferences,coverageForRange});expect(other.storageKey).not.toBe(s.controller.storageKey);expect(other.restore()).toBeNull();
    expect(()=>new MushafStudyController(s.journey,{databaseName:'test',storage:s.preferences})).toThrow(expect.objectContaining({code:'CONTENT_UNAVAILABLE'}));
  });
  it('a reset profile cannot inherit or write the previous profile target',async()=>{
    const s=await setup();s.controller.select(range(2));const oldPreference=s.preferences.getItem(s.controller.storageKey);
    await s.journey.app.reset(true);expect(s.controller.current).toBeNull();expect(s.journey.memorizationTarget).toBeNull();
    expect(()=>s.controller.select(range(1))).toThrow(expect.objectContaining({code:'REFERENCE_MISMATCH'}));expect(()=>s.controller.restore()).toThrow(expect.objectContaining({code:'REFERENCE_MISMATCH'}));
    const newController=new MushafStudyController(s.journey,{databaseName:'test-10b-database',storage:s.preferences,coverageForRange});
    expect(newController.storageKey).not.toBe(s.controller.storageKey);expect(newController.restore()).toBeNull();expect(s.preferences.getItem(s.controller.storageKey)).toBe(oldPreference);
    await s.journey.prepare();expect(s.journey.view().next).toBeNull();
  });
});
