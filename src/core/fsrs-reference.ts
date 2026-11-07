import { FSRS_WEIGHTS, type FsrsReview, type FsrsState } from './fsrs';
import { RoundedFsrsAdapter, ROUNDED_FSRS_VERSION } from './fsrs-rounded';
import { instant } from './hme';
import type { Rating } from './hme-types';

/** Explicit corrected computation. Historical binary64 events retain their
 * original interpreter; a state cannot cross this boundary by implicit casting.
 * Numerical conformance is separate from content, rubric and release approval. */
export const REFERENCE_FSRS_PROVENANCE = Object.freeze({
  model: 'FSRS-6' as const,
  implementation: 'hme-ts542-reference-core-06e1',
  algorithmVersion: ROUNDED_FSRS_VERSION,
  parametersVersion: 'HME-0.1-section12-21weights',
  libraryName: 'ts-fsrs', requestedLibraryVersion: '5.4.2',
  referenceCommit: 'bb71e35a2f5af5a5ac6cce9ef7c41ad24855721d',
  libraryConformance: 'numerical-core-only' as const,
  approvedForProduction: false,
  selection: 'explicit-engineering-rebuild-only' as const,
  timePolicy: 'floor-elapsed-seconds-divided-by-86400-0.1.0',
  enableShortTerm: true, enableFuzz: false,
  precision: 'stage-rounded-8-decimal',
  bounds: Object.freeze({ stabilityMin: .001, stabilityMax: 36500, difficultyMin: 1, difficultyMax: 10 }),
  scope: 'next_state, forgetting_curve, next_interval; excludes BasicScheduler learning steps and HME policy approval',
});
const DAY = 86_400_000;
const round = (value: number) => Math.round(value * 1e8) / 1e8;

/** Same public method shape as FsrsAdapter, with the pinned upstream arithmetic.
 * Reuses the existing versioned round8 kernel rather than replacing FSRS or
 * adding a second predictor. Validation here closes the candidate's loose date
 * parsing and non-finite curve inputs before it can be used by an integration. */
export class ReferenceFsrsAdapter {
  readonly provenance = REFERENCE_FSRS_PROVENANCE;
  readonly weights: readonly number[];
  readonly desiredRetention: number;
  private readonly kernel: RoundedFsrsAdapter;
  constructor(options: { weights?: readonly number[]; desiredRetention?: number } = {}) {
    const weights = options.weights ?? FSRS_WEIGHTS;
    if (!Array.isArray(weights) || weights.length !== 21)
      throw Error('INVALID_INPUT: FSRS6 requires 21 valid weights');
    // Snapshot once: Array#some skips sparse holes and repeated getters could
    // otherwise change values between validation and use.
    const capturedWeights = Array.from({ length: 21 }, (_, index) => weights[index]);
    if (capturedWeights.some(value => !Number.isFinite(value)))
      throw Error('INVALID_INPUT: FSRS6 requires 21 valid weights');
    if (capturedWeights.some((value, index) => value !== FSRS_WEIGHTS[index]))
      throw Error('UNSUPPORTED_VERSION: weight changes require registered algorithm version');
    this.weights = Object.freeze(capturedWeights);
    this.desiredRetention = options.desiredRetention ?? .9;
    this.validateRetention(this.desiredRetention);
    this.kernel = new RoundedFsrsAdapter(this.desiredRetention);
    // Readonly is also enforced at runtime, so settings cannot drift after construction.
    Object.freeze(this.kernel);
    Object.freeze(this);
  }
  private validateRetention(value: number) {
    if (!Number.isFinite(value) || value <= 0 || value >= 1)
      throw Error('INVALID_INPUT: retention in (0,1) required');
  }
  private check(state: FsrsState) {
    if (!state || state.model !== 'FSRS-6' || state.algorithmVersion !== this.provenance.algorithmVersion)
      throw Error('UNSUPPORTED_VERSION: explicit rebuild from events required');
    if (!Number.isFinite(state.stability) || state.stability < .001 || state.stability > 36500 ||
        !Number.isFinite(state.difficulty) || state.difficulty < 1 || state.difficulty > 10)
      throw Error('INVALID_INPUT: FSRS6 state');
    instant(state.lastReviewAt);
  }
  private factor() {
    // Preserve upstream operation order as well as its rounding boundary.
    return round(Math.exp(Math.pow(-this.weights[20], -1) * Math.log(.9)) - 1);
  }
  curve(elapsedDays: number, stability: number): number {
    if (!Number.isFinite(elapsedDays) || elapsedDays < 0 || !Number.isFinite(stability) || stability <= 0)
      throw Error('INVALID_INPUT: curve inputs');
    return round(Math.pow(1 + this.factor() * elapsedDays / stability, -this.weights[20]));
  }
  exactInterval(stability: number, target = this.desiredRetention): number {
    this.validateRetention(target);
    if (!Number.isFinite(stability) || stability <= 0) throw Error('INVALID_INPUT: stability');
    const modifier = round((Math.pow(target, 1 / -this.weights[20]) - 1) / this.factor());
    const result = stability * modifier;
    if (!Number.isFinite(result)) throw Error('INVALID_INPUT: non-finite interval');
    return result;
  }
  interval(state: FsrsState, target = this.desiredRetention): number {
    this.check(state); return this.exactInterval(state.stability, target);
  }
  retrievability(state: FsrsState, at: string): number {
    this.check(state);
    const elapsed = instant(at) - instant(state.lastReviewAt);
    if (elapsed < 0) throw Error('CLOCK_UNCERTAIN: negative elapsed time');
    return this.curve(Math.floor(elapsed / DAY), state.stability);
  }
  review(previous: FsrsState | null, grade: Rating, at: string): FsrsReview {
    const now = instant(at);
    if (!Number.isSafeInteger(grade) || grade < 1 || grade > 4) throw Error('INVALID_INPUT: FSRS rating');
    if (previous !== null) {
      this.check(previous);
      if (now < instant(previous.lastReviewAt)) throw Error('CLOCK_UNCERTAIN: negative elapsed time');
    }
    const reviewed = this.kernel.review(previous, grade, at);
    const exactIntervalDays = this.exactInterval(reviewed.state.stability);
    const roundedIntervalDays = Math.min(36500, Math.max(1, Math.round(exactIntervalDays)));
    return { ...reviewed, exactIntervalDays, roundedIntervalDays,
      rawDueAt: new Date(now + roundedIntervalDays * DAY).toISOString(),
      configurationVersion: `${this.provenance.parametersVersion};r=${this.desiredRetention};round8;ts-fsrs=5.4.2` };
  }
}
