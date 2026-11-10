import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, Heading, Notice } from './components';
import { LearningJourney, type QuickObservation } from './application/journey06l3';
import type { Screen } from './catalog';
import type { ManualObservation } from './application/learning-ui-adapter';
import './JourneyScreen06l3.css';

const choices: {id: QuickObservation; label: string}[] = [
  {id: 'clean-normal', label: 'كامل بلا خطأ معلوم — بجهد عادي'},
  {id: 'clean-hard', label: 'كامل بلا خطأ معلوم — بصعوبة'},
  {id: 'clean-easy', label: 'كامل بلا خطأ معلوم — بسهولة'},
  {id: 'memory-failure', label: 'لم أستطع إكماله من الذاكرة'},
  {id: 'unknown', label: 'لا أستطيع تحديد النتيجة'},
];
const date = (at: string) => new Intl.DateTimeFormat('ar-SA', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Riyadh', calendar: 'gregory',
}).format(new Date(at));

function Passage({journey, unitId}: {journey: LearningJourney; unitId: string}) {
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    journey.text(unitId).then(text => { if (live) setLines(text); })
      .catch(cause => { if (live) setError(cause.message); });
    return () => { live = false; };
  }, [journey, unitId]);
  if (error) return <p role="alert">{error}</p>;
  return <div className="quran-session-text" aria-label={journey.kind === 'engineering' ? 'مادة الاختبار الصناعي' : 'النص القرآني المعتمد'}>
    {lines.map((line, i) => <p key={i}>{line}</p>)}
  </div>;
}

function AssessmentChoices({correcting = false, busy, choose}: {
  correcting?: boolean; busy: boolean; choose: (choice: QuickObservation) => void;
}) {
  return <fieldset disabled={busy}>
    <legend>{correcting ? 'اختر التصحيح الذي يصف تسميعك' : 'بعد التسميع، كيف كانت محاولتك؟'}</legend>
    <div className="self-assessment-choices">
      {choices.map(c => <Button key={c.id} variant="secondary" onClick={() => choose(c.id)}>{c.label}</Button>)}
    </div>
  </fieldset>;
}

export function JourneyScreen({journey, screen, go, onCommitted}: {
  journey: LearningJourney; screen: Screen; go: (screen: Screen) => void; onCommitted: () => void;
}) {
  const [view, setView] = useState(() => journey.view());
  const [planReady, setPlanReady] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [hiddenAttempt, setHiddenAttempt] = useState<string | null>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  const home = screen === 'S05', progress = screen === 'S14';
  const session = view.active;
  const attempt = session?.attemptId ? journey.state.attempts[session.attemptId] : null;
  const interrupted = (session?.phase === 'recall' || (session?.phase === 'paused' && session.previousPhase === 'recall')) && journey.needsRestart;
  const recall = session?.phase === 'recall' && !interrupted;
  const revealed = recall && !!attempt?.revealed && hiddenAttempt !== attempt.id;
  const showText = session?.phase === 'training' || session?.phase === 'assessment' || revealed;

  const load = useCallback(async () => {
    try {
      const next = await journey.prepare();
      if (mounted.current) { setView(next); setPlanReady(true); }
    } catch (cause) {
      if (mounted.current) {
        setPlanReady(false);
        setError(cause instanceof Error ? cause.message : 'تعذر تحميل خطة اليوم.');
      }
    }
  }, [journey]);

  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => { if (!lock.current && document.visibilityState === 'visible') void load(); };
    const tick = () => {
      refresh();
      const dayMs = 86400000, untilMidnight = dayMs - ((Date.now() + 3 * 3600000) % dayMs) + 20;
      timer = setTimeout(tick, Math.min(60000, untilMidnight));
    };
    tick();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      mounted.current = false;
      clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load]);

  const run = async (action: () => Promise<unknown>, confirmed: string) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true); setError(''); setStatus('جارٍ تأكيد الحفظ…');
    try {
      await action();
      if (mounted.current) { setView(journey.view()); setStatus(confirmed); }
      onCommitted();
    } catch (cause) {
      // An earlier command in a multi-step action may already be durable.
      if (mounted.current) {
        setView(journey.view()); setStatus('');
        setError(cause instanceof Error ? cause.message : 'تعذر تأكيد الحفظ. أعد المحاولة.');
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const prepareNext = async () => {
    setPlanReady(false);
    await journey.prepare();
    if (mounted.current) {
      setPlanReady(true);
      if (!home) go('S05');
    }
  };
  const finish = async () => {
    if (!session) return;
    await journey.action({type: 'end', sessionId: session.id});
    await prepareNext();
  };
  const submit = (choice: QuickObservation) => run(async () => {
    await journey.quick(choice);
    await finish();
  }, 'حُفظ تقييمك الذاتي.');
  const result = attempt?.assessment ? attempt : view.lastResult;
  const correct = (choice: QuickObservation) => run(async () => {
    if (!result) return;
    const clean = choice.startsWith('clean-');
    const observation: ManualObservation = {
      attemptedWords: clean ? journey.unit(result.unitId).unit.words : null, errors: clean ? 0 : null,
      completion: clean ? 'complete' : choice === 'memory-failure' ? 'partial' : 'unknown',
      effort: choice === 'clean-hard' ? 'hard' : choice === 'clean-normal' ? 'normal' : choice === 'clean-easy' ? 'easy' : 'unknown',
      gapVerified: false,
    };
    await journey.action({type: 'correct', attemptId: result.id, revision: result.revision,
      reason: 'تصحيح خيار سجلته خطأ في التقييم الذاتي', observation});
    setCorrectingId(null);
    await prepareNext();
  }, 'حُفظ تصحيحك.');
  const next = view.next, nextReview = view.due[0];
  const nextLabel = next?.kind === 'new' ? 'حفظ جديد' : next?.kind === 'diagnostic' ? 'تسميع أول لمحفوظك المعلن'
    : next?.kind === 'repair' ? 'تعاهد بعد تعثر سجلته' : 'مراجعة مستحقة';

  return <section className="learning-journey" dir="rtl" aria-label="رحلة الحفظ والمراجعة الذاتية">
    <Heading eyebrow="مُلازَمَة" title={home ? 'وردي اليوم' : progress ? 'تقدمي' : 'جلسة التعاهد'} />
    {journey.kind === 'engineering' && <Notice tone="warning">اختبار هندسي معزول بمواد تدريب غير قرآنية.</Notice>}
    {error && <p role="alert">{error}</p>}
    <p className="journey-status" role="status">{status}</p>
    {!planReady && <p>{error
      ? <Button variant="secondary" disabled={busy} onClick={() => { setError(''); void load(); }}>أعد تحميل الخطة</Button>
      : 'جارٍ تحميل خطة اليوم…'}</p>}

    {home && planReady && <Card>
      <dl className="daily-counts">
        <div><dt>حفظ جديد مقرر</dt><dd>{view.plannedNew}</dd></div>
        <div><dt>مراجعة مستحقة</dt><dd>{view.dueReviews}</dd></div>
        <div><dt id="completed-today">أنشطة أُنجزت اليوم</dt><dd aria-labelledby="completed-today">{view.completed}</dd></div>
        <div><dt>أنشطة متبقية</dt><dd>{view.remaining}</dd></div>
      </dl>
      {!session && (next ? <div className="daily-next">
        <p>{nextLabel}</p><h2>{journey.unit(next.unitId).title}</h2>
        <Button disabled={busy} onClick={() => run(() => journey.start(), '')}>{view.completed ? 'أكمل وردي' : 'ابدأ وردي'}</Button>
      </div> : <div className="daily-next">
        <h2>{view.completed ? 'أنجزت ورد اليوم' : view.budget === 0 ? 'لا وقت مخصص لليوم' : 'لا نشاط متاح ضمن خطة اليوم'}</h2>
        {view.deferred > 0 && <p>أنشطة مؤجلة بحسب الخطة: {view.deferred}</p>}
        {!view.completed && <Button variant="secondary" onClick={() => go('S02')}>عدّل هدفك ووقتك</Button>}
      </div>)}
    </Card>}

    {!progress && planReady && session && <Card className="journey-session">
      <h2>{journey.unit(session.unitId).title}</h2>
      {showText && <Passage key={session.unitId} journey={journey} unitId={session.unitId} />}
      {session.phase === 'training' && <div className="repetition-counter" aria-label="عداد تكرار الحفظ">
        <p className="repetition-counter-label">التكرارات المحفوظة</p>
        <output className="repetition-counter-value" aria-label="عدد التكرارات المحفوظة">{session.repetitions.toLocaleString('ar-SA')}</output>
        <div className="actions">
          <Button disabled={busy} onClick={() => run(() => journey.action({type: 'repeat', sessionId: session.id, mode: 'reading'}), 'حُفظ التكرار.')}>+ أنهيت تكرارًا</Button>
          <Button disabled={busy} variant="secondary" onClick={() => run(() => journey.action({type: 'recall', sessionId: session.id, attemptId: crypto.randomUUID()}), '')}>جاهز للتسميع</Button>
        </div>
      </div>}
      {interrupted && <><p>انقطع التسميع. ابدأ محاولة جديدة من المقطع المحفوظ.</p>
        <Button disabled={busy} onClick={() => run(() => journey.action({type: 'restart', sessionId: session.id, attemptId: crypto.randomUUID()}), '')}>ابدأ محاولة جديدة بعد الانقطاع</Button></>}
      {recall && <><p>سمّع المقطع من الذاكرة.</p>
        {attempt?.revealed && <Notice>سُجّل كشف النص مساعدةً في هذه المحاولة.</Notice>}
        {revealed ? <Button variant="secondary" onClick={() => setHiddenAttempt(attempt.id)}>أخفِ النص</Button>
          : <Button disabled={busy} variant="secondary" onClick={() => run(async () => {
            await journey.action({type: 'hint', sessionId: session.id, reveal: true});
            setHiddenAttempt(null);
          }, 'سُجّلت المساعدة.')}>أظهر النص وسجّل المساعدة</Button>}
      </>}
      {(recall || (session.phase === 'assessment' && !attempt?.assessment)) && <AssessmentChoices busy={busy} choose={submit} />}
      {session.phase === 'assessment' && attempt?.assessment && <Button disabled={busy} onClick={() => run(finish, '')}>أكمل وردي</Button>}
      {session.phase === 'paused' && !interrupted && <Button disabled={busy} onClick={() => run(() => journey.action({type: 'resume', sessionId: session.id}), '')}>أكمل وردي</Button>}
      <div className="actions session-controls">
        {session.phase !== 'paused' && <Button disabled={busy} variant="ghost" onClick={() => run(() => journey.action({type: 'pause', sessionId: session.id}), 'حُفظ موضع التوقف.')}>أوقف مؤقتًا</Button>}
        <Button disabled={busy} variant="ghost" onClick={() => run(finish, 'انتهت الجلسة.')}>أنهِ الجلسة</Button>
      </div>
    </Card>}

    {!home && !progress && planReady && !session && <Card><p>لا توجد جلسة مفتوحة.</p><Button onClick={() => go('S05')}>إلى ورد اليوم</Button></Card>}

    {!progress && planReady && result?.assessment && (!session || attempt?.assessment) && <section className="journey-result">
      <h2>حُفظ تقييمك الذاتي</h2>
      <p>{journey.unit(result.unitId).title} · {result.assessment.completion === 'complete' ? 'تسميع كامل' : result.assessment.completion === 'partial' ? 'تسميع جزئي' : 'اكتمال التسميع غير معلوم'} · المساعدات المسجلة: {result.hints}</p>
      {correctingId === result.id ? <><AssessmentChoices correcting busy={busy} choose={correct} />
        <Button variant="ghost" disabled={busy} onClick={() => setCorrectingId(null)}>إلغاء التصحيح</Button></>
        : <Button variant="ghost" disabled={busy} onClick={() => setCorrectingId(result.id)}>صحّح النتيجة</Button>}
    </section>}

    {home && planReady && <footer className="journey-footer">
      <div><h2>المراجعة القادمة</h2>
        <p>{nextReview ? <>{journey.unit(nextReview.unitId).title} · <time dateTime={nextReview.at}>{date(nextReview.at)}</time></> : 'لم يُحدّد موعد مراجعة بعد.'}</p>
      </div><Button variant="ghost" onClick={() => go('S14')}>عرض تقدمي</Button>
    </footer>}
    {progress && planReady && <Card><h2>من سجل تسميعك</h2>
      <p>نتائج محفوظة: <output aria-label="عدد نتائج التسميع">{view.observations}</output></p>
      <p>مواضع سُمّعت كاملة بلا خطأ معلوم وفق تقريرك الحالي: {view.successfulCoverage} — دون تكرار الموضع.</p>
      <p>ثبات الحفظ: يحتاج إلى تسميعات إضافية لتقديره.</p><p>المحفوظ المعلن لا يتحول إلى إتقان مثبت.</p>
      {view.due.length > 0 && <><h3>التعاهد القادم</h3><ul>{view.due.map(d => <li key={d.unitId}>{journey.unit(d.unitId).title} — {date(d.at)}</li>)}</ul></>}
      {view.weak.length > 0 && <><h3>مواضع تعثرت فيها بحسب نتائجك</h3><ul>{view.weak.map(title => <li key={title}>{title}</li>)}</ul><p>هذا وصف لنتائج مسجلة، وليس حكمًا بضعف ثابت.</p></>}
    </Card>}
  </section>;
}
