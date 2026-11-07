#!/usr/bin/env bash
# Paste this entire file into the cloud environment's setup/start hook.
# It does not require any script to exist in the prepared repository snapshot.
set -eu
# Keep the candidate as evidence; never replace an existing launcher silently.
task_bootstrap_candidate="$(mktemp /tmp/mulazama-cloud09b-bootstrap.XXXXXX)"
cat > "$task_bootstrap_candidate" <<'MULAZAMA_BOOTSTRAP_PY'
import datetime
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid

OFFICIAL = "https://github.com/saraazamil-ui/mulazama"
BASELINE = "4bd359de434c6395f416388679adebe13128c8a0"
SOURCE = Path(os.environ.get("MULAZAMA_SOURCE_ROOT", "/workspace/mulazama")).resolve()
TASKS = Path(os.environ.get("MULAZAMA_TASKS_ROOT", "/workspace/mulazama-tasks")).resolve()
TRACKING = "refs/remotes/origin/main"


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()


def original_state():
    return {"head": git(SOURCE, "rev-parse", "HEAD"),
            "branch": git(SOURCE, "branch", "--show-current"),
            "status": git(SOURCE, "status", "--porcelain=v1"),
            "branches": git(SOURCE, "for-each-ref", "--format=%(refname) %(objectname)", "refs/heads/")}


def main():
    if TASKS == SOURCE or SOURCE in TASKS.parents:
        raise RuntimeError("MULAZAMA_TASKS_ROOT must be outside the original checkout.")
    run_id = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:12]
    run = TASKS / run_id
    evidence = run / "evidence"
    evidence.mkdir(parents=True, exist_ok=False)
    worktree = run / "repo"
    branch = "codex/cloud-09b-" + run_id
    result = {"schemaVersion": 1, "runId": run_id, "startedAt": now(),
              "sourceDirectory": str(SOURCE), "workingDirectory": str(worktree),
              "evidenceDirectory": str(evidence), "branch": branch,
              "invocationProvenance": "unattested; correlate with this task's platform hook log",
              "reusableEnvironmentPublished": None, "environmentPublication": "not-observed-by-bootstrap",
              "installStarted": False,
              "installSucceeded": False, "status": "failed"}
    sequence = 0
    events = (evidence / "events.jsonl").open("x")

    def execute(name, command, cwd=SOURCE, env=None):
        nonlocal sequence
        sequence += 1
        log = evidence / f"{sequence:02}-{name}.log"
        record = {"name": name, "command": command, "cwd": str(cwd), "startedAt": now(), "log": log.name}
        events.write(json.dumps({**record, "state": "started"}) + "\n")
        events.flush()
        with log.open("x") as stream:
            try:
                completed = subprocess.run(command, cwd=cwd, env=env, stdout=stream, stderr=subprocess.STDOUT)
                record["exitCode"] = completed.returncode
            except OSError as error:
                stream.write(str(error) + "\n")
                record["exitCode"] = 127
        record["finishedAt"] = now()
        events.write(json.dumps({**record, "state": "finished"}) + "\n")
        events.flush()
        if record["exitCode"]:
            raise RuntimeError(f"{name} failed (exit {record['exitCode']}); see {log}")
        return log.read_text().strip()

    try:
        if Path(git(SOURCE, "rev-parse", "--show-toplevel")).resolve() != SOURCE:
            raise RuntimeError("Source must be the root of an existing Git checkout.")
        if git(SOURCE, "remote", "get-url", "origin").removesuffix(".git") != OFFICIAL:
            raise RuntimeError("Unexpected origin; no repository references were changed.")
        before = original_state()
        previous = git(SOURCE, "rev-parse", "--verify", TRACKING + "^{commit}")
        initial = {**before, "origin": OFFICIAL, "originMain": previous, "capturedAt": now(),
                   "files": {name: (SOURCE / name).exists() for name in
                             ("package.json", "pnpm-lock.yaml", "src", "scripts/cloud-start08a.py")}}
        with (evidence / "initial-state.json").open("x") as stream:
            json.dump(initial, stream, indent=2)
        result["initialHead"] = before["head"]
        # Fetch into FETCH_HEAD only. Even without '+', remote-tracking refs
        # can otherwise move backwards; validate ancestry before updating them.
        execute("fetch-main", ["git", "fetch", "--no-tags", "--refmap=", "origin", "refs/heads/main"])
        revision = git(SOURCE, "rev-parse", "--verify", "FETCH_HEAD^{commit}")
        result["fetchedMain"] = revision
        for ancestor in (BASELINE, previous):
            execute("ancestry", ["git", "merge-base", "--is-ancestor", ancestor, revision])
        execute("update-tracking", ["git", "update-ref", TRACKING, revision, previous])
        execute("create-worktree", ["git", "worktree", "add", "--no-track", "-b", branch, str(worktree), revision])
        for name in ("package.json", "pnpm-lock.yaml", "scripts/cloud-start08a.py"):
            if not (worktree / name).is_file():
                raise RuntimeError("Fetched source is incomplete: " + name)
        if not (worktree / "src").is_dir() or not any((worktree / "src").iterdir()):
            raise RuntimeError("Fetched source is incomplete: src")
        execute("project-startup-check", [sys.executable, "scripts/cloud-start08a.py", "--check"], worktree)
        if git(worktree, "rev-parse", "HEAD") != git(worktree, "rev-parse", TRACKING) or git(worktree, "rev-parse", "HEAD") != revision:
            raise RuntimeError("main advanced during bootstrap; preserve this run and retry before installing.")
        package = json.loads((worktree / "package.json").read_text())
        node = execute("node-version", ["node", "--version"], worktree)
        pnpm = execute("pnpm-version", ["pnpm", "--version"], worktree)
        python = execute("python-version", [sys.executable, "--version"], worktree)
        if not re.fullmatch(r"v\d+\.\d+\.\d+", node) or int(node[1:].split(".")[0]) < 24:
            raise RuntimeError("Node.js 24+ is required.")
        if package.get("packageManager") != "pnpm@" + pnpm:
            raise RuntimeError("pnpm must exactly match packageManager in fetched package.json.")
        if os.environ.get("PW_CHANNEL"):
            raise RuntimeError("Unset PW_CHANNEL when selecting an explicit Chromium executable.")
        browser = Path(os.environ.get("MULAZAMA_CHROMIUM_EXECUTABLE_PATH", "/usr/bin/chromium"))
        if not browser.is_absolute() or not browser.is_file() or not os.access(browser, os.X_OK):
            raise RuntimeError("An absolute executable Chromium path is required.")
        browser_version = execute("chromium-version", [str(browser), "--version"], worktree)
        result["versions"] = {"node": node, "pnpm": pnpm, "python": python, "chromium": browser_version}
        cache = run / "cache"
        env = os.environ.copy()
        env.update({"CI": "true", "MULAZAMA_CHROMIUM_EXECUTABLE_PATH": str(browser),
                    "npm_config_cache": str(cache / "npm"), "COREPACK_HOME": str(cache / "corepack")})
        result["installStarted"] = True
        execute("frozen-install", ["pnpm", "install", "--frozen-lockfile", "--store-dir", str(cache / "pnpm-store"),
                                  "--cache-dir", str(cache / "pnpm-cache")], worktree, env)
        result["installSucceeded"] = True
        after = original_state()
        old_branches = set(before["branches"].splitlines())
        result["originalCheckoutPreserved"] = all(before[key] == after[key] for key in ("head", "branch", "status")) and old_branches.issubset(after["branches"].splitlines())
        if not result["originalCheckoutPreserved"]:
            raise RuntimeError("Original checkout changed concurrently; inspect the saved initial state.")
        result["head"] = git(worktree, "rev-parse", "HEAD")
        result["status"] = "ready"
    except (OSError, RuntimeError, ValueError, subprocess.CalledProcessError) as error:
        result["error"] = str(error)
    finally:
        result["finishedAt"] = now()
        events.close()
        with (evidence / "result.json").open("x") as stream:
            json.dump(result, stream, indent=2)
            stream.write("\n")
        print(json.dumps(result, indent=2), flush=True)
        if result["status"] == "ready":
            print("MULAZAMA_WORKTREE=" + str(worktree), flush=True)
        print("MULAZAMA_BOOTSTRAP_EVIDENCE=" + str(evidence), flush=True)
    return 0 if result["status"] == "ready" else 1


if __name__ == "__main__":
    raise SystemExit(main())
MULAZAMA_BOOTSTRAP_PY
python3 - "$task_bootstrap_candidate" <<'MULAZAMA_INSTALL_LAUNCHER_PY'
from pathlib import Path
import sys

candidate = Path(sys.argv[1]).read_bytes()
target = Path("/workspace/mulazama-cloud09b/bootstrap.py")
target.parent.mkdir(parents=True, exist_ok=True)
if target.is_symlink():
    raise SystemExit("Preserved existing launcher symlink; inspect it before setup.")
try:
    with target.open("xb") as stream:
        stream.write(candidate)
except FileExistsError:
    if target.read_bytes() != candidate:
        raise SystemExit("Preserved different existing launcher: " + str(target) + "; review it and the candidate " + sys.argv[1])
print("MULAZAMA_BOOTSTRAP_LAUNCHER=" + str(target), flush=True)
MULAZAMA_INSTALL_LAUNCHER_PY
python3 /workspace/mulazama-cloud09b/bootstrap.py
