import type { Action } from "../domain/state";
import { isLocalDate } from "../domain/state";
import type { ContractId } from "../domain/contracts";
import { DomainError } from "../core/types";

type RecordValue = Record<string, unknown>;
const META = ["commandId", "expectedRevision", "now"] as const;
const DANGEROUS = new Set(["__proto__", "prototype", "constructor"]);
const error = (message: string): never => {
  throw new DomainError("INVALID_INPUT", message);
};

/** Reject inherited fields, accessors, symbol keys and extension keys before reading values. */
function object(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return error("يلزم كائن بيانات صالح.");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    return error("لا تقبل البيانات ذات الحقول الموروثة.");
  const allowed = new Set([...required, ...optional]);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || DANGEROUS.has(key) || !allowed.has(key))
      return error("توجد حقول غير مسموح بها.");
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in descriptor) || !descriptor.enumerable)
      return error("لا تقبل حقول الوصول أو الحقول المخفية.");
  }
  for (const key of required)
    if (!Object.hasOwn(value, key)) return error("توجد حقول إلزامية مفقودة.");
  return value as RecordValue;
}
function identifier(value: unknown): void {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 200 ||
    DANGEROUS.has(value) ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    error("معرف غير صالح.");
}
function text(value: unknown, maximum = 4000, required = false): void {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    (required && !value.trim())
  )
    error("نص غير صالح أو أطول من الحد المسموح.");
}
function integer(value: unknown, minimum: number, maximum: number): void {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  )
    error("قيمة عددية غير صالحة.");
}
function member(value: unknown, values: readonly string[]): void {
  if (typeof value !== "string" || !values.includes(value))
    error("قيمة اختيار غير صالحة.");
}
function boolean(value: unknown): void {
  if (typeof value !== "boolean") error("يلزم اختيار منطقي صريح.");
}
function nullableBoolean(value: unknown): void {
  if (value !== null) boolean(value);
}
function optional(
  value: RecordValue,
  key: string,
  check: (field: unknown) => void,
): void {
  if (value[key] !== undefined) check(value[key]);
}
function utc(value: unknown): void {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  )
    error("يلزم وقت UTC مطلق بدقة الثواني.");
  const source = value as string;
  const timestamp = new Date(source);
  const normalized = source.includes(".")
    ? source.replace(
        /\.(\d{1,3})Z$/,
        (_, fraction: string) => "." + fraction.padEnd(3, "0") + "Z",
      )
    : source.replace("Z", ".000Z");
  if (
    !Number.isFinite(timestamp.getTime()) ||
    timestamp.toISOString() !== normalized
  )
    error("وقت غير صالح.");
}
function localDate(value: unknown): void {
  if (!isLocalDate(value)) error("التاريخ المحلي غير صالح.");
}
function minutes(value: unknown): void {
  integer(value, 0, 1440);
}
function meta(value: RecordValue): void {
  optional(value, "commandId", identifier);
  optional(value, "expectedRevision", (v) =>
    integer(v, 0, Number.MAX_SAFE_INTEGER),
  );
  optional(value, "now", utc);
}
function config(value: unknown): void {
  const c = object(value, [
    "persona",
    "minutes",
    "days",
    "goal",
    "startSurah",
    "zoneId",
    "configured",
  ]);
  member(c.persona, [
    "beginner",
    "scattered",
    "returning",
    "regular",
    "complete",
  ]);
  minutes(c.minutes);
  integer(c.startSurah, 1, 114);
  member(c.goal, ["memorize", "maintain"]);
  member(c.zoneId, ["Asia/Riyadh"]);
  boolean(c.configured);
  if (
    !Array.isArray(c.days) ||
    c.days.length > 7 ||
    (c.days.length === 0 && c.minutes !== 0)
  )
    error("أيام النشاط غير صالحة.");
  const days = c.days as unknown[];
  if (
    Object.getPrototypeOf(days) !== Array.prototype ||
    Object.keys(days).length !== days.length
  )
    error("أيام النشاط غير صالحة.");
  for (const key of Reflect.ownKeys(days)) {
    if (key === "length") continue;
    if (
      typeof key !== "string" ||
      !/^\d+$/.test(key) ||
      String(Number(key)) !== key ||
      Number(key) >= days.length
    )
      error("توجد حقول غير مسموح بها في أيام النشاط.");
    const descriptor = Object.getOwnPropertyDescriptor(days, key)!;
    if (!("value" in descriptor) || !descriptor.enumerable)
      error("لا تقبل أيام النشاط ذات حقول الوصول.");
  }
  if (new Set(days).size !== days.length) error("أيام النشاط مكررة.");
  for (let i = 0; i < days.length; i++) integer(days[i], 0, 6);
}
function range(value: unknown): void {
  const r = object(
    value,
    ["id", "kind", "start", "end", "editionId", "status"],
    ["surah", "layoutId"],
  );
  identifier(r.id);
  member(r.kind, ["surah", "juz", "page", "ayah"]);
  member(r.editionId, ["prototype-unverified"]);
  member(r.status, ["declared_unassessed"]);
  const limit =
    r.kind === "surah"
      ? 114
      : r.kind === "juz"
        ? 30
        : r.kind === "page"
          ? 10000
          : 1000;
  integer(r.start, 1, limit);
  integer(r.end, r.start as number, limit);
  if (r.kind === "ayah") integer(r.surah, 1, 114);
  else if (r.surah !== undefined) error("مرجع السورة خاص بنطاق الآيات.");
  if (r.kind === "page") identifier(r.layoutId);
  else if (r.layoutId !== undefined) error("مرجع الطبعة خاص بنطاق الصفحات.");
}
const MISTAKE_FIELDS = [
  "location",
  "type",
  "certainty",
  "selfCorrected",
  "assistanceUsed",
  "note",
  "treatment",
] as const;
function mistakeFields(value: RecordValue): void {
  if (Object.hasOwn(value, "location") && value.location !== null)
    text(value.location, 1000, true);
  if (Object.hasOwn(value, "type"))
    member(value.type, ["word", "link", "confusion", "unknown"]);
  if (Object.hasOwn(value, "certainty"))
    member(value.certainty, ["observed", "suspected", "disputed"]);
  if (Object.hasOwn(value, "selfCorrected"))
    nullableBoolean(value.selfCorrected);
  if (Object.hasOwn(value, "assistanceUsed"))
    nullableBoolean(value.assistanceUsed);
  if (Object.hasOwn(value, "note")) text(value.note);
  if (Object.hasOwn(value, "treatment"))
    member(value.treatment, ["open", "awaiting_retest"]);
}
function assessment(value: unknown): void {
  const input = object(value, ["completion", "errorObservation", "effort"]);
  member(input.completion, ["complete", "partial", "unknown"]);
  member(input.errorObservation, ["none", "present", "unknown"]);
  member(input.effort, ["hard", "normal", "easy", "unknown"]);
}

/** Runtime command schemas; no mutation, coercion, inherited fields or selective fact rewriting. */
export function validateProductAction(
  action: unknown,
): asserts action is Action {
  const base = object(
    action,
    ["type"],
    [
      "config",
      "minutes",
      "localDate",
      "range",
      "id",
      "kind",
      "rangeLabel",
      "taskId",
      "termination",
      "input",
      "reason",
      "draft",
      "patch",
      "value",
      ...META,
    ],
  );
  if (typeof base.type !== "string") error("نوع الأمر غير صالح.");
  const shape = (
    required: string[] = [],
    allowed: string[] = [],
  ): RecordValue =>
    object(action, ["type", ...required], [...META, ...allowed]);
  let a: RecordValue;
  switch (base.type) {
    case "config":
      a = shape(["config"]);
      config(a.config);
      break;
    case "plan.todayBudget":
      a = shape(["minutes", "localDate"]);
      minutes(a.minutes);
      localDate(a.localDate);
      break;
    case "range.add":
      a = shape(["range"]);
      range(a.range);
      break;
    case "range.remove":
      a = shape(["id"]);
      identifier(a.id);
      break;
    case "preferences": {
      a = shape(["patch"]);
      const patch = object(
        a.patch,
        [],
        ["dark", "largeText", "reducedMotion", "reminder"],
      );
      if (!Object.keys(patch).length) error("اختر تفضيلًا لتعديله.");
      Object.values(patch).forEach(boolean);
      break;
    }
    case "recovery.report":
      a = shape(["value"]);
      member(a.value, ["yes", "no", "unknown", "skipped"]);
      break;
    case "mistake.add": {
      a = shape(["draft"]);
      const draft = object(a.draft, [
        "attemptId",
        "location",
        "type",
        "certainty",
        "selfCorrected",
        "assistanceUsed",
        "note",
      ]);
      if (draft.attemptId !== null) identifier(draft.attemptId);
      mistakeFields(draft);
      break;
    }
    case "mistake.correct": {
      a = shape(["id", "patch", "reason"]);
      identifier(a.id);
      text(a.reason, 4000, true);
      const patch = object(a.patch, [], MISTAKE_FIELDS);
      if (!Object.keys(patch).length) error("حدد حقول التصحيح.");
      mistakeFields(patch);
      break;
    }
    case "session.start":
      a = shape(["kind", "rangeLabel"], ["taskId"]);
      member(a.kind, [
        "new",
        "review",
        "maintenance",
        "diagnostic",
        "link",
        "recovery",
      ]);
      text(a.rangeLabel, 4000, true);
      optional(a, "taskId", identifier);
      break;
    case "session.pause":
    case "session.resume":
    case "session.end":
    case "session.restartRecall":
    case "session.finishedBeforeStop":
    case "session.repeat":
    case "session.startRecall":
    case "attempt.hint":
    case "attempt.reveal":
    case "reset":
      a = shape();
      break;
    case "attempt.finish":
      a = shape([], ["termination"]);
      optional(a, "termination", (value) =>
        member(value, ["completed", "memory_failure"]),
      );
      break;
    case "attempt.assess":
      a = shape(["input"]);
      assessment(a.input);
      break;
    case "attempt.correct":
      a = shape(["id", "input", "reason"]);
      identifier(a.id);
      assessment(a.input);
      text(a.reason, 4000, true);
      break;
    default:
      return error("نوع الأمر غير معروف.");
  }
  meta(a);
}

/** Product query schemas. Mutations remain commands and fixture injection is rejected. */
export function validateViewQuery<K extends ContractId>(
  id: K,
  input: unknown,
): void {
  let value: RecordValue;
  const shape = (operations: string[], extras: string[] = []): RecordValue => {
    const checked = object(input, ["operation"], extras);
    member(checked.operation, operations);
    return checked;
  };
  switch (id) {
    case "C01":
      value = shape(["read", "resolve"], ["range"]);
      optional(value, "range", range);
      break;
    case "C02":
      value = shape(["read", "save"], ["config", "command"]);
      optional(value, "config", config);
      optional(value, "command", (field) => {
        const command = object(field, ["commandId", "expectedRevision"]);
        identifier(command.commandId);
        integer(command.expectedRevision, 0, Number.MAX_SAFE_INTEGER);
      });
      break;
    case "C03":
      value = shape(["diagnostic", "gap", "backlog"], ["outsideReview"]);
      optional(value, "outsideReview", (field) =>
        member(field, ["yes", "no", "unknown", "skipped"]),
      );
      break;
    case "C04":
      value = shape(["read", "replan"], ["scenario", "localDate"]);
      optional(value, "scenario", (field) => member(field, ["normal"]));
      optional(value, "localDate", localDate);
      break;
    case "C05":
    case "C06":
    case "C11":
    case "C13":
    case "C14":
      shape(["read"]);
      break;
    case "C07":
      value = shape(["read"], ["attemptId"]);
      identifier(value.attemptId);
      break;
    case "C08":
      value = shape(["read"], ["attemptId"]);
      optional(value, "attemptId", identifier);
      break;
    case "C09":
      value = shape(["read"], ["range"]);
      optional(value, "range", range);
      break;
    case "C10":
      value = shape(["forecast", "preview"], ["minutes"]);
      optional(value, "minutes", minutes);
      break;
    case "C12":
      value = shape(["inspect"], ["serialized"]);
      text(value.serialized, 50_000_000);
      break;
    default:
      error("معرف العقد غير معروف.");
  }
}
