# مصفوفة التتبع 04-B

المرجع: PRD §9/11/20/21/25. المعرّفات C وR وAC لم تتغير. Component ID يطابق `data-component-id` الفعلي على قالب الشاشة في `src/App.tsx` كما يعرّفه `src/catalog.ts`. المكونات المشتركة في `src/components.tsx`، والحالة في `src/domain/`. لا يلزم مكوّن React مستقل لكل فعل داخل الشاشة.

**مفتاح الحالة:** «واجهة/تجريبي» سلوك محلي للمراجعة؛ «Mock» عقد أو بيانات عرض لا تنفذ HME؛ «جزئي» يعني أن AC الإنتاجي يتضمن شرطًا لا يمكن إثباته في 04-B. لا تحول تغطية الصف إلى ادعاء اجتياز معيار القبول كاملًا. الأدلة المنفذة وأسماء الاختبارات الفعلية في [تقرير QA](qa-results.md)؛ الاختبارات البشرية في [خطة UX](05-ux-test-plan.md) لم تنفذ.

## الربط بالأدلة التنفيذية

تعني عبارة «يغطي» أدناه الجزء المذكور من المعيار فقط. نتيجة Vitest الحالية المثبتة هي 41 اختبارًا ناجحًا من 41 (33 نطاق/حالة/تخزين/عقود و8 مكونات/تكامل تطبيق) في [ملف النتيجة الخام](test-evidence/unit-results.json). نجحت مجموعات المتصفح 28/28 بلا إخفاق أو تخطي أو اختبار متذبذب؛ التفاصيل وتاريخ التشغيل في [QA](qa-results.md) و[JSON Playwright](test-evidence/browser-results.json). لا يحوّل نجاح اختبار امتناع إلى اعتماد وظيفة HME أو نسخ احتياطي مشفر.

| R / AC | الاختبار الفعلي وملفه | ما يثبته وما يبقى |
|---|---|---|
| R01/08/19/27؛ AC01/08/19/27 | `has exact C01–C14 names and no real content, audio, model, or forecast` في [domain.test.ts](../src/domain/domain.test.ts) | تطابق أسماء العقود وتعذر المحتوى/التوقع؛ لا يثبت صلاحية حزمة أو هجرة إنتاجية |
| R02/03؛ AC02/03 | `AC02/03: beginner setup validates time, persists config, and skips diagnosis` في [interactions.spec.ts](../e2e/interactions.spec.ts)؛ و`AC02 beginner without declared memory starts new-training demo and has no invented repair or diagnostic` في domain | مسار المبتدئ بلا تشخيص أو مراجعات سابقة مختلقة؛ وقت وأيام وتخزين تجريبي |
| R04؛ AC04 | `AC04: nonadjacent declarations in all four selectors remain unassessed` في interactions؛ وأربع حالات النطاقات في domain | الأنواع الأربعة وعدم سد الفجوات وتطبيع المحور الواحد؛ خرائط الكلمات عبر الأنواع مؤجلة |
| R05/16؛ AC05/16 | `C03 retains outside review as a report without inventing review events` في domain؛ فحص وجود S04/S13 ضمن layout | تصريح عام بلا وقائع تعلم؛ لا يثبت عينة تشخيص HME أو زمنها |
| R06/07/13/15؛ AC06/07/13/15 | `C04 fixture plans retain original due date independently of allocation` و`AC-S02 maintenance and complete Quran personas never receive new tasks` في domain؛ `AC07 source fixtures: populated capacity screen retains 25/49/97 costs and responsive accessibility` في layout | ترتيب/تواريخ fixture وحجب الجديد للمحافظة وأمثلة 30/60/120 على خمسة أحجام؛ لا جدولة أو سقف قدرة فعليين |
| R08/09؛ AC08/09 | `R08/R09 repetition is idempotent and never creates a recall or mastery` في domain؛ `AC09/22: four repetitions survive pause and reload without claiming mastery` في interactions | عداد ثابت الأوامر ولا نتيجة إتقان؛ المنهج والنص والصوت الحقيقيون مؤجلون |
| R10/11/12/25؛ AC10/11/12/25 | `AC10/11/12/25: hint, observed error, disputed assessment and correction preserve history` في interactions؛ حالات R10/R11/R12/R25 في domain | بقاء المساعدة والمسودة والتعارض والأصل وعدد المحاولات؛ لا rubric أو effectiveRating |
| R11/22؛ AC11/22 | `AC10/22: interrupted recall starts a new identity and keeps the incomplete original` و`AC11: canceled assessment stays incomplete and a memory stop never becomes success` في interactions | عدم وصل التسميع المنقطع أو اختراع نجاح؛ تخزين الجهاز الإنتاجي مؤجل |
| R14/17/18؛ AC14/17/18 | `AC18/19: thirty named parts and forecast abstention without silent setting changes` في interactions؛ `cross-kind union never invents Quran coverage` في domain | شبكة الأجزاء والامتناع عن تغطية مختلقة؛ لا يثبت روابط أو إتقان حقيقيًا |
| R19/26؛ AC19/26 | `forecast preview never mutates configuration` في domain؛ `AC03/26: time preview and cancellation do not mutate settings` في interactions | معاينة دون تعديل صامت؛ لا نموذج توقع أو إعادة تخطيط علمية |
| R03/07/26؛ AC03/07/26 وAC-S06 | `AC03/07: today-only budget is separate, cancel is inert, and zero preserves deferred obligations` في interactions؛ `today-only budget preserves habitual time, days, attempts and corrections` و`C04 uses matching day budget, preserves zero-day deferred source obligations, and ignores old override` في domain | ميزانية اليوم منفصلة؛ حفظ/إلغاء/إعادة فتح؛ صفر يبقي المؤجل؛ فحص التاريخ وحد الرياض والتخزين والحذف؛ المنفق والاحتياط والجدولة الفعلية مؤجلة |
| R20/21/24؛ AC20/21/24 | `AC20/21/24 prototype: offline manual flow works without notification or microphone permission` في interactions؛ `No remote dependencies: navigate loaded screens offline` في [layout.spec.ts](../e2e/layout.spec.ts) | عمل المسار اليدوي بعد التحميل دون إذن؛ لا فتح بارد/PWA أو إشعار نظام |
| R22/30؛ AC22/30 | `Real storage exception: failed write cannot increment the confirmed repetition counter` و`Loading and read error retry do not manufacture learning attempts` و`Corrupt local state is reported without automatic overwrite` في interactions؛ حماية الحالة الفاسدة في [components.test.tsx](../src/components.test.tsx) | فشل كتابة حقيقي/محاكاة وحماية القيم المؤكدة؛ قياسات NFR/معاملات الإنتاج مؤجلة |
| R23؛ AC23 | `AC23 prototype: invalid import is nondestructive; valid replacement needs confirmation` و`Prototype export round trip preserves identity and clearly labels plaintext` في interactions؛ فحص envelope/المراجع في domain | ملف نموذج غير مشفر وفحص قبل الاستبدال؛ معيار التشفير الإنتاجي لم يجتز |
| R28/29؛ AC28/29 | `AC28/29: delete dialog traps keyboard focus, Escape cancels, confirmed deletion resets history` في interactions؛ اختبارات Field/Button/Notice/Heading/Empty في components | حوار وتسمية وإلغاء وحذف محلي؛ لا محو نظام ملفات أو اعتماد قارئ شاشة |
| R29؛ AC29 | مجموعات RTL layout الخمس؛ WCAG automation الفاتح/الداكن؛ Large text at 320px؛ Evidence gallery في layout | حالات المتصفح المذكورة في [تقرير الإتاحة](04-accessibility.md)؛ أجهزة وVoiceOver/TalkBack وتكبير المتصفح الحقيقي معلقة |

أي معيار غير مغطى بالكامل في هذا الربط يبقى وفق خانة «جزئي» وشرط الإنتاج في الجدول التالي، حتى إذا وُجدت له شاشة قابلة للنقر.

## تغطية R01–R30 وAC01–AC30

| Screen ID | Component ID | Requirement ID | Contract ID | Action/Event | Acceptance Criteria | Test Case | Implementation Status |
|---|---|---|---|---|---|---|---|
| S01 S16 S17 | S01-welcome / S16-reader / S17-settings | R01 | C01 | قراءة حالة المحتوى؛ رفض عرض نص غير معتمد | AC01 | فحص التعذر/عدم النص | جزئي: حالة تعذر صادقة؛ اعتماد/تفعيل الحزم إنتاجيًا مؤجل |
| S01 S02 S05 | S01-welcome / S02-plan / S05-today | R02 | C02 | ابدأ؛ اختيار مبتدئ؛ متابعة دون تشخيص | AC02 | مسار مبتدئ | واجهة تجريبية |
| S02 S06 S17 | S02-plan / S06-capacity / S17-settings | R03 | C02 C04 C11 | تحقق الوقت والأيام؛ حفظ؛ إعادة فتح | AC03 | صلاحية النموذج واستعادة الإعداد | واجهة وتخزين تجريبي |
| S03 S15 | S03-ranges / S15-detail | R04 | C01 C02 C03 C09 | أضف/احذف سورة أو جزء أو صفحة أو آيات غير متجاورة | AC04 | عدم توسيع الفجوات وتطبيع التداخل | جزئي: اتحاد داخل محور مرجعي؛ اتحاد الكلمات عبر الخرائط ينتظر C01 المعتمد |
| S04 S08 | S04-diagnostic / S08-recall | R05 | C03 C05 C07 C09 | ابدأ عينة؛ أكمل لاحقًا؛ عدل المحفوظ | AC05 | المجهول يبقى مجهولًا | Mock فقط؛ لا اختيار عينة HME |
| S05 | S05-today | R06 | C04 C05 C09 | ابدأ المهمة التالية؛ سبب الاختيار؛ تفاصيل البطاقات | AC06 | أولوية المهمة من fixture | Mock؛ لا استنتاج أولوية داخل UI |
| S05 S06 | S05-today / S06-capacity | R07 | C02 C04 C09 | عرض المؤجل؛ معاينة/اعتماد وقت؛ إعادة توزيع | AC07 | حالات قدرة ومؤجل | Mock؛ حساب HME الإنتاجي مؤجل |
| S07 | S07-training | R08 | C01 C05 C06 C07 C14 | استماع/معنى غير متاح؛ تكرار؛ انتقال محاكاة؛ استراحة | AC08 | لا نجاح من التعرض؛ تعذر موارد صريح | جزئي: محاكاة تفاعل بلا نص أو صوت أو تطبيق منهج علمي |
| S07 | S07-training | R09 | C06 | تأكيد تكرار؛ إعادة إرسال commandId | AC09 | الأمر نفسه لا يضاعف العداد | سلوك حالة تجريبية |
| S08 | S08-recall | R10 | C05 C06 C07 | بدء؛ تلميح؛ كشف؛ إنهاء؛ توقف | AC10 | بقاء المساعدة وعدم إتقان | سلوك تجريبي؛ إخفاء القرآن الفعلي ينتظر الحزمة |
| S09 | S09-assessment | R11 | C07 C08 | اكتمال/أخطاء/جهد صريحة؛ حفظ الناقص؛ تعارض | AC11 | تلميح + سهل؛ خطأ + لا أخطاء | جزئي: حفظ التقرير والتعارض؛ effectiveRating=null ولا rubric منفذ |
| S08 S09 S12 | S08-recall / S09-assessment / S12-mistakes | R12 | C01 C05 C08 C09 | بلاغ سريع؛ مرصود/مشتبه؛ موضع مجهول؛ تصحيح | AC12 | nullable لا يصبح فشلًا | سلوك مسودة تجريبية؛ MistakeEvent الإنتاجي غير مولد |
| S06 S09 | S06-capacity / S09-assessment | R13 | C04 C07 | عرض الاستحقاق والأصل والمخطط والمجهول | AC13 | plannedAt منفصل عن policyDueAt | Mock؛ جدولة فعلية غير منفذة |
| S08 S11 S15 | S08-recall / S11-maintenance / S15-detail | R14 | C07 C09 | ابدأ متصلًا/اختبار رابط؛ أظهر نقص الاتصال | AC14 | لا نجاح رابط من نجاح مقطع | Mock؛ صلاحية الرابط والتغطية للمحرك والمحتوى |
| S06 S11 | S06-capacity / S11-maintenance | R15 | C04 C09 | عرض الدورة؛ عجز؛ تعديل الوقت؛ توزيع | AC15 | 900/30/20 مثال عقدي | Mock للعرض؛ لا حساب دورة حقيقي |
| S04 S13 | S04-diagnostic / S13-recovery | R16 | C02 C03 C04 C05 C07 C09 | تصريح خارجي؛ بدء عينة؛ أكمل لاحقًا | AC16 | غياب دون Again؛ غير المختبر مجهول | سلوك عرض/Mock |
| S05 S14 | S05-today / S14-progress | R17 | C09 | اقرأ المؤشرات ومصادرها؛ اشرح التداخل | AC17 | null لا يصبح صفرًا أو إتقانًا | جزئي: العرض بلا درجات؛ اتحاد الكلمات المعتمد مؤجل |
| S14 S15 | S14-progress / S15-detail | R18 | C01 C04 C07 C09 | افتح أحد الأجزاء الثلاثين؛ تفاصيل/مراجعة/ربط | AC18 | 30 عنصرًا؛ مجهول وروابط مستقلة | واجهة؛ تفاصيل الخرائط المعتمدة مؤجلة |
| S19 | S19-forecast | R19 | C10 C02 C09 | سبب الامتناع؛ معاينة وقت؛ اعتماد منفصل | AC19 AC-F01–06 | لا تاريخ شخصي؛ المعاينة لا تحفظ | حالة الامتناع منفذة؛ خدمة التوقع غير منفذة |
| S05 S17 | S05-today / S17-settings | R20 | C13 C11 | تفضيل التذكير وإلغاؤه؛ بيان عدم جدولة النظام | AC20 | التذكير ليس شرط الورد | محاكاة تفضيل فقط؛ NFR-14–19 نظامية مؤجلة |
| الجميع | S01-welcome … S19-forecast | R21 | C01 C04–C09 C12 | التفاعل المحلي بعد تحميل النموذج | AC21 | العمل دون طلب شبكة أثناء التفاعل | جزئي: ليس تطبيقًا مثبتًا للعمل البارد بلا اتصال؛ الحزمة غائبة |
| S07 S08 S09 S10 | S07-training / S08-recall / S09-assessment / S10-resume | R22 | C05 C06 C07 | حفظ؛ فشل كتابة؛ إغلاق؛ إعادة فتح؛ استئناف/بدء جديد | AC22 | لا إقرار لفشل كتابة؛ لا نتيجة تقنية | تخزين متصفح تجريبي؛ ليس ضمان معاملات قاعدة أحداث |
| S18 | S18-data | R23 | C12 | تصدير JSON تجريبي؛ تحقق؛ معاينة؛ استبدال مؤكد | AC23 | فاسد لا يكتب؛ تكرار استيراد لا يدمج | جزئي مقصود: ملف غير مشفر؛ لا يدعى اجتياز AC23 الإنتاجي |
| S08 S17 S18 | S08-recall / S17-settings / S18-data | R24 | C12 C14 | مسار يدوي؛ عرض حدود التخزين؛ لا ميكروفون | AC24 | لا حساب/صوت مطلوب | واجهة بلا تسجيل؛ ضمانات تخزين المنصة إنتاجيًا مؤجلة |
| S09 S12 | S09-assessment / S12-mistakes | R25 | C07 C08 C11 | تصحيح تقييم/بلاغ مع سبب ومرجع للأصل | AC25 | عدد المحاولات ثابت والتاريخ محفوظ | سلوك تجريبي؛ replay HME غير منفذ |
| S02 S06 S17 | S02-plan / S06-capacity / S17-settings | R26 | C02 C04 C11 | معاينة واعتماد الوقت المعتاد أو ميزانية اليوم؛ فصل نطاق/نسخة | AC26 AC-S06 | لا إعادة كتابة الماضي أو تغيير المعتاد بتعديل اليوم | جزئي: ميزانية يوم مؤرخة وإعداد مستقل؛ حساب المنفق/الاحتياط وهجرة الوحدة للمحرك |
| S01 S17 S18 | S01-welcome / S17-settings / S18-data | R27 | C01 C11 | عرض عدم تفعيل محرك/حزمة؛ رفض حالة غير مدعومة | AC27 | لا ترقية أو محتوى صامت | حدود وعقود؛ هجرة المحرك والمحتوى إنتاجيًا مؤجلة |
| S18 | S18-data | R28 | C12 | اطلب حذفًا؛ ألغِ؛ أكد؛ هوية جديدة | AC28 | الإلغاء بلا أثر؛ حذف كامل دون نسخ خارجية | سلوك حالة تجريبية؛ محو نظام الملفات/المفاتيح إنتاجيًا مؤجل |
| S01–S19 | S01-welcome … S19-forecast | R29 | C01 C05 C09 | RTL؛ تركيز؛ لوحة مفاتيح؛ تكبير؛ داكن؛ تقليل حركة | AC29 | مصفوفة الإتاحة والمتجاوب | تحقق آلي/بصري محدود؛ قارئ شاشة بشري مطلوب |
| S01–S19 | S01-welcome … S19-forecast | R30 | C04 C05 C11 | عرض خطأ/حفظ غير مؤكد؛ احتواء التعذر | AC30 | بناء واختبارات؛ NFR مؤجلة | لا قياس P95 على أجهزة الإنتاج أو ادعاء مطابقة NFR |

## جرد الأفعال الأساسية

Test Case هنا **معرف سيناريو مراجعة** لتحديد الفعل بدقة، وليس ادعاء اسم اختبار آلي أو اجتيازه. تربط نتائج الاختبارات المنفذة هذه الأفعال بأسماء الملفات في تقرير QA. المعايير العلمية/الإنتاجية تبقى وفق حدود جدول R أعلاه. لكل فعل ظاهر أثر حالة أو انتقال أو امتناع صريح.

| Screen ID | Component ID | Requirement ID | Contract ID | Action/Event | Acceptance Criteria | Test Case | Implementation Status |
|---|---|---|---|---|---|---|---|
| S01 | S01-welcome | R01 R02 | C01 C11 | بدء إعداد التجربة | AC01 AC02 | NAV-START | تنقل إلى S02؛ النص الفعلي غير متاح |
| S01 | S01-welcome | R23 | C12 | فتح ملف حالة سابق | AC23 | DATA-IMPORT | تنقل إلى S18؛ ملف تجريبي غير مشفر |
| S01 | S01-welcome | R24 | C11 C12 | المصدر والخصوصية | AC24 | NAV-PRIVACY | معلومات وحدود محلية |
| S02 | S02-plan | R02 R03 | C02 | اختيار الفئة والهدف والبداية والوقت والأيام | AC02 AC03 | FORM-PLAN | مدخلات ذات تحقق؛ لا محاولة تعلم |
| S02 | S02-plan | R03 R26 | C02 C04 | معاينة ثم اعتماد أو رجوع للتعديل | AC03 AC26 | PLAN-CONFIRM | نسخة إعداد بعد تأكيد؛ لا إعادة تخطيط HME |
| S02 | S02-plan | R02 R21 | C01 | التصفح دون خطة نشطة | AC-S02 | NAV-BROWSE | قارئ بحالة محتوى غير متاح |
| S03 | S03-ranges | R04 | C01 C02 C03 | اختيار سور كاملة وإضافة أكثر من نطاق غير متجاور | AC04 | RANGE-SURAH | اتحاد تداخل المحور نفسه؛ لا ملء الفجوات |
| S03 | S03-ranges | R04 | C01 C02 C03 | اختيار أجزاء كاملة وإضافتها | AC04 | RANGE-JUZ | تصريح غير مختبر |
| S03 | S03-ranges | R01 R04 | C01 C03 | إضافة صفحات وهوية الطبعة | AC04 AC-S03 | RANGE-PAGE | إدخال معلق بخريطة تجريبية؛ لا تحويل لآيات |
| S03 | S03-ranges | R01 R04 | C01 C03 | إضافة آيات ضمن سورة | AC04 AC-S03 | RANGE-AYAH | فحص عددي فقط؛ حدود المحتوى تنتظر C01 |
| S03 | S03-ranges | R04 | C02 C03 | إزالة نطاق من التصريح | AC04 | RANGE-REMOVE | يغير التصريح فقط |
| S03 | S03-ranges | R04 R05 | C03 | تصريح كامل/متابعة فحص/إكمال لاحقًا | AC04 AC05 | RANGE-ALL-LATER | لا نجاح من اكتمال التصريح |
| S04 | S04-diagnostic | R05 | C03 C05 C07 | ابدأ المقطع التمثيلي | AC05 | DIAGNOSTIC-START | العينة مثال واجهة؛ النتيجة لا تعمم |
| S04 | S04-diagnostic | R05 R16 | C03 | أكمل الفحص لاحقًا أو عدل المعلن | AC05 AC16 | DIAGNOSTIC-LATER | تنقل مع بقاء التصريحات |
| S05 | S05-today | R06 | C04 C05 | ابدأ المهمة التالية | AC06 | TODAY-PRIORITY | المهمة من ترتيب fixture؛ لا ترتيب مستنتج من البطاقة |
| S05 | S05-today | R22 | C05 | استأنف جلستك | AC22 | TODAY-RESUME | يفتح آخر حالة مؤكدة S10 |
| S05 | S05-today | R06 R13 | C04 | لماذا هذه المهمة؟ وتفاصيل المسار | AC06 AC13 | TODAY-REASON | سبب صريح مع وسم المثال |
| S05 | S05-today | R16 R17 R19 | C03 C09 C10 | عودة/تقدم/توقع | AC16 AC17 AC19 | TODAY-DESTINATIONS | تنقل بلا وقائع تعلم |
| S06 | S06-capacity | R07 R13 | C04 | اليوم/غدًا/عرض المؤجل | AC07 AC13 | PLAN-DEFERRED | policy/original/planned منفصلة في العرض |
| S06 | S06-capacity | R03 R26 | C02 C04 | معاينة وقت واعتماد المعتاد أو إلغاء | AC03 AC26 | PLAN-TIME | تعديل الإعداد المعتاد مستقل عن ميزانية اليوم؛ الإلغاء لا يكتب |
| S06 | S06-capacity | R07 R26 | C02 C04 | معاينة وقت هذا اليوم فقط ثم اعتماد أو إلغاء | AC07 AC26 AC-S06 | PLAN-TODAY-TIME | todayBudget مؤرخة؛ الوقت والأيام المعتادة والسجل باقية؛ صفر يبقي الالتزامات مؤجلة؛ لا حساب مخطط أو احتياط |
| S06 | S06-capacity | R07 R15 | C04 | عرض العجز والخطة العادية | AC07 AC15 | PLAN-CAPACITY | حالة اختبار لا حساب قدرة حقيقي |
| S06 | S06-capacity | R13 | C04 C05 C07 | جرّب مهمة محددة | AC13 | PLAN-TASK | جلسة تمثيلية؛ لا تغيير استحقاق فعلي |
| S07 | S07-training | R08 | C01 C05 C14 | تهيئة/استماع/نظر/تدريب | AC08 | TRAIN-MODES | تبديل وضع العرض دون تعرض قرآن |
| S07 | S07-training | R01 R08 | C01 C14 | استمع/اقرأ المعنى | AC08 AC21 | TRAIN-UNAVAILABLE | رسالة عدم إتاحة؛ لا تشغيل أو تفسير مصطنع |
| S07 | S07-training | R09 R22 | C06 | أنهيت تكرارًا | AC09 AC22 | TRAIN-REPEAT | إقرار محلي، أمر ثابت ومنع ضغط متسارع |
| S07 | S07-training | R10 | C05 C07 | انتقل إلى تجربة التسميع | AC10 | TRAIN-RECALL | محاولة تمثيلية منفصلة عن العداد |
| S07 | S07-training | R08 R22 | C05 | إيقاف/استراحة | AC22 | TRAIN-PAUSE | نقطة استمرار مؤكدة بلا نجاح |
| S07 | S07-training | R08 R26 | C04 C11 | صعب هذا المقدار | AC08 AC26 | TRAIN-SPLIT-UNAVAILABLE | تعذر واضح؛ لا حدود جديدة مختلقة |
| S08 | S08-recall | R10 | C05 C07 | بدء التسميع اليدوي | AC10 AC24 | RECALL-START | معرف محاولة وفرصة وعنقود؛ لا ميكروفون |
| S08 | S08-recall | R10 R22 | C05 C07 | طلب تلميح أو كشف النص | AC10 AC11 | RECALL-HINT | حفظ المساعدة؛ النص غير متاح |
| S08 | S08-recall | R12 | C08 | علامة خطأ ومحرر تفاصيل | AC12 AC-S12 | RECALL-MISTAKE | مسودة/بلاغ؛ لا موقع قرآني مختلق |
| S08 | S08-recall | R11 | C07 | أنهيت التسميع | AC11 | RECALL-FINISH | انتقال للتقييم؛ لا نجاح تلقائي |
| S08 | S08-recall | R11 R22 | C07 | لم أستطع الإكمال | AC11 AC22 | RECALL-FAILURE | memory_failure مصرح؛ لا حكم على الباقي |
| S08 | S08-recall | R22 | C05 | إيقاف مؤقت | AC22 | RECALL-PAUSE | الانقطاع لا يمحو المساعدة |
| S09 | S09-assessment | R11 R12 | C07 C08 | تحديد اكتمال/أخطاء/جهد أو مجهول | AC11 AC12 | ASSESS-INPUT | قيم صريحة؛ الافتراضي unknown |
| S09 | S09-assessment | R11 R22 | C07 | احفظ التقييم | AC11 AC22 | ASSESS-SAVE | تقرير V1 وتعارض محفوظ؛ النتيجة الفعالة null |
| S09 | S09-assessment | R11 R22 | C05 C07 | إلغاء التقييم | AC11 AC22 | ASSESS-CANCEL | لا تقييم جديد؛ استئناف ممكن |
| S09 | S09-assessment | R25 | C07 C11 | صحح تقييمي مع السبب | AC25 | ASSESS-CORRECT | أصل وتصحيح؛ العدد لا يزيد |
| S09 | S09-assessment | R25 | C07 | قراءة سجل التصحيحات | AC25 | ASSESS-HISTORY | قراءة لا تعلم جديد |
| S10 | S10-resume | R22 | C05 | استأنف التدريب أو التقييم | AC22 | RESUME-SAVED | آخر عدد ومرحلة مؤكدة |
| S10 | S10-resume | R10 R22 | C05 C07 | ابدأ محاولة جديدة بعد التسميع المنقطع | AC10 AC22 | RESUME-NEW | السابقة incomplete؛ لا وصل زمني مصطنع |
| S10 | S10-resume | R11 R22 | C05 C07 | كنت قد أنهيت التسميع | AC11 AC22 | RESUME-DECLARED-END | تقييم صريح مع عدم تحقق التوقيت |
| S10 | S10-resume | R22 | C05 | أنهِ الجلسة الآن | AC22 | RESUME-END | لا إغلاق واجب/نجاح من إنهاء الجلسة |
| S11 | S11-maintenance | R14 R15 | C04 C07 C09 | جرّب التعاهد أو المتصل | AC14 AC15 | MAINTENANCE-START | نوع مهمة مستقل؛ نتائج الربط غير محسوبة |
| S11 | S11-maintenance | R07 R15 | C04 | إعادة توزيع الدورة/العجز | AC07 AC15 | MAINTENANCE-CAPACITY | تنقل إلى S06؛ 900/30/20 حالة مرجعية |
| S12 | S12-mistakes | R12 | C08 | أضف مرصودًا/مشتبهًا ومجهول الموضع | AC12 | MISTAKE-ADD | nullable؛ لا Again من الاشتباه |
| S12 | S12-mistakes | R12 R25 | C08 | تصفية وتصحيح ونفي بلاغ | AC12 AC25 | MISTAKE-CORRECT | التصحيح محفوظ مع الأصل |
| S12 | S12-mistakes | R12 R14 | C04 C07 C08 | جرّب المعالجة وانتظر إعادة الاختبار | AC12 AC14 | MISTAKE-REPAIR | awaiting_retest لا إثبات علاج |
| S13 | S13-recovery | R16 | C03 | تصريح المراجعة الخارجية | AC16 | RECOVERY-DECLARE | تصريح عام لا مراجعات مؤرخة |
| S13 | S13-recovery | R03 R16 | C02 C03 C07 | تعديل الوقت وبدء خطوة/لاحقًا | AC03 AC16 | RECOVERY-START | لا تصفير ولا تعميم عينة |
| S14 | S14-progress | R17 | C09 | قراءة المؤشرات/اختيار فترة/شرح الحالات | AC17 | PROGRESS-UNKNOWN | لا رقم إتقان أو جمع متداخل |
| S14 | S14-progress | R18 | C01 C09 | فتح جزء من الثلاثين | AC18 | PROGRESS-30-PARTS | زر مسمى إلى S15؛ لا لون وحده |
| S15 | S15-detail | R14 R18 | C01 C04 C07 C09 | مراجعة نطاق/فحص رابط/تفاصيل المحاولات | AC14 AC18 | DETAIL-REVIEW | مراجع عرض؛ الخرائط والأدلة الإنتاجية غير متاحة |
| S15 | S15-detail | R01 R18 | C01 | افتح في المصحف | AC01 AC18 | DETAIL-READER | يحافظ على غياب نص غير معتمد |
| S16 | S16-reader | R01 R29 | C01 C11 | اختيار مرجع وتكبير/تصغير | AC01 AC29 | READER-CONTROLS | تجربة حدود العرض؛ لا مصحف فعلي |
| S16 | S16-reader | R01 R08 | C01 C14 | صوت/تفسير/تعذر المحتوى | AC01 AC08 | READER-UNAVAILABLE | امتناع معلوم المصدر |
| S17 | S17-settings | R03 R04 R26 | C02 C11 | تعديل خطة/محفوظ | AC03 AC04 AC26 | SETTINGS-PLAN | نفس الشاشات والإعدادات |
| S17 | S17-settings | R29 | C11 | حجم نص/داكن/تقليل حركة | AC29 | SETTINGS-ACCESS | تفضيلات عرض دون دليل تعلم |
| S17 | S17-settings | R20 R24 | C13 C14 | تذكير وخصوصية وغياب التسجيل | AC20 AC24 | SETTINGS-REMINDER | تفضيل فقط؛ لا إذن أو إشعار مزعوم |
| S18 | S18-data | R23 R24 | C12 | تصدير حالة تجريبية | AC23 AC24 | DATA-EXPORT | JSON غير مشفر؛ ليس نسخة إنتاجية |
| S18 | S18-data | R23 | C12 | اختيار ملف وفحصه | AC23 | DATA-INSPECT | بنية/نسخة/حجم/علاقات قبل أي كتابة |
| S18 | S18-data | R23 | C12 | معاينة ثم تأكيد استبدال أو إلغاء | AC23 | DATA-REPLACE | لا دمج؛ الحفظ قبل تغيير الحالة |
| S18 | S18-data | R28 | C12 | طلب حذف وإلغاء أو تأكيد | AC28 | DATA-RESET | حذف سجل النموذج وهوية جديدة؛ النسخ الخارجية باقية |
| S19 | S19-forecast | R19 | C10 | آفاق 1/3/6/12 شهرًا وسبب الامتناع | AC19 AC-F01 | FORECAST-ABSTAIN | null؛ لا موعد شخصي أو إتقان |
| S19 | S19-forecast | R03 R19 R26 | C10 C02 | جرّب وقتًا؛ اعتماد منفصل أو رجوع | AC-F04 AC26 | FORECAST-PREVIEW | المعاينة لا تكتب الإعداد |
| S01–S19 | S01-welcome … S19-forecast | R29 | C01 C05 C09 | تجاوز المحتوى/لوحة مفاتيح/تركيز/نافذة/Escape | AC29 | ACCESS-KEYBOARD | مكونات مشتركة؛ التجربة البشرية منفصلة |
| S01–S19 | S01-welcome … S19-forecast | R22 R30 | C05 C11 | حقن تحميل/قراءة/فشل حفظ وإعادة المحاولة | AC22 AC30 | ERROR-RECOVERY | لا إقرار بكتابة فاشلة |
