import { readdir,readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root=new URL('../dist/',import.meta.url);
async function collect(base,path='') {
 const files=[];
 for(const item of await readdir(base,{withFileTypes:true})){
  // Page images are fetched and verified on demand by the reader. Their size
  // and rights do not belong to the app-shell install or version fingerprint.
  // Skip before descending or reading: never precache a complete page corpus.
  if(path===''&&item.name==='mushaf')continue;
  if(item.isSymbolicLink())throw Error('Unsupported symbolic link in offline app shell: '+path+item.name);
  if(item.isDirectory())files.push(...await collect(new URL(item.name+'/',base),path+item.name+'/'));
  else if(item.isFile()) {if(!['sw.js','offline-assets.json'].includes(item.name))files.push(path+item.name);}
  else throw Error('Unsupported entry in offline app shell: '+path+item.name);
 }
 return files.sort();
}
const files=await collect(root);
const hash=createHash('sha256');for(const file of files)hash.update(await readFile(new URL(file,root)));
const version='mulazama-shell-'+hash.digest('hex').slice(0,20);
await writeFile(new URL('offline-assets.json',root),JSON.stringify({version,files},null,2));
const worker=`// Generated from this build's exact assets. Personal events are NEVER cached here.
const CACHE=${JSON.stringify(version)};
const ASSETS=${JSON.stringify(files)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('mulazama-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
 const base=new URL('./',self.location.href),url=new URL(event.request.url);
 if(!url.pathname.startsWith(base.pathname))return;
 const relative=url.pathname.slice(base.pathname.length);
 if(event.request.mode==='navigate')event.respondWith((async()=>{
  const known=relative===''||ASSETS.includes(relative),path=relative===''?'index.html':known?relative:'404.html';
  const hit=await (await caches.open(CACHE)).match(new URL(path,base));
  if(!hit)return fetch(event.request);
  return known?hit:new Response(await hit.arrayBuffer(),{status:404,headers:hit.headers});
 })());
 else if(ASSETS.includes(relative))event.respondWith(caches.open(CACHE).then(cache=>cache.match(event.request)).then(hit=>hit||fetch(event.request)));
});
`;
await writeFile(new URL('sw.js',root),worker);
console.log(JSON.stringify({offlineAppShell:'generated-not-browser-verified',version,assetCount:files.length}));
