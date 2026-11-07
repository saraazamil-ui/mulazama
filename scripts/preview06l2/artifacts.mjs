/** Local engineering preview artifacts. This is not a release authority or a production deployer. */
import { mkdir, readFile, writeFile, rename, readdir, lstat, rm, open } from 'node:fs/promises';
import { resolve, relative, dirname, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const idPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
const requiredAssets = ['index.html','sw.js','offline-assets.json','manifest.webmanifest'];
export function safeId(id) { if (typeof id !== 'string' || !idPattern.test(id)) throw Error('INVALID_RELEASE_ID'); return id; }
export function safePath(path) {
  if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\') || path.includes('\0') || path.split('/').some(x => !x || x === '.' || x === '..')) throw Error('INVALID_ASSET_PATH');
  return path;
}
async function ordinaryFile(path) { if (!(await lstat(path)).isFile()) throw Error('REGULAR_FILE_REQUIRED'); }
async function directory(path) { if (!(await lstat(path)).isDirectory()) throw Error('REGULAR_DIRECTORY_REQUIRED'); }
async function files(root, folder=root) {
  await directory(folder); const result=[];
  for (const name of await readdir(folder)) {
    const path=resolve(folder,name), stat=await lstat(path);
    if(stat.isSymbolicLink())throw Error('SYMLINK_REJECTED');
    if(stat.isDirectory())result.push(...await files(root,path));
    else if(stat.isFile())result.push(relative(root,path).split(sep).join('/'));
    else throw Error('REGULAR_FILE_REQUIRED');
  }
  return result.sort();
}
export async function createPreviewArtifact({dist, artifacts, releaseId, sourceDigest}) {
  safeId(releaseId); if(!/^[a-f0-9]{64}$/.test(sourceDigest))throw Error('SOURCE_DIGEST_REQUIRED');
  const input=resolve(dist), parent=resolve(artifacts), destination=resolve(parent,releaseId);
  await mkdir(parent,{recursive:true}); await directory(parent);
  try { await lstat(destination); throw Error('RELEASE_ALREADY_EXISTS'); } catch(e) { if(e.code!=='ENOENT')throw e; }
  const paths=await files(input);
  for(const name of requiredAssets) if(!paths.includes(name))throw Error('BUILD_ASSET_MISSING:'+name);
  const temporary=resolve(parent,'.building-'+randomUUID()); await mkdir(temporary);
  try {
    const entries=[]; let digestInBundle=false;
    for(const path of paths) {
      safePath(path); const bytes=await readFile(resolve(input,path));
      if(path.endsWith('.js') && bytes.includes(Buffer.from(sourceDigest)))digestInBundle=true;
      await mkdir(dirname(resolve(temporary,path)),{recursive:true}); await writeFile(resolve(temporary,path),bytes,{flag:'wx'});
      entries.push({path,bytes:bytes.length,sha256:hash(bytes)});
    }
    if(!digestInBundle)throw Error('BUILD_SOURCE_DIGEST_NOT_FOUND');
    const manifest={format:1,kind:'local-engineering-preview',releaseId,sourceDigest,productionAuthorized:false,files:entries};
    await writeFile(resolve(temporary,'preview-release.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
    await rename(temporary,destination);
    return manifest;
  } catch(error) { await rm(temporary,{recursive:true,force:true}); throw error; }
}
export async function readArtifact(artifacts, releaseId, expectedHash) {
  safeId(releaseId); const parent=resolve(artifacts), root=resolve(parent,releaseId);
  await directory(parent); await directory(root); await ordinaryFile(resolve(root,'preview-release.json'));
  const bytes=await readFile(resolve(root,'preview-release.json')); if(expectedHash && hash(bytes)!==expectedHash)throw Error('MANIFEST_HASH_MISMATCH');
  const manifest=JSON.parse(bytes);
  if(!manifest || manifest.format!==1 || manifest.kind!=='local-engineering-preview' || manifest.releaseId!==releaseId || manifest.productionAuthorized!==false || !Array.isArray(manifest.files) || manifest.files.length===0 || typeof manifest.sourceDigest!=='string' || !/^[a-f0-9]{64}$/.test(manifest.sourceDigest))throw Error('INVALID_PREVIEW_MANIFEST');
  const paths=new Set(); let digestInBundle=false;
  for(const entry of manifest.files) {
    safePath(entry.path); if(paths.has(entry.path) || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes<0)throw Error('INVALID_ASSET_ENTRY');
    paths.add(entry.path);
    let current=root; for(const part of entry.path.split('/').slice(0,-1)){current=resolve(current,part);await directory(current);}
    const file=resolve(root,entry.path);await ordinaryFile(file);const body=await readFile(file);
    if(body.length!==entry.bytes || hash(body)!==entry.sha256)throw Error('ASSET_HASH_MISMATCH:'+entry.path);
    if(entry.path.endsWith('.js') && body.includes(Buffer.from(manifest.sourceDigest)))digestInBundle=true;
  }
  for(const name of requiredAssets) if(!paths.has(name))throw Error('BUILD_ASSET_MISSING:'+name);
  if(!digestInBundle)throw Error('BUILD_SOURCE_DIGEST_NOT_FOUND');
  return {root,manifest,manifestSHA256:hash(bytes)};
}
export async function readSelection(state) {
  try { await ordinaryFile(state); const selected=JSON.parse(await readFile(state,'utf8'));
    if(selected.format!==1 || !idPattern.test(selected.releaseId) || !/^[a-f0-9]{64}$/.test(selected.manifestSHA256))throw Error('INVALID_SELECTION');
    return selected;
  } catch(error){if(error.code==='ENOENT')return null;throw error;}
}
export async function selectPreviewArtifact({artifacts,state,releaseId,expectedReleaseId}) {
  const file=resolve(state);await mkdir(dirname(file),{recursive:true});
  const lock=await open(file+'.lock','wx');
  try {
    const previous=await readSelection(file);
    if((previous?.releaseId??null)!==expectedReleaseId)throw Error('PREVIEW_REVISION_CONFLICT');
    // Reselecting or rolling back must retain the already recorded artifact bytes.
    const recorded=previous?.releaseId===releaseId?previous:previous?.previous?.releaseId===releaseId?previous.previous:undefined;
    const artifact=await readArtifact(artifacts,releaseId,recorded?.manifestSHA256);
    if(previous?.releaseId===releaseId && previous.manifestSHA256===artifact.manifestSHA256)return previous;
    const selection={format:1,releaseId,manifestSHA256:artifact.manifestSHA256,previous:previous?{releaseId:previous.releaseId,manifestSHA256:previous.manifestSHA256}:null};
    const temporary=file+'.'+randomUUID()+'.tmp';
    try {const handle=await open(temporary,'wx');try {await handle.writeFile(JSON.stringify(selection)+'\n');await handle.sync();}finally{await handle.close();}await rename(temporary,file);}
    finally {await rm(temporary,{force:true});}
    return selection;
  } finally {await lock.close();await rm(file+'.lock',{force:true});}
}
