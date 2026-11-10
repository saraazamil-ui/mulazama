# Mushaf Index — تصميم الفهرس المستقل، 10-A

**الحالة: مقترح غير منفّذ وغير معتمد.** المرجع الهندسي `06-L4`، والشجرة المقروءة `4bd359de434c6395f416388679adebe13128c8a0`. لا تُفعّل هذه الوثيقة محتوى أو صلاحية تعلم، ولا تغيّر `productionReady=false` أو حجب G01–G10. نتائج اكتشاف الموارد وحقوقها في [تقرير المصادر](Official-Mushaf-Sources.md)، وحسم المطابقة في [مقارنة المصادر](Mushaf-Source-Comparison.md).

## 1. الحدود القائمة التي يجب حفظها

- `CanonicalUnit` في [`src/application/learning.ts`](../../src/application/learning.ts) يحمل `id` و`editionId` و`probeProfileVersionId` و`words` و`coverage`. الفهرس قارئ لهذه القيم، وليس مولّدًا بديلًا لها.
- [`createApprovedJourneyMaterial`](../../src/content/journey-material06l3.ts) يربط الوحدة ببيان محتوى معتمد؛ مفاتيح التغطية الحالية `${editionId}:${surah}:${ayah}:${tokenIndex}` مرتبة، وعددها يطابق `words`. نص الجلسة قصّ حرفي من المصدر بحدود UTF-16 المعتمدة، وليس نصًا يولّده العارض.
- [`validateJourneySourceOrder`](../../src/content/journey-order06l4.ts) يرفض الانعكاس والتكرار والتداخل وتغيير الحدود، ويسمح بفجوات مرتبة مع التصريح بها. وجود أول موضع وآخر موضع لا يثبت اتصال ما بينهما.
- [`ContentGate`](../../src/content/content-gate.ts) يطلب هوية إصدار ونصًا وخريطة وخطًا وبصمات واعتمادًا مستقلاً. سجل سلطات المحتوى موثوقته فارغة في المصدر الحالي. لا يكفي تمرير فهرس صفحات جديد لتجاوز هذا العقد.
- [`LearningUiAdapter.progress`](../../src/application/learning-ui-adapter.ts) يرفض جمع التغطية بين طبعات مختلفة دون خريطة معتمدة. لا يُستخدم فهرس العرض لتغيير هذا القرار.
- يثبت [`src/core/types.ts`](../../src/core/types.ts) نسخ تفسير الأحداث. تبقى إعادة التشغيل والنسخ الاحتياطية في [`composite-application.ts`](../../src/application/composite-application.ts) و[`backup.ts`](../../src/persistence/backup.ts) على العقود الأصلية.

المصدر الحالي مرشح محتوى، وليس مصحفًا إنتاجيًا معتمدًا. تصميم الربط أدناه لا يفترض وجود فهرس رسمي مكتمل أو حزمة حاصلة على الاعتماد الآن.

في فحص 10-A لم تُنزّل حزمة رسمية لفحصها؛ بقي الوصول المباشر محجوبًا، وما ثبت من أوصاف الموارد لا يثبت محتوياتها. حتى لو أعلن مورد النص حقولًا مثل `page` و`line_start` و`line_end`، فلا تُساوى بصفحات مورد آخر قبل إثبات توافق الإصدارين. كذلك `line` في فهرس المصدر النصي الحالي هو رقم سجل TXT، وليس سطر المصحف. المرجع التفصيلي لحالة كل ادعاء هو [تقرير المصادر](Official-Mushaf-Sources.md) و[مقارنة المصدر](Mushaf-Source-Comparison.md).

## 2. فصل الهويات

| الهوية المقترحة | معناها | ما لا تعنيه |
|---|---|---|
| `sourceEditionId` | نسخة `editionId` الموجودة حرفيًا في الوحدة/السجل | لا تُستبدل بهوية صفحات المجمع |
| `mushafReleaseId` | إصدار مورد الصفحات المحدد ببيان الناشر والبصمات | لا يساوي تلقائيًا إصدار النص أو الخط |
| `textResourceId` / `fontResourceId` | موارد مستقلة، إن استُخدمت | الاسم المشترك أو الجهة المشتركة لا يثبت توافقها |
| `indexVersion` | نسخة عقد الفهرس ومحتوى الربط | لا تغيّر `schema` أو نسخة HME/FSRS |
| `crosswalkId` | خريطة مثبتة بين مفاتيح المصدر الحالي ومواضع المورد المرشح | لا تنقل سجل تعلم إلى طبعة أخرى |
| `bundleDigest` | SHA-256 لبيان إصدار العرض المحدد | بصمة سلامة؛ ليست اعتمادًا علميًا |

تُعرّف نسخة العرض بتجميعة صريحة من موارد مستقلة: بصمة حزمة الصفحات + فهرس الصفحات + خريطة الربط + مورد النص البديل المعتمد عند توفره + دليل التوافق. لا يُستنتج التوافق من توافق الأرقام وحده. لا يستخدم الفهرس الحقل `editionId` بمعنيين؛ يعرض `sourceEditionId` للربط و`mushafReleaseId` للمصحف.

## 3. طبقات العقد المقترح

هذا عقد تصميم، وليس ملف TypeScript أو JSON Schema مضافًا إلى التطبيق. في التنفيذ اللاحق يلزم مدقق وقت تشغيل يقبل الحقول المعلنة فقط، ولا يعتمد على TypeScript وحده.

### أ. بيان مورد المصحف `MushafReleaseManifest`

| الحقل | النوع والقيد |
|---|---|
| `schemaVersion`, `kind` | `1`؛ `official` للإنتاج أو `synthetic` للاختبار المعزول فقط |
| `mushafReleaseId` | معرف داخلي ثابت يربط وصف الناشر ببصمات محددة؛ لا يُختلق رقم إصدار رسمي |
| `publisher`, `riwaya`, `script`, `verseNumbering` | قيم موثقة، مع مرجع دليل لكل قيمة؛ المجهول `null` مع سبب |
| `printedEdition`, `digitalVersion`, `publicationDate` | حقول منفصلة؛ تاريخ تنزيل الملف ليس تاريخ إصدار المصحف |
| `resources[]` | هوية المورد، نوعه، رابط المصدر والرابط النهائي، وقت الحصول UTC، الحجم الفعلي بالبايت، صيغة/MIME متحقق منها، SHA-256، حالة حقوقه ودليلها |
| `pageCount`, `surahCount`, `ayahCountsBySurah` | قيم مستخرجة ومراجعة من المورد المحدد، لا ثوابت تُنسخ من مورد آخر |
| `pageSequence[]` | الترتيب المقروء؛ يفصل الرقم المصحفي عن الغلاف والصفحات التمهيدية وترقيم PDF |
| `approvalRefs` | مراجع اعتماد محددة النطاق والبصمة؛ لا تجعل `status: approved` وحدها صلاحية |

لا يقبل مُفعِّل نسخة إنتاجية الحقول العلمية الأساسية المجهولة. يحق لمساحة الفحص الاحتفاظ بمرشح ناقص، مع استحالة استخدامه في جلسة تعلم. لا يُستبدل الملف الرسمي أو يُحوّل تلقائيًا إلى صيغة ويب قبل إثبات حق التحويل واعتماد ناتجه.

### ب. سجل الصفحة `PageRecord`

`{ pageId, mushafReleaseId, pageNumber, printedLabel, assetRef, sourceDocumentPageIndex, contentKind, dimensions, sha256, byteLength, firstPosition, lastPosition }`.

- `pageNumber` رقم الصفحة المصحفية؛ `sourceDocumentPageIndex` فهرس حاوية PDF إذا كانت الحزمة مستندًا متعدد الصفحات، وإلا `null`. لا يحل أحدهما محل الآخر.
- `assetRef` معرّف في البيان، وليس URL حرًا يورده المستخدم. ملف مستقل لكل صفحة ليس افتراضًا؛ يمكن أن يكون المصدر PDF أو SVG أو غيرهما وفق الفحص الفعلي.
- `contentKind` يميز `quran-page` و`front-matter` و`back-matter`. الأغلفة لا تدخل عداد صفحات النص.
- الأبعاد والصيغة والحجم تؤخذ من الملف. إذا احتاج العرض مشتقًا مصرحًا به، يسجل مشتقًا بهويته وبصمته و`derivedFrom` وإجراء التحويل؛ يبقى الأصل محفوظًا.
- `firstPosition` و`lastPosition` لا يثبتان وحدهما وجود كل المواضع بينهما؛ تأتي قائمة المقاطع من الخريطة أدناه.

### ج. مرجع الموضع ومقاطع الآية

```ts
// وصف عقد مقترح فقط، ليس شفرة تنفيذية.
type Position = { surah: number; ayah: number };
type Placement = {
  placementId: string;
  position: Position;
  ordinalWithinAyah: number;
  pageId: string;
  line: null | { number: number; evidenceRef: string };
  part: 'whole' | 'start' | 'middle' | 'end';
  boundaryRef: string | null;
  proofRef: string;
};
type CrosswalkEntry = {
  sourceEditionId: string;
  sourceCoverageKey: string; // قيمة قائمة، لا يعاد توليدها من خط المصحف
  placements: string[];
  precision: 'exact-token' | 'ayah-only' | 'unresolved';
  proofRef: string | null;
};
```

يمكن أن تضم الآية عدة `Placement` في عدة أسطر أو صفحات. لا يصح تمثيلها بحقل صفحة وحيد أو سطر وحيد. لا يعني ترتيب مقاطع الآية أن تقسيم كلمات المصدرين متطابق. `boundaryRef` يشير إلى حدود خام موثقة في المورد الذي ينتمي إليه، مع وحدة القياس المعلنة (كلمات المورد، Unicode code points، UTF-16، أو معرفات شكلية موثقة). يمنع تحويل هذه الوحدات بعضها إلى بعض بالعدّ التقريبي.

`line=null` تعني أن السطر غير مثبت، لا السطر صفر ولا أول سطر. إذا لم تتوفر إلا خريطة على مستوى الآية، تسمح بعرض صفحتها عند انحصارها في صفحة واحدة مع بيان دقة الربط. إذا امتدت الآية على صفحتين وكانت بداية الورد داخلها، لا يُخمن أيهما يحتوي البداية: تُرجع النتيجة `ambiguous`، ويُحجب ادعاء «موضع الورد الدقيق» حتى إثبات حد البداية. السطر الموثق لا يساوي إحداثيات صالحة للتظليل؛ تبقى إحداثيات الكلمات خارج نطاق المرحلة الأولى.

البسملة وعناوين السور وعلامات الأجزاء تُوصف كعناصر تخطيط عند الحاجة، وفق عدّ المورد. لا تُنشأ لها آيات أو مفاتيح تعلم جديدة، ولا يُسقط اختلاف عدّها بمقارنة عددية آلية.

### د. ربط الوحدة `UnitDisplayBinding`

`{ bindingId, indexVersion, bundleDigest, sourceEditionId, sourceContentManifestHash, unitId, unitDefinitionHash, coverageDigest, crosswalkId, orderedCoverageKeys, connectedComponents }`.

يحفظ `unitDefinitionHash` التعريف الأصلي الكامل للوحدة و`coverageDigest` قائمة التغطية الأصلية **بترتيبها**. الحقلان يكتشفان التغيير ولا يكتبان تعريفًا بديلًا. التحقق يعيد مقارنة التعريف الحقيقي في الكتالوج، ولا يثق بنسخة واجهة أو رابط. علاقة الربط قراءة فقط؛ فشلها يعطل فتح المصحف لذلك الهدف ولا يعدّل الوحدة أو يحذف نشاطها.

`connectedComponents[]` قائمة نطاقات متصلة مثبتة من ترتيب مصدر التعلم. كل مكوّن له `componentId` و`orderedCoverageKeys` وبداية ونهاية مشمولتان. تحتفظ القائمة بالفجوات؛ لا تستخدم `[min, max]` لملء ما لم يطلبه الورد. لا تدمج وحدتين مستقلتين في حدث واحد لمجرد تلاصق صفحتيهما.

### هـ. هدف فتح الورد `WirdOpenTarget`

```ts
type WirdSegment = {
  segmentId: string;
  unitId: string;
  orderedCoverageKeys: string[];
  fromCoverageKey: string; // مشمول
  toCoverageKey: string;   // مشمول
};
type DisplayIdentity = {
  schemaVersion: 1;
  mushafReleaseId: string;
  bundleDigest: string;
};
type WirdOpenTarget = DisplayIdentity & {
  sourceEditionId: string; // editionId القائم حرفيًا
  unitId: string; // وحدة المهمة أو الجلسة المثبتة
  segments: [WirdSegment, ...WirdSegment[]];
  selectedSegmentId: string;
};
type MushafOpenTarget =
  | (WirdOpenTarget & {
      origin: 'daily-plan'; taskId: string; planRevision: number;
    })
  | (WirdOpenTarget & {
      origin: 'session'; sessionId: string;
    })
  | (DisplayIdentity & {
      origin: 'free-reading'; pageId: string;
      verifiedPosition?: Position;
    });
type DailyWirdOpenCollection = {
  targets: Array<Extract<MushafOpenTarget, { origin: 'daily-plan' }>>;
  selectedTaskId: string;
};
```

الفهرس يعمل على مجموعة نطاقات مرتبة لا على نص URL قابل للتنفيذ. الهدف لا يحمل آيات أو `rating` أو تواريخ استحقاق. `planRevision` تمنع استعمال هدف قديم بعد تغير الورد. أثناء جلسة قائمة، المرجع هو الوحدة المثبتة في الجلسة، وليس خطة أعيد حسابها لاحقًا. `selectedSegmentId` يجب أن يوجد في القائمة غير الفارغة، وتطابق الحدود أول وآخر مفتاح فيها. القراءة الحرة فرع مستقل يحمل هوية العرض وصفحته دون اشتراط وحدة أوجلسة أوتغطية؛ لا تصطنع هذه البيانات لتلبية العقد. لا يعفي اختيار `origin: free-reading` من حارس أي جلسة تسميع قائمة، ولا يحسم أثر القراءة الحرة المنهجي المذكور في تصميم العارض.

**قيد الربط وقت التشغيل:** جميع مقاطع هدف الجلسة تحمل `unitId` المطابق حرفيًا لوحدة الجلسة المحفوظة، وجميع مقاطع هدف المهمة تطابق وحدة تلك المهمة والجزء المطلوب من تغطيتها. لا تُقبل وحدة صحيحة تحت `sessionId` أو`taskId` يخص وحدة أخرى. الحدود الجزئية قائمة جزئية مرتبة ومثبتة من الوحدة الأصلية، وليست تعريف`CanonicalUnit` بديلًا. الورد اليومي متعدد المهام يستخدم `DailyWirdOpenCollection` بأهداف مستقلة مرتبة، بلا دمج جلساتها أوتغطياتها؛ وتوجد المهمة المختارة في القائمة. المثال الآتي يجمع مقاطع عدة مهام على مستوى اليوم، ولا يمثل جميعها تحت جلسة واحدة.

## 4. مثال اصطناعي غير قرآني

الأرقام هنا أرقام فصول وجمل في كتاب اختبار خيالي، مع استعمال أسماء الحقول المقترحة فقط. النص المفترض «بطاقة حمراء / بطاقة زرقاء / بطاقة خضراء» ليس قرآنًا. `test-*` و`kind: synthetic` يجب رفضهما في أي مُفعِّل إنتاجي. الاختصار أدناه يعرض العلاقات، وليس بيانًا صالحًا للتوقيع أو للتنزيل؛ لا توجد ملفات أو بصمات رسمية مخترعة.

```json
{
  "schemaVersion": 1,
  "kind": "synthetic",
  "mushafReleaseId": "test-picture-book-layout-v1",
  "sourceEditionId": "test-learning-book-v1",
  "indexVersion": "test-index-v1",
  "pages": [
    {"pageId":"test-p1","pageNumber":1,"assetRef":"test-page-one.svg"},
    {"pageId":"test-p2","pageNumber":2,"assetRef":"test-page-two.svg"},
    {"pageId":"test-p3","pageNumber":3,"assetRef":"test-page-three.svg"}
  ],
  "placements": [
    {"placementId":"test-a","position":{"surah":1,"ayah":1},"ordinalWithinAyah":0,"pageId":"test-p1","line":null,"part":"start"},
    {"placementId":"test-b","position":{"surah":1,"ayah":1},"ordinalWithinAyah":1,"pageId":"test-p2","line":null,"part":"end"},
    {"placementId":"test-c","position":{"surah":1,"ayah":2},"ordinalWithinAyah":0,"pageId":"test-p2","line":null,"part":"whole"},
    {"placementId":"test-d","position":{"surah":2,"ayah":1},"ordinalWithinAyah":0,"pageId":"test-p3","line":null,"part":"whole"}
  ],
  "crosswalk": [
    {"sourceCoverageKey":"test-learning-book-v1:1:1:0","placements":["test-a"]},
    {"sourceCoverageKey":"test-learning-book-v1:1:1:1","placements":["test-b"]},
    {"sourceCoverageKey":"test-learning-book-v1:1:2:0","placements":["test-c"]},
    {"sourceCoverageKey":"test-learning-book-v1:2:1:0","placements":["test-d"]}
  ],
  "wirdSegments": [
    {"segmentId":"test-segment-1","unitId":"test-existing-unit-A","orderedCoverageKeys":["test-learning-book-v1:1:1:0","test-learning-book-v1:1:1:1"],"fromCoverageKey":"test-learning-book-v1:1:1:0","toCoverageKey":"test-learning-book-v1:1:1:1"},
    {"segmentId":"test-segment-2","unitId":"test-existing-unit-B","orderedCoverageKeys":["test-learning-book-v1:2:1:0"],"fromCoverageKey":"test-learning-book-v1:2:1:0","toCoverageKey":"test-learning-book-v1:2:1:0"}
  ],
  "excludedFromWird":["test-learning-book-v1:1:2:0"]
}
```

النتيجة المتوقعة: يبدأ المكوّن الأول في الصفحة 1 وينتهي في الصفحة 2، ثم ينتقل زر «المقطع التالي من الورد» إلى المكوّن الثاني في الصفحة 3. لا تُضاف الجملة `1:2` الواقعة بينهما إلى الورد، وإن ظهرت ضمن الصفحة الأصلية المعروضة. وجودها في صورة الصفحة لا يغير التغطية أو `words`. لو شمل ورد متصل الجملة `1:2` ثم `2:1` تثبت الوصلة من ترتيب المصدر عبر الفصلين، وتبقى وحدات التعلم ووقائعها كما هي. تُختبر المقاطع التي تبدأ وتنتهي في السطر نفسه، وتلك التي تعبر أسطرًا، في fixtures منفصلة ذات أدلة أسطر اصطناعية معلنة.

## 5. خوارزمية الحل المقترحة وحالات الفشل

1. اقرأ الهدف من مهمة/جلسة فعلية وافحص نسخة الكتالوج والإصدار وحالة الإذن. لا يستنتج `taskId` من عنوان مرئي.
2. حمّل بيان الفهرس المطابق لبصمة الهدف، وتحقق من كل مورد وحقوقه واعتماده. ارفض غياب الهوية أو خلط البيان بأصول إصدار آخر.
3. قارن تعريف كل وحدة ومفاتيحها بالتعريف الأصلي. تحقق من الحدود المشمولة والترتيب وعدم التكرار والتداخل. احفظ الفجوات كمكوّنات منفصلة.
4. حل كل مفتاح عبر `crosswalkId` المحدد. العلاقات متعددة المقاطع مسموحة فقط عند وجود دليل؛ ليس اختلاف عدد الكلمات سببًا لترقيمها مجددًا.
5. أخرج `resolved` أو `unresolved` أو `ambiguous` أو `edition-mismatch` أو `unapproved` مع أسباب محددة. لا تستخدم «أقرب صفحة» كنجاح صامت.
6. في `resolved` أرجع صفحة البداية وصفحة النهاية وقائمة الصفحات المرتبة لكل مكوّن، والسطر فقط إذا ثبت. يُفحص الطرفان بصورة مستقلة، بما في ذلك أول وآخر موضع في المصحف.
7. يفتح العارض الصفحة المطلوبة بعد حارس كشف النص. لا يستدعي الفهرس HME أو FSRS ولا يعيد التخطيط أو التسجيل.

## 6. التحقق والإصدار والتراجع

تُنتج أداة فحص لاحقة تقريرًا حتميًا من الأصول غير المعدلة ونسخة أداة ثابتة: SHA-256 للملفات الخام، مخطط الأرشيف الآمن، عدد السور والآيات والصفحات، تغطية مواضع المصدر، سلسلة `Placement` لكل آية، وتطابق كل `assetRef`. تشمل سلامة الأرشيف منع traversal والروابط الخارجة وحدود الحجم والتوسع. تُجرى مقارنة تدقيقية مستقلة لجدول بداية/نهاية كل صفحة؛ لا تُولّد التوقعات من الدالة المختبرة نفسها.

يُعرَّف تسلسل البايتات المعتمد للبيان صراحة قبل توقيعه: UTF-8، دون BOM، وتسلسل JSON قانوني محدد الإصدار. بصمة ملف خام لا تساوي بصمة كائن أعيد تسلسله. يشمل الاعتماد البيان وخريطة الربط والموارد المقصودة، ولا يمتد تلقائيًا إلى إصدار جديد.

تخزن النسخ جنبًا إلى جنب؛ استبدال ملف خلف URL ثابت ممنوع. عند تحديث المصحف تبقى أهداف الجلسات الحالية مثبتة إلى نسختها، ولا تُعاد كتابة الأحداث. إذا سُحب اعتماد نسخة، يحجب عرضها وتبقى بيانات التعلم سليمة. يبقى التراجع اختيار بيان عرض قديم صالح، وليس إعادة تفسير المحاولات أو تخفيض نسخة السجل.

العلامة المرجعية للقراءة بيانات واجهة منفصلة قابلة للمسح، تشمل `bundleDigest` و`pageId` و`segmentId` والتكبير وموضعًا نسبيًا. ليست حدث تعلم ولا مصدر حقيقة للتغطية. لا تدخل النسخ الاحتياطية الحالية أو تغير مخططها في 10-A؛ دعم تصديرها لاحقًا قرار مستقل يحافظ على قارئ النسخ القديمة.

## 7. نقاط منع التنفيذ الإنتاجي

يلزم أولًا اعتماد مورد الصفحات وهويته وحقوق عرضه وتخزينه، وخريطة بداية/نهاية موثقة، ودليل التوافق مع معرفات المصدر الحالي، والنص البديل وإتاحته، ثم مراجعة طريقة ربط اعتماد العرض بسياق الإصدار القائم. لا يختزل الفهرس هذه المتطلبات إلى علم منطقي. تفاصيل الاختبارات والقرارات المتوقفة في [بوابات الاعتماد](Mushaf-Approval-Gates.md). هذه المرحلة لا تضيف جدول قاعدة بيانات أو ترحيلًا أو كتالوج وحدات أو سلطة توقيع.
