import { replayProduct } from "../application/service";
import { replayLearning } from "../application/learning";
import type { LearningCommand } from "../application/learning";
import { canonical, DomainError } from "../core/types";
import type { EventSnapshot, LearningEvent } from "../core/types";
import type { RecallInput } from "../core/hme-types";
import { currentRiyadhDate } from "../domain/state";
import { validateBackupSnapshot } from "../persistence/backup";
import { validateEvent } from "../persistence/event-store";

export interface ProgressAttempt {
  attemptId: string;
  sessionId: string;
  unitId: string;
  endedAt: string;
  localDate: string;
  completion: RecallInput["completion"];
  errors: number | null;
  attemptedWords: number | null;
  requestedWords: number;
  effort: RecallInput["effort"];
  hints: number;
  revealed: boolean;
  termination: RecallInput["termination"];
  revision: number;
  sourceEventIds: string[];
}
export interface ProgressReadModel {
  meta: {
    asOf: string;
    localDate: string;
    zoneId: "Asia/Riyadh";
    sourceWatermark: number;
    sourceEventCount: number;
    projectionVersion: "06-D2-observed-activity-1";
  };
  memorization: {
    status: "unavailable";
    percent: null;
    completed: null;
    target: null;
    remaining: null;
    reason: string;
  };
  daily: {
    status: "unavailable";
    percent: null;
    target: null;
    remaining: null;
    completedSessions: number | null;
    reason: string;
  };
  review: {
    status: "unavailable";
    due: null;
    completed: null;
    remaining: null;
    overdue: null;
    reason: string;
  };
  stability: { status: "unavailable"; reason: string };
  activity: {
    hasEvidence: boolean;
    assessedAttempts: number;
    completedSessions: number;
    last7Days: number | null;
    last30Days: number | null;
  };
  days: Array<{
    localDate: string;
    completedSessions: number;
    assessedAttempts: number;
  }>;
  attempts: ProgressAttempt[];
  reportedLocations: Array<{
    location: string | null;
    certainty: string;
    type: string;
    sourceEventIds: string[];
  }>;
}

/** Duplicate transport delivery is harmless to a read model. Conflicting IDs,
 * unknown versions and invalid events fail closed. This never repairs the store
 * or relaxes the stricter existing backup/restore duplicate checks. */
function validatedSnapshot(snapshot: EventSnapshot): EventSnapshot {
  if (!snapshot || !Array.isArray(snapshot.events) || snapshot.events.length > 100_000)
    throw new DomainError("INVALID_INPUT", "تعذر التحقق من سجل مؤشرات التقدم.");
  const byId = new Map<string, { event: LearningEvent; fingerprint: string }>();
  const commandEvents = new Map<string, string>();
  for (const event of snapshot.events) {
    validateEvent(event);
    const fingerprint = canonical(event), old = byId.get(event.eventId);
    if (old && old.fingerprint !== fingerprint)
      throw new DomainError("EVENT_CONFLICT", "معرف واقعة متعارض؛ لم تُحسب مؤشرات مضللة.");
    if (!old) {
      if (commandEvents.has(event.commandId))
        throw new DomainError("EVENT_CONFLICT", "معرف أمر مكرر في وقائع مختلفة؛ تعذر تأكيد الإنجاز.");
      commandEvents.set(event.commandId, event.eventId);
      byId.set(event.eventId, { event, fingerprint });
    }
  }
  const result = { revision: snapshot.revision, events: [...byId.values()].map(({ event }) => event) };
  validateBackupSnapshot(result);
  if (result.events.some((event) => !["product", "hme"].includes(event.data.scope as string)))
    throw new DomainError("UNSUPPORTED_VERSION", "نطاق سجل التقدم غير مدعوم.");
  return result;
}

const dayNumber = (localDate: string) => Date.parse(`${localDate}T00:00:00.000Z`) / 86_400_000;

/** Read-only facts, rebuilt from committed source events. There is deliberately
 * no code path that upgrades a declaration, HME phase or FSRS probability into
 * an approved Quran coverage/goal, due schedule or scientific stability claim.
 * Product-only 05-C databases are supported without a migration or write. */
export function projectProgress(snapshot: EventSnapshot, now = new Date()): ProgressReadModel {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    throw new DomainError("INVALID_INPUT", "وقت قراءة مؤشرات التقدم غير صالح.");
  const valid = validatedSnapshot(snapshot);
  if (valid.events.some((event) => Date.parse(event.occurredAt) > now.getTime()))
    throw new DomainError("CLOCK_UNCERTAIN", "توجد وقائع مؤرخة بعد وقت القراءة؛ تعذر تأكيد مؤشرات التقدم.");
  const productEvents = valid.events.filter((event) => event.data.scope === "product");
  const hmeEvents = valid.events.filter((event) => event.data.scope === "hme");
  const product = replayProduct({ revision: valid.revision, events: productEvents });
  const learning = hmeEvents.length ? replayLearning({ revision: valid.revision, events: hmeEvents }) : null;
  if (learning && product.profileId !== learning.userId)
    throw new DomainError("REFERENCE_MISMATCH", "هوية وقائع التعلم لا تطابق ملف المستخدم.");
  const localDate = currentRiyadhDate(now), todayNumber = dayNumber(localDate);
  const attemptSources = new Map<string, string[]>();
  const activeAttempts = new Map<string, string>();
  const sessionStarts = new Map<string, string>();
  const unitSources = new Map<string, string>();
  for (const event of hmeEvents) {
    const command = event.data.command as LearningCommand | undefined;
    if (!command) continue;
    if (command.type === "UnitRegistered") unitSources.set(command.unit.id, event.eventId);
    if (command.type === "SessionStarted") sessionStarts.set(command.sessionId, event.eventId);
    if (command.type === "RecallAttemptStarted" || command.type === "RecallAttemptRestarted") {
      activeAttempts.set(command.sessionId, command.attemptId);
      attemptSources.set(command.attemptId, sessionStarts.has(command.sessionId) ? [sessionStarts.get(command.sessionId)!] : []);
    }
    const attemptId = "attemptId" in command && command.attemptId ? command.attemptId :
      "sessionId" in command ? activeAttempts.get(command.sessionId) : undefined;
    if (attemptId) {
      const ids = attemptSources.get(attemptId) ?? [];
      ids.push(event.eventId); attemptSources.set(attemptId, ids);
    }
  }
  const attempts: ProgressAttempt[] = [];
  for (const attempt of Object.values(learning?.attempts ?? {})) {
    const raw = attempt.assessment;
    if (!raw || !attempt.endedAt || !attempt.termination || Date.parse(attempt.endedAt) > now.getTime()) continue;
    attempts.push({
      attemptId: attempt.id, sessionId: attempt.sessionId, unitId: attempt.unitId,
      endedAt: attempt.endedAt, localDate: currentRiyadhDate(new Date(attempt.endedAt)),
      completion: raw.completion, errors: raw.errors, attemptedWords: raw.attemptedWords,
      requestedWords: raw.requestedWords, effort: raw.effort, hints: raw.hints,
      revealed: raw.revealed, termination: attempt.termination, revision: attempt.revision,
      sourceEventIds: [...new Set([...(unitSources.has(attempt.unitId) ? [unitSources.get(attempt.unitId)!] : []), ...(attemptSources.get(attempt.id) ?? [])])],
    });
  }
  attempts.sort((a, b) => Date.parse(a.endedAt) - Date.parse(b.endedAt) || a.attemptId.localeCompare(b.attemptId));
  const days = new Map<string, ProgressReadModel["days"][number]>();
  function day(date: string) {
    let result = days.get(date);
    if (!result) { result = { localDate: date, completedSessions: 0, assessedAttempts: 0 }; days.set(date, result); }
    return result;
  }
  const completedSessions = new Set<string>();
  for (const attempt of attempts) {
    day(attempt.localDate).assessedAttempts++;
    // Count reported execution only. Errors/hints do not erase execution and do
    // not certify quality. Unknown scope and interrupted attempts are excluded.
    if (attempt.termination === "completed" && attempt.completion === "complete" &&
        attempt.attemptedWords === attempt.requestedWords && !completedSessions.has(attempt.sessionId)) {
      completedSessions.add(attempt.sessionId);
      day(attempt.localDate).completedSessions++;
    }
  }
  const history = [...days.values()].sort((a, b) => b.localDate.localeCompare(a.localDate));
  const hasEvidence = attempts.length > 0;
  const rollingCount = (length: number) => hasEvidence ? history.reduce((sum, item) => {
    const age = todayNumber - dayNumber(item.localDate);
    return sum + (age >= 0 && age < length ? item.completedSessions : 0);
  }, 0) : null;
  const mistakeSources = new Map<string, string[]>();
  for (const event of productEvents) {
    const action = event.data.action as { type?: string; id?: string } | undefined;
    const id = action?.type === "mistake.add" ? (event.data.generatedIds as string[])[0] :
      action?.type === "mistake.correct" ? action.id : undefined;
    if (id) {
      const ids = mistakeSources.get(id) ?? [];
      ids.push(event.eventId); mistakeSources.set(id, ids);
    }
  }
  const reportedLocations: ProgressReadModel["reportedLocations"] = product.mistakes.map((mistake) => ({
    location: mistake.location, certainty: mistake.certainty, type: mistake.type,
    sourceEventIds: mistakeSources.get(mistake.id) ?? [],
  }));
  for (const event of hmeEvents) {
    const command = event.data.command as LearningCommand | undefined;
    if (command?.type === "ProductMistakeDraftRecorded") reportedLocations.push({
      location: command.location, certainty: command.certainty, type: command.mistakeType, sourceEventIds: [event.eventId],
    });
  }
  return {
    meta: { asOf: now.toISOString(), localDate, zoneId: "Asia/Riyadh", sourceWatermark: valid.revision,
      sourceEventCount: valid.events.length, projectionVersion: "06-D2-observed-activity-1" },
    memorization: { status: "unavailable", percent: null, completed: null, target: null, remaining: null,
      reason: "لم يُحدد مقدار هدف الحفظ بوحدة معتمدة، ولم يعتمد معيار الإنجاز بعد. النطاقات المعلنة لا تُعد حفظًا متحققًا." },
    daily: { status: "unavailable", percent: null, target: null, remaining: null,
      completedSessions: hasEvidence ? (days.get(localDate)?.completedSessions ?? 0) : null,
      reason: "لا توجد خطة يومية معتمدة يمكن مطابقة إنجازاتها مع السجل. عدد جلسات التسميع المسجلة لا يحدد نسبة إنجاز الورد." },
    review: { status: "unavailable", due: null, completed: null, remaining: null, overdue: null,
      reason: "جدول المراجعة ينتظر الاعتماد؛ لذلك لا نعرض استحقاقات أو تأخرًا غير موثوقين. لا يكفي سجل التسميع وحده لتحديد المراجعات المنجزة." },
    stability: { status: "unavailable", reason: "ثبات الحفظ: يحتاج إلى تسميعات إضافية لتقديره، وإلى اعتماد معايير القياس. إنجاز النشاط وجودة التسميع لا يثبتان الثبات." },
    activity: { hasEvidence, assessedAttempts: attempts.length, completedSessions: completedSessions.size,
      last7Days: rollingCount(7), last30Days: rollingCount(30) },
    days: history, attempts: attempts.reverse(), reportedLocations,
  };
}
