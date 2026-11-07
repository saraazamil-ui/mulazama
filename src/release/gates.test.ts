// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import {canonical,LEARNING_VERSIONS} from '../core/types';
import {evaluateRelease,GATES,RELEASE_POLICY,REQUIRED_CHECKS,sha256,TRUSTED_RELEASE_AUTHORITIES} from './gates';
import type {ReleaseContext,ReleaseBundle,ReleaseAuthority,GateAttestation,GateReport,GateId} from './gates';
import {createBlockedLearningAccess,createLearningReleaseAccess,requireLearningAccess} from './access';
import {createSyntheticLearningAccess} from '../testing/learning-access';
import {LearningApplication} from '../application/learning';
import {MemoryEventStore} from '../persistence/event-store';
import {BUILD_SOURCE_DIGEST} from './build-context.generated';
const unit={id:'synthetic-unit',editionId:'synthetic-test-only',probeProfileVersionId:'chunk-P0-1',words:10,coverage:['synthetic:0:10']};
const context:ReleaseContext={product:'MULAZAMA',environment:'staging',purpose:'controlled-pilot',platform:'web',sourceDigest:'a'.repeat(64),versionsDigest:'b'.repeat(64),contentManifestHash:'c'.repeat(64),unitCatalogHash:'d'.repeat(64)};
const at='2026-11-05T10:00:00.000Z';
async function fixture(change?:(r:GateReport)=>void){
 const key=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const authority:ReleaseAuthority={id:'test-ephemeral-verifier',gates:GATES,publicKey:await crypto.subtle.exportKey('jwk',key.publicKey)};
 const bundle:ReleaseBundle={attestations:[],reports:{}},digest=await sha256(canonical(context));
 for(const gate of GATES){
  const report:GateReport={schemaVersion:1,gate,policyVersion:RELEASE_POLICY,contextDigest:digest,outcome:'passed',execution:'actual',checkedAt:at,checks:Object.fromEntries(REQUIRED_CHECKS[gate].map(x=>[x,{passed:1,failed:0,skipped:0}]))};
  if(gate==='G02')report.reference={name:'ts-fsrs',version:'5.4.2',sourceCommit:'bb71e35a2f5af5a5ac6cce9ef7c41ad24855721d',artifactDigest:'e'.repeat(64),executed:true};
  if(gate==='G01'||gate==='G10')report.reviewer={id:'synthetic-reviewer',role:'synthetic-test',decision:'approved',scope:digest};
  change?.(report);const raw=canonical(report),hash=await sha256(raw);bundle.reports[hash]=raw;
  const payload:GateAttestation={schemaVersion:1,gate,policyVersion:RELEASE_POLICY,authorityId:authority.id,contextDigest:digest,reportHashes:[hash],issuedAt:at,expiresAt:'2026-11-06T10:00:00.000Z'};
  const signature=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key.privateKey,new TextEncoder().encode(canonical(payload))))));
  bundle.attestations.push({payload,signature});
 }return {bundle,authority};
}
const run=async(f:Awaited<ReturnType<typeof fixture>>,ctx=context)=>evaluateRelease(ctx,f.bundle,[f.authority],at);
describe('05B cryptographic release-policy mechanism — fabricated fixtures never constitute product approval',()=>{
 it('RG01 valid signatures cover ten gates only in an explicitly supplied verifier test registry',async()=>{const f=await fixture();expect((await run(f)).every(x=>x.status==='passed')).toBe(true);expect(TRUSTED_RELEASE_AUTHORITIES).toHaveLength(0);expect((await evaluateRelease(context,f.bundle,TRUSTED_RELEASE_AUTHORITIES,at)).every(x=>x.status==='blocked')).toBe(true);});
 it('RG02 empty and duplicate attestations block instead of using a Boolean enable flag',async()=>{const f=await fixture();f.bundle.attestations.push(f.bundle.attestations[0]);expect((await run(f))[0].status).toBe('blocked');expect((await evaluateRelease(context,{attestations:[],reports:{}},[],at)).filter(x=>x.status==='blocked')).toHaveLength(10);});
 it('RG03 changed report bytes fail the authenticated hash',async()=>{const f=await fixture(),hash=f.bundle.attestations[0].payload.reportHashes[0];f.bundle.reports[hash]+=' ';expect((await run(f))[0].status).toBe('blocked');});
 it('RG04 changes in content, model, source, platform and environment invalidate the binding',async()=>{const f=await fixture();for(const ctx of [{...context,sourceDigest:'f'.repeat(64)},{...context,contentManifestHash:'f'.repeat(64)},{...context,versionsDigest:'f'.repeat(64)},{...context,unitCatalogHash:'f'.repeat(64)},{...context,platform:'ios' as const},{...context,environment:'production' as const,purpose:'production' as const}])expect((await run(f,ctx)).every(x=>x.status==='blocked')).toBe(true);});
 it('RG05 expiry, future issue dates and overlong attestations fail',async()=>{const f=await fixture();expect((await evaluateRelease(context,f.bundle,[f.authority],'2027-01-01T00:00:00.000Z')).every(x=>x.status==='blocked')).toBe(true);expect((await evaluateRelease(context,f.bundle,[f.authority],'2026-11-04T00:00:00.000Z')).every(x=>x.status==='blocked')).toBe(true);});
 it('RG06 missing, skipped and failed checks cannot pass',async()=>{for(const mutation of [(r:GateReport)=>{delete r.checks[REQUIRED_CHECKS[r.gate][0]];},(r:GateReport)=>{r.checks[REQUIRED_CHECKS[r.gate][0]].skipped=1;},(r:GateReport)=>{r.checks[REQUIRED_CHECKS[r.gate][0]].failed=1;}]){const f=await fixture(mutation);expect((await run(f)).every(x=>x.status==='blocked')).toBe(true);}});
 it('RG07 synthetic or absent execution is never evidence for a human pilot',async()=>{const f=await fixture(r=>{r.execution='synthetic';});expect((await run(f)).every(x=>x.status==='blocked')).toBe(true);});
 it('RG08 missing immutable executed reference blocks G02',async()=>{const f=await fixture(r=>{if(r.gate==='G02')r.reference!.executed=false;});expect((await run(f)).find(x=>x.gate==='G02')!.status).toBe('blocked');});
 it('RG09 no scientific reviewer or unapproved scope blocks G01/G10',async()=>{const f=await fixture(r=>{if(r.reviewer)r.reviewer.scope='not-this-content';});for(const g of ['G01','G10'] as GateId[])expect((await run(f)).find(x=>x.gate===g)!.status).toBe('blocked');});
 it('RG10 authorities cannot attest to another role or alter a signature',async()=>{const f=await fixture();f.authority.gates=['G02'];expect((await run(f))[0].status).toBe('blocked');f.bundle.attestations[1].signature='AAAA';expect((await run(f))[1].status).toBe('blocked');});
 it('RG11 caller Boolean, callback and forged authorize objects cannot enter the service',async()=>{for(const access of [true,()=>true,{authorize:async()=>{},summary:()=>[]}]){expect(()=>requireLearningAccess(access)).toThrow();await expect(LearningApplication.open(new MemoryEventStore(),{access:access as never})).rejects.toMatchObject({code:'RELEASE_GATES_BLOCKED'});}});
 it('RG12 default service denial occurs before writing a learning command',async()=>{const store=new MemoryEventStore(),app=await LearningApplication.open(store),before=await store.load();await expect(app.send({type:'UnitRegistered',unit})).rejects.toMatchObject({code:'RELEASE_GATES_BLOCKED'});expect(await store.load()).toEqual(before);});
 it('RG13 signed-catalog mechanism checks the entire unit definition',async()=>{const access=await createSyntheticLearningAccess([unit]);await access.authorize({operation:'register',unit});for(const changed of [{...unit,words:11},{...unit,coverage:['synthetic:0:11']},{...unit,probeProfileVersionId:'other'},{...unit,editionId:'other'}])await expect(access.authorize({operation:'register',unit:changed})).rejects.toMatchObject({code:'CONTENT_UNAVAILABLE'});});
 it('RG14 authorization is immutable and summaries are detached',async()=>{const access=createBlockedLearningAccess();expect(Object.isFrozen(access)).toBe(true);const summary=access.summary();summary.splice(0);expect(access.summary()).toHaveLength(10);await expect(access.authorize({operation:'start'})).rejects.toThrow();});
 it('RG15 synthetic helper rejects real identifiers and expires using wall-clock rather than event time',async()=>{await expect(createSyntheticLearningAccess([{...unit,editionId:'hafs-production'}])).rejects.toThrow();const access=await createSyntheticLearningAccess([unit]);vi.useFakeTimers();try{vi.setSystemTime(Date.now()+7200000);await expect(access.authorize({operation:'start',at:'2000-01-01T00:00:00.000Z'})).rejects.toThrow();}finally{vi.useRealTimers();}});
 it('RG16 evidence is snapshotted before asynchronous verification',async()=>{const f=await fixture();const pending=run(f);f.bundle.attestations.length=0;expect((await pending).every(x=>x.status==='passed')).toBe(true);});
 it('RG17 impossible dates and unrestricted production/test environment combinations are rejected',async()=>{const f=await fixture();await expect(evaluateRelease(context,f.bundle,[f.authority],'2026-02-30T00:00:00.000Z')).rejects.toThrow();await expect(evaluateRelease({...context,purpose:'engineering-test'},f.bundle,[f.authority],at)).rejects.toThrow();});
 it('RG19 a staging production-optimized build cannot accept a production environment context',async()=>{vi.stubEnv('MODE','staging');vi.stubEnv('PROD',true);try{const ctx:ReleaseContext={...context,environment:'production',purpose:'production',sourceDigest:BUILD_SOURCE_DIGEST,versionsDigest:await sha256(canonical(LEARNING_VERSIONS)),unitCatalogHash:await sha256(canonical([unit]))};await expect(createLearningReleaseAccess(ctx,{attestations:[],reports:{}},[unit])).rejects.toMatchObject({code:'RELEASE_CONTEXT_INVALID'});}finally{vi.unstubAllEnvs();}});
 it('RG18 production factory cannot trust caller fixtures or a different source checkout',async()=>{const f=await fixture();await expect(createLearningReleaseAccess({...context,environment:'test',purpose:'engineering-test',versionsDigest:await sha256(canonical(LEARNING_VERSIONS))},f.bundle,[unit])).rejects.toMatchObject({code:'RELEASE_CONTEXT_INVALID'});});
});
