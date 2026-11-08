#!/usr/bin/env python3
"""Fetch official main and create a new task branch without resetting existing work."""
import argparse
import json
import subprocess
from pathlib import Path

OFFICIAL = "https://github.com/saraazamil-ui/mulazama"
BASELINE = "1da475029d414764cec2307935aa9f9d5b9afcd6"
ROOT = Path(__file__).resolve().parent.parent


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--branch", help="New, unused codex/<task> branch")
    action.add_argument("--check", action="store_true", help="Fetch and check only; keep the current branch")
    args = parser.parse_args()
    if Path(git("rev-parse", "--show-toplevel")) != ROOT:
        raise SystemExit("Run from the official repository checkout, not an archive.")
    remote = git("remote", "get-url", "origin").removesuffix(".git")
    if remote != OFFICIAL:
        raise SystemExit("Unexpected origin; no Git references were changed.")
    if git("status", "--porcelain=v1"):
        raise SystemExit("Working tree is not clean. Preserve and review existing work before starting a task.")
    if args.branch:
        if not args.branch.startswith("codex/"):
            raise SystemExit("A separate codex/<task> branch is required; main is never checked out or changed.")
        git("check-ref-format", "--branch", args.branch)
        exists = subprocess.run(["git", "show-ref", "--verify", "--quiet", "refs/heads/" + args.branch], cwd=ROOT)
        if exists.returncode != 1:
            raise SystemExit("Branch already exists or could not be checked; choose a new name.")
    tracking_ref = "refs/remotes/origin/main"
    tracking = subprocess.run(["git", "show-ref", "--verify", "--quiet", tracking_ref], cwd=ROOT)
    if tracking.returncode not in (0, 1):
        raise SystemExit("Could not inspect origin/main. Existing references were preserved.")
    previous = git("rev-parse", "--verify", tracking_ref + "^{commit}") if tracking.returncode == 0 else None
    # Prepared cloud checkouts can retain HEAD without any remote-tracking refs.
    # In that case require the fetched main to include this checkout's history;
    # do not silently move away from an unmerged or rewritten local snapshot.
    observed = previous or git("rev-parse", "--verify", "HEAD^{commit}")
    # Git allows non-fast-forward updates to refs/remotes even without '+'.
    # An empty refmap fetches only into FETCH_HEAD, leaving tracking refs intact
    # until both ancestry checks have passed, including first-time initialization.
    subprocess.run(["git", "fetch", "--no-tags", "--refmap=", "origin", "refs/heads/main"], cwd=ROOT, check=True)
    revision = git("rev-parse", "--verify", "FETCH_HEAD^{commit}")
    for ancestor, message in (
        (BASELINE, "Fetched main does not contain the approved 06-L4 ancestor."),
        (observed, "Fetched main rewrites the previously observed origin/main history." if previous else
                   "Fetched main does not contain the current checkout history; origin/main was not initialized."),
    ):
        result = subprocess.run(["git", "merge-base", "--is-ancestor", ancestor, revision], cwd=ROOT)
        if result.returncode:
            raise SystemExit(message + " Existing branch and tracking references were preserved.")
    # Compare-and-swap rejects concurrent changes or creation of the tracking ref.
    subprocess.run(["git", "update-ref", tracking_ref, revision, previous or "0" * len(revision)], cwd=ROOT, check=True)
    if args.branch:
        subprocess.run(["git", "switch", "--create", args.branch, "--no-track", revision], cwd=ROOT, check=True)
    print(json.dumps({"officialMain": revision, "requiredAncestor": BASELINE,
                      "branch": git("branch", "--show-current"), "head": git("rev-parse", "HEAD"),
                      "checkOnly": args.check, "initializedTrackingRef": previous is None,
                      "reusableEnvironmentPublished": False}, indent=2))


if __name__ == "__main__":
    main()
