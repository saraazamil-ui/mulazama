import {describe,it,expect} from 'vitest';
import {FsrsAdapter,FSRS_PROVENANCE,FSRS_WEIGHTS} from './fsrs';
import type {FsrsState} from './fsrs';
import type {Rating} from './hme-types';
import reference from './fixtures/fsrs6-research-reference.json';
const adapter=new FsrsAdapter();
const at=(days:number)=>new Date(Date.UTC(2026,0,1)+days*86400000).toISOString();
const state=(s=5,d=5):FsrsState=>({stability:s,difficulty:d,lastReviewAt:at(0),model:'FSRS-6',algorithmVersion:FSRS_PROVENANCE.algorithmVersion});
describe('FSRS6 arithmetic reference checks; released library conformance is BLOCKED',()=>{
 it('labels unverified library parity and does not claim production approval',()=>{expect(FSRS_PROVENANCE.libraryConformance).toBe('blocked');expect(FSRS_PROVENANCE.installedLibraryVersion).toBeNull();expect(FSRS_PROVENANCE.approvedForProduction).toBe(false);expect(FSRS_WEIGHTS).toHaveLength(21);});
 it('pins the HME21-weight vector rather than FSRS7 default parameters',()=>expect(FSRS_WEIGHTS).toEqual(reference.metadata.parameters));
 it.each([1,2,3,4] as Rating[])('initialization grade%s matches independent prior Python result',grade=>{const r=adapter.review(null,grade,at(0));const expected=reference.initialization_all_grades[String(grade) as '1'];expect(r.state.stability).toBeCloseTo(expected.S,12);expect(r.state.difficulty).toBeCloseTo(expected.D,12);});
 it.each([1,2,3,4] as Rating[])('same-day grade%s matches independent prior Python result',grade=>{const r=adapter.review(state(),grade,at(0));const expected=reference.same_day_all_grades_from_S5_D5[String(grade) as '1'];expect(r.state.stability).toBeCloseTo(expected.S,12);expect(r.state.difficulty).toBeCloseTo(expected.D,12);});
 it('Good at day5 and Again at day12 match HME §19 binary64 reference',()=>{
  const day5=adapter.review(state(),3,at(5));expect(day5.retrievabilityBefore).toBeCloseTo(.9,12);expect(day5.state.stability).toBeCloseTo(17.36151270957657,12);expect(day5.state.difficulty).toBeCloseTo(4.9902283692968386,12);
  const day12=adapter.review(day5.state,1,at(12));expect(day12.state.stability).toBeCloseTo(1.6775146433759944,12);expect(day12.state.difficulty).toBeCloseTo(8.338550500731797,12);expect(adapter.retrievability(day12.state,at(42))).toBeCloseTo(.6375084334942914,12);
  expect(day5.rawDueAt).toBe(at(22));expect(day5.exactIntervalDays).toBeCloseTo(17.36151270957657,12);
 });
 it('absence predicts R without mutating S,D,last review or producing a review event',()=>{const old=state();const before=structuredClone(old);expect(adapter.retrievability(old,at(30))).toBeLessThan(.9);expect(old).toEqual(before);});
 it('R(S)=0.9 and inverse interval identity across scales',()=>{for(const s of [.001,1,5,100,36500]){expect(adapter.curve(s,s)).toBeCloseTo(.9,12);expect(adapter.exactInterval(s,.9)).toBeCloseTo(s,12);}});
 it('higher desired retention shortens interval without changing memory state',()=>{expect(adapter.exactInterval(5,.95)/adapter.exactInterval(5,.9)).toBeCloseTo(.40255869,8);const high=new FsrsAdapter({desiredRetention:.95}).review(state(),3,at(5));const standard=adapter.review(state(),3,at(5));expect(high.state).toEqual(standard.state);expect(high.desiredRetention).toBe(.95);expect(high.configurationVersion).not.toBe(standard.configurationVersion);});
 it('floor elapsed24-hour time policy preserves raw timestamp',()=>{const r=adapter.review(state(),3,at(.9999));expect(r.elapsedDays).toBe(0);expect(r.state.lastReviewAt).toBe(at(.9999));expect(adapter.review(state(),3,at(1)).elapsedDays).toBe(1);});
 it('240 boundary/branch combinations remain finite and bounded',()=>{let tested=0;for(const s of [.001,.01,5,100,36500])for(const d of [1,5,10])for(const elapsed of [0,1,30,36500])for(const g of [1,2,3,4] as Rating[]){const r=adapter.review(state(s,d),g,at(elapsed));expect(r.state.stability).toBeGreaterThanOrEqual(.001);expect(r.state.stability).toBeLessThanOrEqual(36500);expect(r.state.difficulty).toBeGreaterThanOrEqual(1);expect(r.state.difficulty).toBeLessThanOrEqual(10);expect(Number.isFinite(r.exactIntervalDays)).toBe(true);tested++;}expect(tested).toBe(240);});
 it('same-day Hard,Good,Easy cannot lower stability',()=>{for(const g of [2,3,4] as Rating[])expect(adapter.review(state(),g,at(0)).state.stability).toBeGreaterThanOrEqual(5);});
 it('uses raw D0(Easy) in reversion and previous D in stability',()=>{const w=FSRS_WEIGHTS;const raw=w[4]-Math.exp(w[5]*3)+1;expect(raw).toBeLessThan(1);expect(adapter.review(state(),3,at(5)).state.difficulty).toBeCloseTo(w[7]*raw+(1-w[7])*5,12);});
 it('rejects incompatible models/versions instead of silently reinterpreting old results',()=>{expect(()=>adapter.review({...state(),model:'FSRS-7' as 'FSRS-6'},3,at(1))).toThrow('UNSUPPORTED_VERSION');expect(()=>adapter.review({...state(),algorithmVersion:'other'},3,at(1))).toThrow('UNSUPPORTED_VERSION');expect(()=>new FsrsAdapter({weights:FSRS_WEIGHTS.map((x,i)=>i===0?x+1:x)})).toThrow('UNSUPPORTED_VERSION');});
 it('rejects negative time,NaN,invalid ratings and unbounded intervals',()=>{expect(()=>adapter.review(state(),3,at(-1))).toThrow('CLOCK');expect(()=>adapter.review(state(),0 as Rating,at(0))).toThrow('INVALID_INPUT');expect(()=>adapter.curve(NaN,5)).toThrow('INVALID_INPUT');expect(()=>adapter.curve(1,0)).toThrow('INVALID_INPUT');expect(()=>adapter.exactInterval(5,Number.MIN_VALUE)).toThrow('non-finite interval');expect(()=>new FsrsAdapter({desiredRetention:1})).toThrow('INVALID_INPUT');});
});
