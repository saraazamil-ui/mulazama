import {test,expect} from '@playwright/test';

test('L3ISO-WEB development entry cannot mint engineering authority or write HME through query flags and direct module calls',async({page},info)=>{
 // A fresh Playwright profile: no real browser user database is opened or modified.
 await page.addInitScript(()=>{
  (window as unknown as {qaOpened:string[]}).qaOpened=[];const open=indexedDB.open.bind(indexedDB);
  indexedDB.open=((name:string,version?:number)=>{(window as unknown as {qaOpened:string[]}).qaOpened.push(name);return open(name,version);}) as typeof indexedDB.open;
 });
 await page.goto('/engineering.html?approved=true&mode=test&databaseName=mulazama-learning-v1');
 await expect(page.getByRole('heading',{name:'تعذر فتح الاختبار الهندسي'})).toBeVisible();
 expect(await page.evaluate(()=>(window as unknown as {qaOpened:string[]}).qaOpened)).toEqual([]);
 const code=await page.evaluate(async()=>{const {mintSyntheticLearningAccess}=await import('/src/release/access.ts');try{mintSyntheticLearningAccess([{id:'test-bypass',editionId:'test-bypass',probeProfileVersionId:'test-chunk',words:1,coverage:['test-key']}]);return 'unexpected-authorization';}catch(e){return (e as {code?:string}).code;}});
 expect(code).toBe('RELEASE_GATES_BLOCKED');
 await page.goto('/?engineering=true&approved=true#S08');await expect(page.getByRole('heading',{name:'النص المعتمد ينتظر الإضافة'})).toBeVisible();
 await expect(page.getByRole('button',{name:'ابدأ التسميع الذاتي',exact:true})).toHaveCount(0);
 const snapshot=await page.evaluate(async()=>{
  const {IndexedDbEventStore}=await import('/src/persistence/event-store.ts');const {runtimeDatabaseName}=await import('/src/release/runtime.ts');
  const name=runtimeDatabaseName();if(name!=='mulazama-development-learning-v1')throw Error('EXPECTED_ISOLATED_DEVELOPMENT_MODE');const store=await IndexedDbEventStore.open(name);try{return await store.load();}finally{store.close();}
 });
 expect(snapshot.events.some(e=>e.data.scope==='hme')).toBe(false);
 await info.attach('denied-entry.json',{body:JSON.stringify({runtime:'development',engineeringEntryDeniedBeforeDatabase:true,directMintDenied:true,queryFlagsIgnored:true,hmeEvents:0,productionBuildScope:'Checked separately by build verifier and deployment tests, not this development-server test'}),contentType:'application/json'});
});
