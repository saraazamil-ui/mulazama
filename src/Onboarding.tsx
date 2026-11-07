import { useEffect, useRef, useState } from "react";
import { Button, Card, Field, Notice } from "./components";
import type { PlanConfig, RangeKind, RangeSelection } from "./domain/contracts";
import { days } from "./catalog";
import { normalizeRanges, rangeLabel, validateRange } from "./domain/ranges";
import { validateConfig } from "./domain/state";
import type { OnboardingSubmission } from "./application/service";
import "./Onboarding.css";

type Mode = "beginner" | "prior" | "mixed";
const modes: { value: Mode; label: string }[] = [
  { value: "beginner", label: "أبدأ الحفظ من الصفر" },
  { value: "prior", label: "لدي محفوظات سابقة وأريد مراجعتها" },
  { value: "mixed", label: "أريد الجمع بين الحفظ الجديد والمراجعة" },
];
const titles = ["حالة الحفظ", "المحفوظات والهدف", "الوقت المناسب"];

export function Onboarding({ config, ranges, onSave, onComplete }: {
  config: PlanConfig;
  ranges: RangeSelection[];
  onSave: (input: OnboardingSubmission) => Promise<boolean>;
  onComplete: () => void;
}) {
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<Mode>(config.persona === "beginner" && !ranges.length ? "beginner" : config.goal === "maintain" ? "prior" : "mixed");
  const [form, setForm] = useState(config);
  const [drafts, setDrafts] = useState<RangeSelection[]>([]);
  const [kind, setKind] = useState<RangeKind>("surah");
  const [start, setStart] = useState(1), [end, setEnd] = useState(1), [surah, setSurah] = useState(1);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const submission = useRef<OnboardingSubmission | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [step]);
  const change = (patch: Partial<PlanConfig>) => { setForm({ ...form, ...patch }); setError(""); submission.current = null; };
  const move = (next: number) => { setError(""); setStep(next); };
  const addRange = () => {
    const range: RangeSelection = {
      id: crypto.randomUUID(), kind, start, end,
      ...(kind === "ayah" ? { surah } : {}),
      editionId: "prototype-unverified", status: "declared_unassessed",
      ...(kind === "page" ? { layoutId: "prototype-layout-unverified" } : {}),
    };
    const issue = validateRange(range);
    if (issue) { setError(issue); return; }
    setDrafts(normalizeRanges([...drafts, range]));
    submission.current = null;
    setError("");
  };
  const nextFromGoal = () => {
    const startSurah = mode === "prior" ? config.startSurah : form.startSurah;
    if (!Number.isSafeInteger(startSurah) || startSurah < 1 || startSurah > 114) {
      setError("رقم سورة البداية يجب أن يكون بين 1 و114."); return;
    }
    move(2);
  };
  const save = async () => {
    if (busy.current) return;
    const finalConfig: PlanConfig = {
      ...form, persona: mode === "beginner" ? "beginner" : mode === "prior" ? "returning" : "scattered",
      goal: mode === "prior" ? "maintain" : "memorize", configured: true,
      // Review-only has no visible new-memorization selector. Preserve its
      // valid stored reference rather than validating a hidden draft edit.
      startSurah: mode === "prior" ? config.startSurah : form.startSurah,
    };
    const issue = validateConfig(finalConfig);
    if (issue) { setError(issue); return; }
    submission.current ??= { config: finalConfig, ranges: mode === "beginner" ? [] : drafts, commandId: crypto.randomUUID() };
    busy.current = true; setSaving(true); setError("");
    try {
      if (await onSave(submission.current)) onComplete();
      else setError("لم يُؤكد حفظ الإعداد. بقيت اختياراتك هنا؛ أعد المحاولة. لم يُحفظ جزء من الإعداد.");
    } catch (cause) {
      setError(`تعذر حفظ الإعداد. ${cause instanceof Error ? cause.message : "أعد المحاولة."}`);
    } finally { busy.current = false; setSaving(false); }
  };

  return <Card>
    <p role="status" aria-live="polite">الخطوة {(step + 1).toLocaleString("ar-SA")} من ٣</p>
    <h2 ref={heading} tabIndex={-1}>{titles[step]}</h2>
    <fieldset disabled={saving} className="onboarding-fields">
      <legend className="onboarding-step-label">{titles[step]}</legend>
      {step === 0 && <div className="persona-grid" role="radiogroup" aria-label="حالة الحفظ">
        {modes.map(item => <label key={item.value} className={"choice " + (mode === item.value ? "selected" : "")}>
          <input type="radio" name="onboarding-mode" checked={mode === item.value} onChange={() => { setMode(item.value); submission.current = null; }} />
          <span>{item.label}</span>
        </label>)}
      </div>}
      {step === 1 && <>
        <p>{mode === "prior" ? "هدفك: تعاهد المحفوظ السابق." : mode === "mixed" ? "هدفك: حفظ جديد مع تعاهد المحفوظ السابق." : "هدفك: بدء الحفظ، ثم مراجعة ما تتعلمه."}</p>
        {mode !== "beginner" && <>
          <Notice>المحفوظات هنا تصريح منك، وليست حفظًا تحقق بالتسميع. لا تتحول إلى نسبة إنجاز.</Notice>
          {ranges.length > 0 && <><h3>تصريحات محفوظة سابقًا</h3><ul>{ranges.map(range => <li key={range.id}>{rangeLabel(range)} — معلن غير مختبر</li>)}</ul></>}
          <Field label="طريقة تحديد المحفوظ السابق"><select value={kind} onChange={event => { setKind(event.target.value as RangeKind); setStart(1); setEnd(1); setError(""); }}>
            <option value="surah">سور كاملة</option><option value="juz">أجزاء كاملة</option><option value="page">صفحات</option><option value="ayah">نطاق آيات</option>
          </select></Field>
          {kind === "ayah" && <Field label="رقم السورة للمحفوظ السابق"><input type="number" min={1} max={114} value={surah || ""} onChange={event => setSurah(Number(event.target.value))} /></Field>}
          <div className="two-grid">
            <Field label="بداية المحفوظ السابق"><input type="number" min={1} value={start || ""} onChange={event => setStart(Number(event.target.value))} /></Field>
            <Field label="نهاية المحفوظ السابق"><input type="number" min={1} value={end || ""} onChange={event => setEnd(Number(event.target.value))} /></Field>
          </div>
          {(kind === "page" || kind === "ayah") && <Notice>تُحفظ الأرقام كتحديد معلن؛ مطابقتها للآيات والطبعة تنتظر خريطة المحتوى المعتمدة.</Notice>}
          <Button variant="secondary" onClick={addRange}>أضف إلى اختياراتي</Button>
          {drafts.length > 0 && <ul className="range-list" aria-label="المحفوظات المختارة للإعداد">{drafts.map(range => <li key={range.id}>
            <span>{rangeLabel(range)} — معلن غير مختبر</span>
            <Button variant="ghost" aria-label={"إزالة من الاختيارات: " + rangeLabel(range)} onClick={() => { setDrafts(drafts.filter(item => item.id !== range.id)); submission.current = null; }}>إزالة</Button>
          </li>)}</ul>}
          <p>يمكنك إضافة مواضع أخرى لاحقًا. النطاقات المتداخلة من النوع نفسه تُوحّد دون جمع الأنواع المختلفة.</p>
        </>}
        {mode !== "prior" && <Field label="سورة البداية (رقم مرجعي)" hint="اختيارك للبدء، ويظل معلقًا حتى اعتماد المحتوى."><input type="number" min={1} max={114} value={form.startSurah || ""} onChange={event => change({ startSurah: Number(event.target.value) })} /></Field>}
      </>}
      {step === 2 && <>
        <Field label="الوقت اليومي بالدقائق"><input type="number" min={0} max={1440} value={Number.isNaN(form.minutes) ? "" : form.minutes} onChange={event => change({ minutes: event.target.value === "" ? NaN : Number(event.target.value) })} /></Field>
        <fieldset><legend>أيام النشاط</legend><div className="day-options">{days.map((day, index) => <label key={day} className={"day " + (form.days.includes(index) ? "selected" : "")}>
          <input type="checkbox" checked={form.days.includes(index)} onChange={() => change({ days: form.days.includes(index) ? form.days.filter(value => value !== index) : [...form.days, index] })} />{day}
        </label>)}</div></fieldset>
        <p>التوقيت المعتمد: الرياض. الوقت مدة متاحة يوميًا؛ لا يُنشئ تنبيهًا أو موعد تسميع. يمكنك تعديله لاحقًا.</p>
        <Notice>سنحفظ اختياراتك على هذا الجهاز معًا. جلسات القرآن والورد الفعلي تنتظر اعتماد المحتوى والبوابات؛ حفظ الإعداد لا يفعّلها.</Notice>
        <p>تبقى الاختيارات مسودة حتى تأكيد حفظها. إذا أغلقت الصفحة قبل الحفظ، ستحتاج إدخالها من جديد.</p>
      </>}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="actions">
        {step === 0 && <Button onClick={() => move(1)}>التالي: المحفوظات والهدف</Button>}
        {step === 1 && <Button onClick={nextFromGoal}>{mode !== "beginner" && !drafts.length && !ranges.length ? "أحدد محفوظاتي لاحقًا — التالي" : "التالي: الوقت المناسب"}</Button>}
        {step === 2 && <Button onClick={save}>{saving ? "جارٍ حفظ الإعداد…" : "احفظ واذهب إلى الرئيسية"}</Button>}
        {step > 0 && <Button variant="secondary" onClick={() => move(step - 1)}>رجوع</Button>}
      </div>
    </fieldset>
  </Card>;
}
