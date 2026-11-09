#!/usr/bin/env python3
"""Verify a committed snapshot without rewriting the checkout's delivery evidence."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time


ROOT = Path(__file__).resolve().parent.parent
L4 = "docs/06l4/evidence/"
BLOCKED = {"content-byte-audit", "content-supplemental-audit", "release-gates"}
STEPS = [
    "typecheck", "unit", "source-context", "build", "offline-assets",
    "verify-build", "security-static", "reference-authentication", "fsrs-conformance",
    "content-tools", "content-byte-audit", "legacy-reader-compatibility",
    "content-supplemental-audit", "release-gates", "browser", "offline-browser",
    "deployment-browser", "content-browser", "journey-browser", "journey-offline-browser",
]
BROWSER_COUNTS = {
    "browser": 35, "offline-browser": 4, "deployment-browser": 3,
    "journey-browser": 12, "journey-offline-browser": 2,
}


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def evidence_files(snapshot):
    """Only these producers' outputs can become current-run evidence."""
    roots = [snapshot / L4, snapshot / "playwright-report"]
    roots.extend(snapshot.glob("test-results*"))
    for directory in roots:
        if directory.is_dir():
            for path in directory.rglob("*"):
                if path.is_file() and not any(
                    part.startswith("previous-final-run-") for part in path.parts
                ):
                    yield path


def signature(path):
    stat = path.stat()
    return (stat.st_ino, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_size)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="docs/08a/evidence")
    parser.add_argument("--cache-root", default="/tmp/mulazama-08a-cache")
    args = parser.parse_args()
    if git("status", "--porcelain=v1", "--untracked-files=no"):
        parser.error("Commit tracked changes first; verification archives committed HEAD only.")
    if Path(git("rev-parse", "--show-toplevel")) != ROOT:
        parser.error("Run from the MULAZAMA repository checkout.")
    commit = git("rev-parse", "HEAD")
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run = Path(tempfile.mkdtemp(prefix=stamp + "-" + commit[:12] + "-", dir=output))
    snapshot = Path(tempfile.mkdtemp(prefix="mulazama-08a-"))
    cache = Path(args.cache_root).resolve()
    for directory in ("pnpm-store", "pnpm-cache", "npm", "corepack"):
        (cache / directory).mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env.update({"CI": "true", "npm_config_cache": str(cache / "npm"),
                "COREPACK_HOME": str(cache / "corepack")})
    # Preserve the caller's explicit browser selection and inherited proxy/CA settings.
    # Do not change XDG_CACHE_HOME: that would relocate Playwright's browser cache.
    browser_selection = {key: env.get(key) for key in (
        "MULAZAMA_CHROMIUM_EXECUTABLE_PATH", "PW_CHANNEL", "PLAYWRIGHT_BROWSERS_PATH"
    )}
    records, copied, before = [], {}, {}
    summary = {
        "phase": "08-A", "startedAt": now(), "sourceCommit": commit,
        "snapshotDirectory": str(snapshot), "evidenceDirectory": str(run),
        "cacheRoot": str(cache), "browserSelection": browser_selection,
        "productionApproval": False, "scientificApproval": False,
        "note": "Only freshly written outputs are retained as this run's evidence; snapshot is preserved.",
    }

    def execute(name, command, cwd=snapshot):
        log = run / (name + ".log")
        started, clock = now(), time.monotonic()
        with log.open("w") as stream:
            try:
                result = subprocess.run(command, cwd=cwd, env=env,
                                        stdout=stream, stderr=subprocess.STDOUT)
                code = result.returncode
            except OSError as error:
                stream.write(str(error) + "\n")
                code = 127
        records.append({"name": name, "command": command, "cwd": str(cwd),
                        "startedAt": started, "finishedAt": now(),
                        "durationSeconds": round(time.monotonic() - clock, 3),
                        "exitCode": code, "log": log.name})
        write_json(run / "commands.json", records)
        print(f"{name}: exit {code}; {log}", flush=True)
        if code:
            raise RuntimeError(f"{name} failed with exit {code}; see {log.name}")
        return log.read_text()

    def collect():
        for source in evidence_files(snapshot):
            relative = source.relative_to(snapshot).as_posix()
            if before.get(relative) == signature(source):
                continue
            target = run / "artifacts" / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            copied[relative] = {"path": str(target.relative_to(run)),
                                "sha256": hashlib.sha256(target.read_bytes()).hexdigest()}
        write_json(run / "artifacts.json", copied)

    def fresh_json(relative):
        if relative not in copied:
            raise ValueError("Missing or stale result: " + relative)
        return json.loads((run / copied[relative]["path"]).read_text())

    errors = []
    try:
        execute("archive", ["git", "archive", "--format=tar", "--output=" + str(snapshot / "source.tar"), commit], ROOT)
        with tarfile.open(snapshot / "source.tar") as archive:
            archive.extractall(snapshot, filter="data")
        summary["versions"] = {
            "node": execute("node-version", ["node", "--version"]).strip(),
            "pnpm": execute("pnpm-version", ["pnpm", "--version"]).strip(),
            "python": execute("python-version", [sys.executable, "--version"]).strip(),
        }
        package = json.loads((snapshot / "package.json").read_text())
        summary["runtimeConstraints"] = {"engines": package["engines"], "packageManager": package["packageManager"]}
        node_major = re.fullmatch(r"v(\d+)\.\d+\.\d+", summary["versions"]["node"])
        if not node_major or int(node_major[1]) < 24:
            raise ValueError("Node.js 24 or newer is required.")
        if "pnpm@" + summary["versions"]["pnpm"] != package["packageManager"]:
            raise ValueError("pnpm version does not match packageManager in the committed snapshot.")
        digest = execute("source-digest", ["node", "--input-type=module", "-e",
            "import {computeReleaseSourceDigest} from './scripts/release-source-hash.mjs';"
            "console.log(JSON.stringify(await computeReleaseSourceDigest(process.cwd())));"])
        summary["source"] = json.loads(digest)
        execute("install", ["pnpm", "install", "--frozen-lockfile", "--store-dir", str(cache / "pnpm-store"),
                            "--cache-dir", str(cache / "pnpm-cache")])
        execute("startup-tests", [sys.executable, "scripts/tests/cloud-start08a.test.py"])
        execute("official-archive-tests", [sys.executable, "scripts/tests/inspect-official-archive10b.test.py"])
        execute("official-intake-tests", [sys.executable, "scripts/tests/receive-official-package10c.test.py"])
        execute("quranpedia-metadata-tests", [sys.executable, "scripts/tests/audit-quranpedia-metadata10d.test.py"])
        execute("svg-security-tests", [sys.executable, "scripts/tests/svg-security10d.test.py"])
        execute("quranpedia-archive-tests", [sys.executable, "scripts/tests/audit-quranpedia-archive10d.test.py"])
        execute("mushaf-offline-policy-tests", ["node", "--test", "scripts/tests/build-offline10c.test.mjs"])
        helper = execute("browser-helper-tests", ["node", "--test", "--test-reporter=tap",
                                                   "scripts/tests/playwright-browser.test.mjs"])
        helper_counts = {key: int(value) for key, value in re.findall(
            r"^# (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$", helper, re.M)}
        if not helper_counts.get("tests") or helper_counts.get("pass") != helper_counts["tests"] or any(
            helper_counts.get(key, -1) != 0 for key in ("fail", "cancelled", "skipped", "todo")
        ):
            raise ValueError("Browser helper tests incomplete, skipped, or failed: " + str(helper_counts))
        summary["browserHelperTests"] = helper_counts
        probe = execute("browser-version", ["node", "--input-type=module", "-e",
            "import {chromium} from '@playwright/test';"
            "import {chromiumLaunchOptions} from './scripts/playwright-browser.mjs';"
            "const options=chromiumLaunchOptions();const browser=await chromium.launch(options);"
            "try{console.log(JSON.stringify({version:browser.version(),selection:options,"
            "defaultExecutablePath:options.channel||options.executablePath?null:chromium.executablePath()}));}"
            "finally{await browser.close();}"])
        summary["browser"] = json.loads(probe)
        before = {path.relative_to(snapshot).as_posix(): signature(path) for path in evidence_files(snapshot)}
        execute("verify-06l4", [sys.executable, "scripts/verify-06l4.py", "--browser"])
        execute("mushaf-browser", ["pnpm", "test:mushaf"])
        execute("reader-preview-browser", ["pnpm", "test:reader-preview"])
        execute("reader-preview-build", ["pnpm", "build:reader-preview"])
    except (OSError, ValueError, RuntimeError, tarfile.TarError) as error:
        errors.append(str(error))
    finally:
        # Do not collect inherited reports when execution stopped before the runner.
        if before:
            collect()

    try:
        commands = fresh_json(L4 + "verification-commands.json")
        summary["verificationCommands"] = commands
        if [entry["name"] for entry in commands] != STEPS:
            raise ValueError("The required 20 verification commands were not all executed in order.")
        for entry in commands:
            expected = 2 if entry["name"] in BLOCKED else 0
            if entry["exitCode"] != expected:
                errors.append(f"{entry['name']}: exit {entry['exitCode']}, expected {expected}")
            if entry["name"] in BLOCKED and entry["result"] != "Blocked":
                errors.append(entry["name"] + " must remain Blocked, never Passed.")
        unit = fresh_json(L4 + "final-tests.json")
        summary["unit"] = {key: unit.get(key) for key in (
            "numTotalTests", "numPassedTests", "numFailedTests", "numPendingTests", "numTodoTests", "success")}
        if unit.get("success") is not True or unit.get("numTotalTests") != 998 or unit.get("numPassedTests") != 998 or any(
            unit.get(key) != 0 for key in ("numFailedTests", "numPendingTests", "numTodoTests")
        ):
            errors.append("Unit results must be exactly 998 passed, zero failed/skipped/todo.")
        mushaf = fresh_json("test-results-mushaf/mushaf-results.json")
        summary["mushafBrowser"] = mushaf.get("stats", {})
        if summary["mushafBrowser"].get("expected") != 10 or mushaf.get("errors") or any(
            summary["mushafBrowser"].get(key) != 0 for key in ("skipped", "unexpected", "flaky")
        ):
            errors.append("Mushaf browser: expected 10 passed, zero failed/skipped/flaky/errors.")
        preview = fresh_json("test-results-reader-preview/reader-preview-results.json")
        summary["readerPreviewBrowser"] = preview.get("stats", {})
        if summary["readerPreviewBrowser"].get("expected") != 15 or preview.get("errors") or any(
            summary["readerPreviewBrowser"].get(key) != 0 for key in ("skipped", "unexpected", "flaky")
        ):
            errors.append("Reader preview browser: expected 15 passed, zero failed/skipped/flaky/errors.")
        summary["browserSuites"] = {}
        for name, expected in BROWSER_COUNTS.items():
            data = fresh_json(L4 + "final-" + name + "-results.json")
            stats = data.get("stats", {})
            summary["browserSuites"][name] = stats
            if stats.get("expected") != expected or data.get("errors") or any(
                stats.get(key) != 0 for key in ("skipped", "unexpected", "flaky")
            ):
                errors.append(f"{name}: expected {expected} passed, zero failed/skipped/flaky/errors.")
        content = fresh_json(L4 + "historical-path-outputs/06l2/evidence/content-display/results.json")
        summary["contentDisplay"] = content.get("counts")
        if content.get("counts") != {"executed": 5, "passed": 5, "failed": 0, "skipped": 0}:
            errors.append("Content display must be exactly 5 passed, zero failed/skipped.")
        if content.get("humanScientificApproval") is not False or content.get("productSessionStarted") is not False:
            errors.append("Content display must remain review-only, without scientific approval.")
        byte_audit = fresh_json(L4 + "content-byte-audit.json")
        supplemental = fresh_json(L4 + "historical-path-outputs/06l2/evidence/content-supplemental-audit.json")
        if byte_audit.get("comparison", {}).get("status") != "blocked" or byte_audit.get("productionActivation") != "unavailable":
            errors.append("Content byte audit must retain its independent-reference block.")
        if supplemental.get("independentComparison", {}).get("status") != "blocked" or supplemental.get("productionActivation") is not False:
            errors.append("Supplemental content audit must remain blocked for production.")
        fsrs = fresh_json(L4 + "fsrs/fsrs-investigation.json")
        summary["fsrs"] = fsrs.get("summaries", {}).get("repairedAll")
        if summary["fsrs"] != {"passed": 40, "failed": 0, "blocked": 0}:
            errors.append("Corrected FSRS must pass all 40 cases.")
        gates = fresh_json(L4 + "release-gates.json")
        summary["productionReady"] = gates.get("productionReady")
        summary["gates"] = gates.get("gates")
        if gates.get("productionReady") is not False or len(gates.get("gates", [])) != 10 or {
            (gate.get("gate"), gate.get("status")) for gate in gates.get("gates", [])
        } != {(f"G{number:02}", "blocked") for number in range(1, 11)}:
            errors.append("productionReady must remain false and G01–G10 must all remain blocked.")
        if gates.get("context", {}).get("sourceDigest") != summary.get("source", {}).get("sourceDigest"):
            errors.append("Release-gate source digest does not match the verified snapshot.")
        tools = fresh_json(L4 + "content-tool-checks.json")
        if tools.get("passed") != 7 or tools.get("failed") != 0:
            errors.append("Content CLI checks must be 7 passed, zero failed.")
        reader = fresh_json(L4 + "fsrs-backward-reader.json")
        if reader.get("checksPassed") != 6 or any(reader.get(key) != 0 for key in ("checksFailed", "checksSkipped")):
            errors.append("Legacy reader checks must be 6 passed, zero failed/skipped.")
    except (OSError, ValueError, KeyError, TypeError) as error:
        errors.append(str(error))
    summary["checkoutPreserved"] = git("rev-parse", "HEAD") == commit and not git(
        "status", "--porcelain=v1", "--untracked-files=no")
    if not summary["checkoutPreserved"]:
        errors.append("Original checkout changed during verification; investigate before relying on results.")
    summary.update({"finishedAt": now(), "errors": errors,
                    "engineeringChecksPassed": not errors, "exitCode": 1 if errors else 0})
    write_json(run / "summary.json", summary)
    print(json.dumps({"summary": str(run / "summary.json"), "snapshot": str(snapshot),
                      "errors": errors, "productionReady": summary.get("productionReady")}, ensure_ascii=False), flush=True)
    return summary["exitCode"]


if __name__ == "__main__":
    raise SystemExit(main())
