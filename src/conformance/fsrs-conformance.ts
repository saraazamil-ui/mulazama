import { FSRS_PROVENANCE, FSRS_WEIGHTS, FsrsAdapter } from '../core/fsrs';
import type { FsrsState } from '../core/fsrs';
import type { ConformanceCase, MemorySeed } from './fsrs-suite';
import { FSRS_CONFORMANCE_CASES, REQUIRED_FSRS_BRANCHES } from './fsrs-suite';

export const FSRS_REFERENCE_PIN=Object.freeze({
  name:'ts-fsrs',version:'5.4.2',model:'FSRS-6',
  sourceCommit:'bb71e35a2f5af5a5ac6cce9ef7c41ad24855721d',
  sourceUrl:'https://github.com/open-spaced-repetition/ts-fsrs/releases/tag/v5.4.2',
});
/** Strict enough to reveal eight-decimal library rounding, not mask it. */
export const FSRS_TOLERANCE=Object.freeze({absolute:1e-12,relative:1e-12});
export interface Observable {
  stability:number; difficulty:number; retrievabilityBefore:number|null;
  elapsedDays:number; roundedIntervalDays:number; rawDueAt:string;
}
export interface Probe {
  run(input:ConformanceCase):readonly Observable[];
}
export interface ReferenceIdentity {
  name:string;version:string;model:string;sourceCommit:string;
  artifactSha512:string;filesVerified:number;weights:readonly number[];
  enableShortTerm:boolean;enableFuzz:boolean;executed:boolean;
}
export interface LibraryReference {identity:ReferenceIdentity;probe:Probe}
export type ConformanceStatus='blocked'|'nonconformant'|'conformant';
export interface CaseResult {
  id:string;branch:string;status:ConformanceStatus;
  expected:readonly Observable[]|null;actual:readonly Observable[]|null;
  delta:readonly Record<string,number|null>[]|null;issues:string[];
}
const numericKeys=['stability','difficulty','retrievabilityBefore','elapsedDays','roundedIntervalDays'] as const;
function finiteOutput(output:readonly Observable[],count:number):boolean {
  return output.length===count&&output.every(v=>v!==null&&typeof v==='object'&&
    numericKeys.every(k=>k==='retrievabilityBefore'&&v[k]===null||typeof v[k]==='number'&&Number.isFinite(v[k]))&&
    v.stability>0&&v.difficulty>=1&&v.difficulty<=10&&v.elapsedDays>=0&&Number.isInteger(v.elapsedDays)&&
    Number.isInteger(v.roundedIntervalDays)&&v.roundedIntervalDays>=1&&v.roundedIntervalDays<=36500&&
    (v.retrievabilityBefore===null||v.retrievabilityBefore>=0&&v.retrievabilityBefore<=1)&&
    typeof v.rawDueAt==='string'&&Number.isFinite(Date.parse(v.rawDueAt)));
}
function sameNumbers(a:number,b:number):boolean {
  return Math.abs(a-b)<=FSRS_TOLERANCE.absolute+FSRS_TOLERANCE.relative*Math.max(Math.abs(a),Math.abs(b));
}
export function validateReferenceIdentity(identity:ReferenceIdentity):string[] {
  const issues:string[]=[];
  for(const key of ['name','version','model','sourceCommit'] as const)if(identity[key]!==FSRS_REFERENCE_PIN[key])issues.push(`REFERENCE_${key.toUpperCase()}_MISMATCH`);
  if(!/^sha512-[A-Za-z0-9+/]{86}==$/.test(identity.artifactSha512))issues.push('REFERENCE_ARTIFACT_DIGEST_MISSING');
  if(!Number.isInteger(identity.filesVerified)||identity.filesVerified<3)issues.push('REFERENCE_FILES_NOT_VERIFIED');
  if(!identity.executed)issues.push('REFERENCE_NOT_EXECUTED');
  if(identity.enableShortTerm!==true||identity.enableFuzz!==false)issues.push('REFERENCE_CONFIGURATION_MISMATCH');
  if(!Array.isArray(identity.weights)||identity.weights.length!==21||identity.weights.some((w,i)=>w!==FSRS_WEIGHTS[i]))issues.push('REFERENCE_WEIGHTS_MISMATCH');
  return issues;
}
function state(seed:MemorySeed|null):FsrsState|null {
  return seed===null?null:{...seed,model:'FSRS-6',algorithmVersion:FSRS_PROVENANCE.algorithmVersion};
}
export const candidateFsrsProbe:Probe={run(input){
  const adapter=new FsrsAdapter({desiredRetention:input.desiredRetention});
  let previous=state(input.initial);
  return input.reviews.map(review=>{
    const result=adapter.review(previous,review.grade,review.at);previous=result.state;
    return {stability:result.state.stability,difficulty:result.state.difficulty,
      retrievabilityBefore:result.retrievabilityBefore,elapsedDays:result.elapsedDays,
      roundedIntervalDays:result.roundedIntervalDays,rawDueAt:result.rawDueAt};
  });
}};
/**
 * This result compares arithmetic. Production approval additionally requires the
 * release evidence verifier, source provenance review, and the other HME gates.
 * A test-double Probe is never an independently verified library reference.
 */
export function compareFsrsReference(reference:LibraryReference|null,candidate:Probe=candidateFsrsProbe,cases:readonly ConformanceCase[]=FSRS_CONFORMANCE_CASES){
  const blockers=reference===null?['REFERENCE_ARTIFACT_UNAVAILABLE']:validateReferenceIdentity(reference.identity);
  const branches=new Set(cases.map(c=>c.branch));
  if(REQUIRED_FSRS_BRANCHES.some(b=>!branches.has(b)))blockers.push('REFERENCE_BRANCH_COVERAGE_INCOMPLETE');
  if(new Set(cases.map(c=>c.id)).size!==cases.length)blockers.push('DUPLICATE_CASE_ID');
  if(cases.some(c=>c.reviews.length===0))blockers.push('EMPTY_CASE');
  const results:CaseResult[]=cases.map(input=>{
    const issues:string[]=[];let actual:readonly Observable[]|null=null,expected:readonly Observable[]|null=null;
    const before=JSON.stringify(input),candidateInput=structuredClone(input),referenceInput=structuredClone(input);
    try{actual=candidate.run(candidateInput);if(!finiteOutput(actual,input.reviews.length))issues.push('INVALID_CANDIDATE_OUTPUT');
      const again=candidate.run(structuredClone(input));if(JSON.stringify(actual)!==JSON.stringify(again))issues.push('CANDIDATE_NONDETERMINISTIC');
    }catch{issues.push('CANDIDATE_EXECUTION_FAILED');}
    if(blockers.length===0&&reference){
      try{expected=reference.probe.run(referenceInput);
        if(!finiteOutput(expected,input.reviews.length))issues.push('INVALID_REFERENCE_OUTPUT');
        const again=reference.probe.run(structuredClone(input));if(JSON.stringify(expected)!==JSON.stringify(again))issues.push('REFERENCE_NONDETERMINISTIC');
      }catch{issues.push('REFERENCE_EXECUTION_FAILED');}
    }
    if(JSON.stringify(candidateInput)!==before||JSON.stringify(referenceInput)!==before)issues.push('INPUT_MUTATED');
    let delta:CaseResult['delta']=null;
    if(actual&&expected&&finiteOutput(actual,input.reviews.length)&&finiteOutput(expected,input.reviews.length)){
      delta=actual.map((out,index)=>{
        const d:Record<string,number|null>={};const exp=expected![index];
        for(const key of numericKeys){
          const av=out[key],ev=exp[key];d[key]=av===null||ev===null?null:av-ev;
          if(av===null||ev===null){if(av!==ev)issues.push(`${index}:${key}:NULL_MISMATCH`);}
          else if(key==='elapsedDays'||key==='roundedIntervalDays'?av!==ev:!sameNumbers(av,ev))issues.push(`${index}:${key}:NUMERIC_MISMATCH`);
        }
        if(out.rawDueAt!==exp.rawDueAt)issues.push(`${index}:rawDueAt:TIMESTAMP_MISMATCH`);
        return d;
      });
    }
    return {id:input.id,branch:input.branch,status:blockers.length?'blocked':issues.length?'nonconformant':'conformant',expected,actual,delta,issues} as CaseResult;
  });
  const passed=results.filter(r=>r.status==='conformant').length,failed=results.filter(r=>r.status==='nonconformant').length,blocked=results.filter(r=>r.status==='blocked').length;
  const status:ConformanceStatus=blockers.length?'blocked':failed?'nonconformant':'conformant';
  return {schemaVersion:1,kind:'fsrs-library-conformance',status,
    candidate:{algorithmVersion:FSRS_PROVENANCE.algorithmVersion,precision:FSRS_PROVENANCE.precision,timePolicy:FSRS_PROVENANCE.timePolicy},
    reference:reference?.identity??{...FSRS_REFERENCE_PIN,artifactSha512:null,executed:false},
    tolerance:FSRS_TOLERANCE,
    coverage:{requiredBranches:REQUIRED_FSRS_BRANCHES.length,executedBranches:new Set(results.filter(r=>r.expected!==null).map(r=>r.branch)).size},
    summary:{passed,failed,blocked},cases:results,blockers,
    scope:'Memory-state core plus raw whole-day interval; excludes HME policies, BasicScheduler learning-step/monotonic policies, and scientific validity',
  };
}
