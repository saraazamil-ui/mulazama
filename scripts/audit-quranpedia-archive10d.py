#!/usr/bin/env python3
"""Audit an original candidate ZIP without extracting, rendering, mapping, or approving Quran content."""
import argparse
from collections import Counter
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import struct
import sys
import zipfile
import zlib

ROOT = Path(__file__).resolve().parent


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    result = importlib.util.module_from_spec(spec)
    previous = sys.dont_write_bytecode
    try:
        sys.dont_write_bytecode = True
        spec.loader.exec_module(result)
    finally:
        sys.dont_write_bytecode = previous
    return result


preflight = module('archive_preflight10d', 'inspect-official-archive10b.py')
metadata = module('json_primitives10d', 'audit-quranpedia-metadata10d.py')
svg = module('svg_security10d', 'svg-security10d.py')
Rejected = preflight.Rejected
MAX_TEXT_BYTES, MAX_JSON_NODES, MAX_SCHEMA_KEYS = 256 * 1024, 250000, 1024


def require(condition, reason):
    if not condition:
        raise Rejected(reason)


def json_summary(data):
    text = data.decode('utf-8', errors='strict')
    metadata.bounded_depth(text)
    document = json.loads(text, object_pairs_hook=metadata.object_pairs,
                          parse_constant=metadata.reject_constant, parse_float=metadata.finite_float)
    metadata.validate_unicode(document)
    keys, types, pending = Counter(), Counter(), [document]
    while pending:
        value = pending.pop()
        types[type(value).__name__] += 1
        require(sum(types.values()) <= MAX_JSON_NODES, 'JSON_NODE_LIMIT')
        if isinstance(value, dict):
            for key in value:
                require(0 < len(key) <= 128 and all(32 <= ord(char) < 127 for char in key), 'JSON_SCHEMA_KEY_LIMIT_OR_CONTROL')
                keys[key] += 1
            require(len(keys) <= MAX_SCHEMA_KEYS, 'JSON_SCHEMA_KEY_LIMIT')
            pending.extend(value.values())
        elif isinstance(value, list):
            pending.extend(value)
    return {'rootType': type(document).__name__, 'nodeTypes': dict(sorted(types.items())),
            'schemaKeys': dict(sorted(keys.items())), 'schemaSemanticsVerified': False,
            'rawValuesIncluded': False, 'normalizationPerformed': False}


def classification(name):
    basename = Path(name).name.casefold()
    if basename.endswith('.svg'):
        return 'svg', svg.MAX_BYTES
    if basename.endswith('.json'):
        return 'json', metadata.MAX_BYTES
    if re.fullmatch(r'(?:readme|licen[cs]e|copyright|notice|rights)(?:\.(?:txt|md))?', basename):
        return 'license-text', MAX_TEXT_BYTES
    raise Rejected('UNSUPPORTED_ARCHIVE_MEMBER_FORMAT')


def verify_raw_payload(original, member, maximum, expected_digest):
    # ZipExtFile can truncate output to a forged declared size before its CRC
    # check. Independently consume the entire bounded compressed range as well.
    original.seek(member.header_offset)
    header = original.read(30)
    require(len(header) == 30 and header[:4] == b'PK\x03\x04', 'ZIP_LOCAL_HEADER_CHANGED')
    name_bytes, extra_bytes = struct.unpack_from('<HH', header, 26)
    original.seek(member.header_offset + 30 + name_bytes + extra_bytes)
    decoder = zlib.decompressobj(-15) if member.compress_type == zipfile.ZIP_DEFLATED else None
    remaining, actual, crc, digest = member.compress_size, 0, 0, hashlib.sha256()
    while remaining:
        compressed = original.read(min(preflight.CHUNK, remaining))
        require(bool(compressed), 'ZIP_TRUNCATED_COMPRESSED_PAYLOAD')
        remaining -= len(compressed)
        pending = compressed
        while pending:
            output = decoder.decompress(pending, preflight.CHUNK) if decoder else pending
            actual += len(output)
            require(actual <= maximum and actual <= member.file_size, 'ZIP_ACTUAL_PAYLOAD_SIZE_MISMATCH')
            crc = zlib.crc32(output, crc)
            digest.update(output)
            if not decoder:
                break
            require(not decoder.unused_data, 'ZIP_DEFLATE_TRAILING_DATA')
            pending = decoder.unconsumed_tail
        if decoder and decoder.eof:
            require(remaining == 0, 'ZIP_DEFLATE_TRAILING_DATA')
    require(decoder is None or decoder.eof, 'ZIP_DEFLATE_STREAM_NOT_FINISHED')
    require(actual == member.file_size and crc == member.CRC and digest.hexdigest() == expected_digest,
            'ZIP_ACTUAL_PAYLOAD_IDENTITY_MISMATCH')


def inspect_archive(path, expected_sha256=None):
    if expected_sha256 is not None:
        require(bool(re.fullmatch(r'[a-fA-F0-9]{64}', expected_sha256)), 'INVALID_EXPECTED_SHA256')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as original:
        before = os.fstat(original.fileno())
        require(stat.S_ISREG(before.st_mode), 'INPUT_MUST_BE_REGULAR_FILE')
        require(0 < before.st_size <= preflight.MAX_ARCHIVE_BYTES, 'INPUT_SIZE_LIMIT')
        digest, hashed = hashlib.sha256(), 0
        while chunk := original.read(preflight.CHUNK):
            hashed += len(chunk)
            require(hashed <= before.st_size, 'ORIGINAL_CHANGED_DURING_AUDIT')
            digest.update(chunk)
        original_sha = digest.hexdigest()
        require(expected_sha256 is None or original_sha == expected_sha256.lower(), 'EXPECTED_SHA256_MISMATCH')
        inventory = preflight.Inventory()
        preflight.inspect_zip(original, before.st_size, inventory)
        files, counts, expanded = [], Counter(), 0
        original.seek(0)
        with zipfile.ZipFile(original) as bundle:
            for member in bundle.infolist():
                if member.is_dir():
                    verify_raw_payload(original, member, 0, hashlib.sha256(b'').hexdigest())
                    counts['directories'] += 1
                    continue
                kind, maximum = classification(member.filename)
                require(0 < member.file_size <= maximum, 'MEMBER_SIZE_LIMIT')
                pieces, actual, file_digest = [], 0, hashlib.sha256()
                with bundle.open(member) as source:
                    while chunk := source.read(preflight.CHUNK):
                        actual += len(chunk)
                        expanded += len(chunk)
                        require(actual <= maximum and actual <= member.file_size, 'MEMBER_EXPANDED_SIZE_LIMIT')
                        require(expanded <= preflight.MAX_EXPANDED_BYTES, 'ARCHIVE_EXPANDED_SIZE_LIMIT')
                        file_digest.update(chunk)
                        pieces.append(chunk)
                require(actual == member.file_size, 'MEMBER_ACTUAL_SIZE_MISMATCH')
                verify_raw_payload(original, member, maximum, file_digest.hexdigest())
                data = b''.join(pieces)
                if kind == 'svg':
                    summary = svg.inspect_svg(data)
                elif kind == 'json':
                    summary = json_summary(data)
                else:
                    text = data.decode('utf-8', errors='strict')
                    require(all(char in '\t\r\n' or ord(char) >= 32 and ord(char) != 127 for char in text), 'LICENSE_TEXT_CONTROL')
                    summary = {'classification': 'inert-utf8-license-or-readme-text',
                               'lines': len(text.splitlines()), 'rawTextIncluded': False, 'rightsApproval': False}
                files.append({'path': member.filename, 'type': kind, 'bytes': actual,
                              'sha256': file_digest.hexdigest(), 'summary': summary})
                counts[kind] += 1
        require(hashed == before.st_size and preflight.fingerprint(before) == preflight.fingerprint(os.fstat(original.fileno()))
                and preflight.fingerprint(before) == preflight.fingerprint(os.stat(path, follow_symlinks=False)), 'ORIGINAL_CHANGED_DURING_AUDIT')
    return {
        'schemaVersion': 1, 'phase': '10-D', 'status': 'archive-security-audit-passed-not-content-approved',
        'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'original': {'bytes': hashed, 'sha256': original_sha, 'unchangedDuringInspection': True},
        'checksumComparison': 'matches-supplied-value' if expected_sha256 else 'no-external-checksum-supplied',
        'counts': {'entries': len(inventory.entries), 'regularFiles': len(files),
                   **{kind: counts[kind] for kind in ('directories', 'svg', 'json', 'license-text')}},
        'actualExpandedBytes': expanded, 'allRegularMembersReadToEofWithCrc': True,
        'rawCompressedRangesAndActualSizesVerified': True, 'files': files,
        'limits': {'archiveBytes': preflight.MAX_ARCHIVE_BYTES, 'expandedBytes': preflight.MAX_EXPANDED_BYTES,
                   'entries': preflight.MAX_ENTRIES, 'svgBytes': svg.MAX_BYTES, 'jsonBytes': metadata.MAX_BYTES,
                   'licenseTextBytes': MAX_TEXT_BYTES, 'jsonDepth': metadata.MAX_DEPTH, 'jsonNodes': MAX_JSON_NODES},
        'sourceAuthenticity': 'not-verified', 'officialPublisherVerified': False,
        'rightsApproval': False, 'scientificApproval': False, 'mappingApproval': False,
        'pageCountVerified': False, 'filenameToPageMappingInferred': False, 'quranActivation': False,
        'productionActivation': False, 'integrationBlocked': True, 'networkUsed': False,
        'extracted': False, 'rendered': False, 'originalRewritten': False, 'rawQuranIncluded': False,
        'note': 'File counts and structural security checks establish neither Mushaf page correspondence nor publisher authenticity, licensing, Quran correctness, or usable coordinate mapping.',
    }


def write_receipt(input_path, output_path, expected_sha256=None):
    require(not output_path.exists() and not output_path.is_symlink(), 'OUTPUT_MUST_NOT_EXIST')
    require(input_path.resolve() != output_path.resolve(), 'OUTPUT_MUST_NOT_ALIAS_INPUT')
    receipt = inspect_archive(input_path, expected_sha256)
    descriptor = os.open(output_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
        json.dump(receipt, output, ensure_ascii=False, indent=2)
        output.write('\n')
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--expected-sha256')
    args = parser.parse_args()
    try:
        receipt = write_receipt(args.input, args.output, args.expected_sha256)
        print(json.dumps({'status': receipt['status'], 'original': receipt['original'], 'counts': receipt['counts'],
                          'integrationBlocked': True, 'scientificApproval': False, 'productionActivation': False}))
        return 0
    except (Rejected, metadata.Rejected, svg.Rejected, OSError, ValueError, EOFError, RecursionError,
            OverflowError, NotImplementedError, zipfile.BadZipFile, zlib.error) as error:
        reason = str(error) if isinstance(error, (Rejected, metadata.Rejected, svg.Rejected)) else type(error).__name__
        print(json.dumps({'status': 'rejected', 'reason': reason, 'integrationBlocked': True,
                          'scientificApproval': False, 'productionActivation': False}), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
