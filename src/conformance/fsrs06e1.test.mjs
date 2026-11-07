// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadTsFsrsReference } from '../../scripts/fsrs-reference-loader.mjs';
import { FSRS06D2_CASES } from '../../scripts/fsrs-06d2-cases.mjs';
import { FSRS06E1_EDGE_CASES } from '../../scripts/fsrs-06e1-cases.mjs';
const require = createRequire(import.meta.url);
const { build } = await import(createRequire(require.resolve('vite')).resolve('esbuild'));
const compiled = await build({ stdin: { contents: "export * from './src/conformance/fsrs-conformance'; export * from './src/conformance/fsrs-suite'; export * from './src/conformance/fsrs-reference-probe'; export * from './src/core/fsrs-reference'; export { FSRS_WEIGHTS,FsrsAdapter } from './src/core/fsrs';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const project = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const reference = await loadTsFsrsReference(resolve('references/ts-fsrs-5.4.2-verified/package'), 'references/ts-fsrs-5.4.2-verified/receipt.json', project.FSRS_WEIGHTS);
const library = await import(pathToFileURL(reference.entryPath).href);
const baseline = [...project.FSRS_CONFORMANCE_CASES, ...FSRS06D2_CASES];
const cases = [...baseline, ...FSRS06E1_EDGE_CASES];
const hash = value => createHash('sha256').update(value).digest('hex');

describe('06-E1 corrected FSRS independent pinned upstream conformance', () => {
  it.each(cases.map(input => [input.id, input]))('%s matches every upstream observable exactly and deterministically', (_id, input) => {
    const serialized = JSON.stringify(input), expected = reference.probe.run(structuredClone(input));
    const actual = project.referenceFsrsProbe.run(structuredClone(input));
    expect(actual).toEqual(expected);
    expect(project.referenceFsrsProbe.run(structuredClone(input))).toEqual(actual);
    expect(reference.probe.run(structuredClone(input))).toEqual(expected);
    expect(JSON.stringify(input)).toBe(serialized);
  });
  it('E1-C41 all21 weights and effective configuration match pinned upstream defaults without tuning', () => {
    const lib = library.fsrs({ w: [...project.FSRS_WEIGHTS], request_retention: .9, enable_short_term: true, enable_fuzz: false, maximum_interval: 36500, learning_steps: [], relearning_steps: [] });
    expect([...project.FSRS_WEIGHTS]).toEqual(library.default_w);
    expect(lib.parameters.w).toEqual([...project.FSRS_WEIGHTS]);
    expect(lib.parameters).toMatchObject({ request_retention: .9, enable_short_term: true, enable_fuzz: false, maximum_interval: 36500, learning_steps: [], relearning_steps: [] });
    expect(reference.identity).toMatchObject({ name: 'ts-fsrs', version: '5.4.2', model: 'FSRS-6', sourceCommit: 'bb71e35a2f5af5a5ac6cce9ef7c41ad24855721d', filesVerified: 13, executed: true });
  });
  it('E1-C42 retains the original32 input cases and1e-12 tolerances verbatim', async () => {
    // Hashes from the verified06-D2 delivery; inputs, not expected outputs.
    const receipt = JSON.parse(await readFile('delivery-manifest-06d2.json','utf8'));
    for (const file of ['src/conformance/fsrs-suite.ts','scripts/fsrs-06d2-cases.mjs','src/conformance/fsrs-conformance.ts']) {
      expect(hash(await readFile(file))).toBe(receipt.files.find(entry=>entry.path===file).sha256);
    }
    expect(baseline).toHaveLength(32);
    expect(project.FSRS_TOLERANCE).toEqual({ absolute: 1e-12, relative: 1e-12 });
  });
  it('E1-C43 legacy remains2/32; corrected40/40 is not a relabeling or a silent migration', () => {
    const legacy = project.compareFsrsReference(reference, project.candidateFsrsProbe, baseline);
    const corrected = project.compareFsrsReference(reference, project.referenceFsrsProbe, cases);
    expect(legacy.summary).toEqual({ passed: 2, failed: 30, blocked: 0 });
    expect(corrected.summary).toEqual({ passed: 40, failed: 0, blocked: 0 });
    const old = new project.FsrsAdapter().review(null,3,'2026-01-01T00:00:00Z');
    const next = new project.ReferenceFsrsAdapter().review(null,3,'2026-01-01T00:00:00Z');
    expect(()=>new project.ReferenceFsrsAdapter().review(old.state,3,'2026-01-02T00:00:00Z')).toThrow(/explicit rebuild/);
    expect(()=>new project.FsrsAdapter().review(next.state,3,'2026-01-02T00:00:00Z')).toThrow(/UNSUPPORTED_VERSION/);
    expect(project.REFERENCE_FSRS_PROVENANCE.approvedForProduction).toBe(false);
  });
  it('E1-C44 interval-half edge cases prove material date changes under the correct arithmetic contract', () => {
    const intervals = FSRS06E1_EDGE_CASES.filter(input=>input.id.includes('INTERVAL-HALF')).map(input=>({
      legacy: project.candidateFsrsProbe.run(input)[0].roundedIntervalDays,
      reference: reference.probe.run(input)[0].roundedIntervalDays,
      corrected: project.referenceFsrsProbe.run(input)[0].roundedIntervalDays,
    }));
    expect(intervals).toEqual([{ legacy: 2, reference: 1, corrected: 1 }, { legacy: 5001, reference: 5000, corrected: 5000 }, { legacy: 10, reference: 11, corrected: 11 }]);
  });
  it('E1-C45 public curve and interval methods match upstream over fixed boundary/retention grid', () => {
    for (const retention of [.5,.9,.95,.99]) {
      const adapter = new project.ReferenceFsrsAdapter({ desiredRetention: retention });
      const lib = library.fsrs({ w: [...project.FSRS_WEIGHTS], request_retention: retention, enable_short_term: true, enable_fuzz: false, maximum_interval: 36500, learning_steps: [], relearning_steps: [] });
      for (const stability of [.001,.01,.212,1,5.123456789,152.84201823805714,36500]) {
        expect(adapter.exactInterval(stability)).toBe(stability * lib.interval_modifier);
        for (const elapsed of [0,1,5,36500]) expect(adapter.curve(elapsed,stability)).toBe(lib.forgetting_curve(elapsed,stability));
      }
    }
  });
});
