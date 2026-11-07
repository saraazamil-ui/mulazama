import { canonical, DomainError } from '../core/types';

export interface NotificationTask { id: string; plannedAt: string; completed: boolean; kind: 'daily' | 'review' | 'maintenance' | 'recovery' }
export interface NotificationCandidate {
  id: string; planRevision: number; zoneId: string; at: string; taskIds: string[];
  title: 'مُلازَمَة'; body: string; destination: 'S05' | 'S13';
}
export interface NotificationPolicy {
  planRevision: number; now: string; zoneId: string; enabled: boolean;
  permission: 'granted' | 'denied' | 'default'; activeSession: boolean;
  extraReminder: boolean; quietStartHour?: number; quietEndHour?: number;
}
function clock(instant: string, zoneId: string) {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new DomainError('INVALID_INPUT', 'وقت الإشعار غير صالح.');
  let parts: Intl.DateTimeFormatPart[];
  try { parts = new Intl.DateTimeFormat('en-CA', { timeZone: zoneId, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(date); }
  catch { throw new DomainError('INVALID_INPUT', 'منطقة الإشعارات الزمنية غير صالحة.'); }
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? '';
  return { localDate: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')), epoch: date.getTime() };
}
export function notificationCandidates(tasks: NotificationTask[], policy: NotificationPolicy): NotificationCandidate[] {
  const start = policy.quietStartHour ?? 21, end = policy.quietEndHour ?? 8;
  if (![start, end].every(h => Number.isSafeInteger(h) && h >= 0 && h <= 23) || !Number.isSafeInteger(policy.planRevision) || policy.planRevision < 0)
    throw new DomainError('INVALID_INPUT', 'سياسة الإشعارات غير صالحة.');
  const now = clock(policy.now, policy.zoneId).epoch;
  if (!policy.enabled || policy.permission !== 'granted' || policy.activeSession) return [];
  const grouped = new Map<string, NotificationCandidate[]>();
  const taskIds = new Set<string>();
  const sorted = [...tasks].sort((a, b) => a.plannedAt.localeCompare(b.plannedAt) || a.id.localeCompare(b.id));
  for (const task of sorted) {
    if (!task.id || taskIds.has(task.id)) continue;
    taskIds.add(task.id);
    if (task.completed) continue;
    const at = clock(task.plannedAt, policy.zoneId);
    const quiet = start === end ? false : start < end ? at.hour >= start && at.hour < end : at.hour >= start || at.hour < end;
    // Never compensate quiet/past reminders in a burst when the app opens.
    if (quiet || at.epoch <= now || at.epoch > now + 7 * 86_400_000) continue;
    const day = grouped.get(at.localDate) ?? [];
    const previous = day.at(-1);
    if (previous && (day.length >= (policy.extraReminder ? 2 : 1) || at.epoch - Date.parse(previous.at) < 4 * 3_600_000)) {
      previous.taskIds.push(task.id); continue;
    }
    day.push({ id: `mulazama:${policy.planRevision}:${policy.zoneId}:${at.localDate}:${day.length + 1}`,
      planRevision: policy.planRevision, zoneId: policy.zoneId, at: new Date(at.epoch).toISOString(), taskIds: [task.id],
      title: 'مُلازَمَة', body: 'حان وقت وردك المخطط بالمقدار المناسب لوقتك.', destination: task.kind === 'recovery' ? 'S13' : 'S05' });
    grouped.set(at.localDate, day);
  }
  return Array.from(grouped.values()).flat();
}
export interface NotificationPort {
  /** Native ports must list app-owned requests only, never another application's notifications. */
  listScheduled(): Promise<NotificationCandidate[]>;
  cancel(ids: string[]): Promise<void>;
  schedule(candidates: NotificationCandidate[]): Promise<void>;
}
/** No learning events are produced by scheduling or opening notifications. */
export async function reconcileNotifications(port: NotificationPort, desired: NotificationCandidate[]) {
  const current = await port.listScheduled();
  const desiredById = new Map(desired.map(item => [item.id, item]));
  if (desiredById.size !== desired.length) throw new DomainError('EVENT_CONFLICT', 'تكررت هوية إشعار في الخطة.');
  const cancel = current.filter(item => !desiredById.has(item.id) || canonical(desiredById.get(item.id)) !== canonical(item)).map(item => item.id);
  if (cancel.length) await port.cancel(cancel);
  const currentUnchanged = new Map(current.filter(item => !cancel.includes(item.id)).map(item => [item.id, item]));
  const add = desired.filter(item => !currentUnchanged.has(item.id));
  if (add.length) await port.schedule(add);
  return { cancelled: cancel.length, scheduled: add.length };
}
export function notificationPlatformStatus() {
  return { version: 'notification-policy-1', nativeSchedulingAvailable: false,
    scheduled: false, reason: 'حساب مرشحي التذكير متاح؛ جدولة إشعارات النظام في الخلفية تحتاج ربط المنصة واختبارها.' } as const;
}
