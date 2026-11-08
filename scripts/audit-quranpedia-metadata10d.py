#!/usr/bin/env python3
"""Read-only structural audit of an uploaded Quranpedia /v1/mushafs/1 dump.

Never downloads, normalizes, extracts Quran text, or grants content approval.
"""
import argparse
from collections import Counter
import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import sys
import unicodedata

MAX_BYTES = 16 * 1024**2
MAX_DEPTH = 32
CHUNK = 64 * 1024
AYAH_KEYS = {"id", "number", "surah", "page_number", "text", "marker", "juz",
             "hizb", "ruku", "manzil", "options", "number_in_hafs"}
DATA_KEYS = {"id", "name", "description", "image", "bismillah", "font_file",
             "images", "images_png", "rawi", "surahs"}
FEATURES = {"asbab", "e3rab", "fatwa", "meanings", "nasekh", "notes", "qiraat",
            "sayings", "similar", "tafsir", "topics", "translations"}
RANGES = {"page_number": 604, "juz": 30, "hizb": 240, "ruku": 556, "manzil": 7}


class Rejected(ValueError):
    pass


def require(condition, code):
    if not condition:
        raise Rejected(code)


def fingerprint(value):
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)


def bounded_depth(text):
    # Bound parser recursion BEFORE json.loads; braces inside strings do not count.
    depth, quoted, escaped = 0, False, False
    for char in text:
        if quoted:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                quoted = False
        elif char == '"':
            quoted = True
        elif char in "[{":
            depth += 1
            require(depth <= MAX_DEPTH, "JSON_DEPTH_LIMIT")
        elif char in "]}":
            depth -= 1


def object_pairs(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "DUPLICATE_JSON_KEY")
        require(key.isascii(), "NON_ASCII_SCHEMA_KEY")
        result[key] = value
    return result


def reject_constant(_value):
    raise Rejected("NONFINITE_JSON_NUMBER")


def finite_float(value):
    number = float(value)
    require(math.isfinite(number), "NONFINITE_JSON_NUMBER")
    return number


def validate_unicode(value):
    if isinstance(value, str):
        require(not any(unicodedata.category(char) == "Cs" for char in value), "UNPAIRED_UNICODE_SURROGATE")
    elif isinstance(value, list):
        for child in value:
            validate_unicode(child)
    elif isinstance(value, dict):
        for child in value.values():
            validate_unicode(child)


def integer(value, expected=None):
    return type(value) is int and (expected is None or value == expected)


def exact_keys(value, keys, code):
    require(type(value) is dict and set(value) == keys, code)


def check_text(value):
    require(type(value) is str and bool(value.strip()), "EMPTY_OR_INVALID_TEXT")
    require(not any(unicodedata.category(char) in ("Cc", "Cf", "Cs") or char == "\ufffd"
                    for char in value), "TEXT_CONTROL_OR_INVALID_UNICODE")


def add_text(digest, value):
    # Exact decoded JSON string, without Unicode normalization or substitutions.
    raw = value.encode("utf-8", errors="strict")
    digest.update(len(raw).to_bytes(8, "big"))
    digest.update(raw)


def inspect_document(doc):
    exact_keys(doc, {"license", "schema", "data"}, "ROOT_SCHEMA_MISMATCH")
    require(doc["schema"] == "/v1/mushafs/1", "SCHEMA_VERSION_MISMATCH")
    license_info = doc["license"]
    require(type(license_info) is dict and license_info.get("source") == "https://quranpedia.net",
            "DECLARED_SOURCE_MISMATCH")
    version = license_info.get("version")
    require(type(version) is str and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", version), "INVALID_SOURCE_VERSION")
    try:
        datetime.date.fromisoformat(version)
    except ValueError as error:
        raise Rejected("INVALID_SOURCE_VERSION") from error
    data = doc["data"]
    exact_keys(data, DATA_KEYS, "MUSHAF_SCHEMA_MISMATCH")
    require(integer(data["id"], 1), "MUSHAF_ID_MISMATCH")
    require(type(data["rawi"]) is dict, "RAWI_METADATA_MISMATCH")
    for field in ("name", "description", "image", "images"):
        require(type(data[field]) is str and bool(data[field].strip()), "MUSHAF_METADATA_MISMATCH")
    for field in ("font_file", "images_png"):
        require(data[field] is None or type(data[field]) is str, "ASSET_METADATA_MISMATCH")
    surahs = data["surahs"]
    require(type(surahs) is list and len(surahs) == 114, "SURAH_COUNT_MISMATCH")
    digests = {field: hashlib.sha256() for field in ("text", "marker", "bismillah")}
    check_text(data["bismillah"])
    add_text(digests["bismillah"], data["bismillah"])
    total, surah_counts = 0, []
    values = {field: [] for field in RANGES}
    repeated, features = Counter(), Counter()
    for surah_number, surah in enumerate(surahs, 1):
        exact_keys(surah, {"id", "name", "coded_name", "ayahs"}, "SURAH_SCHEMA_MISMATCH")
        require(integer(surah["id"], surah_number), "SURAH_SEQUENCE_MISMATCH")
        require(all(type(surah[field]) is str and bool(surah[field].strip()) for field in ("name", "coded_name")), "SURAH_METADATA_MISMATCH")
        ayahs = surah["ayahs"]
        require(type(ayahs) is list and 1 <= len(ayahs) <= 286, "SURAH_AYAH_COUNT_INVALID")
        surah_counts.append(len(ayahs))
        for number, ayah in enumerate(ayahs, 1):
            total += 1
            require(total <= 6236, "AYAH_COUNT_MISMATCH")
            exact_keys(ayah, AYAH_KEYS, "AYAH_SCHEMA_MISMATCH")
            require(integer(ayah["id"], total), "GLOBAL_ID_SEQUENCE_MISMATCH")
            require(integer(ayah["number"], number), "AYAH_SEQUENCE_MISMATCH")
            require(type(ayah["surah"]) is str and ayah["surah"] == str(surah_number), "PARENT_SURAH_MISMATCH")
            hafs = ayah["number_in_hafs"]
            require(type(hafs) is list and len(hafs) == 1 and integer(hafs[0], number), "HAFS_REFERENCE_MISMATCH")
            for field, maximum in RANGES.items():
                value = ayah[field]
                require(integer(value) and 1 <= value <= maximum, "BOUNDARY_RANGE_MISMATCH")
                require(not values[field] or value >= values[field][-1], "BOUNDARY_ORDER_MISMATCH")
                values[field].append(value)
            for field in ("text", "marker"):
                check_text(ayah[field])
                add_text(digests[field], ayah[field])
            repeated[ayah["text"]] += 1
            options = ayah["options"]
            require(type(options) is list and all(type(value) is str and value in FEATURES for value in options), "OPTIONS_SCHEMA_MISMATCH")
            require(len(options) == len(set(options)), "DUPLICATE_FEATURE_LABEL")
            features.update(options)
    require(total == 6236, "AYAH_COUNT_MISMATCH")
    for field, maximum in RANGES.items():
        require(set(values[field]) == set(range(1, maximum + 1)), "BOUNDARY_COVERAGE_MISMATCH")
    return {
        "status": "structural-audit-passed-not-content-approved",
        "declaredSchema": "/v1/mushafs/1",
        "provenance": {"declaredSource": "https://quranpedia.net", "declaredVersion": version,
                       "publisherAuthenticated": False, "rightsVerified": False},
        "counts": {"surahs": 114, "ayahs": total, "pages": 604, "juz": 30,
                   "uploadedHizbValues": 240, "ruku": 556, "manzil": 7},
        "identityChecks": {"surahIdsSequential": True, "globalIdsSequential": True,
                           "ayahNumbersContiguousWithinSurah": True, "parentAssociationsExact": True,
                           "numberInHafsExact": True, "duplicateRecordIds": 0},
        "surahAyahCounts": surah_counts,
        "boundaryChecks": {"completeRanges": True, "monotonic": True,
                           "publisherBoundaryComparisonPerformed": False},
        "textInspection": {"textVariantsPerAyah": 1, "normalizationPerformed": False,
                           "ocrPerformed": False, "versionsMixed": False,
                           "rawTextIncludedInReceipt": False,
                           "digestEncoding": "SHA-256 over original-order decoded UTF-8 strings, each prefixed by an 8-byte big-endian byte length",
                           "exactFieldDigests": {field: digest.hexdigest() for field, digest in digests.items()},
                           "exactRepeatedTextGroups": sum(count > 1 for count in repeated.values()),
                           "recordsInRepeatedTextGroups": sum(count for count in repeated.values() if count > 1),
                           "repeatedTextMeansDuplicateRecord": False,
                           "optionsAreFeatureLabels": True, "featureCounts": dict(sorted(features.items()))},
        "assets": {"fontDeclared": bool(data["font_file"]), "pngPagesDeclared": bool(data["images_png"]),
                   "archivesDownloadedOrInspected": False},
        "integrationBlocked": True,
        "blockers": ["Third-party provenance is not authenticated official King Fahd publisher provenance.",
                     "Uploaded hizb range 1..240 has unverified semantics; runtime hizb expects 1..60, rub expects 1..240.",
                     "No word offsets, token-to-page mapping, or full verse page spans exist in this schema.",
                     "No approved font bytes, page assets, official text comparison or rights approval were supplied to this audit."],
        "contentVerification": "not-performed", "scientificApproval": False,
        "rightsApproval": False, "productionActivation": False,
    }


def inspect_input(path):
    require(not Path(path).is_symlink(), "INPUT_SYMLINK_REJECTED")
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    with os.fdopen(descriptor, "rb") as source:
        before = os.fstat(source.fileno())
        require(stat.S_ISREG(before.st_mode), "INPUT_MUST_BE_REGULAR_FILE")
        require(0 < before.st_size <= MAX_BYTES, "INPUT_SIZE_LIMIT")
        chunks, count, digest = [], 0, hashlib.sha256()
        while chunk := source.read(CHUNK):
            count += len(chunk)
            require(count <= before.st_size and count <= MAX_BYTES, "INPUT_CHANGED_DURING_INSPECTION")
            chunks.append(chunk)
            digest.update(chunk)
        raw = b"".join(chunks)
        text = raw.decode("utf-8", errors="strict")
        bounded_depth(text)
        doc = json.loads(text, object_pairs_hook=object_pairs, parse_constant=reject_constant, parse_float=finite_float)
        validate_unicode(doc)
        receipt = inspect_document(doc)
        require(count == before.st_size and fingerprint(before) == fingerprint(os.fstat(source.fileno()))
                and fingerprint(before) == fingerprint(os.stat(path, follow_symlinks=False)), "INPUT_CHANGED_DURING_INSPECTION")
    return {"schemaVersion": 1, "phase": "10-D", "checkedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "original": {"bytes": count, "sha256": digest.hexdigest(), "unchangedDuringInspection": True},
            "limits": {"inputBytes": MAX_BYTES, "jsonDepth": MAX_DEPTH}, **receipt}


def write_receipt(input_path, output_path):
    require(not output_path.exists() and not output_path.is_symlink(), "OUTPUT_MUST_NOT_EXIST")
    require(input_path.resolve() != output_path.resolve(), "OUTPUT_MUST_NOT_ALIAS_INPUT")
    receipt = inspect_input(input_path)
    descriptor = os.open(output_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as destination:
        json.dump(receipt, destination, ensure_ascii=False, indent=2)
        destination.write("\n")
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        receipt = write_receipt(args.input, args.output)
        print(json.dumps({"status": receipt["status"], "sha256": receipt["original"]["sha256"],
                          "counts": receipt["counts"], "integrationBlocked": True,
                          "scientificApproval": False, "productionActivation": False}))
        return 0
    except (Rejected, OSError, ValueError, RecursionError, OverflowError) as error:
        print(json.dumps({"status": "rejected", "reason": str(error) if isinstance(error, Rejected) else type(error).__name__,
                          "integrationBlocked": True, "scientificApproval": False,
                          "productionActivation": False}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
