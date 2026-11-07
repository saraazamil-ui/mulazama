import {
  CONTRACT_NAMES,
  type ContractId,
  type ContractRequestMap,
  type ContractResponseMap,
  type DailyPlan,
  type MockTask,
  type PrototypeState,
  type QueryMeta,
  type Result,
  type TypedMockInterfaces,
} from "./contracts";
import { inspectBackup } from "./storage";
import { assessmentIssues, currentRiyadhDate, effectiveBudget } from "./state";
import { rangeLabel } from "./ranges";

export const MOCK_NOTICE =
  "بيانات تجريبية لا تنفذ HME ولا تنتج دليل حفظ أو نتيجة إتقان.";
export function mockMeta(state: PrototypeState): QueryMeta {
  return {
    asOf: "2026-11-05T09:00:00.000Z",
    projectionVersion: "prototype-1",
    sourceWatermark: state.revision,
    source: "mock",
    learningEvidence: false,
    versions: {
      prototype: "04-B",
      algorithmVersion: null,
      policyVersion: null,
      rubricVersion: null,
      methodVersion: null,
      editionId: "prototype-unverified",
      tokenizationVersion: null,
    },
  };
}
const emptyDates = {
  rawModelDueAt: null,
  policyDueAt: null,
  plannedAt: null,
  originalDueAt: null,
  latestAllowedAt: null,
};
const fixtures: Array<[string, MockTask["kind"], string, number]> = [
  ["R1", "review", "إصلاح موضع متكرر", 6],
  ["E1", "review", "اختبار اليوم التالي", 7],
  ["E2", "review", "مراجعة قريبة", 5],
  ["O1", "maintenance", "تعاهد قديم بلغ السقف", 7],
  ["O2", "maintenance", "تعاهد قديم قارب السقف", 8],
  ["G34", "link", "مقطعان ورابطهما", 16],
  ["M1", "review", "مراجعة عالية الأولوية", 9],
  ["M2", "review", "مراجعة إضافية", 7],
  ["L2", "link", "اختبار رابط مستقل", 4],
  ["N1", "new", "تدريب مقدار جديد", 12],
  ["N2", "new", "تدريب المقدار التالي", 16],
];
/** Exact static planning examples from HME §19-b; selection is a fixture lookup, never a scheduler. */
export function mockDailyPlan(
  state: PrototypeState,
  scenario: "normal" | "capacity" | "empty" = "normal",
  localDate = currentRiyadhDate(),
): DailyPlan {
  const meta = mockMeta(state);
  const budget = effectiveBudget(state, localDate);
  if (scenario === "empty" || !state.config.configured)
    return {
      meta,
      revision: state.revision,
      tasks: [],
      deferred: [],
      capacityStatus: "uncertain",
      reason: "أكمل الإعداد لعرض عينة التفاعل، أو غيّر حالة العرض الفارغ.",
      plannedMinutes: null,
    };
  const maintenanceOnly =
    state.config.goal === "maintain" || state.config.persona === "complete";
  const range = state.ranges[0]
    ? rangeLabel(state.ranges[0])
    : `نطاق عرض تجريبي من السورة ${state.config.startSurah}`;
  if (
    budget === 0 &&
    state.config.persona === "beginner" &&
    state.ranges.length === 0
  )
    return {
      meta,
      revision: state.revision,
      tasks: [],
      deferred: [],
      capacityStatus: "uncertain",
      reason:
        "وقتك اليوم صفر؛ لم تُغيّر الأيام أو الوقت المعتاد، ولا توجد مراجعات سابقة معلنة.",
      plannedMinutes: null,
    };
  // A beginner has no prior repair/review obligation. This is a single display
  // fixture, not a new scheduling rule or inferred learning requirement.
  if (
    state.config.persona === "beginner" &&
    state.ranges.length === 0 &&
    scenario === "normal"
  ) {
    if (maintenanceOnly)
      return {
        meta,
        revision: state.revision,
        tasks: [],
        deferred: [],
        capacityStatus: "uncertain",
        reason:
          "أضف نطاقًا معلنًا لتجربة التعاهد. لا ننشئ مراجعة لمحفوظ غير موجود.",
        plannedMinutes: null,
      };
    const task: MockTask = {
      ...emptyDates,
      id: "fixture-N1",
      kind: "new",
      title: "تجربة خطوات الحفظ الجديد",
      rangeLabel: range,
      plannedCostSnapshot: 12,
      executionStatus: state.attempts.some(
        (a) =>
          a.taskId === "fixture-N1" &&
          a.kind === "new" &&
          a.rangeLabel === range &&
          a.assessed,
      )
        ? "performed"
        : "pending",
      outcome: "not_measured",
      reasonCode: "BEGINNER_NEW_DEMO",
      reason:
        "مهمة عرض ثابتة N1 من HME §19 ب، لتجربة واجهة التدريب فقط. لا توجد مراجعات سابقة ولا عينة تشخيص للمبتدئ؛ لا وقت شخصي مقدّر.",
    };
    return {
      meta,
      revision: state.revision,
      tasks: [task],
      deferred: [],
      capacityStatus: "uncertain",
      reason:
        "ابدأ بتجربة التدريب الجديد. العدد والوقت والخطة التعليمية ينتظرون المحتوى والمحرك المعتمدين.",
      plannedMinutes: null,
    };
  }
  const selected =
    budget === 0
      ? 0
      : budget === 120
        ? maintenanceOnly
          ? 9
          : 11
        : budget === 60
          ? 6
          : 4;
  const plannedMinutes =
    budget === 120
      ? maintenanceOnly
        ? 69
        : 97
      : budget === 60
        ? 49
        : budget === 30
          ? 25
          : null;
  const all: MockTask[] = fixtures
    .filter(([, kind]) => !maintenanceOnly || kind !== "new")
    .map(([id, kind, title, plannedCostSnapshot], index) => ({
      id: `fixture-${id}`,
      kind,
      title,
      rangeLabel: range,
      plannedCostSnapshot,
      executionStatus: state.attempts.some(
        (a) =>
          a.taskId === `fixture-${id}` &&
          a.kind === kind &&
          a.rangeLabel === range &&
          a.assessed,
      )
        ? "performed"
        : index < selected
          ? "pending"
          : "deferred",
      outcome: "not_measured",
      reasonCode: `FIXTURE_${id}`,
      reason:
        "لقطة صناعية ثابتة من مثال HME §19 ب، ليست تكليفًا شخصيًا ولا ناتج جدولة.",
      rawModelDueAt: null,
      originalDueAt: "2026-11-03T09:00:00.000Z",
      policyDueAt: "2026-11-03T09:00:00.000Z",
      plannedAt: index < selected ? "2026-11-05T09:00:00.000Z" : null,
      latestAllowedAt: null,
    }));
  return {
    meta,
    revision: state.revision,
    tasks: all.slice(0, selected),
    deferred: all.slice(selected),
    capacityStatus: scenario === "capacity" ? "infeasible" : "uncertain",
    reason:
      budget === 0
        ? "وقتك اليوم صفر؛ أُبقيت الالتزامات التجريبية مؤجلة بأصل استحقاقها دون حذف أو تقييم."
        : scenario === "capacity"
          ? "محاكاة تعارض قدرة: بقيت التزامات مؤجلة؛ لا حذف للاستحقاق ولا وعد بإنجاز الجميع."
          : plannedMinutes === null
            ? "تغير وقتك. لا توجد لقطة محرك لهذا الوقت؛ تعرض أمثلة التفاعل دون مجموع شخصي."
            : "الأزمنة لقطة صناعية مرجعية وليست أزمنة مضمونة أو خطة شخصية محسوبة.",
    plannedMinutes,
  };
}
type Handlers = {
  [K in ContractId]: (
    input: ContractRequestMap[K],
    state: PrototypeState,
  ) => Result<ContractResponseMap[K]>;
};
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const handlers: Handlers = {
  C01: (_input, state) =>
    ok({
      meta: mockMeta(state),
      status: "unavailable",
      editionId: "prototype-unverified",
      quranText: null,
      pageMap: null,
      source: null,
      license: null,
      hash: null,
      reason:
        "لم تُضمّن حزمة نص قرآني معتمدة. النموذج يعرض مراجع ونقاط حجز فقط؛ لا يولّد آيات.",
    }),
  C02: (input, state) =>
    input.operation === "save"
      ? {
          ok: false,
          error: {
            code: "CONSENT_REQUIRED",
            scope: "C02",
            retryable: false,
            message: "الاستعلام لا يحفظ إعدادًا.",
            action:
              "مرر أمر config إلى transition ثم أكد نجاح التخزين التجريبي.",
          },
        }
      : ok({ meta: mockMeta(state), config: structuredClone(state.config) }),
  C03: (input, state) =>
    ok({
      meta: mockMeta(state),
      reason: input.operation,
      sample: state.ranges.slice(0, 1),
      untested: state.ranges.slice(1),
      source: "mock",
      outsideReview: input.outsideReview ?? state.recoveryReport,
    }),
  C04: (input, state) =>
    ok(mockDailyPlan(state, input.scenario, input.localDate)),
  C05: (_input, state) =>
    ok({
      meta: mockMeta(state),
      checkpoint: state.session ? structuredClone(state.session) : null,
    }),
  C06: (_input, state) =>
    ok({
      meta: mockMeta(state),
      confirmedRepetitions: state.session?.repeats ?? 0,
      mastery: null,
    }),
  C07: (input, state) => {
    const attempt = state.attempts.find((a) => a.id === input.attemptId);
    if (!attempt)
      return {
        ok: false,
        error: {
          code: "INVALID_INPUT",
          scope: "C07",
          retryable: false,
          message: "المحاولة غير موجودة.",
          action: "عد إلى سجل المحاولات.",
        },
      };
    const issues = assessmentIssues(attempt, attempt, state.mistakes);
    return ok({
      meta: mockMeta(state),
      attempt: structuredClone(attempt),
      effectiveRating: null,
      strictPass: null,
      reviewEvent: null,
      nextAction: "await_engine",
      reason: issues.length
        ? issues.join("؛ ")
        : "تقرير ذاتي فقط؛ الأهلية والتقييم والجدولة تنتظر المحرك المعتمد.",
      dates: emptyDates,
    });
  },
  C08: (input, state) =>
    ok({
      meta: mockMeta(state),
      drafts: structuredClone(
        input.attemptId
          ? state.mistakes.filter((m) => m.attemptId === input.attemptId)
          : state.mistakes,
      ),
    }),
  C09: (_input, state) => {
    const missing = {
      value: null,
      status: "not_measured" as const,
      reason: "لا يوجد محرك أو محتوى معتمد لتوليد هذا القياس.",
      evidenceIds: [],
    };
    return ok({
      meta: mockMeta(state),
      declaredRanges: structuredClone(state.ranges),
      acquired: missing,
      stable: missing,
      links: missing,
      globalCoverage: missing,
      attemptCount: state.attempts.length,
      source: "V1",
      parts: Array.from({ length: 30 }, (_, i) => {
        const declared = state.ranges.some(
          (r) => r.kind === "juz" && r.start <= i + 1 && r.end >= i + 1,
        );
        return {
          juz: i + 1,
          status: declared
            ? ("declared_unassessed" as const)
            : ("not_measured" as const),
          label: declared
            ? "معلن غير مختبر"
            : "غير مقاس؛ خرائط الأنواع الأخرى غير معتمدة",
        };
      }),
    });
  },
  C10: (input, state) =>
    ok({
      meta: mockMeta(state),
      status: "insufficient_data",
      reason:
        "لا توجد بيانات تعلم معتمدة أو نموذج توقع مفعّل. تغيير وقت المعاينة لا يغيّر خطتك.",
      horizons: { 1: null, 3: null, 6: null, 12: null },
      initialCompletionDate: null,
      previewMinutes: input.minutes ?? state.config.minutes,
      changesPlan: false,
    }),
  C11: (_input, state) =>
    ok({
      meta: mockMeta(state),
      preferences: { ...state.preferences },
      engineAvailable: false,
      migrationAvailable: false,
    }),
  C12: (input, _state) => ok(inspectBackup(input.serialized)),
  C13: (_input, state) =>
    ok({
      meta: mockMeta(state),
      permission: "not_requested",
      scheduled: false,
      candidates: [],
      reason: "تفضيل تذكير تجريبي؛ لم يطلب النموذج إذنًا ولم يجدول إشعار نظام.",
    }),
  C14: (_input, state) =>
    ok({
      meta: mockMeta(state),
      available: false,
      recordingRef: null,
      microphoneRequested: false,
      reason:
        "الصوت والتسجيل غير مفعّلين. يعمل مسار المحاكاة اليدوي دون ميكروفون.",
    }),
};
export function createMockInterfaces(): TypedMockInterfaces {
  return {
    query<K extends ContractId>(
      contract: K,
      input: ContractRequestMap[K],
      state: PrototypeState,
    ): Result<ContractResponseMap[K]> {
      return handlers[contract](input, state);
    },
  };
}
export const mockContracts = createMockInterfaces();
export const contractCatalog = Object.entries(CONTRACT_NAMES).map(
  ([id, name]) => ({
    id: id as ContractId,
    name,
    implementation: "typed mock only" as const,
  }),
);
