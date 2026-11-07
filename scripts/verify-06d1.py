#!/usr/bin/env python3
"""Reproducible verification receipts; expected blocked gates are not passes."""
import argparse
import datetime
import json
import os
from pathlib import Path
import subprocess
import time

parser = argparse.ArgumentParser()
parser.add_argument('--node', default='node')
parser.add_argument('--browser', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
out = root / 'docs/06d1/evidence'
out.mkdir(parents=True, exist_ok=True)
env = os.environ.copy()
if Path(args.node).is_absolute():
    env['PATH'] = str(Path(args.node).parent) + os.pathsep + env.get('PATH', '')
steps = [
    ('typecheck', ['node_modules/typescript/bin/tsc', '-b']),
    ('unit', ['node_modules/vitest/vitest.mjs', 'run', '--reporter=json', '--outputFile=docs/06d1/evidence/final-tests.json']),
    ('source-context', ['scripts/generate-release-context.mjs']),
    ('build', ['node_modules/vite/bin/vite.js', 'build']),
    ('offline-assets', ['scripts/build-offline.mjs']),
    ('verify-build', ['scripts/verify-build.mjs']),
    ('security-static', ['scripts/security-check.mjs']),
    ('fsrs-selected', ['scripts/fsrs-conformance.mjs', '--reference', 'references/ts-fsrs-5.4.2-verified/package', '--receipt', 'references/ts-fsrs-5.4.2-verified/receipt.json', '--output', 'docs/06d1/evidence/fsrs-selected.json']),
    ('fsrs-candidate', ['scripts/fsrs-conformance.mjs', '--reference', 'references/ts-fsrs-5.4.2-verified/package', '--receipt', 'references/ts-fsrs-5.4.2-verified/receipt.json', '--rounded-candidate', '--output', 'docs/06d1/evidence/fsrs-candidate.json']),
    # 05-C is the unchanged approval policy being evaluated, not the delivery phase.
    ('release-gates', ['scripts/verify-release.mjs', '--phase', '05-C', '--output', 'docs/06d1/evidence/release-gates.json']),
]
if args.browser:
    steps += [
        ('browser', ['node_modules/@playwright/test/cli.js', 'test']),
        ('offline-browser', ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.offline.config.ts']),
    ]
records = []
for name, command in steps:
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    start = time.monotonic()
    path = out / ('final-' + name + '.log')
    with path.open('w') as log:
        result = subprocess.run([args.node, *command], cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT)
    records.append({'name': name, 'command': ['node', *command], 'startedAt': started,
                    'durationSeconds': round(time.monotonic()-start, 3), 'exitCode': result.returncode,
                    'log': path.name, 'result': 'Blocked' if name == 'release-gates' and result.returncode == 2 else 'Passed' if result.returncode == 0 else 'Failed'})
    (out / 'verification-commands.json').write_text(json.dumps(records, indent=2) + '\n')
    print(name + ': exit ' + str(result.returncode), flush=True)
    if name in ['typecheck', 'unit', 'build', 'verify-build'] and result.returncode:
        raise SystemExit(result.returncode)
if any(r['exitCode'] and r['name'] not in ['fsrs-selected', 'release-gates'] for r in records):
    raise SystemExit(1)
