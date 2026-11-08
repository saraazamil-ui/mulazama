#!/usr/bin/env python3
"""Inventory a quarantined official-source archive without extracting or approving it."""
import argparse
import datetime
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import struct
import sys
import tarfile
import unicodedata
from urllib.parse import unquote, urlsplit
import zipfile
import zlib


MAX_ARCHIVE_BYTES = 2 * 1024**3
MAX_EXPANDED_BYTES = 2 * 1024**3
MAX_ENTRIES = 20000
MAX_CENTRAL_DIRECTORY_BYTES = 16 * 1024**2
MAX_EXPANSION_RATIO = 200
CHUNK = 64 * 1024
OFFICIAL_HOSTS = {"qurancomplex.gov.sa", "dm.qurancomplex.gov.sa"}


class Rejected(ValueError):
    pass


def source_url(value):
    if value != value.strip() or any(ord(c) < 33 or ord(c) == 127 for c in value):
        raise Rejected("SOURCE_URL_WHITESPACE_OR_CONTROL")
    try:
        url = urlsplit(value)
        port = url.port
    except ValueError as error:
        raise Rejected("INVALID_SOURCE_URL") from error
    if (url.scheme != "https" or url.hostname not in OFFICIAL_HOSTS
            or url.username is not None or url.password is not None
            or port not in (None, 443) or url.query or url.fragment):
        raise Rejected("SOURCE_URL_MUST_BE_OFFICIAL_HTTPS_WITHOUT_CREDENTIALS_QUERY_OR_FRAGMENT")
    if any(ord(c) < 32 or ord(c) == 127 for c in unquote(url.path)):
        raise Rejected("SOURCE_URL_ENCODED_CONTROL")
    return value


class Inventory:
    def __init__(self):
        self.entries = []
        self.names = {}
        self.parents = set()
        self.expanded = 0

    def add(self, name, kind, size, compressed=None):
        if (not name or len(name) > 1024 or name.startswith("/")
                or "\\" in name or ":" in name
                or any(ord(c) < 32 or ord(c) == 127 for c in name)):
            raise Rejected("UNSAFE_ENTRY_NAME")
        clean = name[:-1] if kind == "directory" and name.endswith("/") else name
        parts = clean.split("/")
        if len(parts) > 32 or any(p in ("", ".", "..") or p.endswith((".", " ")) for p in parts):
            raise Rejected("UNSAFE_ENTRY_PATH")
        canonical = unicodedata.normalize("NFC", clean).casefold()
        if canonical in self.names:
            raise Rejected("DUPLICATE_ENTRY_NAME")
        parents = canonical.split("/")
        if any(self.names.get("/".join(parents[:i])) == "file" for i in range(1, len(parents))):
            raise Rejected("FILE_DIRECTORY_COLLISION")
        if kind == "file" and canonical in self.parents:
            raise Rejected("FILE_DIRECTORY_COLLISION")
        if size < 0 or (kind == "directory" and size != 0):
            raise Rejected("INVALID_ENTRY_SIZE")
        if len(self.entries) >= MAX_ENTRIES:
            raise Rejected("ENTRY_COUNT_LIMIT")
        self.expanded += size
        if self.expanded > MAX_EXPANDED_BYTES:
            raise Rejected("EXPANDED_SIZE_LIMIT")
        if compressed is not None and size > 0 and (compressed <= 0 or size > compressed * MAX_EXPANSION_RATIO):
            raise Rejected("COMPRESSION_RATIO_LIMIT")
        entry = {"path": name, "kind": kind, "declaredBytes": size}
        if compressed is not None:
            entry["compressedBytes"] = compressed
        self.entries.append(entry)
        self.names[canonical] = kind
        self.parents.update("/".join(parents[:i]) for i in range(1, len(parents)))


def inspect_zip(stream, original_size, inventory):
    # Bound the central directory BEFORE ZipFile allocates it. ZIP64/multidisk
    # are intentionally unsupported by this bounded acquisition preflight.
    stream.seek(max(0, original_size - (65535 + 22)))
    tail = stream.read(65535 + 22)
    index = tail.rfind(b"PK\x05\x06")
    if index < 0 or len(tail) - index < 22:
        raise Rejected("ZIP_END_RECORD_MISSING")
    _, disk, central_disk, disk_count, count, central_size, central_offset, comment_size = struct.unpack(
        "<4s4H2LH", tail[index:index + 22])
    end_offset = original_size - len(tail) + index
    if index + 22 + comment_size != len(tail):
        raise Rejected("ZIP_TRAILING_OR_TRUNCATED_DATA")
    if disk or central_disk or disk_count != count or count == 65535 or central_offset == 0xffffffff or central_size == 0xffffffff:
        raise Rejected("ZIP64_OR_MULTIDISK_UNSUPPORTED")
    if count > MAX_ENTRIES:
        raise Rejected("ENTRY_COUNT_LIMIT")
    if central_size > MAX_CENTRAL_DIRECTORY_BYTES:
        raise Rejected("ZIP_CENTRAL_DIRECTORY_LIMIT")
    if central_offset + central_size != end_offset:
        raise Rejected("ZIP_CENTRAL_DIRECTORY_BOUNDS")
    # ZipFile honors a ZIP64 locator even when the ordinary EOCD uses no
    # sentinel values; reject it before its replacement sizes can be allocated.
    if end_offset >= 20:
        stream.seek(end_offset - 20)
        if stream.read(4) == b"PK\x06\x07":
            raise Rejected("ZIP64_OR_MULTIDISK_UNSUPPORTED")
    stream.seek(0)
    with zipfile.ZipFile(stream) as archive:
        members = archive.infolist()
        if len(members) != count:
            raise Rejected("ZIP_ENTRY_COUNT_MISMATCH")
        compressed_total = 0
        for member in members:
            if member.flag_bits & (1 | 64):
                raise Rejected("ENCRYPTED_ZIP_UNSUPPORTED")
            if member.flag_bits & 32:
                raise Rejected("ZIP_PATCHED_DATA_UNSUPPORTED")
            if member.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                raise Rejected("ZIP_COMPRESSION_UNSUPPORTED")
            mode = member.external_attr >> 16
            kind = "directory" if member.is_dir() else "file"
            file_type = stat.S_IFMT(mode)
            if file_type not in (0, stat.S_IFREG, stat.S_IFDIR):
                raise Rejected("ZIP_LINK_OR_SPECIAL_ENTRY")
            if ((file_type == stat.S_IFDIR or member.external_attr & 0x10) and kind != "directory"
                    or file_type == stat.S_IFREG and kind == "directory"):
                raise Rejected("ZIP_ENTRY_TYPE_MISMATCH")
            inventory.add(member.orig_filename, kind, member.file_size, member.compress_size)
            compressed_total += member.compress_size
            if member.header_offset < 0 or member.header_offset + 30 > central_offset:
                raise Rejected("ZIP_LOCAL_HEADER_BOUNDS")
            stream.seek(member.header_offset)
            local = stream.read(30)
            if len(local) != 30 or local[:4] != b"PK\x03\x04":
                raise Rejected("ZIP_LOCAL_HEADER_MISSING")
            fields = struct.unpack("<4s5H3L2H", local)
            local_flags, local_method = fields[2:4]
            if local_flags & (1 | 64):
                raise Rejected("ENCRYPTED_ZIP_UNSUPPORTED")
            if local_flags & 32:
                raise Rejected("ZIP_PATCHED_DATA_UNSUPPORTED")
            if local_flags != member.flag_bits or local_method != member.compress_type:
                raise Rejected("ZIP_LOCAL_HEADER_MISMATCH")
            if fields[7] == 0xffffffff or fields[8] == 0xffffffff:
                raise Rejected("ZIP64_OR_MULTIDISK_UNSUPPORTED")
            if not local_flags & 8 and fields[6:9] != (member.CRC, member.compress_size, member.file_size):
                raise Rejected("ZIP_LOCAL_HEADER_MISMATCH")
            # Opening validates local-header name/method/overlap, but reading no
            # payload deliberately does NOT claim CRC or decompression integrity.
            with archive.open(member):
                pass
        if inventory.expanded > max(1, compressed_total) * MAX_EXPANSION_RATIO:
            raise Rejected("COMPRESSION_RATIO_LIMIT")
    return "zip"


def inspect_tar(stream, original_size, inventory, compressed):
    # Inspect raw USTAR headers ourselves so PAX/GNU extension sizes cannot make
    # tarfile allocate attacker-controlled metadata before an entry is checked.
    stream.seek(0)
    reader = gzip.GzipFile(fileobj=stream, mode="rb") if compressed else stream
    consumed = 0
    max_scan = MAX_EXPANDED_BYTES + MAX_ENTRIES * 1024 + 10240

    def read(amount):
        nonlocal consumed
        if amount > CHUNK or consumed + amount > max_scan:
            raise Rejected("TAR_SCAN_LIMIT")
        value = reader.read(amount)
        consumed += len(value)
        if compressed and consumed > original_size * MAX_EXPANSION_RATIO:
            raise Rejected("COMPRESSION_RATIO_LIMIT")
        return value

    try:
        while True:
            header = read(512)
            if len(header) != 512:
                raise Rejected("TRUNCATED_TAR")
            if header == bytes(512):
                if read(512) != bytes(512):
                    raise Rejected("TAR_END_RECORD_MISSING")
                while True:
                    padding = read(CHUNK)
                    if not padding:
                        return "tar.gz" if compressed else "tar"
                    if any(padding):
                        raise Rejected("TAR_TRAILING_DATA")
            member = tarfile.TarInfo.frombuf(header, encoding="utf-8", errors="strict")
            if member.type not in (tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.DIRTYPE):
                raise Rejected("TAR_LINK_SPECIAL_OR_EXTENSION_UNSUPPORTED")
            kind = "directory" if member.type == tarfile.DIRTYPE else "file"
            inventory.add(member.name, kind, member.size)
            remaining = (member.size + 511) // 512 * 512
            while remaining:
                amount = min(CHUNK, remaining)
                if len(read(amount)) != amount:
                    raise Rejected("TRUNCATED_TAR_ENTRY")
                remaining -= amount
    finally:
        if compressed:
            reader.close()


def fingerprint(metadata):
    return (metadata.st_dev, metadata.st_ino, metadata.st_size,
            metadata.st_mtime_ns, metadata.st_ctime_ns)


def inspect_original(path, url, published_sha256=None):
    url = source_url(url)
    if published_sha256 is not None and not re.fullmatch(r"[a-fA-F0-9]{64}", published_sha256):
        raise Rejected("INVALID_PUBLISHED_SHA256")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    descriptor = os.open(path, flags)
    with os.fdopen(descriptor, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise Rejected("ORIGINAL_MUST_BE_REGULAR_FILE")
        if not 0 < before.st_size <= MAX_ARCHIVE_BYTES:
            raise Rejected("ORIGINAL_SIZE_LIMIT")
        digest = hashlib.sha256()
        hashed_bytes = 0
        while chunk := stream.read(CHUNK):
            hashed_bytes += len(chunk)
            if hashed_bytes > before.st_size or hashed_bytes > MAX_ARCHIVE_BYTES:
                raise Rejected("ORIGINAL_CHANGED_DURING_INSPECTION")
            digest.update(chunk)
        sha256 = digest.hexdigest()
        if published_sha256 is not None and sha256 != published_sha256.lower():
            raise Rejected("PUBLISHED_SHA256_MISMATCH")
        stream.seek(0)
        magic = stream.read(4)
        inventory = Inventory()
        if magic.startswith(b"PK"):
            archive_format = inspect_zip(stream, before.st_size, inventory)
        else:
            archive_format = inspect_tar(stream, before.st_size, inventory, magic.startswith(b"\x1f\x8b"))
        if (hashed_bytes != before.st_size or fingerprint(before) != fingerprint(os.fstat(stream.fileno()))
                or fingerprint(before) != fingerprint(os.stat(path, follow_symlinks=False))):
            raise Rejected("ORIGINAL_CHANGED_DURING_INSPECTION")
    candidates = [entry["path"] for entry in inventory.entries if entry["kind"] == "file" and
                  re.search(r"read.?me|licen[cs]e|copyright|rights|notice|حقوق|ترخيص|اقرأ",
                            entry["path"].split("/")[-1], re.IGNORECASE)]
    return {
        "schemaVersion": 1, "phase": "10-B", "status": "inventory-preflight-passed",
        "checkedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "sourceUrlProvidedByOperator": url, "sourceAuthenticity": "not-verified",
        "originalBasename": Path(path).name, "originalBytes": before.st_size,
        "sha256": sha256, "suppliedPublishedSha256": published_sha256.lower() if published_sha256 else None,
        "checksumComparison": "matches-supplied-value" if published_sha256 else "no-published-checksum-supplied",
        "archiveFormat": archive_format, "entryCount": len(inventory.entries),
        "declaredExpandedBytes": inventory.expanded, "inventory": inventory.entries,
        "rightsReadmeCandidateFiles": candidates, "rightsApproval": False,
        "payloadIntegrity": "not-performed", "contentVerification": "not-performed",
        "scientificApproval": False, "productionActivation": False,
        "extracted": False, "originalCopied": False,
        "limits": {"archiveBytes": MAX_ARCHIVE_BYTES, "expandedBytes": MAX_EXPANDED_BYTES,
                   "entries": MAX_ENTRIES, "expansionRatio": MAX_EXPANSION_RATIO,
                   "zipCentralDirectoryBytes": MAX_CENTRAL_DIRECTORY_BYTES},
        "note": "Inventory and a supplied hash comparison do not authenticate the publisher, approve rights, or validate Quran content. TAR extension metadata/ZIP64 are refused. No extraction performed.",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--published-sha256")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        if args.output.exists() or args.output.is_symlink():
            raise Rejected("OUTPUT_MUST_NOT_ALREADY_EXIST")
        receipt = inspect_original(args.archive, args.source_url, args.published_sha256)
        # Exclusive creation also rejects aliases/races and never overwrites an
        # existing original or receipt. Parent directories must already exist.
        with args.output.open("x", encoding="utf-8") as output:
            json.dump(receipt, output, ensure_ascii=False, indent=2)
            output.write("\n")
        print(json.dumps({"status": receipt["status"], "sha256": receipt["sha256"],
                          "entries": receipt["entryCount"], "scientificApproval": False}))
        return 0
    except (Rejected, OSError, ValueError, EOFError, NotImplementedError, zipfile.BadZipFile, tarfile.TarError, zlib.error) as error:
        reason = str(error) if isinstance(error, Rejected) else type(error).__name__
        print(json.dumps({"status": "rejected", "reason": reason,
                          "contentVerification": "not-performed", "scientificApproval": False}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
