import { useId, useState } from "react";
import { Button, Card, Notice } from "./components";
import type { ProgressReadModel } from "./progress/projection";
import "./progress-dashboard.css";

const number = (n: number) => n.toLocaleString("ar-SA");
const localDateLabel = (value: string) =>
  new Intl.DateTimeFormat("ar-SA", {
    calendar: "gregory", timeZone: "Asia/Riyadh", day: "numeric", month: "short", year: "numeric",
  }).format(new Date(`${value}T12:00:00Z`));

export type ProgressLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; value: ProgressReadModel };

/** A missing measure is text plus an inert track, never a fictitious zero or loading progressbar. */
export function ProgressBar({ title, completed, target, unit, reason }: {
  title: string; completed: number | null; target: number | null; unit: string; reason?: string;
}) {
  const id = useId();
  const known = completed !== null && target !== null && Number.isFinite(completed)
    && Number.isFinite(target) && completed >= 0 && target > 0;
  const percent = known ? Math.min(100, Math.round(completed / target * 100)) : null;
  return <section className="progress-measure" aria-labelledby={`${id}-title`}>
    <div className="progress-measure-title">
      <h2 id={`${id}-title`}>{title}</h2>
      <strong>{percent === null ? "غير متاح بعد" : `${number(percent)}٪`}</strong>
    </div>
    {percent === null ? <div className="progress-track progress-track-unavailable" aria-hidden="true" /> :
      <div className="progress-track" role="progressbar" aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`} aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={percent} aria-valuetext={`${number(completed!)} من ${number(target!)} ${unit}`}>
        <span className="progress-fill" style={{ width: `${percent}%` }} />
      </div>}
    <p id={`${id}-description`} className="progress-description">
      {known ? `المنجز: ${number(completed!)} ${unit} · الهدف: ${number(target!)} ${unit} · المتبقي: ${number(Math.max(0, target! - completed!))} ${unit}` : reason ?? "لا تتوفر بيانات موثوقة لحساب النسبة."}
    </p>
  </section>;
}

export function ProgressContent({ state, retry, detailed = false }: {
  state: ProgressLoadState; retry: () => void; detailed?: boolean;
}) {
  if (state.status === "loading") return <Card><p role="status">جارٍ قراءة سجل التقدم المحفوظ…</p></Card>;
  if (state.status === "error") return <Card><Notice tone="error">
    تعذر قراءة مؤشرات التقدم. {state.message}
    <p>لم نعرض أرقامًا بديلة. أعد القراءة للتحقق من آخر حفظ مؤكد.</p>
    <Button variant="secondary" onClick={retry}>إعادة قراءة التقدم</Button>
  </Notice></Card>;
  return <div className="progress-dashboard" dir="rtl">
    <div className="progress-source" role="status" aria-live="polite">
      من سجل الأحداث المحفوظ · {localDateLabel(state.value.meta.localDate)} · توقيت الرياض
    </div>
    <div className="two-grid">
      <Card><ProgressBar title="إنجاز ورد اليوم" completed={null} target={null} unit="نشاط" reason={state.value.daily.reason} />
        {state.value.daily.completedSessions !== null && <p className="progress-fact">
          جلسات بتسميع مكتمل اليوم: <strong>{number(state.value.daily.completedSessions)}</strong>.
          هذا عدد جلسات سجّلت تسميعًا مكتملًا؛ لا يحدد نسبة إنجاز الخطة أو جودة الأداء.
        </p>}
      </Card>
      <Card><ProgressBar title="تقدم الحفظ" completed={state.value.memorization.completed} target={state.value.memorization.target} unit="وحدة معتمدة" reason={state.value.memorization.reason} /></Card>
    </div>
    <div className="two-grid">
      <Card><h2>المراجعة اليوم</h2>
        <dl className="review-counts">
          <div><dt>المستحق</dt><dd>غير متاح</dd></div>
          <div><dt>المنجز</dt><dd>غير متاح</dd></div>
          <div><dt>المتبقي</dt><dd>غير متاح</dd></div>
          <div><dt>المتأخر</dt><dd>غير متاح</dd></div>
        </dl>
        <p>{state.value.review.reason}</p>
      </Card>
      <Card><h2>ثبات الحفظ</h2><p>{state.value.stability.reason}</p>
        <p className="progress-description">إنجاز النشاط، وجودة التسميع، وثبات الحفظ مقاييس مختلفة.</p>
      </Card>
    </div>
    {detailed && <ProgressHistory model={state.value} />}
  </div>;
}

function ProgressHistory({ model }: { model: ProgressReadModel }) {
  const [period, setPeriod] = useState<"7" | "30" | "all">("7");
  const [visibleCount, setVisibleCount] = useState(20);
  const [locationCount, setLocationCount] = useState(20);
  const cutoff = period === "all" ? "" : new Date(Date.parse(`${model.meta.localDate}T12:00:00Z`) - (Number(period) - 1) * 86400000).toISOString().slice(0, 10);
  const days = model.days.filter(day => day.localDate >= cutoff);
  const attempts = model.attempts.filter(attempt => attempt.localDate >= cutoff);
  const certainty: Record<string, string> = { observed: "ملاحظ", suspected: "مشتبه به", disputed: "مختلف عليه" };
  const kind: Record<string, string> = { word: "لفظ", link: "ربط", confusion: "تشابه", unknown: "غير محدد" };
  const termination: Record<string, string> = { completed: "إتمام التسميع", memory_failure: "تعذر الإكمال من الذاكرة", user_stop: "توقف المستخدم", technical_failure: "توقف تقني" };
  const completion: Record<string, string> = { complete: "كامل بحسب البلاغ", partial: "جزئي بحسب البلاغ", unknown: "الاكتمال غير معلوم" };
  return <>
    <Card><h2>نشاطك المسجل</h2>
      <p>يُحسب لكل جلسة تسميع مكتمل واحد عند إتمامه وتسجيل نتيجة تفيد اكتمال جميع كلمات النطاق المطلوب؛ ولا يشترط إغلاق الجلسة. التصحيح يعيد حساب اليوم الأصلي؛ فتح الجلسة أو تكرار التدريب لا يرفع العدد.</p>
      {!model.activity.hasEvidence ? <p className="progress-empty">لا توجد نتائج تسميع مسجلة لعرض إنجاز الأيام السابقة.</p> : <>
        <dl className="progress-totals">
          <div><dt>آخر ٧ أيام</dt><dd>{number(model.activity.last7Days ?? 0)} جلسات</dd></div>
          <div><dt>آخر ٣٠ يومًا</dt><dd>{number(model.activity.last30Days ?? 0)} جلسات</dd></div>
          <div><dt>إجمالي الجلسات بتسميع مكتمل</dt><dd>{number(model.activity.completedSessions)}</dd></div>
        </dl>
        <label className="field progress-period"><span>فترة السجل</span><select value={period} onChange={event => { setPeriod(event.target.value as typeof period); setVisibleCount(20); }}>
          <option value="7">آخر ٧ أيام</option><option value="30">آخر ٣٠ يومًا</option><option value="all">كل السجل</option>
        </select></label>
        {!days.length ? <p className="progress-empty">لا توجد نتائج مسجلة في هذه الفترة.</p> : <div className="progress-days">
          {days.slice(0, visibleCount).map(day => <div key={day.localDate} className="progress-day"><time dateTime={day.localDate}>{localDateLabel(day.localDate)}</time><span>{number(day.completedSessions)} جلسات بتسميع مكتمل · {number(day.assessedAttempts)} محاولات مقيّمة</span></div>)}
        </div>}
      </>}
    </Card>
    <Card><h2>نتائج التسميع عبر الوقت</h2><p>بلاغات أداء ذاتية، وتظهر أحدث نتيجة بعد التصحيح. لا تمنح حكمًا بإتقان الحفظ.</p>
      {!attempts.length ? <p className="progress-empty">لا توجد نتائج تسميع في الفترة المحددة.</p> : <ol className="progress-attempts">
        {attempts.slice(0, visibleCount).map(attempt => <li key={attempt.attemptId}>
          <div className="progress-attempt-heading"><time dateTime={attempt.endedAt}>{localDateLabel(attempt.localDate)}</time><strong>{completion[attempt.completion]}</strong></div>
          <p>نهاية المحاولة: {termination[attempt.termination]} · الكلمات المسمّعة: {attempt.attemptedWords === null ? "غير معلومة" : number(attempt.attemptedWords)} من {number(attempt.requestedWords)}</p>
          <p>الأخطاء المبلّغ عنها: {attempt.errors === null ? "غير معلومة" : number(attempt.errors)} · التلميحات: {number(attempt.hints)} · كشف النص: {attempt.revealed ? "نعم" : "لا"}</p>
          <small>النتيجة ذاتية · نسخة التقييم {number(attempt.revision)}</small>
        </li>)}
      </ol>}
      {(attempts.length > visibleCount || days.length > visibleCount) && <Button variant="secondary" onClick={() => setVisibleCount(count => count + 20)}>عرض المزيد من السجل</Button>}
    </Card>
    <Card><h2>مواضع أبلغت عن حاجتها إلى عناية</h2><p>بلاغاتك كما حُفظت وصُححت؛ ليست تشخيصًا للثبات أو إثباتًا لعلاج الموضع.</p>
      {!model.reportedLocations.length ? <p className="progress-empty">لم تُسجل بلاغات مواضع بعد.</p> : <ul className="progress-locations">
        {model.reportedLocations.slice(0, locationCount).map((item, index) => <li key={`${item.sourceEventIds.join("-")}-${index}`}>
          <strong>{item.location ?? "موضع غير محدد"}</strong><span>{kind[item.type] ?? "غير محدد"} · {certainty[item.certainty] ?? "غير محدد"}</span>
        </li>)}
      </ul>}
      {model.reportedLocations.length > locationCount && <Button variant="secondary" onClick={() => setLocationCount(count => count + 20)}>عرض المزيد من المواضع</Button>}
    </Card>
    <details className="progress-evidence"><summary>مصدر المؤشرات وحدودها</summary>
      <p>تُعاد المؤشرات من سجل الأحداث بعد التحقق منه، ولا تُحفظ النسب منفصلة. أحدث تصحيح يحل محل نتيجة المحاولة السابقة دون إضافة جلسة جديدة.</p>
      <p>عدد الأحداث المقروءة: {number(model.meta.sourceEventCount)} · نسخة السجل: {number(model.meta.sourceWatermark)}. لا يمكن تحويل النطاقات المعلنة إلى مقدار محفوظ معتمد أو ربط جلسة بمهمة يومية دون مراجع معتمدة.</p>
    </details>
  </>;
}
