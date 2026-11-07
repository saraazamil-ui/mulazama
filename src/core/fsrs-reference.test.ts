import { describe, expect, it } from 'vitest';
import { ReferenceFsrsAdapter, REFERENCE_FSRS_PROVENANCE } from './fsrs-reference';
import { FsrsAdapter, FSRS_WEIGHTS } from './fsrs';
const at = '2026-01-01T00:00:00.000Z';
describe('06-E1 corrected adapter contract and version boundary', () => {
  it('E1A01 preserves the existing public method shape with explicit new provenance', () => {
    const legacy = new FsrsAdapter(), corrected = new ReferenceFsrsAdapter();
    for (const method of ['curve', 'exactInterval', 'interval', 'retrievability', 'review'] as const) {
      expect(typeof legacy[method]).toBe('function'); expect(typeof corrected[method]).toBe('function');
    }
    expect(corrected.weights).toEqual(FSRS_WEIGHTS);
    expect(corrected.provenance.algorithmVersion).not.toBe(legacy.provenance.algorithmVersion);
    expect(corrected.provenance.approvedForProduction).toBe(false);
  });
  it('E1A02 rejects calendar normalization, timezone-free times and invalid inputs', () => {
    const app = new ReferenceFsrsAdapter();
    for (const invalid of ['2026-02-30T00:00:00Z', '2026-01-01', '2026-01-01T24:00:00Z', 'not-a-date'])
      expect(() => app.review(null, 3, invalid)).toThrow(/INVALID_INPUT/);
    for (const invalid of [0, 5, NaN, 2.5]) expect(() => app.review(null, invalid as 3, at)).toThrow(/INVALID_INPUT/);
    for (const invalid of [-1, NaN, Infinity]) expect(() => app.curve(invalid, 1)).toThrow(/INVALID_INPUT/);
    for (const invalid of [0, -1, NaN, Infinity]) expect(() => app.curve(1, invalid)).toThrow(/INVALID_INPUT/);
    for (const invalid of [0, 1, -1, NaN, Infinity]) expect(() => new ReferenceFsrsAdapter({ desiredRetention: invalid })).toThrow(/INVALID_INPUT/);
  });
  it('E1A03 refuses silent weights tuning and mutable configuration', () => {
    const weights = [...FSRS_WEIGHTS]; weights[0] += .001;
    expect(() => new ReferenceFsrsAdapter({ weights })).toThrow(/UNSUPPORTED_VERSION/);
    const adapter = new ReferenceFsrsAdapter();
    expect(Object.isFrozen(adapter)).toBe(true); expect(Object.isFrozen(adapter.weights)).toBe(true);
    expect(Reflect.set(adapter, 'desiredRetention', .8)).toBe(false);
  });
  it('E1A04 never consumes a historical binary64 state by relabeling implicitly', () => {
    const legacy = new FsrsAdapter().review(null, 3, at).state;
    const adapter = new ReferenceFsrsAdapter(), before = structuredClone(legacy);
    expect(() => adapter.review(legacy, 3, '2026-01-02T00:00:00Z')).toThrow(/explicit rebuild/);
    expect(() => adapter.interval(legacy)).toThrow(/explicit rebuild/);
    expect(() => adapter.retrievability(legacy, at)).toThrow(/explicit rebuild/);
    expect(legacy).toEqual(before);
  });
  it('E1A05 retains 24-hour elapsed semantics across offsets and local midnight', () => {
    const app = new ReferenceFsrsAdapter(), first = app.review(null, 3, '2026-01-01T20:00:00Z');
    expect(app.review(first.state, 3, '2026-01-02T00:00:00+03:00').elapsedDays).toBe(0);
    expect(app.review(first.state, 3, '2026-01-02T23:00:00+03:00').elapsedDays).toBe(1);
    expect(app.review(first.state, 3, '2026-01-02T20:00:00Z')).toEqual(app.review(first.state, 3, '2026-01-02T20:00:00Z'));
    expect(() => app.review(first.state, 3, '2026-01-01T19:59:59Z')).toThrow(/CLOCK_UNCERTAIN/);
  });
  it('E1A06 rejects invalid state bounds and leaves input state immutable', () => {
    const app = new ReferenceFsrsAdapter(), state = app.review(null, 3, at).state, before = structuredClone(state);
    for (const patch of [{ stability: 0 }, { stability: Infinity }, { stability: 36501 }, { difficulty: 0 }, { difficulty: 11 }, { lastReviewAt: '2026-02-30T00:00:00Z' }])
      expect(() => app.review({ ...state, ...patch }, 3, '2026-03-01T00:00:00Z')).toThrow();
    app.review(Object.freeze(state), 3, '2026-01-05T00:00:00Z'); expect(state).toEqual(before);
  });
  it('E1A07 keeps exact interval API separate from rounded daily schedule and production approval', () => {
    const app = new ReferenceFsrsAdapter({ desiredRetention: .95 }), value = app.review(null, 3, at);
    expect(app.interval(value.state)).toBe(app.exactInterval(value.state.stability));
    expect(value.roundedIntervalDays).toBe(Math.max(1, Math.min(36500, Math.round(value.exactIntervalDays))));
    expect(value.state.algorithmVersion).toBe(REFERENCE_FSRS_PROVENANCE.algorithmVersion);
    expect(app.retrievability(value.state, at)).toBe(1);
    expect(() => app.exactInterval(Infinity)).toThrow(); expect(() => app.interval(value.state, 1)).toThrow();
  });
  it('E1A08 sparse weights or non-array inputs cannot bypass the finite pinned-parameter check', () => {
    expect(() => new ReferenceFsrsAdapter({ weights: new Array(21) })).toThrow(/INVALID_INPUT/);
    const partial = [...FSRS_WEIGHTS]; delete partial[5];
    expect(() => new ReferenceFsrsAdapter({ weights: partial })).toThrow(/INVALID_INPUT/);
    expect(() => new ReferenceFsrsAdapter({ weights: { length: 21 } as never })).toThrow(/INVALID_INPUT/);
    let reads = 0;
    const observed = [...FSRS_WEIGHTS];
    Object.defineProperty(observed, '0', { get: () => { reads++; return reads === 1 ? FSRS_WEIGHTS[0] : NaN; } });
    const adapter = new ReferenceFsrsAdapter({ weights: observed });
    expect(reads).toBe(1); expect(adapter.weights[0]).toBe(FSRS_WEIGHTS[0]);
    expect(Number.isFinite(adapter.curve(1, 5))).toBe(true);
  });
});
