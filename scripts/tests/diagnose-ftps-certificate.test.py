#!/usr/bin/env python3
"""Certificate diagnostics tests; only the integration case uses loopback TCP."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("certificate_diagnostic", Path(__file__).resolve().parents[1] / "diagnose-ftps-certificate.py")
diagnostic = importlib.util.module_from_spec(spec)
with patch.object(sys, "dont_write_bytecode", True):
    spec.loader.exec_module(diagnostic)


class CertificateTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        patch.dict(os.environ, {"FTP_SERVER": diagnostic.EXPECTED_SERVER,
                                "FTP_USERNAME": "private-user", "FTP_PASSWORD": "private-password"}).start()

    def run_diagnostic(self):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = diagnostic.main()
        return code, out.getvalue(), err.getvalue()

    def test_unexpected_or_empty_host_never_connects_or_echoes_value(self):
        with patch.object(diagnostic.subprocess, "run") as run:
            for host in ("", "ftp.mulazama.com", "private-other.example.invalid"):
                with self.subTest(host=host), patch.dict(os.environ, {"FTP_SERVER": host}):
                    code, out, err = self.run_diagnostic()
                self.assertEqual((code, out), (1, ""))
                self.assertIn("no network connection was attempted", err)
                if host:
                    self.assertNotIn(host, err)
            run.assert_not_called()

    def test_failure_keeps_strict_flags_and_excludes_credentials_from_child(self):
        response = subprocess.CompletedProcess([], 1, "private banner", "verify error:num=62:private reply")
        with patch.object(diagnostic.subprocess, "run", return_value=response) as run:
            code, out, err = self.run_diagnostic()
        self.assertEqual((code, err), (1, ""))
        report = json.loads(out)
        self.assertEqual(report["verificationErrorCodes"], [62])
        self.assertIs(report["certificateVerified"], False)
        self.assertNotIn("private", out)
        command = run.call_args.args[0]
        self.assertEqual(command[command.index("-starttls") + 1], "ftp")
        self.assertIn("-verify_return_error", command)
        self.assertEqual(command[command.index("-verify_hostname") + 1], diagnostic.EXPECTED_SERVER)
        self.assertEqual(command[command.index("-servername") + 1], diagnostic.EXPECTED_SERVER)
        self.assertEqual(command[command.index("-min_protocol") + 1], "TLSv1.2")
        for key in ("FTP_SERVER", "FTP_USERNAME", "FTP_PASSWORD"):
            self.assertNotIn(key, run.call_args.kwargs["env"])
        self.assertEqual(run.call_args.kwargs["input"], "")

    def test_exit_zero_without_verified_peer_is_not_success(self):
        with patch.object(diagnostic.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "", "")):
            code, out, _ = self.run_diagnostic()
        self.assertEqual(code, 1)
        self.assertIs(json.loads(out)["certificateVerified"], False)

    def test_timeout_does_not_echo_subprocess_or_secret_text(self):
        error = subprocess.TimeoutExpired(["private-password"], 35, output="private-output")
        with patch.object(diagnostic.subprocess, "run", side_effect=error):
            code, out, err = self.run_diagnostic()
        self.assertEqual((code, out), (1, ""))
        self.assertIn("TimeoutExpired", err)
        self.assertNotIn("private", err)

    def test_real_openssl_mismatch_reports_peer_metadata_without_ftp_login(self):
        # A locally trusted test certificate makes hostname mismatch the only
        # expected failure. Production diagnostics never alter the trust store.
        with tempfile.TemporaryDirectory(prefix="mulazama-cert-test-") as directory:
            cert, key = Path(directory) / "cert.pem", Path(directory) / "key.pem"
            original_run = subprocess.run
            original_run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-noenc",
                          "-keyout", str(key), "-out", str(cert), "-days", "1",
                          "-subj", "/CN=wrong.invalid", "-addext", "subjectAltName=DNS:wrong.invalid"],
                         capture_output=True, check=True)
            server = socket.socket()
            self.addCleanup(server.close)
            server.bind(("127.0.0.1", 0))
            port = server.getsockname()[1]
            server.listen(1)
            server.settimeout(10)
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(cert, key)
            commands, failures = [], []

            def serve():
                try:
                    with server.accept()[0] as client:
                        client.settimeout(10)
                        client.sendall(b"220 Local FTPS test\r\n")
                        commands.append(client.recv(1024))
                        client.sendall(b"234 Begin TLS\r\n")
                        try:
                            context.wrap_socket(client, server_side=True).close()
                        except ssl.SSLError:
                            pass  # Strict client aborts on the deliberate mismatch.
                except Exception as error:
                    failures.append(type(error).__name__)

            thread = threading.Thread(target=serve, daemon=True)
            thread.start()

            def local_run(command, **kwargs):
                command = list(command)
                if command[:2] == ["openssl", "s_client"]:
                    command[command.index("-connect") + 1] = f"127.0.0.1:{port}"
                    command += ["-CAfile", str(cert)]
                return original_run(command, **kwargs)

            with patch.object(diagnostic.subprocess, "run", side_effect=local_run):
                code, out, err = self.run_diagnostic()
            thread.join(timeout=12)
            self.assertFalse(thread.is_alive())
            self.assertEqual(failures, [])
            self.assertEqual((code, err), (1, ""))
            report = json.loads(out)
            self.assertEqual(report["verificationErrorCodes"], [62])
            self.assertIs(report["certificateVerified"], False)
            self.assertEqual(report["leafCertificate"]["dnsNames"], ["wrong.invalid"])
            self.assertIn("CN=wrong.invalid", report["leafCertificate"]["subject"])
            self.assertTrue(report["leafCertificate"]["sha256Fingerprint"])
            self.assertEqual(commands, [b"AUTH TLS\r\n"])
            self.assertIs(report["authenticationAttempted"], False)
            self.assertEqual(report["remoteWrites"], 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
