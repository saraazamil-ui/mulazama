// Generated from this build's exact assets. Personal events are NEVER cached here.
const CACHE="mulazama-shell-6d6b55eaa291d7e69ef1";
const ASSETS=["assets/adaptive-scheduling-BAdcPGRX.js","assets/index-BSeieCYc.js","assets/index-CmddJd3h.css","assets/personal-memory-FbHeuiO5.js","index.html","manifest.webmanifest"];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('mulazama-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
 const base=new URL('./',self.location.href),url=new URL(event.request.url);
 const relative=url.pathname.slice(base.pathname.length);
 if(event.request.mode==='navigate')event.respondWith(caches.open(CACHE).then(cache=>cache.match('index.html')).then(hit=>hit||fetch(event.request)));
 else if(ASSETS.includes(relative))event.respondWith(caches.open(CACHE).then(cache=>cache.match(event.request)).then(hit=>hit||fetch(event.request)));
});
