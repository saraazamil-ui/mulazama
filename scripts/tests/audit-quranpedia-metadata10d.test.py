#!/usr/bin/env python3
"""All generated strings are artificial labels, never Quran text."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "audit-quranpedia-metadata10d.py"
spec = importlib.util.spec_from_file_location("metadata_audit10d", SCRIPT)
audit = importlib.util.module_from_spec(spec)
with patch.object(sys, "dont_write_bytecode", True):
    spec.loader.exec_module(audit)


def synthetic_document():
    surahs = [{"id": i + 1, "name": f"ARTIFICIAL SURAH {i + 1}", "coded_name": str(i + 1), "ayahs": []} for i in range(114)]
    for i in range(6236):
        surah = surahs[i * 114 // 6236]
        number = len(surah["ayahs"]) + 1
        surah["ayahs"].append({"id": i + 1, "number": number, "surah": str(surah["id"]),
                               "text": f"SYNTHETIC_NON_QURAN_TEXT_{i + 1}", "marker": f"ARTIFICIAL_MARKER_{number}",
                               "options": ["tafsir"], "number_in_hafs": [number],
                               **{field: i * maximum // 6236 + 1 for field, maximum in audit.RANGES.items()}})
    return {"license": {"source": "https://quranpedia.net", "version": "2026-11-08"}, "schema": "/v1/mushafs/1",
            "data": {"id": 1, "name": "ARTIFICIAL TEST", "description": "NOT QURAN OR PUBLISHER DATA",
                     "image": "https://example.invalid/artificial.png", "images": "https://example.invalid/artificial.zip",
                     "bismillah": "SYNTHETIC_NON_QURAN_STANDALONE", "font_file": None, "images_png": None,
                     "rawi": {}, "surahs": surahs}}


class MetadataAuditTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.document = synthetic_document()

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="mulazama-metadata10d-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.input = self.root / "synthetic.json"
        self.output = self.root / "receipt.json"

    def save(self, document=None):
        raw = json.dumps(document if document is not None else self.document, ensure_ascii=False).encode("utf-8")
        self.input.write_bytes(raw)
        return raw

    def rejected(self, expected, document):
        self.save(document)
        with self.assertRaisesRegex(audit.Rejected, "^" + expected + "$"):
            audit.write_receipt(self.input, self.output)
        self.assertFalse(self.output.exists())

    def test_complete_structure_does_not_approve_content_or_emit_text(self):
        raw = self.save()
        receipt = audit.write_receipt(self.input, self.output)
        self.assertEqual(receipt["original"]["sha256"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(receipt["counts"]["ayahs"], 6236)
        self.assertEqual(receipt["counts"]["pages"], 604)
        self.assertEqual(receipt["identityChecks"]["duplicateRecordIds"], 0)
        self.assertTrue(receipt["integrationBlocked"])
        for key in ("scientificApproval", "rightsApproval", "productionActivation"):
            self.assertFalse(receipt[key])
        self.assertNotIn("SYNTHETIC_NON_QURAN", self.output.read_text())
        self.assertEqual(self.input.read_bytes(), raw)

    def test_counts_and_schema_are_not_inferred_from_metadata(self):
        for change, reason in [
            (lambda d: d["data"]["surahs"].pop(), "SURAH_COUNT_MISMATCH"),
            (lambda d: d["data"]["surahs"][-1]["ayahs"].pop(), "AYAH_COUNT_MISMATCH"),
            (lambda d: d.update(schema="/v1/mushafs/2"), "SCHEMA_VERSION_MISMATCH"),
            (lambda d: d["data"]["surahs"][0]["ayahs"][0].update(text_variant="EXTRA"), "AYAH_SCHEMA_MISMATCH"),
        ]:
            with self.subTest(reason=reason):
                doc = copy.deepcopy(self.document); change(doc); self.rejected(reason, doc)

    def test_identity_gaps_duplicates_and_parent_confusables_rejected(self):
        for field, value, reason in [("id", 2, "GLOBAL_ID_SEQUENCE_MISMATCH"), ("number", 2, "AYAH_SEQUENCE_MISMATCH"),
                                     ("surah", "01", "PARENT_SURAH_MISMATCH"), ("surah", "１", "PARENT_SURAH_MISMATCH"),
                                     ("number_in_hafs", [True], "HAFS_REFERENCE_MISMATCH"), ("id", True, "GLOBAL_ID_SEQUENCE_MISMATCH")]:
            with self.subTest(field=field, value=value):
                doc = copy.deepcopy(self.document); doc["data"]["surahs"][0]["ayahs"][0][field] = value
                self.rejected(reason, doc)
        doc = copy.deepcopy(self.document); doc["data"]["surahs"][0]["ayahs"][1]["id"] = 1
        self.rejected("GLOBAL_ID_SEQUENCE_MISMATCH", doc)

    def test_range_and_boundary_order_are_checked(self):
        for field in audit.RANGES:
            with self.subTest(field=field):
                doc = copy.deepcopy(self.document); doc["data"]["surahs"][0]["ayahs"][0][field] = 0
                self.rejected("BOUNDARY_RANGE_MISMATCH", doc)
        doc = copy.deepcopy(self.document); doc["data"]["surahs"][0]["ayahs"][0]["page_number"] = 2
        self.rejected("BOUNDARY_ORDER_MISMATCH", doc)
        doc = copy.deepcopy(self.document)
        for surah in doc["data"]["surahs"]:
            for ayah in surah["ayahs"]:
                if ayah["page_number"] == 2: ayah["page_number"] = 1
        self.rejected("BOUNDARY_COVERAGE_MISMATCH", doc)

    def test_identical_text_at_distinct_ids_is_not_a_duplicate_record(self):
        doc = copy.deepcopy(self.document)
        doc["data"]["surahs"][0]["ayahs"][1]["text"] = doc["data"]["surahs"][0]["ayahs"][0]["text"]
        self.save(doc); result = audit.inspect_input(self.input)
        self.assertEqual(result["textInspection"]["exactRepeatedTextGroups"], 1)
        self.assertEqual(result["identityChecks"]["duplicateRecordIds"], 0)

    def test_exact_field_digests_do_not_normalize_equivalent_unicode(self):
        doc = copy.deepcopy(self.document)
        doc["data"]["surahs"][0]["ayahs"][0]["text"] = "SYNTHETIC_LATIN_é"
        self.save(doc); first = audit.inspect_input(self.input)
        doc["data"]["surahs"][0]["ayahs"][0]["text"] = "SYNTHETIC_LATIN_e\u0301"
        self.save(doc); second = audit.inspect_input(self.input)
        self.assertNotEqual(first["textInspection"]["exactFieldDigests"]["text"], second["textInspection"]["exactFieldDigests"]["text"])
        self.assertEqual(first["textInspection"]["exactFieldDigests"]["marker"], second["textInspection"]["exactFieldDigests"]["marker"])
        self.assertFalse(second["textInspection"]["normalizationPerformed"])

    def test_text_controls_empty_and_replacement_character_rejected(self):
        for text in ("", "  ", "SYNTHETIC\x00", "SYNTHETIC\u202e", "SYNTHETIC\ufffd"):
            with self.subTest(codepoint=repr(text)):
                doc = copy.deepcopy(self.document); doc["data"]["surahs"][0]["ayahs"][0]["text"] = text
                self.save(doc)
                with self.assertRaises(audit.Rejected): audit.inspect_input(self.input)

    def test_unpaired_surrogate_text_rejected_without_output(self):
        raw = json.dumps(self.document).replace("SYNTHETIC_NON_QURAN_TEXT_1\"", "\\ud800\"", 1)
        self.input.write_text(raw)
        with self.assertRaisesRegex(audit.Rejected, "UNPAIRED_UNICODE_SURROGATE"):
            audit.write_receipt(self.input, self.output)
        self.assertFalse(self.output.exists())

    def test_duplicate_json_keys_nonfinite_numbers_and_nonascii_keys_rejected(self):
        for raw, reason in [(b'{"data":{},"data":{}}', "DUPLICATE_JSON_KEY"),
                            (b'{"data":NaN}', "NONFINITE_JSON_NUMBER"),
                            (b'{"data":Infinity}', "NONFINITE_JSON_NUMBER"),
                            (b'{"data":1e400}', "NONFINITE_JSON_NUMBER"),
                            ('{"ｄata":{}}'.encode(), "NON_ASCII_SCHEMA_KEY")]:
            with self.subTest(reason=reason):
                self.input.write_bytes(raw)
                with self.assertRaisesRegex(audit.Rejected, reason): audit.inspect_input(self.input)

    def test_invalid_utf8_and_excessive_depth_rejected_before_parse(self):
        self.input.write_bytes(b'{"x":"\xff"}')
        with self.assertRaises(UnicodeDecodeError): audit.inspect_input(self.input)
        self.input.write_text("[" * (audit.MAX_DEPTH + 1) + "0" + "]" * (audit.MAX_DEPTH + 1))
        with self.assertRaisesRegex(audit.Rejected, "JSON_DEPTH_LIMIT"): audit.inspect_input(self.input)
        audit.bounded_depth(json.dumps({"synthetic": "[{\\\"" * 100}))

    def test_empty_and_oversized_file_rejected_without_payload_read(self):
        self.input.write_bytes(b"")
        with self.assertRaisesRegex(audit.Rejected, "INPUT_SIZE_LIMIT"): audit.inspect_input(self.input)
        with self.input.open("wb") as file: file.truncate(audit.MAX_BYTES + 1)
        with self.assertRaisesRegex(audit.Rejected, "INPUT_SIZE_LIMIT"): audit.inspect_input(self.input)

    def test_symlink_and_nonregular_input_rejected(self):
        target = self.root / "target.json"; target.write_bytes(b"{}")
        self.input.symlink_to(target)
        with self.assertRaisesRegex(audit.Rejected, "INPUT_SYMLINK_REJECTED"): audit.inspect_input(self.input)
        self.input.unlink(); os.mkfifo(self.input)
        with self.assertRaisesRegex(audit.Rejected, "INPUT_MUST_BE_REGULAR_FILE"): audit.inspect_input(self.input)

    def test_changed_input_detected_before_receipt_creation(self):
        self.save(); inspect = audit.inspect_document
        def changed(doc):
            result = inspect(doc)
            with self.input.open("ab") as source: source.write(b" ")
            return result
        with patch.object(audit, "inspect_document", side_effect=changed):
            with self.assertRaisesRegex(audit.Rejected, "INPUT_CHANGED_DURING_INSPECTION"):
                audit.write_receipt(self.input, self.output)
        self.assertFalse(self.output.exists())

    def test_output_cannot_overwrite_original_existing_receipt_or_alias(self):
        original = self.save()
        for kind in ("input", "existing", "hardlink", "symlink"):
            with self.subTest(kind=kind):
                output = self.root / (kind + ".json")
                if kind == "input": output = self.input
                elif kind == "existing": output.write_text("EXISTING")
                elif kind == "hardlink": os.link(self.input, output)
                else: output.symlink_to(self.input)
                with self.assertRaisesRegex(audit.Rejected, "OUTPUT_MUST_NOT_EXIST"):
                    audit.write_receipt(self.input, output)
                self.assertEqual(self.input.read_bytes(), original)
        self.assertEqual((self.root / "existing.json").read_text(), "EXISTING")

    def test_cli_reports_readonly_receipt_and_safe_failures(self):
        self.save()
        args = [sys.executable, str(SCRIPT), "--input", str(self.input), "--output", str(self.output)]
        result = subprocess.run(args, capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)["integrationBlocked"])
        again = subprocess.run(args, capture_output=True, text=True, check=False)
        self.assertEqual(again.returncode, 2)
        self.assertEqual(json.loads(again.stderr)["reason"], "OUTPUT_MUST_NOT_EXIST")
        self.assertNotIn("SYNTHETIC_NON_QURAN", result.stdout + result.stderr + again.stderr)


if __name__ == "__main__":
    unittest.main()
