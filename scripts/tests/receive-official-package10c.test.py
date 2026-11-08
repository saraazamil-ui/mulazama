#!/usr/bin/env python3
"""Intake regression tests use synthetic archives only; no Quran data or network."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile

SCRIPT = Path(__file__).resolve().parents[1] / "receive-official-package10c.py"
spec = importlib.util.spec_from_file_location("receive_official_package10c", SCRIPT)
intake = importlib.util.module_from_spec(spec)
with patch.object(sys, "dont_write_bytecode", True):
    spec.loader.exec_module(intake)
OFFICIAL = "https://qurancomplex.gov.sa/quran-dev/"
DOWNLOAD = "https://dm.qurancomplex.gov.sa/synthetic-fixture.zip"


class IntakeTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="mulazama-intake-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.addCleanup(self.unlock_owned_test_directories)
        self.vault = self.root / "vault"
        self.vault.mkdir()
        self.source = self.root / "publisher-original.zip"
        with zipfile.ZipFile(self.source, "w") as archive:
            archive.writestr("fixture.txt", b"Synthetic fixture, not Quran content.")
            archive.writestr("LICENSE.txt", b"Artificial test notice, not publisher rights.")
        self.original = self.source.read_bytes()
        self.digest = hashlib.sha256(self.original).hexdigest()

    def unlock_owned_test_directories(self):
        for directory, children, _ in os.walk(self.root, followlinks=False):
            os.chmod(directory, 0o700)
            for name in children:
                path = Path(directory) / name
                if not path.is_symlink():
                    path.chmod(0o700)

    def receive(self, **options):
        return intake.receive(self.source, self.vault, OFFICIAL, **options)

    def test_byte_identical_read_only_copy_keeps_source_untouched_and_approvals_false(self):
        before = self.source.stat()
        result = self.receive(published_sha256=self.digest.upper(), final_download_url=DOWNLOAD,
                              advertised_version="15.0 claimed by operator", downloaded_at="2026-11-08T12:30:00Z")
        directory = Path(result["receiptDirectory"])
        copy = directory / "original.archive"
        receipt = json.loads((directory / "receipt.json").read_text())
        self.assertEqual(copy.read_bytes(), self.original)
        self.assertEqual(self.source.read_bytes(), self.original)
        self.assertEqual(intake.inspector.fingerprint(self.source.stat()), intake.inspector.fingerprint(before))
        self.assertEqual(receipt["capturedSourceSha256"], self.digest)
        self.assertEqual(receipt["copiedArchiveSha256"], self.digest)
        self.assertEqual(receipt["originalFilename"], self.source.name)
        self.assertEqual(receipt["advertisedVersion"], {"value": "15.0 claimed by operator", "verified": False})
        self.assertEqual(receipt["downloadedAtProvidedByOperator"], "2026-11-08T12:30:00+00:00")
        self.assertEqual(receipt["sourceAuthenticity"], "not-verified")
        self.assertEqual(receipt["preflight"]["checksumComparison"], "matches-supplied-value")
        self.assertEqual(receipt["preflight"]["payloadIntegrity"], "not-performed")
        for key in ("rightsApproval", "scientificApproval", "mappingApproval", "quranActivation", "productionActivation", "networkUsed", "extracted"):
            self.assertIs(receipt[key], False)
        self.assertEqual({p.name for p in directory.iterdir()}, {"original.archive", "receipt.json"})
        for path in (copy, directory / "receipt.json", directory):
            self.assertEqual(stat.S_IMODE(path.stat().st_mode) & 0o222, 0)
        self.source.write_bytes(b"Later operator change")
        self.assertEqual(copy.read_bytes(), self.original)

    def test_duplicate_inputs_create_distinct_receipts_without_overwriting(self):
        first = self.receive()
        first_path = Path(first["receiptDirectory"])
        old = (first_path / "receipt.json").read_bytes()
        second = self.receive()
        self.assertNotEqual(first["receiptDirectory"], second["receiptDirectory"])
        self.assertEqual(first["sha256"], second["sha256"])
        self.assertEqual((first_path / "receipt.json").read_bytes(), old)
        self.assertEqual(len(list(self.vault.iterdir())), 2)

    def test_final_collision_is_rejected_atomically_without_overwriting_even_an_empty_directory(self):
        destination = self.vault / ("10c-" + "a" * 32)
        destination.mkdir()
        original_inode = destination.stat().st_ino
        with patch.object(intake.uuid, "uuid4", return_value=SimpleNamespace(hex="a" * 32)):
            with self.assertRaises(FileExistsError):
                self.receive()
        self.assertEqual(destination.stat().st_ino, original_inode)
        self.assertEqual(list(destination.iterdir()), [])
        self.assertEqual(list(self.vault.iterdir()), [destination])

    def test_preexisting_staging_is_not_deleted_or_overwritten(self):
        pending = self.vault / (".pending-10c-" + "b" * 32)
        pending.mkdir()
        marker = pending / "do-not-touch.txt"
        marker.write_text("Unrelated existing work")
        with patch.object(intake.uuid, "uuid4", return_value=SimpleNamespace(hex="b" * 32)):
            with self.assertRaises(FileExistsError):
                self.receive()
        self.assertEqual(marker.read_text(), "Unrelated existing work")

    def test_hash_mismatch_and_corrupt_archive_leave_no_staging_or_receipt(self):
        marker = self.vault / "unrelated.txt"
        marker.write_text("Keep")
        with self.assertRaisesRegex(intake.Rejected, "PUBLISHED_SHA256_MISMATCH"):
            self.receive(published_sha256="0" * 64)
        self.assertEqual(list(self.vault.iterdir()), [marker])
        self.source.write_bytes(b"not a valid archive")
        with self.assertRaises(intake.Rejected):
            self.receive()
        self.assertEqual(list(self.vault.iterdir()), [marker])
        self.assertEqual(self.source.read_bytes(), b"not a valid archive")

    def test_publication_failure_cleans_only_owned_staging(self):
        marker = self.vault / "keep"
        marker.mkdir()
        with patch.object(intake, "publish_directory", side_effect=OSError("simulated failure")):
            with self.assertRaises(OSError):
                self.receive()
        self.assertEqual(list(self.vault.iterdir()), [marker])
        self.assertEqual(self.source.read_bytes(), self.original)

    def test_fsync_failure_after_publication_never_deletes_the_published_copy(self):
        publish, sync = intake.publish_directory, intake.os.fsync
        published = False

        def record_publication(*args):
            nonlocal published
            publish(*args)
            published = True

        def fail_after_publication(descriptor):
            if published:
                raise OSError("simulated vault sync failure")
            sync(descriptor)

        with patch.object(intake, "publish_directory", side_effect=record_publication), patch.object(intake.os, "fsync", side_effect=fail_after_publication):
            with self.assertRaises(OSError):
                self.receive()
        directories = list(self.vault.iterdir())
        self.assertEqual(len(directories), 1)
        self.assertFalse(directories[0].name.startswith(".pending-"))
        self.assertEqual((directories[0] / "original.archive").read_bytes(), self.original)
        self.assertEqual(json.loads((directories[0] / "receipt.json").read_text())["status"], "received-quarantined")

    def test_staging_open_failure_removes_only_the_new_empty_staging_directory(self):
        real_open = intake.os.open

        def fail_staging(path, *args, **options):
            if str(path).startswith(".pending-"):
                raise OSError("simulated open failure")
            return real_open(path, *args, **options)

        with patch.object(intake.os, "open", side_effect=fail_staging):
            with self.assertRaises(OSError):
                self.receive()
        self.assertEqual(list(self.vault.iterdir()), [])

    def test_source_changed_during_preflight_is_rejected(self):
        inspect = intake.inspector.inspect_original

        def mutate_after_check(*args):
            result = inspect(*args)
            self.source.write_bytes(self.original + b"changed")
            return result

        with patch.object(intake.inspector, "inspect_original", side_effect=mutate_after_check):
            with self.assertRaisesRegex(intake.Rejected, "ORIGINAL_CHANGED_DURING_COPY"):
                self.receive()
        self.assertEqual(list(self.vault.iterdir()), [])

    def test_source_vault_and_parent_symlinks_are_never_followed(self):
        link = self.root / "source-link.zip"
        link.symlink_to(self.source)
        vault_link = self.root / "vault-link"
        vault_link.symlink_to(self.vault, target_is_directory=True)
        parent_link = self.root / "parent-link"
        parent_link.symlink_to(self.root, target_is_directory=True)
        for source, vault in ((link, self.vault), (self.source, vault_link),
                              (parent_link / self.source.name, self.vault), (self.source, parent_link / "vault")):
            with self.subTest(source=source, vault=vault), self.assertRaises(OSError):
                intake.receive(source, vault, OFFICIAL)
        self.assertEqual(list(self.vault.iterdir()), [])
        self.assertEqual(self.source.read_bytes(), self.original)

    def test_rejects_repository_inputs_outputs_and_double_slash_aliases_before_staging(self):
        repository = self.root / "repo"
        repository.mkdir()
        (repository / "public").mkdir()
        (repository / "dist").mkdir()
        with patch.object(intake, "ROOT", repository):
            for source, vault in ((repository / "public/file.zip", self.vault), (self.source, repository / "dist"),
                                  (self.source, Path("/" + str(repository / "public")))):
                with self.subTest(source=source, vault=vault), self.assertRaisesRegex(intake.Rejected, "OUTSIDE_REPOSITORY"):
                    intake.receive(source, vault, OFFICIAL)
        self.assertEqual(list(self.vault.iterdir()), [])

    def test_metadata_requires_exact_official_https_urls_and_valid_zoned_timestamp(self):
        for key in ("source_page", "final_download_url"):
            for url in ("http://qurancomplex.gov.sa/", "https://qurancomplex.gov.sa.example.org/", "https://user@qurancomplex.gov.sa/",
                        "https://fonts.qurancomplex.gov.sa/", "https://dm.qurancomplex.gov.sa/x#fragment"):
                args = {"source_page": OFFICIAL, key: url}
                with self.subTest(key=key, url=url), self.assertRaises(intake.Rejected):
                    intake.receive(self.source, self.vault, **args)
        for timestamp in ("2026-11-08", "2026-11-08T12:00:00", "2026-02-30T12:00:00Z", "yesterday"):
            with self.subTest(timestamp=timestamp), self.assertRaises(intake.Rejected):
                self.receive(downloaded_at=timestamp)
        for version in ("", "bad\nversion", "x" * 201):
            with self.subTest(version=version), self.assertRaises(intake.Rejected):
                self.receive(advertised_version=version)
        self.assertEqual(list(self.vault.iterdir()), [])

    def test_final_download_url_accepts_bounded_official_query_only_in_external_receipt(self):
        url = "https://dm.qurancomplex.gov.sa/?download=15&file=original%20archive.zip"
        output = io.StringIO()
        argv = [str(SCRIPT), str(self.source), "--vault", str(self.vault), "--source-page", OFFICIAL, "--final-download-url", url]
        with patch.object(sys, "argv", argv), contextlib.redirect_stdout(output):
            self.assertEqual(intake.main(), 0)
        self.assertNotIn(url, output.getvalue())
        receipt = json.loads((Path(json.loads(output.getvalue())["receiptDirectory"]) / "receipt.json").read_text())
        self.assertEqual(receipt["finalDownloadUrlProvidedByOperator"], url)
        with self.assertRaises(intake.Rejected):
            intake.receive(self.source, self.vault, url)
        for bad in ("https://qurancomplex.gov.sa/?download=%0a", "https://qurancomplex.gov.sa/?download=%7F",
                    "https://qurancomplex.gov.sa/?download=bad\nvalue", "https://qurancomplex.gov.sa/?download=1#",
                    "https://dm.qurancomplex.gov.sa/?x=" + "a" * 2048,
                    "https://dm.qurancomplex.gov.sa/" + "a" * 4096):
            with self.subTest(url=bad), self.assertRaises(intake.Rejected):
                self.receive(final_download_url=bad)
        self.assertEqual(len(list(self.vault.iterdir())), 1)

    def test_vault_is_required_existing_and_absolute_and_size_is_bounded(self):
        with self.assertRaises(FileNotFoundError):
            intake.receive(self.source, self.root / "missing-vault", OFFICIAL)
        with self.assertRaises(intake.Rejected):
            intake.receive(self.source, Path("relative-vault"), OFFICIAL)
        with patch.object(intake.inspector, "MAX_ARCHIVE_BYTES", 1), self.assertRaises(intake.Rejected):
            self.receive()
        with patch.object(sys, "argv", [str(SCRIPT), str(self.source), "--source-page", OFFICIAL]), contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaisesRegex(SystemExit, "2"):
                intake.main()
        self.assertEqual(list(self.vault.iterdir()), [])

    def test_cli_returns_real_receipt_path_and_structured_rejection(self):
        argv = [str(SCRIPT), str(self.source), "--vault", str(self.vault), "--source-page", OFFICIAL]
        output = io.StringIO()
        with patch.object(sys, "argv", argv), contextlib.redirect_stdout(output):
            self.assertEqual(intake.main(), 0)
        result = json.loads(output.getvalue())
        self.assertTrue((Path(result["receiptDirectory"]) / "receipt.json").is_file())
        error = io.StringIO()
        with patch.object(sys, "argv", argv + ["--published-sha256", "0" * 64]), contextlib.redirect_stderr(error):
            self.assertEqual(intake.main(), 2)
        self.assertEqual(json.loads(error.getvalue())["reason"], "PUBLISHED_SHA256_MISMATCH")
        self.assertEqual(len(list(self.vault.iterdir())), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
