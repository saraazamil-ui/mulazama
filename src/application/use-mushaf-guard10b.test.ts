import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LearningJourney } from './journey06l3';
import { useMushafGuard } from './use-mushaf-guard10b';

class Channel {
  static instances = new Set<Channel>();
  static messages: unknown[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  constructor(readonly name: string) { Channel.instances.add(this); }
  postMessage(data: unknown) {
    Channel.messages.push(data);
    for (const peer of Channel.instances) if (peer !== this && peer.name === this.name)
      queueMicrotask(() => { if (Channel.instances.has(peer)) peer.onmessage?.({ data }); });
  }
  close() { Channel.instances.delete(this); }
}
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(profileId = 'profile-a') {
  const data = {
    app: { product: { state: { profileId } } },
    active: null as null | { phase: string; previousPhase?: string; attemptId: string },
    needsRestart: false,
    state: { attempts: {} as Record<string, { revealed: boolean }> },
    refresh: vi.fn(async (): Promise<void> => undefined),
  };
  return { data, journey: data as unknown as LearningJourney };
}
beforeEach(() => {
  Channel.instances.clear(); Channel.messages = [];
  vi.stubGlobal('BroadcastChannel', Channel);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('10-B reader guard against stale learning state', () => {
  it('does not create learning activity or require synchronization when no journey exists', async () => {
    const { result } = renderHook(() => useMushafGuard(undefined, 'reader-only', 'profile-a'));
    expect(result.current.checking).toBe(false);
    await result.current.beforeRead(); result.current.notifyCommitted();
    expect(Channel.instances.size).toBe(0); expect(Channel.messages).toEqual([]);
  });

  it('hides during initial refresh, coalesces page checks, and keeps callbacks stable', async () => {
    const f = fixture(), first = deferred(); f.data.refresh.mockImplementationOnce(() => first.promise);
    const { result, rerender } = renderHook(() => useMushafGuard(f.journey, 'database-a', 'profile-a'));
    expect(result.current.checking).toBe(true);
    const beforeRead = result.current.beforeRead, notifyCommitted = result.current.notifyCommitted;
    await act(async () => { first.resolve(); });
    await waitFor(() => expect(result.current.checking).toBe(false));
    const page = deferred(); f.data.refresh.mockImplementationOnce(() => page.promise);
    let one!: Promise<void>, two!: Promise<void>;
    act(() => { one = result.current.beforeRead(); two = result.current.beforeRead(); });
    expect(result.current.checking).toBe(false);
    await act(async () => { page.resolve(); await Promise.all([one, two]); });
    expect(f.data.refresh).toHaveBeenCalledTimes(2);
    rerender();
    expect(result.current.beforeRead).toBe(beforeRead); expect(result.current.notifyCommitted).toBe(notifyCommitted);
  });

  it('rejects freshly discovered recall, paused recall and restart without writing hints', async () => {
    const f = fixture(); const { result } = renderHook(() => useMushafGuard(f.journey, 'database-a', 'profile-a'));
    await waitFor(() => expect(result.current.checking).toBe(false));
    f.data.active = { phase: 'recall', attemptId: 'attempt-a' };
    f.data.state.attempts['attempt-a'] = { revealed: false };
    const revision = result.current.revision;
    await act(async () => { await expect(result.current.beforeRead()).rejects.toThrow('محاولة تسميع'); });
    expect(result.current.revision).toBeGreaterThan(revision);
    f.data.active = { phase: 'paused', previousPhase: 'recall', attemptId: 'attempt-a' };
    await act(async () => { await expect(result.current.beforeRead()).rejects.toThrow('محاولة تسميع'); });
    f.data.state.attempts['attempt-a'].revealed = true;
    await act(async () => { await result.current.beforeRead(); });
    f.data.needsRestart = true;
    await act(async () => { await expect(result.current.beforeRead()).rejects.toThrow('محاولة تسميع'); });
    expect(Channel.messages).toEqual([]);
  });

  it('keeps a blurred/hidden reader blocked despite an in-flight success until focus refreshes', async () => {
    const f = fixture(); const { result } = renderHook(() => useMushafGuard(f.journey, 'database-a', 'profile-a'));
    await waitFor(() => expect(result.current.checking).toBe(false));
    const pending = deferred(); f.data.refresh.mockImplementationOnce(() => pending.promise);
    let reading!: Promise<void>;
    act(() => { reading = result.current.beforeRead(); });
    const rejected = expect(reading).rejects.toThrow('نافذة');
    act(() => { window.dispatchEvent(new Event('blur')); });
    expect(result.current.checking).toBe(true);
    await act(async () => { pending.resolve(); await rejected; });
    expect(result.current.checking).toBe(true);
    act(() => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(result.current.checking).toBe(false));
    act(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    expect(result.current.checking).toBe(true);
    await expect(result.current.beforeRead()).rejects.toThrow('نافذة');
    act(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(result.current.checking).toBe(false));
  });

  it('invalidates another visible reader by database without transmitting learner data', async () => {
    const a = fixture(), b = fixture(), other = fixture();
    const first = renderHook(() => useMushafGuard(a.journey, 'shared-db', 'profile-a'));
    const second = renderHook(() => useMushafGuard(b.journey, 'shared-db', 'profile-a'));
    const isolated = renderHook(() => useMushafGuard(other.journey, 'other-db', 'profile-a'));
    await waitFor(() => expect([first.result.current.checking, second.result.current.checking, isolated.result.current.checking]).toEqual([false, false, false]));
    const pending = deferred(); b.data.refresh.mockImplementationOnce(async () => {
      await pending.promise;
      b.data.active = { phase: 'recall', attemptId: 'private-attempt' };
      b.data.state.attempts['private-attempt'] = { revealed: false };
    });
    await act(async () => { first.result.current.notifyCommitted(); });
    expect(second.result.current.checking).toBe(true);
    expect(isolated.result.current.checking).toBe(false);
    await act(async () => { pending.resolve(); });
    await waitFor(() => expect(second.result.current.checking).toBe(false));
    await act(async () => { await expect(second.result.current.beforeRead()).rejects.toThrow('محاولة تسميع'); });
    expect(Channel.messages).toEqual(['learning-state-invalidated']);
    expect(other.data.refresh).toHaveBeenCalledTimes(1);
  });

  it('rechecks an invalidation that arrives during a page refresh before releasing that page', async () => {
    const f = fixture(); const { result } = renderHook(() => useMushafGuard(f.journey, 'database-a', 'profile-a'));
    await waitFor(() => expect(result.current.checking).toBe(false));
    const old = deferred(), latest = deferred();
    f.data.refresh.mockImplementationOnce(() => old.promise).mockImplementationOnce(async () => {
      await latest.promise;
      f.data.active = { phase: 'recall', attemptId: 'new-attempt' };
      f.data.state.attempts['new-attempt'] = { revealed: false };
    });
    let reading!: Promise<void>; act(() => { reading = result.current.beforeRead(); });
    const rejected = expect(reading).rejects.toThrow('محاولة تسميع');
    act(() => { result.current.notifyCommitted(); });
    await act(async () => { old.resolve(); });
    expect(result.current.checking).toBe(true);
    expect(f.data.refresh).toHaveBeenCalledTimes(3);
    await act(async () => { latest.resolve(); await rejected; });
    expect(result.current.checking).toBe(false);
  });

  it('rejects old-profile reads and serializes a replacement profile behind them', async () => {
    const f = fixture();
    const { result, rerender } = renderHook(({ profileId }) => useMushafGuard(f.journey, 'database-a', profileId), { initialProps: { profileId: 'profile-a' } });
    await waitFor(() => expect(result.current.checking).toBe(false));
    const old = deferred(), latest = deferred();
    f.data.refresh.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => latest.promise);
    let reading!: Promise<void>; act(() => { reading = result.current.beforeRead(); });
    const rejected = expect(reading).rejects.toThrow('ملف الحافظ');
    f.data.app.product.state.profileId = 'profile-b';
    rerender({ profileId: 'profile-b' });
    expect(result.current.checking).toBe(true);
    await act(async () => { old.resolve(); await rejected; });
    expect(result.current.checking).toBe(true);
    await act(async () => { latest.resolve(); });
    await waitFor(() => expect(result.current.checking).toBe(false));
    expect(result.current.error).toBeUndefined();
  });

  it('fails closed on database or synchronization errors and recovers only after a successful read', async () => {
    const f = fixture(); f.data.refresh.mockRejectedValueOnce(Error('DATABASE_UNAVAILABLE'));
    const { result } = renderHook(() => useMushafGuard(f.journey, 'database-a', 'profile-a'));
    await waitFor(() => expect(result.current.error).toContain('تعذر التحقق'));
    expect(result.current.checking).toBe(true);
    act(() => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(result.current.checking).toBe(false));
    expect(result.current.error).toBeUndefined();
    const own = [...Channel.instances][0];
    await act(async () => { own.onmessageerror?.(); });
    expect(result.current.checking).toBe(true);
    await act(async () => { await expect(result.current.beforeRead()).rejects.toThrow('تعذر التحقق'); });
  });
});
