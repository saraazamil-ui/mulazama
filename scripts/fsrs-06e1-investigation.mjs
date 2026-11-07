/** Independent arithmetic investigation. Diagnostic upstream ablation is NEVER
 * an accepted reference. All expected values execute the untouched pinned bytes. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadTsFsrsReference, createLegacyLibraryProbe } from './fsrs-reference-loader.mjs';
import { FSRS06D2_CASES } from './fsrs-06d2-cases.mjs';
import { FSRS06E1_EDGE_CASES } from './fsrs-06e1-cases.mjs';
const args = process.argv.slice(2), option = name => args.includes(name) ? args[args.indexOf(name) + 1] : null;
const out = resolve(option('--output-dir') ?? 'docs/06e1/evidence');
const require = createRequire(import.meta.url);
const { build } = await import(createRequire(require.resolve('vite')).resolve('esbuild'));
async function compile(contents) {
  const compiled = await build({ stdin: { contents, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
}
const project = await compile("export * from './src/conformance/fsrs-conformance'; export * from './src/conformance/fsrs-suite'; export { FSRS_WEIGHTS,FSRS_PROVENANCE,FsrsAdapter } from './src/core/fsrs'; export { roundedCandidateProbe } from './src/conformance/fsrs-rounded-probe';");
const reference = await loadTsFsrsReference(resolve('references/ts-fsrs-5.4.2-verified/package'), 'references/ts-fsrs-5.4.2-verified/receipt.json', project.FSRS_WEIGHTS);
const upstream = await import(pathToFileURL(reference.entryPath).href);
const inputs = [...project.FSRS_CONFORMANCE_CASES, ...FSRS06D2_CASES], allInputs = [...inputs, ...FSRS06E1_EDGE_CASES];
const before = project.compareFsrsReference(reference, project.candidateFsrsProbe, allInputs);
const candidate = project.compareFsrsReference(reference, project.roundedCandidateProbe, allInputs);
const probeModule = option('--probe-module');
const repaired = probeModule ? await compile(`export { referenceFsrsProbe as probe } from ${JSON.stringify(resolve(probeModule))};`) : null;
const after = repaired ? project.compareFsrsReference(reference, repaired.probe, allInputs) : null;

const pristine = await readFile(reference.entryPath, 'utf8');
const originalRound = 'function roundTo(num, decimals) {\n  const factor = 10 ** decimals;\n  return Math.round(num * factor) / factor;\n}';
if (!pristine.includes(originalRound)) throw Error('Expected pinned roundTo body not found; do not silently alter diagnostic experiment.');
const diagnosticRound = `let __diagnosticDisabled = false, __diagnosticTrace = [];
export function configureDiagnostic(disabled) { __diagnosticDisabled = disabled; __diagnosticTrace = []; }
export function readDiagnosticTrace() { return __diagnosticTrace; }
function roundTo(num, decimals) {
  const factor = 10 ** decimals, rounded = Math.round(num * factor) / factor;
  const caller = (new Error().stack || '').split('\\n')[2]?.trim().split(' ')[1]?.split('.').at(-1) ?? 'unknown';
  if (num !== rounded) __diagnosticTrace.push({ caller, decimals, input: num, rounded, delta: rounded - num });
  return __diagnosticDisabled === true || Array.isArray(__diagnosticDisabled) && __diagnosticDisabled.includes(caller) ? num : rounded;
}`;
const diagnosticSource = pristine.replace(originalRound, diagnosticRound) + '\n//# sourceURL=fsrs06e1-upstream-diagnostic.mjs\n';
const diagnostic = await import(`data:text/javascript;base64,${Buffer.from(diagnosticSource).toString('base64')}`);
const diagnosticProbe = createLegacyLibraryProbe(diagnostic, project.FSRS_WEIGHTS);
diagnostic.configureDiagnostic(true);
const noRoundVsLegacy = project.compareFsrsReference({ ...reference, probe: diagnosticProbe }, project.candidateFsrsProbe, allInputs);
// The half-interval edge can expose one-ULP expression-order differences even
// with decimal rounding disabled: legacy computes s*expm1(...)/factor whereas
// upstream computes s*((pow(...)-1)/factor). Both diagnostic copies remain
// separate from the untouched reference used for every expected output.
const legacyIntervalExpression = 'Math.round(s * Math.expm1(-Math.log(this.param.request_retention) / this.param.w[20]) / Math.expm1(-Math.log(.9) / this.param.w[20]))';
if (!diagnosticSource.includes('Math.round(s * this.intervalModifier)')) throw Error('Pinned interval expression not found');
const legacyIntervalDiagnostic = await import(`data:text/javascript;base64,${Buffer.from(diagnosticSource.replace('Math.round(s * this.intervalModifier)', legacyIntervalExpression)).toString('base64')}`);
legacyIntervalDiagnostic.configureDiagnostic(true);
const noRoundAndLegacyInterval = project.compareFsrsReference({ ...reference, probe: createLegacyLibraryProbe(legacyIntervalDiagnostic, project.FSRS_WEIGHTS) }, project.candidateFsrsProbe, allInputs);
const intervalBoundaryEvidence = FSRS06E1_EDGE_CASES.filter(input => input.id.includes('INTERVAL-HALF')).map(input => {
  const lib = upstream.fsrs({ w: [...project.FSRS_WEIGHTS], request_retention: input.desiredRetention, enable_fuzz: false, enable_short_term: true });
  diagnostic.configureDiagnostic(true);
  const unroundedLib = diagnostic.fsrs({ w: [...project.FSRS_WEIGHTS], request_retention: input.desiredRetention, enable_fuzz: false, enable_short_term: true });
  return { id: input.id, baselineExactInterval: new project.FsrsAdapter({ desiredRetention: input.desiredRetention }).exactInterval(input.initial.stability),
    upstreamNoRoundExactInterval: input.initial.stability * unroundedLib.interval_modifier,
    upstreamRoundedModifier: lib.interval_modifier, upstreamRoundedStateTimesModifier: reference.probe.run(input)[0].stability * lib.interval_modifier };
});
const traces = allInputs.map(input => {
  diagnostic.configureDiagnostic(false);
  const outputs = diagnosticProbe.run(structuredClone(input));
  if (JSON.stringify(outputs) !== JSON.stringify(reference.probe.run(structuredClone(input)))) throw Error('Instrumented rounded copy changed pristine upstream output');
  const trace = diagnostic.readDiagnosticTrace();
  return { id: input.id, changedRoundingStages: [...new Set(trace.map(x => x.caller))], firstRoundingChanges: trace.slice(0, 20), totalChangedRoundCalls: trace.length };
});
// One stage removed at a time: an ablation is evidence about sensitivity, not an oracle.
const stages = ['computeDecayFactor', 'forgetting_curve', 'init_difficulty', 'linear_damping', 'mean_reversion', 'next_short_term_stability', 'next_forget_stability', 'next_state', 'next_recall_stability', 'calculate_interval_modifier'];
const stageAblations = stages.map(stage => {
  diagnostic.configureDiagnostic([stage]);
  const comparison = project.compareFsrsReference(reference, diagnosticProbe, allInputs);
  return { disabledRoundStage: stage, summary: comparison.summary, changedCases: comparison.cases.filter(x => x.status !== 'conformant').map(x => x.id) };
});
const numericFields = ['stability','difficulty','retrievabilityBefore','elapsedDays','roundedIntervalDays'];
const same = (a,b) => a === null || b === null ? a === b : Math.abs(a-b) <= project.FSRS_TOLERANCE.absolute + project.FSRS_TOLERANCE.relative * Math.max(Math.abs(a),Math.abs(b));
const caseMatrix = allInputs.map((input,index) => {
  const result = before.cases[index], corrected = (after ?? candidate).cases[index];
  const mismatches = result.actual.flatMap((actual,step) => {
    const expected = result.expected[step];
    const fields = numericFields.filter(k => ['elapsedDays','roundedIntervalDays'].includes(k) ? actual[k] !== expected[k] : !same(actual[k],expected[k]));
    if (actual.rawDueAt !== expected.rawDueAt) fields.push('rawDueAt');
    return fields.length ? [{ step, review: input.reviews[step], fields, expected, actual, delta: result.delta[step], rawDueDeltaMilliseconds: Date.parse(actual.rawDueAt)-Date.parse(expected.rawDueAt) }] : [];
  });
  const maximumAbsoluteDelta = Object.fromEntries(numericFields.map(field => [field, Math.max(0,...result.delta.map(step => Math.abs(step[field] ?? 0)))]));
  return { id: input.id, baselineCase: index < 32, inputs: input, before: result, after: corrected,
    afterSubject: after ? probeModule : 'existing unselected round8 candidate; NOT an engine-selection claim',
    mismatches, maximumAbsoluteDelta,
    potentialCausesTested: ['model/version identity','all21 effective weights','short-term/fuzz/retention config','elapsed-day/offset/order','memory initialization/bounds','stage rounding','HME rating/correction upstream input boundary'],
    provenCause: result.status === 'conformant' ? 'No baseline mismatch for this input; does not prove general parity' : (noRoundVsLegacy.cases[index].status === 'conformant' ? 'Missing ts-fsrs5.4.2 stage-by-stage eight-decimal rounding; deterministic binary64 arithmetic uses a different numerical contract' : 'Reference expression order vs legacy expm1/left-associated interval arithmetic produces a one-ULP half-interval difference, in addition to stage-rounding differences; independently isolated by two ablations'),
    proof: { baselineVsUpstreamWithoutRoundTo: noRoundVsLegacy.cases[index].status, baselineVsNoRoundAndLegacyIntervalExpression: noRoundAndLegacyInterval.cases[index].status, unchangedUpstreamVsRound8: candidate.cases[index].status, elapsedDaysEqualAtEveryStep: result.delta.every(step => step.elapsedDays === 0),
      trace: traces[index], acceptedReferenceNeverModified: true },
    proposedFix: 'Preserve legacy version replay; use explicit versioned adapter implementing pinned upstream rounding points and expression ordering; never change weights/rubric or relabel old state in place' };
});
const parameters = upstream.fsrs({ w: [...project.FSRS_WEIGHTS], request_retention: .9, maximum_interval: 36500, enable_fuzz: false, enable_short_term: true, learning_steps: [], relearning_steps: [] }).parameters;
const report = { phase: '06-E1', checkedAt: new Date().toISOString(), environment: { node: process.version, platform: process.platform, arch: process.arch },
  scope: before.scope, reference: reference.identity, sourceBinding: reference.sourceBinding,
  pristineUpstreamSHA256: createHash('sha256').update(pristine).digest('hex'), immutableBaselineCasesSHA256: createHash('sha256').update(JSON.stringify(inputs)).digest('hex'),
  baselineCaseCount: 32, addedEdgeCaseCount: FSRS06E1_EDGE_CASES.length, effectiveConfiguration: parameters,
  configurationChecks: { model: upstream.FSRSVersion, weightsExactlyEqualDefault: JSON.stringify(parameters.w) === JSON.stringify(upstream.default_w),
    weightsExactlyEqualProject: JSON.stringify(parameters.w) === JSON.stringify(project.FSRS_WEIGHTS), shortTerm: parameters.enable_short_term, fuzz: parameters.enable_fuzz,
    eventOrder: 'Review inputs preserved in supplied order; no sorting; corrected cases are explicit replacement sequences',
    timing: 'Absolute instants, floor of elapsed milliseconds /86400000 in both probes; all recorded elapsedDays compared exactly',
    rating: 'Tests inject explicit valid1..4 grades; no HME rubric invocation by either numerical probe. HME mapping needs separate integration tests.',
    restore: 'No storage/restoration is executed by numerical cases; absence of that layer rules it out as cause of these30 numeric failures.' },
  summaries: { baseline32: count(before.cases.slice(0,32)), edge8Before: count(before.cases.slice(32)), legacyAll: before.summary, existingCandidateAll: candidate.summary,
    repairedAll: after?.summary ?? null, upstreamNoRoundingVsLegacyAll: noRoundVsLegacy.summary, upstreamNoRoundingAndLegacyIntervalVsLegacyAll: noRoundAndLegacyInterval.summary },
  diagnosticExperiment: { acceptedReference: 'Pristine verified upstream bytes only', ablation: 'In-memory instrumented upstream roundTo can return input, globally or one caller at a time; diagnostic only, not stored, distributed, or accepted as reference',
    pristineReferenceStillUnchanged: pristine === await readFile(reference.entryPath,'utf8'), tracesWhenRoundingEnabledExactlyEqualPristine: true, stageAblations,
    noRoundingComparison: noRoundVsLegacy, noRoundingAndLegacyIntervalComparison: noRoundAndLegacyInterval, intervalBoundaryEvidence }, caseMatrix };
function count(cases) { return { passed: cases.filter(x=>x.status==='conformant').length, failed: cases.filter(x=>x.status==='nonconformant').length, blocked: cases.filter(x=>x.status==='blocked').length }; }
await mkdir(out,{recursive:true});
await writeFile(resolve(out,'fsrs-investigation.json'),JSON.stringify(report,null,2)+'\n');
await writeFile(resolve(out,'reference-case-matrix.json'),JSON.stringify(caseMatrix,null,2)+'\n');
const fmt = value => value === null ? 'null' : String(value);
const rows = caseMatrix.map(c => {
  const first = c.mismatches[0], input = c.inputs;
  const inputLabel = `${input.initial ? `S=${input.initial.stability},D=${input.initial.difficulty},t0=${input.initial.lastReviewAt}` : 'null'};r=${input.desiredRetention};` + (input.reviews.length>3 ? `${input.reviews.length} reviews (full JSON)` : input.reviews.map(r=>`${r.grade}@${r.at}`).join(';'));
  const e = first?.expected ?? c.before.expected[0], a = first?.actual ?? c.before.actual[0];
  const obs = x => `S=${fmt(x.stability)};D=${fmt(x.difficulty)};R=${fmt(x.retrievabilityBefore)};I=${x.roundedIntervalDays};due=${x.rawDueAt}`;
  const delta = first ? JSON.stringify(first.delta) + `;due-ms=${first.rawDueDeltaMilliseconds}` : '0 within existing tolerance';
  return `| ${c.id} | ${inputLabel} | ${first ? first.step : 0} | ${obs(e)} | ${obs(a)} | ${delta} | ${first ? (c.proof.baselineVsUpstreamWithoutRoundTo === 'conformant' ? 'غياب التقريب المرحلي؛ no-round diagnostic matches legacy' : 'التقريب وترتيب حساب الفاصل؛ تجربة no-round+legacy-interval تفسر الفرق') : 'لا اختلاف مرصود'} | ${c.after.status} |`;
});
await writeFile(resolve(out,'../Reference-Case-Matrix.md'),`# مصفوفة حالات FSRS — 06-E1\n\nالـ32 الأصلية لم تتغير؛ تليها8 حالات حدية مضافة. الجدول يعرض أول خطوة مخالفة، أوالخطوة الأولى للحالة المطابقة. [الملف الكامل](evidence/reference-case-matrix.json) يتضمن كل المدخلات وجميع النتائج المتوقعة والفعلية والفروق لكل خطوة، بما فيها60 و256 مراجعة. المتوقع صادر من upstream الأصلي المتحقق، ولا يأتي من تنفيذ مُلازَمَة.\n\nنتيجة إعادة الاختبار تخص ${after ? 'المسبار '+probeModule : 'المرشح round8 الموروث غير المنتخب؛ لا تعني تبديل المحرك'}.\n\n| الحالة | المدخلات | خطوة الفرق | المرجع | legacy الفعلي | الفروق actual−expected | السبب المثبت | إعادة الاختبار |\n|---|---|---:|---|---|---|---|---|\n${rows.join('\n')}\n`);
console.log(JSON.stringify(report.summaries,null,2));
if (report.summaries.baseline32.passed !== 2 || report.summaries.baseline32.failed !== 30 || noRoundVsLegacy.cases.slice(0,32).some(x=>x.status!=='conformant') || noRoundAndLegacyInterval.summary.failed || candidate.summary.failed || after?.summary.failed) process.exitCode = 1;
