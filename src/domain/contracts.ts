/** PRD §11 view contracts. Legacy fixture values remain accepted only for isolated regression tests. */
export type ContractId =
  | `C0${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`
  | `C1${0 | 1 | 2 | 3 | 4}`;
export const CONTRACT_NAMES = {
  C01: "ContentManifest",
  C02: "UserPlanConfig",
  C03: "DiagnosticRecovery",
  C04: "DailyPlanQueryReplan",
  C05: "SessionCheckpoint",
  C06: "ExposureRepetition",
  C07: "RecallAttemptAssessment",
  C08: "Mistake",
  C09: "ProgressCoverage",
  C10: "Forecast",
  C11: "SettingsVersions",
  C12: "BackupDataControl",
  C13: "NotificationCandidates",
  C14: "LocalMedia",
} as const satisfies Record<ContractId, string>;
export type ErrorCode =
  | "INVALID_INPUT"
  | "REFERENCE_MISMATCH"
  | "CONTENT_UNAVAILABLE"
  | "CONTENT_INTEGRITY_FAILURE"
  | "REVISION_CONFLICT"
  | "EVENT_CONFLICT"
  | "CLOCK_UNCERTAIN"
  | "INSUFFICIENT_EVIDENCE"
  | "STORAGE_FULL"
  | "WRITE_NOT_CONFIRMED"
  | "UNSUPPORTED_VERSION"
  | "CAPACITY_CONFLICT"
  | "CONSENT_REQUIRED";
export interface ContractError {
  code: ErrorCode;
  scope: ContractId;
  retryable: boolean;
  message: string;
  action: string;
}
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: ContractError };
export interface VersionBundle {
  prototype: "04-B" | "05-A" | "05-B";
  algorithmVersion: string | null;
  policyVersion: string | null;
  rubricVersion: string | null;
  methodVersion: string | null;
  editionId: string;
  tokenizationVersion: string | null;
}
export interface QueryMeta {
  asOf: string;
  projectionVersion: string;
  sourceWatermark: number;
  versions: VersionBundle;
  source: "mock" | "event-store";
  learningEvidence: false;
}
export interface CommandMeta {
  commandId: string;
  expectedRevision: number;
}
export interface Receipt {
  receiptId: string;
  eventIds: string[];
  revision: number;
  durability: "prototype-localStorage" | "indexeddb-transaction";
  learningEvidence: false;
}
export type RangeKind = "surah" | "juz" | "page" | "ayah";
/** A declaration selector, NOT a resolved TextSpan. Cross-axis mapping awaits C01. */
export interface RangeSelection {
  id: string;
  kind: RangeKind;
  start: number;
  end: number;
  surah?: number;
  editionId: "prototype-unverified";
  layoutId?: string;
  status: "declared_unassessed";
}
export type Persona =
  | "beginner"
  | "scattered"
  | "returning"
  | "regular"
  | "complete";
export interface PlanConfig {
  persona: Persona;
  minutes: number;
  days: number[];
  goal: "memorize" | "maintain";
  startSurah: number;
  zoneId: "Asia/Riyadh";
  configured: boolean;
}
export type AttemptKind =
  | "new"
  | "review"
  | "maintenance"
  | "diagnostic"
  | "link"
  | "recovery";
export type Completion = "complete" | "partial" | "unknown";
export type ErrorObservation = "none" | "present" | "unknown";
export type Effort = "hard" | "normal" | "easy" | "unknown";
export type Termination =
  | "completed"
  | "memory_failure"
  | "user_stop"
  | "technical_failure"
  | null;
export interface Attempt {
  id: string;
  kind: AttemptKind;
  rangeLabel: string;
  taskId: string | null;
  startedAt: string;
  endedAt: string | null;
  termination: Termination;
  hints: number;
  revealed: boolean;
  mistakeIds: string[];
  completion: Completion;
  errorObservation: ErrorObservation;
  effort: Effort;
  revision: number;
  assessed: boolean;
  source: "V1";
  testOpportunityId: string;
  evidenceClusterId: string;
  timingUnverified: boolean;
  strictPass: null;
  effectiveRating: null;
  status: "incomplete" | "reported" | "disputed";
}
export interface AssessmentInput {
  completion: Completion;
  errorObservation: ErrorObservation;
  effort: Effort;
}
export interface MistakeDraft {
  id: string;
  attemptId: string | null;
  location: string | null;
  type: "word" | "link" | "confusion" | "unknown";
  certainty: "observed" | "suspected" | "disputed";
  selfCorrected: boolean | null;
  assistanceUsed: boolean | null;
  note: string;
  revision: number;
  createdAt: string;
  treatment: "open" | "awaiting_retest";
}
export type SessionPhase = "training" | "recall" | "assessment" | "paused";
export interface Session {
  id: string;
  kind: AttemptKind;
  rangeLabel: string;
  taskId: string | null;
  phase: SessionPhase;
  previousPhase: Exclude<SessionPhase, "paused">;
  repeats: number;
  attemptId: string | null;
  startedAt: string;
  updatedAt: string;
  demonstration: true;
}
export interface Correction {
  id: string;
  entity: "attempt" | "mistake";
  targetId: string;
  at: string;
  previous: Attempt | MistakeDraft;
  reason: string;
}
export interface Preferences {
  dark: boolean;
  largeText: boolean;
  reducedMotion: boolean;
  reminder: boolean;
}
export interface PrototypeState {
  schemaVersion: 1;
  revision: number;
  profileId: string;
  config: PlanConfig;
  ranges: RangeSelection[];
  session: Session | null;
  attempts: Attempt[];
  mistakes: MistakeDraft[];
  corrections: Correction[];
  preferences: Preferences;
  processedCommands: Record<string, string>;
  recoveryReport: "yes" | "no" | "unknown" | "skipped";
  todayBudget: { localDate: string; minutes: number } | null;
}
export interface DueDates {
  rawModelDueAt: string | null;
  policyDueAt: string | null;
  plannedAt: string | null;
  originalDueAt: string | null;
  latestAllowedAt: string | null;
}
export interface MockTask extends DueDates {
  id: string;
  kind: AttemptKind;
  title: string;
  rangeLabel: string;
  plannedCostSnapshot: number;
  executionStatus: "pending" | "performed" | "deferred";
  outcome: "not_measured";
  reasonCode: string;
  reason: string;
}
export interface DailyPlan {
  meta: QueryMeta;
  revision: number;
  tasks: MockTask[];
  deferred: MockTask[];
  capacityStatus: "feasible" | "uncertain" | "infeasible";
  reason: string;
  plannedMinutes: number | null;
}
export interface UnknownMeasure {
  value: null;
  status: "not_measured";
  reason: string;
  evidenceIds: string[];
}
export interface ProgressSnapshot {
  meta: QueryMeta;
  declaredRanges: RangeSelection[];
  acquired: UnknownMeasure;
  stable: UnknownMeasure;
  links: UnknownMeasure;
  globalCoverage: UnknownMeasure;
  attemptCount: number;
  source: "V1";
  parts: Array<{
    juz: number;
    status: "not_measured" | "declared_unassessed";
    label: string;
  }>;
}
export interface ForecastSnapshot {
  meta: QueryMeta;
  status:
    | "insufficient_data"
    | "capacity_infeasible"
    | "unstable_plan"
    | "completed";
  reason: string;
  horizons: Record<1 | 3 | 6 | 12, null>;
  initialCompletionDate: null;
  previewMinutes: number;
  changesPlan: false;
}
export interface ContentManifest {
  meta: QueryMeta;
  status: "unavailable";
  editionId: "prototype-unverified";
  quranText: null;
  pageMap: null;
  source: null;
  license: null;
  hash: null;
  reason: string;
}
export interface RecoveryPlan {
  meta: QueryMeta;
  reason: "diagnostic" | "gap" | "backlog";
  sample: RangeSelection[];
  untested: RangeSelection[];
  source: "mock" | "event-store";
  outsideReview: "yes" | "no" | "unknown" | "skipped";
}
export interface AttemptAssessment {
  meta: QueryMeta;
  attempt: Attempt;
  effectiveRating: null;
  strictPass: null;
  reviewEvent: null;
  nextAction: "await_engine";
  reason: string;
  dates: DueDates;
}
export interface SettingsSnapshot {
  releaseGates?:Array<{gate:string;status:string;reasons:string[]}>;
  meta: QueryMeta;
  preferences: Preferences;
  engineAvailable: boolean;
  migrationAvailable: false;
}
export interface BackupInspection {
  compatible: boolean;
  encrypted: boolean;
  productionBackup: boolean;
  state: PrototypeState | null;
  reason: string;
}
export interface NotificationSnapshot {
  meta: QueryMeta;
  permission: "not_requested";
  scheduled: false;
  candidates: never[];
  reason: string;
}
export interface MediaSnapshot {
  meta: QueryMeta;
  available: false;
  recordingRef: null;
  microphoneRequested: false;
  reason: string;
}
export interface ContractRequestMap {
  C01: { operation: "read" | "resolve"; range?: RangeSelection };
  C02: {
    operation: "read" | "save";
    config?: PlanConfig;
    command?: CommandMeta;
  };
  C03: {
    operation: "diagnostic" | "gap" | "backlog";
    outsideReview?: RecoveryPlan["outsideReview"];
  };
  C04: {
    operation: "read" | "replan";
    scenario?: "normal" | "capacity" | "empty";
    localDate?: string;
  };
  C05: { operation: "read" };
  C06: { operation: "read" };
  C07: { operation: "read"; attemptId: string };
  C08: { operation: "read"; attemptId?: string };
  C09: { operation: "read"; range?: RangeSelection };
  C10: { operation: "forecast" | "preview"; minutes?: number };
  C11: { operation: "read" };
  C12: { operation: "inspect"; serialized: string };
  C13: { operation: "read" };
  C14: { operation: "read" };
}
export interface ContractResponseMap {
  C01: ContentManifest;
  C02: { meta: QueryMeta; config: PlanConfig };
  C03: RecoveryPlan;
  C04: DailyPlan;
  C05: { meta: QueryMeta; checkpoint: Session | null };
  C06: { meta: QueryMeta; confirmedRepetitions: number; mastery: null };
  C07: AttemptAssessment;
  C08: { meta: QueryMeta; drafts: MistakeDraft[] };
  C09: ProgressSnapshot;
  C10: ForecastSnapshot;
  C11: SettingsSnapshot;
  C12: BackupInspection;
  C13: NotificationSnapshot;
  C14: MediaSnapshot;
}
export interface TypedMockInterfaces {
  query<K extends ContractId>(
    contract: K,
    input: ContractRequestMap[K],
    state: PrototypeState,
  ): Result<ContractResponseMap[K]>;
}
