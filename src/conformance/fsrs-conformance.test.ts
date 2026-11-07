import {describe,it,expect} from 'vitest';
import {candidateFsrsProbe,compareFsrsReference,FSRS_REFERENCE_PIN,validateReferenceIdentity} from './fsrs-conformance';
import type {LibraryReference,Probe,ReferenceIdentity} from './fsrs-conformance';
import {FSRS_CONFORMANCE_CASES,REQUIRED_FSRS_BRANCHES} from './fsrs-suite';
import {FSRS_WEIGHTS} from '../core/fsrs';

// Test-double identity exercises harness decisions only; it is never an evidence
// artifact, never stored as golden vectors and never production approval.
const identity=():ReferenceIdentity=>({...FSRS_REFERENCE_PIN,artifactSha512:'sha512-'+ 'A'.repeat(86)+'==',filesVerified:3,
  weights:[...FSRS_WEIGHTS],enableShortTerm:true,enableFuzz:false,executed:true});
const fake=(probe:Probe=candidateFsrsProbe):LibraryReference=>({identity:identity(),probe});
describe('FSRS conformance harness decisions (synthetic double; not library conformance)',()=>{
  it('G02-01 blocks all 12 branches when actual reference is absent',()=>{
    const report=compareFsrsReference(null);expect(report.status).toBe('blocked');
    expect(report.coverage).toEqual({requiredBranches:12,executedBranches:0});
    expect(report.summary).toEqual({passed:0,failed:0,blocked:23});
    expect(report.cases.every(c=>c.expected===null&&c.delta===null&&c.actual!==null)).toBe(true);
  });
  it('G02-02 inputs include every mandatory branch and four initial/same-day grades',()=>{
    expect(new Set(FSRS_CONFORMANCE_CASES.map(c=>c.branch))).toEqual(new Set(REQUIRED_FSRS_BRANCHES));
    for(const branch of ['initialization','same-day'])expect(FSRS_CONFORMANCE_CASES.filter(c=>c.branch===branch).map(c=>c.reviews[0].grade)).toEqual([1,2,3,4]);
  });
  it.each(['name','version','model','sourceCommit'] as const)('G02-03 rejects reference %s drift without executing it',field=>{
    const ref=fake({run(){throw new Error('must never execute');}});ref.identity[field]='wrong';
    const result=compareFsrsReference(ref);expect(result.status).toBe('blocked');expect(result.cases.every(r=>r.expected===null)).toBe(true);
  });
  it('G02-04 rejects FSRS7 weights instead of migrating them silently',()=>{
    const ref=fake();ref.identity.weights=Array(34).fill(1);expect(compareFsrsReference(ref).blockers).toContain('REFERENCE_WEIGHTS_MISMATCH');
  });
  it('G02-05 rejects missing artifact bytes, unexecuted references and fuzz',()=>{
    const ref=fake();ref.identity.artifactSha512='';ref.identity.filesVerified=0;ref.identity.executed=false;ref.identity.enableFuzz=true;
    expect(validateReferenceIdentity(ref.identity)).toEqual(expect.arrayContaining(['REFERENCE_ARTIFACT_DIGEST_MISSING','REFERENCE_FILES_NOT_VERIFIED','REFERENCE_NOT_EXECUTED','REFERENCE_CONFIGURATION_MISMATCH']));
  });
  it('G02-06 reports exact differences for every state field and keeps timestamps exact',()=>{
    const ref=fake({run(input){return candidateFsrsProbe.run(input).map(out=>({...out,stability:out.stability+1e-8,rawDueAt:'2026-01-01T00:00:00.000Z'}));}});
    const report=compareFsrsReference(ref);expect(report.status).toBe('nonconformant');expect(report.summary.failed).toBe(23);
    expect(report.cases[0].delta?.[0].stability).toBeCloseTo(-1e-8,14);
    expect(report.cases[0].issues).toContain('0:rawDueAt:TIMESTAMP_MISMATCH');
  });
  it('G02-07 comparison tolerance does not conceal an eight-decimal rounding difference',()=>{
    const ref=fake({run(input){return candidateFsrsProbe.run(input).map(out=>({...out,difficulty:Math.round(out.difficulty*1e8)/1e8}));}});
    const report=compareFsrsReference(ref);expect(report.status).toBe('nonconformant');expect(report.summary.failed).toBeGreaterThan(0);
  });
  it('G02-08 null is never imputed as zero',()=>{
    const ref=fake({run(input){return candidateFsrsProbe.run(input).map(out=>({...out,retrievabilityBefore:out.retrievabilityBefore??0}));}});
    expect(compareFsrsReference(ref).cases[0].issues).toContain('0:retrievabilityBefore:NULL_MISMATCH');
  });
  it('G02-09 empty or incomplete coverage cannot pass',()=>{
    expect(compareFsrsReference(fake(),candidateFsrsProbe,[]).status).toBe('blocked');
    expect(compareFsrsReference(fake(),candidateFsrsProbe,FSRS_CONFORMANCE_CASES.slice(0,4)).blockers).toContain('REFERENCE_BRANCH_COVERAGE_INCOMPLETE');
  });
  it('G02-10 duplicate IDs cannot inflate coverage',()=>{
    const report=compareFsrsReference(fake(),candidateFsrsProbe,[...FSRS_CONFORMANCE_CASES,FSRS_CONFORMANCE_CASES[0]]);
    expect(report.blockers).toContain('DUPLICATE_CASE_ID');
  });
  it('G02-11 rejects invalid or missing numerical reference results',()=>{
    const ref=fake({run(input){return candidateFsrsProbe.run(input).map(out=>({...out,stability:NaN}));}});
    expect(compareFsrsReference(ref).cases.every(r=>r.issues.includes('INVALID_REFERENCE_OUTPUT'))).toBe(true);
    expect(compareFsrsReference(fake({run(){return [];}})).status).toBe('nonconformant');
  });
  it('G02-12 catches nondeterminism',()=>{
    let n=0;const ref=fake({run(input){n++;return candidateFsrsProbe.run(input).map(out=>({...out,stability:out.stability+n/1000}));}});
    expect(compareFsrsReference(ref).cases.every(r=>r.issues.includes('REFERENCE_NONDETERMINISTIC'))).toBe(true);
  });
  it('G02-13 probe input mutation is rejected and the suite remains unchanged',()=>{
    const before=JSON.stringify(FSRS_CONFORMANCE_CASES);
    const ref=fake({run(input){const result=candidateFsrsProbe.run(input);input.id='tampered';return result;}});
    expect(compareFsrsReference(ref).cases.every(r=>r.issues.includes('INPUT_MUTATED'))).toBe(true);
    expect(JSON.stringify(FSRS_CONFORMANCE_CASES)).toBe(before);
  });
  it('G02-14 equal test doubles demonstrate comparator behavior only',()=>{
    const result=compareFsrsReference(fake());expect(result.status).toBe('conformant');expect(result.summary.passed).toBe(23);
    expect(result.scope).toContain('excludes HME');
  });
  it('G02-15 historical replay records each actual step, preserving elapsed times',()=>{
    const input=FSRS_CONFORMANCE_CASES.find(c=>c.branch==='historical-replay')!;
    const out=candidateFsrsProbe.run(input);expect(out.map(o=>o.elapsedDays)).toEqual([5,7,30]);
    expect(out[1].stability).toBeCloseTo(1.6775146433759944,12);
  });
});
