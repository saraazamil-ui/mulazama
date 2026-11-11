import {describe,expect,it} from 'vitest';
import {createWeekReviewSnapshot} from './week-review-v211';
describe('Friday week snapshot',()=>{
 it('includes Saturday through the Friday start time, but not later or prior completions',()=>{
  const source=[{id:'old',completedAt:'2026-11-06T12:00:00Z',ranges:[{start:0,end:1}]},{id:'sat',completedAt:'2026-11-07T12:00:00Z',ranges:[{start:1,end:4}]},{id:'fri-before',completedAt:'2026-11-13T09:00:00Z',ranges:[{start:4,end:5}]},{id:'fri-after',completedAt:'2026-11-13T11:00:00Z',ranges:[{start:5,end:6}]}];
  const snapshot=createWeekReviewSnapshot({startedAt:'2026-11-13T10:00:00Z',zoneId:'Asia/Riyadh',sourceWatermark:'rev-1',completions:source});
  expect(snapshot.weekStart).toBe('2026-11-07');expect(snapshot.sourceCompletionIds).toEqual(['fri-before','sat']);expect(snapshot.ranges).toEqual([{start:1,end:5}]);
  source[1].ranges[0].end=9;expect(snapshot.ranges).toEqual([{start:1,end:5}]);
 });
 it('uses the account timezone at a Friday midnight boundary and rejects invalid inputs',()=>{
  const input={startedAt:'2026-11-12T21:10:00Z',zoneId:'Asia/Riyadh',sourceWatermark:'rev-1',completions:[]};
  expect(createWeekReviewSnapshot(input).weekStart).toBe('2026-11-07');
  expect(()=>createWeekReviewSnapshot({...input,zoneId:'UTC'})).toThrow('FRIDAY_REQUIRED');
  expect(()=>createWeekReviewSnapshot({...input,zoneId:'invalid'})).toThrow('INVALID_INPUT');
 });
});
