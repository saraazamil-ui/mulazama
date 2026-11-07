// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { checkForecastSufficiency, forecastSnapshot, FORECAST_REFUSAL } from './forecast';
import { localMediaStatus } from './media';
import { notificationCandidates, reconcileNotifications, notificationPlatformStatus, type NotificationCandidate, type NotificationPolicy, type NotificationTask } from './notifications';

const policy: NotificationPolicy = { planRevision: 1, now: '2026-11-05T05:00:00.000Z', zoneId: 'Asia/Riyadh',
  enabled: true, permission: 'granted', activeSession: false, extraReminder: false };
const tasks: NotificationTask[] = [
  { id: 'a', plannedAt: '2026-11-05T06:00:00.000Z', completed: false, kind: 'daily' },
  { id: 'b', plannedAt: '2026-11-05T07:00:00.000Z', completed: false, kind: 'review' },
  { id: 'c', plannedAt: '2026-11-05T11:00:00.000Z', completed: false, kind: 'maintenance' },
];
describe('platform policies with explicit capability boundaries', () => {
  it('P01 refuses forecast dates when data are inadequate and does not change the plan', () => {
    const result = forecastSnapshot(); expect(result.reason).toBe(FORECAST_REFUSAL);
    expect(Object.values(result.horizons)).toEqual([null, null, null, null]); expect(result.initialCompletionDate).toBeNull(); expect(result.changesPlan).toBe(false);
  });
  it('P02 distinguishes a sufficient data gate from the absent retrospective model validation', () => {
    const sufficient = { calendarDays: 28, activeDays: 10, acquiredUnitsWithKnownTime: 10, maintenanceTimeMeasured: true,
      replayPending: false, recoveryActive: false, capacityFeasible: true, planStable: true, declaredComplete: false };
    expect(checkForecastSufficiency(sufficient).sufficient).toBe(true);
    expect(forecastSnapshot(sufficient).modelStatus).toBe('retrospective_validation_pending'); expect(forecastSnapshot(sufficient).initialCompletionDate).toBeNull();
    expect(forecastSnapshot({ ...sufficient, capacityFeasible: false }).status).toBe('capacity_infeasible');
    expect(forecastSnapshot({ ...sufficient, declaredComplete: true }).status).toBe('completed');
  });
  it('P03 defaults to one private combined reminder per local day', () => {
    const result = notificationCandidates(tasks, policy); expect(result).toHaveLength(1); expect(result[0].taskIds).toEqual(['a', 'b', 'c']);
    expect(result[0].title).toBe('مُلازَمَة'); expect(result[0].body).not.toMatch(/خطأ|ضعف|درجة/);
  });
  it('P04 opt-in extra reminder respects the two/day and four-hour limits', () => {
    const result = notificationCandidates(tasks, { ...policy, extraReminder: true }); expect(result).toHaveLength(2);
    expect(Date.parse(result[1].at) - Date.parse(result[0].at)).toBeGreaterThanOrEqual(4 * 3_600_000);
    expect(result[0].taskIds).toEqual(['a', 'b']); expect(result[1].taskIds).toEqual(['c']);
  });
  it('P05 permission refusal, disabled reminders, and active sessions prevent candidates', () => {
    expect(notificationCandidates(tasks, { ...policy, permission: 'denied' })).toEqual([]);
    expect(notificationCandidates(tasks, { ...policy, enabled: false })).toEqual([]);
    expect(notificationCandidates(tasks, { ...policy, activeSession: true })).toEqual([]);
  });
  it('P06 quiet hours and past/far-future tasks are skipped rather than queued in a burst', () => {
    const withDisallowed: NotificationTask[] = [
      { ...tasks[0], id: 'past', plannedAt: '2026-11-05T04:59:00.000Z' },
      { ...tasks[0], id: 'quiet', plannedAt: '2026-11-05T19:00:00.000Z' },
      { ...tasks[0], id: 'far', plannedAt: '2026-11-13T10:00:00.000Z' },
      { ...tasks[0], id: 'done', completed: true },
    ];
    expect(notificationCandidates(withDisallowed, policy)).toEqual([]);
  });
  it('P07 changing the timezone recomputes quiet hours and request identities', () => {
    expect(notificationCandidates([tasks[0]], policy)).toHaveLength(1); // 09:00 in Riyadh
    expect(notificationCandidates([tasks[0]], { ...policy, zoneId: 'UTC' })).toEqual([]); // 06:00 in UTC
    const riyadh = notificationCandidates([tasks[2]], policy), utc = notificationCandidates([tasks[2]], { ...policy, zoneId: 'UTC' });
    expect(riyadh[0].id).not.toBe(utc[0].id);
  });
  it('P08 reconciliation cancels obsolete requests, is idempotent, and cancels after revocation', async () => {
    let scheduled: NotificationCandidate[] = [];
    const port = { listScheduled: async () => structuredClone(scheduled), cancel: async (ids: string[]) => { scheduled = scheduled.filter(x => !ids.includes(x.id)); },
      schedule: async (items: NotificationCandidate[]) => { scheduled.push(...structuredClone(items)); } };
    const desired = notificationCandidates(tasks, policy);
    expect(await reconcileNotifications(port, desired)).toEqual({ cancelled: 0, scheduled: 1 });
    expect(await reconcileNotifications(port, desired)).toEqual({ cancelled: 0, scheduled: 0 });
    expect(await reconcileNotifications(port, notificationCandidates(tasks, { ...policy, planRevision: 2 }))).toEqual({ cancelled: 1, scheduled: 1 });
    expect(await reconcileNotifications(port, notificationCandidates(tasks, { ...policy, permission: 'denied' }))).toEqual({ cancelled: 1, scheduled: 0 });
    expect(scheduled).toEqual([]);
  });
  it('P09 output is deterministic without duplicating task identities', () => {
    expect(notificationCandidates([...tasks].reverse(), policy)).toEqual(notificationCandidates(tasks, policy));
    expect(notificationCandidates([...tasks, tasks[0]], policy)[0].taskIds).toEqual(['a', 'b', 'c']);
  });
  it('P10 unsupported native scheduling and optional media remain explicitly unavailable', () => {
    expect(notificationPlatformStatus().scheduled).toBe(false); expect(notificationPlatformStatus().nativeSchedulingAvailable).toBe(false);
    expect(localMediaStatus()).toMatchObject({ available: false, microphoneRequested: false, scheduledUpload: false });
  });
});
