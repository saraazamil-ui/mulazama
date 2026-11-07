import { readFile, writeFile, rename, stat, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { loadContentAudit } from './content-audit-loader.mjs';

const args = process.argv.slice(2);
function option(name) { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; }
const requestPath = option('--request'), outputPath = option('--output');
if (!requestPath || !outputPath || args.length !== 4) {
  console.error('Usage: node scripts/audit-quran-content.mjs --request content/audit-request.draft.json --output <report.json>'); process.exit(64);
}
const { auditContentBytes, compareIndependentSources } = await loadContentAudit();
const requestFile = resolve(requestPath), root = dirname(requestFile);
const request = JSON.parse(await readFile(requestFile, 'utf8'));
if (request.schemaVersion !== 1 || !request.primary) throw new Error('Unsupported content audit request.');
async function readBounded(path, limit, missingFiles) {
  if (path === null || path === undefined) return null;
  if (typeof path !== 'string') throw new Error('An artifact path must be a string or null.');
  const full = resolve(root, path);
  let info;
  try { info = await stat(full); }
  catch (error) { if (error.code === 'ENOENT') { missingFiles.push(path); return null; } throw error; }
  if (!info.isFile() || info.size > limit) throw new Error('Candidate artifact is not a bounded regular file.');
  const bytes = new Uint8Array(await readFile(full));
  if (bytes.length > limit) throw new Error('Artifact grew beyond its audit size limit.');
  return bytes;
}
async function inspect(candidate) {
  const missingFiles = [];
  const bytes = await readBounded(candidate.sourcePath, 32 * 1024 * 1024, missingFiles);
  const profileBytes = await readBounded(candidate.profilePath, 1024 * 1024, missingFiles);
  const profile = profileBytes === null ? null : JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(profileBytes));
  const audit = await auditContentBytes({ bytes, profile, expectedSha256: candidate.expectedSha256 ?? null, provenance: candidate.provenance ?? null });
  for (const path of missingFiles) audit.issues.push({ code: 'CONFIGURED_ARTIFACT_MISSING', detail: `Configured artifact is absent: ${path}` });
  return audit;
}
function summary(audit) {
  const { sourceText: _sourceText, records, ...rest } = audit;
  return { ...rest, recordCount: records.length, sourceTextOmittedFromReport: true };
}
const primary = await inspect(request.primary);
const reference = request.reference ? await inspect(request.reference) : null;
const comparison = reference ? compareIndependentSources(primary, reference) : { status: 'blocked', blockers: ['INDEPENDENT_REFERENCE_BYTES_MISSING'] };
const report = { product: 'MULAZAMA', reportVersion: 1, purpose: 'pre-release mechanical audit; never scientific approval',
  generatedAt: new Date().toISOString(), primary: summary(primary), reference: reference ? summary(reference) : null,
  comparison, productionActivation: 'unavailable', humanScientificApproval: 'pending' };
const destination = resolve(outputPath), temporary = `${destination}.tmp-${process.pid}`;
try { await writeFile(temporary, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); await rename(temporary, destination); }
finally { await unlink(temporary).catch(() => {}); }
console.log(JSON.stringify({ primary: primary.structuralStatus, comparison: comparison.status, productionActivation: 'unavailable', output: destination }));
process.exitCode = primary.structuralStatus === 'failed' || comparison.status === 'failed' ? 1 : primary.structuralStatus === 'blocked' || comparison.status === 'blocked' ? 2 : 0;
