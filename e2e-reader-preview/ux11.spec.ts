import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {readerTools,sessionOptions,openProgress} from './ux-helpers';

const startUrl='/reader-preview.html?demo=1';
const clean='سمّعت المقطع كاملًا بلا خطأ معلوم — جهد عادي';
const reader=(page:Page)=>page.getByRole('region',{name:'قارئ المصحف',exact:true});
const day=(page:Page)=>page.getByRole('heading',{name:'وردك اليوم',exact:true});
async function facts(page:Page){return page.evaluate(async()=>{
  const name=localStorage.getItem('mulazama-reader-preview-db-10f');
  if(!name||!/^mulazama-reader-preview-10f-[a-f0-9-]{36}$/.test(name))throw Error('QA_STORE_REQUIRED');
  const {IndexedDbEventStore}=await import('/src/persistence/event-store.ts');
  const store=await IndexedDbEventStore.open(name);try{return await store.load();}finally{store.close();}
});}
async function visiblePage(page:Page,n:number){
  const image=reader(page).getByRole('img',{name:`صفحة اختبار صناعية ${n.toLocaleString('ar-SA')}`,exact:true});
  await expect(image).toBeVisible();await expect.poll(()=>image.evaluate(i=>(i as HTMLImageElement).complete&&(i as HTMLImageElement).naturalWidth>0)).toBe(true);
}
async function ready(page:Page){await page.goto(startUrl);await expect(day(page)).toBeVisible();await expect(page.getByRole('button',{name:'ابدأ الحفظ',exact:true})).toBeEnabled();}
async function chooseExistingTarget(page:Page){
  await page.getByRole('button',{name:'المصحف',exact:true}).click();await visiblePage(page,1);
  await reader(page).getByRole('combobox',{name:'السورة',exact:true}).selectOption('2');await visiblePage(page,3);
  await readerTools(page);await reader(page).getByLabel('من آية',{exact:true}).fill('3');await reader(page).getByLabel('إلى آية',{exact:true}).fill('3');
  await reader(page).getByRole('button',{name:'أضف إلى خطتي',exact:true}).click();
  await expect(reader(page)).toContainText('أُضيف المقدار إلى خطتك.');await reader(page).getByRole('button',{name:'خطة اليوم',exact:true}).click();await expect(day(page)).toBeVisible();
}
async function completeNew(page:Page){
  await page.getByRole('button',{name:'ابدأ الحفظ',exact:true}).click();await visiblePage(page,1);
  await page.getByRole('button',{name:'أنهيت الحفظ، أبدأ التسميع',exact:true}).click();
  await expect(reader(page)).toHaveCount(0);await page.getByRole('button',{name:clean,exact:true}).click();
  await expect(page.getByRole('heading',{name:'حُفظ تقييمك الذاتي',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'العودة إلى اليوم',exact:true}).click();await expect(day(page)).toBeVisible();
}
test.beforeEach(async({page})=>{await page.clock.setFixedTime(new Date('2026-11-09T09:00:00Z'));});

test('UX11-01 a new learner sees Today and one setup action, then keeps content gates after saving a plan',async({page})=>{
  await page.goto('/');await expect(day(page)).toBeVisible();
  await expect(page.locator('main').getByRole('button')).toHaveCount(1);
  await page.getByRole('button',{name:'أعد خطتي',exact:true}).click();
  await expect(page.getByRole('heading',{name:'حالة الحفظ',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'التالي: المحفوظات والهدف',exact:true}).click();
  await page.getByRole('button',{name:'التالي: الوقت المناسب',exact:true}).click();
  await page.getByRole('button',{name:'احفظ واذهب إلى الرئيسية',exact:true}).click();
  await expect(day(page)).toBeVisible();await expect(page.locator('main')).toContainText('اعتماد المحتوى');
  await expect(page.getByRole('button',{name:'أعد خطتي',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:/^ابدأ (الحفظ|المراجعة)$/,exact:true})).toHaveCount(2);
  await expect(page.getByRole('button',{name:'ابدأ الحفظ',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'ابدأ المراجعة',exact:true})).toBeDisabled();
  await page.reload();await expect(day(page)).toBeVisible();await expect(page.locator('main')).toContainText('وردك محفوظ');
  expect(await page.evaluate(()=>localStorage.getItem('mulazama-reader-preview-db-10f'))).toBeNull();
});

test('UX11-02 an existing target opens its reader in one action and finishes in four actions with two route transitions',async({page},info)=>{
  await ready(page);await chooseExistingTarget(page);await page.reload();await expect(day(page)).toBeVisible();
  await expect(page.getByRole('heading',{name:'قسم تجريبي ٢ — سطر ٣',exact:true})).toBeVisible();
  await info.attach('today-phone.png',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
  await page.setViewportSize({width:1440,height:1000});await info.attach('today-desktop.png',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});await page.setViewportSize({width:390,height:844});
  const before=await facts(page),steps:{action:string;from:string;to:string}[]=[];
  const click=async(action:string)=>{const from=new URL(page.url()).hash;await page.getByRole('button',{name:action,exact:true}).click();await expect(page.getByRole('button',{name:action,exact:true})).toHaveCount(0);steps.push({action,from,to:new URL(page.url()).hash});};
  await click('ابدأ الحفظ');await visiblePage(page,4);
  await info.attach('session-embedded-phone.png',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
  await expect(reader(page).getByRole('combobox')).toHaveCount(0);
  await expect(reader(page).locator('details')).toHaveCount(0);
  await click('أنهيت الحفظ، أبدأ التسميع');await expect(reader(page)).toHaveCount(0);
  await click(clean);await expect(page.getByRole('heading',{name:'حُفظ تقييمك الذاتي',exact:true})).toBeVisible();
  await expect(page.locator('main')).toContainText('تسجيل النشاط لا يثبت الإتقان');
  await click('العودة إلى اليوم');await expect(day(page)).toBeVisible();
  const after=await facts(page);expect(after.events.filter(e=>e.type==='SessionStarted')).toHaveLength(1);expect(after.events.filter(e=>e.type==='AssessmentSubmitted')).toHaveLength(1);
  expect(after.events.find(e=>e.type==='SessionStarted')?.data.command).toMatchObject({unitId:'test-reader-10f-s2-a3'});
  for(const old of before.events)expect(after.events.find(e=>e.eventId===old.eventId)).toEqual(old);
  expect(steps).toHaveLength(4);expect(steps.filter(s=>s.from!==s.to)).toHaveLength(2);
  await info.attach('memorization-step-comparison.json',{contentType:'application/json',body:JSON.stringify({baselineCommit:'4849df3741da2b9ddf2cdfe3ad75526e244fe337',baselineActions:7,baselineRouteTransitions:7,actions:steps.length,routeTransitions:2,syntheticOnly:true,includesReader:true,steps})});
});

test('UX11-03 after absence review opens directly in recall and saves unchanged rating meaning in three actions',async({page},info)=>{
  await ready(page);await completeNew(page);const before=await facts(page);
  await page.clock.setFixedTime(new Date('2026-12-09T09:00:00Z'));await page.reload();await expect(day(page)).toBeVisible();
  await expect(page.getByText('مراجعة مستحقة',{exact:true})).toBeVisible();
  const steps:{action:string;from:string;to:string}[]=[];
  const click=async(action:string)=>{const from=new URL(page.url()).hash;await page.getByRole('button',{name:action,exact:true}).click();await expect(page.getByRole('button',{name:action,exact:true})).toHaveCount(0);steps.push({action,from,to:new URL(page.url()).hash});};
  await click('ابدأ المراجعة');await expect(page.getByRole('button',{name:clean,exact:true})).toBeVisible();
  await expect(reader(page)).toHaveCount(0);await expect(page.getByRole('button',{name:'أنهيت الحفظ، أبدأ التسميع',exact:true})).toHaveCount(0);
  await click(clean);await expect(page.getByRole('heading',{name:'حُفظ تقييمك الذاتي',exact:true})).toBeVisible();
  await click('العودة إلى اليوم');await expect(day(page)).toBeVisible();
  const after=await facts(page);expect(after.events.filter(e=>e.type==='AssessmentSubmitted')).toHaveLength(2);
  for(const old of before.events)expect(after.events.find(e=>e.eventId===old.eventId)).toEqual(old);
  const latest=after.events.filter(e=>e.type==='AssessmentSubmitted').at(-1)!;
  expect(latest.data.command).toMatchObject({observation:{errors:0,completion:'complete',effort:'normal',gapVerified:false}});
  expect(steps).toHaveLength(3);expect(steps.filter(s=>s.from!==s.to)).toHaveLength(2);
  await info.attach('review-step-comparison.json',{contentType:'application/json',body:JSON.stringify({baselineActions:4,baselineRouteTransitions:4,actions:3,routeTransitions:2,elapsedDays:30,syntheticOnly:true,steps})});
});

test('UX11-04 interrupted recall stays unscored and resumes with the required restart in the same screen',async({page})=>{
  await ready(page);await page.getByRole('button',{name:'ابدأ الحفظ',exact:true}).click();await visiblePage(page,1);
  await page.getByRole('button',{name:'أنهيت الحفظ، أبدأ التسميع',exact:true}).click();await expect(page.getByRole('button',{name:clean,exact:true})).toBeVisible();await page.reload();
  await expect(page.getByRole('button',{name:'ابدأ محاولة جديدة بعد الانقطاع',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:clean,exact:true})).toHaveCount(0);expect((await facts(page)).events.filter(e=>e.type==='AssessmentSubmitted')).toHaveLength(0);
  const route=new URL(page.url()).hash;
  await page.getByRole('button',{name:'ابدأ محاولة جديدة بعد الانقطاع',exact:true}).click();await expect(page.getByRole('button',{name:clean,exact:true})).toBeVisible();expect(new URL(page.url()).hash).toBe(route);
  const after=await facts(page);expect(after.events.filter(e=>e.type==='RecallAttemptStarted')).toHaveLength(1);expect(after.events.filter(e=>e.type==='RecallAttemptRestarted')).toHaveLength(1);expect(after.events.filter(e=>e.type==='AssessmentSubmitted')).toHaveLength(0);
});

test('UX11-05 three destinations expose saved progress and reader position, with accessible secondary controls on mobile',async({page},info)=>{
  await page.setViewportSize({width:320,height:740});await ready(page);
  const nav=page.getByRole('navigation',{name:'التنقل على الهاتف',exact:true});await expect(nav.getByRole('button')).toHaveCount(3);
  expect(await nav.getByRole('button').allTextContents()).toEqual(['اليوم','المصحف','تقدمي']);
  await expect(page.getByRole('button',{name:'الإعدادات',exact:true})).toHaveCount(0);
  await page.getByText('المزيد',{exact:true}).click();await expect(page.getByRole('button',{name:'الإعدادات',exact:true})).toBeVisible();await page.getByText('المزيد',{exact:true}).click();
  await completeNew(page);await openProgress(page);await expect(page.getByLabel('عدد نتائج التسميع',{exact:true})).toHaveText('1');
  await expect(page.getByRole('heading',{name:'التعاهد القادم',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'نشاطك المسجل',exact:true})).toHaveCount(0);
  await page.getByText('سجل الحفظ والمراجعة',{exact:true}).click();
  await expect(page.getByRole('heading',{name:'نشاطك المسجل',exact:true})).toBeVisible();
  await expect(page.getByText('إجمالي الجلسات بتسميع مكتمل',{exact:true}).locator('..')).toContainText('١');
  await page.getByRole('button',{name:'المصحف',exact:true}).click();await visiblePage(page,1);
  await expect(reader(page).locator('details.mushaf-tools')).not.toHaveAttribute('open');
  await reader(page).getByRole('button',{name:'الصفحة التالية',exact:true}).click();await visiblePage(page,2);await page.reload();await visiblePage(page,2);
  await expect(reader(page).getByRole('combobox',{name:'الجزء',exact:true})).toHaveCount(0);
  const summary=reader(page).locator('details.mushaf-tools > summary');await summary.focus();await page.keyboard.press('Enter');await expect(reader(page).getByRole('combobox',{name:'الجزء',exact:true})).toBeVisible();await page.keyboard.press('Enter');
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await info.attach('simplified-reader-phone.png',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
  await page.getByText('المزيد',{exact:true}).click();await page.getByRole('button',{name:'الإعدادات',exact:true}).click();await page.getByRole('checkbox',{name:'تكبير النص',exact:true}).click();await expect(page.getByRole('checkbox',{name:'تكبير النص',exact:true})).toBeChecked();
  await page.getByRole('button',{name:'المصحف',exact:true}).click();await visiblePage(page,2);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('UX11-06 an active session keeps its reader page after repetition, resume and reload while a new session opens its own target',async({page})=>{
  await ready(page);await chooseExistingTarget(page);
  await page.getByRole('button',{name:'ابدأ الحفظ',exact:true}).click();await visiblePage(page,4);
  const started=await facts(page);
  expect(started.events.filter(event=>event.type==='SessionStarted')).toHaveLength(1);
  expect(started.events.find(event=>event.type==='SessionStarted')?.data.command).toMatchObject({unitId:'test-reader-10f-s2-a3'});

  await reader(page).getByRole('button',{name:'الصفحة التالية',exact:true}).click();await visiblePage(page,5);
  await sessionOptions(page);await page.getByRole('button',{name:'أنهيت تكرارًا',exact:true}).click();
  await expect(page.getByText('التكرارات التي أكّدتها: 1',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'أنهيت تكرارًا',exact:true})).toBeEnabled();await visiblePage(page,5);

  await page.getByRole('button',{name:'اليوم',exact:true}).click();await expect(day(page)).toBeVisible();
  await page.getByRole('button',{name:'استأنف جلستك',exact:true}).click();await visiblePage(page,5);
  await page.reload();await visiblePage(page,5);
  expect((await facts(page)).events.filter(event=>event.type==='SessionStarted')).toHaveLength(1);
  await sessionOptions(page);await page.getByRole('button',{name:'أنهِ الجلسة',exact:true}).click();await expect(day(page)).toBeVisible();
  const ended=await facts(page);expect(ended.events.filter(event=>event.type==='AssessmentSubmitted')).toHaveLength(0);

  await page.getByRole('button',{name:'المصحف',exact:true}).click();await visiblePage(page,5);
  await readerTools(page);await reader(page).getByLabel('من آية',{exact:true}).fill('3');await reader(page).getByLabel('إلى آية',{exact:true}).fill('3');
  await reader(page).getByRole('button',{name:'أضف إلى خطتي',exact:true}).click();await expect(reader(page)).toContainText('أُضيف المقدار إلى خطتك.');
  await reader(page).getByRole('button',{name:'خطة اليوم',exact:true}).click();await expect(page.getByRole('heading',{name:'قسم تجريبي ٣ — سطر ٣',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'ابدأ الحفظ',exact:true}).click();await visiblePage(page,6);
  const final=await facts(page),sessions=final.events.filter(event=>event.type==='SessionStarted');
  expect(sessions).toHaveLength(2);expect(sessions[1].data.command).toMatchObject({unitId:'test-reader-10f-s3-a3'});
  expect(final.events.filter(event=>event.type==='AssessmentSubmitted')).toHaveLength(0);
  for(const original of ended.events)expect(final.events.find(event=>event.eventId===original.eventId)).toEqual(original);
});
