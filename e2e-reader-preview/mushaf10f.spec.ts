import {readerTools,sessionOptions,enterRecall,openProgress} from './ux-helpers';
import {test,expect,type Page} from '@playwright/test';

const preview='/reader-preview.html?demo=1#S16';
const databaseKey='mulazama-reader-preview-db-10f';
const number=(value:number)=>value.toLocaleString('ar-SA');
const title=(surah:number,ayah:number)=>`قسم تجريبي ${number(surah)} — سطر ${number(ayah)}`;
const unitId=(surah:number,ayah:number)=>`test-reader-10f-s${surah}-a${ayah}`;
const reader=(page:Page)=>page.getByRole('region',{name:'قارئ المصحف',exact:true});

async function visiblePage(page:Page,index:number){
  const image=reader(page).getByRole('img',{name:`صفحة اختبار صناعية ${number(index)}`,exact:true});
  await expect(image).toBeVisible();
  await expect.poll(()=>image.evaluate(image=>(image as HTMLImageElement).complete&&(image as HTMLImageElement).naturalWidth>0)).toBe(true);
}

async function facts(page:Page){return page.evaluate(async key=>{
  const name=localStorage.getItem(key);
  if(!name||!/^mulazama-reader-preview-10f-[a-f0-9-]{36}$/.test(name))throw Error('NOT_ISOLATED_READER_PREVIEW_DATABASE');
  const {IndexedDbEventStore}=await import('/src/persistence/event-store.ts');
  const store=await IndexedDbEventStore.open(name);
  try{return await store.load();}finally{store.close();}
},databaseKey);}

async function boot(page:Page){
  await page.goto(preview);
  await visiblePage(page,1);
  await expect(reader(page)).toContainText('غير قرآنية');
  await expect.poll(async()=>(await facts(page)).events.some(event=>event.type==='PlanRecomputed')).toBe(true);
}

async function openReader(page:Page){
  await page.getByRole('button',{name:'المصحف',exact:true}).click();
  await expect(reader(page)).toBeVisible();
}

async function select(page:Page,surah:number,from:number,to=from){
  await reader(page).getByRole('combobox',{name:'السورة',exact:true}).selectOption(String(surah));
  await visiblePage(page,(surah-1)*2+1);
  await readerTools(page);await reader(page).getByLabel('من آية',{exact:true}).fill(String(from));
  await reader(page).getByLabel('إلى آية',{exact:true}).fill(String(to));
  await reader(page).getByRole('button',{name:'أضف إلى خطتي',exact:true}).click();
  await expect(reader(page).getByText('أُضيف المقدار إلى خطتك. الاختيار وحده لا يُسجّل إنجازًا.',{exact:true})).toBeVisible();
}

async function settledAssessment(page:Page){
  await expect(page.getByRole('heading',{name:'حُفظ تقييمك الذاتي',exact:true})).toBeVisible();
  await expect.poll(async()=>{
    const snapshot=await facts(page);
    const assessment=snapshot.events.findLastIndex(event=>event.type==='AssessmentSubmitted');
    const plan=snapshot.events.findLastIndex(event=>event.type==='PlanRecomputed'&&event.data.scope==='hme');
    return {assessmentBeforePlan:assessment>=0&&plan>assessment,command:snapshot.events[plan]?.data.command};
  }).toMatchObject({assessmentBeforePlan:true,command:{spentMinutes:2}});
  return facts(page);
}

test.beforeEach(async({page})=>{
  await page.clock.setFixedTime(new Date('2026-11-09T09:00:00.000Z'));
});

test('M10F01 phone reader has six synthetic pages, section navigation, gestures and a persistent last position',async({page},info)=>{
  await boot(page);
  await expect(reader(page)).toHaveAttribute('dir','rtl');
  await expect(reader(page).getByRole('combobox',{name:'السورة',exact:true}).locator('option')).toHaveCount(3);
  await expect(reader(page).getByRole('button',{name:'الصفحة السابقة',exact:true})).toBeDisabled();
  const before=await facts(page);
  await reader(page).getByRole('combobox',{name:'السورة',exact:true}).selectOption('2');
  await visiblePage(page,3);
  await reader(page).getByRole('button',{name:'الصفحة التالية',exact:true}).click();
  await visiblePage(page,4);
  const stage=reader(page).getByRole('group',{name:'صفحات المصحف',exact:true});
  await stage.dispatchEvent('touchstart',{touches:[{identifier:1,clientX:30,clientY:80}]});
  await stage.dispatchEvent('touchend',{changedTouches:[{identifier:1,clientX:140,clientY:86}]});
  await visiblePage(page,5);
  await readerTools(page);await reader(page).getByLabel('رقم الصفحة',{exact:true}).fill('6');
  await reader(page).getByRole('button',{name:'انتقل',exact:true}).click();
  await visiblePage(page,6);
  await expect(reader(page).getByRole('button',{name:'الصفحة التالية',exact:true})).toBeDisabled();
  await expect.poll(()=>page.evaluate(()=>Object.keys(localStorage).some(key=>key.startsWith('mulazama-reader-location-v1:')&&JSON.parse(localStorage.getItem(key)!).page===6))).toBe(true);
  await page.reload();await visiblePage(page,6);
  expect((await facts(page)).events).toEqual(before.events);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await info.attach('reader-phone.png',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
});

test('M10F02 desktop keyboard and row selection create an explicit inclusive draft without learning evidence',async({page},info)=>{
  await page.setViewportSize({width:1440,height:1000});await boot(page);
  const before=await facts(page);
  await readerTools(page);const first=reader(page).getByRole('button',{name:'اختيار السطر التجريبي ١ من قسم تجريبي ١',exact:true});
  await first.focus();await page.keyboard.press('Enter');
  await expect(first).toHaveAttribute('aria-pressed','true');
  await reader(page).getByRole('button',{name:'الصفحة التالية',exact:true}).click();await visiblePage(page,2);
  const third=reader(page).getByRole('button',{name:'اختيار السطر التجريبي ٣ من قسم تجريبي ١',exact:true});
  await third.click();
  await expect(reader(page).getByLabel('من آية',{exact:true})).toHaveValue('1');
  await expect(reader(page).getByLabel('إلى آية',{exact:true})).toHaveValue('3');
  expect((await facts(page)).events).toEqual(before.events);
  await reader(page).getByRole('button',{name:'أضف إلى خطتي',exact:true}).click();
  await expect(reader(page).getByText(/المقدار المحدد:.*من آية ١ إلى ٣/)).toBeVisible();
  const after=await facts(page);
  expect(after.events.filter(event=>event.type==='AssessmentSubmitted'||event.type==='SessionStarted')).toHaveLength(0);
  expect(after.events.filter(event=>event.data.scope==='product')).toEqual(before.events.filter(event=>event.data.scope==='product'));
  const stage=reader(page).getByRole('group',{name:'صفحات المصحف',exact:true});
  await stage.focus();await page.keyboard.press('ArrowLeft');await visiblePage(page,1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await info.attach('reader-desktop-selection.png',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
});

test('M10F03 saved selection starts the exact current journey unit and today opens its page',async({page})=>{
  await boot(page);const before=await facts(page);await select(page,2,3,4);
  await page.reload();await visiblePage(page,3);
  await expect(reader(page).getByText(/المقدار المحدد:.*من آية ٣ إلى ٤/)).toBeVisible();
  await reader(page).getByRole('button',{name:'خطة اليوم',exact:true}).click();
  await expect(page.getByRole('heading',{name:title(2,3),exact:true})).toBeVisible();
  await page.getByRole('button',{name:'ابدأ الحفظ',exact:true}).click();await visiblePage(page,4);
  await expect(page.getByRole('heading',{name:title(2,3),exact:true})).toBeVisible();
  const after=await facts(page);
  expect(after.events.filter(event=>event.type==='SessionStarted')).toHaveLength(1);
  expect(after.events.find(event=>event.type==='SessionStarted')?.data.command).toMatchObject({unitId:unitId(2,3)});
  expect(after.events.filter(event=>event.type==='AssessmentSubmitted')).toHaveLength(0);
  for(const original of before.events)expect(after.events.find(event=>event.eventId===original.eventId)).toEqual(original);
});

test('M10F04 one assessed session remains durable and its due review opens the original page ahead of new selection',async({page})=>{
  await boot(page);await select(page,3,3);
  await readerTools(page);await reader(page).getByRole('button',{name:'ابدأ نشاط خطة اليوم',exact:true}).click();
  await enterRecall(page);
  await page.getByRole('button',{name:'سمّعت المقطع كاملًا بلا خطأ معلوم — جهد عادي',exact:true}).click();
  const assessed=await settledAssessment(page);
  expect(assessed.events.filter(event=>event.type==='AssessmentSubmitted')).toHaveLength(1);
  await page.reload();await expect(page.getByRole('heading',{name:'حُفظ تقييمك الذاتي',exact:true})).toBeVisible();
  expect((await facts(page)).events).toEqual(assessed.events);
  await page.getByRole('button',{name:'العودة إلى اليوم',exact:true}).click();
  await expect(page.getByRole('heading',{name:'وردك اليوم',exact:true})).toBeVisible();
  await page.clock.setFixedTime(new Date('2026-12-09T09:00:00.000Z'));
  await page.reload();await expect(page.getByText('مراجعة مستحقة',{exact:true})).toBeVisible();
  await openReader(page);await select(page,1,1);
  await reader(page).getByRole('button',{name:'خطة اليوم',exact:true}).click();
  await expect(page.getByRole('heading',{name:title(3,3),exact:true})).toBeVisible();
  await expect(page.getByText('مراجعة مستحقة',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'ابدأ المراجعة',exact:true}).click();
  await page.getByRole('button',{name:'أظهر النص وسجّل المساعدة',exact:true}).click();
  await sessionOptions(page);await page.getByRole('button',{name:'افتح موضع الجلسة في المصحف',exact:true}).click();await visiblePage(page,6);
  const final=await facts(page);
  expect(final.events.filter(event=>event.type==='AssessmentSubmitted')).toHaveLength(1);
  for(const original of assessed.events)expect(final.events.find(event=>event.eventId===original.eventId)).toEqual(original);
});

test('M10F05 reader cannot leak recall answers and one acknowledged reveal records one assistance event',async({page})=>{
  await boot(page);await select(page,2,2);
  await readerTools(page);await reader(page).getByRole('button',{name:'ابدأ نشاط خطة اليوم',exact:true}).click();
  await enterRecall(page);
  await openReader(page);
  await expect(reader(page).getByRole('img')).toHaveCount(0);
  await expect(reader(page).getByRole('combobox')).toHaveCount(0);
  await expect(reader(page).getByRole('group',{name:'اختيار مقدار من الصفحة',exact:true})).toHaveCount(0);
  expect((await facts(page)).events.filter(event=>event.type==='HintUsed')).toHaveLength(0);
  await reader(page).getByRole('button',{name:'أظهر المصحف وسجّل المساعدة',exact:true}).click();await visiblePage(page,3);
  await reader(page).getByRole('button',{name:'خطة اليوم',exact:true}).click();await openReader(page);await visiblePage(page,3);
  const hints=(await facts(page)).events.filter(event=>event.type==='HintUsed');
  expect(hints).toHaveLength(1);expect(hints[0].data.command).toMatchObject({reveal:true});
});

test('M10F06 private preview preserves unrelated production storage, loads no original assets and resumes across tabs',async({page,context})=>{
  await page.goto('/');
  await page.evaluate(async()=>{
    localStorage.setItem('mulazama-reader-existing-user-sentinel','unchanged-existing-preference');
    await new Promise<void>((resolve,reject)=>{
      const request=indexedDB.open('mulazama-learning-v1',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('preservation-check');
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{
        const db=request.result,transaction=db.transaction('preservation-check','readwrite');
        transaction.objectStore('preservation-check').put({original:'existing-history-sentinel'},'keep');
        transaction.oncomplete=()=>{db.close();resolve();};transaction.onerror=()=>reject(transaction.error);
      };
    });
  });
  const requests:string[]=[];page.on('request',request=>requests.push(request.url()));
  await boot(page);await select(page,2,4);
  await reader(page).getByRole('button',{name:'الصفحة التالية',exact:true}).click();await visiblePage(page,4);
  await expect.poll(()=>page.evaluate(()=>Object.keys(localStorage).some(key=>key.startsWith('mulazama-reader-location-v1:')&&JSON.parse(localStorage.getItem(key)!).page===4))).toBe(true);
  const name=await page.evaluate(key=>localStorage.getItem(key),databaseKey);
  const second=await context.newPage();await second.clock.setFixedTime(new Date('2026-11-09T09:00:00.000Z'));
  await second.goto(preview);await visiblePage(second,4);
  expect(await second.evaluate(key=>localStorage.getItem(key),databaseKey)).toBe(name);
  await expect(reader(second).getByText(/المقدار المحدد:.*من آية ٤ إلى ٤/)).toBeVisible();
  const preserved=await second.evaluate(async()=>{
    const local=localStorage.getItem('mulazama-reader-existing-user-sentinel');
    const stored=await new Promise<{version:number;stores:string[];value:unknown}>((resolve,reject)=>{
      const request=indexedDB.open('mulazama-learning-v1');request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{
        const db=request.result,version=db.version,stores=[...db.objectStoreNames];
        const read=db.transaction('preservation-check').objectStore('preservation-check').get('keep');
        read.onsuccess=()=>{db.close();resolve({version,stores,value:read.result});};read.onerror=()=>reject(read.error);
      };
    });
    return {local,...stored};
  });
  expect(preserved).toEqual({local:'unchanged-existing-preference',version:1,stores:['preservation-check'],value:{original:'existing-history-sentinel'}});
  expect(requests.filter(url=>/quranpedia|qurancomplex|hafs\.zip|mushafs-1\.json|api-quran-svg/i.test(url))).toEqual([]);
  expect((await facts(second)).events.every(event=>event.unitId===null||event.unitId.startsWith('test-'))).toBe(true);
  await second.close();
});

test('M10F07 ordinary app entry still fails closed without granting synthetic or Quran content access',async({page})=>{
  await page.goto('/#S16');
  await expect(reader(page).getByRole('heading',{name:'النص المعتمد ينتظر الإضافة',exact:true})).toBeVisible();
  await expect(reader(page).getByRole('img')).toHaveCount(0);
  await expect(reader(page).getByRole('combobox')).toHaveCount(0);
  expect(await page.evaluate(key=>localStorage.getItem(key),databaseKey)).toBeNull();
});

test('M10F08 a forged preview database preference is blocked without opening or replacing production history',async({page})=>{
  await page.goto('/');
  await page.evaluate(async key=>{
    localStorage.setItem(key,'mulazama-learning-v1');
    localStorage.setItem('mulazama-preview-preservation-sentinel','keep');
    await new Promise<void>((resolve,reject)=>{
      const request=indexedDB.open('mulazama-learning-v1',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('preservation-check');
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{
        const db=request.result,transaction=db.transaction('preservation-check','readwrite');
        transaction.objectStore('preservation-check').put('original-history','keep');
        transaction.oncomplete=()=>{db.close();resolve();};transaction.onerror=()=>reject(transaction.error);
      };
    });
  },databaseKey);
  await page.goto(preview);
  await expect(page.getByRole('heading',{name:'تعذر فتح تجربة القارئ',exact:true})).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('تعذر التحقق من هوية سجل التجربة');
  await expect(page.getByRole('img')).toHaveCount(0);
  const preserved=await page.evaluate(async key=>{
    const databases=await indexedDB.databases();
    const value=await new Promise<unknown>((resolve,reject)=>{
      const request=indexedDB.open('mulazama-learning-v1');request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{
        const db=request.result;
        const read=db.transaction('preservation-check').objectStore('preservation-check').get('keep');
        read.onsuccess=()=>{db.close();resolve(read.result);};read.onerror=()=>reject(read.error);
      };
    });
    return {key:localStorage.getItem(key),sentinel:localStorage.getItem('mulazama-preview-preservation-sentinel'),value,
      productionVersion:databases.find(database=>database.name==='mulazama-learning-v1')?.version,
      createdPreviewDatabase:databases.some(database=>database.name?.startsWith('mulazama-reader-preview-10f-'))};
  },databaseKey);
  expect(preserved).toEqual({key:'mulazama-learning-v1',sentinel:'keep',value:'original-history',productionVersion:1,createdPreviewDatabase:false});
});

test('M10F09 candidate source is explicitly unapproved, rejects substituted page bytes and keeps the synthetic journey available',async({page})=>{
  const requested:string[]=[];
  await page.route('https://raw.githubusercontent.com/quran-ws/quran-svg/**',async route=>{
    requested.push(route.request().url());
    // Deliberately substituted, non-Quran data. No authentic source artwork is committed to this test.
    await route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>'});
  });
  await page.goto('/reader-preview.html#S16');
  await expect(page.getByRole('region',{name:'حالة النسخة'})).toContainText('تجربة الحفظ ببيانات صناعية غير قرآنية، وصفحات حفص مرشحة للمراجعة');
  await expect(reader(page).getByRole('heading',{name:'مراجعة صفحات حفص',exact:true})).toBeVisible();
  await expect(reader(page)).toContainText('معاينة مصدر مرشح — لم يُعتمد المصحف بعد.');
  await expect(reader(page).getByRole('alert')).toContainText('تعذر');
  expect(requested.length).toBeGreaterThan(0);
  expect(requested.every(url=>/^https:\/\/raw\.githubusercontent\.com\/quran-ws\/quran-svg\/[a-f0-9]{40}\/mushafs\/hafs\/kfqc\/svg\/\d{3}\.svg$/.test(url))).toBe(true);
  await expect(reader(page).getByRole('img')).toHaveCount(0);
  await readerTools(page);await expect(reader(page).getByRole('button',{name:'احفظ مقدار المراجعة',exact:true})).toBeDisabled();
  await expect(reader(page).getByRole('button',{name:'ابدأ نشاط خطة اليوم',exact:true})).toHaveCount(0);
  const before=await facts(page);
  expect(before.events.filter(event=>event.type==='AssessmentSubmitted'||event.type==='SessionStarted')).toHaveLength(0);
  expect(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('mulazama-candidate-review-intent-10f:')))).toEqual([]);
  await readerTools(page);await page.getByRole('button',{name:'اختبر الحفظ والمراجعة ببيانات صناعية',exact:true}).click();
  await visiblePage(page,1);
  await select(page,2,3);
  await readerTools(page);await reader(page).getByRole('button',{name:'ابدأ نشاط خطة اليوم',exact:true}).click();
  await expect(page.getByRole('heading',{name:title(2,3),exact:true})).toBeVisible();
  const after=await facts(page);
  expect(after.events.filter(event=>event.type==='SessionStarted')).toHaveLength(1);
  expect(after.events.find(event=>event.type==='SessionStarted')?.data.command).toMatchObject({unitId:unitId(2,3)});
  expect(after.events.every(event=>event.unitId===null||event.unitId.startsWith('test-'))).toBe(true);
  for(const original of before.events)expect(after.events.find(event=>event.eventId===original.eventId)).toEqual(original);
});
