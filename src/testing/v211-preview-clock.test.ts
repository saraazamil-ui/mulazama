import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPreviewClock } from './v211-preview-clock';
import { localDateAt } from '../application/product-v211';

describe('private preview timeline', () => {
  afterEach(() => vi.useRealTimers());
  it('advances Friday then Saturday and restores the same timeline', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-11T09:00:00Z'));
    let saved: string | null = null;
    const storage = { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; } };
    const clock = createPreviewClock(storage, 'clock');
    expect(clock.isSimulated()).toBe(false);
    expect(localDateAt(clock.advance(5, 'Asia/Riyadh').toISOString(), 'Asia/Riyadh')).toBe('2026-11-13');
    expect(localDateAt(clock.advance(6, 'Asia/Riyadh').toISOString(), 'Asia/Riyadh')).toBe('2026-11-14');
    expect(createPreviewClock(storage, 'clock').now()).toEqual(clock.now());
  });
  it('selects the civil Saturday across the New York DST boundary', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-31T23:00:00Z'));
    const clock = createPreviewClock({ getItem: () => null, setItem: () => {} }, 'clock');
    expect(localDateAt(clock.advance(6, 'America/New_York').toISOString(), 'America/New_York')).toBe('2026-11-07');
  });
  it('ignores corrupt storage and keeps the current clock when persistence fails', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-11T09:00:00Z'));
    const clock = createPreviewClock({ getItem: () => '-999', setItem: () => { throw Error('Quota'); } }, 'clock');
    expect(clock.now().getTime()).toBe(Date.now());
    expect(() => clock.advance(5, 'Asia/Riyadh')).toThrow('Quota');
    expect(clock.now().getTime()).toBe(Date.now());
  });
});
