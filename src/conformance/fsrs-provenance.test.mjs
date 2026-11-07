import {it,expect} from 'vitest';
import {verifySourceBinding} from '../../scripts/fsrs-source-provenance.mjs';
import {readFile} from 'node:fs/promises';
const root=process.cwd()+'/references/ts-fsrs-5.4.2-download/';
const metadata=JSON.parse(await readFile(root+'registry.json','utf8'));
const tarball=await readFile(root+'ts-fsrs-5.4.2.tgz');
const attestations=JSON.parse(await readFile(root+'attestations.json','utf8'));
it('binds official downloaded statement without inventing gitHead or claiming signature verification',()=>{
 expect(metadata.gitHead).toBeUndefined();expect(verifySourceBinding(metadata,tarball,attestations)).toMatchObject({commit:'bb71e35a2f5af5a5ac6cce9ef7c41ad24855721d',cryptographicProvenanceVerified:false});
});
it('rejects missing statement',()=>expect(()=>verifySourceBinding(metadata,tarball)).toThrow('SOURCE_BINDING'));
it('rejects substituted artifact',()=>expect(()=>verifySourceBinding(metadata,Buffer.from('tampered'),attestations)).toThrow('BINDING_MISMATCH'));
it('rejects wrong registry commit even with matching statement',()=>expect(()=>verifySourceBinding({...metadata,gitHead:'a'.repeat(40)},tarball,attestations)).toThrow('IDENTITY_MISMATCH'));
it('rejects altered source commit',()=>{
 const altered=structuredClone(attestations),a=altered.attestations.find(x=>x.predicateType==='https://slsa.dev/provenance/v1');
 const statement=JSON.parse(Buffer.from(a.bundle.dsseEnvelope.payload,'base64'));statement.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit='a'.repeat(40);a.bundle.dsseEnvelope.payload=Buffer.from(JSON.stringify(statement)).toString('base64');
 expect(()=>verifySourceBinding(metadata,tarball,altered)).toThrow('BINDING_MISMATCH');
});
