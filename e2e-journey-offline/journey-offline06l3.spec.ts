import {readerTools,sessionOptions,enterRecall,openProgress} from '../e2e-reader-preview/ux-helpers';
import {test,expect,type Page,type Browser,type BrowserContext} from '@playwright/test';
async function isolated(browser:Browser){return browser.newContext({locale:'ar-SA',timezoneId:'Asia/Riyadh',viewport:{width:320,height:740},serviceWorkers:'allow',acceptDownloads:true});}
async function setup(page:Page,prior=false){
 await page.clock.setFixedTime(new Date('2026-11-07T09:00:00Z'));
 await page.goto('http://127.0.0.1:4178/engineering.html');
 await expect(page.getByRole('note').filter({hasText:'تجربة بمواد صناعية غير قرآنية'})).toBeVisible();
 await page.getByRole('button',{name:'أعد خطتي'}).click();
 if(prior)await page.getByRole('radio',{name:'لدي محفوظات سابقة وأريد مراجعتها'}).check();
 await page.getByRole('button',{name:'التالي: المحفوظات والهدف'}).click();
 if(prior)await page.getByRole('button',{name:'أضف إلى اختياراتي'}).click();
 await page.getByRole('button',{name:'التالي: الوقت المناسب'}).click();
 await page.getByRole('checkbox',{name:'السبت',exact:true}).check();
 await page.getByRole('button',{name:'احفظ واذهب إلى الرئيسية'}).click();
 await expect(page.getByRole('button',{name:/^ابدأ (الحفظ|المراجعة)$/,exact:true})).toBeVisible();
 await page.evaluate(async()=>{await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('SW_READY_TIMEOUT')),10000))]);});
 await page.reload();await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
 await expect(page.getByRole('button',{name:/^ابدأ (الحفظ|المراجعة)$/,exact:true})).toBeVisible();
}
/** Read-only inspection of this fresh context's UUID-named QA database only.
 * No production name, no source imports, no clear/replace/delete/put operations. */
async function facts(page:Page){return page.evaluate(async()=>{
 const name=sessionStorage.getItem('mulazama-engineering-db-06l3');
 if(!name||!/^mulazama-engineering-06l3-[a-f0-9-]{36}$/.test(name))throw Error('NOT_ISOLATED_QA_DATABASE');
 if(!(await indexedDB.databases()).some(db=>db.name===name))throw Error('QA_DATABASE_NOT_CREATED_BY_UI');
 const db=await new Promise<IDBDatabase>((ok,fail)=>{const r=indexedDB.open(name);r.onsuccess=()=>ok(r.result);r.onerror=()=>fail(r.error);r.onupgradeneeded=()=>{r.transaction?.abort();fail(Error('READ_ONLY_EXPECTED_EXISTING_DATABASE'));};});
 try{
  const raw=await new Promise<{rows:any[];key:CryptoKey}>((ok,fail)=>{
   const tx=db.transaction(['events','keys'],'readonly'),rows=tx.objectStore('events').getAll(),key=tx.objectStore('keys').get('data-key');
   tx.oncomplete=()=>ok({rows:rows.result,key:key.result.value});tx.onerror=()=>fail(tx.error);tx.onabort=()=>fail(tx.error);
  });
  if(raw.key.extractable)throw Error('LOCAL_KEY_EXTRACTABLE');
  const events=[];
  for(const row of raw.rows.sort((a,b)=>a.sequence-b.sequence)){
   if(row.encoding!=='aes-gcm-v1')throw Error('UNENCRYPTED_QA_EVENT');
   const aad=new TextEncoder().encode(JSON.stringify({encoding:row.encoding,eventId:row.eventId,sequence:row.sequence}));
   const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:row.iv,additionalData:aad,tagLength:128},raw.key,row.ciphertext);
   events.push(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  }
  return {name,events,encryptedRows:raw.rows.length};
 }finally{db.close();}
});}
async function submit(page:Page){
 await page.getByRole('button',{name:/^ابدأ (الحفظ|المراجعة)$/,exact:true}).click();
 await enterRecall(page);
 await expect(page.getByLabel('مادة الاختبار الصناعي',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'سمّعت المقطع كاملًا بلا خطأ معلوم — جهد عادي',exact:true}).click();
 await expect(page.getByRole('heading',{name:'حُفظ تقييمك الذاتي'})).toBeVisible();
 // The assessment heading can precede S09's asynchronous plan commit. Capture
 // the reload baseline only once the existing planner has durably accounted for it.
 await expect.poll(async()=>{
  const saved=await facts(page),assessment=saved.events.findLastIndex(e=>e.type==='AssessmentSubmitted'),plan=saved.events.findLastIndex(e=>e.type==='PlanRecomputed'&&e.data.scope==='hme');
  return {afterAssessment:assessment>=0&&plan>assessment,spentMinutes:saved.events[plan]?.data.command.spentMinutes};
 }).toEqual({afterAssessment:true,spentMinutes:2});
}
async function home(page:Page){await page.getByRole('button',{name:'العودة إلى اليوم'}).click();await expect(page.getByText(/أنجزت اليوم: 1/)).toBeVisible();}
test('L3OFFJ01 built isolated newcomer journey completes offline, writes corrected HME once and survives offline reload',async({browser},info)=>{
 const context=await isolated(browser);try{
  const page=await context.newPage();await setup(page);await context.setOffline(true);
  await submit(page);const before=await facts(page);
  expect(before.events.filter(e=>e.type==='AssessmentSubmitted')).toHaveLength(1);
  expect(before.events.filter(e=>e.data.scope==='hme').every(e=>e.versions.applicationEvidence==='hme-application-evidence-06l3.reference-1')).toBe(true);
  await page.reload();await expect(page.getByRole('heading',{name:'حُفظ تقييمك الذاتي'})).toBeVisible();
  expect((await facts(page)).events).toEqual(before.events);await home(page);
  await openProgress(page);await expect(page.getByRole('heading',{name:'التعاهد القادم'})).toBeVisible();await page.getByRole('button',{name:'اليوم',exact:true}).click();
  const after=await facts(page);await page.reload();await expect(page.getByText(/أنجزت اليوم: 1/)).toBeVisible();expect((await facts(page)).events).toEqual(after.events);
  await info.attach('newcomer-offline.json',{body:JSON.stringify({engineering:true,quranSession:false,offlineDuringSession:true,offlineReload:true,assessmentEvents:1,resultActions:1,encryptedRows:after.encryptedRows,eventsPreserved:true,isolatedDatabase:after.name}),contentType:'application/json'});
 }finally{await context.close();}
});
test('L3OFFJ02 prior self-review correction and encrypted UI backup restore work offline with exact event preservation',async({browser},info)=>{
 const context=await isolated(browser);try{
  const page=await context.newPage();await setup(page,true);await context.setOffline(true);await submit(page);
  await sessionOptions(page);await page.getByRole('button',{name:'صحّح النتيجة',exact:true}).click();await page.getByRole('button',{name:'سمّعت المقطع كاملًا بلا خطأ معلوم — بسهولة',exact:true}).click();
  await expect(page.getByRole('heading',{name:'حُفظ تقييمك الذاتي'})).toBeVisible();await home(page);
  const baseline=await facts(page);expect(baseline.events.filter(e=>e.type==='AssessmentSubmitted')).toHaveLength(1);expect(baseline.events.filter(e=>e.type==='AssessmentCorrected')).toHaveLength(1);
  await page.goto('http://127.0.0.1:4178/engineering.html#S18');await page.getByLabel('كلمة مرور النسخة',{exact:false}).fill('synthetic-ui-offline-06l3');
  const pendingDownload=page.waitForEvent('download');await page.getByRole('button',{name:'صدّر النسخة المشفرة'}).click();const download=await pendingDownload,stream=await download.createReadStream();if(!stream)throw Error('BACKUP_DOWNLOAD_MISSING');
  const chunks:Buffer[]=[];for await(const chunk of stream)chunks.push(Buffer.from(chunk));const bytes=Buffer.concat(chunks),file=JSON.parse(bytes.toString('utf8'));
  expect(file.format).toBe('MULAZAMA-ENCRYPTED-BACKUP');expect(file.cipher).toBe('AES-256-GCM');expect(file).not.toHaveProperty('snapshot');expect(file).not.toHaveProperty('events');
  // Add an actual later UI preference event, so restore is a real replacement rather than a no-op.
  await page.goto('http://127.0.0.1:4178/engineering.html#S17');await page.getByRole('checkbox',{name:'تكبير النص'}).click();await expect(page.getByRole('checkbox',{name:'تكبير النص'})).toBeChecked();
  const changed=await facts(page);expect(changed.events.length).toBeGreaterThan(baseline.events.length);
  await page.goto('http://127.0.0.1:4178/engineering.html#S18');await page.getByLabel('كلمة مرور النسخة',{exact:false}).fill('synthetic-ui-wrong-password');
  await page.getByLabel('اختر النسخة المشفرة',{exact:true}).setInputFiles({name:'qa-encrypted-backup.json',mimeType:'application/json',buffer:bytes});
  await expect(page.getByText(/تعذر فتح النسخة: كلمة الاستعادة غير صحيحة/)).toBeVisible();expect((await facts(page)).events).toEqual(changed.events);
  await page.getByLabel('كلمة مرور النسخة',{exact:false}).fill('synthetic-ui-offline-06l3');await page.getByLabel('اختر النسخة المشفرة',{exact:true}).setInputFiles({name:'qa-encrypted-backup.json',mimeType:'application/json',buffer:bytes});
  await expect(page.getByRole('heading',{name:'مراجعة الملف قبل الاستبدال'})).toBeVisible();await page.getByRole('button',{name:'تأكيد الاستبدال الكامل'}).click();
  await expect(page.getByText(/أنجزت اليوم: 1/)).toBeVisible();expect((await facts(page)).events).toEqual(baseline.events);
  await page.reload();await expect(page.getByText(/أنجزت اليوم: 1/)).toBeVisible();expect((await facts(page)).events).toEqual(baseline.events);
  await page.goto('http://127.0.0.1:4178/engineering.html#S17');await expect(page.getByRole('checkbox',{name:'تكبير النص'})).not.toBeChecked();
  await info.attach('prior-offline-backup.json',{body:JSON.stringify({engineering:true,quranSession:false,offlineDuringSession:true,corrections:1,encryptedDownload:true,wrongPasswordPreserved:true,restoreAfterRealMutation:true,eventsPreserved:true,offlineReload:true,sourceEventIds:baseline.events.map(e=>e.eventId),isolatedDatabase:baseline.name}),contentType:'application/json'});
 }finally{await context.close();}
});
