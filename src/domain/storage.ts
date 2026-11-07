import type {
  Attempt,
  BackupInspection,
  Correction,
  MistakeDraft,
  PrototypeState,
  RangeSelection,
} from "./contracts";
import { validateConfig, initialState, isLocalDate } from "./state";
import { validateRange } from "./ranges";

export const STORAGE_KEY = "itqan.prototype.v1";
export const MAX_PROTOTYPE_BYTES = 2_000_000;
export type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max = 1000): v is string =>
  typeof v === "string" && v.length <= max;
const integer = (v: unknown, min = 0): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min;
const date = (v: unknown): v is string =>
  str(v, 40) && Number.isFinite(Date.parse(v));
const nullableBool = (v: unknown): boolean =>
  v === null || typeof v === "boolean";
const oneOf = (v: unknown, values: readonly unknown[]): boolean =>
  values.includes(v);
function validAttempt(v: unknown): v is Attempt {
  if (
    !record(v) ||
    typeof v.timingUnverified !== "boolean" ||
    (v.taskId !== null && !str(v.taskId, 200))
  )
    return false;
  return (
    str(v.id, 200) &&
    str(v.rangeLabel) &&
    oneOf(v.kind, [
      "new",
      "review",
      "maintenance",
      "diagnostic",
      "link",
      "recovery",
    ]) &&
    date(v.startedAt) &&
    (v.endedAt === null || date(v.endedAt)) &&
    oneOf(v.termination, [
      null,
      "completed",
      "memory_failure",
      "user_stop",
      "technical_failure",
    ]) &&
    integer(v.hints) &&
    typeof v.revealed === "boolean" &&
    Array.isArray(v.mistakeIds) &&
    v.mistakeIds.every((id) => str(id, 200)) &&
    oneOf(v.completion, ["complete", "partial", "unknown"]) &&
    oneOf(v.errorObservation, ["none", "present", "unknown"]) &&
    oneOf(v.effort, ["hard", "normal", "easy", "unknown"]) &&
    integer(v.revision) &&
    typeof v.assessed === "boolean" &&
    v.source === "V1" &&
    str(v.testOpportunityId, 200) &&
    str(v.evidenceClusterId, 200) &&
    v.strictPass === null &&
    v.effectiveRating === null &&
    oneOf(v.status, ["incomplete", "reported", "disputed"])
  );
}
function validMistake(v: unknown): v is MistakeDraft {
  if (!record(v)) return false;
  return (
    str(v.id, 200) &&
    (v.attemptId === null || str(v.attemptId, 200)) &&
    (v.location === null || str(v.location, 1000)) &&
    oneOf(v.type, ["word", "link", "confusion", "unknown"]) &&
    oneOf(v.certainty, ["observed", "suspected", "disputed"]) &&
    nullableBool(v.selfCorrected) &&
    nullableBool(v.assistanceUsed) &&
    str(v.note, 4000) &&
    integer(v.revision) &&
    date(v.createdAt) &&
    oneOf(v.treatment, ["open", "awaiting_retest"])
  );
}
function validCorrection(v: unknown): v is Correction {
  return (
    record(v) &&
    str(v.id, 200) &&
    str(v.targetId, 200) &&
    date(v.at) &&
    str(v.reason, 4000) &&
    ((v.entity === "attempt" && validAttempt(v.previous)) ||
      (v.entity === "mistake" && validMistake(v.previous)))
  );
}
/** Rejects malformed/foreign versions before any write. It is not an integrity/authenticity check. */
export function validatePrototypeState(
  value: unknown,
): value is PrototypeState {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    !integer(value.revision) ||
    !str(value.profileId, 200) ||
    !record(value.config) ||
    validateConfig(value.config as unknown as PrototypeState["config"]) !== null
  )
    return false;
  if (!oneOf(value.recoveryReport, ["yes", "no", "unknown", "skipped"]))
    return false;
  if (
    value.todayBudget !== null &&
    (!record(value.todayBudget) ||
      !isLocalDate(value.todayBudget.localDate) ||
      !integer(value.todayBudget.minutes) ||
      value.todayBudget.minutes > 1440)
  )
    return false;
  const preferences = value.preferences;
  if (
    !record(preferences) ||
    !["dark", "largeText", "reducedMotion", "reminder"].every(
      (k) => typeof preferences[k] === "boolean",
    )
  )
    return false;
  if (
    !record(value.processedCommands) ||
    Object.keys(value.processedCommands).some(
      (k) => k === "__proto__" || k === "constructor" || k === "prototype",
    ) ||
    !Object.values(value.processedCommands).every((v) => str(v, 20_000))
  )
    return false;
  if (
    !Array.isArray(value.ranges) ||
    value.ranges.length > 1000 ||
    !value.ranges.every(
      (r) =>
        record(r) && validateRange(r as unknown as RangeSelection) === null,
    )
  )
    return false;
  if (
    !Array.isArray(value.attempts) ||
    value.attempts.length > 10000 ||
    !value.attempts.every(validAttempt)
  )
    return false;
  if (
    !Array.isArray(value.mistakes) ||
    value.mistakes.length > 10000 ||
    !value.mistakes.every(validMistake)
  )
    return false;
  if (
    !Array.isArray(value.corrections) ||
    value.corrections.length > 10000 ||
    !value.corrections.every(validCorrection)
  )
    return false;
  const attempts = value.attempts as Attempt[];
  const mistakes = value.mistakes as MistakeDraft[];
  const attemptIds = new Set(attempts.map((a) => a.id));
  const mistakeIds = new Set(mistakes.map((m) => m.id));
  if (
    attemptIds.size !== attempts.length ||
    mistakeIds.size !== mistakes.length
  )
    return false;
  if (
    attempts.some((a) =>
      a.mistakeIds.some(
        (id) => !mistakes.some((m) => m.id === id && m.attemptId === a.id),
      ),
    ) ||
    mistakes.some((m) => m.attemptId !== null && !attemptIds.has(m.attemptId))
  )
    return false;
  if (
    (value.corrections as Correction[]).some(
      (c) =>
        !(c.entity === "attempt" ? attemptIds : mistakeIds).has(c.targetId),
    )
  )
    return false;
  const s = value.session;
  if (s !== null) {
    if (
      !record(s) ||
      !str(s.id, 200) ||
      !oneOf(s.kind, [
        "new",
        "review",
        "maintenance",
        "diagnostic",
        "link",
        "recovery",
      ]) ||
      !str(s.rangeLabel) ||
      !oneOf(s.phase, ["training", "recall", "assessment", "paused"]) ||
      !oneOf(s.previousPhase, ["training", "recall", "assessment"]) ||
      !integer(s.repeats) ||
      !date(s.startedAt) ||
      !date(s.updatedAt) ||
      s.demonstration !== true
    )
      return false;
    if (
      s.attemptId !== null &&
      (!str(s.attemptId, 200) || !attemptIds.has(s.attemptId))
    )
      return false;
    if (s.taskId !== null && !str(s.taskId, 200)) return false;
    if (
      (s.phase === "recall" ||
        s.phase === "assessment" ||
        (s.phase === "paused" && s.previousPhase !== "training")) &&
      s.attemptId === null
    )
      return false;
  }
  return true;
}

export function inspectBackup(serialized: string): BackupInspection {
  const base = { encrypted: false as const, productionBackup: false as const };
  if (
    typeof serialized !== "string" ||
    new TextEncoder().encode(serialized).length > MAX_PROTOTYPE_BYTES
  )
    return {
      ...base,
      compatible: false,
      state: null,
      reason: "الملف أكبر من حد الحالة التجريبية أو غير صالح.",
    };
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (
      record(parsed) &&
      "format" in parsed &&
      (parsed.format !== "itqan-prototype" || parsed.version !== 1)
    )
      return {
        ...base,
        compatible: false,
        state: null,
        reason: "نوع الملف أو إصداره غير متوافق. لم تتغير البيانات الحالية.",
      };
    const raw: unknown =
      record(parsed) && parsed.format === "itqan-prototype"
        ? parsed.state
        : parsed;
    if (!validatePrototypeState(raw))
      return {
        ...base,
        compatible: false,
        state: null,
        reason: "ملف غير متوافق أو ناقص. لم تتغير البيانات الحالية.",
      };
    return {
      ...base,
      compatible: true,
      state: raw,
      reason:
        "ملف حالة تجريبية غير مشفر. الاستعادة تستبدل الحالة كاملة بعد تأكيدك؛ ليس نسخة احتياطية إنتاجية.",
    };
  } catch {
    return {
      ...base,
      compatible: false,
      state: null,
      reason: "تعذر قراءة الملف. لم تتغير البيانات الحالية.",
    };
  }
}
export function serializePrototype(state: PrototypeState): string {
  return JSON.stringify(
    { format: "itqan-prototype", version: 1, state },
    null,
    2,
  );
}
export type SaveResult = { ok: true } | { ok: false; error: string };
export function savePrototype(
  state: PrototypeState,
  storage?: StoragePort,
): SaveResult {
  try {
    if (!validatePrototypeState(state))
      return { ok: false, error: "لم يُؤكد الحفظ: بنية الحالة غير صالحة." };
    const serialized = JSON.stringify(state);
    if (new TextEncoder().encode(serialized).length > MAX_PROTOTYPE_BYTES)
      return {
        ok: false,
        error: "لم يُؤكد الحفظ: تجاوزت الحالة حد التخزين التجريبي.",
      };
    (storage ?? globalThis.localStorage).setItem(STORAGE_KEY, serialized);
    return { ok: true };
  } catch {
    return {
      ok: false,
      error:
        "لم يُؤكد الحفظ: التخزين ممتلئ أو غير متاح. احتُفظ بالحالة السابقة.",
    };
  }
}
export function loadPrototype(storage?: StoragePort): {
  ok: boolean;
  state: PrototypeState;
  error?: string;
} {
  try {
    const serialized = (storage ?? globalThis.localStorage).getItem(
      STORAGE_KEY,
    );
    if (serialized === null) return { ok: true, state: initialState() };
    const checked = inspectBackup(serialized);
    if (!checked.compatible || !checked.state)
      return { ok: false, state: initialState(), error: checked.reason };
    // Reopening the browser cannot prove a physically continuous recitation.
    // Preserve the checkpoint without silently joining speech before/after reload.
    const state = structuredClone(checked.state);
    if (state.session && state.session.phase !== "paused") {
      state.session.previousPhase = state.session.phase;
      state.session.phase = "paused";
    }
    return { ok: true, state };
  } catch {
    return {
      ok: false,
      state: initialState(),
      error: "تعذر الوصول إلى التخزين التجريبي. لم تُحذف البيانات المحفوظة.",
    };
  }
}
