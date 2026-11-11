import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { splitReferencePage, verifySliceIndex, buildReferenceMaps, auditV211, RAW_SHA256 } from '../content-v211-audit.mjs';

test('odd half-page splits choose the earlier boundary and never split a verse', () => {
  assert.deepEqual(splitReferencePage({ index: 4, startOrdinal: 10, endOrdinalExclusive: 15 }).ranges,
    [{ startOrdinal: 10, endOrdinalExclusive: 12 }, { startOrdinal: 12, endOrdinalExclusive: 15 }]);
  assert.deepEqual(splitReferencePage({ index: 4, startOrdinal: 10, endOrdinalExclusive: 14 }).ranges,
    [{ startOrdinal: 10, endOrdinalExclusive: 12 }, { startOrdinal: 12, endOrdinalExclusive: 14 }]);
});
test('single-verse faces have no halves; malformed intervals fail', () => {
  assert.equal(splitReferencePage({ index: 1, startOrdinal: 0, endOrdinalExclusive: 1 }).available, false);
  for (const end of [0, -1, 1.5, NaN]) assert.throws(() => splitReferencePage({ index: 1, startOrdinal: 0, endOrdinalExclusive: end }), /INVALID_REFERENCE_PAGE/);
});
test('source slices use UTF-16 and reject shifted, reordered, or altered records', () => {
  const source = '1|1|A😀B\n', record = { surah: 1, ayah: 1, sourceStart: 4, sourceEnd: 8, line: 1, text: 'A😀B' };
  const index = { schemaVersion: 1, sourceSha256: 'test', records: [record] };
  assert.equal(verifySliceIndex(source, [record], index, 'test').exact, true);
  assert.throws(() => verifySliceIndex(source, [record], { ...index, sourceSha256: 'other' }, 'test'), /SLICE_SOURCE_HASH/);
  assert.throws(() => verifySliceIndex(source, [record], { ...index, records: [{ ...record, sourceEnd: 7 }] }, 'test'), /SLICE_COORDINATE/);
  assert.throws(() => verifySliceIndex(source, [record], { ...index, records: [] }, 'test'), /SLICE_COUNT/);
  assert.throws(() => verifySliceIndex(source.replace('B', 'C'), [record], index, 'test'), /SLICE_TEXT/);
});
test('metadata rejects entity declarations and duplicate corpus keys', () => {
  const records = [{ surah: 1, ayah: 1 }];
  assert.throws(() => buildReferenceMaps('<!DOCTYPE quran [<!ENTITY x SYSTEM "file:///etc/passwd">]>', records), /XML_ENTITIES/);
  assert.throws(() => buildReferenceMaps('<quran/>', [...records, ...records]), /DUPLICATE_CORPUS_KEY/);
});
test('the real candidate covers every verse once in each map and remains blocked for display', async () => {
  const output = await auditV211(), maps = output['reference-maps.json'], manifest = output['candidate-manifest.json'];
  for (const name of ['referencePages', 'juz', 'quarterHizb']) {
    assert.equal(maps[name][0].startOrdinal, 0);
    assert.equal(maps[name].at(-1).endOrdinalExclusive, 6236);
    assert.equal(maps[name].reduce((total, range, index) => {
      if (index) assert.equal(maps[name][index - 1].endOrdinalExclusive, range.startOrdinal);
      return total + range.endOrdinalExclusive - range.startOrdinal;
    }, 0), 6236);
  }
  assert.equal(manifest.rawHash, RAW_SHA256);
  assert.equal(manifest.displayAllowed, false);
  assert.equal(manifest.productionReady, false);
  assert.equal(manifest.fontHash, null);
  assert.equal(manifest.reviewId, null);
  assert.equal(manifest.ownerApprovalId, null);
  assert.equal(manifest.approvals.specialist, 'pending');
  const metadata = await readFile(new URL('../../content/06l2/quran-data.xml', import.meta.url), 'utf8');
  const slices = JSON.parse(await readFile(new URL('../../content/06l2/source-slice-index.json', import.meta.url), 'utf8'));
  assert.throws(() => buildReferenceMaps(metadata.replace('<page index="2" sura="2" aya="1"', '<page index="2" sura="1" aya="1"'), slices.records), /REFERENCE_BOUNDARIES_NOT_INCREASING/);
  assert.throws(() => buildReferenceMaps(metadata.replace('<page index="2" sura="2" aya="1"', '<page index="2" sura="115" aya="1"'), slices.records), /REFERENCE_KEY_MISSING/);
  assert.throws(() => buildReferenceMaps(metadata.replace('<juz index="2"', '<juz index="3"'), slices.records), /REFERENCE_INDEX_ORDER/);
});
