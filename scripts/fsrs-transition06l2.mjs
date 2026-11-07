/** Local pre-election impact report; never activates a model or writes an EventStore.
 * --input is a caller-provided, supported raw EventSnapshot. Use --synthetic to
 * generate a self-contained QA example (not actual learner activity). */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
const args = process.argv.slice(2), option = key => args.includes(key) ? args[args.indexOf(key) + 1] : null;
const input = option('--input'), output = option('--output');
if (!output || (!!input === args.includes('--synthetic'))) throw Error('Specify --output plus exactly one of --input snapshot.json or --synthetic');
const require = createRequire(import.meta.url), { build } = await import(createRequire(require.resolve('vite')).resolve('esbuild'));
const compiled = await build({ stdin: { contents: "export {reviewFsrsTransition06l2} from './src/application/fsrs-transition06l2'; export * from './src/testing/fsrs-integration06l2';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false, define: { 'import.meta.env.MODE': '"test"' } });
const code = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
let snapshot;
if (input) {
  const bytes = await readFile(input); if (bytes.length > 32 * 1024 * 1024) throw Error('Snapshot exceeds bounded QA input limit');
  snapshot = JSON.parse(bytes.toString('utf8'));
} else {
  const state = await code.setupFsrs06l2();
  try {
    for (let i = 0; i < 4; i++) await code.recordFsrsAttempt06l2(state, code.rubricScenarios06l2[i], code.offset06l2(code.baseTime06l2, i * 3 * 86400000));
    snapshot = await state.store.load();
  } finally { state.app.close(); }
}
const report = await code.reviewFsrsTransition06l2(snapshot);
await mkdir(dirname(resolve(output)), { recursive: true });
await writeFile(output, JSON.stringify({ inputKind: input ? 'caller-supplied-local-snapshot' : 'synthetic-QA-only', report }, null, 2) + '\n');
if (!input) await writeFile(output.replace(/\.json$/, '') + '-source.json', JSON.stringify(snapshot, null, 2) + '\n');
console.log(JSON.stringify({ output, units: report.summary.units, stateDifferences: report.summary.unitsWithChangedStateNumbers,
  rawDueDifferences: report.summary.unitsWithChangedRawDue, executionAllowed: false, migrationPerformed: false }));
