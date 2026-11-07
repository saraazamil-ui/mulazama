import {test,expect} from '@playwright/test';
test('versioned app shell and existing IndexedDB state reopen with all network disabled',async({page,context})=>{
 await page.goto('/#S17');
 await expect(page.getByRole('checkbox',{name:'تكبير النص'})).toBeVisible();
 await page.getByRole('checkbox',{name:'تكبير النص'}).click();
 await expect(page.getByRole('checkbox',{name:'تكبير النص'})).toBeChecked();
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
 await page.reload();
 await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
 await context.setOffline(true);
 const reopened=await context.newPage();await reopened.goto('http://127.0.0.1:4174/#S17');
 await expect(reopened.getByRole('checkbox',{name:'تكبير النص'})).toBeChecked();
 await reopened.goto('http://127.0.0.1:4174/#S14');
 await expect(reopened.getByRole('region',{name:'ملخص التقدم'})).toBeVisible();
 await expect(reopened.getByRole('progressbar')).toHaveCount(0);
 await reopened.goto('http://127.0.0.1:4174/#S07');
 await expect(reopened.getByText('النص المعتمد ينتظر الإضافة')).toBeVisible();
});
