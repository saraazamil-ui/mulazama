# MULAZAMA — Phase 05-B Baseline Audit

**تاريخ التشغيل:** 2026-11-05 UTC. **النطاق:** إعادة تحقق من حزمة 05-A الأصلية قبل أي إصلاحات 05-B. **النتيجة:** أعيد نجاح 299 اختبارًا والبناء وفحص الأنواع؛ لم تثبت جاهزية الإنتاج.

## مصدر التدقيق والعزل

فُحصت حزمة `MULAZAMA-Phase-05A-Source.zip` ذات الحجم 764472 بايت وبصمة SHA-256:

`9fac93cd0cf6e1ed260a04289361aad0c747288944d5189a762dc0c48cf0c41d`

هذه النسخة المحلية هي النسخة المرفوعة سابقًا إلى الملف المحدد في `input-provenance.json`؛ تعذر جلبها من جديد عبر أداة التنزيل. لم يُفترض نجاح تنزيل جديد. فك التدقيق الأرشيف في `/tmp/mulazama-05b-baseline/mulazama-05a`، وفحص سلامة المسارات وعدم وجود symlinks قبل الفك. أعيد استخدام شجرة الاعتماديات المحلية القائمة عبر symlink لأن تثبيتًا جديدًا لم ينجح. المصدر في هذه النسخة مستقل عن تعديلات 05-B المتزامنة.

قُرئت README، و`package.json`، و`pnpm-lock.yaml`، وCI، و`scripts/readiness.mjs`، وتقرير الجاهزية 05-A وسجل الموانع وتسليم 05-B. لم يغير هذا التدقيق مصدر التطبيق أو الاختبارات أو الاعتماديات. أثبت فحص ما بعد التشغيل عدم اختلاف ملفات src/scripts/package/lock/إعدادات البناء عن الأرشيف؛ انظر `evidence/baseline/source-integrity.json`.

## البيئة والأدوات

| الأداة | النسخة/الحالة المتحققة |
|---|---|
| النظام | macOS 27.0.1، build 26A434، arm64 |
| Node.js | v24.22.1 عبر `/tmp/mulazama-baseline/bin/node` |
| Corepack | 0.36.0 |
| pnpm المطلوب | 11.25.0 في packageManager وCI؛ تعذر bootstrap بسبب DNS |
| TypeScript | 5.9.3 |
| Vite | 7.1.12 |
| Vitest | 3.2.4 |
| React / ReactDOM | 19.2.0 / 19.2.0 |
| Playwright | 1.56.1 |
| axe-core Playwright | 4.10.2 |
| JSDOM | 26.1.0 |
| Python | 3.9.6 |
| Chrome المثبت | 151.0.7922.174؛ قراءة بيانات التطبيق فقط، لم يُشغّل اختبار متصفح |
| Safari المثبت | 27.0.1؛ قراءة بيانات التطبيق فقط، لم يُشغّل اختبار متصفح |

استُخدم Node المنسوخ والموقع محليًا الذي أعدته جلسة العمل لتجنب خطأ توافق توقيع Node الأصلي مع native addons. لم نغير إصدار المكتبات أو نُنزّل اعتماديات بديلة.

## الأوامر والنتائج الفعلية

الأوامر أدناه نُفذت بملفات CLI المحلية المكافئة لنصوص package لأن pnpm غير متاح دون bootstrap. المسارات الدقيقة، وقت البدء، والمدة والخروج محفوظة في `environment-runs.json` و`verification-runs.json` و`browser-runs.json` داخل evidence/baseline.

| العملية | الأمر/المكافئ | الخروج | النتيجة |
|---|---|---:|---|
| تثبيت مقفل | `node <corepack.js> pnpm install --frozen-lockfile --store-dir /tmp/mulazama-05b-baseline/pnpm-store` | 1 | Blocked قبل تشغيل pnpm: ENOTFOUND registry.npmjs.org |
| فحص DNS مستقل | `curl --head --connect-timeout 5 --max-time 10 https://registry.npmjs.org/pnpm` | 6 | تعذر حل اسم المضيف |
| TypeScript | `node node_modules/typescript/bin/tsc -b` | 0 | ناجح |
| جميع الاختبارات | `node node_modules/vitest/vitest.mjs run --reporter=json --outputFile=<baseline/unit-results.json>` | 0 | 299 ناجح، صفر فشل، صفر معلق أو todo |
| فحص أمن محدود | `node scripts/security-check.mjs` | 0 | 27 ملفًا، صفر نتائج في الأنماط المحددة |
| البناء | `node node_modules/typescript/bin/tsc -b` ثم `node node_modules/vite/bin/vite.js build` ثم `node scripts/build-offline.mjs` | 0 لكل خطوة | بناء إنتاجي وغلاف offline مولد |
| تحقق ملفات البناء | `node scripts/verify-build.mjs` | 0 | MULAZAMA وRTL و4 أصول offline، لا مفتاح prototype |
| بوابة الإنتاج الأصلية | `node scripts/readiness.mjs` | 1 | فشل مقصود؛ productionReady=false |
| اكتشاف المتصفح | `node node_modules/@playwright/test/cli.js test --list` | 0 | ست حالات في ملفين؛ الاكتشاف ليس تنفيذًا |
| E2E | `node node_modules/@playwright/test/cli.js test` | 1 | الخادم مرفوض بـEPERM على 127.0.0.1:4173، قبل أول حالة |
| Offline | `node node_modules/@playwright/test/cli.js test --config playwright.offline.config.ts` | 1 | preview مرفوض بـEPERM على 127.0.0.1:4174، قبل أول حالة |
| تدقيق اعتماديات أمني | `node <corepack.js> pnpm audit --prod --json` | 1 | Blocked أثناء bootstrap؛ لا تقرير advisories ناجح |

**لا توجد اختبارات متصفح ناجحة من هذا التشغيل.** عدد حالات المتصفح المنفذة فعليًا صفر؛ لا تعامل الست المكتشفة أو فحوص IndexedDB الداخلية أو axe باعتبارها ناجحة أو متجاوزة داخل runner. المانع وقع قبل التنفيذ. اختبار offline منفصل ولم يبدأ أيضًا.

## توزيع اختبارات Vitest

| الملف | الناجح | الفاشل/المعلق |
|---|---:|---:|
| `src/components.test.tsx` | 30 | 0 |
| `src/application/learning.test.ts` | 16 | 0 |
| `src/application/performance.test.mjs` | 1 | 0 |
| `src/application/service.test.ts` | 11 | 0 |
| `src/application/validation.test.ts` | 75 | 0 |
| `src/content/content-gate.test.ts` | 7 | 0 |
| `src/core/fsrs.test.ts` | 20 | 0 |
| `src/core/hme.test.ts` | 65 | 0 |
| `src/domain/domain.test.ts` | 33 | 0 |
| `src/persistence/backup.test.ts` | 13 | 0 |
| `src/persistence/event-store.test.ts` | 18 | 0 |
| `src/platform/platform.test.ts` | 10 | 0 |
| **المجموع** | **299** | **0** |

التقرير يتضمن 12 ملف اختبار. قيمة `numTotalTestSuites=34` في JSON تتضمن مجموعات describe، فلا تعني 34 ملفًا. اختبار حسابي واحد يحتوي 240 تركيبًا لا يحوّلها هذا التقرير إلى 240 اختبارًا إضافيًا.

## المقارنة مع 05-A

- أعيدت نتيجة 299/299 بلا فشل أو تعليق أو todo. أسماء الحالات تطابقت بعد استبعاد التاريخ التشغيلي وحده من اسم حالة ES13 التي تطبع كائن Date ضمن parameterized test؛ لم يغيّر أي مصدر أو توقع اختبار لهذا الغرض.
- جميع ملفات المصدر المشمولة في مقارنة الأرشيف بقيت مطابقة. الملفات الخمسة ذات البصمات المسجلة للمراجعة المستقلة السابقة تطابقت أيضًا.
- **21 تحققًا مستقلًا:** توجد نتائج JSON تاريخية وتقرير، ولكن الأرشيف لا يحتوي runner مستقلًا لتلك الإعادات؛ لذلك لم يُعد تشغيلها ولم نمنحها نجاحًا جديدًا. تطابق بصمات المصدر لا يعادل إعادة تنفيذها. يلزم تسليم runner أو إعادة بناء حالات مستقلة موثقة لإعادة تنفيذ هذا الدليل.
- أعيد البناء مطابقًا بايتًا ببايت لكل ملفات dist الستة في الأرشيف، بحسب `build-artifacts.json`. JavaScript حجمه 332969 بايت وCSS حجمه 23936 بايت. ذكر التقرير القديم 332.96kB؛ الأرشيف نفسه وإعادة البناء يعرضان 332.97kB بالتقريب. لا توجد هنا فجوة source/build.
- استمر تعذر التثبيت المقفل والتدقيق الشبكي واختبارات المتصفح/IndexedDB/offline بسبب البيئة. لم يتغير هذا إلى نجاح.
- أوامر CI مكتوبة فقط؛ لم يشغل هذا التدقيق خدمة GitHub Actions خارجية.

## المعمارية والحدود الموجودة في baseline

React Web وTypeScript وVite، ونواة واحدة للحفظ والجدولة، مع IndexedDB مشفر للويب ومرجع ذاكرة للاختبارات. لا مكتبة FSRS مثبتة في baseline، والجدولة البحثية معلنة غير معتمدة. لا حزمة قرآن إنتاجية معتمدة، ولا ملفات خطوط أو صوت قرآني مرفقة. جلسات المحتوى ما زالت محجوبة. لا تنسب اختبارات الوحدة الصناعية إلى مصحف معتمد أو إلى صدق تربوي مثبت.

لم تُختبر معاملات IndexedDB الحقيقية أو فقد الطاقة. نجاح نسخ AES-GCM على المرجع المعاملاتي لا يثبت سلامة متصفح أو هاتف. سكربت readiness الأصلي قائمة موانع ثابتة؛ لا يكفي هذا التصميم وحده لتلبية شرط بوابات إصدار مرتبطة بالأدلة في 05-B.

## حالة iOS وAndroid

`xcode-select -p` أعاد CommandLineTools فقط. `xcodebuild -version` خرج1 لغياب Xcode الكامل. `adb` و`sdkmanager` غير موجودين في PATH، و`java -version` أخفق لعدم وجود Runtime. مواقع Xcode/Android Studio/SDK القياسية التي فُحصت غير موجودة؛ متغيرات Android/Java SDK لم تكن مضبوطة. لا ملفات مشروع iOS/Android/Capacitor/Flutter فعلية في المصدر المفحوص.

وعليه: لا بناء أو تثبيت أو تشغيل أو محاكي أو اختبارات تخزين/إشعار أصلية أُنجزت. يلزم مشروع منصة فعلي وأدواته وأجهزة/محاكيات مناسبة. تفاصيل الإثبات في `native-source-inventory.json` وسجلات الأدوات. نجاح الويب لا يمنح توافق الهاتف.

## الأمن والتراخيص

اجتاز المصدر الفحص المحدود الموجود أصلًا: ثلاث عائلات أسرار وأنماط imports للنموذج التجريبي، في27 ملفًا. لا يجعل غياب نتائجه النظام آمنًا مطلقًا؛ لا تدقيق advisories ناجح ولا penetration test أو مفاتيح أصلية اختبرت. العزل والتخزين same-origin لا يمنعان XSS أو متصفحًا مخترقًا؛ تستمر مراجعة الأمن المتخصصة.

حُصرت محليًا 171 حزمة مثبتة مميزة بالاسم/النسخة، بينها جميع16 اعتمادًا مباشرًا للتشغيل والتطوير. يشمل `licenses.json` التصريحات وبصمات ملفات LICENSE/NOTICE ومرجع package.json؛ و`licenses.md` جدولًا مباشرًا. لا LICENSE/NOTICE جذري للمشروع؛ شروط توزيع الشيفرة تحتاج قرار المالك. لا ملفات خط/صوت مرفقة. لا يثبت هذا جواز إعادة توزيع أي مصدر قرآن مرشح أو اعتماد رخصته. الفحص الشبكي للتنبيهات والرخص الأصلية لم ينجح بسبب DNS.

## الأداء المحدود

أعاد الاختبار الصناعي القياس على Node/macOS، والنتائج الخام في `evidence/baseline/performance-results.json`: 1000 مرشح نحو2.04ms، إلحاق10000 حدث بمرجع الذاكرة نحو921.30ms، قراءتها نحو46.26ms، replay لمنتج100حدث نحو4.67ms. هذه لقطة تشغيل واحدة وليست P95 أو أداء IndexedDB أو بدء تطبيق بارد أو ذاكرة هاتف أو أداء مصحف. لا تستعملها لإغلاق بوابة تخزين أو منصة أو أداء UI.

## خلاصة القبول لهذا التدقيق

النتيجة البرمجية الأصلية قابلة لإعادة البناء والتشغيل في وحدة/DOM ضمن هذه البيئة، ولا تغير اختبار لإظهار نجاح. يظل الحكم على **baseline الأصلي: غير جاهز**؛ البوابات غير المغلقة هي اعتماد المحتوى، مطابقة مكتبة FSRS، التخزين والمتصفح/offline الحقيقي، الاختبار البشري/العلمي، والمنصات الأصلية والأمن الشبكي. تستخدم هذه النتيجة كنقطة مقارنة لإصلاحات 05-B، لا كتقرير نهائي لتلك الإصلاحات.

## أدلة التدقيق

- `evidence/baseline/isolation.json`
- `evidence/baseline/environment-runs.json` والسجلات المرتبطة
- `evidence/baseline/verification-runs.json` و`unit-results.json` و`test-summary.json`
- `evidence/baseline/source-integrity.json` و`build-artifacts.json`
- `evidence/baseline/browser-runs.json` و`browser-availability.json`
- `evidence/baseline/dependency-audit-run.json`
- `evidence/baseline/native-source-inventory.json`
- `licenses.json` و`licenses.md`
