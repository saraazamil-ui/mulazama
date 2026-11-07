// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {writeFileSync} from 'node:fs';
import {MemoryEventStore} from '../persistence/event-store';
import {VERSIONS} from '../core/types';
import {planDay} from '../core/hme';
import {ApplicationService} from './service';
describe('bounded engineering measurements (Node, synthetic data, no device performance claims)',()=>{
 it('PERF01 measures planner, event batch and replay in the available host',async()=>{
  const measure=async(action)=>{const start=performance.now();const value=await action();return {value,ms:performance.now()-start};};
  const candidates=Array.from({length:1000},(_,i)=>({id:'candidate-'+i,unitId:'u-'+i,kind:'review',costMinutes:2,priority:i,coverageKeys:['synthetic-'+i]}));
  const planner=await measure(()=>planDay({minutes:120,candidates,futureLoadFeasible:true}));
  expect(planner.value.plannedMinutes).toBeLessThanOrEqual(102);
  const events=Array.from({length:10000},(_,i)=>({eventId:'event-'+i,commandId:'command-'+i,operationId:'command-'+i,userId:'synthetic-local-user',unitId:null,type:'SyntheticBenchmarkOnly',occurredAt:'2026-11-05T00:00:00.000Z',receivedAt:'2026-11-05T00:00:00.000Z',zoneId:'Asia/Riyadh',source:'product',coverage:[],versions:VERSIONS,data:{count:i}}));
  const store=new MemoryEventStore();const append=await measure(()=>store.append(events,0));expect(append.value.events).toHaveLength(10000);
  const load=await measure(()=>store.load());expect(load.value.events).toHaveLength(10000);
  const productStore=new MemoryEventStore(),app=await ApplicationService.open(productStore);
  for(let i=0;i<100;i++)await app.dispatch({type:'preferences',patch:{dark:i%2===0}});
  const replay=await measure(()=>app.refresh());expect(replay.value.revision).toBe(100);
  const report={environment:{node:process.version,platform:process.platform,arch:process.arch},synthetic:true,measurementsMs:{plan1000Candidates:planner.ms,memoryAtomicAppend10000:append.ms,memoryLoad10000:load.ms,productReplay100Events:replay.ms},heapUsedBytes:process.memoryUsage().heapUsed,limitations:['Memory reference adapter, not IndexedDB','Host Node, not cold app start or mobile device','No P95, power-loss, UI responsiveness or native memory certification']};
  writeFileSync('docs/05b/evidence/performance-results.json',JSON.stringify(report,null,2)+'\n');
 });
});
