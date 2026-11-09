import {readerTools,sessionOptions,enterRecall,openProgress} from '../e2e-reader-preview/ux-helpers';
import {test,expect,type Page} from '@playwright/test';

const imageName=(number:number)=>`صفحة اختبار صناعية ${number.toLocaleString('ar-SA')}`;
async function visiblePage(page:Page,number:number){
  const image=page.getByRole('img',{name:imageName(number),exact:true});
  await expect(image).toBeVisible();
  await expect.poll(()=>image.evaluate(img=>(img as HTMLImageElement).complete&&(img as HTMLImageElement).naturalWidth>0)).toBe(true);
}
async function facts(page:Page){return page.evaluate(async()=>{
  const databaseName=sessionStorage.getItem('mulazama-engineering-db-06l3');
  if(!databaseName||!/^mulazama-engineering-06l3-[a-f0-9-]{36}$/.test(databaseName))throw Error('NOT_ISOLATED_QA_DB');
  const {IndexedDbEventStore}=await import('/src/persistence/event-store.ts');
  const store=await IndexedDbEventStore.open(databaseName);try{return await store.load();}finally{store.close();}
});}
async function setup(page:Page){
  await page.goto('/engineering.html');
  await page.getByRole('button',{name:'أعد خطتي',exact:true}).click();
  await page.getByRole('button',{name:'التالي: المحفوظات والهدف',exact:true}).click();
  await page.getByRole('button',{name:'التالي: الوقت المناسب',exact:true}).click();
  await page.getByRole('checkbox',{name:'السبت',exact:true}).check();
  await page.getByRole('button',{name:'احفظ واذهب إلى الرئيسية',exact:true}).click();
  await expect(page.getByRole('button',{name:/^ابدأ (الحفظ|المراجعة)$/,exact:true})).toBeVisible();
  await expect.poll(async()=>(await facts(page)).events.some(event=>event.type==='PlanRecomputed')).toBe(true);
}
async function openReader(page:Page){
  await page.getByRole('button',{name:'المصحف',exact:true}).click();
  await expect(page.getByRole('region',{name:'قارئ المصحف',exact:true})).toBeVisible();
}
async function selectSecondAyah(page:Page){
  await openReader(page);await visiblePage(page,1);
  await readerTools(page);await page.getByLabel('من آية',{exact:true}).fill('2');
  await page.getByLabel('إلى آية',{exact:true}).fill('2');
  await page.getByRole('button',{name:'أضف إلى خطتي',exact:true}).click();
  await expect(page.getByText('أُضيف المقدار إلى خطتك. الاختيار وحده لا يُسجّل إنجازًا.',{exact:true})).toBeVisible();
}
async function beginSecondRecall(page:Page){
  await setup(page);await selectSecondAyah(page);
  await readerTools(page);await page.getByRole('button',{name:'ابدأ نشاط خطة اليوم',exact:true}).click();
  await expect(page.getByRole('heading',{name:'وحدة تدريب صناعية 2',exact:true})).toBeVisible();
  await enterRecall(page);
  await expect(page.getByLabel('مادة الاختبار الصناعي',{exact:true})).toHaveCount(0);
}

test.beforeEach(async({page})=>{await page.clock.setFixedTime(new Date('2026-11-07T09:00:00.000Z'));});

test('M10B01 ordinary entry fails closed without Quran images, navigation or session activation',async({page})=>{
  await page.goto('/#S16');
  const reader=page.getByRole('region',{name:'قارئ المصحف',exact:true});
  await expect(reader.getByRole('heading',{name:'النص المعتمد ينتظر الإضافة',exact:true})).toBeVisible();
  await expect(reader.getByRole('img')).toHaveCount(0);await expect(reader.getByRole('combobox')).toHaveCount(0);
  await expect(reader.getByRole('button',{name:'ابدأ نشاط خطة اليوم',exact:true})).toHaveCount(0);
  await expect(reader).not.toContainText('صفحات اختبار صناعية');
  expect(await page.evaluate(()=>sessionStorage.getItem('mulazama-engineering-db-06l3'))).toBeNull();
});

test('M10B02 phone RTL navigation, parts, numeric jump, swipe and bookmark use only verified fixture pages',async({page},info)=>{
  const start=performance.now();await page.goto('/engineering.html#S16');await visiblePage(page,1);
  const firstVisibleMs=performance.now()-start;
  await expect(page.getByRole('region',{name:'قارئ المصحف',exact:true})).toHaveAttribute('dir','rtl');
  await expect(page.getByRole('button',{name:'الصفحة السابقة',exact:true})).toBeDisabled();
  const turnStart=performance.now();await page.getByRole('button',{name:'الصفحة التالية',exact:true}).click();await visiblePage(page,2);
  const pageTurnMs=performance.now()-turnStart;
  await readerTools(page);await page.getByRole('combobox',{name:'الجزء',exact:true}).selectOption('2');await visiblePage(page,3);
  await expect(page.getByRole('button',{name:'الصفحة التالية',exact:true})).toBeDisabled();
  await page.getByRole('combobox',{name:'السورة',exact:true}).selectOption('1');await visiblePage(page,1);
  const stage=page.getByRole('group',{name:'صفحات المصحف',exact:true});
  await stage.dispatchEvent('touchstart',{touches:[{identifier:1,clientX:30,clientY:80}]});
  await stage.dispatchEvent('touchend',{changedTouches:[{identifier:1,clientX:150,clientY:90}]});await visiblePage(page,2);
  await stage.dispatchEvent('touchstart',{touches:[{identifier:2,clientX:150,clientY:80}]});
  await stage.dispatchEvent('touchend',{changedTouches:[{identifier:2,clientX:30,clientY:90}]});await visiblePage(page,1);
  await readerTools(page);await page.getByLabel('رقم الصفحة',{exact:true}).fill('3');await page.getByRole('button',{name:'انتقل',exact:true}).click();await visiblePage(page,3);
  await expect.poll(()=>page.evaluate(()=>Object.keys(localStorage).some(key=>key.startsWith('mulazama-reader-location-v1:')&&JSON.parse(localStorage.getItem(key)!).page===3))).toBe(true);
  const before=await facts(page);await page.reload();await visiblePage(page,3);expect((await facts(page)).events).toEqual(before.events);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await info.attach('phone-reader.png',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
  await info.attach('fixture-navigation-performance.json',{contentType:'application/json',body:JSON.stringify({fixtureOnly:true,officialQuranPerformanceVerified:false,pages:3,firstVisibleMs,pageTurnMs,bookmarkRestored:true,learningEventsUnchangedByReading:true})});
});

test('M10B03 selection is persistent intent, starts the exact catalogue unit and records one durable result',async({page},info)=>{
  await setup(page);const before=await facts(page);await selectSecondAyah(page);
  const selected=await facts(page);expect(selected.events.slice(0,before.events.length)).toEqual(before.events);
  expect(selected.events.filter(e=>e.data.scope==='product')).toEqual(before.events.filter(e=>e.data.scope==='product'));
  expect(selected.events.filter(e=>e.type==='AssessmentSubmitted')).toHaveLength(0);
  await page.reload();await visiblePage(page,1);await expect(page.getByText(/المقدار المحدد:.*من آية ٢ إلى ٢/)).toBeVisible();
  await readerTools(page);await page.getByRole('button',{name:'ابدأ نشاط خطة اليوم',exact:true}).click();
  await expect(page.getByRole('heading',{name:'وحدة تدريب صناعية 2',exact:true})).toBeVisible();
  const started=await facts(page);expect(started.events.filter(e=>e.type==='SessionStarted')).toHaveLength(1);
  expect(started.events.find(e=>e.type==='SessionStarted')?.data.command).toMatchObject({unitId:'test-journey-unit-2'});
  await enterRecall(page);
  await page.getByRole('button',{name:'سمّعت المقطع كاملًا بلا خطأ معلوم — جهد عادي',exact:true}).click();
  await expect(page.getByRole('heading',{name:'حُفظ تقييمك الذاتي',exact:true})).toBeVisible();
  await expect.poll(async()=>{
    const saved=await facts(page),assessment=saved.events.findLastIndex(e=>e.type==='AssessmentSubmitted'),plan=saved.events.findLastIndex(e=>e.type==='PlanRecomputed'&&e.data.scope==='hme');
    return {afterAssessment:assessment>=0&&plan>assessment,spentMinutes:(saved.events[plan]?.data.command as {spentMinutes?:number}|undefined)?.spentMinutes};
  }).toEqual({afterAssessment:true,spentMinutes:2});
  const saved=await facts(page);expect(saved.events.filter(e=>e.type==='AssessmentSubmitted')).toHaveLength(1);
  await page.reload();await expect(page.getByRole('heading',{name:'حُفظ تقييمك الذاتي',exact:true})).toBeVisible();expect((await facts(page)).events).toEqual(saved.events);
  await info.attach('reader-selected-journey.json',{contentType:'application/json',body:JSON.stringify({syntheticOnly:true,selectedUnit:'test-journey-unit-2',selectionWasNotAssessment:true,priorProductEventsPreserved:true,assessmentCount:1,reloadEventsEqual:true})});
});

test('M10B04 today starts the selected task at its mapped page and can return to the existing plan',async({page})=>{
  await setup(page);await selectSecondAyah(page);await page.getByRole('button',{name:'خطة اليوم',exact:true}).click();
  await expect(page.getByRole('heading',{name:'وحدة تدريب صناعية 2',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'ابدأ الحفظ',exact:true}).click();await visiblePage(page,2);
  await page.getByRole('button',{name:'اليوم',exact:true}).click();await expect(page.getByRole('button',{name:'استأنف جلستك',exact:true})).toBeVisible();
});

test('M10B05 recall hides all reader images until acknowledged help is recorded exactly once',async({page})=>{
  await beginSecondRecall(page);await openReader(page);
  const reader=page.getByRole('region',{name:'قارئ المصحف',exact:true});
  await expect(reader.getByRole('img')).toHaveCount(0);await expect(reader.getByRole('combobox')).toHaveCount(0);
  expect((await facts(page)).events.filter(e=>e.type==='HintUsed')).toHaveLength(0);
  await page.getByRole('button',{name:'أظهر المصحف وسجّل المساعدة',exact:true}).click();await visiblePage(page,2);
  const revealed=await facts(page);expect(revealed.events.filter(e=>e.type==='HintUsed')).toHaveLength(1);
  expect(revealed.events.find(e=>e.type==='HintUsed')?.data.command).toMatchObject({reveal:true});
  await page.getByRole('button',{name:'خطة اليوم',exact:true}).click();await openReader(page);await visiblePage(page,2);
  expect((await facts(page)).events.filter(e=>e.type==='HintUsed')).toHaveLength(1);
});

test('M10B06 interrupted recall cannot reveal the reader until the existing restart action',async({page})=>{
  await beginSecondRecall(page);await openReader(page);await page.reload();
  await expect(page.getByText('استأنف جلستك وابدأ محاولة جديدة قبل كشف المصحف.',{exact:true})).toBeVisible();
  await expect(page.getByRole('region',{name:'قارئ المصحف',exact:true}).getByRole('img')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'أظهر المصحف وسجّل المساعدة',exact:true})).toHaveCount(0);
  expect((await facts(page)).events.filter(e=>e.type==='HintUsed')).toHaveLength(0);
  await page.getByRole('button',{name:'العودة إلى الجلسة',exact:true}).click();
  await page.getByRole('button',{name:'ابدأ محاولة جديدة بعد الانقطاع',exact:true}).click();
  await openReader(page);await expect(page.getByRole('button',{name:'أظهر المصحف وسجّل المساعدة',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'أظهر المصحف وسجّل المساعدة',exact:true}).click();await visiblePage(page,2);
  expect((await facts(page)).events.filter(e=>e.type==='HintUsed')).toHaveLength(1);
});

test('M10B07 desktop RTL layout fits the viewport and keyboard page navigation works',async({page},info)=>{
  await page.setViewportSize({width:1440,height:1000});await page.goto('/engineering.html#S16');await visiblePage(page,1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  const stage=page.getByRole('group',{name:'صفحات المصحف',exact:true});await stage.focus();await page.keyboard.press('ArrowRight');await visiblePage(page,2);
  await page.keyboard.press('ArrowLeft');await visiblePage(page,1);
  await expect(page.getByRole('region',{name:'قارئ المصحف',exact:true})).toHaveAttribute('dir','rtl');
  await info.attach('desktop-reader.png',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
});

test('M10B08 opening today consumes its page request and later reader navigation restores the new bookmark',async({page})=>{
  await setup(page);await selectSecondAyah(page);
  await page.getByRole('button',{name:'خطة اليوم',exact:true}).click();
  await page.getByRole('button',{name:'ابدأ الحفظ',exact:true}).click();await enterRecall(page);
  await page.getByRole('button',{name:'أظهر النص وسجّل المساعدة',exact:true}).click();await sessionOptions(page);
  await page.getByRole('button',{name:'افتح موضع الجلسة في المصحف',exact:true}).click();await visiblePage(page,2);
  await page.getByRole('button',{name:'الصفحة التالية',exact:true}).click();await visiblePage(page,3);
  await expect.poll(()=>page.evaluate(()=>Object.keys(localStorage).some(key=>key.startsWith('mulazama-reader-location-v1:')&&JSON.parse(localStorage.getItem(key)!).page===3))).toBe(true);
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await expect(page.getByRole('region',{name:'قارئ المصحف',exact:true}).getByRole('img')).toHaveCount(0);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await visiblePage(page,3);
  await page.getByRole('button',{name:'خطة اليوم',exact:true}).click();await openReader(page);await visiblePage(page,3);
  await page.getByRole('button',{name:'خطة اليوم',exact:true}).click();
  await page.getByRole('button',{name:'استأنف جلستك',exact:true}).click();await sessionOptions(page);
  await page.getByRole('button',{name:'افتح موضع الجلسة في المصحف',exact:true}).click();await visiblePage(page,2);
});

test('M10B09 explicit reset isolates the previous profile target and the new profile can select without reloading',async({page})=>{
  await setup(page);await selectSecondAyah(page);
  const oldTarget=await page.evaluate(()=>Object.keys(localStorage).find(key=>key.startsWith('mulazama-study-target-10b:')));
  expect(oldTarget).toBeTruthy();
  // Reset only this context's disposable engineering profile through the ordinary confirmation UI.
  await page.evaluate(()=>{location.hash='S18';});
  await page.getByRole('button',{name:'احذف بيانات التعلم كاملة',exact:false}).click();
  await page.getByRole('button',{name:'تأكيد الحذف',exact:true}).click();
  await expect(page.locator('main[data-screen="S01"]')).toBeVisible();
  await openReader(page);await visiblePage(page,1);
  await expect(page.getByText(/المقدار المحدد:/)).toHaveCount(0);
  await readerTools(page);await page.getByLabel('من آية',{exact:true}).fill('3');await page.getByLabel('إلى آية',{exact:true}).fill('3');
  await page.getByRole('button',{name:'أضف إلى خطتي',exact:true}).click();
  await expect(page.getByText('أُضيف المقدار إلى خطتك. الاختيار وحده لا يُسجّل إنجازًا.',{exact:true})).toBeVisible();
  await expect(page.getByText(/المقدار المحدد:.*من آية ٣ إلى ٣/)).toBeVisible();
  const newTarget=await page.evaluate(()=>Object.keys(localStorage).find(key=>key.startsWith('mulazama-study-target-10b:')&&JSON.parse(localStorage.getItem(key)!).range.fromAyah===3));
  expect(newTarget).toBeTruthy();expect(newTarget).not.toBe(oldTarget);
  expect((await facts(page)).events.filter(event=>event.type==='AssessmentSubmitted')).toHaveLength(0);
  await page.reload();await visiblePage(page,1);await expect(page.getByText(/المقدار المحدد:.*من آية ٣ إلى ٣/)).toBeVisible();
});

test('M10B10 a second tab starting recall invalidates an already open reader without exposing the page',async({page,context})=>{
  await setup(page);await openReader(page);await visiblePage(page,1);
  const databaseName=await page.evaluate(()=>sessionStorage.getItem('mulazama-engineering-db-06l3'));
  expect(databaseName).toMatch(/^mulazama-engineering-06l3-[a-f0-9-]{36}$/);
  const other=await context.newPage();
  await other.clock.setFixedTime(new Date('2026-11-07T09:00:00.000Z'));
  // Deliberately share only this test's isolated engineering store, as two tabs of one learner do.
  await other.addInitScript(name=>sessionStorage.setItem('mulazama-engineering-db-06l3',name),databaseName!);
  await other.goto('/engineering.html');await other.bringToFront();
  await other.getByRole('button',{name:/^ابدأ (الحفظ|المراجعة)$/,exact:true}).click();
  await enterRecall(other);
  await expect(other.getByLabel('مادة الاختبار الصناعي',{exact:true})).toHaveCount(0);
  await page.bringToFront();
  await expect(page.getByText('استأنف جلستك وابدأ محاولة جديدة قبل كشف المصحف.',{exact:true})).toBeVisible();
  const reader=page.getByRole('region',{name:'قارئ المصحف',exact:true});
  await expect(reader.getByRole('img')).toHaveCount(0);await expect(reader.getByRole('combobox')).toHaveCount(0);
  await expect(reader.getByRole('button',{name:'أظهر المصحف وسجّل المساعدة',exact:true})).toHaveCount(0);
  expect((await facts(page)).events.filter(event=>event.type==='HintUsed')).toHaveLength(0);
  await page.getByRole('button',{name:'العودة إلى الجلسة',exact:true}).click();
  await page.getByRole('button',{name:'ابدأ محاولة جديدة بعد الانقطاع',exact:true}).click();
  await openReader(page);await page.getByRole('button',{name:'أظهر المصحف وسجّل المساعدة',exact:true}).click();await visiblePage(page,1);
  expect((await facts(page)).events.filter(event=>event.type==='HintUsed')).toHaveLength(1);
  await other.close();
});
