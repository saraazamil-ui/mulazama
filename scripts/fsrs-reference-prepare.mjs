import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {verifySourceBinding} from './fsrs-source-provenance.mjs';
import {tarballFiles,verifyReferenceArtifact,ReferenceUnavailable} from './fsrs-reference-loader.mjs';

/** Offline acquisition helper: no network, no package scripts, no dependency edits. */
export async function prepareReference(metadataPath,tarballPath,destination,attestationsPath=null){
  const metadataBytes=await readFile(metadataPath),metadata=JSON.parse(metadataBytes),tarball=await readFile(tarballPath);
  const integrity='sha512-'+createHash('sha512').update(tarball).digest('base64');
  if(metadata.name!=='ts-fsrs'||metadata.version!=='5.4.2'||metadata.dist?.integrity!==integrity||metadata.dist?.tarball!=='https://registry.npmjs.org/ts-fsrs/-/ts-fsrs-5.4.2.tgz')throw new ReferenceUnavailable('REFERENCE_REGISTRY_OR_TARBALL_MISMATCH');
  const attestationBytes=attestationsPath?await readFile(attestationsPath):null;
  const sourceBinding=verifySourceBinding(metadata,tarball,attestationBytes?JSON.parse(attestationBytes):null);
  const members=tarballFiles(tarball),root=resolve(destination);
  // EEXIST is intentional: never overwrite previous receipts or source bytes.
  await mkdir(root,{recursive:false});
  try{
    const pkgdir=join(root,'package');await mkdir(pkgdir);
    for(const [path,bytes]of members){await mkdir(dirname(join(pkgdir,path)),{recursive:true});await writeFile(join(pkgdir,path),bytes,{flag:'wx'});}
    await writeFile(join(root,'registry.json'),metadataBytes,{flag:'wx'});
    await writeFile(join(root,'ts-fsrs-5.4.2.tgz'),tarball,{flag:'wx'});
    if(attestationBytes)await writeFile(join(root,'attestations.json'),attestationBytes,{flag:'wx'});
    const receipt={schemaVersion:1,name:'ts-fsrs',version:'5.4.2',sourceCommit:sourceBinding.commit,sourceBinding,attestationsPath:attestationBytes?'attestations.json':null,license:'MIT',registryUrl:'https://registry.npmjs.org/ts-fsrs/5.4.2',artifactSha512:integrity,tarballPath:'ts-fsrs-5.4.2.tgz',registryMetadataPath:'registry.json',files:[...members].map(([path,bytes])=>({path,sha256:createHash('sha256').update(bytes).digest('hex')}))};
    const receiptPath=join(root,'receipt.json');await writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
    const verified=await verifyReferenceArtifact(pkgdir,receiptPath);
    return {directory:pkgdir,receipt:receiptPath,filesVerified:verified.identity.filesVerified,sourceAuthenticity:'independent review required'};
  }catch(error){await rm(root,{recursive:true,force:true});throw error;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [metadata,tarball,output,attestations]=process.argv.slice(2);
  if(!metadata||!tarball||!output)throw new Error('Usage: node scripts/fsrs-reference-prepare.mjs registry.json ts-fsrs-5.4.2.tgz NEW_DIRECTORY');
  console.log(JSON.stringify(await prepareReference(metadata,tarball,output,attestations),null,2));
}
