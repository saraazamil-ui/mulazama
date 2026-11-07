import { canonical, DomainError, VERSIONS, type EventSnapshot } from '../core/types';
import { validateEvent } from '../persistence/event-store';
import { validateProductAction } from './validation';

const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
const EVENT_KEYS = ['eventId', 'commandId', 'operationId', 'userId', 'unitId', 'type', 'occurredAt', 'receivedAt', 'zoneId', 'source', 'coverage', 'versions', 'data'];
const INITIAL_PREFERENCE_KEYS = ['dark', 'largeText', 'reducedMotion', 'reminder'];
const PRODUCT_FACTS = Object.freeze({
  config: 'UserPlanConfigRevised',
  'plan.todayBudget': 'PlanRecomputed',
  'range.add': 'PriorKnowledgeDeclared',
  'range.remove': 'PriorKnowledgeDeclarationRemoved',
  'mistake.add': 'ProductMistakeDraftRecorded',
  'mistake.correct': 'MistakeCorrected',
  preferences: 'PreferencesRevised',
  'recovery.report': 'ExternalMaintenanceReported',
});
function fail(code: string, message: string): never { throw new DomainError(code, message); }

/** Check descriptors before reading a field; replay must mean the same thing in
 * memory, canonical JSON and an encrypted export. No accessor is evaluated. */
function plainJson(value: unknown, seen = new Set<object>(), depth = 0): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object' || depth > 64 || seen.has(value)) fail('INVALID_INPUT', 'سجل الواجهة يجب أن يحتوي بيانات JSON محدودة وصريحة.');
  const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
  if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) fail('INVALID_INPUT', 'سجل الواجهة لا يقبل النماذج الموروثة.');
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(value).length) fail('INVALID_INPUT', 'سجل الواجهة لا يقبل الحقول الرمزية.');
  if (array && Object.keys(descriptors).length !== (value as unknown[]).length + 1) fail('INVALID_INPUT', 'مصفوفة السجل غير مكتملة أو تحتوي حقولًا زائدة.');
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (array && key === 'length') continue;
    if (RESERVED.has(key) || !('value' in descriptor) || !descriptor.enumerable) fail('INVALID_INPUT', 'حقول الوصول والحقول المخفية أو المحجوزة غير مقبولة في السجل.');
    if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= (value as unknown[]).length)) fail('INVALID_INPUT', 'توجد حقول زائدة في مصفوفة السجل.');
    plainJson(descriptor.value, seen, depth + 1);
  }
  seen.delete(value);
}
function objectKeys(value: unknown, required: readonly string[], optional: readonly string[] = []): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_INPUT', 'يلزم كائن سجل صالح.');
  const allowed = new Set([...required, ...optional]);
  if (Object.keys(value).some(key => !allowed.has(key)) || required.some(key => !Object.hasOwn(value, key))) fail('INVALID_INPUT', 'مخطط سجل الواجهة غير مدعوم أو غير مكتمل.');
}
function id(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || RESERVED.has(value) || /[\u0000-\u001F\u007F]/u.test(value))
    fail('INVALID_INPUT', 'معرف سجل الواجهة غير صالح.');
}

/** Product records are declarations/settings, never learning or teacher evidence.
 * This validator neither reorders raw facts nor rewrites legacy versions. Store
 * append retries remain idempotent; duplicated facts in a restored raw stream
 * are corrupt input and are rejected rather than silently deduplicated.
 */
export function validateProductReplaySnapshot(value: unknown): asserts value is EventSnapshot {
  plainJson(value);
  objectKeys(value, ['revision', 'events']);
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0 || !Array.isArray(value.events) || value.events.length < 1 || value.events.length > 100_000)
    fail('INVALID_INPUT', 'بنية سجل الواجهة أو نسخته غير صالحة.');
  const events = value.events;
  const eventIds = new Set<string>(), commandIds = new Set<string>(), generatedIds = new Set<string>();
  let profileId: string | null = null;
  for (let index = 0; index < events.length; index++) {
    const event: unknown = events[index];
    objectKeys(event, EVENT_KEYS); validateEvent(event);
    for (const field of [event.eventId, event.commandId, event.operationId, event.userId]) id(field);
    if (eventIds.has(event.eventId)) fail('EVENT_CONFLICT', 'يوجد معرف واقعة مكرر في سجل الواجهة.');
    if (commandIds.has(event.commandId)) fail('EVENT_CONFLICT', 'يوجد أمر منتج مكرر في السجل الخام.');
    eventIds.add(event.eventId); commandIds.add(event.commandId);
    if (event.operationId !== event.commandId || event.source !== 'product' || event.unitId !== null || event.coverage.length !== 0 || event.zoneId !== 'Asia/Riyadh')
      fail('INVALID_INPUT', 'واقعة الواجهة لا تمثل دليل تعلم ولا تقبل تغيير مصدرها أو تغطيتها أو هويتها التشغيلية.');
    if (canonical(event.versions) !== canonical(VERSIONS)) fail('UNSUPPORTED_VERSION', 'نسخة سجل الواجهة غير مدعومة؛ لم تُغيّر البيانات.');
    if (event.type === 'ProfileInitialized') {
      if (index !== 0 || profileId !== null) fail('EVENT_CONFLICT', 'تهيئة المستخدم يجب أن تكون أول واقعة وحيدة للملف.');
      objectKeys(event.data, ['scope'], ['config', 'preferences']);
      if (event.data.scope !== 'product') fail('UNSUPPORTED_VERSION', 'نطاق سجل الواجهة غير مدعوم.');
      if (Object.hasOwn(event.data, 'config')) validateProductAction({ type: 'config', config: event.data.config });
      if (Object.hasOwn(event.data, 'preferences')) {
        objectKeys(event.data.preferences, INITIAL_PREFERENCE_KEYS);
        validateProductAction({ type: 'preferences', patch: event.data.preferences });
      }
      profileId = event.userId; continue;
    }
    if (profileId === null || event.userId !== profileId) fail('REFERENCE_MISMATCH', 'مرجع المستخدم في سجل الواجهة غير صالح.');
    objectKeys(event.data, ['scope', 'action', 'generatedIds']);
    if (event.data.scope !== 'product') fail('UNSUPPORTED_VERSION', 'نطاق سجل الواجهة غير مدعوم.');
    validateProductAction(event.data.action);
    const action = event.data.action;
    if (['commandId', 'expectedRevision', 'now'].some(key => Object.hasOwn(action, key))) fail('INVALID_INPUT', 'بيانات الأمر الخام لا تقبل إعادة تعريف بيانات غلاف الواقعة.');
    if (action.type.startsWith('session.') || action.type.startsWith('attempt.')) fail('CONTENT_UNAVAILABLE', 'سجل جلسة واجهة دون محتوى معتمد غير مقبول.');
    if (!Object.hasOwn(PRODUCT_FACTS, action.type) || PRODUCT_FACTS[action.type as keyof typeof PRODUCT_FACTS] !== event.type)
      fail('INVALID_INPUT', 'نوع واقعة الواجهة لا يطابق الأمر المدعوم.');
    if (!Array.isArray(event.data.generatedIds)) fail('INVALID_INPUT', 'معرفات الأمر المسجلة غير صالحة.');
    const expectedIds = action.type === 'mistake.add' || action.type === 'mistake.correct' ? 1 : 0;
    if (event.data.generatedIds.length !== expectedIds) fail('INVALID_INPUT', 'عدد المعرفات المسجلة لا يطابق أثر الأمر.');
    for (const generated of event.data.generatedIds) {
      id(generated);
      if (generatedIds.has(generated) || generated === profileId) fail('EVENT_CONFLICT', 'هوية كيان مولدة مكررة في سجل الواجهة.');
      generatedIds.add(generated);
    }
  }
}
