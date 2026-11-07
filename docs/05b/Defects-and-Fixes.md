# MULAZAMA — Phase 05-B Defects, Fixes & Open Blockers

**التاريخ:** 2026-11-05 UTC. الشدة أدناه ترتيب هندسي بحسب أثر الخلل في صدق الأدلة وسلامة البيانات؛ ليست CVSS. كلمة Verified تعني النطاق المحدد في عمود الاختبار، ولا تمنح اعتماد قرآن أو متصفح أو منصة. لا تُجمع مجموعات الاختبارات المتداخلة لزيادة العدد.

نجح تشغيل الدمج الشامل النهائي: **464/464 حالة في 22 ملف اختبار، و55 مجموعة بحسب عداد Vitest، دون فشل أو تجاوز**؛ الدليل `evidence/final-tests.json`. هذا تشغيل وحدات/تكامل/DOM ولا يغلق البوابات التي تتطلب متصفحًا أو اعتمادًا مستقلًا.

## أدلة التشغيل المستخدمة

| الرمز | الملف/النتيجة الفعلية |
|---|---|
| H-before | `evidence/hme-regressions-before.json`: عشر حالات فشلت قبل إصلاح المصدر |
| H-cluster | `evidence/hme-cluster-regression-before.json`: HV08 و HV05 فشلتا؛11 نجحت |
| H-after | `evidence/hme-application-final.json`:110 نجحت؛16 تعلم سابقة +24 تحقق أدلة جديدة +5 رحلات +65 نواة سابقة |
| P-before | `evidence/persistence-regression-before.txt`:9 فشلت و 1 نجحت |
| P-after | `evidence/persistence-regression-after.txt`:33 نجحت؛18 سابقة و 15 جديدة؛ MemoryEventStore/validators/pure migration |
| B-after | `evidence/backup-regression-after.txt`:24 نجحت؛13 سابقة و 11 جديدة؛ Web Crypto في Node ومخزن مرجعي |
| PR-before | `evidence/product-replay-before.json`:24 فشلت من 28 حالة جديدة |
| PR-after | `evidence/product-replay-after.json`:115 نجحت؛29 جديدة و 11 service و 75 validation؛ أضيفت PR05B21 لإثبات توافق reset القديم |
| RG-after | `evidence/release-gates-tests.json`:18 حالة gates و 11 service نجحت؛ بيانات توقيع اختبارية مصطنعة |
| Q-after | `evidence/content-integrity-tests.json`:32 نجحت؛25 integrity جديدة و 7 gate سابقة؛ بيانات SYNTHETIC NON-QURAN |
| Q-tools | `evidence/content-tool-checks.json`:7 تحققات CLI صناعية نجحت؛ التدقيق القرآني الحقيقي في content-byte-audit.json محجوب |
| F-after | `evidence/fsrs-tests.json`:53 نجحت؛20 حسابًا بحثيًا سابقًا و 33 مقارنة/سلامة أداة؛ ليست مطابقة مكتبة upstream |

لم يُحفظ stdout كامل لتشغيل backup الأول ذي 8 إخفاقات و 3 نجاحات؛ يذكر تقرير النسخ الملاحظة كما حدثت ولا يصطنع before-log. السجل الوسيط `backup-integration-intermediate.txt` يحفظ 23 نجاحًا وفشلًا واحدًا أثناء تغيير واجهة التعلم؛ أصلح مرجع النسخة وأعيد التشغيل بنجاح 24. سجلات التكامل الأولية التي احتوت أخطاء توصيل اختبار جديد موضحة في HME-Integration-Report ولا تصنف كلها عيوب منتج.

## عيوب HME التي أصلحت

جميع الملفات المشار إليها نسبية إلى جذر المشروع. التفاصيل العددية ومعنى كل دليل في HME-Integration-Report.

| ID | الشدة | السبب الجذري والأثر | ملف الإصلاح | Test IDs | دليل قبل/بعد | الحالة وحدودها |
|---|---|---|---|---|---|---|
| HME-B01 | عالية | عدم مطابقة مصدر/وحدة/تغطية/منطقة غلاف التقييم للأمر يسمح بوصف أدلة غير صحيح | `src/application/learning.ts` و`learning-validation.ts` | HV01 بأربع حالات | H-before / H-after | Implemented & Verified صناعيًا؛ V1 يبقى ذاتيًا |
| HME-B02 | متوسطة | قبول حقول ملاحظة مجهولة وإسقاطها بصمت | `src/application/learning-validation.ts` | HV02 | H-before / H-after | Implemented & Verified بالمخططات المغلقة |
| HME-B03 | عالية | مساواة attempt ID جديد بفرصة اختبار مستقلة رغم تكرار الهدف | `src/application/learning.ts` | HV03، LA15 | H-before / H-after | Implemented & Verified لهوية الفرصة والعنقود والاستئناف المرجعي |
| HME-B04 | عالية | تبديل opportunityId مع نفس evidenceClusterId يحدث FSRS مرتين | `src/application/learning.ts` | HV08 | H-cluster / H-after | Implemented & Verified؛ لا يثبت مطابقة معادلات FSRS للمكتبة |
| HME-B05 | عالية | محاولة منقطعة ثم جلسة جديدة تفقد أثر التعرض وعدم اليقين | `src/application/learning.ts` | HV04، LA06/14/15 | H-before / H-after | Implemented & Verified؛ لا Again مختلق؛ ليس power-loss فعليًا |
| HME-B06 | عالية | refresh يستورد محاولة نشطة ثم يسمح بإكمالها كأن الانقطاع لم يحدث | `src/application/learning.ts` | HV05 | H-before/H-cluster / H-after | Implemented & Verified في التطبيق المرجعي |
| HME-B07 | متوسطة | تعريف وحدة يقبل مفاتيح تغطية مكررة | `src/application/learning-validation.ts` | HV06 | H-before / H-after | Implemented & Verified بنيويًا؛ ربطها بمحتوى معتمد مستقل |
| HME-B08 | عالية | caller يختلق مرشحًا/موعدًا أو يسقط دين مراجعة من planned و deferred معًا | `src/application/learning.ts` و`learning-validation.ts` | HV07/11/12، HI05 | H-before / H-after | Implemented & Verified؛ مصادر الكلفة والمرشحين تحتاج اعتمادًا |
| HME-B09 | عالية | حدثان مختلفان بنفس commandId يضاعفان أثر التعلم عند replay/restore | `src/application/learning.ts` | HV09/10، BK05B10 | repro تكاملي موضح بتقرير النسخ / H-after و B-after | Implemented & Verified مع حفظ أصل البيانات في المرجع؛ actualIDB لاحق |
| HME-B10 | عالية | فرض chunk على اختبارات link/connected/random-start يطبق profile غير مناسب | `src/application/learning.ts` و`learning-validation.ts` | HI04، HV17 بثلاث حالات | مراجعة/اختبارات جديدة / H-after | Partially Implemented؛ probe منفصل، وحجب FSRS لغير chunk حتى اعتماد profile |
| HME-B11 | عالية | إصلاح معنى الأدلة يمكن أن يعيد تفسير الخام التاريخي بصمت | `src/core/types.ts` و`src/application/learning.ts` | HV13 | مراجعة semantics / H-after | Implemented & Verified للحجب؛ هجرة 05A التعليمية غير معتمدة |
| HME-B12 | عالية | command/options قابلة للتعديل بعد send وقبل تنفيذ الطابور | `src/application/learning.ts` | HV15 | اختبار انحدار جديد / H-after | Implemented & Verified؛ نسخ وتحقق قبل await |

## التخزين والنسخ

| ID | الشدة | السبب الجذري والأثر | ملف الإصلاح | Test IDs | دليل قبل/بعد | الحالة وحدودها |
|---|---|---|---|---|---|---|
| P-01 | عالية | Date.parse يطبع February30 و 24:00 إلى زمن مختلف بدل الرفض | `src/persistence/event-store.ts` | P05B01 بثلاث حالات، P05B04 | P-before / P-after | Implemented & Verified validator؛ IDB16 لم ينفذ |
| P-02 | عالية | getter يغير القيمة بين validation و structuredClone | `src/persistence/event-store.ts` | P05B02 | P-before / P-after | Implemented & Verified؛ لا يستدعى getter |
| P-03 | عالية | sparse/extra-property arrays و hidden/symbol/reserved keys لا تحفظ المعنى عبر JSON | `src/persistence/event-store.ts` | P05B03 بخمس حالات | P-before / P-after | Implemented & Verified validator |
| P-04 | متوسطة | فحص CryptoKey السابق لا يثبت AES256 أو usage المطلوبة | `src/persistence/event-store.ts` | IDB14 | مراجعة مصدر؛ browser fixture مكتوب | Implemented but Not Verified فعليًا |
| P-05 | منخفضة/أداء | نسخ مجموعة الأمر في كل إضافة يؤدي نموًا تربيعيًا لدفعة كبيرة | `src/persistence/event-store.ts` | اختبارات المجموعة العامة | مراجعة الحلقة / P-after | Implemented؛ لم يقس أداء IndexedDB الفعلي |
| P-06 | عالية/توافق | collation الافتراضي يغير fingerprint عند تغيير لغة النظام | `src/persistence/event-store.ts` | P05B05–09، IDB19–21 | مقارنة en/sv و en/tr/da؛ pure tests / P-after | Partially Implemented؛ DBv3 وترحيل صريح جاهزان، actual migration غير متحقق |
| BK-01 | عالية | Date/Map تتحول إلى{} عند canonical مع قبول التصدير | `src/persistence/backup.ts` | BK05B01–03 | ملاحظة تشغيل أول غير محفوظ / B-after | Implemented & Verified؛ رفض JSON غير الأمين والدورات |
| BK-02 | متوسطة | حقول رأس زائدة غير مصادق عليها أو حمولة مجهولة مقبولة | `src/persistence/backup.ts` | BK05B04/10 | ملاحظة أولية / B-after | Implemented & Verified بمخططات صيغة 1 مغلقة |
| BK-03 | عالية | قبول snapshot fields لا تستعيدها replace يوهم بنسخة كاملة | `src/persistence/backup.ts` | BK05B05 | ملاحظة أولية / B-after | Implemented & Verified؛ نسخ معروفة exact فقط |
| BK-04 | منخفضة | خيارات restore ناقصة ترمي TypeError غير مصنف | `src/persistence/backup.ts` | BK05B06 | ملاحظة أولية / B-after | Implemented & Verified؛ INVALID_INPUT قبل الكتابة |
| BK-05 | متوسطة | malformed UTF-16 في السر يتحول إلى U+FFFD فينشئ alias نصيًا مختلفًا | `src/persistence/backup.ts` | BK05B07/08 | ملاحظة أولية / B-after | Implemented & Verified؛ رفض غير القابل لـ UTF8 round-trip |
| BK-06 | متوسطة | ضرورة فصل رفض UTF8 تالف عن فشل GCM لضمان اختبار parser الحقيقي | `src/persistence/backup05b.test.ts` | BK05B09 | fixture مصادق عليه / B-after | Verified negative test؛ ليس عيب تشفير مكتشفًا |

## حد سجل المنتج وبوابة الإصدار

| ID | الشدة | السبب الجذري والأثر | ملف الإصلاح | Test IDs | دليل قبل/بعد | الحالة وحدودها |
|---|---|---|---|---|---|---|
| PR-01 | عالية | replay يقبل duplicate event/command أو إعادة استخدام أمر التهيئة | `src/application/product-replay-validation.ts` و`service.ts` | PR05B02–07 | PR-before / PR-after | Implemented & Verified؛ الخام المخالف يرفض بلا dedup صامت |
| PR-02 | عالية | تفضيلات منتج تحمل V4 أو unit/coverage مزعومة وتقبل نسختها | الملفات نفسها | PR05B08–12/20 | PR-before / PR-after | Implemented & Verified؛ لا ادعاء إتقان واجهة ثبت قبل الإصلاح |
| PR-03 | عالية | غياب مخطط raw snapshot/versions/init/body وحدود UTC | الملفات نفسها | PR05B10/13–17 | PR-before / PR-after | Implemented & Verified؛ reset القديم متوافق في PR05B21 |
| PR-04 | عالية | generatedIDs مكررة أو زائدة، وحقول getter قبل قراءة الغلاف | الملفات نفسها | PR05B18/19 | PR-before / PR-after | Implemented & Verified؛ الأصل لا يتغير |
| RG-01 | عالية/حماية إطلاق | الجاهزية لا يجوز استنتاجه من Boolean ثابت أو حجب واجهة مع سماح الخدمة | `src/release/gates.ts` و`access.ts` و`runtime.ts` و`src/application/learning.ts` | RG01–18 | مراجعة baseline / RG-after | Implemented & Verified للآلية الصناعية؛ جميع جهات الثقة والأدلة الحقيقية غائبة والبوابات محجوبة |

## موانع لم تتحول إلى إصلاح مكتمل

| ID | الشدة | الواقع الحالي | الدليل | ما يلزم للإغلاق | الحالة |
|---|---|---|---|---|---|
| BL-Q01 | حرجة لفتح القرآن | لا بايتات ناشر/مرجع/خط/خريطة معتمدة أو موافقة مختص؛ آلية integrity جديدة تنجح على نصوص صناعية فقط | Quran-Content-Integrity-Report،Q-after/Q-tools | مصدر محدد ورخصة وعد وطبعة ومقارنة مستقلة ومراجعة عرض وتوقيع موثوق | Blocked؛ G01/G10 |
| BL-F01 | عالية لجدولة إنتاجية | لم تصل حزمة ts-fsrs 5.4.2 المرجعية أو تثبت golden vectors | FSRS-Conformance-Report؛23 blocked / 0 upstream comparisons | package/commit/SRI مثبتة، تشغيل المكتبة ومراجعة فروق وثبات replay | Blocked؛ G02 |
| BL-D01 | عالية | لا تنفيذ IndexedDB فعلي أو قطع عملية أو هجرة أو restore بالمتصفح | browser05b/e2e.log،P-report | تشغيل IDB01–21 و load/reopen/rollback/synthetic load ببيئة مسموحة | Blocked؛ G04/G05 |
| BL-W01 | عالية | 15 حالة E2E و offline مكتوبة؛ الحالات المنفذة صفر بسبب EPERM | Browser-E2E-Report و runs.json | متصفح حقيقي ومسارات موجبة معتمدة وسجلات traces | Blocked؛ G06/G07 |
| BL-A01 | متوسطة/إتاحة | لا axe متصفح أو قارئ شاشة أو مراجعة بشرية | Accessibility-Report | فحوص WCAG/keyboard/zoom والمصحف والتسميع المخفي على المنصات | Blocked؛ G08 |
| BL-S01 | عالية | scan محدود 39/0؛ تدقيق advisories لم يعمل | Security-Report و security-static-final.json | تدقيق اعتماديات وأذونات ومفاتيح واستعادة ومراجعة أمنية مستقلة | Blocked؛ G09 |
| BL-N01 | عالية قبل ادعاء هاتف | لا مشروع Android/iOS أو أدواته أو بناؤه | Platform-Verification-Report | حزمة منصة ونواة واحدة وأجهزة/محاكيات وتخزين وصلاحيات native | Not Implemented/Not Verified |

هذه السجلات لا تسند صدقًا تلقائيًا إلى تقييم ذاتي أو إتقان من تكرار. جميع اختبارات التعلم الناجحة صناعية، و G01/G02/G04/G05/G06/G07/G08/G09/G10 تحتاج أدلة مستقلة بحسب سياقها مهما زاد عدد الوحدات الناجحة. الحكم النهائي للمشروع في تقرير 05-B الرئيسي، ولا يلغيه إغلاق عيب مرجعي منفرد.
