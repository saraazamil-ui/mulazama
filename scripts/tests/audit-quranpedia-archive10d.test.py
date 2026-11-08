#!/usr/bin/env python3
"""Candidate ZIP checks use temporary synthetic SVG/JSON only; no Quran or download."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile
import zlib

SCRIPT = Path(__file__).resolve().parents[1] / 'audit-quranpedia-archive10d.py'
spec = importlib.util.spec_from_file_location('archive_auditor10d', SCRIPT)
audit = importlib.util.module_from_spec(spec)
with patch.object(sys, 'dont_write_bytecode', True):
    spec.loader.exec_module(audit)
SVG = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -20 200 300"><path d="M 0 0 L 1 1"/></svg>'
JSON = b'{"pages":[{"id":7,"coordinates":[1,2,3,4],"text":"SYNTHETIC_SECRET_NOT_FOR_RECEIPT"}]}'


class CandidateArchiveTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='mulazama-candidate-zip-test-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.path = self.root / 'candidate.zip'

    def make_zip(self, members=None, compression=zipfile.ZIP_DEFLATED):
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            with zipfile.ZipFile(self.path, 'w', compression=compression) as archive:
                for name, value in members or [('vector/unmapped.svg', SVG), ('metadata/unmapped.json', JSON), ('LICENSE.txt', b'Synthetic fixture notice only.')]:
                    archive.writestr(name, value)
        return self.path

    def test_valid_zip_binds_all_file_bytes_without_text_mapping_or_approval(self):
        path = self.make_zip()
        original = path.read_bytes()
        digest = hashlib.sha256(original).hexdigest()
        result = audit.inspect_archive(path, digest.upper())
        self.assertEqual(result['original']['sha256'], digest)
        self.assertEqual(path.read_bytes(), original)
        self.assertEqual(result['counts'], {'entries': 3, 'regularFiles': 3, 'directories': 0, 'svg': 1, 'json': 1, 'license-text': 1})
        self.assertTrue(result['allRegularMembersReadToEofWithCrc'])
        self.assertTrue(result['rawCompressedRangesAndActualSizesVerified'])
        self.assertEqual(result['files'][0]['sha256'], hashlib.sha256(SVG).hexdigest())
        self.assertEqual(result['files'][0]['summary']['viewBox'], [-10.0, -20.0, 200.0, 300.0])
        self.assertIn('coordinates', result['files'][1]['summary']['schemaKeys'])
        self.assertNotIn('SYNTHETIC_SECRET_NOT_FOR_RECEIPT', json.dumps(result))
        self.assertNotIn('sourceUrlProvidedByOperator', result)
        for key in ('officialPublisherVerified', 'rightsApproval', 'scientificApproval', 'mappingApproval',
                    'pageCountVerified', 'filenameToPageMappingInferred', 'quranActivation', 'productionActivation',
                    'networkUsed', 'extracted', 'rendered', 'originalRewritten', 'rawQuranIncluded'):
            self.assertIs(result[key], False)
        self.assertEqual(list(self.root.iterdir()), [path])

    def test_stored_files_and_directories_are_counted_without_inferred_page_numbers(self):
        path = self.make_zip([('folder/', b''), ('folder/999.svg', SVG), ('readme.md', b'# Synthetic fixture')], zipfile.ZIP_STORED)
        result = audit.inspect_archive(path)
        self.assertEqual(result['counts']['directories'], 1)
        self.assertEqual(result['counts']['svg'], 1)
        self.assertEqual(result['counts']['regularFiles'], 2)
        self.assertFalse(result['pageCountVerified'])

    def test_crc_mismatch_and_truncated_archive_fail_without_receipt(self):
        path = self.make_zip([('page.svg', SVG)], zipfile.ZIP_STORED)
        raw = bytearray(path.read_bytes())
        start = 30 + len('page.svg')
        raw[start + 5] ^= 1
        path.write_bytes(raw)
        with self.assertRaises(zipfile.BadZipFile):
            audit.inspect_archive(path)
        path.write_bytes(raw[:-10])
        with self.assertRaises(audit.Rejected):
            audit.inspect_archive(path)

    def test_understated_size_hidden_deflate_output_cannot_pass_zipfile_prefix_crc(self):
        path = self.make_zip([('page.svg', SVG + b'HIDDEN_UNDECLARED_BYTES')])
        raw = bytearray(path.read_bytes())
        central = raw.index(b'PK\x01\x02')
        crc = zlib.crc32(SVG)
        struct.pack_into('<L', raw, 14, crc)
        struct.pack_into('<L', raw, 22, len(SVG))
        struct.pack_into('<L', raw, central + 16, crc)
        struct.pack_into('<L', raw, central + 24, len(SVG))
        path.write_bytes(raw)
        # Demonstrate why the independent raw stream check is necessary.
        with zipfile.ZipFile(path) as archive:
            self.assertEqual(archive.read('page.svg'), SVG)
        with self.assertRaisesRegex(audit.Rejected, 'ZIP_ACTUAL_PAYLOAD_SIZE_MISMATCH'):
            audit.inspect_archive(path)

    def test_directory_compressed_ranges_cannot_hide_payload_behind_zero_size_and_crc(self):
        path = self.make_zip([('folder/', b'')])
        result = audit.inspect_archive(path)
        self.assertEqual(result['counts']['directories'], 1)
        path = self.make_zip([('folder/', b'HIDDEN_DIRECTORY_PAYLOAD')])
        raw = bytearray(path.read_bytes())
        central = raw.index(b'PK\x01\x02')
        for offset in (14, 22, central + 16, central + 24):
            struct.pack_into('<L', raw, offset, 0)
        path.write_bytes(raw)
        with zipfile.ZipFile(path) as archive:
            self.assertEqual(archive.read('folder/'), b'')
        with self.assertRaisesRegex(audit.Rejected, 'ZIP_ACTUAL_PAYLOAD_SIZE_MISMATCH'):
            audit.inspect_archive(path)

    def alter_compressed_tail(self, addition):
        path = self.make_zip([('page.svg', SVG)])
        raw = bytearray(path.read_bytes())
        central = raw.index(b'PK\x01\x02')
        old_size = struct.unpack_from('<L', raw, 18)[0]
        if addition:
            raw[central:central] = addition
            change = len(addition)
        else:
            del raw[central - 1]
            change = -1
        central += change
        struct.pack_into('<L', raw, 18, old_size + change)
        struct.pack_into('<L', raw, central + 20, old_size + change)
        end = raw.rfind(b'PK\x05\x06')
        struct.pack_into('<L', raw, end + 16, central)
        path.write_bytes(raw)
        return path

    def test_deflate_trailing_junk_and_missing_end_marker_are_rejected(self):
        path = self.alter_compressed_tail(b'JUNK')
        with zipfile.ZipFile(path) as archive:
            self.assertEqual(archive.read('page.svg'), SVG)
        with self.assertRaisesRegex(audit.Rejected, 'ZIP_DEFLATE_TRAILING_DATA'):
            audit.inspect_archive(path)
        path = self.alter_compressed_tail(b'')
        with zipfile.ZipFile(path) as archive:
            self.assertEqual(archive.read('page.svg'), SVG)
        with self.assertRaisesRegex(audit.Rejected, 'ZIP_DEFLATE_STREAM_NOT_FINISHED'):
            audit.inspect_archive(path)

    def test_path_traversal_duplicate_alias_and_symlink_members_fail_preflight(self):
        for members in ([('../page.svg', SVG)], [('A.svg', SVG), ('a.svg', SVG)]):
            with self.subTest(members=members), self.assertRaises(audit.Rejected):
                audit.inspect_archive(self.make_zip(members))
        link = zipfile.ZipInfo('page.svg')
        link.create_system = 3
        link.external_attr = 0o120777 << 16
        with self.assertRaisesRegex(audit.Rejected, 'ZIP_LINK_OR_SPECIAL_ENTRY'):
            audit.inspect_archive(self.make_zip([(link, b'outside.svg')]))

    def test_every_svg_passes_the_static_subset_validator_or_fails_closed(self):
        for unsafe in (b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script>bad()</script></svg>',
                       b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" onload="bad()"/>',
                       b'<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">&x;</svg>'):
            with self.subTest(payload=unsafe), self.assertRaises(audit.svg.Rejected):
                audit.inspect_archive(self.make_zip([('first.svg', SVG), ('second.svg', unsafe)]))

    def test_json_is_strict_utf8_depth_duplicates_unicode_and_finite_numbers_without_schema_guess(self):
        payloads = [b'{"a":1,"a":2}', b'{"x":NaN}', b'{"x":Infinity}', b'{"x":1e999}',
                    b'{"x":"\xff"}', b'{"x":"\\ud800"}', b'[' * 33 + b'0' + b']' * 33,
                    b'{"bad\\u0000key":1}']
        for data in payloads:
            with self.subTest(payload=data), self.assertRaises(ValueError):
                audit.inspect_archive(self.make_zip([('schema.json', data)]))
        result = audit.inspect_archive(self.make_zip([('unknown-schema.json', b'{"completely_unrelated":[1,true,null]}')]))
        self.assertEqual(result['files'][0]['summary']['schemaKeys'], {'completely_unrelated': 1})
        self.assertFalse(result['files'][0]['summary']['schemaSemanticsVerified'])

    def test_unknown_formats_license_controls_and_member_limits_fail_closed(self):
        for name, data in [('page.png', b'not-a-png'), ('README.html', b'<script>bad()</script>'), ('README.txt', b'null\x00byte')]:
            with self.subTest(name=name), self.assertRaises(audit.Rejected):
                audit.inspect_archive(self.make_zip([(name, data)]))
        with patch.object(audit.svg, 'MAX_BYTES', 1), self.assertRaisesRegex(audit.Rejected, 'MEMBER_SIZE_LIMIT'):
            audit.inspect_archive(self.make_zip([('page.svg', SVG)]))

    def test_reading_original_symlink_hash_mismatch_or_mutation_never_creates_success(self):
        path = self.make_zip()
        link = self.root / 'link.zip'
        link.symlink_to(path)
        with self.assertRaises(OSError):
            audit.inspect_archive(link)
        with self.assertRaisesRegex(audit.Rejected, 'EXPECTED_SHA256_MISMATCH'):
            audit.inspect_archive(path, '0' * 64)
        inspect_svg = audit.svg.inspect_svg

        def mutate_after_svg(data):
            result = inspect_svg(data)
            with path.open('ab') as out:
                out.write(b'changed')
            return result

        with patch.object(audit.svg, 'inspect_svg', side_effect=mutate_after_svg):
            with self.assertRaisesRegex(audit.Rejected, 'ORIGINAL_CHANGED_DURING_AUDIT'):
                audit.inspect_archive(path)

    def test_receipt_is_exclusive_and_cli_rejects_without_raw_payload_or_success_file(self):
        path = self.make_zip()
        original = path.read_bytes()
        output = self.root / 'receipt.json'
        result = audit.write_receipt(path, output)
        self.assertEqual(json.loads(output.read_text())['original'], result['original'])
        with self.assertRaises(audit.Rejected):
            audit.write_receipt(path, output)
        with self.assertRaises(audit.Rejected):
            audit.write_receipt(path, path)
        self.assertEqual(path.read_bytes(), original)
        failed = self.root / 'failed.json'
        error = io.StringIO()
        args = [str(SCRIPT), '--input', str(path), '--output', str(failed), '--expected-sha256', '0' * 64]
        with patch.object(sys, 'argv', args), contextlib.redirect_stderr(error):
            self.assertEqual(audit.main(), 2)
        self.assertEqual(json.loads(error.getvalue())['reason'], 'EXPECTED_SHA256_MISMATCH')
        self.assertFalse(failed.exists())
        self.assertNotIn('SYNTHETIC_SECRET_NOT_FOR_RECEIPT', error.getvalue())


if __name__ == '__main__':
    unittest.main(verbosity=2)
