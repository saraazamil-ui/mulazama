import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LearningJourney } from './journey06l3';

const invalidation = 'learning-state-invalidated';
const unavailable = 'تعذر التحقق من حالة جلستك. بقي المصحف مخفيًا؛ أعد المحاولة عند العودة إلى الصفحة.';
const syncUnavailable = 'تعذر التحقق من الجلسة بين النوافذ. أعد تحميل الصفحة قبل فتح المصحف.';
const inactive = 'عد إلى نافذة مُلازَمَة للتحقق من حالة التسميع قبل عرض المصحف.';
const changedProfile = 'تغيّر ملف الحافظ. نتحقق من جلسته قبل عرض المصحف.';
const recall = 'أنت في محاولة تسميع. سجّل كشف النص أو استأنف المحاولة قبل فتح المصحف.';
const pageVisible = () => document.visibilityState !== 'hidden';

type Runtime = {
  journey: LearningJourney | undefined;
  databaseName: string;
  profileId: string;
  alive: boolean;
  foreground: boolean;
  epoch: number;
  checking: boolean;
  error: string | undefined;
  pending: Promise<void> | null;
  channel: BroadcastChannel | null;
  channelUnavailable: boolean;
};
type View = { owner: Runtime; checking: boolean; error: string | undefined; revision: number };

// A profile replacement can keep the same Journey object. Serialize reads across
// hook lifetimes too, so a late old-profile read cannot overtake its successor.
const refreshTails = new WeakMap<LearningJourney, Promise<unknown>>();
function refreshInOrder(journey: LearningJourney): Promise<unknown> {
  const previous = refreshTails.get(journey) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => journey.refresh());
  refreshTails.set(journey, next);
  void next.finally(() => {
    if (refreshTails.get(journey) === next) refreshTails.delete(journey);
  }).catch(() => undefined);
  return next;
}

/** Read-only guard: preferences and cross-tab signals never authorize learning. */
export function useMushafGuard(journey: LearningJourney | undefined, databaseName: string, profileId: string) {
  const runtime = useMemo<Runtime>(() => ({
    journey, databaseName, profileId, alive: true,
    foreground: pageVisible(), epoch: 0,
    checking: !!journey, error: undefined, pending: null,
    channel: null, channelUnavailable: false,
  }), [journey, databaseName, profileId]);
  const current = useRef(runtime);
  current.current = runtime;
  const [view, setView] = useState<View>(() => ({ owner: runtime, checking: runtime.checking, error: undefined, revision: 0 }));

  const publish = useCallback((target: Runtime) => {
    if (!target.alive || current.current !== target) return;
    setView(previous => ({ owner: target, checking: target.checking, error: target.error, revision: previous.revision + 1 }));
  }, []);

  const fresh = useCallback((target: Runtime): Promise<void> => {
    if (!target.journey) return Promise.resolve();
    if (target.pending) return target.pending;
    const run = async () => {
      while (true) {
        if (!target.alive || current.current !== target) throw Error(changedProfile);
        if (!target.foreground || !pageVisible()) throw Error(inactive);
        const epoch = target.epoch;
        try {
          await refreshInOrder(target.journey!);
        } catch {
          if (!target.alive || current.current !== target) throw Error(changedProfile);
          if (epoch !== target.epoch && target.foreground) continue;
          target.checking = true;
          target.error = unavailable;
          publish(target);
          throw Error(unavailable);
        }
        if (!target.alive || current.current !== target) throw Error(changedProfile);
        if (!target.foreground || !pageVisible()) throw Error(inactive);
        // A committed change or focus transition during the read invalidates it.
        if (epoch !== target.epoch) continue;
        if (target.journey!.app.product.state.profileId !== target.profileId) {
          target.checking = true;
          target.error = changedProfile;
          publish(target);
          throw Error(changedProfile);
        }
        if (target.channelUnavailable) {
          target.checking = true;
          target.error = syncUnavailable;
          publish(target);
          throw Error(syncUnavailable);
        }
        target.checking = false;
        target.error = undefined;
        publish(target);
        return;
      }
    };
    target.pending = run().finally(() => { target.pending = null; });
    return target.pending;
  }, [publish]);

  const invalidate = useCallback((target: Runtime) => {
    if (!target.alive || current.current !== target || !target.journey) return;
    target.epoch++;
    target.checking = true;
    target.error = undefined;
    publish(target);
    if (target.foreground && pageVisible()) void fresh(target).catch(() => undefined);
  }, [fresh, publish]);

  const beforeRead = useCallback(async () => {
    const target = current.current;
    if (!target.journey) return;
    // The reader itself keeps its pending image empty. Toggling the outer
    // checking state here would unmount/remount it on every page request.
    await fresh(target);
    if (!target.alive || current.current !== target) throw Error(changedProfile);
    if (!target.foreground || !pageVisible()) throw Error(inactive);
    const session = target.journey.active;
    const isRecall = session?.phase === 'recall' || session?.phase === 'paused' && session.previousPhase === 'recall';
    const attempt = session?.attemptId ? target.journey.state.attempts[session.attemptId] : undefined;
    if (target.journey.needsRestart || isRecall && !attempt?.revealed) throw Error(recall);
  }, [fresh]);

  const notifyCommitted = useCallback(() => {
    const target = current.current;
    if (!target.journey) return;
    // Only an invalidation string is transmitted, never IDs, results, or text.
    try { target.channel?.postMessage(invalidation); }
    catch { target.channelUnavailable = true; }
    invalidate(target);
  }, [invalidate]);

  useEffect(() => {
    runtime.alive = true;
    runtime.foreground = pageVisible();
    if (!runtime.journey) {
      runtime.checking = false;
      publish(runtime);
      return () => { runtime.alive = false; runtime.epoch++; };
    }
    try {
      runtime.channel = new BroadcastChannel('mulazama-mushaf-guard-10b:' + encodeURIComponent(runtime.databaseName));
      runtime.channelUnavailable = false;
      runtime.channel.onmessage = event => { if (event.data === invalidation) invalidate(runtime); };
      runtime.channel.onmessageerror = () => { runtime.channelUnavailable = true; invalidate(runtime); };
    } catch { runtime.channelUnavailable = true; }
    const suspend = () => { runtime.foreground = false; invalidate(runtime); };
    const resume = () => {
      runtime.foreground = pageVisible();
      invalidate(runtime);
    };
    const visibility = () => { if (!pageVisible()) suspend(); else resume(); };
    window.addEventListener('blur', suspend);
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', visibility);
    invalidate(runtime);
    return () => {
      runtime.alive = false;
      runtime.epoch++;
      window.removeEventListener('blur', suspend);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', visibility);
      runtime.channel?.close();
      runtime.channel = null;
    };
  }, [runtime, invalidate, publish]);

  return {
    checking: view.owner === runtime ? view.checking : !!journey,
    error: view.owner === runtime ? view.error : undefined,
    revision: view.revision,
    beforeRead,
    notifyCommitted,
  };
}
