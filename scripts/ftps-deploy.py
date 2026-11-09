#!/usr/bin/env python3
"""Read-only FTPS preflight and guarded upload of the ordinary dist/ build only."""
import argparse
import ftplib
import hashlib
import json
import os
from pathlib import Path
import re
import ssl
import sys


PORT = 21
REMOTE_DIRECTORY = "./"  # The FTP account already starts inside public_html.
CONFIRMATION = "DEPLOY mulazama.com"
FIXED_FILES = frozenset({
    "404.html", "icon-192.png", "icon-512.png", "icon.svg", "index.html",
    "maintenance.html", "manifest.webmanifest", "offline-assets.json",
    "policies.css", "privacy.html", "support.html", "sw.js", "terms.html",
})
ASSET_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]*-[A-Za-z0-9_-]{8,}\.(?:js|css)\Z")


def validate_artifact(directory):
    """Fail closed if source, server configuration, links or stale files enter dist."""
    root = Path(directory)
    if root.is_symlink() or not root.is_dir():
        raise ValueError("Build directory must be a real directory.")
    files = {}
    for path in root.rglob("*"):
        relative = path.relative_to(root).as_posix()
        if path.is_symlink():
            raise ValueError("Build must not contain symbolic links.")
        if path.is_dir():
            if relative != "assets":
                raise ValueError("Unexpected build directory.")
            continue
        allowed_asset = path.parent == root / "assets" and ASSET_NAME.fullmatch(path.name)
        if not path.is_file() or not (relative in FIXED_FILES or allowed_asset):
            raise ValueError("File outside the reviewed static-build allowlist.")
        if path.stat().st_size == 0:
            raise ValueError("Empty build file.")
        files[relative] = path
    if not FIXED_FILES.issubset(files) or not any(name.startswith("assets/") for name in files):
        raise ValueError("Incomplete build artifact.")
    manifest = json.loads(files["offline-assets.json"].read_text(encoding="utf-8"))
    expected = sorted(set(files) - {"offline-assets.json", "sw.js"})
    if not isinstance(manifest, dict) or manifest.get("files") != expected:
        raise ValueError("Offline manifest must match the complete build exactly.")
    digest = hashlib.sha256()
    for name in expected:
        digest.update(files[name].read_bytes())
    if manifest.get("version") != "mulazama-shell-" + digest.hexdigest()[:20]:
        raise ValueError("Offline manifest does not match the build bytes.")
    return files


def credentials():
    values = [os.environ.get(name, "") for name in ("FTP_SERVER", "FTP_USERNAME", "FTP_PASSWORD")]
    if not all(values):
        raise ValueError("FTP_SERVER, FTP_USERNAME and FTP_PASSWORD must all be configured.")
    host, username, password = values
    # A hostname only: no URI, port, path, command separator or embedded credentials.
    if len(host) > 253 or not re.fullmatch(
        r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
        r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*", host
    ):
        raise ValueError("FTP_SERVER must be a hostname only; Explicit FTPS uses port 21.")
    if any(character in username + password for character in "\r\n\x00"):
        raise ValueError("FTP credentials contain an unsupported control character.")
    return host, username, password


def connect():
    host, username, password = credentials()
    context = ssl.create_default_context()
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    ftp = ftplib.FTP_TLS(context=context, timeout=30)
    try:
        ftp.connect(host, PORT)
        ftp.auth()  # AUTH TLS before USER/PASS: explicit FTPS, never plaintext fallback.
        ftp.login(username, password)
        ftp.prot_p()  # Encrypt passive data connections as well as the control channel.
        ftp.set_pasv(True)
        return ftp
    except Exception:
        ftp.close()
        raise


def preflight(ftp):
    before = ftp.pwd()
    ftp.cwd(REMOTE_DIRECTORY)
    if ftp.pwd() != before:
        raise ValueError("Relative deployment directory did not preserve the login directory.")
    # NLST exercises the protected passive data channel; do not print server filenames.
    entries = ftp.nlst()
    return {"explicitFTPS": True, "port": PORT, "remoteDirectory": REMOTE_DIRECTORY,
            "loginDirectoryUnchanged": True, "protectedDirectoryListing": True,
            "directoryEntries": len(entries), "remoteWrites": 0,
            "physicalPublicHtmlMapping": "owner-reported; not provable from FTP PWD alone"}


def upload(ftp, files):
    root = ftp.pwd()
    try:
        ftp.cwd("assets")
    except ftplib.error_perm as error:
        if not str(error).startswith("550"):
            raise
        ftp.mkd("assets")
    else:
        ftp.cwd("..")
    if ftp.pwd() != root:
        raise ValueError("FTP directory changed unexpectedly before upload.")
    # Old assets remain available to existing clients. No delete, mirror, rename or cleanup.
    order = sorted(files, key=lambda name: (
        3 if name == "sw.js" else 2 if name == "index.html"
        else 0 if name.startswith("assets/") else 1, name
    ))
    for name in order:
        with files[name].open("rb") as source:
            ftp.storbinary("STOR " + name, source)
    return {"uploadedFiles": len(order), "deletedFiles": 0, "remoteDirectory": REMOTE_DIRECTORY}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("check", "validate", "deploy"), nargs="?", default="check")
    parser.add_argument("--local-dir", default="dist")
    parser.add_argument("--confirm", default="")
    args = parser.parse_args(argv)
    ftp = None
    try:
        files = None
        if args.operation == "deploy" and args.confirm != CONFIRMATION:
            raise ValueError("Deployment requires the exact manual confirmation phrase.")
        if args.operation in ("validate", "deploy"):
            files = validate_artifact(args.local_dir)
        if args.operation == "validate":
            print(json.dumps({"artifactValidation": "passed", "files": len(files), "remoteWrites": 0}))
            return 0
        ftp = connect()
        result = preflight(ftp)
        if args.operation == "deploy":
            result = upload(ftp, files)
        print(json.dumps(result))
        return 0
    except Exception as error:
        # Server replies and exception text can echo credentials or private directory names.
        # Keep failure logs useful without exposing either; GitHub masking is only a backstop.
        print("FTPS " + args.operation + " failed (" + type(error).__name__ + "). "
              "Check the configured secrets, verified TLS certificate, passive ports and build allowlist.",
              file=sys.stderr)
        return 1
    finally:
        if ftp is not None:
            ftp.close()


if __name__ == "__main__":
    raise SystemExit(main())
