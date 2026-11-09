import { useState } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JourneyScreen } from './JourneyScreen06l3';
import { LearningJourney } from './application/journey06l3';
import { createEngineeringJourneyMaterial } from './content/journey-material06l3';
import { createSyntheticLearningAccess } from './testing/learning-access';
import { MemoryEventStore } from './persistence/event-store';
import type { Screen } from './catalog';

const units = Array.from({ length: 2 }, (_, i) => ({ id: `test-simple-journey-${i + 1}`, editionId: 'test-simple-journey-edition', probeProfileVersionId: 'test-chunk-simple', words: 8, coverage: Array.from({ length: 8 }, (_, k) => `test-simple:${i + 1}:${k}`) }));
const normal = 'سمّعت المقطع كاملًا بلا خطأ معلوم — جهد عادي';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function fixture({ configured = true, prior = false } = {}) {
  const store = new MemoryEventStore(), material = createEngineeringJourneyMaterial(units), access = await createSyntheticLearningAccess(units);
  const journey = await LearningJourney.open(store, material, access, { scheduling: 'reference-06e1' });
  if (configured) await journey.app.product.configureOnboarding({ commandId: crypto.randomUUID(), config: { ...journey.app.product.state.config, configured: true, persona: prior ? 'returning' : 'beginner', goal: prior ? 'maintain' : 'memorize', minutes: 15, days: [0, 1, 2, 3, 4, 5, 6] }, ranges: prior ? [{ id: 'test-prior', kind: 'surah', start: 1, end: 1, editionId: 'prototype-unverified', status: 'declared_unassessed' }] : [] });
  await journey.prepare(); return { journey, store, material, access };
}
function mount(journey: LearningJourney, initial: Screen = 'S05') {
  const go = vi.fn(), read = vi.fn((id: string) => <div aria-label="صفحة تدريب صناعية">{id}</div>);
  function Host() {
    const [route, setRoute] = useState(initial);
    return <><output aria-label="المسار الحالي">{route}</output><JourneyScreen journey={journey} screen={route} go={next => { go(next); setRoute(next); }} onCommitted={() => undefined} renderReading={read} /></>;
  }
  return { ...render(<Host />), go, read };
}
async function saved() { await screen.findByRole('heading', { name: 'حُفظ تقييمك الذاتي' }); await waitFor(() => expect(screen.getByRole('button', { name: 'العودة إلى اليوم' })).toBeEnabled()); }

describe('simple daily journey uses existing durable commands', () => {
  it('an unconfigured reader sees one setup action without fabricated learning events', async () => {
    const f = await fixture({ configured: false }), before = await f.store.load(), h = mount(f.journey), user = userEvent.setup();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'أعد خطتي' }));
    expect(h.go).toHaveBeenCalledExactlyOnceWith('S02');
    expect((await f.store.load()).events).toEqual(before.events);
  });

  it('memorization shows its existing page and records a result without recall or result route changes', async () => {
    const f = await fixture(), h = mount(f.journey), user = userEvent.setup();
    expect(screen.queryByRole('heading', { name: 'من سجل تسميعك' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'ابدأ الحفظ' }));
    await screen.findByLabelText('صفحة تدريب صناعية');
    expect(h.go).toHaveBeenCalledExactlyOnceWith('S07'); expect(f.journey.active?.phase).toBe('training');
    expect(Object.values(f.journey.state.attempts)).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'أنهيت الحفظ، أبدأ التسميع' }));
    await screen.findByRole('button', { name: normal });
    expect(screen.queryByLabelText('صفحة تدريب صناعية')).not.toBeInTheDocument();
    expect(h.go).toHaveBeenCalledTimes(1); expect(f.journey.view().observations).toBe(0);
    await user.click(screen.getByRole('button', { name: normal })); await saved();
    expect(h.go).toHaveBeenCalledTimes(1); expect(f.journey.view().observations).toBe(1);
    expect((await f.store.load()).events.filter(e => e.type === 'AssessmentSubmitted')).toHaveLength(1);
    expect(screen.getByText('حُفظ تقييمك الذاتي؛ تسجيل النشاط لا يثبت الإتقان.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'العودة إلى اليوم' }));
    await screen.findByRole('heading', { name: 'وردك اليوم' });
    expect(h.go.mock.calls.map(call => call[0])).toEqual(['S07', 'S05']);
    expect(screen.getByLabelText('إنجاز اليوم')).toHaveTextContent('أنجزت اليوم: 1');
    expect(f.journey.active).toBeNull();
  });

  it('review begins recall directly, and correction retains the original assessment instead of duplicating it', async () => {
    const f = await fixture({ prior: true }), h = mount(f.journey), user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'ابدأ المراجعة' }));
    await screen.findByRole('button', { name: normal });
    expect(f.journey.active?.phase).toBe('recall'); expect(h.read).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'سمّعت المقطع كاملًا بلا خطأ معلوم — بصعوبة' })); await saved();
    const original = (await f.store.load()).events.find(e => e.type === 'AssessmentSubmitted');
    await user.click(screen.getByText('خيارات الجلسة', { exact: true }));
    await user.click(screen.getByRole('button', { name: 'صحّح النتيجة' }));
    await user.click(screen.getByRole('button', { name: 'سمّعت المقطع كاملًا بلا خطأ معلوم — بسهولة' })); await saved();
    const after = (await f.store.load()).events;
    expect(after.filter(e => e.type === 'AssessmentSubmitted')).toEqual([original]);
    expect(after.filter(e => e.type === 'AssessmentCorrected')).toHaveLength(1);
    expect(h.go.mock.calls.map(call => call[0])).toEqual(['S07']);
  });

  it('a stale review button cannot silently skip reading when the fresh plan now chooses new memorization', async () => {
    const f = await fixture({ prior: true }); mount(f.journey); const user = userEvent.setup();
    await act(async () => { await f.journey.prepare(); });
    const startReview = screen.getByRole('button', { name: 'ابدأ المراجعة' });
    await f.journey.app.product.dispatch({ type: 'range.remove', id: 'test-prior' });
    await f.journey.app.product.dispatch({ type: 'config', config: { ...f.journey.app.product.state.config, goal: 'memorize' } });
    await user.click(startReview); await screen.findByLabelText('صفحة تدريب صناعية');
    expect(f.journey.active?.phase).toBe('training');
    expect(Object.values(f.journey.state.attempts)).toHaveLength(0);
    expect((await f.store.load()).events.filter(e => e.type === 'AssessmentSubmitted')).toHaveLength(0);
  });

  it('an interrupted recall still requires an explicit new attempt and never restores an unearned result', async () => {
    const f = await fixture({ prior: true }), started = await f.journey.start();
    await f.journey.action({ type: 'recall', sessionId: started!.id, attemptId: 'test-interrupted' });
    const reopened = await LearningJourney.open(f.store, f.material, f.access, { scheduling: 'reference-06e1' });
    mount(reopened, 'S07'); const user = userEvent.setup();
    expect(screen.queryByRole('button', { name: normal })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('صفحة تدريب صناعية')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'ابدأ محاولة جديدة بعد الانقطاع' }));
    await screen.findByRole('button', { name: normal });
    expect(reopened.active?.attemptId).not.toBe('test-interrupted'); expect(reopened.view().observations).toBe(0);
    await user.click(screen.getByRole('button', { name: 'لم أستطع إكماله من الذاكرة' })); await saved();
    expect(reopened.view().observations).toBe(1); expect(reopened.view().successfulCoverage).toBe(0);
    expect(reopened.state.attempts['test-interrupted'].assessment).toBeNull();
  });

  it('resuming paused reading uses one action without starting a recall or assessment', async () => {
    const f = await fixture(), started = await f.journey.start();
    await f.journey.action({ type: 'pause', sessionId: started!.id });
    const before = (await f.store.load()).events; const h = mount(f.journey), user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'استأنف جلستك' }));
    await screen.findByLabelText('صفحة تدريب صناعية');
    expect(f.journey.active?.phase).toBe('training'); expect(f.journey.active?.id).toBe(started!.id);
    expect(h.go.mock.calls.map(call => call[0])).toEqual(['S07']);
    const after = (await f.store.load()).events;
    expect(after.filter(e => e.type === 'AssessmentSubmitted')).toHaveLength(0);
    for (const event of before) expect(after.find(e => e.eventId === event.eventId)).toEqual(event);
  });

  it('keyboard phase changes focus the next instruction without grading automatically or stealing moved focus', async () => {
    const f = await fixture(); await f.journey.start(); mount(f.journey, 'S07');
    render(<button>موضع آخر</button>); const elsewhere = screen.getByRole('button', { name: 'موضع آخر' });
    const user = userEvent.setup();
    screen.getByRole('button', { name: 'أنهيت الحفظ، أبدأ التسميع' }).focus();
    await user.keyboard('{Enter}');
    const legend = await screen.findByText('كيف كان تسميعك؟ اختر نتيجة واحدة لحفظها');
    await waitFor(() => expect(legend).toHaveFocus());
    expect(f.journey.view().observations).toBe(0);
    await user.tab(); expect(screen.getByRole('button', { name: normal })).toHaveFocus();
    await user.keyboard('{Enter}'); await saved();
    expect(screen.getByRole('heading', { name: 'حُفظ تقييمك الذاتي' })).toHaveFocus();
    expect((await f.store.load()).events.filter(event => event.type === 'AssessmentSubmitted')).toHaveLength(1);
    // A refresh of unchanged durable state must not move the reader's focus.
    elsewhere.focus(); await act(async () => { window.dispatchEvent(new Event('focus')); await f.journey.prepare(); });
    expect(elsewhere).toHaveFocus();
    await user.click(screen.getByText('خيارات الجلسة', { exact: true }));
    screen.getByRole('button', { name: 'صحّح النتيجة' }).focus(); await user.keyboard('{Enter}');
    expect(screen.getByText('اختر النتيجة الصحيحة — يبقى الأصل في السجل')).toHaveFocus();
    expect((await f.store.load()).events.filter(event => event.type === 'AssessmentCorrected')).toHaveLength(0);
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; }), action = f.journey.action.bind(f.journey);
    vi.spyOn(f.journey, 'action').mockImplementationOnce(async command => { await waiting; return action(command); });
    screen.getByRole('button', { name: 'سمّعت المقطع كاملًا بلا خطأ معلوم — بصعوبة' }).focus();
    await user.keyboard('{Enter}');
    elsewhere.focus();
    await act(async () => { release(); await waiting; }); await saved();
    expect(elsewhere).toHaveFocus();
    const events = (await f.store.load()).events;
    expect(events.filter(event => event.type === 'AssessmentSubmitted')).toHaveLength(1);
    expect(events.filter(event => event.type === 'AssessmentCorrected')).toHaveLength(1);
  });

});
