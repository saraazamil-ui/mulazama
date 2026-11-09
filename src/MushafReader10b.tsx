import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode, TouchEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button, Card, Field, Heading, Notice } from './components';
import { requireVerifiedMushaf, type VerifiedMushaf } from './mushaf/model';
import type { StudyRange, StudySelection } from './application/mushaf-study10b';
import './MushafReader10b.css';

export interface MushafReader10bProps {
  mushaf: VerifiedMushaf | null;
  databaseName: string;
  requestedPage?: number;
  fallbackPage?: number;
  selection?: StudySelection | null;
  onSelectRange?: (range: StudyRange) => Promise<void> | void;
  onStart?: () => Promise<void> | void;
  onToday: () => void;
  readingBlocked?: boolean;
  onReveal?: () => Promise<void>;
  revealUnavailable?: boolean;
  onResume?: () => void;
  unavailableReason?: string;
  checkingSession?: boolean;
  beforeRead?: () => Promise<void>;
  onPageShown?: (page: number) => void;
  embedded?: boolean;
  secondaryActions?: ReactNode;
}

const number = (value: number) => value.toLocaleString('ar-SA');
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'تعذر إتمام الطلب. حاول مرة أخرى.';
const validPage = (mushaf: VerifiedMushaf, page: unknown): page is number =>
  typeof page === 'number' && Number.isSafeInteger(page) && mushaf.pages.some(item => item.number === page);

export function readerBookmarkKey(databaseName: string, mushaf: Pick<VerifiedMushaf, 'editionId' | 'layoutId'>) {
  return ['mulazama-reader-location-v1', databaseName, mushaf.editionId, mushaf.layoutId].map(encodeURIComponent).join(':');
}

function initialLocation(mushaf: VerifiedMushaf, databaseName: string, requestedPage?: number, fallbackPage?: number) {
  const fallback = validPage(mushaf, requestedPage) ? requestedPage : validPage(mushaf, fallbackPage) ? fallbackPage : mushaf.pages[0].number;
  if (validPage(mushaf, requestedPage)) return { page: fallback, error: '' };
  try {
    const raw = localStorage.getItem(readerBookmarkKey(databaseName, mushaf));
    if (!raw) return { page: fallback, error: '' };
    const saved: unknown = JSON.parse(raw);
    if (saved && typeof saved === 'object' && 'version' in saved && saved.version === 1 &&
      'editionId' in saved && saved.editionId === mushaf.editionId && 'layoutId' in saved && saved.layoutId === mushaf.layoutId &&
      'page' in saved && validPage(mushaf, saved.page)) return { page: saved.page, error: '' };
  } catch (error) {
    // A malformed bookmark is not learner history and must not prevent reading.
    if (!(error instanceof SyntaxError)) return { page: fallback, error: 'تعذر قراءة آخر موضع محفوظ. يمكنك التصفح، لكن حفظ الموضع قد لا يكون متاحًا.' };
  }
  return { page: fallback, error: '' };
}

/** The only renderable reader input is a verified capability, never a user-supplied object. */
export function MushafReader10b(props: MushafReader10bProps) {
  const [revealError, setRevealError] = useState('');
  const [revealing, setRevealing] = useState(false);
  const revealLock = useRef(false);
  let verified = props.mushaf;
  try { if (verified) requireVerifiedMushaf(verified); } catch { verified = null; }
  if (!verified) return <section className="mushaf-reader" aria-label="قارئ المصحف" dir="rtl">
    {!props.embedded && <Heading eyebrow="مُلازَمَة" title="المصحف" description="رفيق رحلتك مع القرآن" />}
    <Card>
      <h2>النص المعتمد ينتظر الإضافة</h2>
      <p>لم تُتح حزمة مصحف المدينة المتحقق منها بعد. سيظهر المصحف هنا بعد التحقق من صفحات المجمع وبيانات الآيات وحقوق استخدامها.</p>
      {props.unavailableReason && <p role="alert">{props.unavailableReason}</p>}
      <p>لم يُعرض نص قرآني بديل، واختياراتك وسجلك السابق محفوظان.</p>
      {!props.embedded && <Button onClick={props.onToday}>العودة إلى خطة اليوم</Button>}
    </Card>
  </section>;
  if (props.checkingSession) return <section className="mushaf-reader" aria-label="قارئ المصحف" dir="rtl">
    {!props.embedded && <Heading eyebrow="مُلازَمَة" title="المصحف" />}
    {props.unavailableReason ? <Card>
      <p role="alert">{props.unavailableReason}</p>
      {!props.embedded && <Button onClick={props.onToday}>العودة إلى خطة اليوم</Button>}
    </Card> : <p role="status">جارٍ التحقق من الجلسة المحفوظة…</p>}
  </section>;
  if (props.readingBlocked) return <section className="mushaf-reader" aria-label="قارئ المصحف" dir="rtl">
    {!props.embedded && <Heading eyebrow="مُلازَمَة" title="المصحف أثناء التسميع" />}
    <Card>
      <Notice tone="warning">أنت في محاولة تسميع. فتح المصحف يكشف النص ويُسجّل مساعدة في المحاولة الحالية.</Notice>
      {revealError && <p role="alert">{revealError}</p>}
      {props.revealUnavailable ? <>
        <p>استأنف جلستك وابدأ محاولة جديدة قبل كشف المصحف.</p>
        <Button onClick={props.onResume ?? props.onToday}>العودة إلى الجلسة</Button>
      </> : <Button disabled={revealing || !props.onReveal} onClick={async () => {
        if (revealLock.current || !props.onReveal) return;
        revealLock.current = true; setRevealing(true); setRevealError('');
        try { await props.onReveal(); } catch (error) { setRevealError(errorMessage(error)); }
        finally { revealLock.current = false; setRevealing(false); }
      }}>{revealing ? 'جارٍ حفظ المساعدة…' : 'أظهر المصحف وسجّل المساعدة'}</Button>}
    </Card>
  </section>;
  return <ReadyReader key={[props.databaseName, verified.editionId, verified.layoutId, verified.version].join(':')}
    {...props} mushaf={verified} />;
}

type NavigationAnchor = { page: number; surah: number; fromAyah: number; juz?: number };

function ReadyReader({ mushaf, databaseName, requestedPage, fallbackPage, selection, onSelectRange, onStart, onToday, beforeRead, unavailableReason, onPageShown, embedded = false, secondaryActions }: MushafReader10bProps & { mushaf: VerifiedMushaf }) {
  const candidateReview = mushaf.kind === 'candidate-review';
  const saveRangeLabel = candidateReview ? 'احفظ مقدار المراجعة' : 'أضف إلى خطتي';
  // A full verified verse map is large; capture its readonly snapshots once per capability.
  const { pages, verses, surahs, juzStarts, source } = useMemo(() => ({
    pages: mushaf.pages, verses: mushaf.verses, surahs: mushaf.surahs, juzStarts: mushaf.juzStarts, source: mushaf.source,
  }), [mushaf]);
  const [initial] = useState(() => initialLocation(mushaf, databaseName, requestedPage, fallbackPage));
  const [page, setPage] = useState(initial.page);
  const [pageDraft, setPageDraft] = useState(String(initial.page));
  const [bookmarkError, setBookmarkError] = useState(initial.error);
  const [image, setImage] = useState<{ page: number; url: string; error: string }>({ page, url: '', error: '' });
  const [retry, setRetry] = useState(0);
  const [actionError, setActionError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const actionLock = useRef(false);
  const mounted = useRef(true);
  const gesture = useRef<{ x: number; y: number } | null>(null);
  const navigationAnchor = useRef<NavigationAnchor | null>(null);
  const pageData = pages.find(item => item.number === page)!;
  const pageVerses = useMemo(() => verses.filter(verse => verse.startPage <= page && verse.endPage >= page), [verses, page]);
  const pageSurah = pageVerses[0]?.surah ?? surahs[0].number;
  const [surah, setSurah] = useState(pageSurah);
  const [juz, setJuz] = useState(pageData.juz);
  const [fromAyah, setFromAyah] = useState(String(pageVerses[0]?.ayah ?? 1));
  const [toAyah, setToAyah] = useState(String(pageVerses.filter(verse => verse.surah === pageSurah).at(-1)?.ayah ?? 1));
  const [rangeStart, setRangeStart] = useState<{ surah: number; ayah: number } | null>(null);
  // A clicked draft may span pages. It is still only UI intent until the explicit save action.
  const rowRange = useRef<StudyRange | null>(null);
  const activeSurah = surahs.find(item => item.number === surah)!;
  const currentIndex = pages.findIndex(item => item.number === page);
  const pageFailed = image.page === page && !!image.error;
  const imageUrl = image.page === page ? image.url : '';

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (validPage(mushaf, requestedPage)) {
      navigationAnchor.current = null; rowRange.current = null; setRangeStart(null); setPage(requestedPage);
    }
  }, [mushaf, requestedPage]);
  useEffect(() => {
    setPageDraft(String(page));
    applyPageMetadata(page, navigationAnchor.current?.page === page ? navigationAnchor.current : null);
  }, [mushaf, page]);
  useEffect(() => {
    const controller = new AbortController(); let live = true; let objectUrl = ''; let phase: 'session' | 'image' = 'session';
    setImage({ page, url: '', error: '' });
    void (async () => {
      await beforeRead?.();
      if (!live || controller.signal.aborted) return;
      phase = 'image';
      const blob = await mushaf.pageImage(page, controller.signal);
      // Another tab can start recall while image I/O is pending. Recheck before any image reaches the DOM.
      phase = 'session';
      await beforeRead?.();
      if (!live || controller.signal.aborted) return;
      phase = 'image';
      objectUrl = URL.createObjectURL(blob);
      setImage({ page, url: objectUrl, error: '' });
      // Only adjacent verified files are warmed; no whole-Mushaf download is triggered.
      const index = pages.findIndex(item => item.number === page);
      for (const adjacent of [pages[index - 1], pages[index + 1]]) {
        if (adjacent) void mushaf.pageImage(adjacent.number, controller.signal).catch(() => undefined);
      }
    })().catch(() => {
      if (live && !controller.signal.aborted) setImage({ page, url: '', error: phase === 'session'
        ? 'تعذر تأكيد حالة الجلسة المحفوظة. أعد المحاولة قبل فتح المصحف.'
        : 'تعذر التحقق من صفحة المصحف أو تحميلها. لم نعرض صفحة بديلة.' });
    });
    return () => { live = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [mushaf, page, retry, beforeRead]);

  function applyPageMetadata(target: number, anchor: NavigationAnchor | null) {
    if (rowRange.current && !anchor) {
      setJuz(pages.find(item => item.number === target)!.juz);
      return;
    }
    const onPage = verses.filter(verse => verse.startPage <= target && verse.endPage >= target);
    const chosenSurah = anchor?.surah ?? onPage[0]?.surah;
    const selected = onPage.filter(verse => verse.surah === chosenSurah);
    if (selected.length) {
      setSurah(chosenSurah!);
      setFromAyah(String(anchor?.fromAyah ?? selected[0].ayah));
      setToAyah(String(selected.at(-1)!.ayah));
    }
    setJuz(anchor?.juz ?? pages.find(item => item.number === target)!.juz);
  }
  function navigate(target: number, anchor: NavigationAnchor | null = null) {
    if (pageFailed || !validPage(mushaf, target)) return;
    if (anchor) { rowRange.current = null; setRangeStart(null); }
    navigationAnchor.current = anchor;
    setActionError('');
    // Surah or juz starts can share the already displayed page, so no page effect will run.
    if (target === page) applyPageMetadata(target, anchor);
    setPage(target);
  }
  function move(delta: number) {
    const target = pages[currentIndex + delta];
    if (target) navigate(target.number);
  }
  function saveLocation() {
    try {
      localStorage.setItem(readerBookmarkKey(databaseName, mushaf), JSON.stringify({ version: 1, editionId: mushaf.editionId, layoutId: mushaf.layoutId, page }));
      setBookmarkError('');
    } catch { setBookmarkError('تعذر حفظ آخر موضع على هذا الجهاز. يمكنك متابعة القراءة.'); }
    onPageShown?.(page);
  }
  async function run(action: () => Promise<void> | void, success: string) {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true); setActionError(''); setStatus('');
    try { await action(); if (mounted.current) setStatus(success); }
    catch (error) { if (mounted.current) setActionError(errorMessage(error)); }
    finally { actionLock.current = false; if (mounted.current) setBusy(false); }
  }
  function chooseRange(event: FormEvent) {
    event.preventDefault();
    const from = Number(fromAyah), to = Number(toAyah);
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 1 || to < from || to > activeSurah.ayahCount) {
      setActionError('اختر بداية ونهاية صحيحتين من آيات السورة.'); return;
    }
    if (onSelectRange) void run(async () => {
      await onSelectRange({ surah, fromAyah: from, toAyah: to });
      if (mounted.current) setRangeStart(null);
    }, candidateReview ? 'حُفظ مقدار المراجعة. ربطه بجلسات القرآن ينتظر اعتماد النص والخرائط.' : 'أُضيف المقدار إلى خطتك. الاختيار وحده لا يُسجّل إنجازًا.');
  }
  function choosePageVerse(verse: VerifiedMushaf['verses'][number]) {
    if (busy || pageFailed || !imageUrl) return;
    const completing = rangeStart?.surah === verse.surah;
    const from = completing ? Math.min(rangeStart.ayah, verse.ayah) : verse.ayah;
    const to = completing ? Math.max(rangeStart.ayah, verse.ayah) : verse.ayah;
    rowRange.current = { surah: verse.surah, fromAyah: from, toAyah: to };
    setSurah(verse.surah); setFromAyah(String(from)); setToAyah(String(to));
    setRangeStart(completing ? null : { surah: verse.surah, ayah: verse.ayah });
    setActionError(''); setStatus('');
  }
  function editRange(setValue: (value: string) => void, value: string) {
    rowRange.current = null; setRangeStart(null); setValue(value); setStatus('');
  }
  function endGesture(event: TouchEvent) {
    const start = gesture.current, end = event.changedTouches[0]; gesture.current = null;
    if (!start || !end || pageFailed) return;
    const dx = end.clientX - start.x, dy = end.clientY - start.y;
    if (Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && Math.abs(dy) < 60) move(dx > 0 ? 1 : -1);
  }

  const canSelect = !!onSelectRange && !embedded;
  return <section className={`mushaf-reader${candidateReview ? ' mushaf-candidate-review' : ''}${embedded ? ' mushaf-reader-embedded' : ''}`} aria-label="قارئ المصحف" dir="rtl">
    {!embedded && <div className="mushaf-heading-row">
      <Heading eyebrow="مُلازَمَة" title={candidateReview ? 'مراجعة صفحات حفص' : mushaf.kind === 'engineering' ? 'تجربة قارئ المصحف' : 'مصحف المدينة النبوية'} />
      <Button variant="ghost" onClick={onToday}>خطة اليوم</Button>
    </div>}
    {mushaf.kind === 'engineering' && !embedded && <Notice tone="warning"><strong>تجربة القارئ — بيانات صناعية غير قرآنية.</strong></Notice>}
    {candidateReview && <Notice tone="warning"><strong>معاينة مصدر مرشح — لم يُعتمد المصحف بعد.</strong> للتصفح والمراجعة فقط؛ جلسات القرآن تنتظر الاعتماد.</Notice>}
    {unavailableReason && <p role="alert">{unavailableReason}</p>}
    {actionError && <p role="alert">{actionError}</p>}
    {bookmarkError && <p role="alert">{bookmarkError}</p>}
    <div className="mushaf-reading-toolbar">
      {!embedded && <Field label="السورة"><select disabled={pageFailed} value={surah} onChange={event => {
        const next = surahs.find(item => item.number === Number(event.target.value));
        if (next) navigate(next.startPage, { page: next.startPage, surah: next.number, fromAyah: 1, juz: verses.find(verse => verse.surah === next.number && verse.ayah === 1)?.juz });
      }}>{surahs.map(item => <option key={item.number} value={item.number}>{item.name}</option>)}</select></Field>}
      <div className="mushaf-page-turns">
        <Button variant="secondary" disabled={currentIndex === 0 || pageFailed} onClick={() => move(-1)}><ChevronLeft size={18} aria-hidden="true" /><span>الصفحة السابقة</span></Button>
        <output aria-live="polite" aria-label="الصفحة الحالية">صفحة {number(page)} من {number(pages.length)}</output>
        <Button variant="secondary" disabled={currentIndex === pages.length - 1 || pageFailed} onClick={() => move(1)}><span>الصفحة التالية</span><ChevronRight size={18} aria-hidden="true" /></Button>
      </div>
    </div>
    <div className="mushaf-page-stage" role="group" aria-label="صفحات المصحف" tabIndex={0} aria-keyshortcuts="ArrowRight ArrowLeft"
      onKeyDown={event => { if (event.target !== event.currentTarget) return; if (event.key === 'ArrowRight') { event.preventDefault(); move(1); } if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); } }}
      onTouchStart={event => { const touch = event.touches[0]; gesture.current = event.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY } : null; }}
      onTouchEnd={endGesture} onTouchCancel={() => { gesture.current = null; }}>
      {pageFailed ? <div className="mushaf-page-message"><p role="alert">{image.error}</p><Button onClick={() => setRetry(value => value + 1)}>أعد تحميل الصفحة</Button></div>
        : imageUrl ? <img key={imageUrl} src={imageUrl} alt={`${candidateReview ? 'صفحة حفص من مصدر مرشح' : mushaf.kind === 'engineering' ? 'صفحة اختبار صناعية' : 'صفحة مصحف المدينة'} ${number(page)}`}
          width={pageData.asset.width} height={pageData.asset.height} decoding="async" onLoad={saveLocation}
          onError={() => setImage({ page, url: '', error: 'تعذر عرض ملف الصفحة. أعد تحميله؛ لا نعرض بديلًا غير متحقق.' })} />
          : <p role="status" className="mushaf-page-message">{candidateReview ? 'جارٍ تحميل صفحة المصدر المرشح…' : 'جارٍ تحميل الصفحة المتحقق منها…'}</p>}
    </div>
    {!embedded && <>
      <div className="mushaf-page-summary"><span>آخر موضع يُحفظ تلقائيًا على هذا الجهاز</span></div>
      {selection?.editionId === mushaf.editionId && <p className="mushaf-saved-selection">{candidateReview ? 'مقدار المراجعة المحدد' : 'المقدار المحدد'}: {surahs.find(item => item.number === selection.range.surah)?.name}، من آية {number(selection.range.fromAyah)} إلى {number(selection.range.toAyah)}.</p>}
      <p className="mushaf-save-status" role="status" aria-live="polite">{status}</p>
      <details className="mushaf-tools">
        <summary>اختيار المقدار وخيارات المصحف</summary>
        <div className="mushaf-tools-content">
          <fieldset disabled={pageFailed} className="mushaf-navigation-fields">
            <legend>انتقل إلى موضع</legend>
            <Field label="الجزء"><select value={juz} onChange={event => {
              const next = juzStarts.find(item => item.number === Number(event.target.value));
              if (next) navigate(next.page, { page: next.page, surah: next.surah, fromAyah: next.ayah, juz: next.number });
            }}>{juzStarts.map(item => <option key={item.number} value={item.number}>الجزء {number(item.number)}</option>)}</select></Field>
            <form className="mushaf-page-jump" onSubmit={event => {
              event.preventDefault(); const next = Number(pageDraft);
              if (!validPage(mushaf, next)) { setActionError('رقم الصفحة غير موجود في هذه الطبعة.'); return; }
              navigate(next);
            }}><Field label="رقم الصفحة"><input type="number" inputMode="numeric" min={pages[0].number} max={pages.at(-1)!.number}
              value={pageDraft} onChange={event => setPageDraft(event.target.value)} /></Field><Button type="submit" variant="secondary">انتقل</Button></form>
          </fieldset>
          {canSelect && <>
            <div className="mushaf-page-picker" role="group" aria-label="اختيار مقدار من الصفحة">
              <div className="mushaf-picker-heading"><h2>{mushaf.kind === 'engineering' ? 'اختر سطور التجربة' : 'اختر آيات الصفحة'}</h2>
                <p>اختر البداية، ثم النهاية. يمكنك إكمال المقدار في صفحة أخرى من السورة نفسها.</p></div>
              <div className="mushaf-verse-buttons">{pageVerses.map(verse => {
                const label = mushaf.kind === 'engineering' ? 'السطر التجريبي' : 'الآية';
                const name = surahs.find(item => item.number === verse.surah)!.name;
                const selected = verse.surah === surah && verse.ayah >= Number(fromAyah) && verse.ayah <= Number(toAyah);
                return <button type="button" key={`${verse.surah}:${verse.ayah}`} className="mushaf-verse-choice"
                  aria-label={`اختيار ${label} ${number(verse.ayah)} من ${name}`} aria-pressed={selected}
                  disabled={busy || pageFailed || !imageUrl} onClick={() => choosePageVerse(verse)}>
                  <span className="mushaf-verse-number" aria-hidden="true">{number(verse.ayah)}</span>
                  <span><strong>{label} {number(verse.ayah)}</strong><small>{name}</small></span>
                  {selected && <span className="mushaf-verse-selected" aria-hidden="true">محدد</span>}
                </button>;
              })}</div>
              <p className="mushaf-range-hint" role="status">{rangeStart
                ? `حُددت البداية عند ${mushaf.kind === 'engineering' ? 'السطر التجريبي' : 'الآية'} ${number(rangeStart.ayah)}. اختر النهاية، أو احفظ هذا الموضع وحده${candidateReview ? ' للمراجعة' : ' في خطتك'}.`
                : `اضغط «${saveRangeLabel}» لتأكيد المقدار.`}</p>
            </div>
            <div className="mushaf-selection">
              <h2>{candidateReview ? 'مقدار مراجعة المصدر' : 'مقدار الحفظ'}</h2>
              <p>{activeSurah.name} — {candidateReview ? 'للمراجعة فقط؛ لا يغيّر خطة الحفظ أو سجل التعلم.' : 'اختيار المقدار لا يعني حفظه أو إتقانه.'}</p>
              <form onSubmit={chooseRange}>
                <fieldset disabled={busy || pageFailed} className="mushaf-selection-fields"><legend className="sr-only">اختر الآيات</legend>
                  <Field label="من آية"><input type="number" inputMode="numeric" min="1" max={activeSurah.ayahCount} value={fromAyah} onChange={event => editRange(setFromAyah, event.target.value)} /></Field>
                  <Field label="إلى آية"><input type="number" inputMode="numeric" min="1" max={activeSurah.ayahCount} value={toAyah} onChange={event => editRange(setToAyah, event.target.value)} /></Field>
                  <Button type="submit">{saveRangeLabel}</Button>
                </fieldset>
              </form>
            </div>
          </>}
          {onStart && !candidateReview && <Button disabled={busy || pageFailed} onClick={() => { void run(onStart, ''); }}>ابدأ نشاط خطة اليوم</Button>}
          <p className="mushaf-source">{source.attribution} {(mushaf.kind === 'approved' || candidateReview) && <a href={source.url} target="_blank" rel="noreferrer">{candidateReview ? 'المصدر المثبّت' : 'المصدر'}</a>}</p>
          {secondaryActions && <div className="mushaf-secondary-actions">{secondaryActions}</div>}
        </div>
      </details>
    </>}
  </section>;
}
