// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonical, LEARNING_VERSIONS, REFERENCE_LEARNING_VERSIONS } from '../core/types';
import { createLearningReleaseAccess, mintSyntheticLearningAccess, requireLearningAccess } from './access';
import { createRuntimeLearningAccess, runtimeDatabaseName } from './runtime';
import { BUILD_SOURCE_DIGEST } from './build-context.generated';
import { sha256, TRUSTED_RELEASE_AUTHORITIES } from './gates';
import { LearningApplication } from '../application/learning';
import { MemoryEventStore } from '../persistence/event-store';

const unit = {id:'synthetic-l3-isolation',editionId:'synthetic-l3-only',probeProfileVersionId:'chunk-P0-1',words:3,coverage:['synthetic:l3:1']};
const emptyBundle = () => ({attestations:[],reports:{}});
async function context(versions=REFERENCE_LEARNING_VERSIONS, catalog=[unit]) {
  return {product:'MULAZAMA',environment:'test',purpose:'engineering-test',platform:'web',
    sourceDigest:BUILD_SOURCE_DIGEST,versionsDigest:await sha256(canonical(versions)),
    contentManifestHash:'c'.repeat(64),unitCatalogHash:await sha256(canonical(catalog))};
}
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.useRealTimers();});

describe('L3 release isolation: test execution never elects a pilot or public release',()=>{
  it('L3ISO01 a fabricated corrected capability is rejected before a new learning stream is created',async()=>{
    const store=new MemoryEventStore();const before=await store.load();
    await expect(LearningApplication.open(store,{scheduling:'reference-06e1',access:{authorize:async()=>{},summary:()=>[]}})).rejects.toMatchObject({code:'RELEASE_GATES_BLOCKED'});
    expect(await store.load()).toEqual(before);
  });
  it('L3ISO02 copying a real synthetic capability does not copy its authority',()=>{
    const access=mintSyntheticLearningAccess([unit]);expect(()=>requireLearningAccess(access)).not.toThrow();
    expect(()=>requireLearningAccess({...access})).toThrow();
  });
  it('L3ISO03 synthetic access accepts only the two registered version contracts',async()=>{
    const access=mintSyntheticLearningAccess([unit]);
    for(const versions of [LEARNING_VERSIONS,REFERENCE_LEARNING_VERSIONS])await expect(access.authorize({operation:'engineering-replay',unit,versions})).resolves.toBeUndefined();
    await expect(access.authorize({operation:'engineering-replay',unit,versions:{...REFERENCE_LEARNING_VERSIONS,desiredRetention:0.8}})).rejects.toMatchObject({code:'UNSUPPORTED_VERSION'});
  });
  it('L3ISO04 corrected numerical version and matching context still cannot release empty attestations',async()=>{
    const access=await createLearningReleaseAccess(await context(),emptyBundle(),[unit],REFERENCE_LEARNING_VERSIONS);
    expect(access.summary()).toHaveLength(10);expect(access.summary().every(x=>x.status==='blocked')).toBe(true);
    await expect(access.authorize({operation:'start',unit,versions:REFERENCE_LEARNING_VERSIONS})).rejects.toMatchObject({code:'RELEASE_GATES_BLOCKED'});
    expect(TRUSTED_RELEASE_AUTHORITIES).toHaveLength(0);
  });
  it.each([
    ['legacy context with corrected request',LEARNING_VERSIONS,REFERENCE_LEARNING_VERSIONS],
    ['corrected context with legacy request',REFERENCE_LEARNING_VERSIONS,LEARNING_VERSIONS],
  ])('L3ISO05 %s cannot bind a different scheduler',async(_label,bound,requested)=>{
    await expect(createLearningReleaseAccess(await context(bound),emptyBundle(),[unit],requested)).rejects.toMatchObject({code:'RELEASE_CONTEXT_INVALID'});
  });
  it('L3ISO06 an issued capability checks the requested known version on each command',async()=>{
    const access=await createLearningReleaseAccess(await context(LEARNING_VERSIONS),emptyBundle(),[unit],LEARNING_VERSIONS);
    await expect(access.authorize({operation:'AssessmentSubmitted',unit,versions:REFERENCE_LEARNING_VERSIONS})).rejects.toMatchObject({code:'RELEASE_CONTEXT_INVALID'});
  });
  it('L3ISO07 unknown release versions are rejected before interpreting report success',async()=>{
    const unknown={...REFERENCE_LEARNING_VERSIONS,applicationEvidence:'unknown'};
    await expect(createLearningReleaseAccess(await context(unknown),emptyBundle(),[unit],unknown)).rejects.toMatchObject({code:'UNSUPPORTED_VERSION'});
  });
  it.each(['development','staging','production'])('L3ISO08 synthetic authority cannot be created in %s',mode=>{
    vi.stubEnv('MODE',mode);
    expect(()=>mintSyntheticLearningAccess([unit])).toThrow();
  });
  it('L3ISO09 a synthetic capability cannot be carried into another environment after issuance',async()=>{
    const access=mintSyntheticLearningAccess([unit]);vi.stubEnv('MODE','production');
    await expect(access.authorize({operation:'start',unit,versions:REFERENCE_LEARNING_VERSIONS})).rejects.toMatchObject({code:'RELEASE_GATES_BLOCKED'});
  });
  it('L3ISO10 synthetic content cannot be relabeled as a real edition or real canonical coverage',()=>{
    expect(()=>mintSyntheticLearningAccess([{...unit,editionId:'hafs-real-edition'}])).toThrow();
    expect(()=>mintSyntheticLearningAccess([{...unit,coverage:['1:1']}])).toThrow();
  });
  it('L3ISO11 mutating caller catalog or returned summary cannot expand authority',async()=>{
    const copy=structuredClone(unit),access=mintSyntheticLearningAccess([copy]);
    copy.coverage.push('synthetic:injected');copy.words=99;
    const summary=access.summary();summary.forEach(x=>{x.expiresAt='2099-01-01T00:00:00.000Z';});
    await expect(access.authorize({operation:'register',unit:copy,versions:REFERENCE_LEARNING_VERSIONS})).rejects.toMatchObject({code:'CONTENT_UNAVAILABLE'});
    vi.setSystemTime(Date.now()+7200000);
    await expect(access.authorize({operation:'start',unit,versions:REFERENCE_LEARNING_VERSIONS,at:'2000-01-01T00:00:00.000Z'})).rejects.toMatchObject({code:'RELEASE_GATES_BLOCKED'});
  });
  it.each(['test','staging','production'])('L3ISO12 %s runtime stays blocked despite fake URL and settings switches',async mode=>{
    vi.stubEnv('MODE',mode);vi.stubGlobal('location',{search:'?engineering=true&learningScheduling=reference-06e1',hash:'#start-approved'});
    vi.stubGlobal('localStorage',{getItem:()=>'{"approved":true,"engineering":true}'});
    const access=await createRuntimeLearningAccess();expect(access.summary().every(x=>x.status==='blocked')).toBe(true);
    await expect(access.authorize({operation:'start',unit})).rejects.toMatchObject({code:'RELEASE_GATES_BLOCKED'});
  });
  it('L3ISO13 runtime database identity separates test and staging from the existing production database',()=>{
    vi.stubEnv('MODE','production');expect(runtimeDatabaseName()).toBe('mulazama-learning-v1');
    const names=new Set();for(const mode of ['test','staging','development']){vi.stubEnv('MODE',mode);const name=runtimeDatabaseName();expect(name).not.toBe('mulazama-learning-v1');names.add(name);}expect(names.size).toBe(3);
  });
});
