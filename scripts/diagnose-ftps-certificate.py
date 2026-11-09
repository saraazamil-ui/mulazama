#!/usr/bin/env python3
"""Report public FTPS certificate metadata with strict verification and no login."""
import json
import os
import re
import subprocess
import sys


EXPECTED_SERVER = "sh00003.whb.tempwebhost.net"
PEM = re.compile(r"-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----")


def openssl_environment():
    # The diagnostic never needs authentication, even when invoked from a shell
    # which happens to have deployment credentials in its environment.
    return {key: value for key, value in os.environ.items()
            if key not in {"FTP_SERVER", "FTP_USERNAME", "FTP_PASSWORD"}}


def certificate_metadata(pem):
    result = subprocess.run([
        "openssl", "x509", "-noout", "-subject", "-issuer", "-startdate", "-enddate",
        "-fingerprint", "-sha256", "-ext", "subjectAltName",
    ], input=pem, text=True, capture_output=True, timeout=10, env=openssl_environment())
    if result.returncode:
        return {"metadataAvailable": False}
    fields = {}
    for line in result.stdout.splitlines():
        for prefix, name in (("subject=", "subject"), ("issuer=", "issuer"),
                             ("notBefore=", "notBefore"), ("notAfter=", "notAfter"),
                             ("sha256 Fingerprint=", "sha256Fingerprint")):
            if line.startswith(prefix):
                fields[name] = line[len(prefix):][:512]
    # These are claims from an untrusted public certificate, never permission to
    # select a different destination or send credentials to one of these names.
    fields["dnsNames"] = re.findall(r"DNS:([A-Za-z0-9.*_-]{1,253})(?=,|\s|$)", result.stdout)[:30]
    return {"metadataAvailable": True, **fields}


def diagnose():
    if os.environ.get("FTP_SERVER", "").strip().lower() != EXPECTED_SERVER:
        print("FTP_SERVER must match the owner-approved hostname before diagnostics. "
              "Update the GitHub secret; no network connection was attempted.", file=sys.stderr)
        return 1
    # AUTH TLS only. Strict verification remains enabled even when the peer
    # certificate is reported after a failed handshake. No USER/PASS is sent.
    result = subprocess.run([
        "openssl", "s_client", "-connect", EXPECTED_SERVER + ":21",
        "-starttls", "ftp", "-servername", EXPECTED_SERVER,
        "-verify_hostname", EXPECTED_SERVER, "-verify_return_error",
        "-min_protocol", "TLSv1.2", "-showcerts",
    ], input="", text=True, capture_output=True, timeout=35, env=openssl_environment())
    codes = sorted({int(value) for value in re.findall(r"verify error:num=(\d{1,3}):", result.stderr)})
    match = PEM.search(result.stdout)
    passed = result.returncode == 0 and "Verify return code: 0 (ok)" in result.stdout and bool(match)
    report = {
        "expectedServerMatched": True, "port": 21, "explicitFTPS": True,
        "strictHostnameAndChainVerification": True, "certificateVerified": passed,
        "verificationErrorCodes": codes, "opensslExitCode": result.returncode,
        "authenticationAttempted": False, "remoteWrites": 0,
        "certificateSource": "untrusted public peer certificate; not an alternate-host authorization",
    }
    if match and len(match[0]) <= 32768:
        report["leafCertificate"] = certificate_metadata(match[0])
    else:
        report["leafCertificate"] = {"metadataAvailable": False}
    print(json.dumps(report, ensure_ascii=True))
    return 0 if passed else 1


def main():
    try:
        return diagnose()
    except (OSError, subprocess.SubprocessError, ValueError) as error:
        # Do not echo subprocess output, server banners, host values or raw errors.
        print("Certificate diagnostic failed (" + type(error).__name__ + "); "
              "no authentication or file changes were attempted.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
