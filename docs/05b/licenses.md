# MULAZAMA — Dependency and License Inventory

Baseline 05-B · 2026-11-05. Reads only the installed dependency tree used to rerun original 05-A. It does not prove a successful frozen installation or approval to redistribute all assets.

Installed packages inspected: **171**. Direct runtime/development declarations: **16**. Missing direct packages: **0**.

## Direct dependencies

| Package | Installed version | Use | Declared license | License files found |
|---|---|---|---|---|
| @axe-core/playwright | 4.10.2 | development | MPL-2.0 | LICENSE |
| @playwright/test | 1.56.1 | development | Apache-2.0 | LICENSE, NOTICE |
| @testing-library/jest-dom | 6.9.1 | development | MIT | LICENSE |
| @testing-library/react | 16.3.0 | development | MIT | LICENSE |
| @testing-library/user-event | 14.6.1 | development | MIT | LICENSE |
| @types/react | 19.2.2 | development | MIT | LICENSE |
| @types/react-dom | 19.2.2 | development | MIT | LICENSE |
| @vitejs/plugin-react | 5.0.4 | development | MIT | LICENSE |
| jsdom | 26.1.0 | development | MIT | LICENSE.txt |
| lucide-react | 0.468.0 | runtime | ISC | LICENSE |
| prettier | 3.6.2 | development | MIT | LICENSE |
| react | 19.2.0 | runtime | MIT | LICENSE |
| react-dom | 19.2.0 | runtime | MIT | LICENSE |
| typescript | 5.9.3 | development | Apache-2.0 | LICENSE.txt |
| vite | 7.1.12 | development | MIT | LICENSE.md |
| vitest | 3.2.4 | development | MIT | LICENSE.md |

## Assets and project license

Root LICENSE/NOTICE files: none found. Source ownership and distribution terms therefore need an explicit project decision before external source distribution.
Bundled font files: 0; bundled audio files: 0. The UI uses system fonts. No production Quran content/font/audio bundle is approved by this inventory.

Lucide icons and all direct/dev packages are identified above. Full installed transitive metadata and license-file SHA-256 values are in `licenses.json`. License expressions such as MPL-2.0, Apache-2.0 and dual licenses require preservation of applicable notices and terms; this local listing is not a legal clearance.

## Scope and remaining work

The installed dependency inventory includes build and test tooling, not only browser-shipped code. Distinct copies of a package/version are represented once. It reads package declarations, local LICENSE/NOTICE files, repository and homepage fields; upstream authenticity was not revalidated online. No dependency was installed, removed or updated by this inventory.

A registry-backed advisory scan remains blocked by `ENOTFOUND registry.npmjs.org`. The existing bounded source scan checks three secret patterns and prototype imports; it is not dependency-vulnerability assessment, penetration testing, or a guarantee of security. Source-license decision, content/edition/font/audio licenses, complete attribution bundle, and online advisories remain release review items.
