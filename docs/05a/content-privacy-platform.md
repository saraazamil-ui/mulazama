# MULAZAMA — Content, Portable Backup and Platform Boundaries

Review date: 2026-11-05 (Asia/Riyadh). Scope: C01, C10, C12, C13, C14. References: HME 0.1 §§4, 18, 21, 26–27; PRD 0.1 §§11.2, 11.11–11.15, 15–17 and decisions D08/D11/D17; phase 04-B readiness gate.

## Implemented and tested

| Component | Implementation | Evidence |
|---|---|---|
| Content integrity and independent release gate | `src/content/content-gate.ts` | CG01–CG07 |
| Portable authenticated backup, inspection and atomic replacement boundary | `src/persistence/backup.ts` | B01–B13 |
| Forecast sufficiency and mandatory refusal | `src/platform/forecast.ts` | P01–P02 |
| Deterministic local notification candidates and reconciliation port | `src/platform/notifications.ts` | P03–P09 |
| Explicit unavailable native/media capabilities | `src/platform/notifications.ts`, `src/platform/media.ts` | P10 |

Actual run: **30/30 tests passed, 0 failed, 0 skipped** in Node.js 24.22.1 on macOS. Full JSON evidence: `content-backup-platform-tests.json`. TypeScript project check passed after these changes. These tests do not establish native delivery, real-device privacy, Quranic correctness, or production content approval.

## Quran content gate

No approved Quran text, font or content mapping is included. The production trust-anchor list is empty, so the default gate cannot activate an uploaded package. Sessions and text resolution remain unavailable. A caller-supplied `approved: true` has no authority.

Candidate verification checks the declared Hafs riwaya, edition/layout/tokenization identity, source and license fields, SHA-256 of exact unmodified source text/mapping/font, unique ordered canonical positions, token sequences, extraction bounds and coverage counts. An independent reviewer attestation must cover text, riwaya, script, diacritics, numbering, segmentation, layout, license, font and approved boundaries. Activation verifies an ECDSA P-256/SHA-256 signature against a trusted release authority and preserves the current package if any check fails.

Hashing and signature verification prove byte identity and authorization of a release; they do not independently establish correctness of the Quran text. Scientific content review, source/edition selection, font rendering review and a genuine approved release remain blockers. Positive automated tests use only synthetic non-Quran strings and an ephemeral key held inside the test file; that key is absent from production trust anchors.

## Portable backup format and threat model

- AES-256-GCM with a fresh 96-bit nonce, 128-bit authentication tag, and authenticated format metadata.
- A separate portable key is derived from the user's recovery secret with PBKDF2-SHA-256, 600,000 iterations and fresh 128-bit salt. The device-local database key is never exported.
- The recovery secret requires at least 12 Unicode code points. Losing it prevents opening the backup. JavaScript cannot guarantee immediate erasure of immutable password strings from browser memory.
- The encrypted payload contains the raw event snapshot, current version bundle and a SHA-256 payload manifest. Unknown schema/model/content versions, duplicate event identities, truncated bytes, altered header/ciphertext and wrong secrets fail before the live store is modified.
- File inspection may run a replay validator. Activation requires a replay validator, an explicit full-replacement confirmation and the expected live-store revision. It calls `EventStore.replace` only after all checks; there is no merge operation. The store owns atomic commit/rollback and concurrency protection.
- The current portable format is limited to 32 MiB serialized data and 100,000 events. Protection-parameter upgrades require a new supported format rather than a silent change. Unknown iterations are rejected before expensive key derivation.

Threats addressed by these tests: disclosure of a copied exported file, ciphertext/header alteration, unsupported version import, duplicate evidence, unintended merge, concurrent replacement, rejected replay and simulated commit failure. A weak or stolen recovery secret remains a risk. Same-origin script execution, a compromised browser/device, exported copies outside the app, secure deletion of physical media and operating-system backups require separate controls and platform validation. Successful serialization means a valid encrypted artifact was created; only the caller/file picker can confirm it was saved to the selected destination.

The replacement-boundary tests use the transactional reference store. Actual IndexedDB transaction, OS power-loss and device-keystore checks must be reported separately by the storage/platform test suite.

## Forecasts

The provisional PRD data gate checks 28 calendar days, 10 active days, 10 timed acquisitions, measured maintenance cost, complete replay, feasible capacity and a stable recovery/plan. Passing the data threshold does not enable future numbers: no accepted retrospectively validated forecast model exists in this delivery. The service therefore returns null horizons and no completion date. Its standard refusal is:

> لا تتوفر بيانات كافية لتقدير التقدم المتوقع بصورة موثوقة

Forecast inspection does not modify plan settings or create learning events.

## Notifications and optional media

Notification candidates derive from actual planned tasks, not raw FSRS dates. They respect permission, explicit enablement, active-session suppression, local IANA-zone quiet hours (default 21:00–08:00), one daily reminder by default, a two/day ceiling only after extra-reminder opt-in, at least four hours between requests and a seven-day horizon. Past and quiet-hour requests are skipped rather than delivered as a catch-up burst. Stable plan/zone/day identifiers allow reconciliation to cancel obsolete or completed requests and remain idempotent. Lock-screen wording is generic.

The platform port is implemented and tested with a deterministic reference port. Native background scheduling, delivery, reboot/power policies and permission revocation on iOS/Android have not been implemented or verified here. The runtime status says native scheduling is unavailable. No microphone permission, personal recording or automatic upload is requested; optional C14 audio remains unavailable until its own platform and licensing gates are met.
