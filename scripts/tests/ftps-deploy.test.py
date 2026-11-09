#!/usr/bin/env python3
"""Test transport and write boundaries with fake FTP; never contact a real server."""
import contextlib
import ftplib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import ssl
import sys
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "ftps-deploy.py"
specification = importlib.util.spec_from_file_location("ftps_deploy", SCRIPT)
deploy = importlib.util.module_from_spec(specification)
with patch.object(sys, "dont_write_bytecode", True):
    specification.loader.exec_module(deploy)


class FakeFTP:
    def __init__(self, *, context, timeout):
        self.context, self.timeout = context, timeout
        self.calls, self.directory = [], "/"
        self.assets_exist = True

    def connect(self, host, port): self.calls.append(("connect", host, port))
    def auth(self): self.calls.append(("auth",))
    def login(self, user, password): self.calls.append(("login", user, password))
    def prot_p(self): self.calls.append(("prot_p",))
    def set_pasv(self, value): self.calls.append(("set_pasv", value))
    def pwd(self):
        self.calls.append(("pwd",))
        return self.directory
    def cwd(self, directory):
        self.calls.append(("cwd", directory))
        if directory == "assets":
            if not self.assets_exist:
                raise ftplib.error_perm("550 Not found")
            self.directory = "/assets"
        elif directory == "..": self.directory = "/"
    def nlst(self):
        self.calls.append(("nlst",))
        return ["private-existing-file", "assets"]
    def mkd(self, directory): self.calls.append(("mkd", directory))
    def storbinary(self, command, source): self.calls.append(("storbinary", command, source.read()))
    def close(self): self.calls.append(("close",))


class FtpsTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="mulazama-ftps-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name) / "dist"
        self.root.mkdir()
        self.env = {"FTP_SERVER": "ftp.example.invalid", "FTP_USERNAME": "user", "FTP_PASSWORD": "secret-password"}
        self.addCleanup(patch.stopall)
        patch.dict(os.environ, self.env, clear=True).start()
        self.instances = []
        def factory(**kwargs):
            instance = FakeFTP(**kwargs)
            self.instances.append(instance)
            return instance
        self.factory = patch.object(deploy.ftplib, "FTP_TLS", side_effect=factory).start()

    def fixture(self):
        for name in deploy.FIXED_FILES:
            (self.root / name).write_text("build " + name)
        (self.root / "assets").mkdir(exist_ok=True)
        (self.root / "assets/index-Abcd1234.js").write_text("build JavaScript")
        self.manifest()

    def manifest(self):
        files = sorted(path.relative_to(self.root).as_posix() for path in self.root.rglob("*")
                       if path.is_file() and path.name not in ("sw.js", "offline-assets.json"))
        digest = hashlib.sha256()
        for name in files: digest.update((self.root / name).read_bytes())
        (self.root / "offline-assets.json").write_text(json.dumps({
            "files": files, "version": "mulazama-shell-" + digest.hexdigest()[:20]}))

    def run_cli(self, *arguments):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = deploy.main(list(arguments))
        return code, out.getvalue(), err.getvalue()

    def test_default_check_is_read_only_and_uses_verified_explicit_tls(self):
        code, out, err = self.run_cli()
        self.assertEqual((code, err), (0, ""))
        ftp = self.instances[0]
        self.assertEqual(ftp.context.minimum_version, ssl.TLSVersion.TLSv1_2)
        self.assertTrue(ftp.context.check_hostname)
        self.assertEqual(ftp.context.verify_mode, ssl.CERT_REQUIRED)
        self.assertEqual(ftp.calls, [
            ("connect", self.env["FTP_SERVER"], 21), ("auth",),
            ("login", "user", "secret-password"), ("prot_p",), ("set_pasv", True),
            ("pwd",), ("cwd", "./"), ("pwd",), ("nlst",), ("close",)])
        self.assertEqual(json.loads(out)["remoteWrites"], 0)
        self.assertNotIn("private-existing-file", out)

    def test_server_must_be_hostname_without_scheme_path_port_or_controls(self):
        for host in ("ftp://example.invalid", "example.invalid:21", "example.invalid/public_html",
                     "user@example.invalid", "bad\nPASS x", "-host.invalid", "a..invalid"):
            with self.subTest(host=host), patch.dict(os.environ, {"FTP_SERVER": host}):
                self.assertEqual(self.run_cli()[0], 1)
        self.factory.assert_not_called()

    def test_missing_secrets_fail_before_connect(self):
        for key in self.env:
            with self.subTest(key=key), patch.dict(os.environ, {key: ""}):
                self.assertEqual(self.run_cli()[0], 1)
        self.factory.assert_not_called()

    def test_failed_tls_never_logs_in_or_leaks_server_reply(self):
        with patch.object(FakeFTP, "auth", side_effect=ssl.SSLError("secret-password private-dir")):
            code, out, err = self.run_cli()
        self.assertEqual(code, 1)
        self.assertNotIn("secret-password", err + out)
        self.assertNotIn("private-dir", err + out)
        self.assertEqual([call[0] for call in self.instances[0].calls], ["connect", "close"])

    def test_failed_data_connection_is_not_reported_as_success(self):
        with patch.object(FakeFTP, "nlst", side_effect=TimeoutError("private details")):
            code, out, err = self.run_cli("check")
        self.assertEqual(code, 1)
        self.assertEqual(out, "")
        self.assertNotIn("private details", err)

    def test_changed_relative_directory_fails_before_data_listing(self):
        with patch.object(FakeFTP, "pwd", side_effect=["/", "/public_html"]):
            self.assertEqual(self.run_cli("check")[0], 1)
        self.assertNotIn("nlst", [call[0] for call in self.instances[0].calls])

    def test_validate_is_offline_and_accepts_only_consistent_build(self):
        self.fixture()
        code, out, err = self.run_cli("validate", "--local-dir", str(self.root))
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(json.loads(out)["files"], 14)
        self.factory.assert_not_called()

    def test_missing_required_file_and_stale_manifest_are_rejected(self):
        self.fixture()
        (self.root / "index.html").unlink()
        with self.assertRaises(ValueError): deploy.validate_artifact(self.root)
        (self.root / "index.html").write_text("changed index")
        with self.assertRaises(ValueError): deploy.validate_artifact(self.root)

    def test_source_server_configuration_and_unsafe_assets_are_rejected(self):
        self.fixture()
        for name in (".htaccess", ".env", "source.ts", "assets/source.map", "assets/index.js", "engineering.html"):
            with self.subTest(name=name):
                path = self.root / name
                path.write_text("must not upload")
                with self.assertRaises(ValueError): deploy.validate_artifact(self.root)
                path.unlink()
        (self.root / "content").mkdir()
        with self.assertRaises(ValueError): deploy.validate_artifact(self.root)

    def test_symlink_root_and_files_are_rejected(self):
        self.fixture()
        linked = self.root.parent / "linked"
        linked.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(ValueError): deploy.validate_artifact(linked)
        path = self.root / "assets/leak-Abcd1234.js"
        path.symlink_to(self.root / "index.html")
        with self.assertRaises(ValueError): deploy.validate_artifact(self.root)

    def test_confirmation_and_invalid_build_fail_before_network(self):
        self.fixture()
        for phrase in ("", "yes", "DEPLOY mulazama.sa"):
            with self.subTest(phrase=phrase):
                self.assertEqual(self.run_cli("deploy", "--local-dir", str(self.root), "--confirm", phrase)[0], 1)
        (self.root / "index.html").unlink()
        self.assertEqual(self.run_cli("deploy", "--local-dir", str(self.root), "--confirm", deploy.CONFIRMATION)[0], 1)
        self.factory.assert_not_called()

    def test_deploy_only_uploads_allowlisted_files_assets_first_entrypoints_last(self):
        self.fixture()
        self.assertEqual(self.run_cli("deploy", "--local-dir", str(self.root), "--confirm", deploy.CONFIRMATION)[0], 0)
        calls = self.instances[0].calls
        commands = [call[1] for call in calls if call[0] == "storbinary"]
        self.assertEqual(commands[0], "STOR assets/index-Abcd1234.js")
        self.assertEqual(commands[-2:], ["STOR index.html", "STOR sw.js"])
        self.assertEqual(len(commands), 14)
        self.assertTrue(set(call[0] for call in calls) <= {
            "connect", "auth", "login", "prot_p", "set_pasv", "pwd", "cwd", "nlst", "storbinary", "close"})

    def test_missing_assets_directory_is_created_without_deleting_existing_files(self):
        self.fixture()
        ftp = FakeFTP(context=ssl.create_default_context(), timeout=30)
        ftp.assets_exist = False
        deploy.upload(ftp, deploy.validate_artifact(self.root))
        self.assertEqual([call for call in ftp.calls if call[0] == "mkd"], [("mkd", "assets")])


if __name__ == "__main__":
    unittest.main(verbosity=2)
