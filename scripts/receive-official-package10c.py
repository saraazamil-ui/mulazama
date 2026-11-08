#!/usr/bin/env python3
"""Copy an original archive into an explicit external quarantine; never download, extract, or approve it."""
import argparse
import ctypes
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys
from urllib.parse import urlunsplit
import uuid

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("archive_preflight10b", ROOT / "scripts/inspect-official-archive10b.py")
inspector = importlib.util.module_from_spec(spec)
previous_bytecode = sys.dont_write_bytecode
try:
    sys.dont_write_bytecode = True
    spec.loader.exec_module(inspector)
finally:
    sys.dont_write_bytecode = previous_bytecode
Rejected = inspector.Rejected
DIRECTORY = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def outside_repository(value):
    path = Path(value)
    if not path.is_absolute() or ".." in path.parts:
        raise Rejected("ABSOLUTE_PATH_WITHOUT_PARENT_TRAVERSAL_REQUIRED")
    path = Path("/", *path.parts[1:])  # Normalize POSIX double-leading-slash aliases.
    if path == ROOT or ROOT in path.parents:
        raise Rejected("SOURCE_AND_VAULT_MUST_BE_OUTSIDE_REPOSITORY")
    return path


def open_directory(path):
    """Walk with directory descriptors; no operator-supplied symlink is followed."""
    descriptor = os.open("/", DIRECTORY)
    try:
        for component in path.parts[1:]:
            child = os.open(component, DIRECTORY, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def downloaded_time(value):
    if value is None:
        return None
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})", value):
        raise Rejected("DOWNLOADED_AT_MUST_BE_ISO_WITH_TIMEZONE")
    try:
        return datetime.datetime.fromisoformat(value.replace("Z", "+00:00")).isoformat()
    except ValueError as error:
        raise Rejected("INVALID_DOWNLOADED_AT") from error


def download_url(value):
    if (len(value) > 4096 or value != value.strip() or "#" in value
            or any(ord(c) < 33 or ord(c) == 127 for c in value)):
        raise Rejected("INVALID_FINAL_DOWNLOAD_URL")
    try:
        parsed = inspector.urlsplit(value)
    except ValueError as error:
        raise Rejected("INVALID_FINAL_DOWNLOAD_URL") from error
    inspector.source_url(urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", "")))
    if len(parsed.query) > 2048 or any(ord(c) < 32 or ord(c) == 127 for c in inspector.unquote(parsed.query)):
        raise Rejected("FINAL_DOWNLOAD_QUERY_LIMIT_OR_CONTROL")
    return value


def publish_directory(vault_fd, temporary, destination):
    """Linux atomic no-replace rename; a collision is never overwritten."""
    library = ctypes.CDLL(None, use_errno=True)
    rename = getattr(library, "renameat2", None)
    if rename is None:
        raise Rejected("ATOMIC_NOREPLACE_RENAME_UNAVAILABLE")
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(vault_fd, temporary.encode(), vault_fd, destination.encode(), 1):
        number = ctypes.get_errno()
        raise OSError(number, os.strerror(number))


def receive(archive, vault, source_page, *, final_download_url=None, advertised_version=None,
            downloaded_at=None, published_sha256=None):
    archive, vault = outside_repository(archive), outside_repository(vault)
    source_page = inspector.source_url(source_page)
    final_download_url = download_url(final_download_url) if final_download_url is not None else None
    downloaded_at = downloaded_time(downloaded_at)
    if advertised_version is not None and (not advertised_version.strip() or len(advertised_version) > 200
                                           or any(ord(c) < 32 or ord(c) == 127 for c in advertised_version)):
        raise Rejected("INVALID_ADVERTISED_VERSION")
    if published_sha256 is not None and not re.fullmatch(r"[a-fA-F0-9]{64}", published_sha256):
        raise Rejected("INVALID_PUBLISHED_SHA256")
    source_parent = vault_fd = stage_fd = None
    stage_name = stage_identity = None
    published = False
    try:
        source_parent = open_directory(archive.parent)
        source_fd = os.open(archive.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=source_parent)
        with os.fdopen(source_fd, "rb") as source:
            before = os.fstat(source.fileno())
            if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= inspector.MAX_ARCHIVE_BYTES:
                raise Rejected("ORIGINAL_MUST_BE_BOUNDED_REGULAR_FILE")
            vault_fd = open_directory(vault)  # Vault must already exist.
            receipt_id = "10c-" + uuid.uuid4().hex
            stage_name = ".pending-" + receipt_id
            os.mkdir(stage_name, 0o700, dir_fd=vault_fd)
            created = os.stat(stage_name, dir_fd=vault_fd, follow_symlinks=False)
            stage_identity = (created.st_dev, created.st_ino)
            stage_fd = os.open(stage_name, DIRECTORY, dir_fd=vault_fd)
            opened = os.fstat(stage_fd)
            if (opened.st_dev, opened.st_ino) != stage_identity:
                raise Rejected("STAGING_DIRECTORY_CHANGED")
            output_fd = os.open("original.archive", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=stage_fd)
            digest, copied = hashlib.sha256(), 0
            with os.fdopen(output_fd, "wb") as output:
                while chunk := source.read(inspector.CHUNK):
                    copied += len(chunk)
                    if copied > before.st_size or copied > inspector.MAX_ARCHIVE_BYTES:
                        raise Rejected("ORIGINAL_CHANGED_DURING_COPY")
                    digest.update(chunk)
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
                os.fchmod(output.fileno(), 0o400)
            captured_sha = digest.hexdigest()
            # This process-owned descriptor anchors inspection even if a parent
            # path is renamed. No caller-controlled symlink or extraction is used.
            staged = Path("/proc/self/fd") / str(stage_fd) / "original.archive"
            preflight = inspector.inspect_original(staged, source_page, published_sha256)
            if copied != before.st_size or preflight["sha256"] != captured_sha or preflight["originalBytes"] != copied:
                raise Rejected("COPIED_ARCHIVE_IDENTITY_MISMATCH")
            if (inspector.fingerprint(before) != inspector.fingerprint(os.fstat(source.fileno()))
                    or inspector.fingerprint(before) != inspector.fingerprint(os.stat(archive.name, dir_fd=source_parent, follow_symlinks=False))):
                raise Rejected("ORIGINAL_CHANGED_DURING_COPY")
        receipt = {
            "schemaVersion": 1, "phase": "10-C", "status": "received-quarantined", "receiptId": receipt_id,
            "receivedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "sourcePageProvidedByOperator": source_page, "finalDownloadUrlProvidedByOperator": final_download_url,
            "advertisedVersion": {"value": advertised_version, "verified": False},
            "downloadedAtProvidedByOperator": downloaded_at, "originalFilename": archive.name,
            "storedArchive": "original.archive", "originalBytes": copied, "capturedSourceSha256": captured_sha,
            "copiedArchiveSha256": preflight["sha256"], "originalCopied": True,
            "sourceAuthenticity": "not-verified", "rightsApproval": False, "scientificApproval": False,
            "mappingApproval": False, "quranActivation": False, "productionActivation": False,
            "networkUsed": False, "extracted": False, "preflight": preflight,
            "note": "Read-only quarantine copy, not publisher authentication, payload validation, permission to use, or Quran approval. Operator metadata remains unverified.",
        }
        receipt_fd = os.open("receipt.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=stage_fd)
        with os.fdopen(receipt_fd, "w", encoding="utf-8") as output:
            json.dump(receipt, output, ensure_ascii=False, indent=2)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
            os.fchmod(output.fileno(), 0o400)
        os.fchmod(stage_fd, 0o500)
        os.fsync(stage_fd)
        publish_directory(vault_fd, stage_name, receipt_id)
        published = True
        os.fsync(vault_fd)
        return {"status": receipt["status"], "receiptDirectory": str(vault / receipt_id),
                "sha256": captured_sha, "quranActivation": False, "scientificApproval": False}
    finally:
        try:
            if not published and stage_identity is not None:
                if stage_fd is not None and (os.fstat(stage_fd).st_dev, os.fstat(stage_fd).st_ino) == stage_identity:
                    os.fchmod(stage_fd, 0o700)
                    for name in ("original.archive", "receipt.json"):
                        try:
                            os.unlink(name, dir_fd=stage_fd)
                        except FileNotFoundError:
                            pass
                current = os.stat(stage_name, dir_fd=vault_fd, follow_symlinks=False)
                if (current.st_dev, current.st_ino) == stage_identity:
                    os.rmdir(stage_name, dir_fd=vault_fd)
        finally:
            for descriptor in (stage_fd, vault_fd, source_parent):
                if descriptor is not None:
                    os.close(descriptor)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--vault", required=True, type=Path, help="Existing absolute quarantine directory outside the repository")
    parser.add_argument("--source-page", required=True)
    parser.add_argument("--final-download-url")
    parser.add_argument("--advertised-version")
    parser.add_argument("--downloaded-at")
    parser.add_argument("--published-sha256")
    args = vars(parser.parse_args())
    try:
        print(json.dumps(receive(**args), ensure_ascii=False))
        return 0
    except (Rejected, OSError, ValueError, EOFError, NotImplementedError, inspector.zipfile.BadZipFile,
            inspector.tarfile.TarError, inspector.zlib.error) as error:
        print(json.dumps({"status": "rejected", "reason": str(error) if isinstance(error, Rejected) else type(error).__name__,
                          "quranActivation": False, "scientificApproval": False}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
