# مُلازَمَة — MULAZAMA · Phase 05-C

**الحكم: غير جاهز.** مصدر هندسي محدث من05-B؛ لا نشر عام أو تسجيل مثبت للنطاق المستهدف mulazama.com. جلسات القرآن الحقيقية تبقى محجوبة.

ابدأ من [تقرير الجاهزية05-C](docs/05c/MULAZAMA-Phase-05C-Engineering-and-Content-Verification-Report.md)، ثم [التحقق النهائي](docs/05c/Final-Verification.md) و[بوابات الإصدار](docs/05c/Release-Gates.md).

## التشغيل وإعادة التحقق

Node24+ وpnpm11.25.0. القفل يتضمن ترقيات أمنية مضبوطة Vite7.3.7 وVitest4.1.12؛ React19.2.0 وTypeScript5.9.3 وPlaywright1.56.1 لم تتغير. لا تستخدم node_modules من إصدار آخر.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm security:check
pnpm build
pnpm verify:build
pnpm readiness:production
pnpm dev
```

رمز2 في readiness يعني Blocked وليس Passed. افتح localhost الذي يعرضه Vite؛ لا تفتح index.html عبر file. تعليمات Mac القديمة start-mulazama.command متاحة، لكنها لا تمنح اعتماد تشغيل أو إنتاج.

## ما نفذ

- تنزيل مرجع ts-fsrs5.4.2 الفعلي وبصماته وشهادة منشأه؛ مرشح حسابي جديد versioned يطابق23/23. التنفيذ القديم المختار في HME مختلف بالتقريب؛ الجديد غير منتخب حتى ترحيل ومراجعة مستقلة.
- جسر واجهات S07–S13 typed إلى خدمة التعلم، مع اختبارات React وخدمة فعلية ببيانات صناعية محصورة. main لا يحقن صلاحية اختبار أو بيانات صناعية في الإنتاج.
- تثبيت نظيف مجمد ناجح؛ ترقيات اعتماديات موثقة وتدقيق شبكي نهائي بلا advisories معلنة وقت الفحص. هذه ليست مراجعة اختراق شاملة.
- تقارير وأدلة المتصفح والتخزين والمحتوى والبوابات؛ لكل نتيجة نطاقها وحدودها.

[مرجع FSRS](docs/05c/FSRS-Reference-Conformance-Report.md)، [HME](docs/05c/HME-Integration-Report.md)، [المتصفح](docs/05c/Browser-Playwright-Report.md)، [التخزين والنسخ](docs/05c/Browser-Persistence-and-Backup-Verification.md)، [المحتوى](docs/05c/Quran-Content-Verification.md)، [الأمن](docs/05c/Security-Report.md)، [المنصات](docs/05c/Platform-Status-Report.md)، [المصفوفة](docs/05c/Requirements-Matrix.md).

## الحدود

لا توقيع علمي بشري أو مصحف إنتاجي معتمد أو إثبات تفوق تربوي. لا مشروع iOS/Android مبني أو مجرب. نجاح حساب FSRS لا يثبت صحة القرآن أو تحقق الإتقان. لا ترفع بيانات المستخدم أو التسجيلات تلقائيًا. المفتاح غير القابل للاستخراج لا يمنع XSS أو الوصول من جلسة مفتوحة. تقارير05a/05b تاريخية؛ النتائج الحالية فقط تحت docs/05c.
