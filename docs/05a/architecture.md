# MULAZAMA — ADR-05A-01: Shared HME Core and Platform Boundaries

- Status: Accepted for Phase 05-A engineering scope.
- Date: 2026-11-05, Asia/Riyadh.
- Product identity: **مُلازَمَة — MULAZAMA**.
- Target domain: `mulazama.com`; registration, ownership and deployment are unverified.
- Decision owner: Phase 05-A engineering delivery.

## Decision

Retain the existing **React Web / TypeScript** presentation and develop one platform-independent **TypeScript HME core**, application services, typed contracts and platform ports. Use **IndexedDB for the current browser adapter**. Evaluate a **Capacitor bridge with native SQLite and secure-key adapters in Phase 05-B**. Capacitor, SQLite on phones, native notification/audio plugins, iOS and Android projects are not installed, built, run or verified by this decision.

The decision preserves existing DOM/CSS and accessibility work while isolating learning rules. It does not declare the web UI suitable for every native behavior. Native adoption depends on Quran typography, audio interruption/background behavior, data durability, accessibility and performance tests on both platforms. If the bridge fails those gates, a native presentation may replace it while retaining the same TypeScript core contract and reference tests.

## Evidence and reasoning

The baseline contains React 19.2, TypeScript 5.9.3, local CSS/components, hash-based navigation, 19 screen components in a large `App.tsx`, and prototype domain code. Its 41 unit/component tests and current TypeScript/Vite build were rerun successfully. There is no pre-existing React Native, Expo, Flutter, SQLite, or native project to preserve. See [baseline audit](baseline-audit.md) and its [raw evidence](evidence/baseline/audit-summary.json).

Official documentation confirms that Capacitor targets Android, iOS and Web and requires native toolchains for mobile builds. Expo can share React Native components across targets, but ordinary React DOM elements do not render on native platforms. Flutter offers one Dart codebase across targets and its web rendering differs from the existing React DOM presentation. These facts support a migration-cost assessment; they do not establish application performance. Sources [S1]–[S4] were read on 2026-11-05.

**Engineering inference:** retaining tested web components and extracting pure TypeScript logic incurs less immediate replacement work than migrating 19 DOM/CSS screens. No quantitative percentage, person-day estimate, Quran renderer benchmark, audio benchmark or native memory comparison has been measured. “Lower/higher cost” below means relative source replacement and maintenance obligations observed in this repository.

## Options compared

| Criterion | A — Retain React Web + separate React Native phone presentation | B — Migrate to React Native / Expo with shared web presentation | C — Flutter unified presentation and core boundary | D — Retain React Web + shared TypeScript core + platform ports; evaluate Capacitor later **(selected)** |
|---|---|---|---|---|
| Existing reusable code | Web UI retained; pure TypeScript HME/services and fixtures shared; phone DOM/CSS rewritten | Pure TypeScript core, contracts and some React patterns retained; DOM/CSS screens require replacement or deliberate platform components | Existing specifications, fixtures and assets reusable; React/TypeScript UI requires Dart rewrite; core must remain one shared implementation through a proven bridge or undergo an explicit validated one-time migration | Existing React components, DOM/CSS, RTL styling and browser tests retained; prototype calculations/fixtures replaced behind services |
| Rebuild cost | Second UI, navigation and visual QA system to implement and maintain | Significant up-front screen/navigation migration; prospective shared UI thereafter | Highest immediate replacement scope in this repository; introduces Dart and a cross-language core decision | Lowest immediate UI replacement scope; later native adapters and bridge QA still substantial |
| Quran display | Separate native text/layout renderer; verify exact approved font, shaping, paging and selection | Native/Web render paths still require independent Quran layout checks | Flutter shaping/rendering requires Quran font, marks and page-layout validation | Existing web layout retained; WebView hypothesis must pass Arabic shaping, marks, page layout, selection, zoom and reader tests |
| Audio | Native audio adapter needed; web adapter separate | Expo/platform audio capabilities require permissions/background/interruption tests | Flutter plugin/platform implementations require the same behavior tests | Web audio port now; future native plugin selected only after license, lifecycle and permission review |
| Offline operation | Browser caching/content adapter + native bundled/downloaded content adapter | Shared policy with platform cache/content implementations; native availability must be proved | Offline policy and platform storage/content packages to build | Browser assets/content gate now; future bundled WebView assets/native content storage; no cold-offline support inferred from framework choice |
| Local storage | IndexedDB on web; SQLite native behind shared EventStore | IndexedDB/SQLite adapters through platform modules | Database adapter plus Dart/TypeScript interoperability or validated unified-core migration | IndexedDB adapter current; future native SQLite implements the exact same event/CAS semantics |
| Notifications | Browser and native ports with separate delivery/permission behavior | Expo/native and web notification paths need explicit reconciliation | Plugin/native/web paths need separate tests | Candidate generation shared; OS scheduling behind ports, cancellation/quiet hours/timezone rules shared |
| Privacy | Shared data minimization; native/browser key storage distinct | Framework choice supplies no automatic encryption or privacy approval | Framework choice supplies no automatic encryption or privacy approval | No backend needed for core learning; encrypted record/backup design and platform threat boundaries explicit |
| RTL | Preserve web CSS; implement native RTL and directional icons independently | React Native RTL + web RTL verification after migration | Flutter directionality + Arabic/font/accessibility QA after rewrite | Preserve web RTL; verify iOS/Android WebView and native plugin surfaces later |
| iOS/Android tests | Two native builds and device QA plus browser UI regression | Two native builds and device QA plus Expo Web regression | Two native builds and device QA plus Flutter Web regression | Two native bridge builds and device QA still mandatory; none performed in 05-A |
| Maintenance | One core, two presentation implementations; more parity review | One shared component system where feasible; platform exceptions unavoidable | One Dart UI but additional core boundary/porting maintenance | One retained web presentation and narrow adapters; native bridge/plugin upgrades remain explicit cost |
| Core sharing and algorithm consistency | Strong if both frontends import the same TypeScript package and contract fixtures | Strong for TypeScript core; prevent platform components from calculating HME decisions | Requires one demonstrably identical core path; parallel Dart/TypeScript formula implementations are rejected | Single pure TypeScript core package; UI calls services, never changes formulas or FSRS weights |
| Main decision risk | Ongoing dual-UI parity cost | Rebuilding the current UI without evidence that benefit outweighs cost | Core duplication risk and broad rewrite cost | Quran/audio/accessibility behavior in a WebView not yet demonstrated |

Option A remains a credible future fallback if device evidence requires native presentation. Option B may suit a fresh React Native product; this repository already has reusable web screens. Option C is viable as a separately funded validated migration, but offers no demonstrated benefit sufficient to justify replacing the existing source in this phase. Option D minimizes immediate replacement and keeps the native choice reversible.

## Layer boundaries

| Layer | Current or intended location | Owns | Forbidden dependency/behavior |
|---|---|---|---|
| Quran Content Layer | `src/content/` | Approved manifests, versions, hashes, canonical scope resolution and production enablement gate | No model-generated Quran; no unapproved text activation |
| HME Core | `src/core/` | Assessment/rating policy, state transitions, review/planning/recovery logic, explanation codes and FSRS adapter | No DOM, React, browser database, OS permissions or UI-owned math |
| Application Services | `src/application/` | Contract validation, commands, sessions, projections/replay and atomic operation orchestration | No silently accepted command after failed persistence |
| Persistence | `src/persistence/` | Event envelope integrity, unique identities, sequence/CAS, atomic append/replace, migrations, encryption and backup primitives | No learning rules or automatic corruption reset |
| Platform Services | `src/platform/` | Audio/files/notification permission and scheduling ports, capability reporting | No implicit uploads, unrequested permissions or changed learning decisions |
| Presentation | Existing React screens/components | RTL view state and user input; render confirmed service outputs | No FSRS formula/weight changes, invented evidence or mastery transitions |
| Testing | Domain/component tests, `e2e/`, browser QA modules, fixtures | Versioned reference cases, replay, conformance and platform acceptance | No fabricated pass results; test-only synthetic content excluded from production |

Paths document the separation being implemented. The readiness report and acceptance matrix determine which functions are actually complete and tested; an intended folder is not proof of an implemented feature.

## Persistence decision: IndexedDB now, SQLite as a native candidate

IndexedDB provides object stores, keys/indexes and scoped transactions, allowing event rows, command index and stream head to be committed together. Its upgrade transaction handles schema changes. A durability hint is not a guarantee against every hardware/power failure or browser data eviction. These platform semantics are distinct from application-level event validation [S5]. SQLite supports transactional reads/writes and explicit commit/rollback; its atomic-commit behavior depends on its storage assumptions and configuration [S6]–[S7].

| Concern | Browser adapter in 05-A | Native candidate in 05-B |
|---|---|---|
| Database | IndexedDB; records and object-store indexes | SQLite through a reviewed native adapter; package/version not selected here |
| Source of truth | Append-only raw learning events; projections reproducible from versioned events | Identical event envelope/order/version semantics |
| Transaction boundary | Event batch + command idempotency index + stream head in one readwrite transaction | Equivalent BEGIN/COMMIT transaction over events/commands/head |
| Compare and swap (CAS) | Expected stream revision checked within the write transaction; conflicting writers rejected | Same revision predicate within a transaction; no UI last-write-wins |
| Acknowledgement | Application success after transaction complete; failed write does not advance UI | Success after native transaction commit; process-death tests mandatory |
| Idempotency | Same event/command and body retries have one effect; reused IDs with conflicting bodies rejected | Unique database constraints plus same canonical command/event validation |
| Recovery/checkpoint | Events reconstruct confirmed session; unfinished recall does not become success | Same replay result before/after process restart or OS kill |
| Schema updates | Explicit supported upgrade; unknown versions/corruption fail closed; no implicit prototype import | Versioned SQL migrations with atomicity, downgrade policy and failure tests |
| Encryption/key boundary | Web Crypto adapter and browser-origin key; not an OS keystore and not protection from same-origin script execution | Reviewed database/record encryption; OS Keychain/Keystore storage and backup rules required |
| Export/restore | Validate all versions/integrity before atomic full replacement; no implicit merge | Same canonical portable format and atomic replace contract |
| Capacity/lifecycle | Quota/full/eviction errors and version-blocked tabs surfaced; browser data can be cleared | Device full, filesystem errors, lock contention, low-memory/process death and power interruption tested |
| Verification limit | Unit/reference tests do not prove actual browser transaction behavior | No native adapter/build/device test has been performed |

IndexedDB is selected because the current executable is a browser application, not because it is equivalent to SQLite under every failure model. Browser persistence tests and device tests remain separate gates. localStorage is retained only where explicitly identified as legacy prototype state; it is not the production event store and is not silently imported as verified learning.

## Deterministic core contract

1. Input contains absolute captured time, timezone, normalized scope, evidence provenance, hint/mistake observations and version bundle.
2. Core output contains decisions, reasons, raw model due date, policy due date and planned date separately.
3. Platform adapters supply capabilities and confirmed persistence receipts. They do not override assessment or transition conditions.
4. Every supported frontend uses the same algorithm/policy/rubric/content/model versions and ordered events. No mobile-specific FSRS weights or transition thresholds are permitted.
5. Replay preserves original raw evidence and versions. An upgrade does not silently rewrite prior outcomes; unsupported historical versions are reported explicitly.
6. Canonical reference vectors, duplicate-event cases, interrupted sessions and scheduler results must be identical across browser and native adapter contract suites before native approval.

## Required native evaluation in 05-B

- Select/pin Capacitor version and review plugins and licenses; create actual iOS/Android projects only after toolchains are available. Official current documentation lists Xcode/Android tooling; no dependency is assumed installed merely because this host is macOS.
- Implement native EventStore, secure-key, audio, file and notification adapters behind the existing ports. Confirm exact plugin behavior, permissions, backups and OS lifecycle handling.
- Benchmark approved Quran font/content on representative iOS/Android devices: cold startup, page layout/marks, text scaling, VoiceOver/TalkBack, 30-juz view, memory and long-session scrolling. Do not reuse desktop build time as runtime performance.
- Test airplane-mode cold start, confirmed repetition persistence, process kill during recall, device full, failed restore, clock/timezone changes and notification cancellation.
- Run the same HME/FSRS versioned vectors and event replay against each platform build. Native UI work may not alter the algorithm to fit a platform.
- Make the final bridge-versus-native-presentation decision from measured failures and maintenance evidence.

## CI and release boundary

Current CI design should run frozen dependency installation, typecheck, unit/contract/reference tests, build, security dependency review and browser E2E/axe in a runner that supports localhost and browsers. Future mobile jobs require actual Xcode/Android toolchains and signed-device/simulator acceptance as appropriate. Browser/server sandbox restrictions are recorded as blocked checks, never converted to passes.

No website deployment, domain purchase, App Store/Google Play submission, native compatibility certification or Quran-content approval is implied by this ADR. Phase 05-A supports a web engineering foundation subject to its readiness gates.

## Sources checked on 2026-11-05

- [S1 — Capacitor overview](https://capacitorjs.com/docs): native runtime for web applications; evaluate integration details before adoption.
- [S2 — Capacitor environment setup](https://capacitorjs.com/docs/getting-started/environment-setup): supported targets and native toolchain requirements.
- [S3 — Expo web workflow](https://docs.expo.dev/workflow/web/): universal React components, React Native Web and limits of ordinary DOM components on native.
- [S4 — Flutter web support](https://docs.flutter.dev/platform-integration/web): Dart portability and Flutter web rendering model.
- [S5 — W3C Indexed Database API 3.0](https://www.w3.org/TR/IndexedDB/), Working Draft dated 2026-10-30: transaction/upgrade/durability semantics; cited as a draft, not a completed recommendation.
- [S6 — SQLite transactions](https://www.sqlite.org/lang_transaction.html): transactional operations and explicit commit/rollback.
- [S7 — SQLite atomic commit](https://www.sqlite.org/atomiccommit.html): commit/rollback design and hardware assumptions.

Source statements above are concise paraphrases. Relative rewrite cost, option ranking and the selected project architecture are engineering judgments based on inspected source, not claims made by framework vendors.
