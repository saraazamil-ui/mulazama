# MULAZAMA — Phase 05-A Baseline Audit

Verified on 2026-11-05. This report audits the actual Phase 04-B source and distinguishes current reruns from archived evidence.

## Provenance and isolation

- Found `itqan-04b-delivery.zip` and expanded project `itqan-04b` in the task workspace.
- Archive SHA-256: `21c88d106216b3977b00a115fe3f39129fd40a4b770a3d4e123ec0e12d257785`, matching the supplied `.sha256` file.
- Read README, QA results, readiness gate, package/config/lock files, source state/contracts/storage/mock/ranges, App and screen catalog, component code and unit/browser tests.
- The workspace `package.json` and `src/App.tsx` acquired separate standalone-preview changes during inspection. The ZIP itself remained intact. To avoid ambiguity, the exact archive was expanded to `/tmp/mulazama-baseline/archive/itqan-04b`, linked to the existing installed node_modules, and its tests/build were rerun separately. These exact-archive reruns are the authoritative baseline results below.
- No application or dependency source was edited by this audit. Build outputs and test reports were regenerated; the original ZIP remains unchanged.

## Actual rerun results

| Check | Current actual result | Evidence |
|---|---|---|
| Frozen-lockfile installation | Blocked before installation: Corepack could not resolve registry.npmjs.org (`ENOTFOUND`) | install.log |
| TypeScript `tsc -b` | Passed, exit 0 | archive-typecheck.log |
| Vite production build | Passed, exit 0, 1586 transformed modules | archive-build.log |
| Unit/component tests | 41 of 41 passed, 2 files, no skipped tests | archive-unit-results.json; archive-unit.log |
| Playwright full suite | Blocked before executing tests: webServer listen `EPERM` at 127.0.0.1:4173 | archive-browser.log; archive-browser-results.json |
| 28 browser groups | Not rerun successfully; 0 executed in this environment | Same browser evidence |
| 44 axe evaluations | Not run in the current rerun because browser webServer could not start | Same browser evidence |
| Dependency vulnerability audit | Not run; registry network is unavailable | No vulnerability clearance is claimed |
| Workspace standalone-preview tests | 3 of 3 passed (separate post-archive tooling) | Console output; these are not part of original 41 |

The archived Phase 04-B results claim 28 browser groups and 44 axe evaluations passed. They remain historical evidence and are not counted as current successes.

Build output: CSS 23.94 kB (gzip 6.07 kB), JS 311.54 kB (gzip 93.01 kB), index 0.59 kB. Build duration about 1.03 s on this host is a build-tool measurement, not application startup or runtime P95.

## Environment and reproducible commands

macOS arm64. Installed Node v24.22.1 is at `/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node`. Its hardened signature initially prevented loading Rollup native code due to mismatched Team IDs. A copy under `/tmp/mulazama-baseline/bin/node` was signed ad-hoc for this session; no shared dependency was modified. The following local commands then worked:

```sh
export PATH=/tmp/mulazama-baseline/bin:$PATH
node node_modules/typescript/bin/tsc -b
node node_modules/vite/bin/vite.js build
node node_modules/vitest/vitest.mjs run --reporter=verbose --reporter=json --outputFile=/tmp/mulazama-baseline/archive-unit-results.json
PW_CHANNEL=chrome node node_modules/@playwright/test/cli.js test
```

The final browser command was attempted and blocked, not passed. Google Chrome is installed. To rerun browser/axe checks, use an execution environment that permits a localhost webServer and browser process. Installation requires a reachable package registry (pnpm 11.25.0 is requested by historical README, but packageManager is absent in original package.json).

## Source architecture

| Item | Actual implementation |
|---|---|
| Framework | React Web 19.2.0, React DOM 19.2.0, Vite 7.1.12 |
| TypeScript | 5.9.3, strict mode, ES2022, bundler module resolution |
| Package system | pnpm lockfile + pnpm-workspace.yaml; exact dependency versions; no original packageManager field |
| UI library | Local components and CSS; lucide-react 0.468.0 icons |
| Navigation | window.location.hash + a screen map, no router dependency |
| State | React Context/useState/useRef + domain transition reducer; no external state library |
| Persistence | Whole-state JSON in localStorage key itqan.prototype.v1, max 2 MB; not encrypted |
| Mock data | src/domain/mock.ts, static planning fixtures and asOf timestamp; metadata source=mock, learningEvidence=false |
| Contracts | src/domain/contracts.ts defines C01–C14 with typed mock handler implementation in mock.ts |
| Tests | Vitest 3.2.4; jsdom 26.1.0; Testing Library; Playwright 1.56.1; axe playwright 4.10.2 |
| Screens | All S01–S19 represented by local components in monolithic App.tsx, names in catalog.ts |
| RTL | html dir=rtl, local CSS/logical layout, Arabic strings, keyboard/modal focus handling; device reader tests absent |
| Build | tsc -b + vite build; base ./; static dist output; no service worker in original ZIP |
| Mobile | No iOS/Android project, native package, native build, or device test |
| Git | Workspace is not a git repository |

Folders: `src/` (UI and domain prototype), `e2e/`, `docs/` (QA/acceptance/traceability/decisions/evidence), `references/` (HME and PRD snapshots), configuration/lock files, `dist/` and archive test evidence. No production database package, FSRS package, native audio/notifications, or content bundle was present in the baseline.

## Existing contract functionality

C01 returns content unavailable. C02 reads config and rejects save through query. C03 gives a mock diagnosis/recovery sample. C04 uses fixed fixtures (including budgets 30/60/120 and costs 25/49/97), not an HME planner. C05 returns current prototype checkpoint. C06 returns repetition count and mastery null. C07 returns a self-report with effectiveRating/strictPass/reviewEvent null. C08 reads mistake drafts. C09 returns unmeasured progress. C10 abstains from numeric forecasting. C11 reports engine and migrations unavailable. C12 inspects plaintext prototype JSON. C13 returns no scheduled system notifications. C14 returns no audio/recording capability. A TypeScript interface alone does not make these production contracts.

## Real behavior already reusable

- Explicit separated declaration ranges, overlap normalization only within the same axis/layout; cross-axis true Quran union awaits content mapping.
- Config validation and today-only dated time override separate from habitual settings.
- Reducer command IDs prevent repeated matching prototype actions, reject conflicting reused command IDs and revision conflicts.
- Confirmed UI update occurs after localStorage write acknowledgement. Write failure preserves the previously committed state in covered tests.
- Reload pauses active session; interrupted recall requires a new attempt and preserves the incomplete original. Repetition count does not grant mastery.
- Hint/reveal/error details persist; self-report conflict is preserved; correction keeps original snapshot.
- Prototype import checks schema, versions, size and references and requires whole-state replacement confirmation in UI.
- Forecast abstention and unavailable content/audio labels prevent false production claims.

## Production gaps and risks

1. No Quran content source/edition/license/hash/map approval, no actual Quran text. Retain content gate.
2. No FSRS/HME/state machine or actual transition eligibility. The reducer models interaction only.
3. localStorage whole-state writes provide neither an append-only event log nor relational transactions, durable replay, multi-tab concurrency control, schema migration or encrypted production storage.
4. Prototype backup is plaintext JSON with structural validation only; no authenticity, encryption, passphrase/key handling or cryptographic tamper protection.
5. Planning/progress/diagnosis/notifications/media remain mocks or explicit unavailable functions. No synthetic fixture may be portrayed as real user evidence.
6. Router/state and all 19 screens in one App.tsx form a large UI file; extract services/ports gradually while retaining components rather than rewriting the UI.
7. No native builds, OS notifications, audio permission implementation, cold offline/PWA cache, secure key storage, or device crash/power loss tests.
8. No network calls/remote media/dangerouslySetInnerHTML/eval or obvious hardcoded production credentials found in src in this static audit. This is not a complete security assessment.
9. LocalStorage is readable by same-origin JavaScript and unencrypted at rest; XSS/same-browser access is a threat. React text rendering reduces direct HTML injection, but production CSP and data minimization still need work.
10. Command receipts accumulate in whole-state JSON, and the app has one local revision with no multi-window writer arbitration.
11. `Date.now`/Math.random ID fallback is a prototype convenience; production records should use an explicit secure ID dependency/port where crypto.randomUUID is unavailable.
12. Current dependencies were not cleared against advisories because registry access was blocked; do not infer safety from successful build.

## Dependency usage

All three runtime direct dependencies have actual source consumers. Testing, types, Vite and TypeScript packages have config/test consumers. Prettier 3.6.2 is an installed dev formatter with no package script or dedicated config found; it is optional tooling rather than runtime dead weight. No production router/state/database/FSRS dependency exists. Transitive vulnerability status is unverified.

## Baseline verdict

The exact archived React prototype is buildable with installed dependencies and its 41 unit/component tests currently pass. Its design is reusable. Production learning, content, database, security, mobile and browser QA gates remain open. The original 28 browser/44 axe successes cannot be reaffirmed in the current sandbox because a local webServer cannot bind.
