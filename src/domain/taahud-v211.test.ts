import {describe,it,expect} from 'vitest';
import {addCivilDays,distributeTaahud,partialCompletion,unionRanges} from './taahud-v211';
const distribute=(n:number,d:number)=>distributeTaahud({ranges:n?[{start:0,end:n}]:[],cycleDays:d,anchorDate:'2026-11-07'}).assignments.map(x=>x.count);
describe('TAAHUD-POLICY-1.0 independent primitives',()=>{
 it('matches the specified 23/7, 3/7, exact and empty examples',()=>{
  expect(distribute(23,7)).toEqual([4,3,3,4,3,3,3]);
  expect(distribute(3,7)).toEqual([1,0,1,0,1,0,0]);
  expect(distribute(14,7)).toEqual([2,2,2,2,2,2,2]);
  expect(distribute(0,7)).toEqual([0,0,0,0,0,0,0]);
 });
 it('unions overlaps without filling gaps and distributes source order',()=>{
  expect(unionRanges([{start:8,end:12},{start:1,end:4},{start:2,end:3}])).toEqual([{start:1,end:4},{start:8,end:12}]);
  const days=distributeTaahud({ranges:[{start:1,end:4},{start:8,end:12}],cycleDays:2,anchorDate:'2026-11-07'}).assignments;
  expect(days[0].ranges).toEqual([{start:1,end:4},{start:8,end:9}]);expect(days[1].ranges).toEqual([{start:9,end:12}]);
 });
 it('keeps manual reservations fixed and excludes them from automatic assignments',()=>{
  const reservation={id:'manual-1',dueDate:'2027-01-01',ranges:[{start:4,end:6}]};
  const result=distributeTaahud({ranges:[{start:1,end:9}],cycleDays:2,anchorDate:'2026-11-07',reservations:[reservation]});
  expect(result.reservations).toEqual([reservation]);expect(result.assignments.flatMap(x=>x.ranges)).toEqual([{start:1,end:4},{start:6,end:9}]);
  expect(()=>distributeTaahud({ranges:[{start:1,end:9}],cycleDays:2,anchorDate:'2026-11-07',reservations:[reservation,{...reservation,id:'manual-2'}]})).toThrow('SCHEDULE_CONFLICT');
 });
 it('reschedules only completed ranges as a proposal and preserves remaining due date',()=>{
  expect(partialCompletion({dueDate:'2026-11-07',actualLocalDate:'2026-11-08',cycleDays:7,scheduled:[{start:1,end:21}],completed:[{start:1,end:9}]})).toEqual({remaining:{dueDate:'2026-11-07',ranges:[{start:9,end:21}]},proposedNext:{dueDate:'2026-11-15',ranges:[{start:1,end:9}]}});
 });
 it('validates ranges, dates and cycles and uses civil-day arithmetic',()=>{
  expect(addCivilDays('2026-12-31',1)).toBe('2027-01-01');
  expect(()=>addCivilDays('2026-02-30',1)).toThrow('INVALID_INPUT');
  expect(()=>distribute(2,0)).toThrow('INVALID_INPUT');
  expect(()=>unionRanges([{start:3,end:3}])).toThrow('INVALID_INPUT');
 });
});
