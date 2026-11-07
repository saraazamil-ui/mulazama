/** Explicit local-only CLI. No provider API, DNS, account creation or production deployment. */
import { resolve } from 'node:path';
import { createPreviewArtifact,selectPreviewArtifact } from './preview06l2/artifacts.mjs';
import { startPreviewServer } from './preview06l2/server.mjs';
const [command,...args]=process.argv.slice(2);const option=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
const artifacts=resolve(option('--artifacts')??'.preview-artifacts'),state=resolve(option('--state')??'.preview-state.json');
if(command==='create')console.log(JSON.stringify(await createPreviewArtifact({dist:resolve(option('--dist')??'dist'),artifacts,releaseId:option('--id'),sourceDigest:option('--source-digest')}),null,2));
else if(command==='select') {
 if(!args.includes('--expected'))throw Error('Use --expected <current-id> or --expected none for an empty preview.');
 console.log(JSON.stringify(await selectPreviewArtifact({artifacts,state,releaseId:option('--id'),expectedReleaseId:option('--expected')==='none'?null:option('--expected')})));
}else if(command==='serve') {
 const cert=option('--cert'),key=option('--key');if(!!cert!==!!key)throw Error('Both --cert and --key required.');
 const instance=await startPreviewServer({artifacts,state,port:Number(option('--port')??4180),tls:cert?{cert,key}:undefined});
 console.log(JSON.stringify({origin:instance.origin,scope:'loopback-only',productionAuthorized:false}));
 const stop=async()=>{await instance.close();process.exit(0);};process.on('SIGINT',stop);process.on('SIGTERM',stop);
}else throw Error('Expected create, select or serve. This tool cannot deploy production.');
