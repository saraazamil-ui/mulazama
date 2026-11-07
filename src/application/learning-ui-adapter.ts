import type { LearningApplication } from "./learning";
import type { ApplicationService } from "./service";
import { effectiveBudget, currentRiyadhDate } from "../domain/state";
import type {
  CanonicalUnit,
  LearningCommand,
  LearningProjection,
} from "./learning";
import { DomainError } from "../core/types";
import { P0, trainingDecision } from "../core/hme";
import type { PlanCandidate } from "../core/hme-types";

type SendOptions = {
  commandId: string;
  at?: string;
  expectedRevision?: number;
};
export type ManualObservation = Extract<
  LearningCommand,
  { type: "AssessmentSubmitted" }
>["observation"];
export type LearningScreenId =
  | "S07"
  | "S08"
  | "S09"
  | "S10"
  | "S11"
  | "S12"
  | "S13";
/** UI commands contain observations, never memory state, rating, dates or mastery. */
export type LearningUiAction =
  | { type: "start"; unitId: string; sessionId: string }
  | {
      type: "repeat";
      sessionId: string;
      mode: Extract<LearningCommand, { type: "RepetitionCompleted" }>["mode"];
    }
  | { type: "recall"; sessionId: string; attemptId: string }
  | { type: "hint"; sessionId: string; reveal: boolean }
  | {
      type: "complete";
      sessionId: string;
      termination: Extract<
        LearningCommand,
        { type: "RecallAttemptCompleted" }
      >["termination"];
    }
  | { type: "assess"; attemptId: string; observation: ManualObservation }
  | {
      type: "correct";
      attemptId: string;
      revision: number;
      reason: string;
      observation: ManualObservation;
    }
  | { type: "pause" | "resume" | "end"; sessionId: string }
  | { type: "restart"; sessionId: string; attemptId: string }
  | {
      type: "mistake";
      attemptId: string | null;
      mistakeType: "word" | "link" | "confusion" | "unknown";
      location: string | null;
      certainty: "observed" | "suspected" | "disputed";
    }
  | { type: "recover"; absenceDays: number; seed: number; minutes: number };

/** C05–C08/C03 typed boundary around the gated event application. It never grants release access. */
export class LearningUiAdapter {
  constructor(
    private readonly app: Pick<
      LearningApplication,
      "state" | "revision" | "send" | "refresh"
    >,
    private readonly product?: ApplicationService,
  ) {}
  get state(): LearningProjection {
    return this.app.state;
  }
  get revision(): number {
    return this.app.revision;
  }
  refresh() {
    return this.app.refresh();
  }
  async register(unit: CanonicalUnit, options: SendOptions) {
    return this.app.send({ type: "UnitRegistered", unit }, options);
  }
  send(
    action: LearningUiAction,
    options: SendOptions,
  ): Promise<LearningProjection> {
    let command: LearningCommand;
    switch (action.type) {
      case "start":
        command = {
          type: "SessionStarted",
          unitId: action.unitId,
          sessionId: action.sessionId,
        };
        break;
      case "repeat":
        command = {
          type: "RepetitionCompleted",
          sessionId: action.sessionId,
          mode: action.mode,
        };
        break;
      case "recall":
        command = {
          type: "RecallAttemptStarted",
          sessionId: action.sessionId,
          attemptId: action.attemptId,
        };
        break;
      case "hint":
        command = {
          type: "HintUsed",
          sessionId: action.sessionId,
          reveal: action.reveal,
        };
        break;
      case "complete":
        command = {
          type: "RecallAttemptCompleted",
          sessionId: action.sessionId,
          termination: action.termination,
        };
        break;
      case "assess":
        command = {
          type: "AssessmentSubmitted",
          attemptId: action.attemptId,
          observation: action.observation,
        };
        break;
      case "correct":
        command = {
          type: "AssessmentCorrected",
          attemptId: action.attemptId,
          expectedAssessmentRevision: action.revision,
          reason: action.reason,
          observation: action.observation,
        };
        break;
      case "pause":
        command = { type: "SessionPaused", sessionId: action.sessionId };
        break;
      case "resume":
        command = { type: "SessionResumed", sessionId: action.sessionId };
        break;
      case "end":
        command = { type: "SessionEnded", sessionId: action.sessionId };
        break;
      case "restart":
        command = {
          type: "RecallAttemptRestarted",
          sessionId: action.sessionId,
          attemptId: action.attemptId,
        };
        break;
      case "mistake":
        command = {
          type: "ProductMistakeDraftRecorded",
          attemptId: action.attemptId,
          mistakeType: action.mistakeType,
          location: action.location,
          certainty: action.certainty,
        };
        break;
      case "recover":
        command = {
          type: "RecoveryStarted",
          absenceDays: action.absenceDays,
          seed: action.seed,
          minutes: action.minutes,
        };
        break;
      default:
        throw new DomainError("INVALID_INPUT", "إجراء تعلم غير معروف.");
    }
    return this.app.send(command, options);
  }
  training(
    sessionId: string,
    observations?: { elapsedMinutes: number; fatigue: boolean },
  ) {
    const p = this.state,
      s = p.sessions[sessionId];
    if (!s) throw new DomainError("REFERENCE_MISMATCH", "الجلسة غير موجودة.");
    const u = p.units[s.unitId];
    const decision = observations
      ? trainingDecision({
          repetitions: s.repetitions,
          consecutiveClean: u.state.consecutiveClean,
          failedAttempts: u.state.failures,
          ...observations,
        })
      : {
          next: "unavailable" as const,
          reasonCode: "TRAINING_TIME_NOT_MEASURED",
        };
    return {
      policyVersion: P0.version,
      experimental: P0.experimental,
      ...decision,
      elapsedTimeProvided: !!observations,
    };
  }
  budget(at = new Date().toISOString()) {
    if (!this.product)
      throw new DomainError(
        "REFERENCE_MISMATCH",
        "لم يربط إعداد المستخدم بخدمة التعلم.",
      );
    const localDate = currentRiyadhDate(new Date(at)),
      state = this.product.state;
    return {
      minutes: effectiveBudget(state, localDate),
      localDate,
      configured: state.config.configured,
      sourceRevision: this.product.revision,
    };
  }
  async replanFromProduct(
    input: Omit<Parameters<LearningUiAdapter["replan"]>[0], "minutes">,
    options: Omit<SendOptions, "at">,
  ) {
    if (!this.product)
      throw new DomainError(
        "REFERENCE_MISMATCH",
        "لم يربط إعداد المستخدم بخدمة التعلم.",
      );
    await this.product.refresh();
    const budget = this.budget(input.at);
    if (!budget.configured)
      throw new DomainError(
        "INVALID_INPUT",
        "أكمل إعداد خطة المستخدم قبل حساب التعاهد.",
      );
    return this.replan({ ...input, minutes: budget.minutes }, options);
  }
  /** C04/C09: cost estimates are caller-supplied and versioned, never invented measured time.
   * No new learning is proposed while the seven-day capacity model is unvalidated.
   * Every due/unknown/weak unit remains represented in planned OR deferred output. */
  async replan(
    input: {
      minutes: number;
      spentMinutes: number;
      at: string;
      costs: Record<string, number>;
      costModelVersion: string;
    },
    options: Omit<SendOptions, "at">,
  ) {
    if (!input.costModelVersion.trim())
      throw new DomainError("INVALID_INPUT", "نسخة تقدير الوقت مطلوبة.");
    const p = this.state,
      candidates: PlanCandidate[] = Object.values(p.units).map((u) => {
        const cost = input.costs[u.definition.id];
        if (!Number.isFinite(cost) || cost <= 0)
          throw new DomainError(
            "INVALID_INPUT",
            "تقدير وقت صريح مطلوب لكل وحدة.",
          );
        const due = u.dates?.policyDueAt;
        const weak = ["NeedsReinforcement", "Relearning"].includes(
          u.state.phase,
        );
        const kind = weak
          ? "repair"
          : !u.memory
            ? "diagnostic"
            : due && Date.parse(due) <= Date.parse(input.at)
              ? "review"
              : "maintenance";
        return {
          id: `${kind}:${u.definition.id}`,
          unitId: u.definition.id,
          kind,
          costMinutes: cost,
          priority: weak
            ? 100
            : kind === "review"
              ? 90
              : kind === "diagnostic"
                ? 70
                : 50,
          protected: weak || kind === "review",
          coverageKeys: u.definition.coverage,
          ...(u.dates
            ? {
                rawModelDueAt: u.dates.rawModelDueAt,
                policyDueAt: u.dates.policyDueAt,
                originalDueAt: u.dates.originalDueAt,
              }
            : {}),
          reasonCode: `${kind.toUpperCase()}_COST_ESTIMATE:${input.costModelVersion}`,
        };
      });
    return this.app.send(
      {
        type: "PlanRecomputed",
        minutes: input.minutes,
        spentMinutes: input.spentMinutes,
        candidates,
        futureLoadFeasible: false,
      },
      { ...options, at: input.at },
    );
  }
  /** Coverage is an exact union of canonical keys; it is not a percentage of a juz/page. */
  progress() {
    const p = this.state;
    // Bare keys have meaning only inside their edition. Without an approved
    // cross-edition token/catalog mapping, a combined union would be misleading.
    if (new Set(Object.values(p.units).map(unit => unit.definition.editionId)).size > 1)
      throw new DomainError("COVERAGE_NOT_COMPARABLE", "لا يمكن جمع التغطية بين طبعات مختلفة دون خريطة معتمدة.");
    const sets = {
      registered: new Set<string>(),
      observed: new Set<string>(),
      strictlyPassedEver: new Set<string>(),
      unassessed: new Set<string>(),
    };
    for (const u of Object.values(p.units)) {
      const attempts = Object.values(p.attempts).filter(
        (a) => a.unitId === u.definition.id && a.assessment,
      );
      const observed = attempts.some((a) => p.assessments[a.id]?.eligible);
      const passed = attempts.some(
        (a) => p.assessments[a.id]?.strictPass === true,
      );
      for (const k of u.definition.coverage) {
        sets.registered.add(k);
        if (observed) sets.observed.add(k);
        if (passed) sets.strictlyPassedEver.add(k);
        if (!observed) sets.unassessed.add(k);
      }
    }
    for (const k of sets.observed) sets.unassessed.delete(k);
    return Object.fromEntries(
      Object.entries(sets).map(([key, value]) => [key, [...value].sort()]),
    ) as Record<keyof typeof sets, string[]>;
  }
}
