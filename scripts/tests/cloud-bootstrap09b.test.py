#!/usr/bin/env python3
"""Exercise the pasteable bootstrap with real local Git repos and fake runtimes."""
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "cloud-bootstrap09b.sh"
STARTUP = SCRIPT.with_name("cloud-start08a.py")


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], text=True, stderr=subprocess.PIPE).strip()


class BootstrapTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="mulazama-bootstrap-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.seed, self.remote = self.root / "seed", self.root / "remote.git"
        self.source, self.tasks = self.root / "source", self.root / "tasks"
        self.seed.mkdir()
        git(self.root, "init", "--bare", "--initial-branch=main", str(self.remote))
        git(self.seed, "init", "--initial-branch=main")
        git(self.seed, "config", "user.name", "Bootstrap fixture")
        git(self.seed, "config", "user.email", "bootstrap@example.invalid")
        (self.seed / "README.md").write_text("stale prepared checkout\n")
        self.stale = self.commit("old snapshot")
        git(self.seed, "remote", "add", "origin", str(self.remote))
        git(self.seed, "push", "origin", "main")
        git(self.root, "clone", str(self.remote), str(self.source))
        git(self.source, "switch", "--create", "work")
        (self.seed / "scripts").mkdir()
        startup = STARTUP.read_text().replace('OFFICIAL = "https://github.com/saraazamil-ui/mulazama"', "OFFICIAL = " + repr(str(self.remote).removesuffix(".git")))
        startup = startup.replace('BASELINE = "1da475029d414764cec2307935aa9f9d5b9afcd6"', "BASELINE = " + repr(self.stale))
        (self.seed / "scripts/cloud-start08a.py").write_text(startup)
        (self.seed / "package.json").write_text(json.dumps({"packageManager": "pnpm@11.25.0"}))
        (self.seed / "pnpm-lock.yaml").write_text("lockfileVersion: '9.0'\n")
        (self.seed / ".gitignore").write_text("node_modules/\n")
        (self.seed / "src").mkdir()
        (self.seed / "src/app.ts").write_text("export const fixture = true;\n")
        self.baseline = self.commit("complete approved source")
        git(self.seed, "push", "origin", "main")
        payload = SCRIPT.read_text().split("<<'MULAZAMA_BOOTSTRAP_PY'\n", 1)[1].split("\nMULAZAMA_BOOTSTRAP_PY\n", 1)[0]
        self.module = types.ModuleType("cloud_bootstrap09b_fixture")
        exec(compile(payload, str(SCRIPT), "exec"), self.module.__dict__)
        self.module.SOURCE, self.module.TASKS = self.source, self.tasks
        self.module.OFFICIAL = str(self.remote).removesuffix(".git")
        self.module.BASELINE = self.baseline
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.executable("node", '#!/bin/sh\nprintf "v24.22.1\\n"\n')
        self.executable("chromium", '#!/bin/sh\nprintf "Chromium fixture\\n"\n')
        self.executable("pnpm", '''#!/bin/sh
if [ "$1" = "--version" ]; then printf '11.25.0\\n'; exit 0; fi
printf '%s\\n' "$PWD" "$@" > "$(dirname "$0")/install-call"
mkdir node_modules
exit 0
''')
        self.env = {"PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
                    "MULAZAMA_CHROMIUM_EXECUTABLE_PATH": str(self.bin / "chromium"), "PW_CHANNEL": ""}

    def executable(self, name, text):
        path = self.bin / name
        path.write_text(text)
        path.chmod(0o755)

    def commit(self, message):
        git(self.seed, "add", ".")
        git(self.seed, "commit", "--message", message)
        return git(self.seed, "rev-parse", "HEAD")

    def run_bootstrap(self):
        with patch.dict(os.environ, self.env), contextlib.redirect_stdout(io.StringIO()):
            code = self.module.main()
        files = sorted(self.tasks.glob("*/evidence/result.json"))
        result = json.loads(files[-1].read_text())
        return code, result, files[-1].parent

    def refs(self):
        return git(self.source, "for-each-ref", "--format=%(refname) %(objectname)")

    def test_stale_snapshot_bootstraps_without_local_project_script(self):
        self.assertFalse((self.source / "scripts/cloud-start08a.py").exists())
        code, result, evidence = self.run_bootstrap()
        self.assertEqual(code, 0)
        self.assertEqual(result["head"], self.baseline)
        self.assertTrue(result["installSucceeded"])
        self.assertTrue(result["originalCheckoutPreserved"])
        self.assertIsNone(result["reusableEnvironmentPublished"])
        self.assertEqual(git(self.source, "rev-parse", "HEAD"), self.stale)
        self.assertFalse((self.source / "node_modules").exists())
        worktree = Path(result["workingDirectory"])
        self.assertEqual(git(worktree, "branch", "--show-current"), result["branch"])
        self.assertEqual(git(worktree, "for-each-ref", "--format=%(upstream)", "refs/heads/" + result["branch"]), "")
        install = (self.bin / "install-call").read_text().splitlines()
        self.assertEqual(install[:3], [str(worktree), "install", "--frozen-lockfile"])
        initial = json.loads((evidence / "initial-state.json").read_text())
        self.assertEqual(initial["head"], self.stale)
        self.assertFalse(initial["files"]["package.json"])
        events = [json.loads(line) for line in (evidence / "events.jsonl").read_text().splitlines()]
        install_events = [event for event in events if event["name"] == "frozen-install"]
        self.assertEqual([event["state"] for event in install_events], ["started", "finished"])

    def test_dirty_source_and_existing_branch_are_preserved(self):
        (self.source / "README.md").write_text("existing uncommitted work\n")
        (self.source / "untracked.txt").write_text("retain me\n")
        git(self.source, "branch", "codex/existing")
        before = self.module.original_state()
        code, result, _ = self.run_bootstrap()
        self.assertEqual(code, 0)
        after = self.module.original_state()
        for key in ("head", "branch", "status"):
            self.assertEqual(after[key], before[key])
        self.assertTrue(set(before["branches"].splitlines()).issubset(after["branches"].splitlines()))
        self.assertEqual((self.source / "README.md").read_text(), "existing uncommitted work\n")
        self.assertEqual((self.source / "untracked.txt").read_text(), "retain me\n")
        self.assertTrue(result["originalCheckoutPreserved"])

    def test_remote_history_rewrite_does_not_update_refs_or_install(self):
        git(self.source, "fetch", "origin", "main")
        (self.seed / "README.md").write_text("previously observed descendant\n")
        previous = self.commit("observed descendant")
        git(self.source, "fetch", str(self.seed), "main")
        git(self.source, "update-ref", "refs/remotes/origin/main", previous)
        # Remote remains on approved baseline, behind the observed tracking ref.
        before = self.refs()
        code, result, _ = self.run_bootstrap()
        self.assertEqual(code, 1)
        self.assertIn("ancestry failed", result["error"])
        self.assertEqual(self.refs(), before)
        self.assertFalse(result["installStarted"])
        self.assertFalse((self.bin / "install-call").exists())

    def test_wrong_origin_stops_before_fetch(self):
        self.module.OFFICIAL = "https://github.com/saraazamil-ui/mulazama"
        before = self.refs()
        code, result, evidence = self.run_bootstrap()
        self.assertEqual(code, 1)
        self.assertIn("Unexpected origin", result["error"])
        self.assertEqual(self.refs(), before)
        self.assertEqual((evidence / "events.jsonl").read_text(), "")

    def test_missing_lock_stops_before_install(self):
        (self.seed / "pnpm-lock.yaml").unlink()
        self.commit("incomplete fixture lock")
        git(self.seed, "push", "origin", "main")
        code, result, _ = self.run_bootstrap()
        self.assertEqual(code, 1)
        self.assertIn("pnpm-lock.yaml", result["error"])
        self.assertFalse(result["installStarted"])

    def test_missing_app_stops_before_install(self):
        (self.seed / "src/app.ts").unlink()
        self.commit("incomplete fixture application")
        git(self.seed, "push", "origin", "main")
        code, result, _ = self.run_bootstrap()
        self.assertEqual(code, 1)
        self.assertIn("incomplete: src", result["error"])
        self.assertFalse(result["installStarted"])

    def test_install_failure_is_recorded_and_checkout_retained(self):
        self.executable("pnpm", '#!/bin/sh\nif [ "$1" = "--version" ]; then printf "11.25.0\\n"; exit 0; fi\nexit 17\n')
        code, result, evidence = self.run_bootstrap()
        self.assertEqual(code, 1)
        self.assertTrue(result["installStarted"])
        self.assertFalse(result["installSucceeded"])
        self.assertIn("exit 17", result["error"])
        self.assertTrue(Path(result["workingDirectory"]).is_dir())
        events = [json.loads(line) for line in (evidence / "events.jsonl").read_text().splitlines()]
        self.assertEqual(events[-1]["exitCode"], 17)
        self.assertEqual(git(self.source, "rev-parse", "HEAD"), self.stale)

    def test_browser_channel_conflict_stops_before_install(self):
        self.env["PW_CHANNEL"] = "chrome"
        code, result, _ = self.run_bootstrap()
        self.assertEqual(code, 1)
        self.assertIn("Unset PW_CHANNEL", result["error"])
        self.assertFalse(result["installStarted"])

    def test_concurrent_tracking_change_does_not_install_pinned_old_head(self):
        (self.seed / "scripts/cloud-start08a.py").write_text(
            "import subprocess\nsubprocess.run(['git','update-ref','refs/remotes/origin/main','HEAD~1'], check=True)\n")
        self.commit("simulate concurrent tracking change")
        git(self.seed, "push", "origin", "main")
        code, result, _ = self.run_bootstrap()
        self.assertEqual(code, 1)
        self.assertIn("advanced during bootstrap", result["error"])
        self.assertFalse(result["installStarted"])

    def test_launcher_reuses_identical_bytes_and_preserves_different_file(self):
        target = self.root / "launcher/bootstrap.py"
        candidate = self.root / "candidate.py"
        candidate.write_text("print('original launcher')\n")
        installer = SCRIPT.read_text().split("<<'MULAZAMA_INSTALL_LAUNCHER_PY'\n", 1)[1].split("\nMULAZAMA_INSTALL_LAUNCHER_PY\n", 1)[0]
        installer = installer.replace("/workspace/mulazama-cloud09b/bootstrap.py", str(target))
        command = [self.module.sys.executable, "-c", installer, str(candidate)]
        first = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(first.returncode, 0, first.stderr)
        original = target.read_bytes()
        identical = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(identical.returncode, 0, identical.stderr)
        candidate.write_text("print('different launcher')\n")
        different = subprocess.run(command, capture_output=True, text=True)
        self.assertNotEqual(different.returncode, 0)
        self.assertIn("Preserved different existing launcher", different.stderr)
        self.assertEqual(target.read_bytes(), original)


if __name__ == "__main__":
    unittest.main(verbosity=2)
