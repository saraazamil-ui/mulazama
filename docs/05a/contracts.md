# MULAZAMA — Phase 05-A Contract Implementation Register (C01–C14)

التاريخ: 5 نوفمبر 2026، بتوقيت الرياض. المرجع: PRD 0.1 §11 والعقود C01–C14، وHME 0.1، وبوابة 04-B. هذه وثيقة حالة تنفيذ، وليست اعتمادًا للعقود الإنتاجية كاملة.

## الحدود الفعلية

يوجد مساران مختلفان يجب ألا يختلطا:

1. `ApplicationService` في `src/application/service.ts`: هو المسار الذي تستهلكه واجهات React. يحفظ الإعدادات والتصريحات والتفضيلات بوقائع حقيقية، ويعرض خطة فارغة وتعذرًا صريحًا عندما يلزم المحتوى. يمنع أوامر الجلسة والتقييم في بناء الواجهة الحالي. يستعمل IndexedDB افتراضيًا، ويُحقن مخزن الذاكرة صراحة في الاختبارات فقط.
2. `LearningApplication` في `src/application/learning.ts`: خدمة HME قابلة لإعادة التشغيل، اختُبرت على وحدات صناعية مع مُجيز محتوى خاص بالاختبار. القيمة الافتراضية `allowUnit=()=>false` تمنع تفعيل وحدة غير معتمدة. لم تُربط جلسات الواجهة بها بوصفها جلسات قرآن إنتاجية.

`src/domain/contracts.ts` يحدد مخططات TypeScript وحدود الاستعلامات والنتائج؛ `src/application/validation.ts` يحقق مدخلات الأوامر والاستعلامات وقت التشغيل. لا يوجد حتى الآن ملف JSON Schema منشور لكل عقد، ولا حقل `contractVersion` مستقل لكل C، ولا تحقق مستقل شامل لمخرجات كل محوّل وقت التشغيل. النسخ الحالية مشتركة في metadata، وإصدارات المحتوى والنسخ الاحتياطي محددة في مكوناتها. هذه نواقص 05-B، ولا يغطيها مجرد وجود الأنواع.

## نسخ التنفيذ المشتركة

| النطاق | الإصدار الفعلي |
|---|---|
| إسقاط واجهة المنتج | `05A-product-1`، مع `source=event-store` و`learningEvidence=false` |
| حزمة الحدث | `VERSIONS` من `src/core/types.ts`، schema=1، مع policy/rubric/model/content وتحديد تطبيق FSRS وسياسة الوقت |
| HME | `hme-0.1-engineering-05a.1` |
| P0 / rubric | `P0-0.1.0` / `manual-recall-0.1.0`؛ تجريبية |
| FSRS | FSRS-6؛ `hme-fsrs6-research-binary64-0.1.0`؛ مكتبة مرجعية مثبتة غير متاحة، و`libraryConformance=blocked` |
| المحتوى | `ContentManifestV1.schemaVersion=1`؛ قائمة جهات الثقة الإنتاجية فارغة؛ لا حزمة قرآن فعالة |
| التخزين | IndexedDB schema=2؛ ملف الحدث الخام يحفظ النسخ ولا يعاد تفسيره صامتًا |
| النسخ الاحتياطي | formatVersion=1؛ AES-256-GCM + PBKDF2-SHA256، مع مصادقة البيان والحمولة |
| التوقع / الإشعار / الوسائط | `forecast-gate-1` / `notification-policy-1` / `local-media-1` |

تُرفض الإصدارات غير المدعومة بدل ترقيتها ضمنيًا. دعم إعادة تشغيل عدة إصدارات تاريخية من HME لم ينفذ؛ السلوك الحالي هو الرفض الصريح. لا توجد بوابة مطابقة مستقلة ناجحة لمكتبة FSRS في هذا التسليم.

## سجل العقود

### C01 — ContentManifest

| الحقل | الحالة الفعلية |
|---|---|
| Input Schema | استعلام `{operation:'read'|'resolve', range?}`. بوابة المحتوى المستقلة تستقبل `ContentPackage` و`ContentApproval`، والحل يستقبل edition/surah/ayah/token bounds. |
| Output Schema | الواجهة تعيد unavailable مع text/map/source/license/hash=null. البوابة المستقلة تعيد metadata متحققة ومواضع كلمات من البايتات الأصلية عند وجود حزمة موقعة معتمدة. |
| Validation | مخطط مدخل الاستعلام؛ رواية حفص؛ المصدر والترخيص؛ SHA-256 للنص والخريطة والخط؛ ترتيب وتفرد المواضع وحدود الاستخراج؛ أبعاد المراجعة وتوقيع ECDSA من جهة ثقة. لا يثبت hash صحة النص القرآني علميًا. |
| Error Types | INVALID_INPUT، CONTENT_UNAVAILABLE، CONTENT_INTEGRITY_FAILURE، REFERENCE_MISMATCH. |
| Version | Manifest schema=1 + نسخة المحتوى والطبعة والخريطة والخط؛ metadata مشتركة. |
| Persistence | الحزمة الفعالة داخل ContentGate الحالي في الذاكرة؛ مستودع حزم دائمة/تنزيل/تراجع إنتاجي غير مربوط. لا نص قرآن محفوظ معتمد. |
| Tests | CG01–CG07: اجتازت في تشغيل صناعي؛ AS01 يثبت حالة التعذر. |
| UI Consumers | S01، S03، S07، S08، S12، S15، S16، S17. |
| Status / Blocker | **Partially Implemented**: بوابة النزاهة منفذة ومختبرة؛ تفعيل القرآن **Blocked** لغياب المصدر والطبعة والمراجعة والترخيص والحزمة المعتمدة. |

### C02 — UserPlanConfig

| الحقل | الحالة الفعلية |
|---|---|
| Input Schema | `{operation:'read'|'save',config?,command?}`؛ الحفظ الفعلي عبر أمر `config`، وتصريحات `range.add/remove`، مع commandId/revision/now. |
| Output Schema | إعداد persona/minutes/days/goal/startSurah/zoneId/configured، وreceipt ضمن الحالة المؤكدة؛ `query(save)` يرفض استعمال الاستعلام لتغيير البيانات. |
| Validation | minutes integer 0–1440؛ أيام صحيحة غير مكررة؛ persona/goal والمسار ضمن القيم؛ exact shape ومنع حقول accessor/prototype؛ نطاقات مصرح بها دون إتقان مفترض. |
| Error Types | INVALID_INPUT، EVENT_CONFLICT، REVISION_CONFLICT، WRITE_NOT_CONFIRMED، STORAGE_FULL. |
| Version | metadata المشتركة وإصدار الحدث؛ لا contractVersion مستقل. |
| Persistence | UserPlanConfigRevised وPriorKnowledgeDeclared/Removed في EventStore؛ projection يعاد من الوقائع. |
| Tests | AS02–AS06، AS11، اختبارات validation؛ نجحت في تشغيل الخدمات المستهدف. |
| UI Consumers | S01، S02، S03، S06، S17. |
| Status / Blocker | **Partially Implemented**: إعداد وتصريحات حقيقية؛ تكامل خطة تعلم ومحتوى واختبار IndexedDB الفعلي متبقي. |

### C03 — DiagnosticRecovery

| الحقل | الحالة الفعلية |
|---|---|
| Input Schema | استعلام diagnostic/gap/backlog وoutsideReview؛ أمر RecoveryStarted صناعي بمدة الانقطاع وبذرة ووقت؛ canonical units في النواة. |
| Output Schema | الواجهة تعيد sample=[] وuntested=كل التصريحات مع تقرير التعاهد الخارجي. النواة تعيد خطة عينات طبقية قابلة للاستكمال، لا وقائع فشل. |
| Validation | أنواع المدخلات؛ بذرة ومدد/تكلفة صحيحة؛ مرجع وحدة موثوق عبر allowUnit؛ لا تعميم على غير المختبر. |
| Error Types | INVALID_INPUT، CONTENT_UNAVAILABLE، REFERENCE_MISMATCH، UNSUPPORTED_VERSION. |
| Version | P0-0.1.0 + VERSIONS؛ seed محفوظ في أمر الاستعادة. |
| Persistence | ExternalMaintenanceReported في المنتج؛ RecoveryStarted محفوظ في خدمة التعلم الصناعية؛ نتائج العينة تحتاج محاولات فعلية مستقلة. |
| Tests | LA12، LA13؛ اختبارات HME الغياب 3/21/90 والبذرة/توزيع الطبقات؛ AS01. |
| UI Consumers | S03، S04، S08، S11، S13. |
| Status / Blocker | **Partially Implemented**: تخطيط صناعي مختبر؛ مسار التشخيص والتسميع الحقيقي غير مفعل. |

### C04 — DailyPlanQueryReplan

| الحقل | الحالة الفعلية |
|---|---|
| Input Schema | read/replan، localDate؛ أمر plan.todayBudget؛ نواة PlanRecomputed تتلقى minutes/spentMinutes/candidates/futureLoadFeasible. |
| Output Schema | الواجهة تعيد tasks/deferred فارغين وcapacityStatus=uncertain مع السبب والوقت الحقيقي؛ نواة planDay تعيد اختيارًا وتكاليف ومؤجلًا وأسبابًا من مرشحين صناعيين. |
| Validation | تاريخ محلي حقيقي؛ دقائق صحيحة؛ رفض حقن fixture scenario؛ تفرد المرشحين وتداخل التغطية؛ الاحتياط والمنفق مرة واحدة؛ فصل المواعيد. |
| Error Types | INVALID_INPUT، CAPACITY_CONFLICT، REVISION_CONFLICT، CLOCK_UNCERTAIN، CONTENT_UNAVAILABLE. بعض رموز النواة DomainError أوسع من اتحاد أخطاء العرض ويحتاج توحيدًا. |
| Version | P0 + VERSIONS + revision الخطة. |
| Persistence | PlanRecomputed في سجل المنتج لميزانية اليوم؛ خطط خدمة التعلم تحفظ أمر المرشحين وإسقاطه. |
| Tests | AS06؛ HME اختبارات 30/60/120 وتكلفة 25/49/97 والجديد 0/0/28؛ المنفق 6 من 120 ينتج 96؛ المؤجل/الدين/العجز. |
| UI Consumers | S02، S05، S06، S11، S13، S19. |
| Status / Blocker | **Partially Implemented**: المحرك الحسابي مختبر صناعيًا؛ لا مولد مرشحين إنتاجي من المحتوى/التاريخ موصول بالواجهة، ولا قبول لحمل المستقبل بمجرد قيمة يرسلها العميل. |

### C05 — SessionCheckpoint

| الحقل | الحالة الفعلية |
|---|---|
| Input Schema | read؛ أوامر SessionStarted/Paused/Resumed/Ended وRecallAttemptRestarted في خدمة التعلم. |
| Output Schema | واجهة المنتج checkpoint=null؛ خدمة التعلم تعيد session phase/repetitions/attemptId وآخر وقت مؤكد. |
| Validation | هوية/مرجع الجلسة؛ انتقالات مشروعة؛ جلسة واحدة مفتوحة؛ لا إتمام تلقائي لتسميع انقطع؛ rollback عند فشل الكتابة. |
| Error Types | INVALID_INPUT، REFERENCE_MISMATCH، INSUFFICIENT_EVIDENCE، REVISION_CONFLICT، CONTENT_UNAVAILABLE، WRITE_NOT_CONFIRMED. |
| Version | VERSIONS + schema=1؛ سجل الجلسة قابل للإسقاط من الوقائع. |
| Persistence | وقائع الجلسة؛ لا snapshot واجهة هو مصدر الحقيقة. |
| Tests | LA06–LA08 وLA14–LA16؛ ES01/ES05؛ IDB01/IDB05 مكتوبان ولم يشغلا بنجاح. |
| UI Consumers | S04، S05، S07، S08، S09، S10، S13. |
| Status / Blocker | **Partially Implemented**: استئناف صناعي مختبر بمخزن مرجعي؛ ربط UI وIndexedDB/قتل العملية/انقطاع الطاقة غير مثبت. |

### C06 — ExposureRepetition

| الحقل | الحالة الفعلية |
|---|---|
| Input Schema | read؛ ExposureCompleted/RepetitionCompleted بمصدر reading/listening/assisted_recall/unassisted_training وsessionId. |
| Output Schema | واجهة المنتج confirmedRepetitions=0 وmastery=null؛ خدمة التعلم تعد الوقائع المؤكدة وتحتفظ بالتعرض منفصلًا عن المراجعة. |
| Validation | وضع التدريب الصحيح؛ معرف عملية فريد؛ المصدر من enum؛ لا تعلم من تشغيل صوت لم يحدث؛ لا إتقان من العد. MethodProfile تشغيلي كامل لكل المنهج لم يربط بالواجهة. |
| Error Types | INVALID_INPUT، EVENT_CONFLICT، REVISION_CONFLICT، CONTENT_UNAVAILABLE، WRITE_NOT_CONFIRMED. |
| Version | VERSIONS؛ methodVersion ظاهر في metadata، ملف المنهج الإنتاجي يحتاج تثبيتًا واعتمادًا. |
| Persistence | ExposureCompleted/RepetitionCompleted؛ same command retry أثر واحد. |
| Tests | LA02، LA03، LA07، LA08؛ HME “40 confirmed repetitions…”؛ ES01–ES05. |
| UI Consumers | S07، S08؛ محجوبان عن إنشاء جلسة قرآن الآن. |
| Status / Blocker | **Partially Implemented**: الوظيفة الصناعية تعمل؛ المحتوى/المنهج/الصوت وربط العرض متبقية. |

### C07 — RecallAttemptAssessment

| الحقل | الحالة الفعلية |
|---|---|
| Input Schema | read+attemptId؛ بدء/إنهاء/مساعدة/تقييم/تصحيح مع requested/attempted words وerrors nullable وcompletion/effort/gap provenance. |
| Output Schema | استعلام واجهة الإنتاج يعيد CONTENT_UNAVAILABLE؛ النواة تعيد strictPass/effectiveRating/eligibility/reasonCodes، انتقالات الدليل، حالة الذاكرة ومواعيد منفصلة عندما تكون المحاولة مؤهلة. |
| Validation | التلميحات والكشف والفشل الصريح؛ unknown/disputed يبقيان مجهولين؛ نوع الاختبار/المصدر/التغطية؛ التصحيح بإصدار وسبب؛ المرجع الزمني من بداية التسميع؛ لا اعتبار V1 تحققًا مستقلًا. |
| Error Types | INVALID_INPUT، CONTENT_UNAVAILABLE، REFERENCE_MISMATCH، REVISION_CONFLICT، CLOCK_UNCERTAIN، UNSUPPORTED_VERSION، INSUFFICIENT_EVIDENCE. |
| Version | HME/P0/rubric/FSRS ضمن VERSIONS؛ model=FSRS-6؛ مطابقة المكتبة blocked. |
| Persistence | RecallAttemptStarted/Completed وHintUsed وAssessmentSubmitted/Corrected؛ الأصل محفوظ وإعادة الحساب في تاريخ المراجعة الأصلي. |
| Tests | LA04–LA06 وLA09–LA11؛ اختبارات HME nullable/hints/transitions/continuity؛ اختبارات FSRS المرجعية. مطابقة المكتبة لم تنفذ. |
| UI Consumers | S04، S07، S08، S09، S10، S11، S13، S15. |
| Status / Blocker | **Partially Implemented**: نواة صناعية مختبرة؛ لا جلسة قرآن UI ولا اعتماد حسابي لمكتبة FSRS ولا تحقق تلاوة مستقل. |

### C08 — Mistake

| الحقل | الحالة الفعلية |
|---|---|
| Input Schema | read وattemptId اختياري؛ ProductMistakeDraftRecorded أو mistake.add/correct؛ النوع والثقة والموضع nullable. |
| Output Schema | drafts من وقائع المنتج؛ قرارات علاج محلية في HME لوحظت في اختبارات صناعية؛ لا موضع قرآن مولد. |
| Validation | observed/suspected/disputed؛ منع تحويل unknown إلى صفر؛ مرجع محاولة عند وجوده؛ تصحيح محدود الحقول لا يعيد كتابة هوية البلاغ أو تاريخ إنشائه. |
| Error Types | INVALID_INPUT، REFERENCE_MISMATCH، REVISION_CONFLICT، EVENT_CONFLICT. |
| Version | rubric/P0 ونسخ الحدث؛ MistakeEvent قرآني مؤهل أشمل من draft ولم يفعّل كاملًا. |
| Persistence | ProductMistakeDraftRecorded وMistakeCorrected؛ الأصل محفوظ. |
| Tests | LA10، LA11؛ HME ثلاثة أخطاء/فرص وعلاج word/link/tajwid؛ validation لحدود التصحيح؛ AS01. |
| UI Consumers | S08، S09، S12، S15. |
| Status / Blocker | **Partially Implemented**: مسودات وصدق missingness؛ ربط canonical location والعلاج/إعادة الاختبار والبلاغ المؤهل متبقٍ. |

### C09 — ProgressCoverage

| الحقل | الحالة الفعلية |
|---|---|
| Input Schema | read وrange اختياري. |
| Output Schema | التصريحات الحقيقية وعدد المحاولات 0 في UI الحالي؛ acquired/stable/links/globalCoverage=null مع سبب و30 جزءًا معلنًا/غير مقاس؛ نواة اتحاد صناعي ونطاقات وإثبات اتصال منفصل. |
| Validation | لا ملء فجوات؛ تطبيع تداخل داخل محور؛ طبعات مختلفة لا تجمع؛ النجاح الفردي لا يخفي رابطًا فاشلًا؛ العينة لا تعمم. |
| Error Types | INVALID_INPUT، REFERENCE_MISMATCH، CONTENT_UNAVAILABLE. |
| Version | projectionVersion + طبعة/تقطيع لازمان للاتحاد الحقيقي. |
| Persistence | derived projection؛ التصريحات والوقائع الخام مصدر الحقيقة. |
| Tests | AS02/AS03/AS01؛ HME overlap100+80−30=150، duplicate/edit/remove، weak/untested link؛ اختبارات 30 جزءًا للمكونات/التنقل. |
| UI Consumers | S03–S06، S09، S11–S15، S19. |
| Status / Blocker | **Partially Implemented**: عرض صادق للتصريح/المجهول؛ الإحصاء الكامل من تعلم حقيقي وخريطة قرآن معتمدة غير متاح. |

### C10 — Forecast

| الحقل | الحالة الفعلية |
|---|---|
| Input Schema | forecast/preview وminutes؛ بوابة مستقلة لتاريخ 28 يومًا/10 أيام نشاط/10 وحدات مؤقتة وكلفة التعاهد وقدرة واستقرار الخطة. |
| Output Schema | horizons وinitialCompletionDate=null؛ سبب امتناع محدد؛ preview لا يغير الخطة؛ modelStatus=retrospective_validation_pending. |
| Validation | أعداد صحيحة غير سالبة؛ منع nonfinite؛ مرور data gate لا يفعّل نموذجًا غير معتمد. |
| Error Types | INVALID_INPUT؛ الامتناع نتيجة مجال وليست فشل اتصال. |
| Version | forecast-gate-1 / P-FC01-1؛ قرار D08. |
| Persistence | معاينة واستعلام بلا وقائع تعلم؛ لا نموذج توقع أو لقطات أرقام مستقبلية. |
| Tests | P01–P02؛ AS01؛ validation؛ امتناع/معاينة الوقت في domain tests. |
| UI Consumers | S05، S19. |
| Status / Blocker | **Partially Implemented** للعقد الكامل؛ **Implemented & Tested** لفرع الامتناع فقط. نموذج التوقع والتحقق الرجعي غير منفذين. |

### C11 — SettingsVersions

| الحقل | الحالة الفعلية |
|---|---|
| Input Schema | read؛ preferences patch؛ تحديث إعدادات المنتج عبر command/revision. |
| Output Schema | تفضيلات حقيقية وmetadata/versions؛ engineAvailable=false وmigrationAvailable=false في واجهة المنتج. |
| Validation | exact boolean shape؛ رفض نسخة event/model غير مدعومة؛ migration DB منفصل عن هجرة الخوارزمية/المحتوى. |
| Error Types | INVALID_INPUT، UNSUPPORTED_VERSION، REVISION_CONFLICT، WRITE_NOT_CONFIRMED. |
| Version | VERSIONS + projectionVersion؛ لا سجل إصدارات تاريخية متعدد منفذ. |
| Persistence | PreferencesRevised وإصدارات الوقائع؛ schema migration في محول التخزين. |
| Tests | AS05، AS10، AS11؛ UI failed event commit؛ IDB08/09/11/12 غير مشغلة. |
| UI Consumers | S01، S02، S10، S17، S18. |
| Status / Blocker | **Partially Implemented**: الإعدادات ورفض غير المدعوم؛ هجرة HME/المحتوى وتراجع إصدار معتمد غير منفذين. |

### C12 — BackupDataControl

| الحقل | الحالة الفعلية |
|---|---|
| Input Schema | query inspect+serialized يعيد توجيهًا للخدمة غير المتزامنة؛ exportBackup(password)، inspectBackup(serialized,password)، replaceFromBackup(serialized,password,confirmed)، reset. |
| Output Schema | ملف مشفر مهيكل؛ نتيجة compatible/reason/eventCount؛ حالة مستبدلة بإقرار CAS؛ حذف السجل يبدأ هوية جديدة مع الإعدادات المعلنة. |
| Validation | سر 12 UTF-16 code units على الأقل؛ حجم 32MiB و100000 حدث؛ مصادقة header/ciphertext؛ hash manifest؛ schema/model/content versions؛ تفرد IDs؛ replay قبل التعديل؛ تأكيد استبدال كامل؛ CAS؛ لا merge. |
| Error Types | INVALID_INPUT، UNSUPPORTED_VERSION، CONTENT_INTEGRITY_FAILURE، EVENT_CONFLICT، CONSENT_REQUIRED، REVISION_CONFLICT، WRITE_NOT_CONFIRMED، STORAGE_FULL؛ خطأ المصادقة يحفظ الأصل. |
| Version | format=MULAZAMA-ENCRYPTED-BACKUP وversion=1، cipher/KDF parameters مثبتة؛ VERSIONS ضمن الحمولة. |
| Persistence | EventStore.replace/clear ذريًا في المحول؛ البايتات المصدرة تحفظ إلى وجهة يختارها المستخدم؛ التطبيق لا يستطيع حذف النسخ الخارجية. |
| Tests | B01–B13، AS08–AS09، ES08–ES11 نجحت مرجعيًا؛ IDB06/10 غير مشغلة؛ E2E export/inspect/replace مكتوب غير مشغل. |
| UI Consumers | S18، S17. |
| Status / Blocker | **Partially Implemented**: تشفير/فحص/حد الاستبدال مختبرة؛ معاملات IndexedDB الفعلية وواجهة الملفات والمتصفح/الأجهزة لم تعتمد؛ لا وصف بجاهزية إنتاجية. |

### C13 — NotificationCandidates

| الحقل | الحالة الفعلية |
|---|---|
| Input Schema | read؛ notificationCandidates(tasks,policy)؛ reconcileNotifications(port,desired). |
| Output Schema | UI يعيد candidates=[] وscheduled=false وpermission=not_requested؛ الدالة المستقلة تعيد candidates بمعرفات/نسخ خطة ومنطقة زمنية ونص عام مُلازَمَة. |
| Validation | الإذن/التفعيل/جلسة نشطة؛ السكون؛ حد يومي وفاصل؛ إلغاء القديم والمتغير؛ تفرد المهام ومعرفات الإشعار؛ لا catch-up burst. |
| Error Types | INVALID_INPUT، EVENT_CONFLICT؛ PLATFORM_UNAVAILABLE عبر capability عند غياب منفذ الجدولة. |
| Version | notification-policy-1 + planRevision + zoneId. |
| Persistence | محول النظام المستقبل يملك الطلبات؛ لا جدولة نظام فعلية ولا حالة scheduled زائفة في UI. |
| Tests | P03–P09 نجحت مع منفذ اختبار؛ P10 يثبت التعذر؛ NFR النظامية لم تنفذ. |
| UI Consumers | S05، S13، S17. |
| Status / Blocker | **Partially Implemented**: سياسة/مصالحة مختبرتان؛ منفذ OS والأذونات/السحب وإعادة التشغيل والدفع من إشعار قديم غير مربوط. |

### C14 — LocalMedia

| الحقل | الحالة الفعلية |
|---|---|
| Input Schema | read؛ لا طلب تسجيل/تشغيل إنتاجي مفعّل. |
| Output Schema | available=false، recordingRef=null، microphoneRequested=false، referenceAudioAvailable=false، scheduledUpload=false. |
| Validation | عدم طلب أذونات أو رفع تلقائي؛ لا ادعاء تشغيل صوت غير موجود. محقق ملف صوت/ترخيص/حذف وتسجيل غير منفذ. |
| Error Types | CONTENT_UNAVAILABLE / PLATFORM_UNAVAILABLE بوصف قدرات غير متاحة؛ الاستعلام الحالي نتيجة تعذر صريحة. |
| Version | local-media-1. |
| Persistence | لا ملفات صوت ولا أسرار ولا تسجيلات. |
| Tests | P10 وAS01 يثبتان الحالة؛ رفض/سحب الإذن والانقطاع وحذف الملفات لم تختبر لأنها غير منفذة. |
| UI Consumers | S07، S08، S10، S16، S17. |
| Status / Blocker | **Not Implemented** لعمليات الوسائط؛ فرع capability unavailable **Implemented & Tested**. يلزم صوت مرخص ومنافذ منصة إن أدرجت في النطاق. |

## أدلة التشغيل ومحدودية الاستنتاج

**النتيجة النهائية الأحدث:** [unit-results.json](unit-results.json) تتضمن **299/299 اختبارًا ناجحًا، بلا فشل أو تعليق**: 30 مكوّنًا، 16 خدمة تعلم، 11 خدمة منتج، 75 تحققًا، 65 HME، 20 FSRS، 33 نطاق/حالة، 7 محتوى، 13 نسخًا، 18 مخزنًا مرجعيًا، 10 منصة، وقياس مضيف واحد. لا يعني العدد أن جلسات القرآن أو منصة الهاتف فُعّلت.

المراجعة المستقلة [peer-review.md](peer-review.md) نفذت 21/21 إعادة إنتاج منفصلة؛ لا تُضاف إلى عدد Vitest. نسخ التشغيلات المستهدفة في `evidence/targeted/` لقطات ثانوية أقدم ومتداخلة، ولا تجمع مع النتيجة النهائية.

- فحوص IndexedDB الاثنا عشر وE2E/axe الحالية مكتوبة؛ لم تنجح إعادة تشغيلها بسبب قيود الخادم المحلي/المتصفح.
- وُلد Service Worker وبيان أربعة أصول للغلاف المحلي. اختبار فتح بارد دون شبكة مكتوب في `e2e-offline/shell.spec.ts`، لكنه تعذر قبل التنفيذ عند localhost:4174؛ وجود الكود ليس إثبات عمل دون اتصال.
- [performance-results.json](performance-results.json) قياس Node صناعي لمخطط 1000 مرشح ومخزن ذاكرة 10000 حدث وإعادة إسقاط 100 حدث؛ لا قياس قاعدة متصفح أو جهاز أو P95.
- [security-check-results.json](security-check-results.json) فحص ساكن محدود بلا findings ضمن 27 ملفًا؛ تدقيق الاعتماديات محجوب بالشبكة، ولا penetration test.
- لا يوجد native build أو قارئ شاشة بشري أو محتوى قرآن معتمد.

“PASS” يخص الاختبار وحدوده، ولا يغلق تلقائيًا متطلب المنتج كاملًا. انظر [المصفوفة](requirements.md)، و[فحص الحساب](hme-calculation-audit.md)، و[التخزين](persistence.md)، و[المحتوى والخصوصية](content-privacy-platform.md).
