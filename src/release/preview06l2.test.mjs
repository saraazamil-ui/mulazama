// @vitest-environment node
import {afterEach,describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPreviewArtifact,selectPreviewArtifact,readSelection,readArtifact,hash} from '../../scripts/preview06l2/artifacts.mjs';
const roots=[];const digest='a'.repeat(64);
async function setup(){const root=await mkdtemp(join(tmpdir(),'mulazama-preview-'));roots.push(root);const dist=join(root,'dist'),artifacts=join(root,'artifacts'),state=join(root,'selected.json');await mkdir(dist);for(const name of ['index.html','sw.js','offline-assets.json','manifest.webmanifest'])await writeFile(join(dist,name),name==='sw.js'?digest:'{}');return {root,dist,artifacts,state};}
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
describe('L2 immutable local preview and reversible selection',()=>{
 it('binds every asset byte and refuses tampering before selection',async()=>{const f=await setup();const a=await createPreviewArtifact({...f,releaseId:'l2',sourceDigest:digest});expect(a.productionAuthorized).toBe(false);await writeFile(join(f.artifacts,'l2','index.html'),'tampered');await expect(selectPreviewArtifact({...f,releaseId:'l2',expectedReleaseId:null})).rejects.toThrow('ASSET_HASH_MISMATCH');expect(await readSelection(f.state)).toBeNull();});
 it('retains previous artifact and switches back with compare-and-swap',async()=>{const f=await setup();await createPreviewArtifact({...f,releaseId:'l1',sourceDigest:digest});await createPreviewArtifact({...f,releaseId:'l2',sourceDigest:digest});const first=await selectPreviewArtifact({...f,releaseId:'l1',expectedReleaseId:null});const next=await selectPreviewArtifact({...f,releaseId:'l2',expectedReleaseId:'l1'});expect(next.previous.releaseId).toBe('l1');const back=await selectPreviewArtifact({...f,releaseId:'l1',expectedReleaseId:'l2'});expect(back.manifestSHA256).toBe(first.manifestSHA256);expect((await readArtifact(f.artifacts,'l2')).manifest.releaseId).toBe('l2');});
 it('rejects stale selection without changing the active release',async()=>{const f=await setup();await createPreviewArtifact({...f,releaseId:'l1',sourceDigest:digest});const selected=await selectPreviewArtifact({...f,releaseId:'l1',expectedReleaseId:null});await expect(selectPreviewArtifact({...f,releaseId:'l1',expectedReleaseId:null})).rejects.toThrow('PREVIEW_REVISION_CONFLICT');expect(await readSelection(f.state)).toEqual(selected);});
 it('cannot replace an existing artifact or use a traversing identifier',async()=>{const f=await setup();await createPreviewArtifact({...f,releaseId:'l1',sourceDigest:digest});await expect(createPreviewArtifact({...f,releaseId:'l1',sourceDigest:digest})).rejects.toThrow('RELEASE_ALREADY_EXISTS');await expect(createPreviewArtifact({...f,releaseId:'../escape',sourceDigest:digest})).rejects.toThrow('INVALID_RELEASE_ID');});
 it('rejects a source symlink instead of packaging arbitrary files',async()=>{const f=await setup();await writeFile(join(f.root,'private'),'secret');await symlink(join(f.root,'private'),join(f.dist,'public.txt'));await expect(createPreviewArtifact({...f,releaseId:'l1',sourceDigest:digest})).rejects.toThrow('SYMLINK_REJECTED');});
 it('rejects a forged manifest or symlink after packaging',async()=>{const f=await setup();await createPreviewArtifact({...f,releaseId:'l1',sourceDigest:digest});const artifact=await readArtifact(f.artifacts,'l1');const file=join(f.artifacts,'l1','preview-release.json');await writeFile(file,(await readFile(file,'utf8'))+' ');await expect(readArtifact(f.artifacts,'l1',artifact.manifestSHA256)).rejects.toThrow('MANIFEST_HASH_MISMATCH');await rm(join(f.artifacts,'l1','index.html'));await symlink(join(f.dist,'index.html'),join(f.artifacts,'l1','index.html'));await expect(readArtifact(f.artifacts,'l1')).rejects.toThrow('REGULAR_FILE_REQUIRED');});
 it('does not label a build whose source digest is absent from JavaScript',async()=>{const f=await setup();await expect(createPreviewArtifact({...f,releaseId:'l2',sourceDigest:'b'.repeat(64)})).rejects.toThrow('BUILD_SOURCE_DIGEST_NOT_FOUND');});
 it.each([
  ['empty file list',manifest=>{manifest.files=[];},'INVALID_PREVIEW_MANIFEST'],
  ['invalid source digest',manifest=>{manifest.sourceDigest='not-a-digest';},'INVALID_PREVIEW_MANIFEST'],
  ...['index.html','sw.js','offline-assets.json','manifest.webmanifest'].map(path=>[
   'missing '+path,manifest=>{manifest.files=manifest.files.filter(entry=>entry.path!==path);},'BUILD_ASSET_MISSING:'+path,
  ]),
  ['source digest absent from bundled JavaScript',manifest=>{manifest.sourceDigest='b'.repeat(64);},'BUILD_SOURCE_DIGEST_NOT_FOUND'],
 ])('refuses activation of %s without changing the selected release',async(_name,mutate,error)=>{
  const f=await setup();
  await createPreviewArtifact({...f,releaseId:'l1',sourceDigest:digest});
  await createPreviewArtifact({...f,releaseId:'l2',sourceDigest:digest});
  await selectPreviewArtifact({...f,releaseId:'l1',expectedReleaseId:null});
  const selectedBytes=await readFile(f.state,'utf8');
  const path=join(f.artifacts,'l2','preview-release.json'),manifest=JSON.parse(await readFile(path,'utf8'));
  mutate(manifest);await writeFile(path,JSON.stringify(manifest));
  await expect(selectPreviewArtifact({...f,releaseId:'l2',expectedReleaseId:'l1'})).rejects.toThrow(error);
  expect(await readFile(f.state,'utf8')).toBe(selectedBytes);
 });
 it.each(['rollback','reselection'])('pins the recorded manifest during %s even if altered files have matching new hashes',async(operation)=>{
  const f=await setup();
  await createPreviewArtifact({...f,releaseId:'l1',sourceDigest:digest});
  await createPreviewArtifact({...f,releaseId:'l2',sourceDigest:digest});
  const first=await selectPreviewArtifact({...f,releaseId:'l1',expectedReleaseId:null});
  if(operation==='rollback')await selectPreviewArtifact({...f,releaseId:'l2',expectedReleaseId:'l1'});
  const selectedBytes=await readFile(f.state,'utf8');
  const path=join(f.artifacts,'l1','preview-release.json'),manifest=JSON.parse(await readFile(path,'utf8'));
  const body=Buffer.from('altered preview document'),entry=manifest.files.find(item=>item.path==='index.html');
  await writeFile(join(f.artifacts,'l1','index.html'),body);entry.bytes=body.length;entry.sha256=hash(body);
  await writeFile(path,JSON.stringify(manifest));
  // Each altered file remains internally consistent; the historical pin must reject it.
  expect((await readArtifact(f.artifacts,'l1')).manifestSHA256).not.toBe(first.manifestSHA256);
  await expect(selectPreviewArtifact({...f,releaseId:'l1',expectedReleaseId:operation==='rollback'?'l2':'l1'})).rejects.toThrow('MANIFEST_HASH_MISMATCH');
  expect(await readFile(f.state,'utf8')).toBe(selectedBytes);
 });
});
