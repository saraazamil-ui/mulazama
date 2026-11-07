import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { initialState } from '../../src/domain/state';

const screens = Array.from({ length: 19 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`);
const widths = [320, 390, 430, 768, 1440];

for (const width of widths) {
  test(`RTL layout: all 19 screens at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1024 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const screen of screens) {
      await page.goto(`/#${screen}`);
      await expect(page.locator(`[data-screen="${screen}"]`)).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${screen} at ${width}px horizontal overflow`).toBeLessThanOrEqual(1);
      const badControls = await page.locator('button:visible, input:visible, select:visible, textarea:visible').evaluateAll(elements => elements.filter(element => {
        const target = element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type) ? (element.closest('label') || element) : element;
        const r = target.getBoundingClientRect();
        return r.left < -1 || r.right > window.innerWidth + 1 || r.width < 24 || r.height < 24;
      }).map(element => ({ text: element.textContent, label: element.getAttribute('aria-label') })));
      expect(badControls, `${screen} offscreen or undersized controls`).toEqual([]);
      if (width === 390 || ['S01', 'S05', 'S14', 'S18'].includes(screen)) await page.screenshot({ path: `docs/evidence/${screen}-${width}.png`, fullPage: true });
    }
    expect(errors).toEqual([]);
  });
}

test('WCAG automation: every screen in the default theme', async ({ page }) => {
  test.setTimeout(120_000);
  for (const screen of screens) {
    await page.goto(`/#${screen}`);
    await expect(page.locator(`[data-screen="${screen}"]`)).toBeVisible();
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(result.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) })), screen).toEqual([]);
  }
});

test('WCAG automation: every screen in dark theme', async ({ page }) => {
  test.setTimeout(120_000);
  const state = initialState();
  state.preferences.dark = true;
  await page.goto('/#S17');
  await page.evaluate(state => localStorage.setItem('itqan.prototype.v1', JSON.stringify(state)), state);
  for (const screen of screens) {
    await page.goto(`/#${screen}`);
    await page.reload();
    await expect(page.locator(`[data-screen="${screen}"]`)).toBeVisible();
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(result.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) })), screen).toEqual([]);
  }
  await page.screenshot({ path: 'docs/evidence/dark-S19-390.png', fullPage: true });
});

test('Large text at 320px: every screen remains operable', async ({ page }) => {
  const state = initialState();
  state.preferences.largeText = true;
  state.preferences.reducedMotion = true;
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/#S17');
  await page.evaluate(state => localStorage.setItem('itqan.prototype.v1', JSON.stringify(state)), state);
  for (const screen of screens) {
    await page.goto(`/#${screen}`);
    await page.reload();
    await expect(page.locator(`[data-screen="${screen}"]`)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), screen).toBeLessThanOrEqual(1);
  }
  await page.screenshot({ path: 'docs/evidence/large-text-S19-320.png', fullPage: true });
});

test('No remote dependencies: navigate loaded screens offline', async ({ page, context }) => {
  await page.goto('/#S05');
  const externalRequests: string[] = [];
  page.on('request', request => {
    if (!request.url().startsWith('http://127.0.0.1:4173') && !request.url().startsWith('data:') && !request.url().startsWith('blob:')) externalRequests.push(request.url());
  });
  // Browser-local navigation does not need a server once the app is loaded.
  await context.setOffline(true);
  for (const screen of ['S14', 'S17', 'S18', 'S19']) {
    await page.evaluate(screen => { window.location.hash = screen; }, screen);
    await expect(page.locator(`[data-screen="${screen}"]`)).toBeVisible();
  }
  expect(externalRequests).toEqual([]);
});

test('Evidence gallery and accessibility of populated dashboard and active training', async ({ page }) => {
  const state = initialState();
  state.config.configured = true;
  await page.goto('/#S05');
  await page.evaluate(state => localStorage.setItem('itqan.prototype.v1', JSON.stringify(state)), state);
  await page.reload();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 });
    await expect(page.getByRole('button', { name: 'ابدأ وردك التجريبي' })).toBeVisible();
    await page.screenshot({ path: `docs/evidence/dashboard-configured-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#S07');
  await page.getByRole('button', { name: 'ابدأ جلسة تدريب تجريبية', exact: true }).click();
  await page.getByRole('button', { name: 'أنهيت تكرارًا' }).click();
  await expect(page.getByRole('button', { name: 'أنهيت تكرارًا' })).toBeEnabled();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'docs/evidence/training-active-390.png', fullPage: true });
  await page.locator('.counter-card').screenshot({ path: 'docs/evidence/training-counter-390.png', style: '.toast, .bottom-nav { visibility: hidden !important; }' });
  const trainingResult = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(trainingResult.violations).toEqual([]);
  await page.getByRole('button', { name: 'انتقل إلى تجربة التسميع' }).click();
  await page.getByRole('button', { name: 'أحتاج إلى تلميح' }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'docs/evidence/recall-assisted-390.png', fullPage: true });
  const recallResult = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(recallResult.violations).toEqual([]);
  await page.getByRole('button', { name: 'أنهيت التسميع' }).click();
  await page.getByRole('button', { name: 'احفظ التقييم', exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'docs/evidence/assessment-report-390.png', fullPage: true });
  const assessmentResult = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(assessmentResult.violations).toEqual([]);
  await page.goto('/#S18');
  await page.getByRole('button', { name: 'احذف بيانات التعلم كاملة' }).click();
  const dialogResult = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(dialogResult.violations).toEqual([]);
  await page.getByRole('dialog').screenshot({ path: 'docs/evidence/delete-dialog-390.png' });
  await page.keyboard.press('Escape');
});

test('AC07 source fixtures: populated capacity screen retains 25/49/97 costs and responsive accessibility', async ({ page }) => {
  for (const [minutes, expected] of [[30, 25], [60, 49], [120, 97]]) {
    const state = initialState();
    state.config = { ...state.config, configured: true, persona: 'regular', minutes };
    await page.goto('/#S06');
    await page.evaluate(state => localStorage.setItem('itqan.prototype.v1', JSON.stringify(state)), state);
    await page.reload();
    await expect(page.getByText(`${expected.toLocaleString('ar-SA')} دقيقة`, { exact: true })).toBeVisible();
    for (const width of widths) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 1024 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'docs/evidence/capacity-configured-390.png', fullPage: true });
  for (const dark of [false, true]) {
    const state = initialState();
    state.config = { ...state.config, configured: true, persona: 'regular', minutes: 120 };
    state.preferences.dark = dark;
    await page.evaluate(state => localStorage.setItem('itqan.prototype.v1', JSON.stringify(state)), state);
    await page.reload();
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(result.violations).toEqual([]);
  }
});
