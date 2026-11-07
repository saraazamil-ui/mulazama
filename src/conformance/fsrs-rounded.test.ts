import {describe,it,expect} from 'vitest';
import {roundedCandidateProbe} from './fsrs-rounded-probe';
import {FSRS_CONFORMANCE_CASES} from './fsrs-suite';
import {RoundedFsrsAdapter} from '../core/fsrs-rounded';
import upstream from '../../references/fsrs-542-golden-vectors.json';
describe('FSRS 5.4.2 independently executed upstream vectors',()=>{
 for(const input of FSRS_CONFORMANCE_CASES)it(input.id,()=>{
  const vector=upstream.cases.find(c=>c.id===input.id);
  expect(vector?.expected).not.toBeNull();
  expect(roundedCandidateProbe.run(input)).toEqual(vector!.expected);
 });
 it('rejects historical research state without migration',()=>expect(()=>new RoundedFsrsAdapter().review({model:'FSRS-6',algorithmVersion:'hme-fsrs6-research-binary64-0.1.0',stability:5,difficulty:5,lastReviewAt:'2026-01-01T00:00:00Z'},3,'2026-01-02T00:00:00Z')).toThrow('explicit migration'));
});
