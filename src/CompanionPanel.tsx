import { useId, useState } from "react";
import { Button, Card, Notice } from "./components";
import { hasTimedObservation, projectCompanion, type CompanionUnit } from "./companion/projection";
import type { PersonalMemoryAttempt, PersonalMemoryReadModel } from "./memory/personal-memory";
import "./companion-panel.css";

export type CompanionLoadState = { status: "loading" } | { status: "unavailable"; message: string } | { status: "error"; message: string }
  | { status: "ready"; value: PersonalMemoryReadModel };
const number = (value: number) => value.toLocaleString("ar-SA");
const dateLabel = (value: string) => new Intl.DateTimeFormat("ar-SA", { calendar: "gregory", timeZone: "Asia/Riyadh",
  year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
const mistakeType: Record<string, string> = { word: "لفظ", link: "ربط", confusion: "تشابه", unknown: "غير محدد" };
const completionLabel = { complete: "مكتمل بحسب البلاغ", partial: "جزئي بحسب البلاغ", unknown: "الاكتمال غير معلوم" };
const terminationLabel = { completed: "إتمام التسميع", memory_failure: "تعذر الإكمال من الذاكرة", user_stop: "توقف المستخدم", technical_failure: "توقف تقني" };

/** Elapsed time, not calendar-day subtraction or a scientific retention band. */
export function companionIntervalLabel(milliseconds: number): string {
  if (milliseconds < 1000) return "أقل من ثانية";
  const seconds = Math.floor(milliseconds / 1000);
  const units: Array<[number, string]> = [[86400, "يوم"], [3600, "ساعة"], [60, "دقيقة"], [1, "ثانية"]];
  let remaining = seconds;
  return units.flatMap(([length, label]) => {
    const amount = Math.floor(remaining / length); remaining %= length;
    return amount ? [`${number(amount)} ${label}`] : [];
  }).join(" و");
}

/** Fetching/retry belongs to the aggregate owner. This component has no mutation,
 * route, session button or algorithmic recommendation, including in error states. */
export function CompanionPanel({ state, retry, detailed = false }: {
  state: CompanionLoadState; retry: () => void; detailed?: boolean;
}) {
  const id = useId();
  const [visibleUnits, setVisibleUnits] = useState(10);
  if (state.status === "unavailable") return <Card><h2>ذاكرة الحافظ</h2><p>{state.message}</p></Card>;
  if (state.status === "loading") return <Card><p role="status">جارٍ قراءة ذاكرة الحافظ…</p></Card>;
  if (state.status === "error") return <Card><Notice tone="error">
    تعذر قراءة ذاكرة الحافظ. {state.message}
    <p>أعد القراءة للتحقق من السجل المحفوظ.</p>
    <Button variant="secondary" onClick={retry}>إعادة قراءة ذاكرة الحافظ</Button>
  </Notice></Card>;
  const model = projectCompanion(state.value);
  return <section className="companion-panel" dir="rtl" aria-labelledby={`${id}-title`}>
    <Card>
      <h2 id={`${id}-title`}>ذاكرة الحافظ</h2>
      {model.totals.assessedAttempts === 0 ? <p>لا توجد نتائج تسميع مرتبطة بمقاطع في السجل حتى الآن. المحفوظات التي تصرّح بها تبقى منفصلة عن الحفظ المتحقق بالتسميع.</p> : <>
        <p>أحدث نتائجك المبلّغ عنها بعد التصحيح، من سجل الأحداث. حفظ النتيجة لا يعني التحقق منها مستقلًا.</p>
        <dl className="companion-facts">
          <div><dt>محاولات لها نتيجة</dt><dd>{number(model.totals.assessedAttempts)}</dd></div>
          <div><dt>تصحيحات محفوظة</dt><dd>{number(model.totals.corrections)}</dd></div>
          <div><dt>مواضع مبلّغ عنها مرتبطة</dt><dd>{number(model.totals.linkedReportedLocations)}</dd></div>
        </dl>
        {model.totals.repeatedReportedLocations > 0 && <p>تكرر البلاغ عن {number(model.totals.repeatedReportedLocations)} مواضع بالنص نفسه في فرص مسجلة مختلفة. هذا لا يثبت ضعفًا مستمرًا في الحفظ.</p>}
      </>}
      <p className="companion-limit">ثبات الحفظ: يحتاج إلى تسميعات إضافية لتقديره.</p>
      {!detailed && <p className="companion-limit">تفاصيل النتائج والبلاغات وحدودها في صفحة «تقدمي».</p>}
      {detailed && <p className="companion-limit">النتيجة في جلسة، ومقدار الحفظ، وثبات الاسترجاع مقاييس منفصلة. لا تتوفر هنا استحقاقات أو توصيات مراجعة معتمدة.</p>}
    </Card>
    {detailed && <>
      <Card><h2>سجل المقاطع وبلاغات المواضع</h2>
        <p>أسماء المواضع هي النصوص التي سُجلت في البلاغات؛ لم تُطابق بمراجع آيات معتمدة. لا ندمج بلاغات من مقاطع أو طبعات أو ملفات تسميع مختلفة.</p>
        {!model.units.length ? <p>لم يُسجل مقطع مرتبط بمحاولة بعد.</p> : <ol className="companion-units">
          {model.units.slice(0, visibleUnits).map((unit, index) => <li key={JSON.stringify(unit.identity)}><UnitHistory unit={unit} index={index} /></li>)}
        </ol>}
        {model.units.length > visibleUnits && <Button variant="secondary" onClick={() => setVisibleUnits(count => count + 10)}>عرض المزيد من المقاطع</Button>}
        {model.unlinkedMistakeEventIds.length > 0 && <p>توجد أحداث بلاغات أو تصحيحات غير مرتبطة بمحاولات مقطع: {number(model.unlinkedMistakeEventIds.length)}. تبقى في سجلها الأصلي ولا نستخدمها للحكم على مقطع.</p>}
      </Card>
      <details className="companion-source"><summary>كيف نقرأ هذه الذاكرة؟</summary>
        <p>تُشتق من ملف ذاكرة الحافظ بعد التحقق من سجل الأحداث. لا تنشئ سجلًا جديدًا، وتبقى كل نتيجة أصلية وتصحيحاتها قابلة للتتبع.</p>
        <p>تكرار البلاغ يعني تطابق نص الموضع والنوع داخل هوية المقطع نفسها، مع نتائج حالية تُبلغ عن أخطاء في فرص تسميع مختلفة لا يربطها السجل بالتجربة نفسها. هذا الفصل في السجل لا يثبت استقلال القياس علميًا. تكرار البلاغ في المحاولة نفسها لا يزيد عدد المحاولات.</p>
        <p>الفاصل هو الزمن الفعلي منذ آخر تعرض مسجل؛ لا يحدد وحده مستوى الثبات. البلاغ المشتبه به أو المختلف عليه أو المتعارض مع التصحيح لا يُستخدم لإثبات تكرار الخطأ.</p>
        <p>آخر قراءة: <time dateTime={model.meta.asOf}>{dateLabel(model.meta.asOf)}</time> بتوقيت الرياض · أحداث المصدر: {number(model.meta.sourceEventCount)}.</p>
      </details>
    </>}
  </section>;
}

function UnitHistory({ unit, index }: { unit: CompanionUnit; index: number }) {
  const [visibleAttempts, setVisibleAttempts] = useState(10);
  const [visibleLocations, setVisibleLocations] = useState(10);
  return <details>
    <summary>سجل مقطع {number(index + 1)} · {number(unit.assessedAttempts)} محاولات لها نتيجة</summary>
    <p className="companion-limit">هذا عنوان للسجل؛ لا يحدد سورة أو آية، ولا يثبت اكتمال الحفظ.</p>
    {!unit.attempts.length ? <p>لا توجد محاولات لهذا المقطع بعد.</p> : <ol className="companion-attempts">
      {unit.attempts.slice().reverse().slice(0, visibleAttempts).map(attempt => <li key={attempt.attemptId}><AttemptHistory attempt={attempt} /></li>)}
    </ol>}
    {unit.attempts.length > visibleAttempts && <Button variant="secondary" onClick={() => setVisibleAttempts(count => count + 10)}>عرض المزيد من محاولات المقطع {number(index + 1)}</Button>}
    <h3>بلاغات هذا المقطع</h3>
    {!unit.locations.length ? <p>لا توجد بلاغات مرتبطة بموضع محدد.</p> : <ul className="companion-locations">
      {unit.locations.slice(0, visibleLocations).map(location => <li key={JSON.stringify([location.location, location.type])}>
        <strong><bdi>{location.location}</bdi></strong> · {mistakeType[location.type] ?? "غير محدد"}
        <p>{location.repeatedReport ? "تكرر البلاغ بالنص نفسه في فرص مسجلة مختلفة." : location.consistentAttempts === 1 ? "بلاغ في محاولة واحدة؛ لا يكفي للحكم على تكرار الخطأ." : location.consistentAttempts > 1 ? "محاولات مرتبطة بالتجربة نفسها؛ لا نعدها دليلًا مستقلًا على التكرار." : "لا توجد نتيجة حالية كافية لربط هذا البلاغ بخطأ مبلّغ عنه في المحاولة."}</p>
        {location.reports.some(report => report.state === "conflicts-with-latest-result") && <p>يوجد بلاغ محفوظ يتعارض مع نتيجة حالية عدد أخطائها صفر؛ لم نحذفه ولم نحتسبه تكرارًا.</p>}
        {location.reports.some(report => report.state === "unresolved-report") && <p>يتضمن بلاغًا غير محسوم: مشتبهًا به أو مختلفًا عليه أو دون عدد أخطاء معلوم أو سابقًا لتصحيح لا يحدد أثره على الموضع؛ لا يُحسب ضمن التكرار.</p>}
      </li>)}
    </ul>}
    {unit.locations.length > visibleLocations && <Button variant="secondary" onClick={() => setVisibleLocations(count => count + 10)}>عرض المزيد من بلاغات المقطع {number(index + 1)}</Button>}
    {unit.unlocatedReports.length > 0 && <p>بلاغات مرتبطة بمحاولة دون موضع محدد: {number(unit.unlocatedReports.length)}. لا ننسبها إلى موضع بالتخمين.</p>}
    <details className="companion-provenance"><summary>هوية السجل</summary><dl>
      <div><dt>معرف المقطع</dt><dd><bdi>{unit.identity.unitId}</bdi></dd></div>
      <div><dt>معرف الطبعة</dt><dd><bdi>{unit.identity.editionId}</bdi></dd></div>
      <div><dt>ملف التسميع</dt><dd><bdi>{unit.identity.probeProfileVersionId}</bdi></dd></div>
    </dl></details>
  </details>;
}

function AttemptHistory({ attempt }: { attempt: PersonalMemoryAttempt }) {
  const observation = attempt.latestObservation;
  return <>
    <time dateTime={attempt.startedAt}>{dateLabel(attempt.startedAt)}</time>
    <p>{observation ? completionLabel[observation.completion] : "لم تُسجل نتيجة لهذه المحاولة بعد"} · {attempt.termination ? terminationLabel[attempt.termination] : "لم تُغلق المحاولة"}</p>
    {observation && <p>الكلمات المسمّعة: {observation.attemptedWords === null ? "غير معلومة" : number(observation.attemptedWords)} من {number(observation.requestedWords)} · الأخطاء المبلّغ عنها: {observation.errors === null ? "غير معلومة" : number(observation.errors)} · التلميحات: {number(attempt.hints)} · كشف النص: {attempt.revealed ? "نعم" : "لا"}</p>}
    {hasTimedObservation(attempt) ? <p>الفاصل منذ آخر تعرض مسجل: {companionIntervalLabel(attempt.millisecondsSinceRelevantExposure!)}. هذه ملاحظة بفاصل مسجل، وليست حكمًا بثبات الحفظ أو ضعفه.</p> : <p className="companion-limit">لا يتوفر فاصل تعرض متحقق بحسب السجل لهذه النتيجة.</p>}
    {attempt.assessmentHistory.length > 1 && <details><summary>تاريخ تصحيحات هذه النتيجة</summary><ol>
      {attempt.assessmentHistory.map(revision => <li key={revision.eventId}>
        {revision.kind === "corrected" ? "تصحيح" : "النتيجة الأصلية"} · <time dateTime={revision.recordedAt}>{dateLabel(revision.recordedAt)}</time> · عدد الأخطاء: {revision.reportedObservation.errors === null ? "غير معلوم" : number(revision.reportedObservation.errors)}
        {revision.reason && <p>السبب: <bdi>{revision.reason}</bdi></p>}
      </li>)}
    </ol><p>التصحيح يعود إلى المحاولة الأصلية ولا ينشئ تسميعًا جديدًا.</p></details>}
  </>;
}
