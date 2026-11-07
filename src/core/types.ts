import { HME_VERSION, P0 } from './hme';
import { FSRS_PROVENANCE } from './fsrs';
import { REFERENCE_FSRS_PROVENANCE } from './fsrs-reference';
/** Common versioned event envelope. Payloads are validated by the command service. */
export const VERSIONS = Object.freeze({ schema: 1, algorithm: HME_VERSION, policy: P0.version, rubric: P0.rubricVersion, model: FSRS_PROVENANCE.model, content: 'unavailable', fsrsImplementation: FSRS_PROVENANCE.algorithmVersion, weightsVersion: FSRS_PROVENANCE.parametersVersion, modelTimePolicy: FSRS_PROVENANCE.timePolicy, effectiveReviewTime: 'recall-start-v1', pedagogicalTimePolicy: 'recall-start-minus-last-relevant-exposure-v1', desiredRetention: 0.9, libraryConformance: FSRS_PROVENANCE.libraryConformance });
/** A new evidence interpreter is never silently applied to historical learning streams. */
export const LEARNING_VERSIONS = Object.freeze({ ...VERSIONS, applicationEvidence: 'hme-application-evidence-05b.1' });
/** Opt-in interpreter for newly initialized streams. Never relabel legacy events. */
export const REFERENCE_LEARNING_VERSIONS = Object.freeze({
  ...LEARNING_VERSIONS,
  applicationEvidence: 'hme-application-evidence-06l3.reference-1',
  fsrsImplementation: REFERENCE_FSRS_PROVENANCE.algorithmVersion,
  libraryConformance: REFERENCE_FSRS_PROVENANCE.libraryConformance,
});
export type LearningSchedulingMode = 'legacy' | 'reference-06e1';
export type LearningVersions = typeof LEARNING_VERSIONS | typeof REFERENCE_LEARNING_VERSIONS;
export function learningVersionsFor(mode: LearningSchedulingMode): LearningVersions {
  if (mode === 'legacy') return LEARNING_VERSIONS;
  if (mode === 'reference-06e1') return REFERENCE_LEARNING_VERSIONS;
  throw new DomainError('UNSUPPORTED_VERSION', 'نسخة جدولة غير مدعومة.');
}
export function learningModeForVersions(versions: unknown): LearningSchedulingMode {
  if (canonical(versions) === canonical(LEARNING_VERSIONS)) return 'legacy';
  if (canonical(versions) === canonical(REFERENCE_LEARNING_VERSIONS)) return 'reference-06e1';
  throw new DomainError('UNSUPPORTED_VERSION', 'نسخة أدلة تعلم غير مدعومة؛ يلزم إصدار مدعوم أو هجرة مراجعة صريحة، ولا يعاد تفسير السجل تلقائيًا.');
}
export type LearningEvent = {
  eventId: string; commandId: string; operationId: string; userId: string;
  unitId: string | null; type: string; occurredAt: string; receivedAt: string;
  zoneId: string; source: 'V1' | 'V2' | 'V4' | 'product';
  coverage: string[]; versions: typeof VERSIONS | LearningVersions; data: Record<string, unknown>;
};
export interface EventSnapshot { revision: number; events: LearningEvent[] }
export interface EventStore {
  /** Scoped views require an aggregate owner for backup, replacement and reset. */
  readonly backupScope?: 'aggregate-only';
  load(): Promise<EventSnapshot>;
  append(events: LearningEvent[], expectedRevision: number): Promise<EventSnapshot>;
  replace(events: LearningEvent[], expectedRevision: number): Promise<EventSnapshot>;
  clear(expectedRevision: number): Promise<void>;
  close(): void;
}
export class DomainError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'DomainError'; }
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new DomainError('INVALID_INPUT', 'Non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k])).join(',') + '}';
}
