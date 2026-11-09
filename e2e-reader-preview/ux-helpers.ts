import {expect,type Page} from '@playwright/test';

/** Open disclosure controls through the same visible action as a learner. */
export async function readerTools(page:Page){
  const details=page.locator('details.mushaf-tools');
  await expect(details).toHaveCount(1);
  if(await details.getAttribute('open')===null)await details.locator('summary').click();
}
export async function sessionOptions(page:Page){
  const details=page.locator('details').filter({has:page.locator('summary').filter({hasText:'خيارات الجلسة'})});
  await expect(details).toHaveCount(1);
  if(await details.getAttribute('open')===null)await details.locator('summary').click();
}
export async function enterRecall(page:Page){
  const finishReading=page.getByRole('button',{name:'أنهيت الحفظ، أبدأ التسميع',exact:true});
  const choice=page.getByRole('button',{name:'سمّعت المقطع كاملًا بلا خطأ معلوم — جهد عادي',exact:true});
  await expect(finishReading.or(choice)).toBeVisible();
  if(await finishReading.isVisible())await finishReading.click();
  await expect(choice).toBeVisible();
}
export async function openProgress(page:Page){
  await page.getByRole('button',{name:'تقدمي',exact:true}).click();
  await expect(page.getByRole('heading',{name:'تقدمي',exact:true})).toBeVisible();
}
