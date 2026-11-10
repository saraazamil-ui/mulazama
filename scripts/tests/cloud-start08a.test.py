#!/usr/bin/env python3
"""Exercise startup against local Git repositories without contacting GitHub."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "cloud-start08a.py"


def git(directory, *args):
    return subprocess.check_output(
        ["git", "-C", str(directory), *args], text=True, stderr=subprocess.PIPE
    ).strip()


class CloudStartTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="mulazama-start-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.remote = self.root / "official.git"
        self.seed = self.root / "seed"
        self.checkout = self.root / "checkout"
        self.seed.mkdir()
        git(self.root, "init", "--bare", "--initial-branch=main", str(self.remote))
        git(self.seed, "init", "--initial-branch=main")
        git(self.seed, "config", "user.name", "Startup fixture")
        git(self.seed, "config", "user.email", "startup@example.invalid")
        self.baseline = self.commit("baseline")
        git(self.seed, "remote", "add", "origin", str(self.remote))
        git(self.seed, "push", "origin", "main")
        git(self.root, "clone", str(self.remote), str(self.checkout))
        git(self.checkout, "switch", "--create", "work")
        specification = importlib.util.spec_from_file_location("cloud_start08a", SCRIPT)
        self.module = importlib.util.module_from_spec(specification)
        with patch.object(sys, "dont_write_bytecode", True):
            specification.loader.exec_module(self.module)
        self.module.ROOT = self.checkout
        self.module.OFFICIAL = str(self.remote).removesuffix(".git")
        self.module.BASELINE = self.baseline

    def commit(self, text):
        (self.seed / "tracked.txt").write_text(text + "\n")
        git(self.seed, "add", "tracked.txt")
        git(self.seed, "commit", "--message", text)
        return git(self.seed, "rev-parse", "HEAD")

    def advance(self, text):
        revision = self.commit(text)
        git(self.seed, "push", "origin", "main")
        return revision

    def refs(self, prefix="refs/"):
        return dict(
            line.split(" ", 1)
            for line in git(self.checkout, "for-each-ref", "--format=%(refname) %(objectname)", prefix).splitlines()
        )

    def run_start(self, *arguments):
        output = io.StringIO()
        with patch.object(sys, "argv", [str(SCRIPT), *arguments]), contextlib.redirect_stdout(output):
            self.module.main()
        return json.loads(output.getvalue())

    def test_fast_forward_creates_new_branch_and_preserves_existing_branches(self):
        original_branches = self.refs("refs/heads/")
        revision = self.advance("fast forward")
        result = self.run_start("--branch", "codex/new-task")
        self.assertEqual(result["officialMain"], revision)
        self.assertEqual(result["head"], revision)
        self.assertEqual(result["branch"], "codex/new-task")
        self.assertFalse(result["checkOnly"])
        self.assertFalse(result["reusableEnvironmentPublished"])
        branches = self.refs("refs/heads/")
        self.assertEqual(branches.pop("refs/heads/codex/new-task"), revision)
        self.assertEqual(branches, original_branches)
        self.assertEqual(git(self.checkout, "rev-parse", "origin/main"), revision)
        self.assertEqual(git(self.checkout, "status", "--porcelain=v1"), "")

    def test_dirty_tree_is_refused_before_fetch_and_preserves_work(self):
        self.advance("remote advance")
        original_refs = self.refs()
        (self.checkout / "tracked.txt").write_text("uncommitted work\n")
        with self.assertRaisesRegex(SystemExit, "not clean"):
            self.run_start("--branch", "codex/dirty-task")
        self.assertEqual(self.refs(), original_refs)
        self.assertEqual(git(self.checkout, "branch", "--show-current"), "work")
        self.assertEqual((self.checkout / "tracked.txt").read_text(), "uncommitted work\n")
        self.assertFalse((self.checkout / ".git" / "FETCH_HEAD").exists())

    def test_missing_tracking_ref_is_initialized_without_changing_existing_branches(self):
        git(self.checkout, "update-ref", "-d", "refs/remotes/origin/main", self.baseline)
        original_branches = self.refs("refs/heads/")
        revision = self.advance("new main for prepared checkout")
        result = self.run_start("--branch", "codex/prepared-task")
        self.assertTrue(result["initializedTrackingRef"])
        self.assertEqual(result["officialMain"], revision)
        self.assertEqual(result["head"], revision)
        self.assertEqual(result["branch"], "codex/prepared-task")
        self.assertEqual(git(self.checkout, "rev-parse", "origin/main"), revision)
        branches = self.refs("refs/heads/")
        self.assertEqual(branches.pop("refs/heads/codex/prepared-task"), revision)
        self.assertEqual(branches, original_branches)
        self.assertEqual(git(self.checkout, "status", "--porcelain=v1"), "")

    def test_missing_tracking_ref_does_not_discard_divergent_checkout_history(self):
        previous = self.advance("prepared checkout history")
        git(self.checkout, "fetch", "origin")
        git(self.checkout, "merge", "--ff-only", "origin/main")
        git(self.checkout, "update-ref", "-d", "refs/remotes/origin/main", previous)
        original_refs = self.refs()
        git(self.seed, "switch", "--detach", self.baseline)
        rewritten = self.commit("replacement main")
        git(self.remote, "fetch", str(self.seed), "HEAD")
        git(self.remote, "update-ref", "refs/heads/main", rewritten, previous)
        with self.assertRaisesRegex(SystemExit, "does not contain the current checkout history"):
            self.run_start("--branch", "codex/divergent-task")
        self.assertEqual(self.refs(), original_refs)
        self.assertEqual(git(self.checkout, "branch", "--show-current"), "work")
        self.assertEqual(git(self.checkout, "rev-parse", "HEAD"), previous)

    def test_missing_tracking_ref_initialization_rejects_concurrent_creation(self):
        git(self.checkout, "update-ref", "-d", "refs/remotes/origin/main", self.baseline)
        revision = self.advance("concurrent remote advance")
        original_branches = self.refs("refs/heads/")
        real_run = subprocess.run

        def create_tracking_ref_before_compare_and_swap(command, *args, **kwargs):
            if command[:3] == ["git", "update-ref", "refs/remotes/origin/main"]:
                real_run(["git", "update-ref", "refs/remotes/origin/main", self.baseline],
                         cwd=self.checkout, check=True)
            return real_run(command, *args, **kwargs)

        with patch.object(self.module.subprocess, "run", side_effect=create_tracking_ref_before_compare_and_swap):
            with self.assertRaises(subprocess.CalledProcessError):
                self.run_start("--branch", "codex/concurrent-task")
        self.assertEqual(git(self.checkout, "rev-parse", "FETCH_HEAD"), revision)
        self.assertEqual(git(self.checkout, "rev-parse", "origin/main"), self.baseline)
        self.assertEqual(self.refs("refs/heads/"), original_branches)
        self.assertEqual(git(self.checkout, "branch", "--show-current"), "work")

    def test_rewritten_main_with_approved_baseline_keeps_all_existing_refs(self):
        previous = self.advance("first descendant")
        checked = self.run_start("--check")
        self.assertTrue(checked["checkOnly"])
        self.assertEqual(checked["branch"], "work")
        self.assertEqual(checked["head"], self.baseline)
        original_refs = self.refs()
        # Simulate a remote rewrite entirely inside this temporary fixture.
        git(self.seed, "switch", "--detach", self.baseline)
        rewritten = self.commit("different descendant")
        git(self.remote, "fetch", str(self.seed), "HEAD")
        git(self.remote, "update-ref", "refs/heads/main", rewritten, previous)
        self.assertEqual(git(self.seed, "merge-base", self.baseline, rewritten), self.baseline)
        with self.assertRaisesRegex(SystemExit, "rewrites the previously observed"):
            self.run_start("--branch", "codex/rewrite-task")
        self.assertEqual(git(self.checkout, "rev-parse", "FETCH_HEAD"), rewritten)
        self.assertEqual(self.refs(), original_refs)
        self.assertEqual(git(self.checkout, "branch", "--show-current"), "work")
        self.assertEqual(git(self.checkout, "rev-parse", "HEAD"), self.baseline)

    def test_unexpected_remote_is_refused_without_changing_refs(self):
        original_refs = self.refs()
        self.module.OFFICIAL = "https://github.com/saraazamil-ui/mulazama"
        with self.assertRaisesRegex(SystemExit, "Unexpected origin"):
            self.run_start("--check")
        self.assertEqual(self.refs(), original_refs)
        self.assertFalse((self.checkout / ".git" / "FETCH_HEAD").exists())

    def test_existing_branch_is_preserved_and_refused_before_fetch(self):
        git(self.checkout, "branch", "codex/existing")
        original_refs = self.refs()
        with self.assertRaisesRegex(SystemExit, "Branch already exists"):
            self.run_start("--branch", "codex/existing")
        self.assertEqual(self.refs(), original_refs)
        self.assertEqual(git(self.checkout, "branch", "--show-current"), "work")
        self.assertFalse((self.checkout / ".git" / "FETCH_HEAD").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
