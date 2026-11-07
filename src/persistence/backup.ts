import { canonical, DomainError, VERSIONS, LEARNING_VERSIONS, type EventSnapshot, type EventStore, type LearningEvent } from '../core/types';
import { validateEvent } from './event-store';

/** Portable C12 backup. No device-local key or microphone data is exported. */
const FORMAT = 'MULAZAMA-ENCRYPTED-BACKUP';
const FORMAT_VERSION = 1;
const ITERATIONS = 600_000;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
type BackupHeader = {
  format: typeof FORMAT; version: 1; cipher: 'AES-256-GCM'; kdf: 'PBKDF2-SHA256';
  iterations: number; salt: string; iv: string; createdAt: string;
};
type EncryptedBackup = BackupHeader & { ciphertext: string };
export type ReplayValidator = (snapshot: EventSnapshot) => unknown | Promise<unknown>;
export interface BackupInspection {
  snapshot: EventSnapshot; eventCount: number; createdAt: string; payloadHash: string;
  encrypted: true; formatVersion: 1; replacementOnly: true;
}

function failure(code: string, message: string): never { throw new DomainError(code, message); }
function bytesToBase64(bytes: Uint8Array): string {
  let result = '';
  for (let offset = 0; offset < bytes.length; offset += 8192)
    result += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(result);
}
function fromBase64(value: unknown, maxBytes: number): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || value.length > Math.ceil(maxBytes / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    failure('INVALID_INPUT', 'النسخة غير مكتملة أو ترميزها غير صالح.');
  try {
    const decoded = atob(value);
    if (decoded.length > maxBytes) failure('INVALID_INPUT', 'حجم النسخة يتجاوز الحد المدعوم.');
    return Uint8Array.from(decoded, char => char.charCodeAt(0));
  } catch { return failure('INVALID_INPUT', 'تعذر قراءة ترميز النسخة.'); }
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length && actual.every(key => typeof key === 'string' && keys.includes(key));
}
function id(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 300; }
function instant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  return new Date(value).toISOString() === `${match[1]}.${(match[2] ?? '').padEnd(3, '0')}Z`;
}
export function validateBackupSnapshot(value: unknown): asserts value is EventSnapshot {
  if (!object(value) || !exactKeys(value, ['revision', 'events']) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0 || !Array.isArray(value.events) || value.events.length > 100_000)
    failure('INVALID_INPUT', 'بنية قاعدة التعلم في النسخة غير صالحة.');
  const ids = new Set<string>();
  for (const event of value.events) {
    // Use the same finite, plain JSON validation as the event store. Without this,
    // canonicalizing a Date or Map would silently replace its value with {}.
    try { validateEvent(event); }
    catch (error) {
      if (error instanceof DomainError) throw error;
      failure('INVALID_INPUT', 'تحتوي النسخة على بيانات غير قابلة للحفظ بصورة سليمة.');
    }
    if (!object(event) || !id(event.eventId) || !id(event.commandId) || !id(event.operationId) || !id(event.userId) || !id(event.type) ||
        !(event.unitId === null || id(event.unitId)) || !instant(event.occurredAt) || !instant(event.receivedAt) || !id(event.zoneId) ||
        !['V1', 'V2', 'V4', 'product'].includes(event.source as string) || !Array.isArray(event.coverage) ||
        event.coverage.some(item => !id(item)) || !object(event.data) || !object(event.versions))
      failure('INVALID_INPUT', 'تحتوي النسخة على واقعة غير مكتملة.');
    if (ids.has(event.eventId)) failure('EVENT_CONFLICT', 'تحتوي النسخة على معرف واقعة مكرر.');
    ids.add(event.eventId);
    if (![VERSIONS, LEARNING_VERSIONS].some(known => canonical(event.versions) === canonical(known)))
      failure('UNSUPPORTED_VERSION', 'تحتاج النسخة إلى إصدار محرك أو محتوى غير متاح حاليًا.');
    try { new Intl.DateTimeFormat('en', { timeZone: event.zoneId }); }
    catch { failure('INVALID_INPUT', 'المنطقة الزمنية في النسخة غير صالحة.'); }
  }
}
function checkPassword(password: string) {
  if (typeof password !== 'string' || Array.from(password).length < 12 || encoder.encode(password).byteLength > 1024 || decoder.decode(encoder.encode(password)) !== password)
    failure('INVALID_INPUT', 'استخدم كلمة استعادة من 12 حرفًا على الأقل. فقدها يمنع فتح النسخة.');
}
async function keyFor(password: string, salt: Uint8Array<ArrayBuffer>, usages: KeyUsage[]) {
  checkPassword(password);
  const base = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, false, usages);
}
async function sha256(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), x => x.toString(16).padStart(2, '0')).join('');
}

/** Returns encrypted bytes serialized as JSON; successful creation does not claim a filesystem save. */
export async function exportEncryptedBackup(snapshot: EventSnapshot, password: string): Promise<string> {
  validateBackupSnapshot(snapshot);
  checkPassword(password);
  const payload = canonical(snapshot);
  if (encoder.encode(payload).byteLength > MAX_FILE_BYTES / 1.5) failure('INVALID_INPUT', 'قاعدة التعلم أكبر من حد تصدير هذه النسخة.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const header: BackupHeader = { format: FORMAT, version: FORMAT_VERSION, cipher: 'AES-256-GCM', kdf: 'PBKDF2-SHA256',
    iterations: ITERATIONS, salt: bytesToBase64(salt), iv: bytesToBase64(iv), createdAt: new Date().toISOString() };
  const plaintext = encoder.encode(canonical({ snapshot, payloadHash: await sha256(payload) }));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(canonical(header)), tagLength: 128 },
    await keyFor(password, salt, ['encrypt']), plaintext));
  const serialized = JSON.stringify({ ...header, ciphertext: bytesToBase64(ciphertext) } satisfies EncryptedBackup);
  // Verify this exact portable representation before handing it to the file picker.
  await inspectEncryptedBackup(serialized, password);
  return serialized;
}

export async function inspectEncryptedBackup(serialized: string, password: string, validateReplay?: ReplayValidator): Promise<BackupInspection> {
  checkPassword(password);
  if (typeof serialized !== 'string' || encoder.encode(serialized).byteLength > MAX_FILE_BYTES)
    failure('INVALID_INPUT', 'حجم ملف النسخة غير مدعوم.');
  let file: Record<string, unknown>;
  try { const parsed: unknown = JSON.parse(serialized); if (!object(parsed)) throw new Error(); file = parsed; }
  catch { return failure('INVALID_INPUT', 'ملف النسخة غير مكتمل أو غير صالح.'); }
  if (!exactKeys(file, ['format', 'version', 'cipher', 'kdf', 'iterations', 'salt', 'iv', 'createdAt', 'ciphertext']))
    failure('INVALID_INPUT', 'تحتوي النسخة على حقول غير مدعومة في هذا الإصدار.');
  if (file.format !== FORMAT || file.version !== FORMAT_VERSION || file.cipher !== 'AES-256-GCM' || file.kdf !== 'PBKDF2-SHA256' || file.iterations !== ITERATIONS)
    failure('UNSUPPORTED_VERSION', 'صيغة النسخة أو إصدار حمايتها غير مدعوم.');
  if (!instant(file.createdAt)) failure('INVALID_INPUT', 'تاريخ النسخة غير صالح.');
  const salt = fromBase64(file.salt, 16), iv = fromBase64(file.iv, 12), ciphertext = fromBase64(file.ciphertext, MAX_FILE_BYTES);
  if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16) failure('INVALID_INPUT', 'النسخة مبتورة.');
  const header: BackupHeader = { format: FORMAT, version: FORMAT_VERSION, cipher: 'AES-256-GCM', kdf: 'PBKDF2-SHA256',
    iterations: ITERATIONS, salt: file.salt as string, iv: file.iv as string, createdAt: file.createdAt };
  let plaintext: ArrayBuffer;
  try { plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(canonical(header)), tagLength: 128 },
    await keyFor(password, salt, ['decrypt']), ciphertext); }
  catch { return failure('CONTENT_INTEGRITY_FAILURE', 'تعذر فتح النسخة: كلمة الاستعادة غير صحيحة أو الملف متلاعب به. لم تتغير بياناتك.'); }
  let payload: Record<string, unknown>;
  try { const decoded: unknown = JSON.parse(decoder.decode(plaintext)); if (!object(decoded)) throw new Error(); payload = decoded; }
  catch { return failure('INVALID_INPUT', 'محتويات النسخة غير صالحة.'); }
  if (!exactKeys(payload, ['snapshot', 'payloadHash'])) failure('INVALID_INPUT', 'بنية محتويات النسخة غير مدعومة.');
  validateBackupSnapshot(payload.snapshot);
  const payloadHash = await sha256(canonical(payload.snapshot));
  if (payload.payloadHash !== payloadHash) failure('CONTENT_INTEGRITY_FAILURE', 'بصمة البيانات داخل النسخة غير مطابقة.');
  if (validateReplay) await validateReplay(structuredClone(payload.snapshot));
  return { snapshot: payload.snapshot, eventCount: payload.snapshot.events.length, createdAt: header.createdAt,
    payloadHash, encrypted: true, formatVersion: FORMAT_VERSION, replacementOnly: true };
}

/** Full replacement only. Store.replace must provide atomic commit/rollback and CAS. */
export async function restoreEncryptedBackup(store: EventStore, serialized: string, password: string, options: {
  confirmed: boolean; expectedRevision: number; validateReplay: ReplayValidator;
}): Promise<EventSnapshot> {
  if (!object(options)) failure('INVALID_INPUT', 'خيارات الاستعادة غير صالحة.');
  if (options.confirmed !== true) failure('CONSENT_REQUIRED', 'تحتاج الاستعادة إلى تأكيد الاستبدال الكامل بعد معاينة النسخة.');
  if (typeof options.validateReplay !== 'function') failure('INVALID_INPUT', 'لم يهيأ تحقق إعادة بناء سجل التعلم.');
  if (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 0) failure('INVALID_INPUT', 'نسخة قاعدة التعلم المتوقعة غير صالحة.');
  const inspection = await inspectEncryptedBackup(serialized, password, options.validateReplay);
  return store.replace(inspection.snapshot.events as LearningEvent[], options.expectedRevision);
}
