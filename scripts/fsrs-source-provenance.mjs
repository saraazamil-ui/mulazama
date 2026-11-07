import {createHash} from 'node:crypto';
const COMMIT='bb71e35a2f5af5a5ac6cce9ef7c41ad24855721d';
/** Checks content binding only. This does not verify Sigstore certificate/tlog signatures. */
export function verifySourceBinding(metadata,tarball,attestations=null){
  if(metadata.gitHead!==undefined){if(metadata.gitHead!==COMMIT)throw new Error('REFERENCE_REGISTRY_IDENTITY_MISMATCH');return {method:'registry-gitHead',commit:COMMIT,cryptographicProvenanceVerified:false};}
  const expected=createHash('sha512').update(tarball).digest('hex');
  const statements=(attestations?.attestations??[]).filter(a=>a.predicateType==='https://slsa.dev/provenance/v1').map(a=>{
    const envelope=a.bundle?.dsseEnvelope;
    if(envelope?.payloadType!=='application/vnd.in-toto+json'||typeof envelope.payload!=='string'||!Array.isArray(envelope.signatures)||!envelope.signatures.length)throw new Error('REFERENCE_PROVENANCE_ENVELOPE_INVALID');
    return JSON.parse(Buffer.from(envelope.payload,'base64').toString('utf8'));
  });
  if(statements.length!==1)throw new Error('REFERENCE_SOURCE_BINDING_UNAVAILABLE');
  const s=statements[0],d=s.predicate?.buildDefinition;
  if(s.predicateType!=='https://slsa.dev/provenance/v1'||s.subject?.length!==1||s.subject[0].name!=='pkg:npm/ts-fsrs@5.4.2'||s.subject[0].digest?.sha512!==expected||d?.externalParameters?.workflow?.repository!=='https://github.com/open-spaced-repetition/ts-fsrs'||d?.externalParameters?.workflow?.path!=='.github/workflows/release.yml'||!d.resolvedDependencies?.some(v=>v.uri==='git+https://github.com/open-spaced-repetition/ts-fsrs@refs/heads/main'&&v.digest?.gitCommit===COMMIT))throw new Error('REFERENCE_PROVENANCE_BINDING_MISMATCH');
  return {method:'npm-slsa-statement-content',commit:COMMIT,cryptographicProvenanceVerified:false,reviewRequired:'Sigstore signatures, certificate identity, transparency log and independent source review'};
}
