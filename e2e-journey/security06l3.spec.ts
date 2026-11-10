import {test,expect,type Page} from '@playwright/test';

const text='مادة تدريب صناعية للاختبار فقط وليست نصًا قرآنيًا.';
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-07T09:00:00.000Z'));
});
async function setup(page:Page){
 await page.goto('/engineering.html');await page.getByRole('button',{name:'ابدأ إعداد تجربتك'}).click();
 await page.getByRole('button',{name:'التالي: المحفوظات والهدف'}).click();await page.getByRole('button',{name:'التالي: الوقت المناسب'}).click();
 await page.getByRole('checkbox',{name:'السبت',exact:true}).check();await page.getByRole('button',{name:'احفظ واذهب إلى الرئيسية'}).click();
 await expect(page.getByRole('button',{name:'ابدأ وردي',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'ابدأ وردي',exact:true}).click();await expect(page.getByLabel('مادة الاختبار الصناعي',{exact:true})).toContainText(text);
}
async function snapshot(page:Page){return page.evaluate(async()=>{
 const name=sessionStorage.getItem('mulazama-engineering-db-06l3')!;
 if(!/^mulazama-engineering-06l3-[a-f0-9-]{36}$/.test(name))throw Error('NOT_ISOLATED_QA_DB');
 const {IndexedDbEventStore}=await import('/src/persistence/event-store.ts');const store=await IndexedDbEventStore.open(name);
 try{return await store.load();}finally{store.close();}
});}

test('L3SECJ01 URL and stored database-name injection cannot select a real production store in the engineering entry',async({page},info)=>{
 // Playwright creates a fresh, non-persistent browser context for every test.
 await page.addInitScript(()=>{
  const scope=window as unknown as {qaOpenedDatabases:string[]};scope.qaOpenedDatabases=[];
  const open=indexedDB.open.bind(indexedDB);indexedDB.open=((name:string,version?:number)=>{scope.qaOpenedDatabases.push(name);return open(name,version);}) as typeof indexedDB.open;
  if(!sessionStorage.getItem('test-injected-once')){sessionStorage.setItem('mulazama-engineering-db-06l3','mulazama-learning-v1');sessionStorage.setItem('test-injected-once','true');}
 });
 await page.goto('/engineering.html?databaseName=mulazama-learning-v1&production=true&approved=true');
 await expect(page.locator('.prototype-strip')).toContainText('ليس نصًا قرآنيًا');
 const before=await page.evaluate(()=>({name:sessionStorage.getItem('mulazama-engineering-db-06l3'),opened:(window as unknown as {qaOpenedDatabases:string[]}).qaOpenedDatabases}));
 expect(before.name).toMatch(/^mulazama-engineering-06l3-[a-f0-9-]{36}$/);expect(before.opened.length).toBeGreaterThan(0);expect(before.opened.every(name=>name===before.name)).toBe(true);
 await page.reload();await expect(page.locator('.prototype-strip')).toContainText('ليس نصًا قرآنيًا');expect(await page.evaluate(()=>sessionStorage.getItem('mulazama-engineering-db-06l3'))).toBe(before.name);
 const databases=await page.evaluate(()=>indexedDB.databases());expect(databases.some(db=>db.name==='mulazama-learning-v1')).toBe(false);
 await info.attach('engineering-isolation.json',{body:JSON.stringify({engineering:true,productionDatabaseOpened:false,querySwitchIgnored:true,sessionStorageTargetRejected:true,stableReloadIdentity:true}),contentType:'application/json'});
});

test('L3SECJ02 recall text is absent from DOM until an acknowledged reveal, and self-report cannot wash out recorded help',async({page},info)=>{
 await setup(page);await page.getByRole('button',{name:'جاهز للتسميع',exact:true}).click();
 await expect(page.getByLabel('مادة الاختبار الصناعي',{exact:true})).toHaveCount(0);expect(await page.locator('main').textContent()).not.toContain(text);
 const hidden=await snapshot(page);expect(hidden.events.filter(e=>e.type==='HintUsed')).toHaveLength(0);
 await page.getByRole('button',{name:'أظهر النص وسجّل المساعدة',exact:true}).click();await expect(page.getByLabel('مادة الاختبار الصناعي',{exact:true})).toContainText(text);
 const revealed=await snapshot(page);expect(revealed.events.filter(e=>e.type==='HintUsed')).toHaveLength(1);
 await page.getByRole('button',{name:'كامل بلا خطأ معلوم — بسهولة',exact:true}).click();await expect(page.getByRole('heading',{name:'حُفظ تقييمك الذاتي'})).toBeVisible();
 const result=await page.evaluate(async()=>{
  const {IndexedDbEventStore}=await import('/src/persistence/event-store.ts');const {replayHistory}=await import('/src/application/history-application.ts');
  const name=sessionStorage.getItem('mulazama-engineering-db-06l3')!;if(!name.startsWith('mulazama-engineering-06l3-'))throw Error('NOT_QA_DB');
  const store=await IndexedDbEventStore.open(name);try{const h=replayHistory(await store.load()).learning!;const assessment=Object.values(h.assessments)[0];const attempt=Object.values(h.attempts)[0];return {assessment,help:attempt.hints,revealed:attempt.revealed};}finally{store.close();}
 });
 expect(result.help).toBeGreaterThan(0);expect(result.revealed).toBe(true);expect(result.assessment.effectiveRating).toBe(1);expect(result.assessment.strictPass).toBe(false);expect(result.assessment.independentVerification).toBe(false);
 await info.attach('recall-help-evidence.json',{body:JSON.stringify({engineering:true,realQuran:false,textAbsentFromRecallDOM:true,helpPersisted:true,...result}),contentType:'application/json'});
});

test('L3SECJ03 pausing an unfinished recall exposes restart immediately and retains the interrupted attempt without a score',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'جاهز للتسميع',exact:true}).click();
 await page.getByRole('button',{name:'أوقف مؤقتًا',exact:true}).click();await expect(page.getByRole('button',{name:'ابدأ محاولة جديدة بعد الانقطاع',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'كامل بلا خطأ معلوم — بجهد عادي',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'ابدأ محاولة جديدة بعد الانقطاع',exact:true}).click();await expect(page.getByRole('button',{name:'كامل بلا خطأ معلوم — بجهد عادي',exact:true})).toBeVisible();
 const raw=await snapshot(page);expect(raw.events.filter(e=>e.type==='RecallAttemptStarted')).toHaveLength(1);expect(raw.events.filter(e=>e.type==='RecallAttemptRestarted')).toHaveLength(1);expect(raw.events.filter(e=>e.type==='AssessmentSubmitted')).toHaveLength(0);
 await page.getByRole('button',{name:'أنهِ الجلسة',exact:true}).click();await expect(page.getByLabel('أنشطة أُنجزت اليوم',{exact:true})).toHaveText('0');
});

test('L3SECJ04 a rejected result write shows an error without success, then retry commits one assessment',async({page},info)=>{
 await setup(page);await page.getByRole('button',{name:'جاهز للتسميع',exact:true}).click();
 // Fault injection is confined to this newly created test profile and restored in finally.
 await page.evaluate(async()=>{
  const {IndexedDbEventStore}=await import('/src/persistence/event-store.ts');const original=IndexedDbEventStore.prototype.append;let rejected=false;
  IndexedDbEventStore.prototype.append=async function(events,revision){if(!rejected&&events.some(e=>e.type==='AssessmentSubmitted')){rejected=true;throw Error('QA_WRITE_UNCONFIRMED');}return original.call(this,events,revision);};
  (window as unknown as {qaRestoreAppend:()=>void}).qaRestoreAppend=()=>{IndexedDbEventStore.prototype.append=original;};
 });
 try{
  await page.getByRole('button',{name:'كامل بلا خطأ معلوم — بجهد عادي',exact:true}).click();await expect(page.getByRole('alert')).toContainText('QA_WRITE_UNCONFIRMED');
  await expect(page.getByRole('heading',{name:'حُفظ تقييمك الذاتي'})).toHaveCount(0);expect((await snapshot(page)).events.filter(e=>e.type==='AssessmentSubmitted')).toHaveLength(0);
  await page.getByRole('button',{name:'كامل بلا خطأ معلوم — بجهد عادي',exact:true}).click();await expect(page.getByRole('heading',{name:'حُفظ تقييمك الذاتي'})).toBeVisible();
  const raw=await snapshot(page);expect(raw.events.filter(e=>e.type==='AssessmentSubmitted')).toHaveLength(1);
  await page.reload();await expect(page.getByRole('heading',{name:'حُفظ تقييمك الذاتي'})).toBeVisible();expect((await snapshot(page)).events).toEqual(raw.events);
  await info.attach('result-retry.json',{body:JSON.stringify({engineering:true,rejectedResultDidNotShowSuccess:true,assessmentEvents:1,stableReload:true}),contentType:'application/json'});
 }finally{await page.evaluate(()=>{const scope=window as unknown as {qaRestoreAppend?:()=>void};scope.qaRestoreAppend?.();delete scope.qaRestoreAppend;});}
});
