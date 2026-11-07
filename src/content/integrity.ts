/**
 * Pre-release audit only. No function in this module grants scientific approval,
 * installs a trust anchor, activates content, or rewrites a source file.
 * A source document uses explicit surah|ayah|text records; original bytes and
 * source UTF-16 offsets remain authoritative for extraction.
 */
export type IntegrityStatus = 'passed' | 'failed' | 'blocked';
export interface IntegrityIssue { code: string; detail: string; line?: number }
export interface EditionAuditProfile {
  schemaVersion: 1;
  editionId: string;
  numbering: string;
  basmalaPolicy: string;
  expectedAyahsPerSurah: number[];
  provenance: { publisher: string; url: string; version: string; documentSha256: string };
  /** Synthetic fixtures may exercise mechanics; they never become release evidence. */
  testOnly: boolean;
}
export interface SourceProvenance {
  publisher: string; url: string; version: string;
  /** Different mirrors of a single dataset share a lineageId. */
  lineageId: string;
}
export interface AyahSourceRecord {
  surah: number; ayah: number; text: string;
  sourceStart: number; sourceEnd: number; line: number;
}
export interface ContentByteAudit {
  auditVersion: 'mulazama-content-audit/1';
  structuralStatus: IntegrityStatus;
  /** Mechanical checks are deliberately insufficient for activation. */
  scientificApproval: 'not_granted';
  releaseEligibility: 'requires-independent-content-release';
  testOnly: boolean | null;
  sourceHash: string | null;
  byteLength: number | null;
  sourceText: string | null;
  profile: EditionAuditProfile | null;
  provenance: SourceProvenance | null;
  records: AyahSourceRecord[];
  counts: { surahs: number; ayahs: number } | null;
  checks: { utf8: IntegrityStatus; hash: IntegrityStatus; numbering: IntegrityStatus; order: IntegrityStatus };
  issues: IntegrityIssue[];
}
export class ContentIntegrityError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'ContentIntegrityError'; }
}
const hashPattern = /^[a-f0-9]{64}$/;
const hasText = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0;
const httpsUrl = (s: string): boolean => {
  try { const u = new URL(s); return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password; }
  catch { return false; }
};
export async function sourceSha256(bytes: Uint8Array): Promise<string> {
  // Own the backing buffer: a caller cannot change bytes during digest().
  const copy = new Uint8Array(bytes);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', copy.buffer)), b => b.toString(16).padStart(2, '0')).join('');
}
export function decodeSourceUtf8(bytes: Uint8Array): string {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new ContentIntegrityError('INVALID_UTF8', 'Input is not strictly valid UTF-8.'); }
  // Decoder errors, substitution characters and hidden transport controls must
  // be investigated, never silently removed from Quran content.
  if (/\uFFFD|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text))
    throw new ContentIntegrityError('UNEXPECTED_CODEPOINT', 'Replacement characters or transport controls are present.');
  const roundTrip = new TextEncoder().encode(text);
  if (roundTrip.length !== bytes.length || roundTrip.some((v, i) => v !== bytes[i]))
    throw new ContentIntegrityError('BYTE_ROUNDTRIP_FAILED', 'UTF-8 decoding did not preserve the original bytes.');
  return text;
}
function validateProfile(profile: EditionAuditProfile): IntegrityIssue[] {
  const p = profile?.provenance;
  if (profile?.schemaVersion !== 1 || !hasText(profile.editionId) || !hasText(profile.numbering) || !hasText(profile.basmalaPolicy) ||
      typeof profile.testOnly !== 'boolean' || !Array.isArray(profile.expectedAyahsPerSurah) || profile.expectedAyahsPerSurah.length < 1 || profile.expectedAyahsPerSurah.length > 114 ||
      (!profile.testOnly && profile.expectedAyahsPerSurah.length !== 114) ||
      profile.expectedAyahsPerSurah.some(n => !Number.isSafeInteger(n) || n < 1 || n > 10000) ||
      !p || ![p.publisher, p.version].every(hasText) || !httpsUrl(p.url) || !hashPattern.test(p.documentSha256))
    return [{ code: 'INVALID_EDITION_PROFILE', detail: 'A complete source-pinned numbering and basmala profile is required.' }];
  return [];
}

/** Parse only an explicitly selected indexed format. No trimming, normalization,
 * sorting, diacritic removal or basmala splitting occurs. Comments/line endings
 * remain in sourceText and its raw-file hash. */
export function parseIndexedAyahSource(sourceText: string): { records: AyahSourceRecord[]; issues: IntegrityIssue[] } {
  const records: AyahSourceRecord[] = [], issues: IntegrityIssue[] = [];
  let offset = 0, lineNumber = 0;
  // A BOM, if supplied by the publisher, is an envelope byte sequence. Preserve
  // it in the source and hash; allow it only before the first record/comment.
  for (const lineWithTerminator of sourceText.match(/[^\n]*\n|[^\n]+$/gu) ?? []) {
    lineNumber++;
    let line = lineWithTerminator.endsWith('\n') ? lineWithTerminator.slice(0, -1) : lineWithTerminator;
    if (line.endsWith('\r')) line = line.slice(0, -1);
    let envelopeOffset = 0;
    if (lineNumber === 1 && line.startsWith('\uFEFF')) { line = line.slice(1); envelopeOffset = 1; }
    if (line.includes('\uFEFF') || line.includes('\r')) {
      issues.push({ code: 'INVALID_LINE_ENCODING', detail: 'Unexpected embedded BOM or carriage return.', line: lineNumber });
    } else if (line !== '' && !line.startsWith('#')) {
      const match = /^([1-9][0-9]*)\|([1-9][0-9]*)\|(.+)$/u.exec(line);
      if (!match || match[3].includes('|') || /^\s|\s$/u.test(match[3])) {
        issues.push({ code: 'INVALID_RECORD', detail: 'Expected canonical positive identifiers and an unchanged nonempty text field.', line: lineNumber });
      } else {
        const surah = Number(match[1]), ayah = Number(match[2]);
        const sourceStart = offset + envelopeOffset + match[1].length + match[2].length + 2;
        if (!Number.isSafeInteger(surah) || !Number.isSafeInteger(ayah))
          issues.push({ code: 'UNSAFE_IDENTIFIER', detail: 'Identifier exceeds the safe integer range.', line: lineNumber });
        else records.push({ surah, ayah, text: match[3], sourceStart, sourceEnd: sourceStart + match[3].length, line: lineNumber });
      }
    }
    offset += lineWithTerminator.length;
  }
  if (records.length === 0) issues.push({ code: 'EMPTY_CONTENT', detail: 'No indexed text records were found.' });
  return { records, issues };
}

export async function auditContentBytes(input: {
  bytes: Uint8Array | null;
  profile: EditionAuditProfile | null;
  expectedSha256: string | null;
  provenance?: SourceProvenance | null;
}): Promise<ContentByteAudit> {
  // Snapshot before asynchronous hashing, including externally mutable metadata.
  const bytes = input.bytes === null ? null : new Uint8Array(input.bytes);
  const expectedSha256 = input.expectedSha256;
  const profile = input.profile === null ? null : structuredClone(input.profile);
  const provenance = input.provenance ? structuredClone(input.provenance) : null;
  const result: ContentByteAudit = { auditVersion: 'mulazama-content-audit/1', structuralStatus: 'blocked',
    scientificApproval: 'not_granted', releaseEligibility: 'requires-independent-content-release', testOnly: profile?.testOnly ?? null,
    sourceHash: null, byteLength: bytes?.byteLength ?? null, sourceText: null, profile, provenance, records: [], counts: null,
    checks: { utf8: 'blocked', hash: 'blocked', numbering: 'blocked', order: 'blocked' }, issues: [] };
  if (!bytes) { result.issues.push({ code: 'SOURCE_BYTES_MISSING', detail: 'Publisher bytes have not been obtained; no content integrity success can be asserted.' }); return result; }
  result.sourceHash = await sourceSha256(bytes);
  try { result.sourceText = decodeSourceUtf8(bytes); result.checks.utf8 = 'passed'; }
  catch (error) {
    result.structuralStatus = 'failed'; result.checks.utf8 = 'failed';
    result.issues.push({ code: error instanceof ContentIntegrityError ? error.code : 'DECODE_FAILED', detail: 'Strict original-byte UTF-8 decoding failed.' }); return result;
  }
  if (expectedSha256 === null) result.issues.push({ code: 'PINNED_HASH_MISSING', detail: 'No independently recorded publisher-download hash was supplied.' });
  else if (!hashPattern.test(expectedSha256) || expectedSha256 !== result.sourceHash) {
    result.checks.hash = 'failed'; result.issues.push({ code: 'SOURCE_HASH_MISMATCH', detail: 'Raw publisher-file hash differs from the pinned hash.' });
  } else result.checks.hash = 'passed';
  const parsed = parseIndexedAyahSource(result.sourceText); result.records = parsed.records; result.issues.push(...parsed.issues);
  if (!profile) result.issues.push({ code: 'NUMBERING_PROFILE_MISSING', detail: 'Do not infer verse numbering, surah boundaries or counts from an unverified file.' });
  else result.issues.push(...validateProfile(profile));
  const validProfile = profile && !result.issues.some(i => i.code === 'INVALID_EDITION_PROFILE');
  const keys = new Set<string>(); let previous: AyahSourceRecord | undefined;
  for (const r of parsed.records) {
    const key = `${r.surah}:${r.ayah}`;
    if (keys.has(key)) result.issues.push({ code: 'DUPLICATE_AYAH', detail: `Duplicate identifier ${key}.`, line: r.line });
    keys.add(key);
    if (previous && (r.surah < previous.surah || (r.surah === previous.surah && r.ayah <= previous.ayah)))
      result.issues.push({ code: 'AYAH_ORDER', detail: 'Source records are not in strict canonical order.', line: r.line });
    if (validProfile && (r.surah > profile.expectedAyahsPerSurah.length || r.ayah > profile.expectedAyahsPerSurah[r.surah - 1]))
      result.issues.push({ code: 'AYAH_OUT_OF_BOUNDS', detail: `Identifier ${key} is not in the pinned numbering profile.`, line: r.line });
    if (result.sourceText.slice(r.sourceStart, r.sourceEnd) !== r.text)
      result.issues.push({ code: 'SOURCE_EXTRACTION_MISMATCH', detail: 'Extracted text differs from the original source slice.', line: r.line });
    previous = r;
  }
  if (validProfile) {
    const expectedTotal = profile.expectedAyahsPerSurah.reduce((a, b) => a + b, 0);
    if (keys.size !== expectedTotal) result.issues.push({ code: 'AYAH_COUNT_MISMATCH', detail: `Expected ${expectedTotal} distinct records; found ${keys.size}.` });
    for (let s = 0; s < profile.expectedAyahsPerSurah.length; s++) for (let a = 1; a <= profile.expectedAyahsPerSurah[s]; a++) {
      if (!keys.has(`${s + 1}:${a}`)) result.issues.push({ code: 'MISSING_AYAH', detail: `Missing ${s + 1}:${a}.` });
    }
    result.checks.numbering = result.issues.some(i => ['DUPLICATE_AYAH', 'AYAH_OUT_OF_BOUNDS', 'AYAH_COUNT_MISMATCH', 'MISSING_AYAH', 'INVALID_RECORD', 'UNSAFE_IDENTIFIER'].includes(i.code)) ? 'failed' : 'passed';
  }
  result.checks.order = result.issues.some(i => ['AYAH_ORDER', 'DUPLICATE_AYAH', 'INVALID_RECORD', 'INVALID_LINE_ENCODING', 'EMPTY_CONTENT', 'SOURCE_EXTRACTION_MISMATCH'].includes(i.code)) ? 'failed' : 'passed';
  result.counts = { surahs: new Set(parsed.records.map(r => r.surah)).size, ayahs: keys.size };
  const blockedCodes = new Set(['PINNED_HASH_MISSING', 'NUMBERING_PROFILE_MISSING']);
  result.structuralStatus = result.issues.some(i => !blockedCodes.has(i.code)) ? 'failed' : result.issues.length ? 'blocked' : 'passed';
  return result;
}

export interface SourceComparison {
  status: IntegrityStatus; comparison: 'exact-codepoint-per-ayah';
  comparedAyahs: number; differences: { key: string; reason: 'missing-in-primary' | 'missing-in-reference' | 'text-differs' }[];
  blockers: string[]; scientificApproval: 'not_granted';
}
/** Sources must independently document a compatible edition and basmala policy.
 * Equality is exact. No normalized text is ever substituted for source content. */
export function compareIndependentSources(primary: ContentByteAudit, reference: ContentByteAudit): SourceComparison {
  const out: SourceComparison = { status: 'blocked', comparison: 'exact-codepoint-per-ayah', comparedAyahs: 0, differences: [], blockers: [], scientificApproval: 'not_granted' };
  if (primary.structuralStatus !== 'passed' || reference.structuralStatus !== 'passed') out.blockers.push('BOTH_BYTE_AUDITS_MUST_PASS');
  if (!primary.provenance || !reference.provenance || ![primary.provenance.publisher, reference.provenance.publisher, primary.provenance.version, reference.provenance.version, primary.provenance.lineageId, reference.provenance.lineageId].every(hasText) ||
      !httpsUrl(primary.provenance.url) || !httpsUrl(reference.provenance.url)) out.blockers.push('SOURCE_PROVENANCE_MISSING');
  else if (primary.provenance.publisher === reference.provenance.publisher || primary.provenance.lineageId === reference.provenance.lineageId) out.blockers.push('REFERENCE_IS_NOT_INDEPENDENT');
  const a = primary.profile, b = reference.profile;
  if (!a || !b || a.editionId !== b.editionId || a.numbering !== b.numbering || a.basmalaPolicy !== b.basmalaPolicy ||
      JSON.stringify(a.expectedAyahsPerSurah) !== JSON.stringify(b.expectedAyahsPerSurah)) out.blockers.push('EDITION_OR_NUMBERING_OR_BASMALA_MISMATCH');
  if (out.blockers.length) return out;
  const left = new Map(primary.records.map(r => [`${r.surah}:${r.ayah}`, r.text]));
  const right = new Map(reference.records.map(r => [`${r.surah}:${r.ayah}`, r.text]));
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    if (!left.has(key)) out.differences.push({ key, reason: 'missing-in-primary' });
    else if (!right.has(key)) out.differences.push({ key, reason: 'missing-in-reference' });
    else { out.comparedAyahs++; if (left.get(key) !== right.get(key)) out.differences.push({ key, reason: 'text-differs' }); }
  }
  out.status = out.differences.length ? 'failed' : 'passed'; return out;
}

export interface ContentAuditRange { editionId: string; surah: number; ayah: number; sourceStart: number; sourceEnd: number }
/** Validate supplied token or waqf candidates; this does not approve semantics. */
export function validateContentRanges(audit: ContentByteAudit, ranges: readonly ContentAuditRange[]): { status: IntegrityStatus; issues: IntegrityIssue[] } {
  if (audit.structuralStatus !== 'passed' || !audit.profile || audit.sourceText === null)
    return { status: 'blocked', issues: [{ code: 'VALID_SOURCE_REQUIRED', detail: 'Ranges require a passing byte and numbering audit.' }] };
  const records = new Map(audit.records.map(r => [`${r.surah}:${r.ayah}`, r]));
  const issues: IntegrityIssue[] = []; let previousEnd = -1;
  for (const range of ranges) {
    const r = records.get(`${range.surah}:${range.ayah}`);
    if (range.editionId !== audit.profile.editionId || !r) issues.push({ code: 'RANGE_REFERENCE_MISMATCH', detail: 'Range refers to an unverified edition or verse.' });
    else if (!Number.isSafeInteger(range.sourceStart) || !Number.isSafeInteger(range.sourceEnd) || range.sourceStart < r.sourceStart || range.sourceEnd > r.sourceEnd || range.sourceEnd <= range.sourceStart || range.sourceStart < previousEnd)
      issues.push({ code: 'INVALID_CONTENT_RANGE', detail: 'Range is empty, overlapping, unordered or outside its exact source verse.' });
    else {
      const beforeStart = audit.sourceText.charCodeAt(range.sourceStart - 1), atStart = audit.sourceText.charCodeAt(range.sourceStart);
      const beforeEnd = audit.sourceText.charCodeAt(range.sourceEnd - 1), atEnd = audit.sourceText.charCodeAt(range.sourceEnd);
      if ((beforeStart >= 0xD800 && beforeStart <= 0xDBFF && atStart >= 0xDC00 && atStart <= 0xDFFF) ||
          (beforeEnd >= 0xD800 && beforeEnd <= 0xDBFF && atEnd >= 0xDC00 && atEnd <= 0xDFFF))
        issues.push({ code: 'SPLIT_SURROGATE_PAIR', detail: 'A range boundary splits a Unicode supplementary character.' });
      if (/^\p{M}/u.test(audit.sourceText.slice(range.sourceStart)) ||
          (range.sourceEnd < r.sourceEnd && /^\p{M}/u.test(audit.sourceText.slice(range.sourceEnd))))
        issues.push({ code: 'SPLIT_COMBINING_SEQUENCE', detail: 'A range boundary separates a combining mark from its base character.' });
    }
    previousEnd = range.sourceEnd;
  }
  if (!ranges.length) issues.push({ code: 'RANGE_MAP_MISSING', detail: 'No token/boundary map was supplied.' });
  return { status: issues.length ? 'failed' : 'passed', issues };
}
