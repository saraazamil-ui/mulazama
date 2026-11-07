// Generated from this build's exact assets. Personal events are NEVER cached here.
const CACHE="mulazama-shell-c95ae76675a8991ca9e2";
const ASSETS=["404.html","assets/adaptive-scheduling-DiFFnJJC.js","assets/index-B5CXe41M.js","assets/index-CeozoC8Z.css","assets/personal-memory-DEJklEDW.js","icon-192.png","icon-512.png","icon.svg","index.html","maintenance.html","manifest.webmanifest","policies.css","privacy.html","support.html","terms.html"];
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
