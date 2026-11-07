# MULAZAMA — FSRS Reference Conformance / Phase 05-C

Date: 2026-11-05. Environment: Node v24.22.1, macOS arm64. **G02 remains Blocked.** Numerical conformance of the newly versioned candidate passed; the existing HME-selected research adapter remains nonconformant to the rounded library, and migration plus independent release approval have not occurred.

## Retrieved reference and identity

Actual npm registry metadata and package bytes for `ts-fsrs@5.4.2` were retrieved over HTTPS through the available Node runtime. Shell DNS still failed; these are separate network environments. The tarball SHA-512 exactly matches npm SRI:

`sha512-z4qop4pzTcyTzuJ566d9EaX/4bZZzhYfeaPImfVr+xcYT65c5oBgFDijUhCE/D+C78eaolHIhKRZ04/RwF+v2g==`

All 13 package files are covered by SHA-256 receipts and checked against tar extraction; package identity, MIT license, self-contained ESM entry, no runtime transitive dependencies, and effective weights/configuration were verified. Artifacts and metadata are retained under `references/ts-fsrs-5.4.2-download` and `references/ts-fsrs-5.4.2-verified`.

The registry response does **not** contain `gitHead`. The 05-B preparation tool therefore rejected valid downloaded bytes before comparison. The correction supports an explicit alternative: npm SLSA statement content must bind the exact tarball SHA-512, package/version, upstream repository, release workflow, and pinned source commit `bb71e35a2f5af5a5ac6cce9ef7c41ad24855721d`. The GitHub commit API response confirms that commit exists. No `gitHead` was invented or inserted into registry metadata.

**Limit:** this tool checks statement content binding, not Sigstore cryptographic signatures, certificate identity or transparency-log inclusion. The receipt explicitly records `cryptographicProvenanceVerified:false`; independent provenance/release review is still required. No signed production evidence or trust key was created.

## Independently executed arithmetic

The reference probe invokes the downloaded upstream library's `next_state`, `forgetting_curve`, and `next_interval` directly. Expected values are never generated from either MULAZAMA candidate. Fuzz is disabled, short-term enabled, fixed 21 weights, maximum interval 36500; elapsed days follow the declared HME whole-day policy.

| Candidate | Executed cases | Branches | Passed | Failed | Blocked |
|---|---:|---:|---:|---:|---:|
| HME research binary64 (existing runtime) | 23 | 12/12 | 2 | 21 | 0 |
| New stage-rounded adapter | 23 | 12/12 | 23 | 0 | 0 |

The 12 categories cover initial states/grades, short-term success/failure, early/late review, stability/difficulty boundaries, fractional input precision, retention targets, deterministic repeatability, intervals and historical replay. Each expected/actual/delta and issue is retained in the JSON evidence.

Tolerance remains `abs(a-b) <= 1e-12 + 1e-12*max(abs(a),abs(b))`; integer days and due timestamps require exact equality. The successful new candidate was also checked with exact equality against all frozen upstream output vectors.

## Differences and correction

The existing adapter is explicitly an unrounded binary64 research implementation. Upstream rounds factor, retrievability, initial difficulty, linear damping, mean reversion, stability updates, lapse cap and interval modifier to eight decimal places. For example initial Hard difficulty is `5.112170705601055` in research versus `5.11217071` upstream; same-day Again stability is `1.5968179979869215` versus `1.596818`. These differences are not hidden by loosening tolerance.

A separate independent arithmetic implementation, `src/core/fsrs-rounded.ts`, now implements those defined rounding stages and bounds. It has version `hme-fsrs6-ts542-round8-0.1.0`. It does not import the upstream executable. Its probe is `src/conformance/fsrs-rounded-probe.ts`. The old adapter and its stored algorithm version remain intact, so existing learning history is not silently reinterpreted. The new adapter rejects old-version state; an explicit migration/shadow replay design and approval are required before selecting it in HME. **Function implemented: yes. Production-enabled/runtime-selected: no.** This is a newly verified candidate, not closure of the current runtime conformance blocker.

## Reproduction

```sh
node scripts/fsrs-reference-prepare.mjs references/ts-fsrs-5.4.2-download/registry.json references/ts-fsrs-5.4.2-download/ts-fsrs-5.4.2.tgz NEW_DIRECTORY references/ts-fsrs-5.4.2-download/attestations.json
node scripts/fsrs-conformance.mjs --reference references/ts-fsrs-5.4.2-verified/package --receipt references/ts-fsrs-5.4.2-verified/receipt.json --output docs/05c/evidence/fsrs-reference-results.json
node scripts/fsrs-conformance.mjs --reference references/ts-fsrs-5.4.2-verified/package --receipt references/ts-fsrs-5.4.2-verified/receipt.json --rounded-candidate --output docs/05c/evidence/fsrs-rounded-reference-results.json
node node_modules/vitest/vitest.mjs run src/conformance src/core/fsrs.test.ts --reporter=json --outputFile=docs/05c/evidence/fsrs-tests.json
```

Preparation refuses an existing destination, executes no package install scripts and preserves original registry metadata. No application dependency or lockfile was changed. The fixed artifact receipt makes comparison reproducible from local bytes.

FSRS targeted regression: **82 passed, 0 failed, 0 skipped**. TypeScript passed. The first new provenance test harness failed before registering cases because JSDOM transformed `import.meta.url`; changed the test-only file resolution to the project path, then all 82 passed. This was a test harness correction, not a product algorithm failure.

## Evidence and remaining work

- `evidence/fsrs-acquisition-manifest.json`: byte sizes, SHA-256, acquisition endpoints.
- `evidence/fsrs-research-reference-before.json` / `fsrs-reference-results.json`: actual existing runtime arithmetic mismatch, 2/23.
- `evidence/fsrs-rounded-reference-results.json`: 23/23 new candidate, detailed exact deltas.
- `references/fsrs-542-golden-vectors.json`: frozen upstream expected outputs, identified reference.
- `evidence/fsrs-tests.json`, `fsrs-typecheck.log`: executed regression and typecheck.

Before G02 approval: independently authenticate provenance, review the new algorithm version, implement explicit HME selection and historical shadow replay/migration, assess scheduler policies outside the compared arithmetic, and obtain authorized signed release evidence. Numerical parity says nothing about Quran text integrity, teaching-method efficacy or individual memorization mastery.
