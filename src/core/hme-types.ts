/** HME 0.1 input contracts. Null means not measured, never zero errors. */
export type Rating = 1 | 2 | 3 | 4;
export type Phase = 'NotStarted' | 'Learning' | 'InitialRecall' | 'EarlyReview' | 'Consolidating' | 'Maintenance' | 'NeedsReinforcement' | 'Relearning';
export type EvidenceSource = 'V1' | 'V2' | 'V3' | 'V4';
export type ProbeType = 'chunk' | 'connected' | 'random_start' | 'link';
export interface RecallInput {
  id: string;
  at: string;
  requestedWords: number;
  attemptedWords: number | null;
  errors: number | null;
  hints: number;
  revealed: boolean;
  completion: 'complete' | 'partial' | 'unknown';
  termination: 'completed' | 'memory_failure' | 'user_stop' | 'technical_failure';
  effort: 'hard' | 'normal' | 'easy' | 'unknown';
  source: EvidenceSource;
  firstAttempt: boolean;
  disputed?: boolean;
  suspectedMistakes?: boolean;
  probeType?: ProbeType;
  /** Actual last relevant exposure before this attempt; includes read/listen/hint/recall. */
  lastExposureAt: string | null;
  gapVerified: boolean;
  zoneIdAtCapture?: string;
  observedLinkIds?: string[];
  targetUnitId?: string;
  testOpportunityId: string;
  evidenceClusterId: string;
  broadFailure?: boolean;
  afterRepair?: boolean;
  continuityPassed?: boolean | null;
}
export interface RecallAssessment {
  strictPass: boolean | null;
  effectiveRating: Rating | null;
  eligible: boolean;
  delayedEvidenceEligible: boolean;
  accuracy: number | null;
  accuracyDenominator: number | null;
  verification: EvidenceSource;
  reasonCodes: string[];
  /** No source class is advertised as a guarantee of accuracy. */
  independentVerification: boolean;
}
export interface TransitionRecord {
  from: Phase;
  to: Phase;
  at: string;
  reasonCode: string;
  evidenceIds: string[];
  source: EvidenceSource | null;
  policyVersion: string;
}
export interface SuccessfulEvidence {
  id: string;
  at: string;
  gapMs: number | null;
  gapVerified: boolean;
  zoneIdAtCapture: string;
  source: EvidenceSource;
  testOpportunityId: string;
  evidenceClusterId: string;
}
export interface UnitState {
  unitId: string;
  phase: Phase;
  probeType: ProbeType;
  continuityEvidenceIds: string[];
  continuityProcessedEvidenceIds: string[];
  continuityLastObservedAt: string | null;
  previousPhase: Phase | null;
  consecutiveClean: number;
  failures: number;
  broadDelayedFailuresAfterRepair: number;
  successfulEvidence: SuccessfulEvidence[];
  processedEvidenceIds: string[];
  processedOpportunityIds: string[];
  processedClusterIds: string[];
  transitions: TransitionRecord[];
  lastExposureAt: string | null;
  firstInitialRecallAt: string | null;
  lastFailureAt: string | null;
  lastObservedAt: string | null;
  source: EvidenceSource | null;
  continuityPassed: boolean | null;
  declaredKnown: boolean;
}
export interface HmePolicy {
  version: string;
  rubricVersion: string;
  experimental: true;
  minimumGuidedRepetitions: number;
  initialCleanSuccesses: number;
  maxSessionMinutes: number;
  maxFailedAttempts: number;
  restMinutes: number;
  minimumDelayedMinutes: number;
  earlyIndependentDays: number;
  earlyGapHours: number;
  earlyEvidenceSpanDays: number;
  maintenanceIndependentDays: number;
  maintenanceEvidenceSpanDays: number;
  maintenanceGapDays: number;
  earlyCapsDays: readonly number[];
  selfReportCapDays: number;
  maintenanceCapsDays: readonly number[];
  reserveFraction: number;
  stableRecoveryDays: number;
  forecastDays: number;
  recoverySampleTargets: readonly number[];
  repeatedMistakeEpisodes: number;
  linkObservationWindow: number;
  broadFailureFraction: number;
  broadFailuresForRelearning: number;
}
export interface DueDates {
  rawModelDueAt: string | null;
  policyDueAt: string | null;
  plannedAt: string | null;
  originalDueAt: string | null;
  reasonCodes: string[];
}
export type TaskKind = 'repair' | 'early_review' | 'maintenance' | 'review' | 'link' | 'new' | 'diagnostic' | 'recovery';
export interface PlanCandidate {
  id: string;
  unitId: string;
  kind: TaskKind;
  costMinutes: number;
  priority: number;
  protected?: boolean;
  coverageKeys?: string[];
  rawModelDueAt?: string | null;
  policyDueAt?: string | null;
  originalDueAt?: string | null;
  title?: string;
  reasonCode?: string;
}
export interface PlannedTask extends PlanCandidate {
  plannedAt: string | null;
  executionStatus: 'pending' | 'deferred';
  outcome: 'not_measured';
  decisionReason: string;
}
export interface DayPlan {
  policyVersion: string;
  minutes: number;
  reserveMinutes: number;
  spentMinutes: number;
  remainingBudgetMinutes: number;
  plannedMinutes: number;
  tasks: PlannedTask[];
  deferred: PlannedTask[];
  capacityStatus: 'feasible' | 'infeasible' | 'uncertain';
  reasonCodes: string[];
}
