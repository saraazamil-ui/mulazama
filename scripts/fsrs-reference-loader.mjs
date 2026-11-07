import {verifySourceBinding} from './fsrs-source-provenance.mjs';
import {readFile,lstat,readdir,realpath} from 'node:fs/promises';
import {resolve,join,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';

const PIN={name:'ts-fsrs',version:'5.4.2',commit:'bb71e35a2f5af5a5ac6cce9ef7c41ad24855721d'};
const digest=(bytes,algorithm='sha256')=>createHash(algorithm).update(bytes).digest(algorithm==='sha512'?'base64':'hex');
export class ReferenceUnavailable extends Error {constructor(code){super(code);this.name='ReferenceUnavailable';this.code=code;}}
const fail=code=>{throw new ReferenceUnavailable(code);};
/** A bounded, deliberately narrow npm USTAR verifier. Unsupported types block. */
export function tarballFiles(bytes){
  if(bytes.length>8*1024*1024)fail('REFERENCE_TARBALL_TOO_LARGE');
  let tar;try{tar=gunzipSync(bytes,{maxOutputLength:32*1024*1024});}catch{fail('REFERENCE_TARBALL_NOT_VALID_BOUNDED_GZIP');}
  const files=new Map();let offset=0,ended=false;
  const text=(buffer,start,length)=>buffer.subarray(start,start+length).toString('utf8').replace(/\0.*$/s,'');
  while(offset+512<=tar.length){
    const header=tar.subarray(offset,offset+512);offset+=512;
    if(header.every(b=>b===0)){ended=true;break;}
    const rawSum=text(header,148,8).trim();if(!/^[0-7]+$/.test(rawSum))fail('REFERENCE_TAR_HEADER_CHECKSUM');
    const actualSum=header.reduce((s,b,i)=>s+(i>=148&&i<156?32:b),0);
    if(actualSum!==parseInt(rawSum,8))fail('REFERENCE_TAR_HEADER_CHECKSUM');
    const rawSize=text(header,124,12).trim();if(!/^[0-7]+$/.test(rawSize))fail('REFERENCE_TAR_SIZE');
    const size=parseInt(rawSize,8);if(!Number.isSafeInteger(size)||size<0||offset+size>tar.length)fail('REFERENCE_TAR_SIZE');
    const prefix=text(header,345,155),name=(prefix?prefix+'/':'')+text(header,0,100),type=header[156];
    if(!name.startsWith('package/')||name.includes('\\')||name.includes('\ufffd'))fail('REFERENCE_TAR_PATH');
    const path=name.slice(8).replace(/\/$/,'');
    if(path&&path.split('/').some(p=>!p||p==='..'||p==='.'))fail('REFERENCE_TAR_PATH');
    if(type===48||type===0){if(!path||files.has(path))fail('REFERENCE_TAR_DUPLICATE_OR_EMPTY_FILE');files.set(path,tar.subarray(offset,offset+size));}
    else if(type!==53)fail('REFERENCE_TAR_UNSUPPORTED_ENTRY');
    offset+=Math.ceil(size/512)*512;
  }
  if(!ended||tar.length-offset<512||tar.subarray(offset).some(b=>b!==0)||files.size===0)fail('REFERENCE_TAR_TRUNCATED_OR_TRAILING_DATA');
  return files;
}
/**
 * Verification tool, never imported by the application. The immutable artifact
 * receipt and registry metadata must be obtained and reviewed independently.
 * Checksum equality proves bytes agree with supplied metadata, not its origin.
 * The release evidence signer must separately approve that origin.
 */
export async function verifyReferenceArtifact(directory,receiptFile){
  if(!receiptFile)fail('REFERENCE_RECEIPT_UNAVAILABLE');
  const receipt=JSON.parse(await readFile(receiptFile,'utf8'));
  const root=await realpath(directory);
  if(receipt.name!==PIN.name||receipt.version!==PIN.version||receipt.sourceCommit!==PIN.commit||receipt.license!=='MIT')fail('REFERENCE_PIN_MISMATCH');
  if(receipt.registryUrl!=='https://registry.npmjs.org/ts-fsrs/5.4.2')fail('REFERENCE_REGISTRY_MISMATCH');
  if(!Array.isArray(receipt.files)||receipt.files.length<3)fail('REFERENCE_FILE_MANIFEST_MISSING');
  if(typeof receipt.tarballPath!=='string'||typeof receipt.registryMetadataPath!=='string')fail('REFERENCE_TARBALL_OR_REGISTRY_METADATA_MISSING');
  const receiptDirectory=resolve(receiptFile,'..');
  const metadata=JSON.parse(await readFile(resolve(receiptDirectory,receipt.registryMetadataPath),'utf8'));
  if(metadata.name!==PIN.name||metadata.version!==PIN.version||(metadata.gitHead!==undefined&&metadata.gitHead!==PIN.commit))fail('REFERENCE_REGISTRY_IDENTITY_MISMATCH');
  const integrity=metadata.dist?.integrity;
  if(typeof integrity!=='string'||!/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity))fail('REFERENCE_REGISTRY_INTEGRITY_MISSING');
  if(metadata.dist?.tarball!=='https://registry.npmjs.org/ts-fsrs/-/ts-fsrs-5.4.2.tgz')fail('REFERENCE_REGISTRY_TARBALL_MISMATCH');
  const tarball=await readFile(resolve(receiptDirectory,receipt.tarballPath));
  if(`sha512-${digest(tarball,'sha512')}`!==integrity||receipt.artifactSha512!==integrity)fail('REFERENCE_TARBALL_INTEGRITY_MISMATCH');
  const attestations=receipt.attestationsPath?JSON.parse(await readFile(resolve(receiptDirectory,receipt.attestationsPath),'utf8')):null;
  const sourceBinding=verifySourceBinding(metadata,tarball,attestations);
  const archived=tarballFiles(tarball);
  const seen=new Set();
  for(const item of receipt.files){
    if(!item||typeof item.path!=='string'||!item.path||item.path.includes('\\')||item.path.split('/').some(part=>part==='..'||part==='.'||part==='')||!/^\w[\w./-]*$/.test(item.path)||!/^[a-f0-9]{64}$/.test(item.sha256)||seen.has(item.path))fail('REFERENCE_FILE_MANIFEST_INVALID');
    seen.add(item.path);const file=resolve(root,item.path),rel=relative(root,file);
    if(rel.startsWith('..'+sep)||rel==='..')fail('REFERENCE_PATH_ESCAPE');
    if(!(await lstat(file)).isFile()||await realpath(file)!==file)fail('REFERENCE_FILE_SYMLINK_OR_NOT_FILE');
    if(digest(await readFile(file))!==item.sha256)fail('REFERENCE_FILE_INTEGRITY_MISMATCH');
    if(!archived.has(item.path)||digest(archived.get(item.path))!==item.sha256)fail('REFERENCE_ARCHIVE_EXTRACTION_MISMATCH');
  }
  // Every file must be covered, not merely package.json and a favorable module.
  const inventory=[];
  async function walk(dir){for(const d of await readdir(dir,{withFileTypes:true})){const file=join(dir,d.name);if(d.isSymbolicLink())fail('REFERENCE_FILE_SYMLINK_OR_NOT_FILE');if(d.isDirectory())await walk(file);else if(d.isFile())inventory.push(relative(root,file).split(sep).join('/'));else fail('REFERENCE_UNSUPPORTED_FILE');}}
  await walk(root);if(inventory.some(file=>!seen.has(file))||inventory.length!==seen.size||archived.size!==seen.size)fail('REFERENCE_INCOMPLETE_FILE_MANIFEST');
  if(!seen.has('package.json')||!seen.has('LICENSE'))fail('REFERENCE_LICENSE_OR_PACKAGE_MISSING');
  const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
  if(pkg.name!==PIN.name||pkg.version!==PIN.version||pkg.license!=='MIT')fail('REFERENCE_PACKAGE_IDENTITY_MISMATCH');
  const license=await readFile(join(root,'LICENSE'),'utf8');
  if(!license.includes('MIT License')||!license.includes('Permission is hereby granted')||!license.includes('THE SOFTWARE IS PROVIDED'))fail('REFERENCE_LICENSE_INCOMPLETE');
  if(pkg.dependencies&&Object.keys(pkg.dependencies).length)fail('REFERENCE_TRANSITIVE_DEPENDENCIES_NOT_PINNED');
  // A self-contained upstream ESM distribution only; no code is reconstructed.
  const entry=typeof pkg.module==='string'?pkg.module:null;
  if(!entry||!seen.has(entry.replace(/^\.\//,'')))fail('REFERENCE_ESM_ENTRY_UNVERIFIED');
  const entryPath=resolve(root,entry);
  return {root,entryPath,identity:{name:pkg.name,version:pkg.version,model:'FSRS-6',sourceCommit:PIN.commit,
    artifactSha512:integrity,filesVerified:seen.size,executed:false},receiptSha256:digest(await readFile(receiptFile)),
    sourceBinding,provenanceReview:'Supplied registry metadata and checksums verified; source authenticity requires independent release review'};
}
/** All numerical expected values come from upstream methods, never our formulas. */
export function createLegacyLibraryProbe(module,weights){
  if(typeof module.fsrs!=='function')fail('REFERENCE_LEGACY_API_UNAVAILABLE');
  const expectedWeights=[...weights];
  return {run(input){
    const lib=module.fsrs({w:[...expectedWeights],request_retention:input.desiredRetention,enable_short_term:true,
      enable_fuzz:false,maximum_interval:36500,learning_steps:[],relearning_steps:[]});
    if(typeof lib.next_state!=='function'||typeof lib.next_interval!=='function'||typeof lib.forgetting_curve!=='function')fail('REFERENCE_LEGACY_API_UNAVAILABLE');
    if(!lib.parameters||JSON.stringify(lib.parameters.w)!==JSON.stringify(expectedWeights)||lib.parameters.enable_short_term!==true||lib.parameters.enable_fuzz!==false)fail('REFERENCE_EFFECTIVE_CONFIGURATION_MISMATCH');
    let previous=input.initial===null?null:{...input.initial};
    return input.reviews.map(review=>{
      const elapsedDays=previous===null?0:Math.floor((Date.parse(review.at)-Date.parse(previous.lastReviewAt))/86400000);
      if(elapsedDays<0)fail('REFERENCE_CLOCK_INVALID');
      const before=previous===null?null:lib.forgetting_curve(elapsedDays,previous.stability);
      const next=lib.next_state(previous===null?null:{stability:previous.stability,difficulty:previous.difficulty},elapsedDays,review.grade);
      const interval=lib.next_interval(next.stability,elapsedDays);
      previous={...next,lastReviewAt:review.at};
      return {stability:next.stability,difficulty:next.difficulty,retrievabilityBefore:before,elapsedDays,
        roundedIntervalDays:interval,rawDueAt:new Date(Date.parse(review.at)+interval*86400000).toISOString()};
    });
  }};
}
export async function loadTsFsrsReference(directory,receiptFile,weights){
  const artifact=await verifyReferenceArtifact(directory,receiptFile);
  const module=await import(pathToFileURL(artifact.entryPath).href);
  const probe=createLegacyLibraryProbe(module,weights);
  // Importing bytes does not prove an algorithm was executed. Require a real
  // upstream call before recording executed=true; incompatible APIs stay blocked.
  const smoke=probe.run({initial:null,reviews:[{grade:3,at:'2026-01-01T00:00:00.000Z'}],desiredRetention:.9});
  if(smoke.length!==1||!Number.isFinite(smoke[0].stability)||!Number.isFinite(smoke[0].difficulty)||!Number.isInteger(smoke[0].roundedIntervalDays))fail('REFERENCE_EXECUTION_INVALID');
  return {...artifact,probe,identity:{...artifact.identity,weights:[...weights],enableShortTerm:true,enableFuzz:false,executed:true}};
}
