#!/usr/bin/env python3
"""Preflight tests use small artificial archives; no Quran content is supplied."""
import contextlib
import hashlib
import gzip
import importlib.util
import io
import json
from pathlib import Path
import stat
import struct
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile


SCRIPT = Path(__file__).resolve().parents[1] / "inspect-official-archive10b.py"
spec = importlib.util.spec_from_file_location("inspect_official_archive10b", SCRIPT)
inspector = importlib.util.module_from_spec(spec)
with patch.object(sys, "dont_write_bytecode", True):
    spec.loader.exec_module(inspector)
OFFICIAL = "https://qurancomplex.gov.sa/quran-dev/"
ARTIFICIAL = b"Synthetic archive fixture, not Quran content."


class ArchivePreflightTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix="mulazama-archive-test-")
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)

    def zip(self, entries=None, compression=zipfile.ZIP_STORED):
        path = self.root / "original.zip"
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            with zipfile.ZipFile(path, "w", compression=compression) as archive:
                for name, data in entries or [("pages/fixture.txt", ARTIFICIAL), ("LICENSE.txt", b"Fixture notice only")]:
                    archive.writestr(name, data)
        return path

    def tar(self, kind=tarfile.REGTYPE, name="fixture.txt", compressed=False):
        path = self.root / ("original.tar.gz" if compressed else "original.tar")
        with tarfile.open(path, "w:gz" if compressed else "w", format=tarfile.USTAR_FORMAT) as archive:
            member = tarfile.TarInfo(name)
            member.type = kind
            member.size = len(ARTIFICIAL) if kind == tarfile.REGTYPE else 0
            if kind in (tarfile.SYMTYPE, tarfile.LNKTYPE):
                member.linkname = "outside.txt"
            archive.addfile(member, io.BytesIO(ARTIFICIAL) if member.size else None)
        return path

    def inspect(self, path, checksum=None):
        return inspector.inspect_original(path, OFFICIAL, checksum)

    def test_valid_zip_retains_original_and_never_approves_content_or_rights(self):
        path = self.zip()
        original = path.read_bytes()
        digest = hashlib.sha256(original).hexdigest()
        receipt = self.inspect(path, digest.upper())
        self.assertEqual(receipt["sha256"], digest)
        self.assertEqual(receipt["checksumComparison"], "matches-supplied-value")
        self.assertEqual(receipt["entryCount"], 2)
        self.assertEqual(receipt["rightsReadmeCandidateFiles"], ["LICENSE.txt"])
        for key in ("scientificApproval", "rightsApproval", "productionActivation", "extracted", "originalCopied"):
            self.assertIs(receipt[key], False)
        self.assertEqual(receipt["contentVerification"], "not-performed")
        self.assertEqual(receipt["payloadIntegrity"], "not-performed")
        self.assertEqual(receipt["sourceAuthenticity"], "not-verified")
        self.assertNotIn(str(self.root), json.dumps(receipt))
        self.assertEqual(path.read_bytes(), original)
        self.assertEqual(list(self.root.iterdir()), [path])

    def test_valid_tar_and_gzip_tar_inventory_without_extraction(self):
        for compressed in (False, True):
            with self.subTest(compressed=compressed):
                path = self.tar(compressed=compressed)
                receipt = self.inspect(path)
                self.assertEqual(receipt["archiveFormat"], "tar.gz" if compressed else "tar")
                self.assertEqual(receipt["inventory"][0]["declaredBytes"], len(ARTIFICIAL))
                self.assertFalse((self.root / "fixture.txt").exists())

    def test_supplied_checksum_mismatch_is_rejected(self):
        with self.assertRaisesRegex(inspector.Rejected, "PUBLISHED_SHA256_MISMATCH"):
            self.inspect(self.zip(), "0" * 64)

    def test_source_url_requires_exact_official_https_host(self):
        urls = ["http://qurancomplex.gov.sa/", "https://qurancomplex.gov.sa.example.com/",
                "https://evilqurancomplex.gov.sa/", "https://user:secret@qurancomplex.gov.sa/",
                "https://qurancomplex.gov.sa:444/", " https://qurancomplex.gov.sa/",
                "https://qurancomplex.gov.sa/?token=secret", "https://qurancomplex.gov.sa/%0a"]
        for url in urls:
            with self.subTest(url=url), self.assertRaises(inspector.Rejected):
                inspector.source_url(url)
        self.assertEqual(inspector.source_url("https://dm.qurancomplex.gov.sa/"), "https://dm.qurancomplex.gov.sa/")

    def test_unsafe_zip_paths_are_rejected(self):
        for name in ("../outside", "/absolute", "C:/drive", "a\\backslash", "a//empty", "a/./dot", "a/trailing.", "a/new\nline"):
            with self.subTest(name=name), self.assertRaises(inspector.Rejected):
                self.inspect(self.zip([(name, ARTIFICIAL)]))

    def test_duplicate_and_alias_names_are_rejected(self):
        for names in (("a.txt", "a.txt"), ("A.txt", "a.txt"), ("caf\u00e9.txt", "cafe\u0301.txt")):
            with self.subTest(names=names), self.assertRaisesRegex(inspector.Rejected, "DUPLICATE_ENTRY_NAME"):
                self.inspect(self.zip([(name, ARTIFICIAL) for name in names]))

    def test_file_directory_prefix_collisions_are_rejected_in_either_order(self):
        for names in (("folder", "folder/file"), ("folder/file", "folder")):
            with self.subTest(names=names), self.assertRaisesRegex(inspector.Rejected, "FILE_DIRECTORY_COLLISION"):
                self.inspect(self.zip([(name, ARTIFICIAL) for name in names]))

    def test_zip_symlinks_and_devices_are_rejected(self):
        for mode in (stat.S_IFLNK, stat.S_IFCHR, stat.S_IFIFO):
            member = zipfile.ZipInfo("hostile")
            member.create_system = 3
            member.external_attr = (mode | 0o644) << 16
            with self.subTest(mode=mode), self.assertRaisesRegex(inspector.Rejected, "ZIP_LINK_OR_SPECIAL_ENTRY"):
                self.inspect(self.zip([(member, ARTIFICIAL)]))

    def test_encrypted_zip_flag_is_rejected(self):
        path = self.zip()
        data = bytearray(path.read_bytes())
        central = data.index(b"PK\x01\x02")
        struct.pack_into("<H", data, 6, struct.unpack_from("<H", data, 6)[0] | 1)
        struct.pack_into("<H", data, central + 8, struct.unpack_from("<H", data, central + 8)[0] | 1)
        path.write_bytes(data)
        with self.assertRaisesRegex(inspector.Rejected, "ENCRYPTED_ZIP_UNSUPPORTED"):
            self.inspect(path)

    def test_compression_bomb_is_rejected_without_payload_decompression(self):
        path = self.zip([("bomb.bin", b"A" * (2 * 1024**2))], zipfile.ZIP_DEFLATED)
        with self.assertRaisesRegex(inspector.Rejected, "COMPRESSION_RATIO_LIMIT"):
            self.inspect(path)

    def test_local_only_zip_encryption_flag_is_rejected(self):
        path = self.zip()
        data = bytearray(path.read_bytes())
        struct.pack_into("<H", data, 6, struct.unpack_from("<H", data, 6)[0] | 1)
        path.write_bytes(data)
        with self.assertRaisesRegex(inspector.Rejected, "ENCRYPTED_ZIP_UNSUPPORTED"):
            self.inspect(path)

    def test_zip_patched_data_flag_is_rejected_with_structured_cli_error(self):
        path = self.zip()
        data = bytearray(path.read_bytes())
        central = data.index(b"PK\x01\x02")
        struct.pack_into("<H", data, 6, struct.unpack_from("<H", data, 6)[0] | 32)
        struct.pack_into("<H", data, central + 8, struct.unpack_from("<H", data, central + 8)[0] | 32)
        path.write_bytes(data)
        output = self.root / "receipt.json"
        args = [str(SCRIPT), str(path), "--source-url", OFFICIAL, "--output", str(output)]
        error = io.StringIO()
        with patch.object(sys, "argv", args), contextlib.redirect_stderr(error):
            self.assertEqual(inspector.main(), 2)
        self.assertEqual(json.loads(error.getvalue())["reason"], "ZIP_PATCHED_DATA_UNSUPPORTED")
        self.assertFalse(output.exists())

    def test_original_mutation_during_inspection_is_rejected(self):
        path = self.zip()
        real_inspect = inspector.inspect_zip

        def mutate_after_inventory(*args):
            result = real_inspect(*args)
            with path.open("ab") as output:
                output.write(b"modified")
            return result

        with patch.object(inspector, "inspect_zip", side_effect=mutate_after_inventory):
            with self.assertRaisesRegex(inspector.Rejected, "ORIGINAL_CHANGED_DURING_INSPECTION"):
                self.inspect(path)

    def test_gzip_tar_expansion_is_bounded(self):
        raw = io.BytesIO()
        with tarfile.open(fileobj=raw, mode="w", format=tarfile.USTAR_FORMAT) as archive:
            member = tarfile.TarInfo("bomb.bin")
            member.size = 2 * 1024**2
            archive.addfile(member, io.BytesIO(b"A" * member.size))
        path = self.root / "bomb.tar.gz"
        path.write_bytes(gzip.compress(raw.getvalue()))
        with self.assertRaisesRegex(inspector.Rejected, "COMPRESSION_RATIO_LIMIT"):
            self.inspect(path)

    def test_expanded_size_and_count_limits_are_enforced(self):
        path = self.zip()
        with patch.object(inspector, "MAX_EXPANDED_BYTES", 10), self.assertRaisesRegex(inspector.Rejected, "EXPANDED_SIZE_LIMIT"):
            self.inspect(path)
        with patch.object(inspector, "MAX_ENTRIES", 1), self.assertRaisesRegex(inspector.Rejected, "ENTRY_COUNT_LIMIT"):
            self.inspect(path)

    def test_central_directory_limit_precedes_zipfile_parser(self):
        path = self.zip()
        with patch.object(inspector, "MAX_CENTRAL_DIRECTORY_BYTES", 1), patch.object(inspector.zipfile, "ZipFile") as parser:
            with self.assertRaisesRegex(inspector.Rejected, "ZIP_CENTRAL_DIRECTORY_LIMIT"):
                self.inspect(path)
            parser.assert_not_called()

    def test_zip64_locator_without_eocd_sentinels_is_rejected_before_parser(self):
        path = self.zip()
        data = bytearray(path.read_bytes())
        end = data.rfind(b"PK\x05\x06")
        ordinary = bytearray(data[end:])
        central_size = struct.unpack_from("<L", ordinary, 12)[0]
        struct.pack_into("<L", ordinary, 12, central_size + 20)
        locator = struct.pack("<4sLQL", b"PK\x06\x07", 0, 0, 1)
        path.write_bytes(data[:end] + locator + ordinary)
        with patch.object(inspector.zipfile, "ZipFile") as parser:
            with self.assertRaisesRegex(inspector.Rejected, "ZIP64_OR_MULTIDISK_UNSUPPORTED"):
                self.inspect(path)
            parser.assert_not_called()

    def test_tar_links_devices_and_extension_metadata_are_rejected(self):
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.CHRTYPE, tarfile.FIFOTYPE, tarfile.XHDTYPE, tarfile.GNUTYPE_SPARSE):
            with self.subTest(kind=kind), self.assertRaisesRegex(inspector.Rejected, "TAR_LINK_SPECIAL_OR_EXTENSION_UNSUPPORTED"):
                self.inspect(self.tar(kind=kind))

    def test_tar_traversal_and_truncation_are_rejected(self):
        with self.assertRaises(inspector.Rejected):
            self.inspect(self.tar(name="../outside"))
        path = self.tar()
        path.write_bytes(path.read_bytes()[:530])
        with self.assertRaisesRegex(inspector.Rejected, "TRUNCATED_TAR_ENTRY"):
            self.inspect(path)

    def test_original_symlink_is_not_followed(self):
        path = self.zip()
        link = self.root / "link.zip"
        link.symlink_to(path)
        with self.assertRaises(OSError):
            self.inspect(link)

    def test_cli_receipt_is_exclusive_and_original_cannot_be_overwritten(self):
        path = self.zip()
        before = path.read_bytes()
        args = [str(SCRIPT), str(path), "--source-url", OFFICIAL, "--output", str(path)]
        with patch.object(sys, "argv", args), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(inspector.main(), 2)
        self.assertEqual(path.read_bytes(), before)
        output = self.root / "receipt.json"
        args[-1] = str(output)
        with patch.object(sys, "argv", args), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(inspector.main(), 0)
        self.assertEqual(json.loads(output.read_text())["originalBasename"], "original.zip")
        with patch.object(sys, "argv", args), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(inspector.main(), 2)

    def test_rejected_cli_leaves_no_success_receipt(self):
        path = self.zip()
        output = self.root / "receipt.json"
        args = [str(SCRIPT), str(path), "--source-url", OFFICIAL, "--published-sha256", "0" * 64, "--output", str(output)]
        error = io.StringIO()
        with patch.object(sys, "argv", args), contextlib.redirect_stderr(error):
            self.assertEqual(inspector.main(), 2)
        self.assertEqual(json.loads(error.getvalue())["status"], "rejected")
        self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
