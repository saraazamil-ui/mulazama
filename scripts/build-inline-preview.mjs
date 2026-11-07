import {readFile,writeFile,readdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Script} from 'node:vm';
const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const assets=await readdir(resolve(project,'dist/assets'));
const scriptFile=assets.find(f=>/^index-.*\.js$/.test(f));
const styleFile=assets.find(f=>/^index-.*\.css$/.test(f));
if(!scriptFile||!styleFile)throw Error('Build the current web app first.');
let code=await readFile(resolve(project,'dist/assets',scriptFile),'utf8');
const css=await readFile(resolve(project,'dist/assets',styleFile),'utf8');
const preludeEnd=code.indexOf('})();');
if(!code.startsWith('(function(){')||preludeEnd<0)throw Error('Unsupported Vite prelude.');
code=code.slice(preludeEnd+5);
const root=code.match(/const ([\w$]+)=[\w$]+\.createRoot\(document\.getElementById\("root"\)\);/);
if(!root)throw Error('App root was not found.');
const workerStart=code.indexOf('"serviceWorker"in navigator&&window.addEventListener("load",');
const firstRender=code.indexOf(root[1]+'.render(',workerStart);
if(workerStart<0||firstRender<workerStart)throw Error('Unsupported service-worker entry.');
code=code.slice(0,workerStart)+code.slice(firstRender);
const entry=code.match(/([\w$]+)\.open\(\)\.then\(([\w$]+)=>\{([\w$]+)\.render/);
if(!entry||entry[3]!==root[1])throw Error('Application service entry was not found.');
code=code.replace(entry[1]+'.open().then',entry[1]+'.open(new MulazamaPreviewStore()).then')
 .replaceAll('document.getElementById("root")','document.getElementById("mulazama-preview-root")')
 .replaceAll('crypto.randomUUID()','mulazamaPreviewId()')
 .replaceAll('سجل محلي مشفر داخل المتصفح','بيانات المعاينة مؤقتة في الذاكرة');
if(/\bfetch\s*\(|XMLHttpRequest|WebSocket\s*\(/.test(code))throw Error('Unexpected networking in the preview.');
const bootstrap=`function mulazamaPreviewId(){return globalThis.crypto?.randomUUID?.()??'preview-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);}
class MulazamaPreviewStore {
 constructor(){this.snapshot={revision:0,events:[]};}
 async load(){return structuredClone(this.snapshot);}
 async append(events,expectedRevision){
  const old=new Map(this.snapshot.events.map(e=>[e.eventId,e]));
  if(events.every(e=>old.has(e.eventId))){if(events.some(e=>JSON.stringify(old.get(e.eventId))!==JSON.stringify(e)))throw Error('EVENT_CONFLICT');return this.load();}
  if(expectedRevision!==this.snapshot.revision)throw Error('REVISION_CONFLICT');
  if(events.some(e=>old.has(e.eventId)))throw Error('EVENT_CONFLICT');
  this.snapshot={revision:this.snapshot.revision+1,events:structuredClone([...this.snapshot.events,...events])};return this.load();
 }
 async replace(events,expectedRevision){if(expectedRevision!==this.snapshot.revision)throw Error('REVISION_CONFLICT');this.snapshot={revision:this.snapshot.revision+1,events:structuredClone(events)};return this.load();}
 async clear(expectedRevision){await this.replace([],expectedRevision);}
 close(){}
}
`;
new Script(bootstrap+code);
const fragment=`<div id="mulazama-inline-preview" dir="rtl">
<style>${css.replaceAll('</style','<\\/style')}
#mulazama-inline-preview{position:relative;isolation:isolate;color:var(--text);background:var(--bg);font-family:Tahoma,"Geeza Pro",Arial,sans-serif;min-width:0;overflow:hidden}
#mulazama-inline-preview .preview-context{position:relative;z-index:1000;padding:14px 22px;background:#e8eee5;color:#123e34;border-bottom:1px solid #dde2d8;font-size:14px;text-align:center}
#mulazama-inline-preview .app-shell{min-height:740px}
#mulazama-inline-preview .sidebar{position:absolute;top:64px}
#mulazama-inline-preview .bottom-nav{position:sticky}
#mulazama-inline-preview .cursor-interaction,#mulazama-inline-preview button{cursor:inherit}
</style>
<div class="preview-context">معاينة مُلازَمَة · بيانات التجربة مؤقتة وتُمسح عند إعادة فتح المعاينة · جلسات القرآن تنتظر اعتماد المحتوى</div>
<div id="mulazama-preview-root"></div>
<script>${(bootstrap+code).replace(/<\/script/gi,'<\\/script')}</script>
</div>`;
const destination=resolve(project,'../mulazama-preview-checked.html');
await writeFile(destination,fragment);
const checked=await readFile(destination,'utf8');
if(Buffer.byteLength(checked)>1_000_000||!checked.startsWith('<div id="mulazama-inline-preview"'))throw Error('Invalid preview markup.');
console.log(JSON.stringify({path:destination,bytes:Buffer.byteLength(checked),storage:'explicit-preview-memory-only',productionStorageChanged:false,networkCalls:false}));
