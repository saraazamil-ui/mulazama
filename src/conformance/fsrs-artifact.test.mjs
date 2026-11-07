// @vitest-environment node
import {afterEach,describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {verifyReferenceArtifact,tarballFiles,createLegacyLibraryProbe,loadTsFsrsReference} from '../../scripts/fsrs-reference-loader.mjs';
import {prepareReference} from '../../scripts/fsrs-reference-prepare.mjs';

const temps=[];
afterEach(async()=>{for(const path of temps.splice(0))await rm(path,{recursive:true,force:true});});
const hash=(value,alg='sha256')=>createHash(alg).update(value).digest(alg==='sha512'?'base64':'hex');
function tar(files,type=48){
  const chunks=[];
  for(const [path,value]of Object.entries(files)){
    const bytes=Buffer.from(value),header=Buffer.alloc(512);header.write('package/'+path,0,100,'utf8');
    header.write('0000644\0',100,8);header.write('0000000\0',108,8);header.write('0000000\0',116,8);
    header.write(bytes.length.toString(8).padStart(11,'0')+'\0',124,12);header.write('00000000000\0',136,12);
    header.fill(32,148,156);header[156]=type;header.write('ustar\0',257,6);header.write('00',263,2);
    const checksum=header.reduce((sum,b)=>sum+b,0);header.write(checksum.toString(8).padStart(6,'0')+'\0 ',148,8);
    chunks.push(header,bytes,Buffer.alloc((512-bytes.length%512)%512));
  }
  return gzipSync(Buffer.concat([...chunks,Buffer.alloc(1024)]));
}
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'mulazama-fsrs-harness-'));temps.push(root);const pkgdir=join(root,'package');await mkdir(join(pkgdir,'dist'),{recursive:true});
  // Artificial bytes test the verifier. They are not ts-fsrs or golden vectors.
  const files={
    'package.json':JSON.stringify({name:'ts-fsrs',version:'5.4.2',license:'MIT',module:'dist/index.mjs'}),
    LICENSE:'MIT License\nPermission is hereby granted for this synthetic verifier fixture only.\nTHE SOFTWARE IS PROVIDED without any certification.\n',
    'dist/index.mjs':'export const testFixtureOnly = true;\n',
  };
  for(const [path,value]of Object.entries(files))await writeFile(join(pkgdir,path),value);
  const archive=tar(files),integrity='sha512-'+hash(archive,'sha512');await writeFile(join(root,'fixture.tgz'),archive);
  const metadata={name:'ts-fsrs',version:'5.4.2',gitHead:'bb71e35a2f5af5a5ac6cce9ef7c41ad24855721d',dist:{integrity,tarball:'https://registry.npmjs.org/ts-fsrs/-/ts-fsrs-5.4.2.tgz'}};
  await writeFile(join(root,'registry.json'),JSON.stringify(metadata));
  const receipt={name:'ts-fsrs',version:'5.4.2',sourceCommit:metadata.gitHead,license:'MIT',registryUrl:'https://registry.npmjs.org/ts-fsrs/5.4.2',artifactSha512:integrity,tarballPath:'fixture.tgz',registryMetadataPath:'registry.json',files:Object.entries(files).map(([path,value])=>({path,sha256:hash(value)}))};
  const receiptPath=join(root,'receipt.json');await writeFile(receiptPath,JSON.stringify(receipt));
  return {root,pkgdir,receiptPath,receipt,files,metadata};
}
describe('Pinned reference artifact verifier (synthetic bytes only)',()=>{
  it('G02-A01 missing receipt stays blocked before importing any code',async()=>{
    await expect(verifyReferenceArtifact('/not-used',null)).rejects.toThrow('REFERENCE_RECEIPT_UNAVAILABLE');
  });
  it('G02-A02 verifies supplied byte integrity and explicitly leaves origin approval outstanding',async()=>{
    const f=await fixture(),result=await verifyReferenceArtifact(f.pkgdir,f.receiptPath);
    expect(result.identity.executed).toBe(false);expect(result.identity.filesVerified).toBe(3);
    expect(result.provenanceReview).toContain('authenticity requires independent release review');
    await expect(loadTsFsrsReference(f.pkgdir,f.receiptPath,[])).rejects.toThrow('REFERENCE_LEGACY_API_UNAVAILABLE');
  });
  it('G02-A03 rejects changes to extracted code without executing it',async()=>{
    const f=await fixture();await writeFile(join(f.pkgdir,'dist/index.mjs'),'throw new Error("should never execute");');
    await expect(verifyReferenceArtifact(f.pkgdir,f.receiptPath)).rejects.toThrow('REFERENCE_FILE_INTEGRITY_MISMATCH');
  });
  it('G02-A04 rejects a manifest forged to match modified extraction but not tarball',async()=>{
    const f=await fixture(),changed='export const changed = true;';await writeFile(join(f.pkgdir,'dist/index.mjs'),changed);
    f.receipt.files[2].sha256=hash(changed);await writeFile(f.receiptPath,JSON.stringify(f.receipt));
    await expect(verifyReferenceArtifact(f.pkgdir,f.receiptPath)).rejects.toThrow('REFERENCE_ARCHIVE_EXTRACTION_MISMATCH');
  });
  it('G02-A05 rejects a modified tarball',async()=>{
    const f=await fixture(),bytes=await readFile(join(f.root,'fixture.tgz'));bytes[20]^=1;await writeFile(join(f.root,'fixture.tgz'),bytes);
    await expect(verifyReferenceArtifact(f.pkgdir,f.receiptPath)).rejects.toThrow('REFERENCE_TARBALL_INTEGRITY_MISMATCH');
  });
  it('G02-A06 rejects omitted files in extraction manifests',async()=>{
    const f=await fixture();await writeFile(join(f.pkgdir,'unlisted.mjs'),'export const hidden = true;');
    await expect(verifyReferenceArtifact(f.pkgdir,f.receiptPath)).rejects.toThrow('REFERENCE_INCOMPLETE_FILE_MANIFEST');
  });
  it('G02-A07 rejects path traversal and duplicate manifest entries',async()=>{
    const f=await fixture();f.receipt.files[2].path='../escape';await writeFile(f.receiptPath,JSON.stringify(f.receipt));
    await expect(verifyReferenceArtifact(f.pkgdir,f.receiptPath)).rejects.toThrow('REFERENCE_FILE_MANIFEST_INVALID');
    f.receipt.files[2]={...f.receipt.files[0]};await writeFile(f.receiptPath,JSON.stringify(f.receipt));
    await expect(verifyReferenceArtifact(f.pkgdir,f.receiptPath)).rejects.toThrow('REFERENCE_FILE_MANIFEST_INVALID');
  });
  it('G02-A08 rejects symlinks',async()=>{
    const f=await fixture(),entry=join(f.pkgdir,'dist/index.mjs');await rm(entry);await symlink('../package.json',entry);
    await expect(verifyReferenceArtifact(f.pkgdir,f.receiptPath)).rejects.toThrow('REFERENCE_FILE_SYMLINK_OR_NOT_FILE');
  });
  it('G02-A09 rejects registry version/commit drift',async()=>{
    const f=await fixture();f.metadata.gitHead='a'.repeat(40);await writeFile(join(f.root,'registry.json'),JSON.stringify(f.metadata));
    await expect(verifyReferenceArtifact(f.pkgdir,f.receiptPath)).rejects.toThrow('REFERENCE_REGISTRY_IDENTITY_MISMATCH');
  });
  it('G02-A10 rejects non-gzip, oversized and unsafe tar paths/types',()=>{
    expect(()=>tarballFiles(Buffer.from('invalid'))).toThrow('REFERENCE_TARBALL_NOT_VALID_BOUNDED_GZIP');
    expect(()=>tarballFiles(Buffer.alloc(8*1024*1024+1))).toThrow('REFERENCE_TARBALL_TOO_LARGE');
    expect(()=>tarballFiles(tar({'../escape':'x'}))).toThrow('REFERENCE_TAR_PATH');
    expect(()=>tarballFiles(tar({'symlink':'x'},50))).toThrow('REFERENCE_TAR_UNSUPPORTED_ENTRY');
  });
  it('G02-A11 corrupt/truncated tar is rejected even when gzip is valid',()=>{
    const bad=Buffer.alloc(512,1);expect(()=>tarballFiles(gzipSync(bad))).toThrow('REFERENCE_TAR_HEADER_CHECKSUM');
    expect(()=>tarballFiles(gzipSync(Buffer.alloc(0)))).toThrow('REFERENCE_TAR_TRUNCATED_OR_TRAILING_DATA');
  });
  it('G02-A12 offline preparation preserves every byte without installing or executing code',async()=>{
    const f=await fixture(),out=join(f.root,'prepared');
    const result=await prepareReference(join(f.root,'registry.json'),join(f.root,'fixture.tgz'),out);
    expect(result.filesVerified).toBe(3);expect(await readFile(join(result.directory,'dist/index.mjs'),'utf8')).toBe(f.files['dist/index.mjs']);
    await expect(prepareReference(join(f.root,'registry.json'),join(f.root,'fixture.tgz'),out)).rejects.toThrow('EEXIST');
  });
  it('G02-A13 offline preparation rejects wrong SRI before creating a destination',async()=>{
    const f=await fixture();f.metadata.dist.integrity='sha512-'+ 'B'.repeat(86)+'==';await writeFile(join(f.root,'registry.json'),JSON.stringify(f.metadata));
    await expect(prepareReference(join(f.root,'registry.json'),join(f.root,'fixture.tgz'),join(f.root,'rejected'))).rejects.toThrow('REFERENCE_REGISTRY_OR_TARBALL_MISMATCH');
  });
});
describe('Legacy reference bridge contract (constant-valued fake, no FSRS formulas)',()=>{
  it('G02-B01 obtains states, probabilities and intervals by calling upstream API',()=>{
    const calls=[],weights=Array.from({length:21},(_,i)=>i+1);
    const probe=createLegacyLibraryProbe({fsrs(config){return {parameters:config,
      next_state(...args){calls.push(['next_state',...args]);return {stability:9,difficulty:4};},
      next_interval(...args){calls.push(['next_interval',...args]);return 7;},
      forgetting_curve(...args){calls.push(['forgetting_curve',...args]);return .6;}};}},weights);
    const input={initial:{stability:5,difficulty:5,lastReviewAt:'2026-01-01T00:00:00.000Z'},reviews:[{grade:3,at:'2026-01-02T12:00:00.000Z'}],desiredRetention:.9};
    expect(probe.run(input)).toEqual([{stability:9,difficulty:4,retrievabilityBefore:.6,elapsedDays:1,roundedIntervalDays:7,rawDueAt:'2026-01-09T12:00:00.000Z'}]);
    expect(calls).toEqual([['forgetting_curve',1,5],['next_state',{stability:5,difficulty:5},1,3],['next_interval',9,1]]);
  });
  it('G02-B02 unsupported APIs and silently migrated weights stay blocked',()=>{
    expect(()=>createLegacyLibraryProbe({},[])).toThrow('REFERENCE_LEGACY_API_UNAVAILABLE');
    const probe=createLegacyLibraryProbe({fsrs(){return {next_state(){},next_interval(){},forgetting_curve(){},parameters:{w:[1],enable_short_term:true,enable_fuzz:false}};}},[2]);
    expect(()=>probe.run({desiredRetention:.9})).toThrow('REFERENCE_EFFECTIVE_CONFIGURATION_MISMATCH');
  });
});
