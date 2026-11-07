import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { hash, readArtifact, readSelection } from './artifacts.mjs';
export const CSP="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
/** Binds loopback only; TLS keys are caller-owned files, never embedded in artifacts. */
export async function startPreviewServer({artifacts,state,port=4180,tls}) {
  let requests=0,failures=0; const cache=new Map();
  async function artifact(selection) {
    const key=selection.releaseId+':'+selection.manifestSHA256;
    if(!cache.has(key))cache.set(key,await readArtifact(artifacts,selection.releaseId,selection.manifestSHA256));
    return cache.get(key);
  }
  const handler=async(req,res)=>{
    requests++;
    const headers={'Content-Security-Policy':CSP,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(), microphone=(), geolocation=()','X-Robots-Tag':'noindex, nofollow','Cache-Control':'no-store'};
    const send=(status,body,type='text/plain; charset=utf-8')=>{res.writeHead(status,{...headers,'Content-Type':type});res.end(req.method==='HEAD'?undefined:body);};
    if(!['GET','HEAD'].includes(req.method)){send(405,'METHOD_NOT_ALLOWED');return;}
    try {
      const url=new URL(req.url,'http://127.0.0.1');
      let path;try{path=decodeURIComponent(url.pathname).slice(1);}catch{send(400,'INVALID_PATH');return;}
      if(path.includes('\\')||path.includes('\0')||path.split('/').some(x=>x==='..'||x==='.')||path.startsWith('.')){send(400,'INVALID_PATH');return;}
      const selected=await readSelection(state);if(!selected)throw Error('NO_PREVIEW_RELEASE');
      const current=await artifact(selected);headers['X-Mulazama-Preview-Release']=selected.releaseId;
      if(path==='__preview_health') {send(200,JSON.stringify({scope:'local-engineering-preview',releaseId:selected.releaseId,sourceDigest:current.manifest.sourceDigest,productionAuthorized:false,requests,failures,personalDataCollected:false}),'application/json');return;}
      if(!path)path='index.html';
      let source=current,entry=source.manifest.files.find(x=>x.path===path);
      // Retain the preceding release's hashed assets for clients finishing an update.
      if(!entry && path.startsWith('assets/') && selected.previous){source=await artifact(selected.previous);entry=source.manifest.files.find(x=>x.path===path);}
      if(!entry){send(404,'NOT_FOUND');return;}
      const body=await readFile(resolve(source.root,path));
      if(body.length!==entry.bytes||hash(body)!==entry.sha256)throw Error('ASSET_CHANGED_AFTER_SELECTION');
      headers['Cache-Control']=path.startsWith('assets/')?'public, max-age=31536000, immutable':'no-cache';
      headers['ETag']='"'+entry.sha256+'"';
      const extension=path.slice(path.lastIndexOf('.'));send(200,body,mime[extension]??'application/octet-stream');
    }catch{failures++;send(503,'PREVIEW_UNAVAILABLE');}
  };
  const server=tls?createHttpsServer({key:await readFile(tls.key),cert:await readFile(tls.cert)},handler):createServer(handler);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {server,origin:`${tls?'https':'http'}://127.0.0.1:${server.address().port}`,close:()=>new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve())),metrics:()=>({requests,failures})};
}
