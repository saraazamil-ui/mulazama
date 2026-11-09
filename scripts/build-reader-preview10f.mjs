/** Owner-private candidate review and synthetic learning. Ordinary build stays content-blocked. */
import {spawnSync} from 'node:child_process';
import {readFile,writeFile,readdir,copyFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(fileURLToPath(new URL('..',import.meta.url))),dist=resolve(root,'dist-reader-preview');
const built=spawnSync(process.execPath,[resolve(root,'node_modules/vite/bin/vite.js'),'build','--config','vite.reader-preview.config.ts','--mode','test'],{cwd:root,stdio:'inherit'});
if(built.status!==0)process.exit(built.status??1);
await copyFile(resolve(dist,'reader-preview.html'),resolve(dist,'index.html'));
// Take over the old preview's shell worker; never open or delete learner stores.
// Navigations use network so an older cached blocked entry cannot mask the new reader.
await writeFile(resolve(dist,'sw.js'),`self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('mulazama-shell-')).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.mode==='navigate'&&new URL(e.request.url).origin===self.location.origin)e.respondWith(fetch(e.request));});
`);
const entries=[];
async function walk(dir,prefix=''){
  for(const e of await readdir(dir,{withFileTypes:true})){
    const path=resolve(dir,e.name),rel=prefix+e.name;
    if(e.isSymbolicLink())throw Error('PREVIEW_SYMLINK');
    if(e.isDirectory())await walk(path,rel+'/');
    else{if(/^(?:content|mushaf)\/|hafs|mushafs-1|\.zip$/i.test(rel))throw Error('ORIGINAL_CONTENT_IN_PREVIEW');
      const bytes=await readFile(path);entries.push({path:rel,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
  }
}
await walk(dist);entries.sort((a,b)=>a.path.localeCompare(b.path));
const html=await readFile(resolve(dist,'index.html'),'utf8');
if(!html.includes('بيانات صناعية غير قرآنية')||!html.includes('dir="rtl"'))throw Error('PREVIEW_LABEL_MISSING');
const js=(await Promise.all(entries.filter(x=>x.path.endsWith('.js')).map(x=>readFile(resolve(dist,x.path),'utf8')))).join('\n');
if(!js.includes('test-reader-preview-10f')||!js.includes('mulazama-reader-preview-db-10f')||!js.includes('mulazama-preview-05a.sara-a-zamil.chatgpt.site'))throw Error('PREVIEW_ISOLATION_MISSING');
await writeFile(resolve(dist,'preview-manifest.json'),JSON.stringify({kind:'owner-private-candidate-review-and-synthetic-learning',quranApproved:false,productionReady:false,ordinaryBuild:'unchanged-blocked-content-entry',sourceAssets:'authored non-Quran PNG fixtures; hash-pinned candidate metadata; SVG fetched on demand from immutable commit',candidateCommit:'3ff27b46cecb0c0519d77531d9c868a579d1f623',quranLearningActivated:false,entries},null,2)+'\n');
console.log(JSON.stringify({privateReaderPreview:'built',files:entries.length,externalCandidatePages:true,quranLearningActivated:false,productionReady:false}));
