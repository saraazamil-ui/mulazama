// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {ApplicationService,replayProduct} from './service';
import {MemoryEventStore} from '../persistence/event-store';
import {VERSIONS} from '../core/types';
describe('05A real product contracts and durable projection',()=>{
  it('AS01 all C01–C14 read paths return real metadata or an explicit unavailable error',async()=>{
    const s=await ApplicationService.open(new MemoryEventStore());
    const queries={C01:{operation:'read'},C02:{operation:'read'},C03:{operation:'diagnostic'},C04:{operation:'read'},C05:{operation:'read'},C06:{operation:'read'},C07:{operation:'read',attemptId:'unknown'},C08:{operation:'read'},C09:{operation:'read'},C10:{operation:'forecast'},C11:{operation:'read'},C12:{operation:'inspect',serialized:'{}'},C13:{operation:'read'},C14:{operation:'read'}} as const;
    const count=s.eventCount;
    for(const [id,q] of Object.entries(queries)){
      const result=s.query(id as keyof typeof queries,q);expect(result).toHaveProperty('ok');
      if(result.ok&&'meta' in result.value)expect(result.value.meta.source).toBe('event-store');
    }
    expect(s.eventCount).toBe(count);expect(s.state.attempts).toHaveLength(0);
  });
  it('AS02 configuration and same-axis overlapping declarations replay identically after reopening',async()=>{
    const store=new MemoryEventStore(),s=await ApplicationService.open(store);
    await s.dispatch({type:'config',config:{...s.state.config,minutes:60,configured:true}});
    for(const [id,start,end]of[['a',1,5],['b',4,7],['c',20,20]] as const)await s.dispatch({type:'range.add',range:{id,kind:'juz',start,end,editionId:'prototype-unverified',status:'declared_unassessed'}});
    expect(s.state.ranges.map(r=>[r.start,r.end])).toEqual([[1,7],[20,20]]);
    const reopened=await ApplicationService.open(store);expect(reopened.state).toEqual(s.state);
    expect(replayProduct(await store.load())).toEqual(s.state);
  });
  it('AS03 optional undefined selectors normalize to valid persisted JSON without filling gaps',async()=>{
    const store=new MemoryEventStore(),s=await ApplicationService.open(store);
    await s.dispatch({type:'range.add',range:{id:'r1',kind:'surah',start:1,end:1,surah:undefined,layoutId:undefined,editionId:'prototype-unverified',status:'declared_unassessed'}});
    expect(s.state.ranges).toHaveLength(1);expect((await store.load()).events.at(-1)!.data).not.toHaveProperty('action.range.surah');
  });
  it('AS04 a command retry preserves one event and rejects a different payload',async()=>{
    const s=await ApplicationService.open(new MemoryEventStore());const c={type:'preferences' as const,patch:{dark:true},commandId:'once'};
    await s.dispatch(c);const count=s.eventCount;await s.dispatch(c);expect(s.eventCount).toBe(count);
    await expect(s.dispatch({...c,patch:{dark:false}})).rejects.toMatchObject({code:'EVENT_CONFLICT'});
  });
  it('AS05 a failed durable write cannot advance the visible configuration',async()=>{
    let failing=false;const store=new MemoryEventStore(()=>{if(failing)throw Error('storage full');});const s=await ApplicationService.open(store);failing=true;
    const before=s.state;await expect(s.dispatch({type:'preferences',patch:{dark:true}})).rejects.toThrow('storage full');expect(s.state).toEqual(before);
  });
  it('AS06 today budget does not rewrite the regular budget or create fake tasks',async()=>{
    const s=await ApplicationService.open(new MemoryEventStore());await s.dispatch({type:'plan.todayBudget',minutes:0,localDate:'2026-11-05'});
    expect(s.state.config.minutes).toBe(30);expect(s.state.todayBudget?.minutes).toBe(0);
    const plan=s.query('C04',{operation:'read',localDate:'2026-11-05'});expect(plan.ok&&plan.value.tasks).toEqual([]);
    expect(s.state.attempts).toHaveLength(0);
  });
  it('AS07 content-disabled learning commands cannot fabricate attempts',async()=>{
    const s=await ApplicationService.open(new MemoryEventStore());const count=s.eventCount;
    await expect(s.dispatch({type:'session.start',kind:'new',rangeLabel:'not-approved'})).rejects.toMatchObject({code:'RELEASE_GATES_BLOCKED'});
    expect(s.eventCount).toBe(count);
  });
  it('AS08 backup restores by replacement with original timestamps and a fresh CAS receipt',async()=>{
    const s=await ApplicationService.open(new MemoryEventStore()),password='اختبار-نسخة-طويلة-2026';
    await s.dispatch({type:'preferences',patch:{dark:true}});const original=s.state,backup=await s.exportBackup(password);
    await s.dispatch({type:'preferences',patch:{dark:false}});expect((await s.inspectBackup(backup,password)).compatible).toBe(true);
    await expect(s.replaceFromBackup(backup,password,false)).rejects.toMatchObject({code:'CONSENT_REQUIRED'});
    await s.replaceFromBackup(backup,password,true);expect(s.state).toEqual(original);const count=s.eventCount;
    await s.replaceFromBackup(backup,password,true);expect(s.eventCount).toBe(count);
  });
  it('AS09 reset removes all raw personal history and retains settings with a new local identity',async()=>{
    const store=new MemoryEventStore(),s=await ApplicationService.open(store);await s.dispatch({type:'preferences',patch:{dark:true}});const id=s.state.profileId;
    await s.dispatch({type:'reset'});expect(s.eventCount).toBe(1);expect(s.state.profileId).not.toBe(id);expect(s.state.preferences.dark).toBe(true);expect(s.state.ranges).toEqual([]);
  });
  it('AS10 changed event/model versions are rejected without overwriting current raw data',async()=>{
    const store=new MemoryEventStore();await ApplicationService.open(store);const snapshot=await store.load();
    snapshot.events[0].versions={...VERSIONS,algorithm:'unknown-version'} as unknown as typeof VERSIONS;
    await store.replace(snapshot.events,snapshot.revision);const corrupt=await store.load();
    await expect(ApplicationService.open(store)).rejects.toMatchObject({code:'UNSUPPORTED_VERSION'});expect(await store.load()).toEqual(corrupt);
  });
  it('AS11 a stale tab must reload after a revision conflict',async()=>{
    const store=new MemoryEventStore(),a=await ApplicationService.open(store),b=await ApplicationService.open(store);
    await a.dispatch({type:'preferences',patch:{dark:true}});
    await expect(b.dispatch({type:'preferences',patch:{largeText:true}})).rejects.toMatchObject({code:'REVISION_CONFLICT'});
    await b.refresh();await b.dispatch({type:'preferences',patch:{largeText:true}});expect(b.state.preferences).toMatchObject({dark:true,largeText:true});
  });
});
