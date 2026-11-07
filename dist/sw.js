// Generated from this build's exact assets. Personal events are NEVER cached here.
const CACHE="mulazama-shell-402485269b50ffbcbe97";
const ASSETS=["assets/adaptive-scheduling-w6bOq4m1.js","assets/index-AtTyBVEF.css","assets/index-BMHy5AIA.js","assets/personal-memory-DRSImXDx.js","icon-192.png","icon-512.png","icon.svg","index.html","manifest.webmanifest","policies.css","privacy.html","support.html","terms.html"];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('mulazama-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
 const base=new URL('./',self.location.href),url=new URL(event.request.url);
 if(!url.pathname.startsWith(base.pathname))return;
 const relative=url.pathname.slice(base.pathname.length);
 if(event.request.mode==='navigate')event.respondWith(caches.open(CACHE).then(cache=>cache.match(new URL(ASSETS.includes(relative)?relative:'index.html',base))).then(hit=>hit||fetch(event.request)));
 else if(ASSETS.includes(relative))event.respondWith(caches.open(CACHE).then(cache=>cache.match(event.request)).then(hit=>hit||fetch(event.request)));
});
