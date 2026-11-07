#!/usr/bin/env python3
"""Run actual L1 checks, preserve prior delivery evidence, and retain every exit code."""
import argparse, datetime, json, os, subprocess, time
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('--node',default='node'); parser.add_argument('--browser',action='store_true')
a=parser.parse_args(); root=Path(__file__).resolve().parent.parent; out=root/'docs/06l1/evidence';out.mkdir(parents=True,exist_ok=True)
env=os.environ.copy()
if Path(a.node).is_absolute():env['PATH']=str(Path(a.node).parent)+os.pathsep+env.get('PATH','')
# Earlier tests emit historical-path reports. Keep their new evidence under L1,
# then restore the exact original delivery bytes, including on failure.
history={p:p.read_bytes() for p in (root/'docs').rglob('*') if p.is_file() and p.relative_to(root/'docs').parts[0]!='06l1'}
steps=[('typecheck',['node_modules/typescript/bin/tsc','-b']),
 ('unit',['node_modules/vitest/vitest.mjs','run','--maxWorkers=4','--reporter=json','--outputFile=docs/06l1/evidence/final-tests.json']),
 ('source-context',['scripts/generate-release-context.mjs']),('build',['node_modules/vite/bin/vite.js','build']),
 ('offline-assets',['scripts/build-offline.mjs']),('verify-build',['scripts/verify-build.mjs']),
 ('security-static',['scripts/security-check.mjs']),('reference-authentication',['scripts/verify-fsrs-reference-06e1.mjs']),
 ('fsrs-conformance',['scripts/fsrs-06e1-investigation.mjs','--probe-module','src/conformance/fsrs-reference-probe.ts','--output-dir','docs/06l1/evidence/fsrs']),
 ('release-gates',['scripts/verify-release.mjs','--phase','05-C','--output','docs/06l1/evidence/release-gates.json'])]
if a.browser:steps += [('browser',['node_modules/@playwright/test/cli.js','test']),('offline-browser',['node_modules/@playwright/test/cli.js','test','--config','playwright.offline.config.ts'])]
records=[]
try:
 for name,command in steps:
  started=datetime.datetime.now(datetime.timezone.utc).isoformat();start=time.monotonic()
  with (out/('final-'+name+'.log')).open('w') as log:
   result=subprocess.run([a.node,*command],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
  records.append({'name':name,'command':['node',*command],'startedAt':started,'durationSeconds':round(time.monotonic()-start,3),
    'exitCode':result.returncode,'result':'Blocked' if name=='release-gates' and result.returncode==2 else 'Passed' if result.returncode==0 else 'Failed', 'log':'final-'+name+'.log'})
  if name in ('browser','offline-browser'):
   source=root/('test-results/browser-results.json' if name=='browser' else 'test-results-offline/offline-results.json')
   if source.exists():(out/('final-'+name+'-results.json')).write_bytes(source.read_bytes())
  (out/'verification-commands.json').write_text(json.dumps(records,indent=2)+'\n')
  print(name+': exit '+str(result.returncode),flush=True)
  if result.returncode and name in ('typecheck','unit','source-context','build','offline-assets','verify-build','reference-authentication','fsrs-conformance'):break
finally:
 changed=[]
 for p,original in history.items():
  if p.exists() and p.read_bytes()!=original:
   relative=p.relative_to(root/'docs');target=out/'historical-path-outputs'/relative;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(p.read_bytes());p.write_bytes(original);changed.append(str(relative))
 (out/'historical-evidence-preservation.json').write_text(json.dumps({'restoredOriginalFiles':changed,'note':'Fresh outputs retained under historical-path-outputs; prior reports remain historical.'},indent=2)+'\n')
failed=any(r['exitCode'] and not(r['name']=='release-gates' and r['exitCode']==2) for r in records)
if failed:raise SystemExit(1)
