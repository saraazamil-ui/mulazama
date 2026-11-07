import type {
  AssessmentInput,
  Attempt,
  AttemptKind,
  MistakeDraft,
  PlanConfig,
  Preferences,
  PrototypeState,
  RangeSelection,
} from "./contracts";
import { normalizeRanges, validateRange } from "./ranges";
import { canonical } from "../core/types";

export const newId = (prefix = "id"): string =>
  `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
export function initialState(idFactory = newId): PrototypeState {
  return {
    schemaVersion: 1,
    revision: 0,
    profileId: idFactory("profile"),
    config: {
      persona: "beginner",
      minutes: 30,
      days: [0, 1, 2, 3, 4],
      goal: "memorize",
      startSurah: 1,
      zoneId: "Asia/Riyadh",
      configured: false,
    },
    ranges: [],
    session: null,
    attempts: [],
    mistakes: [],
    corrections: [],
    preferences: {
      dark: false,
      largeText: false,
      reducedMotion: false,
      reminder: false,
    },
    processedCommands: {},
    recoveryReport: "skipped",
    todayBudget: null,
  };
}
type Meta = { commandId?: string; expectedRevision?: number; now?: string };
export type Action = Meta &
  (
    | { type: "config"; config: PlanConfig }
    | { type: "plan.todayBudget"; minutes: number; localDate: string }
    | { type: "range.add"; range: RangeSelection }
    | { type: "range.remove"; id: string }
    | {
        type: "session.start";
        kind: AttemptKind;
        rangeLabel: string;
        taskId?: string;
      }
    | { type: "session.pause" }
    | { type: "session.resume" }
    | { type: "session.end" }
    | { type: "session.restartRecall" }
    | { type: "session.finishedBeforeStop" }
    | { type: "session.repeat" }
    | { type: "session.startRecall" }
    | { type: "attempt.hint" }
    | { type: "attempt.reveal" }
    | { type: "attempt.finish"; termination?: "completed" | "memory_failure" }
    | { type: "attempt.assess"; input: AssessmentInput }
    | {
        type: "attempt.correct";
        id: string;
        input: AssessmentInput;
        reason: string;
      }
    | {
        type: "mistake.add";
        draft: Omit<
          MistakeDraft,
          "id" | "revision" | "createdAt" | "treatment"
        >;
      }
    | {
        type: "mistake.correct";
        id: string;
        patch: Partial<
          Pick<
            MistakeDraft,
            | "location"
            | "type"
            | "certainty"
            | "selfCorrected"
            | "assistanceUsed"
            | "note"
            | "treatment"
          >
        >;
        reason: string;
      }
    | { type: "preferences"; patch: Partial<Preferences> }
    | { type: "recovery.report"; value: PrototypeState["recoveryReport"] }
    | { type: "reset" }
  );
export type TransitionResult =
  | { ok: true; state: PrototypeState; message: string }
  | { ok: false; state: PrototypeState; error: string };

export function currentRiyadhDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function isLocalDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

/** Select a user-entered budget only; no reserve, cost, or HME planning logic. */
export function effectiveBudget(
  state: PrototypeState,
  localDate = currentRiyadhDate(),
): number {
  return state.todayBudget?.localDate === localDate
    ? state.todayBudget.minutes
    : state.config.minutes;
}
export function validateConfig(c: PlanConfig): string | null {
  if (
    !c ||
    !["beginner", "scattered", "returning", "regular", "complete"].includes(
      c.persona,
    )
  )
    return "اختر وصفًا لحالك.";
  if (!Number.isSafeInteger(c.minutes) || c.minutes < 0 || c.minutes > 1440)
    return "حدد وقتًا صحيحًا بين 0 و1440 دقيقة.";
  if (
    !Array.isArray(c.days) ||
    (c.days.length === 0 && c.minutes !== 0) ||
    c.days.length > 7 ||
    new Set(c.days).size !== c.days.length ||
    c.days.some((d) => !Number.isSafeInteger(d) || d < 0 || d > 6)
  )
    return "اختر يوم دراسة واحدًا على الأقل، أو وقتًا صفرًا للتوقف الصريح.";
  if (
    !Number.isSafeInteger(c.startSurah) ||
    c.startSurah < 1 ||
    c.startSurah > 114
  )
    return "حدد سورة بداية صحيحة.";
  if (
    !["memorize", "maintain"].includes(c.goal) ||
    c.zoneId !== "Asia/Riyadh" ||
    typeof c.configured !== "boolean"
  )
    return "إعداد الخطة غير متوافق.";
  return null;
}
export function assessmentIssues(
  attempt: Attempt,
  input: AssessmentInput,
  mistakes: MistakeDraft[],
): string[] {
  const issues: string[] = [];
  if (input.completion === "unknown") issues.push("اكتمال النطاق غير معلوم");
  if (input.errorObservation === "unknown") issues.push("الأخطاء غير معلومة");
  if (
    input.errorObservation === "none" &&
    mistakes.some((m) => m.attemptId === attempt.id)
  )
    issues.push("توجد بلاغات خطأ؛ لا يمكن اعتبار الأخطاء صفرًا معلومًا");
  if (attempt.hints > 0 || attempt.revealed)
    issues.push("سُجلت مساعدة؛ لا يعد ذلك استرجاعًا مستقلًا");
  if (attempt.termination === "memory_failure")
    issues.push("صُرّح بتعذر الإكمال بسبب الذاكرة");
  if (attempt.timingUnverified)
    issues.push("وقت الإتمام والاستمرار الزمني غير متحققين بعد الانقطاع");
  return issues;
}
function validAssessment(i: AssessmentInput): boolean {
  return (
    !!i &&
    ["complete", "partial", "unknown"].includes(i.completion) &&
    ["none", "present", "unknown"].includes(i.errorObservation) &&
    ["hard", "normal", "easy", "unknown"].includes(i.effort)
  );
}
/** Product interaction state only. Never computes a rating, FSRS state, mastery gate, or Quran text. */
export function transition(
  state: PrototypeState,
  action: Action,
  idFactory = newId,
): TransitionResult {
  const newId = idFactory;
  const reject = (error: string): TransitionResult => ({
    ok: false,
    state,
    error,
  });
  const { commandId, expectedRevision, now, ...payload } = action;
  if (
    commandId &&
    (commandId.length > 200 ||
      ["__proto__", "constructor", "prototype"].includes(commandId))
  )
    return reject("معرّف الأمر غير صالح.");
  const fingerprint = canonical(payload);
  if (commandId && Object.hasOwn(state.processedCommands, commandId))
    return state.processedCommands[commandId] === fingerprint
      ? { ok: true, state, message: "الأمر محفوظ سابقًا؛ لم يتكرر." }
      : reject("تعارض: استُخدم معرّف الأمر بمحتوى مختلف.");
  if (expectedRevision !== undefined && expectedRevision !== state.revision)
    return reject("تغيرت نسخة البيانات؛ أعد قراءة الحالة قبل المحاولة.");
  const at = now ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(at))) return reject("وقت الأمر غير صالح.");
  let next: PrototypeState = structuredClone(state);
  let message = "حُفظ الإجراء في الحالة التجريبية.";
  const session = next.session;
  const attempt = session?.attemptId
    ? next.attempts.find((a) => a.id === session.attemptId)
    : undefined;
  switch (action.type) {
    case "plan.todayBudget": {
      if (
        !isLocalDate(action.localDate) ||
        !Number.isSafeInteger(action.minutes) ||
        action.minutes < 0 ||
        action.minutes > 1440
      )
        return reject("حدد يومًا صالحًا ووقتًا صحيحًا بين 0 و1440 دقيقة.");
      next.todayBudget = {
        localDate: action.localDate,
        minutes: action.minutes,
      };
      message =
        "حُفظ وقت هذا اليوم فقط. بقيت الأيام والوقت المعتاد والسجل دون تغيير؛ إعادة التخطيط الفعلية تنتظر المحرك.";
      break;
    }
    case "config": {
      const error = validateConfig(action.config);
      if (error) return reject(error);
      next.config = {
        ...action.config,
        days: [...action.config.days],
        configured: true,
      };
      message = "حُفظ الإعداد التجريبي؛ الخطة مثال واجهة وليست ناتج المحرك.";
      break;
    }
    case "range.add": {
      const error = validateRange(action.range);
      if (error) return reject(error);
      const existing = next.ranges.find((r) => r.id === action.range.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(action.range))
        return reject("تعارض في معرّف النطاق؛ استخدم معرّفًا جديدًا.");
      next.ranges = normalizeRanges([...next.ranges, action.range]);
      message = "أضيف نطاق معلن غير مختبر؛ لم تتغير بقية النطاقات.";
      break;
    }
    case "range.remove":
      next.ranges = next.ranges.filter((r) => r.id !== action.id);
      break;
    case "session.start": {
      if (session) return reject("لديك جلسة مفتوحة؛ استأنفها أو أنهها أولًا.");
      if (!action.rangeLabel.trim()) return reject("حدد مرجع النطاق.");
      const phase = action.kind === "new" ? "training" : "recall";
      next.session = {
        id: newId("session"),
        kind: action.kind,
        rangeLabel: action.rangeLabel,
        taskId: action.taskId ?? null,
        phase,
        previousPhase: phase,
        repeats: 0,
        attemptId: null,
        startedAt: at,
        updatedAt: at,
        demonstration: true,
      };
      if (phase === "recall") startRecall(next, at, idFactory);
      message = "بدأت محاكاة التفاعل فقط؛ لا تُسجل أدلة تعلم معتمدة.";
      break;
    }
    case "session.pause":
      if (!session) return reject("لا توجد جلسة مفتوحة.");
      if (session.phase !== "paused") {
        session.previousPhase = session.phase;
        session.phase = "paused";
      }
      break;
    case "session.resume":
      if (!session) return reject("لا توجد جلسة لاستئنافها.");
      if (
        session.phase === "recall" ||
        (session.phase === "paused" && session.previousPhase === "recall")
      )
        return reject(
          "التسميع المنقطع يحتاج محاولة جديدة، أو تقييمًا صريحًا إن كنت أنهيته.",
        );
      if (session.phase === "paused") session.phase = session.previousPhase;
      message = "استؤنفت الحالة التجريبية مع بقاء المساعدة والبلاغات.";
      break;
    case "session.restartRecall":
      if (!session || !attempt || attempt.assessed)
        return reject("لا توجد محاولة منقطعة لبدء بديل عنها.");
      attempt.termination = attempt.termination ?? "user_stop";
      attempt.endedAt = attempt.endedAt ?? at;
      attempt.status = "incomplete";
      startRecall(next, at, idFactory);
      message =
        "بدأت محاولة جديدة؛ السابقة محفوظة غير مكتملة ولا يربط التسميعان كدليل واحد.";
      break;
    case "session.finishedBeforeStop":
      if (!session || !attempt || attempt.assessed)
        return reject("لا توجد محاولة غير مقيمة.");
      attempt.termination = "completed";
      attempt.endedAt = at;
      attempt.status = "disputed";
      attempt.timingUnverified = true;
      session.phase = "assessment";
      session.previousPhase = "assessment";
      message =
        "قيّم ما تتذكره صراحة؛ الاستمرار الزمني ووقت الإتمام السابق غير متحققين.";
      break;
    case "session.end":
      if (attempt && !attempt.assessed) {
        attempt.termination = attempt.termination ?? "user_stop";
        attempt.status = "incomplete";
        attempt.endedAt = attempt.endedAt ?? at;
      }
      next.session = null;
      message = "انتهت الجلسة؛ لا نجاح ولا فشل من التوقف وحده.";
      break;
    case "session.repeat":
      if (!session || session.phase !== "training")
        return reject("التكرار متاح داخل التدريب فقط.");
      session.repeats++;
      message = "سُجل تكرار تدريبي تجريبي؛ لا يثبت الحفظ.";
      break;
    case "session.startRecall":
      if (!session || session.phase !== "training")
        return reject("ابدأ من جلسة التدريب.");
      startRecall(next, at, idFactory);
      break;
    case "attempt.hint":
    case "attempt.reveal":
      if (!attempt || session?.phase !== "recall")
        return reject("ابدأ التسميع أولًا.");
      attempt.hints++;
      if (action.type === "attempt.reveal") attempt.revealed = true;
      message = "سُجل طلب المساعدة. النص المعتمد غير متاح في هذا النموذج.";
      break;
    case "attempt.finish":
      if (!attempt || session?.phase !== "recall")
        return reject("لا توجد محاولة نشطة.");
      attempt.termination = action.termination ?? "completed";
      attempt.endedAt = at;
      session.phase = "assessment";
      session.previousPhase = "assessment";
      break;
    case "attempt.assess": {
      if (!attempt || session?.phase !== "assessment")
        return reject("أكمل المحاولة قبل تقييمها.");
      if (attempt.assessed)
        return reject("التقييم محفوظ؛ استخدم تصحيح التقييم.");
      if (!validAssessment(action.input))
        return reject("حقول التقييم غير صالحة.");
      Object.assign(attempt, action.input);
      attempt.assessed = true;
      attempt.revision++;
      attempt.status = assessmentIssues(attempt, action.input, next.mistakes)
        .length
        ? "disputed"
        : "reported";
      message =
        "حُفظ تقريرك الذاتي التجريبي. التقييم الفعال والجدولة والإتقان غير محسوبة.";
      break;
    }
    case "attempt.correct": {
      const target = next.attempts.find((a) => a.id === action.id);
      if (!target?.assessed) return reject("لا يوجد تقييم محفوظ لتصحيحه.");
      if (!validAssessment(action.input) || !action.reason.trim())
        return reject("أكمل التصحيح وسببه.");
      next.corrections.push({
        id: newId("correction"),
        entity: "attempt",
        targetId: target.id,
        at,
        previous: structuredClone(target),
        reason: action.reason,
      });
      Object.assign(target, action.input);
      target.revision++;
      target.status = assessmentIssues(target, action.input, next.mistakes)
        .length
        ? "disputed"
        : "reported";
      message = "حُفظ التصحيح مع الأصل؛ لم تنشأ محاولة جديدة.";
      break;
    }
    case "mistake.add": {
      if (
        action.draft.attemptId &&
        !next.attempts.some((a) => a.id === action.draft.attemptId)
      )
        return reject("المحاولة المرتبطة غير موجودة.");
      const draft: MistakeDraft = {
        ...action.draft,
        id: newId("mistake"),
        revision: 0,
        createdAt: at,
        treatment: "open",
      };
      next.mistakes.push(draft);
      const linked = next.attempts.find((a) => a.id === draft.attemptId);
      if (linked) {
        linked.mistakeIds.push(draft.id);
        if (linked.assessed) linked.status = "disputed";
      }
      message = "حُفظ بلاغ الخطأ؛ التفاصيل المجهولة تبقى غير معلومة.";
      break;
    }
    case "mistake.correct": {
      const target = next.mistakes.find((m) => m.id === action.id);
      if (!target || !action.reason.trim())
        return reject("حدد البلاغ وسبب التصحيح.");
      next.corrections.push({
        id: newId("correction"),
        entity: "mistake",
        targetId: target.id,
        at,
        previous: structuredClone(target),
        reason: action.reason,
      });
      Object.assign(target, action.patch);
      target.revision++;
      message = "حُفظ التصحيح؛ المعالجة لا تثبت نجاح إعادة الاختبار.";
      break;
    }
    case "preferences":
      if (Object.values(action.patch).some((v) => typeof v !== "boolean"))
        return reject("تفضيل غير صالح.");
      next.preferences = { ...next.preferences, ...action.patch };
      break;
    case "recovery.report":
      if (!["yes", "no", "unknown", "skipped"].includes(action.value))
        return reject("اختر إجابة صالحة عن المراجعة الخارجية.");
      next.recoveryReport = action.value;
      message =
        "حُفظ تقرير عام عن التعاهد الخارجي؛ لم تُنشأ مراجعات أو نتائج لكل مقطع.";
      break;
    case "reset": {
      next = initialState(idFactory);
      next.config = { ...state.config, days: [...state.config.days] };
      next.preferences = { ...state.preferences };
      message =
        "حُذفت بيانات التعلم التجريبية. بقيت التفضيلات دون تاريخ إنجاز، بهوية جديدة.";
      break;
    }
  }
  if (next.session) next.session.updatedAt = at;
  next.revision = state.revision + 1;
  if (commandId) next.processedCommands[commandId] = fingerprint;
  return { ok: true, state: next, message };
}
function startRecall(state: PrototypeState, at: string, newId: (prefix?: string) => string): void {
  const session = state.session!;
  const id = newId("attempt");
  const attempt: Attempt = {
    id,
    kind: session.kind,
    rangeLabel: session.rangeLabel,
    taskId: session.taskId,
    startedAt: at,
    endedAt: null,
    termination: null,
    hints: 0,
    revealed: false,
    mistakeIds: [],
    completion: "unknown",
    errorObservation: "unknown",
    effort: "unknown",
    revision: 0,
    assessed: false,
    source: "V1",
    testOpportunityId: newId("opportunity"),
    evidenceClusterId: newId("cluster"),
    timingUnverified: false,
    strictPass: null,
    effectiveRating: null,
    status: "incomplete",
  };
  state.attempts.push(attempt);
  session.attemptId = id;
  session.phase = "recall";
  session.previousPhase = "recall";
}
