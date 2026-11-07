import { canonical, DomainError } from '../core/types';

export interface ContentManifestV1 {
  schemaVersion: 1; product: 'MULAZAMA'; editionId: string; contentVersion: string;
  riwaya: 'Hafs an Asim'; tariq: string | null; script: string; diacritics: string;
  verseNumbering: string; tokenizationVersion: string; layoutId: string; layoutVersion: string;
  source: { name: string; version: string; url: string; licenseId: string; licenseNotice: string; attribution: string };
  font: { name: string; version: string; licenseNotice: string };
  totals: { surahs: number; ayahs: number; tokens: number; pages: number; juz: number; hizb: number; rub: number };
  hashes: { algorithm: 'SHA-256'; text: string; mapping: string; font: string };
}
export interface ContentToken {
  surah: number; ayah: number; tokenIndex: number;
  /** Extraction offsets into unmodified source UTF-16; canonical identity remains edition/surah/ayah/tokenIndex. */
  sourceStart: number; sourceEnd: number; page: number; juz: number; hizb: number; rub: number;
}
export interface ContentPackage { manifest: ContentManifestV1; text: string; tokens: ContentToken[]; fontBytes: Uint8Array<ArrayBuffer> }
export interface ContentApproval {
  authorityId: string; reviewer: string; reviewedAt: string; manifestHash: string;
  reviewed: ('text' | 'riwaya' | 'script' | 'diacritics' | 'numbering' | 'segmentation' | 'layout' | 'license' | 'font' | 'boundaries')[];
  signature: string;
}
export interface ContentAuthority { id: string; publicKey: JsonWebKey }
const REVIEW_DIMENSIONS: ContentApproval['reviewed'] = ['text', 'riwaya', 'script', 'diacritics', 'numbering', 'segmentation', 'layout', 'license', 'font', 'boundaries'];
/** Empty until an independently reviewed release is approved. User files cannot add trust anchors. */
export const TRUSTED_CONTENT_AUTHORITIES: readonly ContentAuthority[] = Object.freeze([]);
const encoder = new TextEncoder();
const hashPattern = /^[a-f0-9]{64}$/;
function fail(code: string, message: string): never { throw new DomainError(code, message); }
function nonempty(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function secureSourceUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password; }
  catch { return false; }
}
export async function contentHash(value: string | Uint8Array<ArrayBuffer>): Promise<string> {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), v => v.toString(16).padStart(2, '0')).join('');
}
export function contentApprovalPayload(approval: Omit<ContentApproval, 'signature'>): string { return canonical(approval); }
export function contentUnavailable() {
  return { status: 'unavailable' as const, available: false as const, quranText: null, editionId: null,
    source: null, license: null, hash: null, reason: 'حزمة القرآن المعتمدة غير متاحة؛ جلسات القرآن والمصحف متوقفة حتى اعتماد النص والطبعة والترخيص والبصمة.' };
}

/** Cryptographic release gate, not a claim that hashing verifies Quranic correctness. */
export class ContentGate {
  private active: ContentPackage | null = null;
  private approval: ContentApproval | null = null;
  private readonly authorities: readonly ContentAuthority[];
  constructor(authorities: readonly ContentAuthority[] = TRUSTED_CONTENT_AUTHORITIES) {
    this.authorities = structuredClone(authorities);
  }
  status() {
    if (!this.active || !this.approval) return contentUnavailable();
    const manifest = this.active.manifest;
    return { status: 'approved' as const, available: true as const, editionId: manifest.editionId,
      contentVersion: manifest.contentVersion, source: structuredClone(manifest.source), hash: manifest.hashes.text,
      license: manifest.source.licenseNotice, quranText: null, reason: 'حزمة محددة الإصدار مع اعتماد مستقل موثق.' };
  }
  async verifyCandidate(pkg: ContentPackage): Promise<{ manifestHash: string; tokenCount: number }> {
    const m = pkg?.manifest;
    if (!m || m.schemaVersion !== 1 || m.product !== 'MULAZAMA' || m.riwaya !== 'Hafs an Asim' ||
        ![m.editionId, m.contentVersion, m.script, m.diacritics, m.verseNumbering, m.tokenizationVersion, m.layoutId, m.layoutVersion,
          m.source?.name, m.source?.version, m.source?.url, m.source?.licenseId, m.source?.licenseNotice, m.source?.attribution,
          m.font?.name, m.font?.version, m.font?.licenseNotice].every(nonempty) ||
        !(m.tariq === null || nonempty(m.tariq)) || !secureSourceUrl(m.source.url))
      fail('CONTENT_UNAVAILABLE', 'بيان المحتوى أو مصدره أو روايته أو ترخيصه غير مكتمل.');
    if (!m.hashes || m.hashes.algorithm !== 'SHA-256' || ![m.hashes.text, m.hashes.mapping, m.hashes.font].every(h => hashPattern.test(h)))
      fail('CONTENT_INTEGRITY_FAILURE', 'بصمات المحتوى غير صالحة.');
    if (!m.totals || Object.values(m.totals).some(v => !Number.isSafeInteger(v) || v <= 0) || m.totals.surahs !== 114 || m.totals.juz !== 30 || m.totals.hizb !== 60 || m.totals.rub !== 240)
      fail('CONTENT_INTEGRITY_FAILURE', 'بيانات السور والأجزاء والأحزاب والأرباع غير مكتملة.');
    if (typeof pkg.text !== 'string' || !pkg.text.length || !Array.isArray(pkg.tokens) || pkg.tokens.length !== m.totals.tokens || !(pkg.fontBytes instanceof Uint8Array) || pkg.fontBytes.length === 0)
      fail('CONTENT_UNAVAILABLE', 'ملفات النص أو خريطته أو الخط غير متاحة.');
    const [textHash, mappingHash, fontHash] = await Promise.all([contentHash(pkg.text), contentHash(canonical(pkg.tokens)), contentHash(pkg.fontBytes)]);
    if (textHash !== m.hashes.text || mappingHash !== m.hashes.mapping || fontHash !== m.hashes.font)
      fail('CONTENT_INTEGRITY_FAILURE', 'تعذر التحقق من المحتوى؛ لا تطابق الملفات بصمات البيان.');
    const positions = new Set<string>(), ayahs = new Set<string>(), surahs = new Set<number>();
    const pages = new Set<number>(), juz = new Set<number>(), hizb = new Set<number>(), rub = new Set<number>();
    let previousEnd = 0;
    let previous: ContentToken | null = null;
    for (const token of pkg.tokens) {
      if (!token || Object.values(token).some(v => !Number.isSafeInteger(v)) || token.surah < 1 || token.surah > 114 || token.ayah < 1 || token.tokenIndex < 0 ||
          token.sourceStart < previousEnd || token.sourceEnd <= token.sourceStart || token.sourceEnd > pkg.text.length ||
          token.page < 1 || token.page > m.totals.pages || token.juz < 1 || token.juz > 30 || token.hizb < 1 || token.hizb > 60 || token.rub < 1 || token.rub > 240)
        fail('CONTENT_INTEGRITY_FAILURE', 'تحتوي خريطة المحتوى على نطاق غير صالح.');
      if (previous && (token.surah < previous.surah || (token.surah === previous.surah && token.ayah < previous.ayah)))
        fail('CONTENT_INTEGRITY_FAILURE', 'ترتيب مواضع المحتوى غير صالح.');
      const sameAyah = previous?.surah === token.surah && previous.ayah === token.ayah;
      if (token.tokenIndex !== (sameAyah ? previous!.tokenIndex + 1 : 0)) fail('CONTENT_INTEGRITY_FAILURE', 'تسلسل تقطيع كلمات الآية غير صالح.');
      const key = `${token.surah}:${token.ayah}:${token.tokenIndex}`;
      if (positions.has(key)) fail('CONTENT_INTEGRITY_FAILURE', 'يوجد موضع نصي مكرر.');
      positions.add(key); ayahs.add(`${token.surah}:${token.ayah}`); surahs.add(token.surah);
      pages.add(token.page); juz.add(token.juz); hizb.add(token.hizb); rub.add(token.rub);
      previousEnd = token.sourceEnd; previous = token;
    }
    if (ayahs.size !== m.totals.ayahs || surahs.size !== m.totals.surahs || pages.size !== m.totals.pages || juz.size !== 30 || hizb.size !== 60 || rub.size !== 240)
      fail('CONTENT_INTEGRITY_FAILURE', 'تغطية خريطة المحتوى لا تطابق البيان.');
    return { manifestHash: await contentHash(canonical(m)), tokenCount: positions.size };
  }
  async activate(pkg: ContentPackage, approval: ContentApproval): Promise<void> {
    // Clone before async hashing/signature work so callers cannot mutate validated bytes during awaits.
    const candidate = structuredClone(pkg), attestation = structuredClone(approval);
    const verified = await this.verifyCandidate(candidate);
    const authority = this.authorities.find(a => a.id === attestation?.authorityId);
    if (!authority || !nonempty(attestation.reviewer) || !Number.isFinite(Date.parse(attestation.reviewedAt)) ||
        attestation.manifestHash !== verified.manifestHash || !Array.isArray(attestation.reviewed) ||
        REVIEW_DIMENSIONS.some(d => !attestation.reviewed.includes(d)))
      fail('CONTENT_UNAVAILABLE', 'الحزمة لم تحصل على اعتماد المحتوى المستقل المطلوب.');
    const { signature, ...signed } = attestation;
    let valid = false;
    try {
      const key = await crypto.subtle.importKey('jwk', authority.publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      const bytes = Uint8Array.from(atob(signature), char => char.charCodeAt(0));
      valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, bytes, encoder.encode(contentApprovalPayload(signed)));
    } catch { /* Invalid keys/signatures fail closed without replacing the active package. */ }
    if (!valid) fail('CONTENT_INTEGRITY_FAILURE', 'توقيع اعتماد المحتوى غير صالح.');
    this.active = candidate; this.approval = attestation;
  }
  assertAvailable(editionId?: string): ContentManifestV1 {
    if (!this.active || !this.approval) return fail('CONTENT_UNAVAILABLE', contentUnavailable().reason);
    if (editionId && editionId !== this.active.manifest.editionId) fail('REFERENCE_MISMATCH', 'النطاق تابع لنسخة محتوى مختلفة.');
    return structuredClone(this.active.manifest);
  }
  resolve(input: { editionId: string; surah: number; ayah: number; fromToken: number; toTokenExclusive: number }) {
    this.assertAvailable(input.editionId);
    if (!Number.isSafeInteger(input.fromToken) || !Number.isSafeInteger(input.toTokenExclusive) || input.fromToken < 0 || input.toTokenExclusive <= input.fromToken)
      fail('INVALID_INPUT', 'نطاق الكلمات غير صالح.');
    const tokens = this.active!.tokens.filter(t => t.surah === input.surah && t.ayah === input.ayah && t.tokenIndex >= input.fromToken && t.tokenIndex < input.toTokenExclusive);
    if (tokens.length !== input.toTokenExclusive - input.fromToken) fail('REFERENCE_MISMATCH', 'النطاق غير موجود في المحتوى المعتمد.');
    return tokens.map(token => ({ ...token, text: this.active!.text.slice(token.sourceStart, token.sourceEnd) }));
  }
}
