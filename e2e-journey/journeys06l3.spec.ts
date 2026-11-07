import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
async function setup(page:Page,prior=false,at='2026-11-07T09:00:00Z'){
 await page.clock.setFixedTime(new Date(at));
 await page.goto('/engineering.html');await expect(page.locator('.prototype-strip')).toContainText('ليس نصًا قرآنيًا');
 await page.getByRole('button',{name:'ابدأ إعداد تجربتك'}).click();
 if(prior)await page.getByRole('radio',{name:'لدي محفوظات سابقة وأريد مراجعتها'}).check();
 await page.getByRole('button',{name:'التالي: المحفوظات والهدف'}).click();
 if(prior)await page.getByRole('button',{name:'أضف إلى اختياراتي'}).click();
 await page.getByRole('button',{name:'التالي: الوقت المناسب'}).click();
 await page.getByRole('checkbox',{name:'السبت',exact:true}).check();
 await page.getByRole('button',{name:'احفظ واذهب إلى الرئيسية'}).click();
 await expect(page.getByRole('button',{name:'ابدأ وردك',exact:true})).toBeVisible();
}
async function facts(page:Page){return page.evaluate(async()=>{
 const {IndexedDbEventStore}=await import('/src/persistence/event-store.ts');
 const name=sessionStorage.getItem('mulazama-engineering-db-06l3')!;
 if(!name.startsWith('mulazama-engineering-06l3-'))throw Error('NOT_QA_DATABASE');
 const store=await IndexedDbEventStore.open(name);try{return await store.load();}finally{store.close();}
});}
async function recall(page:Page){await page.getByRole('button',{name:'ابدأ وردك',exact:true}).click();await expect(page.getByLabel('مادة الاختبار الصناعي',{exact:true})).toBeVisible();await page.getByRole('button',{name:'ابدأ التسميع الذاتي',exact:true}).click();await expect(page.getByLabel('مادة الاختبار الصناعي',{exact:true})).toHaveCount(0);}
test('L3J01 newcomer full isolated journey creates real durable HME events, schedules corrected review and survives reload',async({page},info)=>{
 await setup(page);await page.getByRole('button',{name:'ابدأ وردك',exact:true}).click();
 await page.getByRole('button',{name:'أنهيت تكرارًا',exact:true}).click();await expect(page.getByText('التكرارات التي أكّدتها: 1')).toBeVisible();
 await page.getByRole('button',{name:'ابدأ التسميع الذاتي',exact:true}).click();
 await expect(page.getByLabel('مادة الاختبار الصناعي',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'سمّعت المقطع كاملًا بلا خطأ معلوم — جهد عادي',exact:true}).click();
 await expect(page.getByRole('heading',{name:'حُفظ تقييمك الذاتي'})).toBeVisible();
 const before=await facts(page);expect(before.events.filter(e=>e.type==='AssessmentSubmitted')).toHaveLength(1);
 expect(before.events.filter(e=>e.data.scope==='hme').every(e=>e.versions.applicationEvidence==='hme-application-evidence-06l3.reference-1')).toBe(true);
 await page.reload();await expect(page.getByRole('heading',{name:'حُفظ تقييمك الذاتي'})).toBeVisible();
 expect((await facts(page)).events).toEqual(before.events);
 await page.getByRole('button',{name:'تابع إلى النشاط التالي'}).click();await expect(page.getByText(/أنشطة أُنجزت اليوم: 1/)).toBeVisible();
 await expect(page.getByRole('heading',{name:'التعاهد القادم'})).toBeVisible();
 await info.attach('newcomer-evidence.json',{body:JSON.stringify({engineering:true,quranSession:false,resultActions:1,assessmentEvents:1,originalEvents:before.events.map(e=>e.eventId),version:'reference-06e1'}),contentType:'application/json'});
});
test('L3J02 prior hafiz starts from declaration, records effort, corrects observation without duplicating review and retains goal history',async({page},info)=>{
 await setup(page,true);await expect(page.getByText('تسميع أول لمحفوظك المعلن')).toBeVisible();
 let snapshot=await facts(page);expect(snapshot.events.filter(e=>e.type==='AssessmentSubmitted')).toHaveLength(0);
 await recall(page);await page.getByRole('button',{name:'سمّعت المقطع كاملًا بلا خطأ معلوم — بصعوبة',exact:true}).click();
 await page.getByRole('button',{name:'صحّح النتيجة',exact:true}).click();
 await page.getByRole('button',{name:'سمّعت المقطع كاملًا بلا خطأ معلوم — بسهولة',exact:true}).click();
 await expect(page.getByRole('heading',{name:'حُفظ تقييمك الذاتي'})).toBeVisible();
 snapshot=await facts(page);expect(snapshot.events.filter(e=>e.type==='AssessmentSubmitted')).toHaveLength(1);expect(snapshot.events.filter(e=>e.type==='AssessmentCorrected')).toHaveLength(1);
 await page.getByRole('button',{name:'تابع إلى النشاط التالي'}).click();
 await expect(page.getByRole('heading',{name:'وردك اليوم',exact:true})).toBeVisible();
 await page.goto('/engineering.html#S02');await page.getByLabel('الوقت اليومي', {exact:false}).first().fill('20');
 await page.getByRole('button',{name:'راجع اختياراتك',exact:true}).click();
 await page.getByRole('button',{name:'اعتمد وتابع',exact:true}).click();
 const after=await facts(page);for(const original of snapshot.events)expect(after.events.find(e=>e.eventId===original.eventId)).toEqual(original);
 await info.attach('prior-evidence.json',{body:JSON.stringify({engineering:true,quranSession:false,declarationNotVerified:true,assessmentEvents:1,corrections:1,historyPreserved:true}),contentType:'application/json'});
});
test('L3J03 reload during recall requires restart, disclosure persists, cancelled activity never counts as completed',async({page})=>{
 await setup(page);await recall(page);await page.reload();
 await expect(page.getByRole('button',{name:'ابدأ محاولة جديدة بعد الانقطاع'})).toBeVisible();
 await expect(page.getByRole('button',{name:'سمّعت المقطع كاملًا بلا خطأ معلوم — جهد عادي',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'ابدأ محاولة جديدة بعد الانقطاع'}).click();
 await page.getByRole('button',{name:'أظهر النص وسجّل المساعدة'}).click();await expect(page.getByLabel('مادة الاختبار الصناعي',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'أنهِ الجلسة',exact:true}).click();await expect(page.getByText(/أنشطة أُنجزت اليوم: 0/)).toBeVisible();
 await page.getByRole('button',{name:'ابدأ وردك',exact:true}).click();await page.getByRole('button',{name:'ابدأ التسميع الذاتي',exact:true}).click();
 await page.getByRole('button',{name:'لم أستطع إكماله من الذاكرة',exact:true}).click();
 await expect(page.getByRole('heading',{name:'حُفظ تقييمك الذاتي'})).toBeVisible();
});
test('L3J04 phone keyboard and automated accessibility include daily activity, hidden recall answer and self-assessment',async({page},info)=>{
 await setup(page);await info.attach('phone-home.png',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
 await recall(page);expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'سمّعت المقطع كاملًا بلا خطأ معلوم — جهد عادي',exact:true}).focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('heading',{name:'حُفظ تقييمك الذاتي'})).toBeVisible();
 expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
});

test('L3J05 a returning prior hafiz receives an overdue review, records failure and keeps original history',async({page},info)=>{
 await setup(page,true);await recall(page);
 await page.getByRole('button',{name:'سمّعت المقطع كاملًا بلا خطأ معلوم — جهد عادي',exact:true}).click();
 await expect(page.getByRole('heading',{name:'حُفظ تقييمك الذاتي'})).toBeVisible();
 await page.getByRole('button',{name:'تابع إلى النشاط التالي'}).click();
 await expect(page.getByRole('heading',{name:'وردك اليوم',exact:true})).toBeVisible();
 const before=await facts(page);
 await page.clock.setFixedTime(new Date('2026-12-07T09:00:00Z'));
 await page.reload();await expect(page.getByText('مراجعة مستحقة',{exact:true})).toBeVisible();
 await recall(page);await page.getByRole('button',{name:'لم أستطع إكماله من الذاكرة',exact:true}).click();
 await expect(page.getByRole('heading',{name:'حُفظ تقييمك الذاتي'})).toBeVisible();
 await page.getByRole('button',{name:'تابع إلى النشاط التالي'}).click();
 await expect(page.getByRole('heading',{name:'مواضع تعثرت فيها بحسب نتائجك'})).toBeVisible();
 await expect(page.getByText(/أنشطة أُنجزت اليوم: 1/)).toBeVisible();
 const after=await facts(page);for(const original of before.events)expect(after.events.find(e=>e.eventId===original.eventId)).toEqual(original);
 expect(after.events.filter(e=>e.type==='AssessmentSubmitted')).toHaveLength(2);
 const projection=await page.evaluate(async(snapshot)=>{const {replayLearning}=await import('/src/application/learning.ts');return replayLearning({revision:snapshot.revision,events:snapshot.events.filter(e=>e.data.scope==='hme')});},after);
 const reviewed=Object.values(projection.units).find(u=>u.memory?.lastReviewAt==='2026-12-07T09:00:00.000Z');
 expect(reviewed?.dates?.policyDueAt).toBeTruthy();expect(Date.parse(reviewed!.dates!.policyDueAt!)).toBeGreaterThan(Date.parse('2026-12-07T09:00:00Z'));
 await page.reload();await expect(page.getByRole('heading',{name:'وردك اليوم',exact:true})).toBeVisible();expect((await facts(page)).events).toEqual(after.events);
 await info.attach('return-after-absence.json',{body:JSON.stringify({engineering:true,quranSession:false,elapsedDays:30,assessments:2,rescheduledAt:reviewed!.dates!.policyDueAt,historyPreserved:true}),contentType:'application/json'});
});

test('L3J06 an open dashboard refreshes its daily numbers and next activity when the user returns after midnight',async({page})=>{
 await setup(page,true,'2026-11-07T20:59:00Z');await recall(page);await page.getByRole('button',{name:'سمّعت المقطع كاملًا بلا خطأ معلوم — جهد عادي',exact:true}).click();
 await expect(page.getByRole('heading',{name:'حُفظ تقييمك الذاتي'})).toBeVisible();await page.getByRole('button',{name:'تابع إلى النشاط التالي'}).click();await expect(page.getByText(/أنشطة أُنجزت اليوم: 1/)).toBeVisible();
 await page.clock.setFixedTime(new Date('2026-11-07T21:01:00Z'));
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.getByText(/أنشطة أُنجزت اليوم: 0/)).toBeVisible();await expect(page.getByRole('button',{name:'ابدأ وردك',exact:true})).toBeVisible();
 const snapshot=await facts(page);expect(snapshot.events.filter(e=>e.type==='AssessmentSubmitted')).toHaveLength(1);
});

for(const prior of [false,true])test(`L4J${prior?'02':'01'} desktop ${prior?'prior hafiz':'newcomer'} saves, reloads and returns to the next activity in an isolated engineering journey`,async({page},info)=>{
 await page.setViewportSize({width:1366,height:900});await setup(page,prior);await recall(page);
 await page.getByRole('button',{name:'سمّعت المقطع كاملًا بلا خطأ معلوم — جهد عادي',exact:true}).click();
 await expect(page.getByRole('heading',{name:'حُفظ تقييمك الذاتي'})).toBeVisible();
 const before=await facts(page);expect(before.events.filter(e=>e.type==='AssessmentSubmitted')).toHaveLength(1);
 await page.reload();await expect(page.getByRole('heading',{name:'حُفظ تقييمك الذاتي'})).toBeVisible();expect((await facts(page)).events).toEqual(before.events);
 await page.getByRole('button',{name:'تابع إلى النشاط التالي'}).click();await expect(page.getByText(/أنشطة أُنجزت اليوم: 1/)).toBeVisible();
 expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await info.attach('desktop-journey.json',{body:JSON.stringify({viewport:1366,prior,engineering:true,quranSession:false,resultActions:1,reloadPreserved:true}),contentType:'application/json'});
});
