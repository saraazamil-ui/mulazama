import { useEffect, useRef, useState } from "react";
import type {
  LearningUiAdapter,
  LearningUiAction,
  LearningScreenId,
  ManualObservation,
} from "./application/learning-ui-adapter";
import { Button, Card, Field, Notice } from "./components";
/** An injectable integration surface; main.tsx never mounts it without approved runtime wiring.
 * Content is deliberately absent. Test-only text cannot be mistaken for Quran. */
export function LearningEngineScreen({
  adapter,
  id,
  onCommitted,
}: {
  adapter: LearningUiAdapter;
  id: LearningScreenId;
  onCommitted?: () => void | Promise<void>;
}) {
  const [state, setState] = useState(() => adapter.state),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saveMessage, setSaveMessage] = useState("");
  const [words, setWords] = useState(""),
    [errors, setErrors] = useState("");
  const [completion, setCompletion] =
    useState<ManualObservation["completion"]>("unknown");
  const [effort, setEffort] = useState<ManualObservation["effort"]>("unknown");
  const [correctionReason, setCorrectionReason] = useState("");
  const dirtyAssessment = useRef(false);
  const loadedAssessment = useRef<{ id: string; revision: number } | null>(null);
  const [assessmentConflict, setAssessmentConflict] = useState(false);
  const [mistakeType, setMistakeType] = useState<
      "word" | "link" | "confusion" | "unknown"
    >("unknown"),
    [certainty, setCertainty] = useState<"observed" | "suspected" | "disputed">(
      "suspected",
    ),
    [location, setLocation] = useState("");
  const [gap, setGap] = useState(false),
    [spent, setSpent] = useState(""),
    [costs, setCosts] = useState<Record<string, string>>({}),
    [elapsed, setElapsed] = useState(""),
    [fatigue, setFatigue] = useState(false),
    [absence, setAbsence] = useState(3);
  const session = Object.values(state.sessions).find(
    (s) => s.phase !== "ended",
  );
  const attempt = session?.attemptId ? state.attempts[session.attemptId] : null;
  function loadAssessment() {
    const raw = attempt?.assessment;
    setWords(raw?.attemptedWords == null ? "" : String(raw.attemptedWords));
    setErrors(raw?.errors == null ? "" : String(raw.errors));
    setCompletion(raw?.completion ?? "unknown");
    setEffort(raw?.effort ?? "unknown");
    setGap(raw?.gapVerified ?? false);
    setCorrectionReason("");
    dirtyAssessment.current = false;
    loadedAssessment.current = attempt ? { id: attempt.id, revision: attempt.revision } : null;
    setAssessmentConflict(false);
  }
  useEffect(() => {
    const loaded = loadedAssessment.current;
    if (loaded?.id === attempt?.id && loaded?.revision === attempt?.revision) return;
    // A refreshed revision must never overwrite an unsaved correction draft.
    if (loaded?.id === attempt?.id && dirtyAssessment.current) {
      setAssessmentConflict(true);
      return;
    }
    loadAssessment();
  }, [attempt?.id, attempt?.revision]);
  function editAssessment() {
    dirtyAssessment.current = true;
    setSaveMessage("");
  }
  const observation: ManualObservation = {
    attemptedWords: words === "" ? null : Number(words),
    errors: errors === "" ? null : Number(errors),
    completion, effort, gapVerified: gap,
  };
  const observationChanged = !!attempt?.assessment &&
    (Object.keys(observation) as Array<keyof ManualObservation>).some(key => observation[key] !== attempt.assessment?.[key]);

  function notifyCommitted() {
    // A failed observer refresh must not turn an acknowledged write into a save error.
    try { void Promise.resolve(onCommitted?.()).catch(() => {}); } catch { /* observer owns read errors */ }
  }
  async function run(action: LearningUiAction) {
    if (busy) return;
    setBusy(true);
    setSaveMessage("");
    try {
      const next = await adapter.send(action, {
        commandId: crypto.randomUUID(),
        expectedRevision: adapter.revision,
      });
      if (action.type === "assess" || action.type === "correct") dirtyAssessment.current = false;
      setState(next);
      setError("");
      setSaveMessage("حُفظ الإجراء محليًا بعد تأكيد الكتابة.");
      notifyCommitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تأكيد الحفظ.");
    } finally {
      setBusy(false);
    }
  }
  async function plan() {
    if (busy) return;
    setBusy(true);
    setSaveMessage("");
    try {
      setState(
        await adapter.replanFromProduct(
          {
            spentMinutes: spent === "" ? NaN : Number(spent),
            at: new Date().toISOString(),
            costs: Object.fromEntries(
              Object.keys(state.units).map((k) => [
                k,
                costs[k] === undefined || costs[k] === ""
                  ? NaN
                  : Number(costs[k]),
              ]),
            ),
            costModelVersion: "user-entered-estimate-05c-unvalidated",
          },
          {
            commandId: crypto.randomUUID(),
            expectedRevision: adapter.revision,
          },
        ),
      );
      setError("");
      setSaveMessage("حُفظت الخطة محليًا بعد تأكيد الكتابة.");
      notifyCommitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر حساب الخطة.");
    } finally {
      setBusy(false);
    }
  }
  let progress: ReturnType<LearningUiAdapter["progress"]> | null = null;
  try { progress = adapter.progress(); }
  catch (cause) { if ((cause as { code?: string }).code !== "COVERAGE_NOT_COMPARABLE") throw cause; }
  let budget: ReturnType<LearningUiAdapter["budget"]> | null = null;
  try {
    budget = adapter.budget();
  } catch {
    /* No assumed budget when the product settings are unbound. */
  }
  const training = session
    ? adapter.training(
        session.id,
        elapsed !== "" &&
          Number.isFinite(Number(elapsed)) &&
          Number(elapsed) >= 0
          ? { elapsedMinutes: Number(elapsed), fatigue }
          : undefined,
      )
    : null;
  return (
    <section aria-label="واجهة خدمات التعلم" data-screen={id}>
      <h1 tabIndex={-1}>مُلازَمَة — التحقق الوظيفي للتعلم</h1>
      <Notice>
        واجهة تحقق هندسي بلا نص قرآني. المقادير هنا تخص الوحدات المسجلة؛ ليست
        شهادة إتقان أو اعتماد منهج.
      </Notice>
      {error && <p role="alert">{error}</p>}
      <p role="status" aria-live="polite">
        {busy ? "جارٍ تأكيد الحفظ… " : saveMessage ? `${saveMessage} ` : ""}
        إيصال الحفظ: {adapter.revision} · مفاتيح تغطية ذات دليل مؤهل:{" "}
        {progress ? `${progress.observed.length} · غير مختبرة: ${progress.unassessed.length}` : "لا يمكن جمع التغطية بين طبعات مختلفة دون خريطة معتمدة."}
      </p>
      <Card>
        {!session && (
          <>
            {Object.values(state.units).map((u) => (
              <Button
                key={u.definition.id}
                disabled={busy}
                onClick={() =>
                  run({
                    type: "start",
                    unitId: u.definition.id,
                    sessionId: crypto.randomUUID(),
                  })
                }
              >
                بدء الوحدة {u.definition.id}
              </Button>
            ))}
          </>
        )}
        {session && (
          <>
            <p>
              الوحدة: {session.unitId} · المرحلة: {session.phase} · التكرار
              المؤكد: {session.repetitions}
            </p>
            {id === "S07" && session.phase === "training" && (
              <>
                <p>
                  قرار ملف المنهج {training?.policyVersion}:{" "}
                  {training?.reasonCode}
                </p>
                <Field label="زمن التدريب النشط الذي تقر به بالدقائق">
                  <input
                    type="number"
                    min="0"
                    value={elapsed}
                    onChange={(e) => setElapsed(e.target.value)}
                  />
                </Field>
                <label>
                  <input
                    type="checkbox"
                    checked={fatigue}
                    onChange={(e) => setFatigue(e.target.checked)}
                  />
                  أشعر بالتعب
                </label>
                <Notice>
                  الزمن إدخال ذاتي؛ لا يعد قياسًا آليًا محفوظًا. غياب الزمن يبقي
                  قرار الراحة غير محسوم.
                </Notice>
                <Button
                  disabled={busy || fatigue || training?.next === "rest"}
                  onClick={() =>
                    run({
                      type: "repeat",
                      sessionId: session.id,
                      mode: "reading",
                    })
                  }
                >
                  أنهيت تكرارًا
                </Button>
                <Button
                  disabled={busy || fatigue || training?.next === "rest"}
                  onClick={() =>
                    run({
                      type: "recall",
                      sessionId: session.id,
                      attemptId: crypto.randomUUID(),
                    })
                  }
                >
                  بدء محاولة غيبية
                </Button>
              </>
            )}
            {id === "S08" && session.phase === "recall" && (
              <>
                <Button
                  disabled={busy}
                  onClick={() =>
                    run({ type: "hint", sessionId: session.id, reveal: true })
                  }
                >
                  تسجيل كشف النص
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    run({
                      type: "complete",
                      sessionId: session.id,
                      termination: "completed",
                    })
                  }
                >
                  أكملت المحاولة
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    run({
                      type: "complete",
                      sessionId: session.id,
                      termination: "memory_failure",
                    })
                  }
                >
                  توقفت بسبب تعذر التذكر
                </Button>
              </>
            )}
            {id === "S09" && attempt && session.phase === "assessment" && (
              <>
                <Notice>
                  التقييم ذاتي V1. اترك غير المعلوم فارغًا؛ لا نملأ الأخطاء
                  بصفر.
                </Notice>
                <Field label="الكلمات التي حاولت تسميعها">
                  <input
                    type="number"
                    min="0"
                    value={words}
                    disabled={busy}
                    readOnly={completion === "complete" && Number(words) === state.units[attempt.unitId].definition.words}
                    onChange={(e) => { editAssessment(); setWords(e.target.value); }}
                  />
                </Field>
                <Field label="الأخطاء المعلومة">
                  <input
                    type="number"
                    min="0"
                    value={errors}
                    disabled={busy}
                    onChange={(e) => { editAssessment(); setErrors(e.target.value); }}
                  />
                </Field>
                <Field label="اكتمال النطاق">
                  <select
                    value={completion}
                    disabled={busy}
                    onChange={(e) => {
                      editAssessment();
                      const next = e.target.value as ManualObservation["completion"];
                      setCompletion(next);
                      // This explicit full-scope declaration supplies only the count, never quality.
                      if (next === "complete") setWords(String(state.units[attempt.unitId].definition.words));
                    }}
                  >
                    <option value="unknown">غير معلوم</option>
                    <option value="complete">كامل — {state.units[attempt.unitId].definition.words} كلمات</option>
                    <option value="partial">جزئي</option>
                  </select>
                </Field>
                <Field label="الجهد">
                  <select
                    value={effort}
                    disabled={busy}
                    onChange={(e) => {
                      editAssessment();
                      setEffort(e.target.value as ManualObservation["effort"]);
                    }}
                  >
                    <option value="unknown">غير معلوم</option>
                    <option value="hard">صعب</option>
                    <option value="normal">عادي</option>
                    <option value="easy">سهل</option>
                  </select>
                </Field>
                <label>
                  <input
                    type="checkbox"
                    checked={gap}
                    disabled={busy}
                    onChange={(e) => { editAssessment(); setGap(e.target.checked); }}
                  />
                  أؤكد خلو الفاصل من التعرض ذي الصلة
                </label>
                {!attempt.assessment && (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      run({
                        type: "assess",
                        attemptId: attempt.id,
                        observation,
                      })
                    }
                  >
                    حفظ الدليل اليدوي
                  </Button>
                )}
                {attempt.assessment && (
                  <>
                    {assessmentConflict && <Notice tone="warning">
                      تغيرت النتيجة المحفوظة أثناء تعديلك. بقيت مسودتك؛ راجع أحدث نتيجة قبل التصحيح.
                      <Button disabled={busy} variant="secondary" onClick={loadAssessment}>تحميل النتيجة المحفوظة</Button>
                    </Notice>}
                    {!observationChanged && <p>النتيجة المعروضة هي المحفوظة. لا ينشأ تصحيح جديد حتى تتغير ملاحظة.</p>}
                    <Field label="سبب تصحيح التقييم">
                      <input
                        value={correctionReason}
                        disabled={busy}
                        onChange={(e) => { editAssessment(); setCorrectionReason(e.target.value); }}
                      />
                    </Field>
                    <Button
                      disabled={busy || assessmentConflict || !observationChanged || !correctionReason.trim()}
                      onClick={() =>
                        run({
                          type: "correct",
                          attemptId: attempt.id,
                          revision: attempt.revision,
                          reason: correctionReason,
                          observation,
                        })
                      }
                    >
                      حفظ تصحيح مؤرخ للمحاولة الأصلية
                    </Button>
                  </>
                )}
                {state.assessments[attempt.id] && (
                  <p>
                    حكم المحرك:{" "}
                    {state.assessments[attempt.id].reasonCodes.join("، ")}
                  </p>
                )}
              </>
            )}
            {id === "S10" && (
              <>
                {session.phase === "paused" &&
                  session.previousPhase !== "recall" && (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        run({ type: "resume", sessionId: session.id })
                      }
                    >
                      استئناف المؤكد
                    </Button>
                  )}
                {(session.phase === "recall" ||
                  (session.phase === "paused" &&
                    session.previousPhase === "recall")) && (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      run({
                        type: "restart",
                        sessionId: session.id,
                        attemptId: crypto.randomUUID(),
                      })
                    }
                  >
                    بدء محاولة جديدة بعد الانقطاع
                  </Button>
                )}
              </>
            )}
            {id === "S12" && (
              <>
                <Field label="نوع بلاغ الخطأ">
                  <select
                    value={mistakeType}
                    onChange={(e) =>
                      setMistakeType(e.target.value as typeof mistakeType)
                    }
                  >
                    <option value="unknown">غير محدد</option>
                    <option value="word">لفظي</option>
                    <option value="link">ربط</option>
                    <option value="confusion">اشتباه</option>
                  </select>
                </Field>
                <Field label="درجة اليقين بالبلاغ">
                  <select
                    value={certainty}
                    onChange={(e) =>
                      setCertainty(e.target.value as typeof certainty)
                    }
                  >
                    <option value="suspected">مشتبه</option>
                    <option value="observed">مرصود</option>
                    <option value="disputed">متنازع عليه</option>
                  </select>
                </Field>
                <Field label="وصف موضع الخطأ إن عُرف">
                  <input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                  />
                </Field>
                <Button
                  disabled={busy}
                  onClick={() =>
                    run({
                      type: "mistake",
                      attemptId: attempt?.id ?? null,
                      mistakeType,
                      location: location.trim() || null,
                      certainty,
                    })
                  }
                >
                  حفظ بلاغ الخطأ للفحص
                </Button>
                <ul>
                  {state.mistakes.map((m, i) => (
                    <li key={i}>
                      {m.type} — {m.certainty} —{" "}
                      {m.location ?? "موضع غير معلوم"}؛ يحتاج فحصًا
                    </li>
                  ))}
                </ul>
              </>
            )}
            {session.phase !== "paused" && (
              <Button
                disabled={busy}
                onClick={() => run({ type: "pause", sessionId: session.id })}
              >
                إيقاف مؤقت
              </Button>
            )}
            <Button
              disabled={busy}
              onClick={() => run({ type: "end", sessionId: session.id })}
            >
              إنهاء الجلسة دون اختلاق تقييم
            </Button>
          </>
        )}
      </Card>
      {id === "S11" && (
        <Card>
          <p>
            ميزانية اليوم من إعداد المستخدم:{" "}
            {budget?.configured
              ? `${budget.minutes} دقيقة`
              : "غير مربوطة أو لم يعتمدها المستخدم"}
          </p>
          <Field label="الدقائق المنفقة فعلًا اليوم بإقرارك">
            <input
              type="number"
              min="0"
              value={spent}
              onChange={(e) => setSpent(e.target.value)}
            />
          </Field>
          {Object.keys(state.units).map((unitId) => (
            <Field key={unitId} label={`تقدير دقائق الوحدة ${unitId}`}>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={costs[unitId] ?? ""}
                onChange={(e) =>
                  setCosts({ ...costs, [unitId]: e.target.value })
                }
              />
            </Field>
          ))}
          <Notice>
            تقديرات المستخدم غير معايرة. يجب إدخال الوقت المنفق وكلفة الوحدات
            صراحة؛ لا تُفترض ثلاثة دقائق أو صفر إنجاز.
          </Notice>
          <Button disabled={busy || !budget?.configured} onClick={plan}>
            حساب التعاهد من حالة المحرك
          </Button>
          {state.plans.at(-1)?.tasks.map((t) => (
            <p key={t.id}>
              {t.unitId}: {t.decisionReason}
            </p>
          ))}
          {state.plans.at(-1)?.deferred.map((t) => (
            <p key={t.id}>
              مؤجل {t.unitId}: {t.decisionReason} — لم يُراجع
            </p>
          ))}
        </Card>
      )}
      {id === "S13" && (
        <Card>
          <Field label="أيام الانقطاع">
            <input
              type="number"
              min="0"
              value={absence}
              onChange={(e) => setAbsence(Number(e.target.value))}
            />
          </Field>
          <Button
            disabled={busy || !budget?.configured}
            onClick={() =>
              budget?.configured &&
              run({
                type: "recover",
                absenceDays: absence,
                seed: 42,
                minutes: budget.minutes,
              })
            }
          >
            إنشاء خطة فحص الاستعادة
          </Button>
          <p>
            عينة الاستعادة: {JSON.stringify(state.recoveries.at(-1) ?? null)}
          </p>
        </Card>
      )}
    </section>
  );
}
