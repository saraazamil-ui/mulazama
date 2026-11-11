/** V2.1.1 candidate preparation. Original Quran bytes are read, never rewritten.
 * This produces review-only metadata; no result is a display capability. */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const RAW_SHA256 = '6933e133dd56db778c801bf738848454e43648105a151e8d84d86a7cae39ec5f';
export const HALF_PAGE_POLICY = 'mulazama-half-page-by-ayah/1';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => JSON.stringify(value, null, 2) + '\n';
const requireValue = (condition, code) => { if (!condition) throw Error(code); };

/** Exact existing UTF-16 coordinates, including the line envelope: no search or normalization. */
export function verifySliceIndex(sourceText, records, index, rawHash) {
  requireValue(index?.schemaVersion === 1 && index.sourceSha256 === rawHash, 'SLICE_SOURCE_HASH_MISMATCH');
  requireValue(Array.isArray(index.records) && index.records.length === records.length, 'SLICE_COUNT_MISMATCH');
  for (let i = 0; i < records.length; i++) {
    const expected = records[i], actual = index.records[i];
    requireValue(actual && ['surah', 'ayah', 'sourceStart', 'sourceEnd', 'line'].every(key =>
      Number.isSafeInteger(actual[key]) && actual[key] === expected[key]), 'SLICE_COORDINATE_MISMATCH');
    requireValue(sourceText.slice(actual.sourceStart, actual.sourceEnd) === expected.text, 'SLICE_TEXT_MISMATCH');
  }
  return { count: records.length, exact: true, coordinateSystem: 'UTF-16', endExclusive: true };
}

function attributes(tag) {
  const result = Object.create(null);
  for (const [, name, value] of tag.matchAll(/([A-Za-z][A-Za-z0-9_-]*)="([^"]*)"/g)) {
    requireValue(!(name in result), 'DUPLICATE_XML_ATTRIBUTE');
    result[name] = value;
  }
  return result;
}
function positiveInteger(value) {
  requireValue(typeof value === 'string' && /^[1-9][0-9]*$/.test(value), 'INVALID_METADATA_INTEGER');
  const integer = Number(value);
  requireValue(Number.isSafeInteger(integer), 'INVALID_METADATA_INTEGER');
  return integer;
}
function sectionEntries(xml, section, tag) {
  requireValue(!/<!DOCTYPE|<!ENTITY/i.test(xml), 'XML_ENTITIES_NOT_ALLOWED');
  const matches = [...xml.matchAll(new RegExp(`<${section}\\b[^>]*>([\\s\\S]*?)<\\/${section}>`, 'g'))];
  requireValue(matches.length === 1, 'METADATA_SECTION_MISSING_OR_DUPLICATE');
  return [...matches[0][1].matchAll(new RegExp(`<${tag}\\s+([^>]*?)\\s*\\/>`, 'g'))].map(match => attributes(match[1]));
}

/** Only the pinned Tanzil metadata format is supported, not arbitrary external XML. */
export function buildReferenceMaps(xml, records) {
  requireValue(Array.isArray(records) && records.length > 0, 'EMPTY_CORPUS');
  const keys = new Map(records.map((record, ordinal) => [`${record.surah}:${record.ayah}`, ordinal]));
  requireValue(keys.size === records.length, 'DUPLICATE_CORPUS_KEY');
  const surahs = sectionEntries(xml, 'suras', 'sura');
  requireValue(surahs.length === 114, 'SURAH_COUNT_MISMATCH');
  let start = 0;
  surahs.forEach((surah, i) => {
    const count = positiveInteger(surah.ayas);
    requireValue(positiveInteger(surah.index) === i + 1 && String(start) === surah.start, 'SURAH_BOUNDARY_MISMATCH');
    for (let ayah = 1; ayah <= count; ayah++) requireValue(keys.get(`${i + 1}:${ayah}`) === start + ayah - 1, 'SURAH_RECORD_MISMATCH');
    start += count;
  });
  requireValue(start === records.length, 'CORPUS_TOTAL_MISMATCH');
  const map = (section, tag, count) => {
    const entries = sectionEntries(xml, section, tag);
    requireValue(entries.length === count, 'REFERENCE_MAP_COUNT_MISMATCH');
    const starts = entries.map((entry, index) => {
      requireValue(positiveInteger(entry.index) === index + 1, 'REFERENCE_INDEX_ORDER');
      const key = `${positiveInteger(entry.sura)}:${positiveInteger(entry.aya)}`;
      requireValue(keys.has(key), 'REFERENCE_KEY_MISSING');
      return { index: index + 1, startKey: key, startOrdinal: keys.get(key) };
    });
    requireValue(starts[0].startOrdinal === 0, 'REFERENCE_FIRST_BOUNDARY');
    return starts.map((entry, index) => {
      const endOrdinalExclusive = starts[index + 1]?.startOrdinal ?? records.length;
      requireValue(entry.startOrdinal < endOrdinalExclusive, 'REFERENCE_BOUNDARIES_NOT_INCREASING');
      return { ...entry, endOrdinalExclusive, endKeyExclusive: starts[index + 1]?.startKey ?? 'END_OF_CORPUS' };
    });
  };
  return { referencePages: map('pages', 'page', 604), juz: map('juzs', 'juz', 30), quarterHizb: map('hizbs', 'quarter', 240) };
}

/** At an odd count the earlier of the two equally near boundaries wins. */
export function splitReferencePage(page) {
  const { startOrdinal, endOrdinalExclusive } = page;
  requireValue(Number.isSafeInteger(startOrdinal) && Number.isSafeInteger(endOrdinalExclusive) && startOrdinal >= 0 && endOrdinalExclusive > startOrdinal, 'INVALID_REFERENCE_PAGE');
  const count = endOrdinalExclusive - startOrdinal;
  if (count === 1) return { page: page.index, available: false, reason: 'SINGLE_AYAH_PAGE', ranges: [] };
  const middle = startOrdinal + Math.floor(count / 2);
  return { page: page.index, available: true, ranges: [{ startOrdinal, endOrdinalExclusive: middle }, { startOrdinal: middle, endOrdinalExclusive }] };
}

export async function auditV211(root = process.cwd()) {
  const sourceDir = 'content/06l2/';
  const paths = {
    raw: sourceDir + 'tanzil-uthmani-1.1.txt', slices: sourceDir + 'source-slice-index.json',
    metadata: sourceDir + 'quran-data.xml', textLicense: sourceDir + 'tanzil-license.html',
    profile: sourceDir + 'numbering-profile.json', receipt: sourceDir + 'download-receipt.json',
  };
  const files = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([key, path]) => [key, await readFile(resolve(root, path))])));
  const profile = JSON.parse(files.profile), receipt = JSON.parse(files.receipt), index = JSON.parse(files.slices);
  requireValue(sha(files.raw) === RAW_SHA256 && receipt.sha256 === RAW_SHA256 && files.raw.length === receipt.byteLength, 'PINNED_RAW_BYTES_MISMATCH');
  requireValue(sha(files.metadata) === profile.provenance.documentSha256, 'PINNED_METADATA_BYTES_MISMATCH');
  requireValue(sha(files.textLicense) === receipt.rightsSHA256, 'PINNED_LICENSE_BYTES_MISMATCH');
  const { loadContentAudit } = await import('./content-audit-loader.mjs');
  const { auditContentBytes, decodeSourceUtf8 } = await loadContentAudit();
  const result = await auditContentBytes({ bytes: files.raw, profile, expectedSha256: RAW_SHA256,
    provenance: { publisher: receipt.publisher, url: receipt.sourceUrl, version: receipt.version, lineageId: 'tanzil-uthmani' } });
  requireValue(result.structuralStatus === 'passed' && result.records.length === 6236 && result.counts.surahs === 114, 'CORPUS_STRUCTURAL_CHECK_FAILED');
  const slices = verifySliceIndex(result.sourceText, result.records, index, RAW_SHA256);
  const maps = buildReferenceMaps(decodeSourceUtf8(files.metadata), result.records);
  const indexVersion = 'tanzil-metadata-1.0-reference-ordinal/1';
  const referenceMaps = { schemaVersion: 1, indexVersion, rawHash: RAW_SHA256, metadataHash: sha(files.metadata),
    ordinalUnit: 'ayah', endExclusive: true, sentinel: 6236, displayApproved: false, ...maps };
  const halfPageMap = { schemaVersion: 1, policyVersion: HALF_PAGE_POLICY, indexVersion, label: 'نصف وجه تقريبي بالآيات',
    method: 'Nearest verse boundary to half the verse count; ties choose the earlier boundary; a one-verse page has no halves.',
    rawHash: RAW_SHA256, metadataHash: sha(files.metadata), displayApproved: false, pages: maps.referencePages.map(splitReferencePage) };
  const referenceHash = sha(jsonBytes(referenceMaps)), halfHash = sha(jsonBytes(halfPageMap));
  const inputs = { rawHash: RAW_SHA256, sliceIndexHash: sha(files.slices), metadataHash: sha(files.metadata),
    numberingProfileHash: sha(files.profile), textLicenseHash: sha(files.textLicense), referencePageMapHash: referenceHash, halfPageMapHash: halfHash };
  const bundleId = 'tanzil-uthmani-1.1-candidate-' + sha(JSON.stringify(inputs)).slice(0, 24);
  const manifest = { schemaVersion: 2, kind: 'mulazama-content-candidate', bundleId, state: 'structurally-verified',
    publisher: 'Tanzil Project', sourceVersion: '1.1', sourceUrl: receipt.sourceUrl, script: 'Uthmani (publisher label)',
    riwaya: null, riwayaEvidence: null, numberingProfile: { path: paths.profile, sha256: inputs.numberingProfileHash },
    basmalaPolicy: { mode: 'preserve-source-records-verbatim', scientificConventionApproved: false },
    ...inputs, fontHash: null, font: { status: 'pending-selection-and-review', systemFontsDoNotIdentifyAnApprovedQuranFont: true },
    raw: { path: paths.raw, byteLength: files.raw.length }, sourceSlices: { path: paths.slices, coordinateSystem: 'UTF-16', endExclusive: true },
    metadata: { path: paths.metadata, sourceVersion: '1.0', sourceUrl: profile.provenance.url },
    licenseSnapshots: [{ scope: 'quran-text-only', path: paths.textLicense, sha256: inputs.textLicenseHash, sourceUrl: receipt.rightsSource,
      status: 'acquired-not-rights-approved' }],
    metadataRights: { publisherHeader: 'cc-by', exactLicenseVersion: null, status: 'pending' },
    attribution: { label: 'مصدر النص القرآني: مشروع Tanzil', url: 'https://tanzil.net/', preserveFullPublisherNotice: true },
    referencePageMap: { path: 'content/v211/reference-maps.json', sha256: referenceHash, version: indexVersion,
      interpretation: 'Reference intervals from each XML page start to the next; not visual Medina page equivalence.' },
    halfPageMap: { path: 'content/v211/half-page-map.json', sha256: halfHash, policyVersion: HALF_PAGE_POLICY },
    reviewId: null, ownerApprovalId: null, displayAllowed: false, productionReady: false,
    approvals: { rights: 'pending', independentComparison: 'blocked', specialist: 'pending', owner: 'pending' },
    blockers: ['RIWAYA_AND_BASMALA_REVIEW', 'EXACT_METADATA_LICENSE_VERSION', 'INDEPENDENT_COMPATIBLE_COMPARISON',
      'QURAN_FONT_SELECTION_AND_DEVICE_REVIEW', 'SPECIALIST_SIGNOFF_FOR_THIS_BUNDLE', 'OWNER_SIGNOFF_FOR_THIS_BUNDLE'],
  };
  const verification = { schemaVersion: 1, auditVersion: 'mulazama-content-v2.1.1/1', bundleId,
    structuralStatus: 'passed', sourceRewritten: false, normalized: false, rawBytes: files.raw.length, ...inputs,
    surahs: result.counts.surahs, ayahs: result.records.length, issues: result.issues, sourceSlices: slices,
    referencePages: maps.referencePages.length, juz: maps.juz.length, quarterHizb: maps.quarterHizb.length,
    halfPagesAvailable: halfPageMap.pages.filter(page => page.available).length, completeContiguousCoverage: true,
    independentComparison: { status: 'blocked', reason: 'No certified compatible independent edition is available. Tanzil metadata is not an independent textual witness.' },
    visualAndSpecialistReview: 'pending', displayAllowed: false, productionReady: false };
  return { 'candidate-manifest.json': manifest, 'reference-maps.json': referenceMaps, 'half-page-map.json': halfPageMap, 'verification.json': verification };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const results = await auditV211(), check = process.argv.includes('--check'), directory = resolve('content/v211');
  if (!check) await mkdir(directory, { recursive: true });
  for (const [name, value] of Object.entries(results)) {
    const expected = jsonBytes(value), path = resolve(directory, name);
    if (check) requireValue(await readFile(path, 'utf8') === expected, 'STALE_CANDIDATE_ARTIFACT:' + name);
    else await writeFile(path, expected);
  }
  console.log(JSON.stringify({ mode: check ? 'checked' : 'prepared', ...results['verification.json'] }, null, 2));
}
