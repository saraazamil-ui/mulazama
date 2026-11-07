// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { auditContentBytes, compareIndependentSources, decodeSourceUtf8, parseIndexedAyahSource, sourceSha256, validateContentRanges,
  type EditionAuditProfile, type SourceProvenance } from './integrity';

/** These are artificial labels, not verses or a candidate Quran package. */
const source = '# SYNTHETIC-NON-QURAN TEST ONLY\r\n1|1|SYNTHETIC_A\r\n1|2|SYNTHETIC_B\r\n2|1|SYNTHETIC_C\r\n';
const encode = (text: string) => new TextEncoder().encode(text);
const profile: EditionAuditProfile = { schemaVersion: 1, editionId: 'synthetic-non-quran', numbering: 'test-numbering/1',
  basmalaPolicy: 'not-applicable-synthetic', expectedAyahsPerSurah: [2, 1], testOnly: true,
  provenance: { publisher: 'Synthetic fixture', url: 'https://example.invalid/profile', version: '1', documentSha256: 'a'.repeat(64) } };
const provenance: SourceProvenance = { publisher: 'Synthetic source A', url: 'https://example.invalid/a', version: '1', lineageId: 'synthetic-a' };
async function audit(text = source, p = profile, origin = provenance) {
  return auditContentBytes({ bytes: encode(text), profile: p, expectedSha256: await sourceSha256(encode(text)), provenance: origin });
}
describe('C01 original-byte content integrity pipeline (synthetic only)', () => {
  it('QI01 missing downloaded bytes is blocked, with no fabricated hash or approval', async () => {
    expect(await auditContentBytes({ bytes: null, profile: null, expectedSha256: null })).toMatchObject({ structuralStatus: 'blocked', sourceHash: null,
      sourceText: null, counts: null, scientificApproval: 'not_granted', releaseEligibility: 'requires-independent-content-release' });
  });
  it('QI02 preserves bytes, comments, CRLF, extraction and exact hashes', async () => {
    const result = await audit(); expect(result.structuralStatus).toBe('passed');
    expect(result.sourceText).toBe(source); expect(result.counts).toEqual({ surahs: 2, ayahs: 3 });
    expect(result.sourceHash).toBe(await sourceSha256(encode(source))); expect(result.sourceHash).not.toBe(await sourceSha256(encode(source.replaceAll('\r\n', '\n'))));
    for (const r of result.records) expect(result.sourceText!.slice(r.sourceStart, r.sourceEnd)).toBe(r.text);
    expect(result.scientificApproval).toBe('not_granted'); expect(result.testOnly).toBe(true);
  });
  it.each([[0xC0, 0xAF], [0xE2, 0x82], [0xED, 0xA0, 0x80], [0xF4, 0x90, 0x80, 0x80]])('QI03 rejects invalid UTF-8 sequence %j', async (...values) => {
    const bytes = new Uint8Array(values); const result = await auditContentBytes({ bytes, profile, expectedSha256: await sourceSha256(bytes) });
    expect(result.structuralStatus).toBe('failed'); expect(result.checks.utf8).toBe('failed'); expect(result.issues[0].code).toBe('INVALID_UTF8');
  });
  it('QI04 rejects literal replacement characters and NUL rather than repairing them', () => {
    for (const suffix of ['\uFFFD', '\0']) expect(() => decodeSourceUtf8(encode(source + suffix))).toThrow();
  });
  it('QI05 preserves a publisher BOM in bytes and accurately offsets the first text', async () => {
    const text = '\uFEFF1|1|SYNTHETIC_A\n1|2|SYNTHETIC_B\n2|1|SYNTHETIC_C';
    const result = await audit(text); expect(result.structuralStatus).toBe('passed'); expect(result.sourceText).toBe(text);
    expect(result.records[0].sourceStart).toBe(5); expect(text.slice(result.records[0].sourceStart, result.records[0].sourceEnd)).toBe('SYNTHETIC_A');
  });
  it('QI06 rejects embedded BOM and malformed record delimiters without stripping data', async () => {
    for (const text of [source.replace('SYNTHETIC_B', '\uFEFFSYNTHETIC_B'), source.replace('1|2|', '01|2|'), source.replace('SYNTHETIC_B', 'SYNTHETIC|B'), source.replace('SYNTHETIC_B', ' SYNTHETIC_B')])
      expect((await audit(text)).structuralStatus).toBe('failed');
  });
  it('QI07 rejects duplicate IDs, including duplicate entries with identical text', async () => {
    const result = await audit(source + '2|1|SYNTHETIC_C\n'); expect(result.structuralStatus).toBe('failed');
    expect(result.issues.map(x => x.code)).toContain('DUPLICATE_AYAH');
  });
  it('QI08 rejects reordered records rather than silently sorting them', async () => {
    const result = await audit('1|2|SYNTHETIC_B\n1|1|SYNTHETIC_A\n2|1|SYNTHETIC_C');
    expect(result.structuralStatus).toBe('failed'); expect(result.issues.map(x => x.code)).toContain('AYAH_ORDER');
  });
  it('QI09 catches missing verses, invalid surah boundaries and out-of-bounds identifiers', async () => {
    for (const text of [source.replace('1|2|SYNTHETIC_B\r\n', ''), source.replace('2|1|', '3|1|'), source.replace('1|2|', '1|3|')]) {
      const result = await audit(text); expect(result.structuralStatus).toBe('failed'); expect(result.issues.map(x => x.code)).toContain('MISSING_AYAH');
    }
  });
  it('QI10 requires an external numbering profile and pre-recorded source-file hash', async () => {
    const result = await auditContentBytes({ bytes: encode(source), profile: null, expectedSha256: null });
    expect(result.structuralStatus).toBe('blocked'); expect(result.checks).toMatchObject({ utf8: 'passed', hash: 'blocked', numbering: 'blocked' });
  });
  it('QI11 fails a changed file even if its records remain structurally valid', async () => {
    const result = await auditContentBytes({ bytes: encode(source.replace('SYNTHETIC_B', 'SYNTHETIC_X')), profile, expectedSha256: await sourceSha256(encode(source)) });
    expect(result.structuralStatus).toBe('failed'); expect(result.issues.map(x => x.code)).toContain('SOURCE_HASH_MISMATCH');
  });
  it('QI12 does not accept a partial synthetic profile as a production numbering profile', async () => {
    expect((await audit(source, { ...profile, testOnly: false })).structuralStatus).toBe('failed');
  });
  it('QI13 snapshots mutable source inputs and profile before asynchronous hashing', async () => {
    const bytes = encode(source), p = structuredClone(profile), expectedSha256 = await sourceSha256(bytes);
    const promise = auditContentBytes({ bytes, profile: p, expectedSha256 }); bytes.fill(0); p.expectedAyahsPerSurah = [99];
    const result = await promise; expect(result.structuralStatus).toBe('passed'); expect(result.sourceText).toBe(source);
  });
  it('QI14 treats a mirror of the same dataset as non-independent', async () => {
    const a = await audit(), mirror = await audit(source, profile, { ...provenance, publisher: 'Synthetic mirror', url: 'https://example.invalid/mirror' });
    expect(compareIndependentSources(a, mirror)).toMatchObject({ status: 'blocked', blockers: ['REFERENCE_IS_NOT_INDEPENDENT'] });
  });
  it('QI15 compares exact per-ayah Unicode, without repairing a divergent reference', async () => {
    const origin = { publisher: 'Synthetic independent B', url: 'https://example.invalid/b', version: '1', lineageId: 'synthetic-b' };
    const a = await audit(), b = await audit(source, profile, origin);
    expect(compareIndependentSources(a, b)).toMatchObject({ status: 'passed', comparedAyahs: 3, differences: [], scientificApproval: 'not_granted' });
    const changed = await audit(source.replace('SYNTHETIC_B', 'SYNTHETIC_B\u0301'), profile, origin);
    expect(compareIndependentSources(a, changed)).toMatchObject({ status: 'failed', differences: [{ key: '1:2', reason: 'text-differs' }] });
  });
  it('QI16 blocks cross-edition, numbering or basmala-policy comparisons', async () => {
    const a = await audit(), origin = { ...provenance, publisher: 'Synthetic B', lineageId: 'synthetic-b' };
    for (const changed of [{ ...profile, editionId: 'other' }, { ...profile, numbering: 'other' }, { ...profile, basmalaPolicy: 'other' }])
      expect(compareIndependentSources(a, await audit(source, changed, origin)).blockers).toContain('EDITION_OR_NUMBERING_OR_BASMALA_MISMATCH');
  });
  it('QI17 blocks absent independent data; absence is not a successful comparison', async () => {
    const missing = await auditContentBytes({ bytes: null, profile: null, expectedSha256: null });
    expect(compareIndependentSources(await audit(), missing).status).toBe('blocked');
  });
  it('QI18 validates half-open ranges and rejects overlaps, bounds and edition mismatches', async () => {
    const a = await audit(), r = a.records[0];
    const range = { editionId: profile.editionId, surah: 1, ayah: 1, sourceStart: r.sourceStart, sourceEnd: r.sourceEnd };
    expect(validateContentRanges(a, [range]).status).toBe('passed');
    for (const ranges of [[], [range, range], [{ ...range, sourceEnd: r.sourceEnd + 1 }], [{ ...range, sourceStart: r.sourceEnd }], [{ ...range, editionId: 'other' }]])
      expect(validateContentRanges(a, ranges).status).toBe('failed');
  });
  it('QI19 rejects token boundaries splitting a Unicode supplementary character', async () => {
    const a = await audit(source.replace('SYNTHETIC_A', 'SYNTHETIC_\u{1F9EA}A')), r = a.records[0];
    const pos = a.sourceText!.indexOf('\u{1F9EA}');
    expect(validateContentRanges(a, [{ editionId: profile.editionId, surah: 1, ayah: 1, sourceStart: r.sourceStart, sourceEnd: pos + 1 }]).issues[0].code).toBe('SPLIT_SURROGATE_PAIR');
  });
  it('QI20 empty or comment-only files fail and no fake records are generated', async () => {
    expect(parseIndexedAyahSource('# SYNTHETIC-NON-QURAN').records).toEqual([]);
    expect((await audit('')).structuralStatus).toBe('failed');
  });
  it('QI21 rejects a boundary detaching a combining mark from its base', async () => {
    const a = await audit(source.replace('SYNTHETIC_A', 'SYNTHETIC_A\u0301')), r = a.records[0];
    expect(validateContentRanges(a, [{ editionId: profile.editionId, surah: 1, ayah: 1, sourceStart: r.sourceStart, sourceEnd: r.sourceEnd - 1 }]).issues[0].code).toBe('SPLIT_COMBINING_SEQUENCE');
  });
  it('QI22 compares canonically equivalent Unicode forms exactly, without normalizing the original', async () => {
    const origin = { ...provenance, publisher: 'Synthetic independent B', lineageId: 'synthetic-b' };
    const a = await audit(source.replace('SYNTHETIC_B', 'SYNTHETIC_e\u0301'));
    const b = await audit(source.replace('SYNTHETIC_B', 'SYNTHETIC_\u00e9'), profile, origin);
    expect(compareIndependentSources(a, b).status).toBe('failed');
  });
});
