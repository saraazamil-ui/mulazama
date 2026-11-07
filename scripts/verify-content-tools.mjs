import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const output = resolve(process.argv[2] ?? 'docs/05b/evidence/content-tool-checks.json');
const dir = await mkdtemp(join(tmpdir(), 'mulazama-content-tools-'));
const checks = [];
function run(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  if (result.error) throw result.error;
  return { exitCode: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}
try {
  const source = Buffer.from('# SYNTHETIC NON-QURAN TOOL FIXTURE\r\n1|1|SYNTHETIC_A\r\n');
  const path = join(dir, 'synthetic.txt'), receipt = join(dir, 'receipt.json'), destination = join(dir, 'quarantine');
  await writeFile(path, source);
  await writeFile(receipt, JSON.stringify({ schemaVersion: 1, publisher: 'SYNTHETIC TEST ONLY', sourceUrl: 'https://example.invalid/synthetic', version: 'test/1', downloadedAt: '2026-11-05T00:00:00Z' }));
  const imported = run('scripts/import-quran-candidate.mjs', ['--input', path, '--receipt', receipt, '--destination', destination]);
  assert.equal(imported.exitCode, 0); assert.deepEqual(await readFile(join(destination, 'publisher-source.bin')), source);
  const storedReceipt = JSON.parse(await readFile(join(destination, 'download-receipt.json'), 'utf8'));
  assert.equal(storedReceipt.sha256, createHash('sha256').update(source).digest('hex')); assert.equal(storedReceipt.importStatus, 'quarantined-not-approved');
  checks.push({ id: 'QCLI01', status: 'passed', evidence: 'Exact-byte synthetic quarantine copy and independently calculated node:crypto SHA-256 match.' });

  const duplicate = run('scripts/import-quran-candidate.mjs', ['--input', path, '--receipt', receipt, '--destination', destination]);
  assert.notEqual(duplicate.exitCode, 0); assert.deepEqual(await readFile(join(destination, 'publisher-source.bin')), source);
  checks.push({ id: 'QCLI02', status: 'passed', evidence: 'Existing quarantine destination rejected; original bytes unchanged.' });

  const badPath = join(dir, 'invalid-utf8.bin'); await writeFile(badPath, new Uint8Array([0xC0, 0xAF]));
  assert.notEqual(run('scripts/import-quran-candidate.mjs', ['--input', badPath, '--receipt', receipt, '--destination', join(dir, 'bad-quarantine')]).exitCode, 0);
  checks.push({ id: 'QCLI03', status: 'passed', evidence: 'Malformed UTF-8 candidate rejected.' });

  const blockedPath = join(dir, 'blocked.json');
  const blocked = run('scripts/audit-quran-content.mjs', ['--request', 'content/audit-request.draft.json', '--output', blockedPath]);
  assert.equal(blocked.exitCode, 2); assert.equal(JSON.parse(await readFile(blockedPath, 'utf8')).primary.structuralStatus, 'blocked');
  checks.push({ id: 'QCLI04', status: 'passed', evidence: 'Absent real publisher bytes report blocked, exit 2, no fabricated hash.' });

  const profile = { schemaVersion: 1, editionId: 'synthetic-non-quran', numbering: 'synthetic', basmalaPolicy: 'not-applicable', expectedAyahsPerSurah: [1], testOnly: true,
    provenance: { publisher: 'Synthetic numbering fixture', url: 'https://example.invalid/profile', version: '1', documentSha256: 'a'.repeat(64) } };
  await writeFile(join(dir, 'profile.json'), JSON.stringify(profile));
  const primary = { sourcePath: 'synthetic.txt', profilePath: 'profile.json', expectedSha256: storedReceipt.sha256,
    provenance: { publisher: 'Synthetic A', url: 'https://example.invalid/a', version: '1', lineageId: 'synthetic-a' } };
  const request = { schemaVersion: 1, primary, reference: { ...primary, provenance: { publisher: 'Synthetic B', url: 'https://example.invalid/b', version: '1', lineageId: 'synthetic-b' } } };
  const requestPath = join(dir, 'request.json'), reportPath = join(dir, 'audit.json'); await writeFile(requestPath, JSON.stringify(request));
  assert.equal(run('scripts/audit-quran-content.mjs', ['--request', requestPath, '--output', reportPath]).exitCode, 0);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.primary.testOnly, true); assert.equal(report.primary.sourceTextOmittedFromReport, true); assert.equal(report.productionActivation, 'unavailable');
  checks.push({ id: 'QCLI05', status: 'passed', evidence: 'Synthetic exact comparison runs end to end; output remains unavailable for production and omits text.' });

  request.primary.expectedSha256 = '0'.repeat(64); await writeFile(requestPath, JSON.stringify(request));
  assert.equal(run('scripts/audit-quran-content.mjs', ['--request', requestPath, '--output', reportPath]).exitCode, 1);
  assert.equal(JSON.parse(await readFile(reportPath, 'utf8')).primary.checks.hash, 'failed');
  checks.push({ id: 'QCLI06', status: 'passed', evidence: 'Pinned hash mismatch fails CLI, exit 1.' });

  request.primary.sourcePath = 'not-downloaded.txt'; await writeFile(requestPath, JSON.stringify(request));
  assert.equal(run('scripts/audit-quran-content.mjs', ['--request', requestPath, '--output', reportPath]).exitCode, 2);
  const absent = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(absent.primary.structuralStatus, 'blocked'); assert.ok(absent.primary.issues.some(x => x.code === 'CONFIGURED_ARTIFACT_MISSING'));
  checks.push({ id: 'QCLI07', status: 'passed', evidence: 'Configured-but-missing source produces a reviewable blocked report rather than a content success.' });
  await writeFile(output, JSON.stringify({ product: 'MULAZAMA', generatedAt: new Date().toISOString(), fixture: 'SYNTHETIC-NON-QURAN; no scientific content validation',
    node: process.version, checks, passed: checks.length, failed: 0 }, null, 2) + '\n');
  console.log(JSON.stringify({ passed: checks.length, failed: 0, output }));
} finally { await rm(dir, { recursive: true, force: true }); }
