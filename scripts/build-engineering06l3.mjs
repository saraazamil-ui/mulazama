/** Separate loopback-only engineering build. No Quran activation or public deployment. */
import { spawnSync } from 'node:child_process';
import { readdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, extname } from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
const root=resolve(fileURLToPath(new URL('..',import.meta.url))),dist=resolve(root,'dist-engineering');
const args=process.argv.slice(2),option=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
const build=spawnSync(process.execPath,[resolve(root,'node_modules/vite/bin/vite.js'),'build','--config','vite.engineering.config.ts','--mode','test'],{cwd:root,stdio:'inherit'});
if(build.status!==0)process.exit(build.status??1);
const html=await readFile(resolve(dist,'engineering.html'));
await writeFile(resolve(dist,'index.html'),html);
const paths=[];
async function collect(dir=dist,prefix=''){
 for(const entry of await readdir(dir,{withFileTypes:true})){
  const path=resolve(dir,entry.name),relative=prefix+entry.name;
  if(entry.isSymbolicLink())throw Error('ENGINEERING_ASSET_SYMLINK');
  if(entry.isDirectory())await collect(path,relative+'/');
  else if(entry.isFile()&&!['sw.js','offline-assets.json'].includes(relative))paths.push(relative);
 }
}
await collect();paths.sort();
const entries=[];for(const path of paths){const bytes=await readFile(resolve(dist,path));entries.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
const version='mulazama-engineering-06l3-shell-'+createHash('sha256').update(JSON.stringify(entries)).digest('hex').slice(0,24);
const worker=`// Engineering shell only. Learner events are never stored in CacheStorage.
const CACHE=${JSON.stringify(version)},ASSETS=${JSON.stringify(paths)};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS.map(p=>new URL(p,self.registration.scope))))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('mulazama-engineering-06l3-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 const u=new URL(e.request.url),base=new URL(self.registration.scope);
 if(e.request.method!=='GET'||u.origin!==base.origin||!u.pathname.startsWith(base.pathname))return;
 const path=u.pathname.slice(base.pathname.length);
 if(e.request.mode==='navigate')e.respondWith(caches.open(CACHE).then(c=>c.match(new URL(ASSETS.includes(path)?path:'index.html',base))).then(r=>r||fetch(e.request)));
 else if(ASSETS.includes(path))e.respondWith(caches.open(CACHE).then(c=>c.match(new URL(path,base))).then(r=>r||fetch(e.request)));
});
`;
await writeFile(resolve(dist,'sw.js'),worker);
await writeFile(resolve(dist,'offline-assets.json'),JSON.stringify({kind:'isolated-engineering-build',productionAuthorized:false,quranApproved:false,version,files:paths,entries},null,2)+'\n');
console.log(JSON.stringify({kind:'isolated-engineering-build',productionAuthorized:false,quranApproved:false,version,assetCount:paths.length,offlineBrowserVerified:false}));
if(args.includes('--serve')){
 const port=Number(option('--port')??4178);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('INVALID_LOOPBACK_PORT');
 const allowed=new Set([...paths,'sw.js','offline-assets.json']);
 const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
 const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Robots-Tag','noindex, nofollow');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end('METHOD_NOT_ALLOWED');return;}
  try{
   const url=new URL(req.url,'http://127.0.0.1'),path=decodeURIComponent(url.pathname).slice(1)||'index.html';
   if(!allowed.has(path)){res.writeHead(404);res.end('NOT_FOUND');return;}
   const target=resolve(dist,path);if(!(await lstat(target)).isFile())throw Error('ASSET_UNAVAILABLE');
   const body=await readFile(target);res.setHeader('Content-Type',mime[extname(path)]??'application/octet-stream');res.writeHead(200);res.end(req.method==='HEAD'?undefined:body);
  }catch{res.writeHead(503);res.end('ENGINEERING_PREVIEW_UNAVAILABLE');}
 });
 await new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',ok);});
 console.log(JSON.stringify({origin:`http://127.0.0.1:${port}`,loopbackOnly:true,productionAuthorized:false}));
 const close=()=>server.close(()=>process.exit(0));process.on('SIGINT',close);process.on('SIGTERM',close);
}
