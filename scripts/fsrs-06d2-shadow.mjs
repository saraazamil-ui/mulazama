/** Read-only independent comparison. No production selection or migration. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { loadTsFsrsReference } from './fsrs-reference-loader.mjs';
import { FSRS06D2_CASES } from './fsrs-06d2-cases.mjs';
const require = createRequire(import.meta.url);
const { build } = await import(createRequire(require.resolve('vite')).resolve('esbuild'));
const compiled = await build({ stdin: { contents: "export { compareFsrsReference } from './src/conformance/fsrs-conformance'; export { FSRS_CONFORMANCE_CASES } from './src/conformance/fsrs-suite'; export { FSRS_WEIGHTS,FSRS_PROVENANCE } from './src/core/fsrs'; export { roundedCandidateProbe } from './src/conformance/fsrs-rounded-probe';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const project = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const reference = await loadTsFsrsReference(resolve('references/ts-fsrs-5.4.2-verified/package'), 'references/ts-fsrs-5.4.2-verified/receipt.json', project.FSRS_WEIGHTS);
const library = await import(pathToFileURL(reference.entryPath).href);
const parameters = library.fsrs({ w: [...project.FSRS_WEIGHTS], request_retention: .9, maximum_interval: 36500, enable_fuzz: false, enable_short_term: true, learning_steps: [], relearning_steps: [] }).parameters;
const cases = [...project.FSRS_CONFORMANCE_CASES, ...FSRS06D2_CASES];
const selected = compare(reference, undefined), candidate = compare(reference, project.roundedCandidateProbe);
function compare(ref, probe) { return project.compareFsrsReference(ref, probe, cases); }
candidate.candidate = { ...candidate.candidate, algorithmVersion: 'hme-fsrs6-ts542-round8-0.1.0', precision: 'stage-rounded-8-decimal', runtimeSelected: false };
const result = { phase: '06-D2', checkedAt: new Date().toISOString(), environment: { node: process.version, platform: process.platform, arch: process.arch }, referenceIdentity: reference.identity, referenceSourceBinding: reference.sourceBinding,
  configuration: { effectiveLibraryParameters: parameters, projectWeightsMatchPinnedLibraryDefaults: JSON.stringify(project.FSRS_WEIGHTS) === JSON.stringify(library.default_w), timePolicy: project.FSRS_PROVENANCE.timePolicy,
    intervalComparisonScope: 'low-level next_state + next_interval + forgetting_curve; NOT complete BasicScheduler or HME policy approval' },
  selected, candidate, productionDecision: 'BLOCKED; numerical candidate success never selects an algorithm or migrates stored evidence',
  limitations: ['Pinned local upstream bytes independently executed; no new online provenance authentication', 'No cryptographic Sigstore verification', 'No scientific approval, user schedule activation or database migration'] };
await mkdir('docs/06d2/evidence', { recursive: true });
await writeFile('docs/06d2/evidence/fsrs-independent-shadow.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ selected: selected.summary, candidate: candidate.summary, configurationMatches: result.configuration.projectWeightsMatchPinnedLibraryDefaults, decision: result.productionDecision }, null, 2));
// Expected incompatibility is a real nonzero result, not a conformance pass.
process.exitCode = selected.status === 'conformant' ? 0 : selected.status === 'blocked' ? 2 : 1;
