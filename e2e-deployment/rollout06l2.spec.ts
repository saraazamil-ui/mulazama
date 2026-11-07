import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
// @ts-expect-error Local Node-only engineering tooling has no runtime app imports.
import { createPreviewArtifact, selectPreviewArtifact } from '../scripts/preview06l2/artifacts.mjs';
// @ts-expect-error Local Node-only engineering tooling has no runtime app imports.
import { startPreviewServer, CSP } from '../scripts/preview06l2/server.mjs';
let scratch:string, artifacts:string, state:string, server:any, secureServer:any;
const baselineFixture=resolve('references/06l1-preview-baseline');
test.beforeAll(async()=>{
 scratch=await mkdtemp(join(tmpdir(),'mulazama-l2-preview-'));artifacts=join(scratch,'artifacts');state=join(scratch,'active.json');
 // Portable subset of the exact original L1 ZIP, verified at acquisition and pinned here.
 const python=`import sys,zipfile,json,hashlib,pathlib\np=pathlib.Path(sys.argv[1]);raw=(p/'receipt.json').read_bytes();assert hashlib.sha256(raw).hexdigest()=='a5bd67bce18d2c88b22de292f0a0e74f80a06e7b728e4b01ae57f8d0d4cc4ba1'\nm=json.loads(raw);assert hashlib.sha256((p/'build.zip').read_bytes()).hexdigest()==m['buildZipSHA256'];z=zipfile.ZipFile(p/'build.zip')\nfor e in m['files']:\n assert e['path'].startswith('dist/') and '..' not in pathlib.PurePosixPath(e['path']).parts\n b=z.read(e['path']);assert len(b)==e['bytes'] and hashlib.sha256(b).hexdigest()==e['sha256'];t=pathlib.Path(sys.argv[2])/e['path'];t.parent.mkdir(parents=True,exist_ok=True);t.write_bytes(b)\nprint(m['sourceDigest'])`;
 const baselineDigest=execFileSync('python3',['-c',python,baselineFixture,scratch],{encoding:'utf8'}).trim();
 const currentDigest=(await readFile('src/release/build-context.generated.ts','utf8')).match(/[a-f0-9]{64}/)![0];
 await createPreviewArtifact({dist:join(scratch,'dist'),artifacts,releaseId:'l1',sourceDigest:baselineDigest});
 await createPreviewArtifact({dist:resolve('dist'),artifacts,releaseId:'l2',sourceDigest:currentDigest});
 await selectPreviewArtifact({artifacts,state,releaseId:'l1',expectedReleaseId:null});
 // Ephemeral self-signed loopback TLS; no system trust installation or public certificate claim.
 const key=join(scratch,'local.key'),cert=join(scratch,'local.crt');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=127.0.0.1'],{stdio:'ignore'});
 secureServer=await startPreviewServer({artifacts,state,port:0,tls:{key,cert}});
 server=await startPreviewServer({artifacts,state,port:0});
});
test.afterAll(async()=>{if(server)await server.close();if(secureServer)await secureServer.close();if(scratch)await rm(scratch,{recursive:true,force:true});});
async function encryptedSnapshot(page:Page) {
 return page.evaluate(async()=>{
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('mulazama-learning-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  try {
   const rows=await new Promise<any[]>((resolve,reject)=>{const request=db.transaction('events','readonly').objectStore('events').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
   const serialized=JSON.stringify(rows,(_key,value)=>value instanceof ArrayBuffer?Array.from(new Uint8Array(value)):ArrayBuffer.isView(value)?Array.from(new Uint8Array(value.buffer,value.byteOffset,value.byteLength)):value);
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(serialized)))).map(x=>x.toString(16).padStart(2,'0')).join('');
   return {rows:rows.length,sha256:digest};
  }finally{db.close();}
 });
}
async function activate(context:BrowserContext,page:Page,releaseId:string,expectedReleaseId:string) {
 await selectPreviewArtifact({artifacts,state,releaseId,expectedReleaseId});
 await page.evaluate(async()=>{
  const registration=await navigator.serviceWorker.ready;await registration.update();
  if(!registration.waiting)await new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Worker update did not reach waiting')),15000);
   const inspect=()=>{if(registration.waiting){clearTimeout(timer);resolve();}else if(registration.installing)registration.installing.addEventListener('statechange',inspect,{once:true});};
   registration.addEventListener('updatefound',inspect,{once:true});inspect();
  });
 });
 // Close all tabs, allowing the real waiting worker to activate without skipWaiting.
 await page.close();const next=await context.newPage();await next.goto(server.origin+'/#S05');
 await expect(next.locator('.prototype-strip')).toContainText(releaseId==='l2'?'06-L2':'06-L1');return next;
}
test('L2DEP01 HTTPS preview enforces headers and allows only manifest assets without exposing source files',async({browser},info)=>{
 const context=await browser.newContext({ignoreHTTPSErrors:true});
 try {
  const response=await context.request.get(secureServer.origin+'/');expect(response.status()).toBe(200);
  expect(response.headers()['content-security-policy']).toBe(CSP);expect(response.headers()['x-content-type-options']).toBe('nosniff');
  expect(response.headers()['cache-control']).toBe('no-cache');expect(response.headers()['x-robots-tag']).toContain('noindex');
  expect((await context.request.get(secureServer.origin+'/src/main.tsx')).status()).toBe(404);
  expect((await context.request.get(secureServer.origin+'/%2e%2e%2fpackage.json')).status()).toBe(400);
  expect((await context.request.post(secureServer.origin+'/',{data:'no mutation'})).status()).toBe(405);
  const health=await (await context.request.get(secureServer.origin+'/__preview_health')).json();expect(health.productionAuthorized).toBe(false);
  await info.attach('preview-headers.json',{body:JSON.stringify({headers:response.headers(),health,tls:'self-signed ephemeral loopback; browser test permits its own self-signed loopback certificate only; no system trust store changes'}),contentType:'application/json'});
 }finally{await context.close();}
});
test('L2DEP02 L1 to L2 update and rollback preserve exact encrypted IndexedDB rows, settings, offline access and blocked sessions',async({browser},info)=>{
 // A fresh isolated profile, not the owner's browser, and no event replacement or production migration.
 const context=await browser.newContext({serviceWorkers:'allow',locale:'ar-SA',timezoneId:'Asia/Riyadh',viewport:{width:320,height:740}});
 try {
  let page=await context.newPage();await page.goto(server.origin+'/#S02');
  await page.getByRole('button',{name:'التالي: المحفوظات والهدف'}).click();
  await page.getByRole('button',{name:'التالي: الوقت المناسب'}).click();
  await page.getByRole('button',{name:'احفظ واذهب إلى الرئيسية'}).click();
  await expect(page.locator('main[data-screen="S05"]')).toBeVisible();
  await page.goto(server.origin+'/#S17');await page.getByRole('checkbox',{name:'تكبير النص'}).click();
  await expect(page.getByRole('checkbox',{name:'تكبير النص'})).toBeChecked();
  await page.evaluate(async()=>{
    await navigator.serviceWorker.register('/sw.js');
    await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('SW_READY_TIMEOUT')),10000))]);
  });await page.reload();
  await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
  const before=await encryptedSnapshot(page);expect(before.rows).toBeGreaterThan(1);
  page=await activate(context,page,'l2','l1');expect(await encryptedSnapshot(page)).toEqual(before);
  await page.goto(server.origin+'/#S17');await expect(page.getByRole('checkbox',{name:'تكبير النص'})).toBeChecked();
  await page.goto(server.origin+'/#S08');await expect(page.getByRole('heading',{name:'النص المعتمد ينتظر الإضافة'})).toBeVisible();
  await context.setOffline(true);await page.reload();await expect(page.getByRole('heading',{name:'النص المعتمد ينتظر الإضافة'})).toBeVisible();expect(await encryptedSnapshot(page)).toEqual(before);
  await context.setOffline(false);page=await activate(context,page,'l1','l2');expect(await encryptedSnapshot(page)).toEqual(before);
  await page.goto(server.origin+'/#S17');await expect(page.getByRole('checkbox',{name:'تكبير النص'})).toBeChecked();
  await page.goto(server.origin+'/#S08');await expect(page.getByRole('heading',{name:'النص المعتمد ينتظر الإضافة'})).toBeVisible();
  await context.setOffline(true);await page.reload();await expect(page.getByRole('heading',{name:'النص المعتمد ينتظر الإضافة'})).toBeVisible();expect(await encryptedSnapshot(page)).toEqual(before);
  await info.attach('update-rollback.json',{body:JSON.stringify({before,after:await encryptedSnapshot(page),sequence:['l1','l2','l1'],transport:'HTTP loopback secure context; TLS headers tested separately with ephemeral certificate',sameOrigin:true,offline:true,eventsRewritten:false,productionDeployment:false,realUserData:false}),contentType:'application/json'});
 }finally{await context.close();}
});
