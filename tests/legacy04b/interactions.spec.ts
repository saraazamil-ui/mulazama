import { test, expect, type Page } from '@playwright/test';
import { initialState, transition } from '../../src/domain/state';
import type { PrototypeState, AttemptKind } from '../../src/domain/contracts';

const key = 'itqan.prototype.v1';
async function readState(page: Page): Promise<PrototypeState | null> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), key);
}
async function seed(page: Page, state: PrototypeState, screen: string) {
  await page.goto(`/#${screen}`);
  await page.evaluate(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), { key, state });
  await page.reload();
}
function sessionState(kind: AttemptKind = 'new') {
  const state = initialState();
  state.config.configured = true;
  const next = transition(state, { type: 'session.start', kind, rangeLabel: 'نطاق اختبار غير قرآني' });
  if (!next.ok) throw new Error(next.error);
  return next.state;
}
async function beginSession(page: Page, kind: 'new' | 'review') {
  await seed(page, initialState(), kind === 'new' ? 'S07' : 'S08');
  await page.getByRole('button', { name: kind === 'new' ? 'ابدأ جلسة تدريب تجريبية' : 'ابدأ التسميع التجريبي', exact: true }).click();
}

test('AC02/03: beginner setup validates time, persists config, and skips diagnosis', async ({ page }) => {
  await page.goto('/#S01');
  await page.getByRole('button', { name: 'ابدأ إعداد تجربتك' }).click();
  await page.getByLabel('الوقت اليومي بالدقائق').fill('-5');
  await page.getByRole('button', { name: 'راجع اختياراتك' }).click();
  await expect(page.getByRole('alert')).toContainText('أدخل عدد دقائق صحيحًا');
  expect(await readState(page)).toBeNull();
  await page.getByLabel('الوقت اليومي بالدقائق').fill('15');
  await page.getByRole('button', { name: 'راجع اختياراتك' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'اعتمد وتابع' }).click();
  await expect(page.locator('main')).toHaveAttribute('data-screen', 'S05');
  expect((await readState(page))?.config.minutes).toBe(15);
  expect((await readState(page))?.ranges).toHaveLength(0);
  expect((await readState(page))?.attempts).toHaveLength(0);
  await page.reload();
  expect((await readState(page))?.config.minutes).toBe(15);
});

test('AC04: nonadjacent declarations in all four selectors remain unassessed', async ({ page }) => {
  await page.goto('/#S03');
  for (const number of ['2', '114']) {
    await page.getByLabel('البداية', { exact: true }).fill(number);
    await page.getByLabel('النهاية', { exact: true }).fill(number);
    await page.getByRole('button', { name: 'أضف النطاق', exact: true }).click();
  }
  let state = (await readState(page))!;
  expect(state.ranges.map(r => [r.kind, r.start, r.end])).toEqual([['surah', 2, 2], ['surah', 114, 114]]);
  for (const [kind, start, end] of [['juz', '30', '30'], ['page', '5', '7'], ['ayah', '1', '3']]) {
    await page.getByLabel('طريقة التحديد').selectOption(kind);
    await page.getByLabel('البداية', { exact: true }).fill(start);
    await page.getByLabel('النهاية', { exact: true }).fill(end);
    await page.getByRole('button', { name: 'أضف النطاق', exact: true }).click();
  }
  state = (await readState(page))!;
  expect(state.ranges).toHaveLength(5);
  expect(state.ranges.every(r => r.status === 'declared_unassessed')).toBe(true);
  expect(state.attempts).toHaveLength(0);
  await expect(page.locator('.range-list')).toContainText('لم يُختبر بعد');
  await page.getByLabel('البداية', { exact: true }).fill('10');
  await page.getByLabel('النهاية', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'أضف النطاق', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('النهاية');
  expect((await readState(page))?.ranges).toHaveLength(5);
  await page.reload();
  expect((await readState(page))?.ranges).toHaveLength(5);
});

test('AC03/26: time preview and cancellation do not mutate settings', async ({ page }) => {
  await seed(page, initialState(), 'S06');
  await page.getByLabel('وقت الخطة بالدقائق').fill('60');
  await page.getByRole('button', { name: 'معاينة تعديل الوقت' }).click();
  expect((await readState(page))?.config.minutes).toBe(30);
  await page.getByRole('dialog').getByRole('button', { name: 'إلغاء', exact: true }).click();
  expect((await readState(page))?.config.minutes).toBe(30);
  await page.getByRole('button', { name: 'معاينة تعديل الوقت' }).click();
  await page.getByRole('button', { name: 'اعتمد الوقت المعتاد' }).click();
  expect((await readState(page))?.config.minutes).toBe(60);
  expect((await readState(page))?.attempts).toHaveLength(0);
  await page.getByRole('button', { name: 'عرض المراجعات المؤجلة' }).click();
  await expect(page.getByLabel('اليوم المعروض')).toHaveValue('tomorrow');
});

test('AC22: failed save is visible and does not acknowledge changed data', async ({ page }) => {
  await seed(page, initialState(), 'S02');
  await page.locator('.lab summary').click();
  await page.getByLabel('حالة الاختبار').selectOption('saveFailure');
  await page.getByLabel('الوقت اليومي بالدقائق').fill('45');
  await page.getByRole('button', { name: 'راجع اختياراتك' }).click();
  await page.getByRole('button', { name: 'اعتمد وتابع' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('تعذر الحفظ');
  expect((await readState(page))?.config.minutes).toBe(30);
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('Loading and read error retry do not manufacture learning attempts', async ({ page }) => {
  await seed(page, initialState(), 'S05');
  await page.locator('.lab summary').click();
  await page.getByLabel('حالة الاختبار').selectOption('loading');
  await expect(page.getByText('جارٍ تحميل اللقطة التجريبية…')).toBeVisible();
  await page.getByRole('button', { name: 'أكمل التحميل التجريبي' }).click();
  await page.getByLabel('حالة الاختبار').selectOption('error');
  await expect(page.getByText('تعذر تحميل هذه الشاشة')).toBeVisible();
  await page.getByRole('button', { name: 'إعادة المحاولة' }).click();
  expect((await readState(page))?.attempts).toHaveLength(0);
});

test('Corrupt local state is reported without automatic overwrite', async ({ page }) => {
  await page.goto('/#S01');
  await page.evaluate(key => localStorage.setItem(key, '{broken'), key);
  await page.reload();
  await expect(page.locator('main').getByRole('alert')).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe('{broken');
  await page.getByRole('button', { name: 'إغلاق الرسالة', exact: true }).click();
  await page.getByRole('button', { name: 'تفعيل الوضع الداكن', exact: true }).click();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe('{broken');
});

test('AC09/22: four repetitions survive pause and reload without claiming mastery', async ({ page }) => {
  await beginSession(page, 'new');
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: 'أنهيت تكرارًا' }).click();
    await expect(page.getByRole('button', { name: 'أنهيت تكرارًا' })).toBeEnabled();
  }
  expect((await readState(page))?.session?.repeats).toBe(4);
  expect((await readState(page))?.attempts).toHaveLength(0);
  await page.getByRole('button', { name: 'إيقاف مؤقت' }).click();
  await expect(page.locator('main')).toHaveAttribute('data-screen', 'S10');
  await page.reload();
  await page.getByRole('button', { name: 'استأنف التدريب' }).click();
  await expect(page.locator('main')).toHaveAttribute('data-screen', 'S07');
  expect((await readState(page))?.session?.repeats).toBe(4);
  expect((await readState(page))?.attempts).toHaveLength(0);
  await page.getByRole('button', { name: 'انتقل إلى تجربة التسميع' }).click();
  expect((await readState(page))?.attempts).toHaveLength(1);
});

test('AC10/11/12/25: hint, observed error, disputed assessment and correction preserve history', async ({ page }) => {
  await beginSession(page, 'review');
  await page.getByRole('button', { name: 'أحتاج إلى تلميح' }).click();
  expect((await readState(page))?.attempts[0].hints).toBe(1);
  await page.getByRole('button', { name: 'أظهر النص', exact: true }).click();
  expect((await readState(page))?.attempts[0].revealed).toBe(true);
  await page.getByRole('button', { name: 'ضع علامة على خطأ' }).click();
  await page.getByLabel('درجة التأكد').selectOption('observed');
  await page.getByLabel('نوع الخطأ').selectOption('word');
  await page.getByRole('button', { name: 'احفظ تصحيح الخطأ', exact: true }).click();
  expect((await readState(page))?.mistakes[0].location).toBeNull();
  await page.getByRole('button', { name: 'العودة للمحاولة' }).click();
  await page.getByRole('button', { name: 'أنهيت التسميع' }).click();
  await page.getByRole('combobox', { name: 'اكتمال التسميع', exact: true }).selectOption('complete');
  await page.getByLabel('الأخطاء بحسب ملاحظتك').selectOption('none');
  await page.getByRole('combobox', { name: 'الجهد', exact: true }).selectOption('easy');
  await expect(page.getByText('تعارض: توجد بلاغات خطأ', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'احفظ التقييم', exact: true }).click();
  let state = (await readState(page))!;
  expect(state.attempts).toHaveLength(1);
  expect(state.attempts[0]).toMatchObject({ assessed: true, status: 'disputed', hints: 2, revealed: true, strictPass: null, effectiveRating: null });
  await expect(page.getByText('غير مقاسة', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'صحح تقييمي', exact: true }).click();
  await page.getByLabel('الأخطاء بحسب ملاحظتك').selectOption('present');
  await page.getByLabel('سبب التصحيح').fill('تصحيح اختيار ملاحظة الخطأ');
  await page.getByRole('button', { name: 'احفظ التصحيح', exact: true }).click();
  state = (await readState(page))!;
  expect(state.attempts).toHaveLength(1);
  const assessmentCorrections = state.corrections.filter(c => c.entity === 'attempt');
  expect(assessmentCorrections).toHaveLength(1);
  expect(assessmentCorrections[0].previous).toMatchObject({ errorObservation: 'none' });
  expect(state.attempts[0].errorObservation).toBe('present');
  expect(state.attempts[0].hints).toBe(2);
});

test('AC10/22: interrupted recall starts a new identity and keeps the incomplete original', async ({ page }) => {
  await beginSession(page, 'review');
  await page.getByRole('button', { name: 'أحتاج إلى تلميح' }).click();
  const firstId = (await readState(page))!.attempts[0].id;
  await page.getByRole('button', { name: 'إيقاف مؤقت' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'ابدأ محاولة جديدة', exact: true }).click();
  const state = (await readState(page))!;
  expect(state.attempts).toHaveLength(2);
  expect(state.attempts[0]).toMatchObject({ id: firstId, hints: 1, assessed: false, strictPass: null });
  expect(state.session?.attemptId).not.toBe(firstId);
});

test('AC11: canceled assessment stays incomplete and a memory stop never becomes success', async ({ page }) => {
  await beginSession(page, 'review');
  await page.getByRole('button', { name: 'لم أستطع الإكمال' }).click();
  await page.getByRole('button', { name: 'إلغاء التقييم', exact: true }).click();
  expect((await readState(page))?.attempts[0].assessed).toBe(false);
  await page.getByRole('button', { name: 'استأنف التقييم' }).click();
  await page.getByRole('combobox', { name: 'اكتمال التسميع', exact: true }).selectOption('complete');
  await page.getByLabel('الأخطاء بحسب ملاحظتك').selectOption('none');
  await page.getByRole('combobox', { name: 'الجهد', exact: true }).selectOption('easy');
  await page.getByRole('button', { name: 'احفظ التقييم', exact: true }).click();
  expect((await readState(page))?.attempts[0]).toMatchObject({ termination: 'memory_failure', status: 'disputed', strictPass: null, effectiveRating: null });
});

test('AC18/19: thirty named parts and forecast abstention without silent setting changes', async ({ page }) => {
  await seed(page, initialState(), 'S14');
  await expect(page.locator('.juz-grid button')).toHaveCount(30);
  await page.getByRole('button', { name: 'الجزء 30، لم يُختبر بعد', exact: true }).click();
  await expect(page.locator('main')).toHaveAttribute('data-screen', 'S15');
  await page.goto('/#S19');
  await page.getByLabel('جرّب وقتًا مختلفًا بالدقائق').fill('60');
  await page.getByRole('button', { name: 'معاينة الوقت', exact: true }).click();
  expect((await readState(page))?.config.minutes).toBe(30);
  await expect(page.getByText('لا تاريخ ختام شخصي · لا موعد للإتقان', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'اعتمد الوقت', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'إلغاء', exact: true }).click();
  expect((await readState(page))?.config.minutes).toBe(30);
});

test('AC23 prototype: invalid import is nondestructive; valid replacement needs confirmation', async ({ page }) => {
  const original = sessionState();
  await seed(page, original, 'S18');
  await page.getByLabel('اختر ملف التجربة').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await expect(page.getByRole('alert')).toContainText('لم تتغير البيانات');
  expect((await readState(page))?.profileId).toBe(original.profileId);
  const replacement = initialState();
  replacement.config.minutes = 15;
  await page.getByLabel('اختر ملف التجربة').setInputFiles({ name: 'valid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(replacement)) });
  await expect(page.getByRole('dialog')).toBeVisible();
  expect((await readState(page))?.profileId).toBe(original.profileId);
  await page.getByRole('dialog').getByRole('button', { name: 'إلغاء', exact: true }).click();
  expect((await readState(page))?.profileId).toBe(original.profileId);
  await page.getByLabel('اختر ملف التجربة').setInputFiles({ name: 'valid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(replacement)) });
  await page.getByRole('button', { name: 'تأكيد الاستبدال', exact: true }).click();
  const restored = (await readState(page))!;
  expect(restored.profileId).toBe(replacement.profileId);
  expect(restored.session).toBeNull();
  expect(restored.config.minutes).toBe(15);
});

test('AC28/29: delete dialog traps keyboard focus, Escape cancels, confirmed deletion resets history', async ({ page }) => {
  const state = sessionState('review');
  await seed(page, state, 'S18');
  const trigger = page.getByRole('button', { name: 'احذف بيانات التعلم كاملة' });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect((await readState(page))?.profileId).toBe(state.profileId);
  expect((await readState(page))?.attempts).toHaveLength(1);
  await trigger.click();
  await page.getByRole('button', { name: 'تأكيد الحذف', exact: true }).click();
  const reset = (await readState(page))!;
  expect(reset.profileId).not.toBe(state.profileId);
  expect(reset.attempts).toHaveLength(0);
  expect(reset.ranges).toHaveLength(0);
  expect(reset.session).toBeNull();
});

test('Real storage exception: failed write cannot increment the confirmed repetition counter', async ({ page }) => {
  await beginSession(page, 'new');
  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Test quota exceeded', 'QuotaExceededError'); };
  });
  await page.getByRole('button', { name: 'أنهيت تكرارًا' }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('لم يُؤكد الحفظ');
  expect((await readState(page))?.session?.repeats).toBe(0);
  await expect(page.getByLabel('عدد التكرارات')).toHaveText('٠');
});

test('Prototype export round trip preserves identity and clearly labels plaintext', async ({ page }) => {
  const original = initialState();
  original.config.minutes = 45;
  await seed(page, original, 'S18');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'صدّر ملفًا تجريبيًا', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('itqan-prototype.json');
  const path = await download.path();
  expect(path).not.toBeNull();
  await page.getByLabel('اختر ملف التجربة').setInputFiles(path!);
  await expect(page.getByRole('dialog')).toContainText('غير مشفر');
  await page.getByRole('button', { name: 'تأكيد الاستبدال', exact: true }).click();
  expect((await readState(page))?.profileId).toBe(original.profileId);
  expect((await readState(page))?.config.minutes).toBe(45);
});

test('AC20/21/24 prototype: offline manual flow works without notification or microphone permission', async ({ page, context }) => {
  await seed(page, initialState(), 'S17');
  await page.getByLabel('تفضيل التذكير التجريبي').check();
  await page.getByLabel('تفضيل التذكير التجريبي').uncheck();
  expect((await readState(page))?.preferences.reminder).toBe(false);
  await context.setOffline(true);
  await page.evaluate(() => { window.location.hash = 'S08'; });
  await page.getByRole('button', { name: 'ابدأ التسميع التجريبي', exact: true }).click();
  await page.getByRole('button', { name: 'أنهيت التسميع' }).click();
  await page.getByRole('button', { name: 'احفظ التقييم', exact: true }).click();
  expect((await readState(page))?.attempts[0]).toMatchObject({ assessed: true, strictPass: null, effectiveRating: null });
});

test('AC03/07: today-only budget is separate, cancel is inert, and zero preserves deferred obligations', async ({ page }) => {
  const original = initialState();
  original.config = { ...original.config, configured: true, persona: 'regular', minutes: 30 };
  await seed(page, original, 'S06');
  const plannedTitles = await page.locator('.task-row h3').allTextContents();
  await page.getByRole('button', { name: 'عرض المراجعات المؤجلة' }).click();
  const deferredTitles = await page.locator('.task-row h3').allTextContents();
  await page.getByLabel('اليوم المعروض').selectOption('today');
  await page.getByLabel('وقت هذا اليوم فقط بالدقائق').fill('60');
  await page.getByRole('button', { name: 'غيّر وقت هذا اليوم', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveAccessibleName('تأكيد وقت اليوم فقط');
  await page.getByRole('dialog').getByRole('button', { name: 'إلغاء', exact: true }).click();
  expect((await readState(page))?.todayBudget).toBeNull();
  expect((await readState(page))?.config.minutes).toBe(30);
  await page.getByRole('button', { name: 'غيّر وقت هذا اليوم', exact: true }).click();
  await page.getByRole('button', { name: 'اعتمد وقت اليوم فقط', exact: true }).click();
  expect((await readState(page))?.todayBudget?.minutes).toBe(60);
  expect((await readState(page))?.config.minutes).toBe(30);
  await expect(page.getByText('٤٩ دقيقة', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('وقت هذا اليوم فقط بالدقائق')).toHaveValue('60');
  await page.getByLabel('وقت هذا اليوم فقط بالدقائق').fill('0');
  await page.getByRole('button', { name: 'غيّر وقت هذا اليوم', exact: true }).click();
  await page.getByRole('button', { name: 'اعتمد وقت اليوم فقط', exact: true }).click();
  expect((await readState(page))?.todayBudget?.minutes).toBe(0);
  expect((await readState(page))?.config.minutes).toBe(30);
  expect((await readState(page))?.config.days).toEqual(original.config.days);
  await expect(page.locator('.task-row')).toHaveCount(0);
  await page.getByRole('button', { name: 'عرض المراجعات المؤجلة' }).click();
  const remaining = await page.locator('.task-row h3').allTextContents();
  expect(remaining.sort()).toEqual([...plannedTitles, ...deferredTitles].sort());
  expect((await readState(page))?.attempts).toHaveLength(0);
});
