import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// Vitest runs this test-only polyfill in Node; browser application types intentionally exclude Node globals.
// @ts-ignore Node runtime module is available to Vitest without adding a browser dependency.
import { webcrypto } from 'node:crypto';
import { MushafReader10b, readerBookmarkKey } from './MushafReader10b';
import { createEngineeringMushafFixture } from './testing/mushaf-fixture10b';
import { createCandidateReviewMushaf, createEngineeringMushaf, type MushafManifest, type VerifiedMushaf } from './mushaf/model';
import { contentHash } from './content/content-gate';
import { canonical } from './core/types';

let createUrl: ReturnType<typeof vi.fn>, revokeUrl: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('crypto', webcrypto);
  let sequence = 0;
  createUrl = vi.fn(() => `blob:verified-reader-${++sequence}`);
  revokeUrl = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: createUrl });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revokeUrl });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const defaults = () => ({ databaseName: 'test-reader-profile', onToday: vi.fn() });
const visiblePage = (page: number) => screen.findByRole('img', { name: `صفحة اختبار صناعية ${page.toLocaleString('ar-SA')}` });
async function openTools() {
  const summary = screen.getByText('اختيار المقدار وخيارات المصحف', { exact: true });
  if (!summary.closest('details')!.open) await userEvent.setup().click(summary);
}

async function selectionFixture() {
  const original = await createEngineeringMushafFixture();
  const images = new Map<number, Uint8Array<ArrayBuffer>>();
  for (const page of original.pages) {
    const blob = await original.pageImage(page.number);
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(blob);
    });
    images.set(page.number, new Uint8Array(bytes));
  }
  const positions = [[1, 1, 1], [1, 2, 1], [1, 3, 2], [1, 4, 2], [2, 1, 2], [2, 2, 3]];
  const manifest: MushafManifest = { schemaVersion: 1, editionId: original.editionId, layoutId: original.layoutId, version: 'test-selection-10f',
    contentManifestHash: original.contentManifestHash, source: original.source, sourceFiles: [], pages: [...original.pages],
    surahs: [{ number: 1, name: 'السورة الصناعية الأولى', ayahCount: 4, startPage: 1 }, { number: 2, name: 'السورة الصناعية الثانية', ayahCount: 2, startPage: 2 }],
    verses: positions.map(([surah, ayah, page]) => ({ surah, ayah, juz: surah, startPage: page, endPage: page, tokenKeys: [`test-selection-${surah}-${ayah}`] })),
  };
  return createEngineeringMushaf(manifest, images, [{ number: 1, page: 1, surah: 1, ayah: 1 }, { number: 2, page: 2, surah: 2, ayah: 1 }]);
}
const rowChoice = (ayah: number, surah = 'الأولى') => screen.getByRole('button', { name: `اختيار السطر التجريبي ${ayah.toLocaleString('ar-SA')} من السورة الصناعية ${surah}` });

async function candidateUiFixture() {
  // Synthetic geometry only: exercise the genuine review capability without loading Quran artwork.
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 0 120 180"><rect id="candidate-unit-only" x="0" y="0" width="100" height="170" fill="#eee"/></svg>';
  const bytes = new TextEncoder().encode(svg);
  const pin = '3ff27b46cecb0c0519d77531d9c868a579d1f623';
  const manifest: MushafManifest = {
    schemaVersion: 1, editionId: 'candidate-ui-fixture', layoutId: 'candidate-ui-layout', version: 'test-only', contentManifestHash: '0'.repeat(64), sourceFiles: [],
    source: { name: 'مرشح صناعي للاختبار', url: `https://github.com/quran-ws/quran-svg/tree/${pin}/mushafs/hafs/kfqc`, attribution: 'أشكال صناعية لاختبار واجهة المراجعة فقط', licenseNotice: 'Test fixture only; no content approval.' },
    surahs: [{ number: 1, name: 'سورة مرشح الاختبار', ayahCount: 2, startPage: 1 }],
    pages: [{ number: 1, juz: 1, asset: { path: `https://raw.githubusercontent.com/quran-ws/quran-svg/${pin}/mushafs/hafs/kfqc/svg/001.svg`, mimeType: 'image/svg+xml', sha256: await contentHash(bytes), bytes: bytes.length, width: 120, height: 180, viewBox: [-2, 0, 120, 180] } }],
    verses: [1, 2].map(ayah => ({ surah: 1, ayah, juz: 1, startPage: 1, endPage: 1, tokenKeys: [] })),
  };
  return { svg, mushaf: await createCandidateReviewMushaf(manifest, await contentHash(canonical(manifest)), [{ number: 1, page: 1, surah: 1, ayah: 1 }], async () => bytes.slice()) };
}

describe('10-B verified-page reader UI (synthetic non-Quran images)', () => {
  it('MUI01 missing content shows no fabricated image, navigation or session controls', async () => {
    const props = defaults(); render(<MushafReader10b {...props} mushaf={null} />);
    expect(screen.getByRole('heading', { name: 'النص المعتمد ينتظر الإضافة' })).toBeVisible();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ابدأ نشاط خطة اليوم' })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'العودة إلى خطة اليوم' }));
    expect(props.onToday).toHaveBeenCalledOnce();
  });

  it('MUI02 an unbranded object cannot expose supplied page or source values', () => {
    render(<MushafReader10b {...defaults()} mushaf={{ editionId: 'forged', source: { attribution: 'unverified-source' } } as VerifiedMushaf} />);
    expect(screen.getByRole('heading', { name: 'النص المعتمد ينتظر الإضافة' })).toBeVisible();
    expect(screen.queryByText('unverified-source')).not.toBeInTheDocument();
    expect(createUrl).not.toHaveBeenCalled();
  });

  it('MUI03 navigates verified pages, parts, numeric jump and boundaries without selecting a learning target', async () => {
    const mushaf = await createEngineeringMushafFixture(), select = vi.fn(), user = userEvent.setup();
    render(<MushafReader10b {...defaults()} mushaf={mushaf} onSelectRange={select} />);
    expect(screen.getByRole('region', { name: 'قارئ المصحف' })).toHaveAttribute('dir', 'rtl');
    await visiblePage(1); await openTools();
    expect(screen.getByRole('button', { name: 'الصفحة السابقة' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'الصفحة التالية' })); await visiblePage(2);
    await user.selectOptions(screen.getByRole('combobox', { name: 'الجزء' }), '2'); await visiblePage(3);
    expect(screen.getByRole('button', { name: 'الصفحة التالية' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('رقم الصفحة'), { target: { value: '1' } });
    await user.click(screen.getByRole('button', { name: 'انتقل' })); await visiblePage(1);
    expect(select).not.toHaveBeenCalled();
    expect(revokeUrl).toHaveBeenCalled();
  });

  it('MUI04 supports keyboard and rightward forward swipes while preserving vertical scroll gestures', async () => {
    render(<MushafReader10b {...defaults()} mushaf={await createEngineeringMushafFixture()} />);
    await visiblePage(1);
    const stage = screen.getByRole('group', { name: 'صفحات المصحف' });
    fireEvent.keyDown(stage, { key: 'ArrowRight' }); await visiblePage(2);
    fireEvent.keyDown(stage, { key: 'ArrowLeft' }); await visiblePage(1);
    fireEvent.touchStart(stage, { touches: [{ clientX: 30, clientY: 80 }] });
    fireEvent.touchEnd(stage, { changedTouches: [{ clientX: 150, clientY: 90 }] }); await visiblePage(2);
    fireEvent.touchStart(stage, { touches: [{ clientX: 150, clientY: 80 }] });
    fireEvent.touchEnd(stage, { changedTouches: [{ clientX: 30, clientY: 90 }] }); await visiblePage(1);
    fireEvent.touchStart(stage, { touches: [{ clientX: 30, clientY: 80 }] });
    fireEvent.touchEnd(stage, { changedTouches: [{ clientX: 150, clientY: 240 }] });
    expect(screen.getByRole('img')).toHaveAttribute('alt', 'صفحة اختبار صناعية ١');
  });

  it('MUI05 restores a confirmed page only for the same profile and edition/layout', async () => {
    const mushaf = await createEngineeringMushafFixture(), props = defaults();
    const view = render(<MushafReader10b {...props} mushaf={mushaf} requestedPage={2} />);
    fireEvent.load(await visiblePage(2));
    const key = readerBookmarkKey(props.databaseName, mushaf);
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ page: 2, editionId: mushaf.editionId, layoutId: mushaf.layoutId });
    view.unmount();
    const restored = render(<MushafReader10b {...props} mushaf={mushaf} />); await visiblePage(2);
    restored.unmount();
    render(<MushafReader10b {...props} databaseName="different-profile" mushaf={mushaf} />); await visiblePage(1);
  });

  it('MUI06 ignores corrupt and out-of-bounds bookmarks, and reports denied storage without blocking reading', async () => {
    const mushaf = await createEngineeringMushafFixture(), props = defaults(), key = readerBookmarkKey(props.databaseName, mushaf);
    localStorage.setItem(key, '{not-json');
    const view = render(<MushafReader10b {...props} mushaf={mushaf} />); await visiblePage(1); view.unmount();
    localStorage.setItem(key, JSON.stringify({ version: 1, editionId: mushaf.editionId, layoutId: mushaf.layoutId, page: 999 }));
    const second = render(<MushafReader10b {...props} mushaf={mushaf} />); await visiblePage(1);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
    fireEvent.load(screen.getByRole('img'));
    expect(screen.getByRole('alert')).toHaveTextContent('تعذر حفظ آخر موضع');
    expect(screen.getByRole('img')).toBeVisible(); second.unmount();
  });

  it('MUI07 selection and start require separate explicit actions and surface rejected writes truthfully', async () => {
    const mushaf = await createEngineeringMushafFixture(), select = vi.fn(), start = vi.fn(), user = userEvent.setup();
    render(<MushafReader10b {...defaults()} mushaf={mushaf} onSelectRange={select} onStart={start} />);
    await visiblePage(1); await openTools();
    fireEvent.change(screen.getByLabelText('من آية'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('إلى آية'), { target: { value: '3' } });
    await user.click(screen.getByRole('button', { name: 'أضف إلى خطتي' }));
    expect(select).toHaveBeenCalledExactlyOnceWith({ surah: 1, fromAyah: 2, toAyah: 3 });
    expect(start).not.toHaveBeenCalled();
    expect(screen.getByText(/الاختيار وحده لا يُسجّل إنجازًا/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'ابدأ نشاط خطة اليوم' })); expect(start).toHaveBeenCalledOnce();
    select.mockRejectedValueOnce(new Error('تعذر تأكيد حفظ المقدار'));
    await user.click(screen.getByRole('button', { name: 'أضف إلى خطتي' }));
    expect(screen.getByRole('alert')).toHaveTextContent('تعذر تأكيد حفظ المقدار');
    expect(screen.queryByText(/أُضيف المقدار إلى خطتك/)).not.toBeInTheDocument();
  });

  it('MUI08 invalid reversed ranges and page numbers do not invoke callbacks or change pages', async () => {
    const select = vi.fn(); render(<MushafReader10b {...defaults()} mushaf={await createEngineeringMushafFixture()} onSelectRange={select} />);
    await visiblePage(1); await openTools();
    const from = screen.getByLabelText('من آية'), to = screen.getByLabelText('إلى آية');
    fireEvent.change(from, { target: { value: '3' } }); fireEvent.change(to, { target: { value: '1' } });
    fireEvent.submit(from.closest('form')!);
    expect(screen.getByRole('alert')).toHaveTextContent('اختر بداية ونهاية صحيحتين'); expect(select).not.toHaveBeenCalled();
    const jump = screen.getByLabelText('رقم الصفحة'); fireEvent.change(jump, { target: { value: '99' } }); fireEvent.submit(jump.closest('form')!);
    expect(screen.getByRole('alert')).toHaveTextContent('رقم الصفحة غير موجود');
    expect(screen.getByRole('img')).toHaveAttribute('alt', 'صفحة اختبار صناعية ١');
  });

  it('MUI09 entering recall unmounts pages, revokes image URL and requires confirmed help before any page can reappear', async () => {
    const mushaf = await createEngineeringMushafFixture(), props = defaults(), reveal = vi.fn().mockRejectedValue(new Error('لم تُحفظ المساعدة'));
    const view = render(<MushafReader10b {...props} mushaf={mushaf} />); await visiblePage(1);
    const url = screen.getByRole('img').getAttribute('src');
    view.rerender(<MushafReader10b {...props} mushaf={mushaf} readingBlocked onReveal={reveal} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument(); expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(revokeUrl).toHaveBeenCalledWith(url); expect(reveal).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole('button', { name: 'أظهر المصحف وسجّل المساعدة' }));
    expect(reveal).toHaveBeenCalledOnce(); expect(screen.getByRole('alert')).toHaveTextContent('لم تُحفظ المساعدة');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('MUI10 interrupted recall cannot invoke reveal, and requested-page changes never retain the old image', async () => {
    const mushaf = await createEngineeringMushafFixture(), reveal = vi.fn(), resume = vi.fn(), props = defaults();
    const view = render(<MushafReader10b {...props} mushaf={mushaf} readingBlocked revealUnavailable onReveal={reveal} onResume={resume} />);
    expect(screen.queryByRole('button', { name: 'أظهر المصحف وسجّل المساعدة' })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'العودة إلى الجلسة' })); expect(resume).toHaveBeenCalledOnce(); expect(reveal).not.toHaveBeenCalled();
    view.rerender(<MushafReader10b {...props} mushaf={mushaf} requestedPage={1} />); await visiblePage(1);
    view.rerender(<MushafReader10b {...props} mushaf={mushaf} requestedPage={3} />); await visiblePage(3);
    expect(screen.queryByRole('img', { name: 'صفحة اختبار صناعية ١' })).not.toBeInTheDocument();
  });

  it('MUI11 a failed page never renders, stops navigation, and supports an explicit retry', async () => {
    const original = await createEngineeringMushafFixture();
    const manifest: MushafManifest = { schemaVersion: 1, editionId: original.editionId, layoutId: original.layoutId, version: original.version,
      contentManifestHash: original.contentManifestHash, source: original.source, sourceFiles: [], surahs: [...original.surahs], pages: [...original.pages], verses: [...original.verses] };
    const missing = createEngineeringMushaf(manifest, new Map(), original.juzStarts);
    render(<MushafReader10b {...defaults()} mushaf={missing} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('تعذر التحقق من صفحة المصحف'));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'الصفحة التالية' })).toBeDisabled();
    await userEvent.setup().click(screen.getByRole('button', { name: 'أعد تحميل الصفحة' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('تعذر التحقق من صفحة المصحف'));
    expect(createUrl).not.toHaveBeenCalled();
  });

  it('MUI12 preserves an explicitly chosen juz that begins inside a verse and shared page', async () => {
    const mushaf = await createEngineeringMushafFixture({ mixedJuzBoundary: true }), user = userEvent.setup();
    expect(mushaf.pages[1].juz).toBe(1); expect(mushaf.verses[1].juz).toBe(1);
    render(<MushafReader10b {...defaults()} mushaf={mushaf} onSelectRange={vi.fn()} />);
    await visiblePage(1); await openTools();
    await user.selectOptions(screen.getByRole('combobox', { name: 'الجزء' }), '2');
    await visiblePage(2);
    expect(screen.getByRole('combobox', { name: 'الجزء' })).toHaveValue('2');
    expect(screen.getByLabelText('من آية')).toHaveValue(2);
    await user.click(screen.getByRole('button', { name: 'الصفحة التالية' })); await visiblePage(3);
    await user.click(screen.getByRole('button', { name: 'الصفحة السابقة' })); await visiblePage(2);
    expect(screen.getByRole('combobox', { name: 'الجزء' })).toHaveValue('1');
    // Selecting the second part on that same page must also retain its exact boundary.
    await user.selectOptions(screen.getByRole('combobox', { name: 'الجزء' }), '2');
    expect(screen.getByRole('combobox', { name: 'الجزء' })).toHaveValue('2');
    expect(screen.getByLabelText('من آية')).toHaveValue(2);
  });

  it('MUI13 keeps a selected surah when its first page also contains the preceding surah', async () => {
    const original = await createEngineeringMushafFixture();
    const images = new Map<number, Uint8Array<ArrayBuffer>>();
    for (const page of original.pages) {
      const blob = await original.pageImage(page.number);
      const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(blob);
      });
      images.set(page.number, new Uint8Array(bytes));
    }
    const manifest: MushafManifest = { schemaVersion: 1, editionId: original.editionId, layoutId: original.layoutId, version: 'mixed-surah-test',
      contentManifestHash: original.contentManifestHash, source: original.source, sourceFiles: [], pages: [...original.pages],
      surahs: [{ number: 1, name: 'السورة الصناعية الأولى', ayahCount: 2, startPage: 1 }, { number: 2, name: 'السورة الصناعية الثانية', ayahCount: 2, startPage: 2 }],
      verses: [original.verses[0], original.verses[1],
        { ...original.verses[1], surah: 2, ayah: 1, juz: 2, tokenKeys: Array.from({ length: 8 }, (_, i) => `test-shared-page-${i}`) },
        { ...original.verses[2], surah: 2, ayah: 2 }],
    };
    const mushaf = createEngineeringMushaf(manifest, images, [{ number: 1, page: 1, surah: 1, ayah: 1 }, { number: 2, page: 2, surah: 2, ayah: 1 }]);
    const select = vi.fn(), user = userEvent.setup();
    render(<MushafReader10b {...defaults()} mushaf={mushaf} onSelectRange={select} />);
    await visiblePage(1); await openTools();
    await user.selectOptions(screen.getByRole('combobox', { name: 'السورة' }), '2'); await visiblePage(2);
    expect(screen.getByRole('combobox', { name: 'السورة' })).toHaveValue('2');
    expect(screen.getByLabelText('من آية')).toHaveValue(1); expect(screen.getByLabelText('إلى آية')).toHaveValue(1);
    await user.click(screen.getByRole('button', { name: 'أضف إلى خطتي' }));
    expect(select).toHaveBeenCalledExactlyOnceWith({ surah: 2, fromAyah: 1, toAyah: 1 });
    // A page jump clears the surah anchor; selecting it again on the same page restores it.
    fireEvent.change(screen.getByLabelText('رقم الصفحة'), { target: { value: '2' } });
    await user.click(screen.getByRole('button', { name: 'انتقل' }));
    expect(screen.getByRole('combobox', { name: 'السورة' })).toHaveValue('1');
    await user.selectOptions(screen.getByRole('combobox', { name: 'السورة' }), '2');
    expect(screen.getByRole('combobox', { name: 'السورة' })).toHaveValue('2');
    expect(screen.getByLabelText('من آية')).toHaveValue(1);
  });

  it('MUI14 refuses image publication while the latest session check is pending or invalidated', async () => {
    const mushaf = await createEngineeringMushafFixture(), props = defaults();
    let finishCheck!: () => void;
    const pending = new Promise<void>(resolve => { finishCheck = resolve; });
    const beforeRead = vi.fn().mockResolvedValueOnce(undefined).mockImplementation(() => pending);
    const view = render(<MushafReader10b {...props} mushaf={mushaf} beforeRead={beforeRead} />);
    await waitFor(() => expect(beforeRead).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('img')).not.toBeInTheDocument(); expect(createUrl).not.toHaveBeenCalled();
    view.rerender(<MushafReader10b {...props} mushaf={mushaf} beforeRead={beforeRead} checkingSession />);
    expect(screen.getByRole('status')).toHaveTextContent('جارٍ التحقق من الجلسة المحفوظة');
    await act(async () => { finishCheck(); await pending; });
    expect(screen.queryByRole('img')).not.toBeInTheDocument(); expect(createUrl).not.toHaveBeenCalled();
    beforeRead.mockResolvedValue(undefined);
    view.rerender(<MushafReader10b {...props} mushaf={mushaf} beforeRead={beforeRead} />); await visiblePage(1);
    const url = screen.getByRole('img').getAttribute('src');
    view.rerender(<MushafReader10b {...props} mushaf={mushaf} beforeRead={beforeRead} checkingSession />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument(); expect(revokeUrl).toHaveBeenCalledWith(url);
  });

  it('MUI15 session read failures keep pages hidden but can be retried, and restore errors remain visible', async () => {
    const beforeRead = vi.fn().mockRejectedValue(new Error('storage not confirmed'));
    render(<MushafReader10b {...defaults()} mushaf={await createEngineeringMushafFixture()} beforeRead={beforeRead} unavailableReason="تعذر استعادة مقدار الحفظ" />);
    await waitFor(() => expect(screen.getAllByRole('alert').some(alert => alert.textContent?.includes('تعذر تأكيد حالة الجلسة'))).toBe(true));
    expect(screen.getByText('تعذر استعادة مقدار الحفظ')).toBeVisible();
    expect(screen.queryByRole('img')).not.toBeInTheDocument(); expect(createUrl).not.toHaveBeenCalled();
    beforeRead.mockResolvedValue(undefined);
    await userEvent.setup().click(screen.getByRole('button', { name: 'أعد تحميل الصفحة' })); await visiblePage(1);
  });

  it('MUI16 a failed session check shows its error and a safe exit instead of an endless spinner', async () => {
    const props = defaults();
    render(<MushafReader10b {...props} mushaf={await createEngineeringMushafFixture()} checkingSession unavailableReason="تعذر تأكيد حالة الجلسة" />);
    expect(screen.getByRole('alert')).toHaveTextContent('تعذر تأكيد حالة الجلسة');
    expect(screen.queryByRole('status')).not.toBeInTheDocument(); expect(screen.queryByRole('img')).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'العودة إلى خطة اليوم' }));
    expect(props.onToday).toHaveBeenCalledOnce();
  });

  it('MUI17 acknowledges a displayed request so later guard remounts restore the latest page', async () => {
    const mushaf = await createEngineeringMushafFixture(), props = defaults(), shown = vi.fn(), user = userEvent.setup();
    const view = render(<MushafReader10b {...props} mushaf={mushaf} requestedPage={2} onPageShown={shown} />);
    const requested = await visiblePage(2);
    expect(shown).not.toHaveBeenCalled();
    fireEvent.load(requested); expect(shown).toHaveBeenCalledExactlyOnceWith(2);
    // The app consumes the acknowledged request; ordinary reading now owns its location.
    view.rerender(<MushafReader10b {...props} mushaf={mushaf} onPageShown={shown} />);
    await user.click(screen.getByRole('button', { name: 'الصفحة التالية' })); fireEvent.load(await visiblePage(3));
    expect(shown).toHaveBeenLastCalledWith(3);
    view.rerender(<MushafReader10b {...props} mushaf={mushaf} onPageShown={shown} checkingSession />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    view.rerender(<MushafReader10b {...props} mushaf={mushaf} onPageShown={shown} />);
    await visiblePage(3);
    expect(screen.queryByRole('img', { name: 'صفحة اختبار صناعية ٢' })).not.toBeInTheDocument();
  });

  it('MUI18 synthetic reader is clearly distinguished from an official Mushaf and has no placeholder source link', async () => {
    render(<MushafReader10b {...defaults()} mushaf={await selectionFixture()} onSelectRange={vi.fn()} />);
    await visiblePage(1);
    expect(screen.getByRole('heading', { name: 'تجربة قارئ المصحف' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'مصحف المدينة النبوية' })).not.toBeInTheDocument();
    expect(screen.getByText('تجربة القارئ — بيانات صناعية غير قرآنية.', { exact: true })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'المصدر' })).not.toBeInTheDocument();
  });

  it('MUI19 row clicks only draft a range and explicit save sends canonical surah and ayah identifiers', async () => {
    const select = vi.fn(), user = userEvent.setup();
    render(<MushafReader10b {...defaults()} mushaf={await selectionFixture()} onSelectRange={select} />);
    await visiblePage(1); await openTools();
    await user.click(rowChoice(1));
    expect(rowChoice(1)).toHaveAttribute('aria-pressed', 'true');
    expect(rowChoice(2)).toHaveAttribute('aria-pressed', 'false');
    await user.click(rowChoice(2));
    expect(rowChoice(2)).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('من آية')).toHaveValue(1); expect(screen.getByLabelText('إلى آية')).toHaveValue(2);
    expect(select).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'أضف إلى خطتي' }));
    expect(select).toHaveBeenCalledExactlyOnceWith({ surah: 1, fromAyah: 1, toAyah: 2 });
  });

  it('MUI20 a draft survives page turns and resolves reversed endpoints into one inclusive range', async () => {
    const select = vi.fn(), user = userEvent.setup();
    render(<MushafReader10b {...defaults()} mushaf={await selectionFixture()} onSelectRange={select} requestedPage={2} />);
    await visiblePage(2); await openTools();
    await user.click(rowChoice(3));
    await user.click(screen.getByRole('button', { name: 'الصفحة السابقة' })); await visiblePage(1);
    expect(screen.getByLabelText('من آية')).toHaveValue(3);
    await user.click(rowChoice(1));
    expect(screen.getByLabelText('من آية')).toHaveValue(1); expect(screen.getByLabelText('إلى آية')).toHaveValue(3);
    expect(select).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'أضف إلى خطتي' }));
    expect(select).toHaveBeenCalledExactlyOnceWith({ surah: 1, fromAyah: 1, toAyah: 3 });
  });

  it('MUI21 clicking another surah on a shared page starts a new range instead of combining identifiers', async () => {
    const select = vi.fn(), user = userEvent.setup();
    render(<MushafReader10b {...defaults()} mushaf={await selectionFixture()} onSelectRange={select} requestedPage={2} />);
    await visiblePage(2); await openTools(); await user.click(rowChoice(4)); await user.click(rowChoice(1, 'الثانية'));
    expect(screen.getByRole('combobox', { name: 'السورة' })).toHaveValue('2');
    expect(screen.getByLabelText('من آية')).toHaveValue(1); expect(screen.getByLabelText('إلى آية')).toHaveValue(1);
    expect(rowChoice(4)).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'الصفحة التالية' })); await visiblePage(3);
    await user.click(rowChoice(2, 'الثانية'));
    await user.click(screen.getByRole('button', { name: 'أضف إلى خطتي' }));
    expect(select).toHaveBeenCalledExactlyOnceWith({ surah: 2, fromAyah: 1, toAyah: 2 });
  });

  it('MUI22 row selection is unavailable after an image decode failure', async () => {
    const select = vi.fn(), user = userEvent.setup();
    render(<MushafReader10b {...defaults()} mushaf={await selectionFixture()} onSelectRange={select} />);
    await visiblePage(1); await openTools();
    fireEvent.error(screen.getByRole('img'));
    expect(rowChoice(1)).toBeDisabled(); expect(rowChoice(2)).toBeDisabled();
    await user.click(rowChoice(2));
    expect(select).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'أضف إلى خطتي' })).toBeDisabled();
  });

  it('MUI23 a pending save prevents another row edit or duplicate submission', async () => {
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const select = vi.fn(() => pending), user = userEvent.setup();
    render(<MushafReader10b {...defaults()} mushaf={await selectionFixture()} onSelectRange={select} />);
    await visiblePage(1); await openTools(); await user.click(rowChoice(1));
    const submit = screen.getByRole('button', { name: 'أضف إلى خطتي' });
    await user.click(submit);
    expect(rowChoice(2)).toBeDisabled(); expect(submit).toBeDisabled();
    await user.click(rowChoice(2)); await user.click(submit);
    expect(select).toHaveBeenCalledExactlyOnceWith({ surah: 1, fromAyah: 1, toAyah: 1 });
    await act(async () => { finish(); await pending; });
    expect(rowChoice(2)).toBeEnabled();
    await user.click(rowChoice(2));
    expect(screen.getByLabelText('من آية')).toHaveValue(2); expect(screen.getByLabelText('إلى آية')).toHaveValue(2);
  });

  it('MUI24 candidate review labels its status and displays exact SVG bytes only through an image Blob', async () => {
    const { mushaf, svg } = await candidateUiFixture();
    render(<MushafReader10b {...defaults()} mushaf={mushaf} onSelectRange={vi.fn()} />);
    const image = await screen.findByRole('img', { name: 'صفحة حفص من مصدر مرشح ١' }); await openTools();
    expect(image).toHaveAttribute('src', expect.stringMatching(/^blob:/));
    expect(screen.getByRole('heading', { name: 'مراجعة صفحات حفص' })).toBeVisible();
    expect(screen.getByText('معاينة مصدر مرشح — لم يُعتمد المصحف بعد.')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'مصحف المدينة النبوية' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'المصدر المثبّت' })).toHaveAttribute('href', mushaf.source.url);
    expect(document.querySelector('#candidate-unit-only')).toBeNull();
    const blob = createUrl.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('image/svg+xml');
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsText(blob);
    });
    expect(text).toBe(svg);
  });

  it('MUI25 candidate selection saves review intent without a learning start or plan-added claim', async () => {
    const { mushaf } = await candidateUiFixture(), select = vi.fn(), start = vi.fn(), props = defaults(), user = userEvent.setup();
    render(<MushafReader10b {...props} mushaf={mushaf} onSelectRange={select} onStart={start} />);
    await screen.findByRole('img', { name: 'صفحة حفص من مصدر مرشح ١' }); await openTools();
    expect(screen.queryByRole('button', { name: 'ابدأ نشاط خطة اليوم' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'أضف إلى خطتي' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'اختيار الآية ١ من سورة مرشح الاختبار' }));
    expect(select).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'احفظ مقدار المراجعة' }));
    expect(select).toHaveBeenCalledExactlyOnceWith({ surah: 1, fromAyah: 1, toAyah: 1 });
    expect(screen.getByText('حُفظ مقدار المراجعة. ربطه بجلسات القرآن ينتظر اعتماد النص والخرائط.')).toBeVisible();
    expect(screen.queryByText(/أُضيف المقدار إلى خطتك/)).not.toBeInTheDocument(); expect(start).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'خطة اليوم' })); expect(props.onToday).toHaveBeenCalledOnce();
  });

  it('MUI26 a forged candidate-review label cannot authorize page rendering', () => {
    const pageImage = vi.fn();
    render(<MushafReader10b {...defaults()} mushaf={{ kind: 'candidate-review', editionId: 'candidate-forged', pageImage } as unknown as VerifiedMushaf} />);
    expect(screen.getByRole('heading', { name: 'النص المعتمد ينتظر الإضافة' })).toBeVisible();
    expect(screen.queryByRole('img')).not.toBeInTheDocument(); expect(pageImage).not.toHaveBeenCalled(); expect(createUrl).not.toHaveBeenCalled();
  });
  it('MUI27 keeps the page primary and preserves a draft through one native disclosure', async () => {
    render(<MushafReader10b {...defaults()} mushaf={await selectionFixture()} onSelectRange={vi.fn()} />);
    await visiblePage(1);
    const summary = screen.getByText('اختيار المقدار وخيارات المصحف', { exact: true });
    expect(summary.closest('details')).not.toHaveAttribute('open');
    expect(screen.getByRole('combobox', { name: 'السورة' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'خطة اليوم' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'الجزء' })).not.toBeVisible();
    expect(screen.getByRole('button', { name: 'أضف إلى خطتي' })).not.toBeVisible();
    const user = userEvent.setup(); await user.click(summary);
    expect(summary.closest('details')).toHaveAttribute('open');
    expect(screen.getByRole('combobox', { name: 'الجزء' })).toBeVisible();
    await user.click(rowChoice(1)); await user.click(rowChoice(2));
    await user.click(summary); expect(summary.closest('details')).not.toHaveAttribute('open');
    await user.click(summary);
    expect(screen.getByLabelText('من آية')).toHaveValue(1); expect(screen.getByLabelText('إلى آية')).toHaveValue(2);
    expect(screen.getByRole('img')).toBeVisible();
  });

  it('MUI28 embedded reading keeps guards and navigation without another heading, return or target editor', async () => {
    const props = defaults(), select = vi.fn(), start = vi.fn(), mushaf = await selectionFixture();
    const view = render(<MushafReader10b {...props} mushaf={mushaf} embedded onSelectRange={select} onStart={start} secondaryActions={<button>خيار ثانوي</button>} />);
    await visiblePage(1);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByText('اختيار المقدار وخيارات المصحف')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'خطة اليوم' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'خيار ثانوي' })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'الصفحة التالية' })); await visiblePage(2);
    expect(select).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled();
    view.rerender(<MushafReader10b {...props} mushaf={mushaf} embedded readingBlocked onReveal={vi.fn()} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'أظهر المصحف وسجّل المساعدة' })).toBeVisible();
  });

  it('MUI29 saved selection remains readable with the options closed', async () => {
    const mushaf = await selectionFixture();
    render(<MushafReader10b {...defaults()} mushaf={mushaf} onSelectRange={vi.fn()} selection={{ editionId: mushaf.editionId, range: {surah: 1, fromAyah: 1, toAyah: 2}, unitIds: [] }} />);
    await visiblePage(1);
    expect(screen.getByText(/المقدار المحدد:.*من آية ١ إلى ٢/)).toBeVisible();
    expect(screen.getByText('اختيار المقدار وخيارات المصحف').closest('details')).not.toHaveAttribute('open');
  });

});
