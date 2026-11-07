import {test,expect} from '@playwright/test';
test('BWEB01 IndexedDB: 21 encrypted transaction, migration, corruption, concurrency and restore checks',async({page},info)=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    // This diagnostic module is served by the development QA server only, never imported by the app.
    const module=await import(/* @vite-ignore */'/src/persistence/browser-tests05b.ts');
    return module.runPersistence05BChecks();
  });
  await info.attach('indexeddb-check-results',{body:JSON.stringify(result,null,2),contentType:'application/json'});
  expect(result).toHaveLength(21);
  expect(result.map((r:{name:string})=>r.name.split(' ')[0])).toEqual(
    Array.from({length:21},(_,i)=>'IDB'+String(i+1).padStart(2,'0')),
  );
  expect(result.every((r:{passed:boolean})=>r.passed)).toBe(true);
});
