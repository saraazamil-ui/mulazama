import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Card, Heading, Notice } from './components';
import { LearningJourney, type QuickObservation } from './application/journey06l3';
import type { Screen } from './catalog';
import type { ManualObservation } from './application/learning-ui-adapter';
import { currentRiyadhDate } from './domain/state';
import './JourneyScreen06l3.css';

// Each label still expresses every field required by the existing quick observation.
const choices: { id: QuickObservation; label: string }[] = [
  { id: 'clean-normal', label: 'سمّعت المقطع كاملًا بلا خطأ معلوم — جهد عادي' },
  { id: 'clean-hard', label: 'سمّعت المقطع كاملًا بلا خطأ معلوم — بصعوبة' },
  { id: 'clean-easy', label: 'سمّعت المقطع كاملًا بلا خطأ معلوم — بسهولة' },
  { id: 'memory-failure', label: 'لم أستطع إكماله من الذاكرة' },
  { id: 'unknown', label: 'لا أستطيع تحديد النتيجة' },
];
const date = (s: string) => new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium', timeZone: 'Asia/Riyadh', calendar: 'gregory' }).format(new Date(s));

export function JourneyScreen({ journey, screen, go, onCommitted, onOpenMushaf, renderReading, showPreviewNotice = true }: {
  journey: LearningJourney; screen: Screen; go: (screen: Screen) => void; onCommitted: () => void;
  onOpenMushaf?: (unitId: string) => void;
  renderReading?: (unitId: string) => ReactNode;
  showPreviewNotice?: boolean;
}) {
  const [view, setView] = useState(() => journey.view()), [error, setError] = useState(''), [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [passages, setPassages] = useState<string[]>([]), [correcting, setCorrecting] = useState(false);
  const lock = useRef(false), mounted = useRef(true), region = useRef<HTMLElement>(null);
  const focusHandoff = useRef<{ trigger: Element | null; from: string; cancelled: boolean } | null>(null);
  useEffect(() => {
    const preserveMovedFocus = (event: FocusEvent) => {
      const pending = focusHandoff.current;
      if (pending && event.target !== pending.trigger && event.target !== document.body) pending.cancelled = true;
    };
    document.addEventListener('focusin', preserveMovedFocus);
    return () => document.removeEventListener('focusin', preserveMovedFocus);
  }, []);
  const state = journey.state, session = journey.active, attempt = session?.attemptId ? state.attempts[session.attemptId] : null;
  const load = useCallback(async () => { const next = await journey.prepare(); if (mounted.current) setView(next); }, [journey]);
  useEffect(() => {
    mounted.current = true; let timer: ReturnType<typeof setTimeout>;
    const refresh = () => { if (document.visibilityState === 'visible') void load().catch(e => { if (mounted.current) setError(e.message); }); };
    const tick = () => { refresh(); const now = Date.now(), riyadhDay = 86400000; const untilMidnight = riyadhDay - ((now + 3 * 3600000) % riyadhDay) + 20; timer = setTimeout(tick, Math.min(60000, untilMidnight)); };
    tick(); window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { mounted.current = false; clearTimeout(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [load, screen]);
  const showText = !!session && (session.phase === 'training' || session.phase === 'assessment' || session.phase === 'recall' && !!attempt?.revealed);
  useEffect(() => {
    let live = true; setPassages([]);
    if (showText && session) void journey.text(session.unitId).then(text => { if (live) setPassages(text); }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [journey, showText, session?.unitId, session?.phase]);
  const run = async (action: () => Promise<unknown>, next?: Screen) => {
    if (lock.current) return; lock.current = true;
    if (!next) rememberPhaseFocus();
    setBusy(true); setError(''); setStatus('جارٍ حفظ خطوتك…');
    try {
      await action();
      // Inline phase changes no longer remount a route. Keep the same durable prepare
      // that previously ran on S08/S09 entry, without writing a new plan when unchanged.
      const nextView = await journey.prepare();
      if (mounted.current) { setView(nextView); setStatus('حُفظت خطوتك على هذا الجهاز.'); }
      onCommitted(); if (next && mounted.current) go(next);
    } catch (e) { if (mounted.current) { setError(e instanceof Error ? e.message : 'تعذر الحفظ. أعد المحاولة؛ لا نعرض إنجازًا غير محفوظ.'); setStatus('لم يُؤكد الحفظ.'); } }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const assess = async (choice: QuickObservation) => {
    if (!correcting) { await journey.quick(choice); return; }
    if (!attempt) return; const words = journey.unit(attempt.unitId).unit.words;
    const observation: ManualObservation = { attemptedWords: choice.startsWith('clean-') ? words : null, errors: choice.startsWith('clean-') ? 0 : null, completion: choice.startsWith('clean-') ? 'complete' : choice === 'memory-failure' ? 'partial' : 'unknown', effort: choice === 'clean-hard' ? 'hard' : choice === 'clean-normal' ? 'normal' : choice === 'clean-easy' ? 'easy' : 'unknown', gapVerified: false };
    await journey.action({ type: 'correct', attemptId: attempt.id, revision: attempt.revision, reason: 'تصحيح خيار سجلته خطأ في التقييم الذاتي', observation }); setCorrecting(false);
  };
  const start = async (review: boolean) => {
    const priorSession = journey.active;
    await journey.prepare(); const expected = journey.view().next, restoredSession = journey.active;
    const started = await journey.start();
    const planned = journey.state.plans.at(-1)?.tasks.find(task => task.unitId === started?.unitId);
    // This is the same explicit start → recall sequence as before. Do not skip
    // reading for a changed new task, or resume an existing session as a new recall.
    if (review && !priorSession && !restoredSession && expected && expected.kind !== 'new' && started?.unitId === expected.unitId && planned && planned.kind !== 'new' && started.phase === 'training')
      await journey.action({ type: 'recall', sessionId: started.id, attemptId: crypto.randomUUID() });
  };
  const resume = async () => {
    const active = journey.active;
    if (active?.phase === 'paused' && active.previousPhase !== 'recall') await journey.action({ type: 'resume', sessionId: active.id });
  };
  const home = screen === 'S05', progress = screen === 'S14';
  const configured = journey.app.product.state.config.configured;
  const completedToday = new Set(Object.values(state.sessions).filter(s => Object.values(state.attempts).some(a => a.sessionId === s.id && a.endedAt && a.assessment && a.termination !== 'technical_failure' && a.termination !== 'user_stop' && currentRiyadhDate(new Date(a.startedAt)) === view.day)).map(s => s.unitId));
  // These are display groups of the existing plan, never an alternate planning order.
  const planned = (state.plans.at(-1)?.tasks ?? []).filter(task => !completedToday.has(task.unitId) || !!state.units[task.unitId].dates?.policyDueAt && Date.parse(state.units[task.unitId].dates!.policyDueAt!) <= Date.now());
  const newCount = planned.filter(task => task.kind === 'new').length, reviewCount = planned.length - newCount;
  const nextNew = view.next?.kind === 'new';
  const newTask = nextNew ? view.next : planned.find(task => task.kind === 'new');
  const reviewTask = view.next && !nextNew ? view.next : planned.find(task => task.kind !== 'new');
  const resultSaved = session?.phase === 'assessment' && !!attempt?.assessment && !correcting;
  const showAssessment = (session?.phase === 'recall' && !journey.needsRestart) || (session?.phase === 'assessment' && !attempt?.assessment) || correcting;
  const phaseKey = `${screen}:${session?.id}:${session?.phase}:${journey.needsRestart}:${resultSaved}:${correcting}`;
  const rememberPhaseFocus = () => { focusHandoff.current = { trigger: document.activeElement, from: phaseKey, cancelled: false }; };
  useLayoutEffect(() => {
    const pending = focusHandoff.current;
    if (!pending || busy) return;
    focusHandoff.current = null;
    if (pending.from === phaseKey || pending.cancelled) return;
    // The triggering button can disappear. Do not steal focus if the user moved
    // to another control while persistence was pending; ordinary refreshes do nothing.
    if (document.activeElement === pending.trigger || document.activeElement === document.body && !pending.trigger?.isConnected)
      region.current?.querySelector<HTMLElement>('[data-phase-focus]')?.focus();
  }, [phaseKey, busy]);

  return <section ref={region} aria-label="رحلة الحفظ والمراجعة الذاتية" className="learning-journey">
    <Heading eyebrow="مُلازَمَة" title={home ? 'وردك اليوم' : progress ? 'تقدمي' : session ? 'جلسة التعاهد' : 'متابعة التعاهد'} description={home ? 'مقدارك واضح، وخطوتك التالية قريبة.' : progress ? 'من حفظك ومراجعتك المسجلين على هذا الجهاز.' : 'تسميعك وتقييمك ذاتيان؛ تسجيل النشاط لا يثبت الإتقان.'} />
    {showPreviewNotice && journey.kind === 'engineering' && <p className="journey-preview-note" role="note">تجربة بمواد صناعية غير قرآنية. الحفظ القرآني ينتظر اعتماد المحتوى.</p>}
    {error && <p role="alert">{error}</p>}
    <p className="journey-save-status" role="status" aria-live="polite">{status}</p>
    {home && <>
      {!configured ? <Card><h2>لنرتب وردك</h2><p>حدد هدفك ووقتك مرة واحدة، ثم نبدأ من خطتك المحفوظة.</p><Button onClick={() => go('S02')}>أعد خطتي</Button></Card> : <>
        {session && <Card className="journey-resume"><div><h2>نكمل من موضعك</h2><p>{journey.unit(session.unitId).title}</p><p>جلستك محفوظة. نكمل من آخر خطوة مؤكدة.</p></div><Button disabled={busy} onClick={() => run(resume, 'S07')}>استأنف جلستك</Button></Card>}
        <div className="daily-portions">
          <Card className="daily-portion"><span className="eyebrow">حفظ اليوم</span><h2>{newTask ? journey.unit(newTask.unitId).title : 'لا حفظ جديد الآن'}</h2>
            <p>{newTask ? newCount > 1 ? `في خطة اليوم ${newCount.toLocaleString('ar-SA')} مقادير للحفظ؛ نبدأ بهذا المقدار.` : 'مقدار الحفظ التالي من خطتك المحفوظة.' : view.next ? 'نبدأ بالمراجعة التي تحتاجها اليوم.' : 'ستظهر هنا خطوتك التالية حين تتاح في الخطة.'}</p>
            {!session && newTask && <><Button disabled={busy || !nextNew} onClick={() => run(() => start(false), 'S07')}>ابدأ الحفظ</Button>{!nextNew && <small>ابدأ بالمراجعة أولًا؛ يبقى مقدار الحفظ محفوظًا.</small>}</>}
          </Card>
          <Card className="daily-portion"><span className="eyebrow">مراجعة اليوم</span><h2>{reviewTask ? journey.unit(reviewTask.unitId).title : 'لا مراجعة مطلوبة الآن'}</h2>
            {reviewCount > 1 && <p>في خطة اليوم {reviewCount.toLocaleString('ar-SA')} مقادير للمراجعة؛ نبدأ بهذا المقدار.</p>}<p>{reviewTask ? reviewTask.kind === 'diagnostic' ? 'تسميع أول لمحفوظك المعلن' : reviewTask.kind === 'repair' ? 'تعاهد بعد تعثر سجلته' : 'مراجعة مستحقة' : 'مواعيد المراجعة التالية محفوظة في خطتك.'}</p>
            {!session && reviewTask && <><Button disabled={busy || !!nextNew} onClick={() => run(() => start(true), 'S07')}>ابدأ المراجعة</Button>{nextNew && <small>نتابع ترتيب خطتك الحالية.</small>}</>}
          </Card>
        </div>
        <div className="daily-completion" aria-label="إنجاز اليوم"><span>أنجزت اليوم: <strong>{view.completed}</strong> من {view.completed + view.remaining}</span><progress aria-label="إنجاز أنشطة اليوم" value={view.completed} max={Math.max(1, view.completed + view.remaining)} /><small>تسجيل نشاط، وليس إثبات إتقان.</small></div>
        {!session && !view.next && <Card><p>{view.completed ? 'أنجزت نشاط اليوم. موعد التعاهد التالي محفوظ.' : view.budget === 0 ? 'لا وقت مخصص لليوم.' : 'لا نشاط متاح ضمن الخطة الحالية.'}</p><Button variant="secondary" onClick={() => go('S02')}>{view.completed ? 'راجع خطتي' : 'عدّل هدفك ووقتك'}</Button></Card>}
      </>}
    </>}
    {progress && <Card><h2>من سجل تسميعك</h2><p>نتائج محفوظة: <output aria-label="عدد نتائج التسميع">{view.observations}</output></p><p>مواضع سُمّعت كاملة بلا خطأ معلوم وفق تقريرك الحالي: {view.successfulCoverage} — دون تكرار الموضع.</p><p>ثبات الحفظ: يحتاج إلى تسميعات إضافية لتقديره.</p><p>المحفوظ المعلن لا يتحول إلى إتقان مثبت.</p>{view.due.length > 0 && <><h3>التعاهد القادم</h3><ul>{view.due.map(d => <li key={d.unitId}>{journey.unit(d.unitId).title} — {date(d.at)}</li>)}</ul></>}{view.weak.length > 0 && <><h3>مواضع تعثرت فيها بحسب نتائجك</h3><ul>{view.weak.map(title => <li key={title}>{title}</li>)}</ul><p>هذا وصف لنتائج مسجلة، وليس حكمًا بضعف ثابت.</p></>}</Card>}
    {!home && !progress && <Card className="session-workspace">
      {!session ? <><p>لا توجد جلسة مفتوحة.</p><Button onClick={() => go('S05')}>إلى ورد اليوم</Button></> : <>
        <h2 tabIndex={-1} data-phase-focus={session.phase === 'training' ? '' : undefined}>{journey.unit(session.unitId).title}</h2>
        {session.phase === 'training' && <>
          {renderReading ? <div className="session-reading">{renderReading(session.unitId)}</div> : <div className="quran-session-text" aria-label={journey.kind === 'engineering' ? 'مادة الاختبار الصناعي' : 'النص القرآني المعتمد'}>{passages.map((text, i) => <p key={i}>{text}</p>)}</div>}
          <div className="session-primary-action"><p>اقرأ وثبّت المقدار، ثم سمّعه من الذاكرة لتسجيل النتيجة.</p><Button disabled={busy} onClick={() => run(() => journey.action({ type: 'recall', sessionId: session.id, attemptId: crypto.randomUUID() }))}>أنهيت الحفظ، أبدأ التسميع</Button></div>
        </>}
        {(session.phase === 'recall' || session.phase === 'paused' && session.previousPhase === 'recall') && journey.needsRestart && <><Notice>انقطع التسميع. نحتفظ بما سبق، وتحتاج إلى محاولة جديدة كي لا نفترض أنك أكملته.</Notice><Button data-phase-focus="" disabled={busy} onClick={() => run(() => journey.action({ type: 'restart', sessionId: session.id, attemptId: crypto.randomUUID() }))}>ابدأ محاولة جديدة بعد الانقطاع</Button></>}
        {session.phase === 'recall' && !journey.needsRestart && <><p>سمّع من الذاكرة، ثم اختر الوصف المطابق لما حدث.</p>{attempt?.revealed && <><Notice tone="warning">سُجل كشف النص، ولا يلغيه اختيار جهد سهل أو تصحيح الوصف.</Notice><div className="quran-session-text" aria-label={journey.kind === 'engineering' ? 'مادة الاختبار الصناعي' : 'النص القرآني المعتمد'}>{passages.map((text, i) => <p key={i}>{text}</p>)}</div></>}<Button disabled={busy} variant="ghost" onClick={() => run(() => journey.action({ type: 'hint', sessionId: session.id, reveal: true }))}>أظهر النص وسجّل المساعدة</Button></>}
        {showAssessment && <fieldset disabled={busy}><legend tabIndex={-1} data-phase-focus="">{correcting ? 'اختر النتيجة الصحيحة — يبقى الأصل في السجل' : 'كيف كان تسميعك؟ اختر نتيجة واحدة لحفظها'}</legend><div className="self-assessment-choices">{choices.map(c => <Button key={c.id} variant="secondary" onClick={() => run(() => assess(c.id))}>{c.label}</Button>)}</div></fieldset>}
        {resultSaved && <div className="session-result" role="group" aria-label="النتيجة المحفوظة"><h3 tabIndex={-1} data-phase-focus="">حُفظ تقييمك الذاتي</h3><p>{attempt!.assessment!.completion === 'complete' ? 'أبلغت عن تسميع كامل.' : attempt!.assessment!.completion === 'partial' ? 'أبلغت عن تسميع جزئي.' : 'اكتمال التسميع غير معلوم.'} المساعدة المسجلة: {attempt!.hints}.</p><p>حُفظ تقييمك الذاتي؛ تسجيل النشاط لا يثبت الإتقان.</p>{state.units[session.unitId].dates?.policyDueAt && <p>موعد المراجعة المسجل: {date(state.units[session.unitId].dates!.policyDueAt!)}.</p>}<Button disabled={busy} onClick={() => run(() => journey.finish(), 'S05')}>العودة إلى اليوم</Button></div>}
        {session.phase === 'paused' && session.previousPhase !== 'recall' && <Button data-phase-focus="" disabled={busy} onClick={() => run(() => journey.action({ type: 'resume', sessionId: session.id }))}>استأنف من الخطوة المحفوظة</Button>}
        <details className="session-options"><summary>خيارات الجلسة</summary><div className="actions">
          {session.phase === 'training' && <><p>التكرارات التي أكّدتها: {session.repetitions}</p><Button disabled={busy} variant="secondary" onClick={() => run(() => journey.action({ type: 'repeat', sessionId: session.id, mode: 'reading' }))}>أنهيت تكرارًا</Button></>}
          {resultSaved && <Button variant="secondary" disabled={busy} onClick={() => { rememberPhaseFocus(); setCorrecting(true); }}>صحّح النتيجة</Button>}
          {correcting && <Button variant="secondary" disabled={busy} onClick={() => { rememberPhaseFocus(); setCorrecting(false); }}>إلغاء التصحيح</Button>}
          {onOpenMushaf && session.phase !== 'training' && <Button variant="secondary" disabled={busy} onClick={() => onOpenMushaf(session.unitId)}>افتح موضع الجلسة في المصحف</Button>}
          {session.phase !== 'paused' && <Button variant="ghost" disabled={busy} onClick={() => run(() => journey.action({ type: 'pause', sessionId: session.id }))}>أوقف مؤقتًا</Button>}
          {!resultSaved && <Button variant="ghost" disabled={busy} onClick={() => run(() => journey.finish(), 'S05')}>أنهِ الجلسة</Button>}
        </div></details>
      </>}
    </Card>}
  </section>;
}
