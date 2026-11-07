import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// These tests use the real application entry and real IndexedDB. They never
// inject a Quran package, award mastery, or open a production content gate.
test('BWEB07 new profile, plan and nonadjacent declarations survive reopening without filling gaps', async ({ page }) => {
  await page.goto('/#S01');
  await expect(page.getByRole('heading', { level: 1, name: 'أهلًا بك في مُلازَمَة' })).toBeVisible();
  await page.getByRole('button', { name: 'ابدأ إعداد تجربتك' }).click();
  await page.getByRole('radio', { name: 'لدي محفوظات سابقة وأريد مراجعتها' }).click();
  await page.getByRole('button', { name: 'التالي: المحفوظات والهدف' }).click();
  await page.getByRole('button', { name: 'أحدد محفوظاتي لاحقًا — التالي' }).click();
  await page.getByLabel('الوقت اليومي بالدقائق', { exact: true }).fill('30');
  await page.getByRole('button', { name: 'احفظ واذهب إلى الرئيسية' }).click();
  await expect(page.locator('main[data-screen="S05"]')).toBeVisible();
  await page.goto('/#S03');
  await page.getByRole('combobox', { name: 'طريقة التحديد', exact: true }).selectOption('juz');
  for (const [index, value] of ['1', '3', '1'].entries()) {
    await page.getByLabel('البداية', { exact: true }).fill(value);
    await page.getByLabel('النهاية', { exact: true }).fill(value);
    await page.getByRole('button', { name: 'أضف النطاق', exact: true }).click();
    await expect(page.locator('.range-list li')).toHaveCount(Math.min(index + 1, 2));
  }
  await page.reload();
  await expect(page.locator('.range-list li')).toHaveCount(2);
  await expect(page.getByText('محفوظ معلن · لم يُختبر بعد', { exact: true })).toHaveCount(2);
  await page.goto('/#S14');
  await page.getByText('استكشاف الأجزاء المعلنة', { exact: true }).click();
  const parts = page.locator('.juz-grid button');
  await expect(parts).toHaveCount(30);
  await expect(page.getByRole('button', { name: 'الجزء 1، محفوظ معلن غير مختبر', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'الجزء 2، لم يُختبر بعد', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'الجزء 3، محفوظ معلن غير مختبر', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'ملخص التقدم' })).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
});

test('BWEB08 usual and today-only budgets persist as separate values', async ({ page }) => {
  await page.goto('/#S06');
  await page.getByLabel('الدقائق المعتادة', { exact: true }).fill('60');
  await page.getByRole('button', { name: 'راجع تعديل الوقت المعتاد' }).click();
  await page.getByRole('dialog', { name: 'تأكيد تعديل الوقت' }).getByRole('button', { name: 'تأكيد التعديل' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('دقائق اليوم', { exact: true }).fill('30');
  await page.getByRole('button', { name: 'راجع تعديل وقت اليوم' }).click();
  await page.getByRole('dialog', { name: 'تأكيد تعديل الوقت' }).getByRole('button', { name: 'تأكيد التعديل' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('الدقائق المعتادة', { exact: true })).toHaveValue('60');
  await expect(page.getByLabel('دقائق اليوم', { exact: true })).toHaveValue('30');
  await expect(page.getByText('لم تُنشأ مراجعات أو التزامات افتراضية.', { exact: false })).toBeVisible();
});

test('BWEB09 direct learning routes keep training, recall and reader controls out of the DOM', async ({ page }) => {
  for (const id of ['S04', 'S07', 'S08', 'S09', 'S10', 'S11', 'S13', 'S15', 'S16']) {
    await page.goto('/#' + id);
    await expect(page.locator(`main[data-screen="${id}"]`)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'النص المعتمد ينتظر الإضافة' })).toBeVisible();
    // Full DOM absence is stronger than visual hiding. This only verifies the
    // current blocked state; it cannot approve future Quran recall rendering.
    await expect(page.locator('.counter,.recall-tools,.reader-stage')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /أنهيت التكرار|اعرض تلميحًا|أنهيت التسميع/, includeHidden: true })).toHaveCount(0);
  }
});

test('BWEB10 direct service commands cannot bypass the Quran gate or create learning events', async ({ page }, info) => {
  await page.goto('/#S01');
  const result = await page.evaluate(async () => {
    // Development QA imports exercise the production service implementation.
    // A separately named synthetic DB avoids altering the visible profile.
    const { ApplicationService } = await import(/* @vite-ignore */ '/src/application/service.ts');
    const { IndexedDbEventStore } = await import(/* @vite-ignore */ '/src/persistence/event-store.ts');
    const name = 'mulazama-05b-e2e-gate-' + crypto.randomUUID();
    const store = await IndexedDbEventStore.open(name);
    const service = await ApplicationService.open(store);
    try {
      const before = await store.load();
      const commands = [
        { type: 'session.start', kind: 'new', rangeLabel: 'SYNTHETIC-NON-QURAN-REFERENCE' },
        ...['session.repeat', 'session.startRecall', 'session.pause', 'session.resume', 'session.end', 'session.restartRecall', 'session.finishedBeforeStop', 'attempt.hint', 'attempt.reveal'].map(type => ({ type })),
        { type: 'attempt.finish', termination: 'completed' },
        { type: 'attempt.assess', input: { completion: 'complete', errorObservation: 'none', effort: 'easy' } },
      ];
      const rejections: { type: string; code: string | null }[] = [];
      for (const command of commands) {
        try { await service.dispatch(command); rejections.push({ type: command.type, code: null }); }
        catch (error) { rejections.push({ type: command.type, code: (error as { code?: string }).code ?? 'untyped-error' }); }
      }
      const after = await store.load();
      return { rejections, beforeRevision: before.revision, afterRevision: after.revision,
        beforeEvents: before.events.length, afterEvents: after.events.length,
        rawEventsUnchanged: JSON.stringify(after.events) === JSON.stringify(before.events),
        session: service.state.session, attempts: service.state.attempts.length };
    } finally {
      service.close();
      await new Promise<void>((resolve, reject) => {
        const deletion = indexedDB.deleteDatabase(name);
        deletion.onsuccess = () => resolve(); deletion.onerror = () => reject(deletion.error);
      });
    }
  });
  await info.attach('service-gate-rejections', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.rejections).toHaveLength(12);
  // 05-B authorizes every learning command before dispatch. Missing signed
  // release evidence rejects here, before content or UI-contract execution.
  expect(result.rejections.every(item => item.code === 'RELEASE_GATES_BLOCKED')).toBe(true);
  expect(result.afterRevision).toBe(result.beforeRevision);
  expect(result.afterEvents).toBe(result.beforeEvents);
  expect(result.rawEventsUnchanged).toBe(true);
  expect(result.session).toBeNull();
  expect(result.attempts).toBe(0);
});

test('BWEB11 forecast abstains and thirty untested parts do not acquire mastery', async ({ page }) => {
  await page.goto('/#S19');
  await expect(page.getByText('لا تتوفر بيانات كافية لتقدير التقدم المتوقع بصورة موثوقة', { exact: true })).toBeVisible();
  await expect(page.getByText('لا تاريخ ختام شخصي · لا موعد للإتقان', { exact: true })).toBeVisible();
  await expect(page.getByText('غير متاح', { exact: true })).toHaveCount(4);
  await page.goto('/#S14');
  await expect(page.locator('.juz-grid button')).toHaveCount(30);
  await expect(page.locator('.juz-grid button.declared')).toHaveCount(0);
  await expect(page.locator('.juz-grid button', { hasText: 'غير مختبر' })).toHaveCount(30);
  await expect(page.getByRole('region', { name: 'ملخص التقدم' })).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
});

test('BWEB12 keyboard skip link, modal focus containment and Escape restore focus', async ({ page }) => {
  await page.goto('/#S18');
  const skip = page.getByRole('link', { name: 'تجاوز إلى المحتوى' });
  await skip.focus();
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  const deleteButton = page.getByRole('button', { name: 'احذف بيانات التعلم كاملة' });
  await deleteButton.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'هل تريد حذف بيانات التعلم؟' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'إلغاء', exact: true })).toBeFocused();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(deleteButton).toBeFocused();
});

test('BWEB13 invalid backup preserves preferences; confirmed full restore can be repeated', async ({ page }, info) => {
  const password = 'Mulazama-05B-synthetic-backup-password';
  await page.goto('/#S17');
  await page.getByRole('checkbox', { name: 'تكبير النص' }).click();
  await expect(page.getByRole('checkbox', { name: 'تكبير النص' })).toBeChecked();
  await page.goto('/#S18');
  await page.getByLabel('كلمة مرور النسخة', { exact: false }).fill(password);
  const pendingDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'صدّر النسخة المشفرة' }).click();
  const download = await pendingDownload, path = info.outputPath('mulazama-05b-roundtrip.json');
  await download.saveAs(path);
  await page.goto('/#S17');
  await page.getByRole('checkbox', { name: 'تكبير النص' }).click();
  await expect(page.getByRole('checkbox', { name: 'تكبير النص' })).not.toBeChecked();
  await page.goto('/#S18');
  await page.getByLabel('كلمة مرور النسخة', { exact: false }).fill(password);
  await page.getByLabel('اختر النسخة المشفرة', { exact: true }).setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/#S17');
  await expect(page.getByRole('checkbox', { name: 'تكبير النص' })).not.toBeChecked();
  for (let i = 0; i < 2; i++) {
    await page.goto('/#S18');
    await page.getByLabel('كلمة مرور النسخة', { exact: false }).fill(password);
    await page.getByLabel('اختر النسخة المشفرة', { exact: true }).setInputFiles(path);
    await expect(page.getByRole('dialog', { name: 'مراجعة الملف قبل الاستبدال' })).toBeVisible();
    await page.getByRole('button', { name: 'تأكيد الاستبدال الكامل' }).click();
    await expect(page.locator('main[data-screen="S05"]')).toBeVisible();
    await page.goto('/#S17');
    await expect(page.getByRole('checkbox', { name: 'تكبير النص' })).toBeChecked();
  }
});

test('BWEB14 a reported mistake remains a local unverified draft after reopening', async ({ page }) => {
  await page.goto('/#S12');
  await page.getByRole('combobox', { name: 'نوع الخطأ', exact: true }).selectOption('link');
  await page.getByRole('combobox', { name: 'درجة التأكد', exact: true }).selectOption('suspected');
  await page.getByLabel('ملاحظة اختيارية', { exact: true }).fill('SYNTHETIC-NON-QURAN-ERROR-DRAFT');
  await page.getByRole('button', { name: 'احفظ البلاغ', exact: true }).click();
  await expect(page.locator('.mistake-item')).toHaveCount(1);
  await page.reload();
  const draft = page.locator('.mistake-item');
  await expect(draft).toContainText('SYNTHETIC-NON-QURAN-ERROR-DRAFT');
  await expect(draft).toContainText('مسودة بلا موضع محدد');
  await expect(draft).toContainText('مشتبه');
  await expect(draft).toContainText('لم تُثبت المعالجة');
  await expect(page.getByText('ملاحظة عامة، لا محاولة تاريخية', { exact: true })).toBeVisible();
});

test('BWEB15 enlarged text, reduced motion and dark preference persist at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/#S17');
  for (const name of ['تكبير النص', 'تقليل الحركة', 'الوضع الداكن']) {
    await page.getByRole('checkbox', { name, exact: true }).click();
    await expect(page.getByRole('checkbox', { name, exact: true })).toBeChecked();
  }
  await page.reload();
  for (const name of ['تكبير النص', 'تقليل الحركة', 'الوضع الداكن']) {
    await expect(page.getByRole('checkbox', { name, exact: true })).toBeChecked();
  }
  await expect(page.locator('html')).toHaveAttribute('data-large', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(result.violations).toEqual([]);
});
