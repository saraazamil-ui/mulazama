# MULAZAMA — Phase 05-C Requirements Matrix

**التاريخ:** 5 نوفمبر2026. تضم CSV جميع نصوص القصص ومعايير Given/When/Then الأصلية وربطR01–R30/AC01–AC30/C01–C14/S01–S19 كما وردت في مصفوفة05B وPRD. تحفظ النتيجة التاريخية في عمود مستقل؛ لا يُرفع معيار قبول كامل بسبب وجود شاشة أو نجاح وحدات صناعية. لا تساوي Function implemented وFunction production-enabled.

جميع الوظائف الإنتاجية الحرجة محجوبة حتى الأدلة والتوقيعات المطلوبة. عداد المجموعة النهائية يؤخذ من final-summary.json؛ لا تجمع معه تشغيل63 المتداخل.

| R | AC | العقود | الشاشات | الكود | الاختبار | الحالة |
|---|---|---|---|---|---|---|
| R01 | AC01 | C01 | S01 S16 S17 | src/content/content-gate.ts; src/application/service.ts; src/App.tsx; src/content/integrity.ts; src/release/gates.ts | QI01–QI22; CG01–CG07; AS01; RG08–RG09 | Blocked |
| R02 | AC02 | C02 | S01 S02 | src/application/service.ts; src/application/validation.ts; src/App.tsx | AS01 AS02 AS06 AS07; components.test.tsx; RG12 | Partially Implemented |
| R03 | AC03 | C02 C04 | S02 S17 | src/application/service.ts; src/application/validation.ts; src/core/hme.ts | AS02 AS05 AS06 AS11; validation.test.ts | Partially Implemented |
| R04 | AC04 | C03 | S03 S15 | src/domain/ranges.ts; src/application/service.ts; src/core/hme.ts | AS02 AS03; HI02; HME union/edit/remove tests | Partially Implemented |
| R05 | AC05 | C03 C07 | S04 | src/core/hme.ts; src/application/learning.ts; src/application/service.ts; src/application/learning-validation.ts | HI02 HI03; LA12 LA13; HME sampling tests | Partially Implemented |
| R06 | AC06 | C04 | S05 | src/core/hme.ts; src/application/learning.ts; src/application/service.ts; src/App.tsx; src/application/learning-validation.ts | HI01 HI05; HV07 HV11 HV12; AS06 | Partially Implemented |
| R07 | AC07 | C04 | S05 S06 | src/core/hme.ts; src/application/learning.ts; src/application/service.ts; src/application/learning-validation.ts | HI05; HME 30/60/120 reserve/debt tests; AS06 | Partially Implemented |
| R08 | AC08 | C05 C06 | S07 | src/core/hme.ts; src/application/learning.ts; src/platform/media.ts | LA01 LA02 LA07; HME training gates; P10 | Partially Implemented |
| R09 | AC09 | C06 | S07 | src/application/learning.ts; src/persistence/event-store.ts; src/core/hme.ts; src/application/learning-validation.ts | LA02 LA03 LA07 LA08; HV09 HV10; BK05B10; ES01 ES03 ES05 | Partially Implemented |
| R10 | AC10 | C07 C06 | S08 | src/application/learning.ts; src/core/hme.ts; src/App.tsx; src/application/learning-validation.ts | LA04 LA06; HV04 HV05; HME hint/reveal tests | Partially Implemented |
| R11 | AC11 | C07 | S09 | src/core/hme.ts; src/application/learning.ts; src/application/validation.ts; src/application/learning-validation.ts | LA04 LA05 LA10 LA11; HV01 HV02 HV03 HV08; HME nullable rubric | Partially Implemented |
| R12 | AC12 | C08 | S12 S09 | src/application/validation.ts; src/application/learning.ts; src/core/hme.ts; src/application/service.ts | LA10 LA11; validation correction; HME missingness/repair tests | Partially Implemented |
| R13 | AC13 | C07 C04 | S09 S06 | src/core/hme.ts; src/core/fsrs.ts; src/application/learning.ts; src/conformance/fsrs-conformance.ts | LA09; HI01 HI05; HME due/exposure; FSRS-G-* | Blocked |
| R14 | AC14 | C07 C09 | S11 S08 S15 | src/core/hme.ts; src/core/hme-types.ts; src/application/learning.ts; src/application/learning-validation.ts | HI04; HV08 HV17; HME connectedStatus tests | Partially Implemented |
| R15 | AC15 | C04 C09 | S11 S06 | src/core/hme.ts; src/application/learning.ts; src/application/service.ts | HI05; HME 900/30/20 maintenance capacity/debt | Partially Implemented |
| R16 | AC16 | C03 | S13 S04 | src/core/hme.ts; src/application/learning.ts; src/application/service.ts | HI03; LA12 LA13; HME absence 3/21/90 | Partially Implemented |
| R17 | AC17 | C09 | S05 S14 | src/core/hme.ts; src/application/service.ts; src/App.tsx | AS01 AS02 AS03; HI02 HI04; HME union/coverage | Partially Implemented |
| R18 | AC18 | C09 C01 | S14 S15 | src/application/service.ts; src/core/hme.ts; src/App.tsx | AS01; HI02 HI04; components.test.tsx; browser specs | Partially Implemented |
| R19 | AC19 | C10 | S19 S05 | src/platform/forecast.ts; src/application/service.ts; src/App.tsx | P01 P02; AS01; validation forecast | Partially Implemented |
| R20 | AC20 | C13 | S17 S05 | src/platform/notifications.ts; src/application/service.ts | P03–P10; AS01 | Partially Implemented |
| R21 | AC21 | C05 C12 | S01 S02 S03 S04 S05 S06 S07 S08 S09 S10 S11 S12 S13 S14 S15 S16 S17 S18 S19 | src/persistence/event-store.ts; src/application/learning.ts; src/application/service.ts; scripts/build-offline.mjs; e2e-offline/shell.spec.ts; src/release/runtime.ts | LA02–LA08; HI01; ES01–ES14; e2e-offline/shell.spec.ts | Blocked |
| R22 | AC22 | C05 | S07 S08 S09 S10 | src/application/learning.ts; src/persistence/event-store.ts; src/persistence/browser-tests05b.ts | LA06 LA07 LA08 LA14 LA15 LA16; HV04 HV05; IDB01–IDB21 | Blocked |
| R23 | AC23 | C12 | S18 | src/persistence/backup.ts; src/persistence/event-store.ts; src/application/service.ts; src/App.tsx | B01–B13; BK05B01–BK05B10; AS08; ES08–ES10 | Partially Implemented |
| R24 | AC24 | C14 C12 | S08 S17 S18 | src/persistence/backup.ts; src/persistence/event-store.ts; src/platform/media.ts; src/platform/notifications.ts | P10; AS01; LA04 LA05; B01–B13; BK05B01–BK05B10 | Partially Implemented |
| R25 | AC25 | C07 C11 | S09 S12 | src/application/learning.ts; src/application/validation.ts; src/core/hme.ts | LA09 LA10 LA11; HV03 HV08 HV13; HME correction replay | Partially Implemented |
| R26 | AC26 | C02 C11 | S02 S06 S17 | src/application/service.ts; src/core/hme.ts; src/application/learning.ts | AS06; HI05; HME reserve/spent/range version tests | Partially Implemented |
| R27 | AC27 | C11 C01 | S17 S18 | src/core/types.ts; src/core/fsrs.ts; src/application/service.ts; src/persistence/event-store.ts; src/content/content-gate.ts; src/release/gates.ts; src/release/access.ts | AS10; HV13; RG04 RG06 RG08; P05B05–P05B09; FSRS version tests | Blocked |
| R28 | AC28 | C12 | S18 | src/application/service.ts; src/persistence/event-store.ts; src/App.tsx | AS09; ES11; IDB10; IDB13–IDB21 | Partially Implemented |
| R29 | AC29 | C01 C05 | S01 S02 S03 S04 S05 S06 S07 S08 S09 S10 S11 S12 S13 S14 S15 S16 S17 S18 S19 | src/App.tsx; src/components.tsx; src/styles.css; e2e/production.spec.ts; src/local-fonts.css | components.test.tsx; e2e/production.spec.ts; E2E RTL/axe specs | Partially Implemented |
| R30 | AC30 | C05 C04; NFR | S01 S02 S03 S04 S05 S06 S07 S08 S09 S10 S11 S12 S13 S14 S15 S16 S17 S18 S19 | src/persistence/event-store.ts; src/application/service.ts; src/application/learning.ts; e2e/production.spec.ts; src/application/performance.test.mjs | PERF01; AS05 AS11; LA08; ES05 ES10; IDB01–IDB21 | Blocked |

## تغطية العقود والشاشات

الجدول التالي يثبت الاكتمال العددي للربط المرجعي، ولا يثبت نجاح العقد. تنفيذ التكامل الحالي وحدوده في HME-Integration-Report.md. نتائج المتصفح/المصحف/العلمية تتحكم في اكتمال المتطلب.

| العقد | المتطلبات ذات الصلة | حالة الإنتاج |
|---|---|---|
| C01 | R01, R18, R27, R29 | Blocked |
| C02 | R02, R03, R26 | Blocked |
| C03 | R04, R05, R16 | Blocked |
| C04 | R03, R06, R07, R13, R15, R30 | Blocked |
| C05 | R08, R21, R22, R29, R30 | Blocked |
| C06 | R08, R09, R10 | Blocked |
| C07 | R05, R10, R11, R13, R14, R25 | Blocked |
| C08 | R12 | Blocked |
| C09 | R14, R15, R17, R18 | Blocked |
| C10 | R19 | Blocked |
| C11 | R25, R26, R27 | Blocked |
| C12 | R21, R23, R24, R28 | Blocked |
| C13 | R20 | Blocked |
| C14 | R24 | Blocked |

| الشاشة | المتطلبات ذات الصلة |
|---|---|
| S01 | R01, R02, R21, R29, R30 |
| S02 | R02, R03, R21, R26, R29, R30 |
| S03 | R04, R21, R29, R30 |
| S04 | R05, R16, R21, R29, R30 |
| S05 | R06, R07, R17, R19, R20, R21, R29, R30 |
| S06 | R07, R13, R15, R21, R26, R29, R30 |
| S07 | R08, R09, R21, R22, R29, R30 |
| S08 | R10, R14, R21, R22, R24, R29, R30 |
| S09 | R11, R12, R13, R21, R22, R25, R29, R30 |
| S10 | R21, R22, R29, R30 |
| S11 | R14, R15, R21, R29, R30 |
| S12 | R12, R21, R25, R29, R30 |
| S13 | R16, R21, R29, R30 |
| S14 | R17, R18, R21, R29, R30 |
| S15 | R04, R14, R18, R21, R29, R30 |
| S16 | R01, R21, R29, R30 |
| S17 | R01, R03, R20, R21, R24, R26, R27, R29, R30 |
| S18 | R21, R23, R24, R27, R28, R29, R30 |
| S19 | R19, R21, R29, R30 |

## الدليل الوظيفي الجديد

أضيفت typed adapters في learning-ui-adapter.ts وLearningEngineScreen.tsx إلى S07–S13 عبر prop اختياري لا يمررهmain الإنتاجي. UIA01–08 (10حالات) وUIS01–03 (3حالات) تثبت مرور أحداث صناعية عبر LearningApplication؛ hme-ui-tests.json13/13 وhme-integration-regression.json58/58 متداخلتان. C03/C04/C05/C06/C07/C08/C09 تحسنت جزئيًا، مع بقاءC02 غير موصول تلقائيًا وC12 بلا دمج سجلي المنتج والتعلم. CSV يحتوي فروق كلR ذات الصلة؛ لا يزعم اكتمالAC أو فتح إنتاج.

## تحديث المنسق الموحد في05-C

أضيف CompositeApplication ومشاهد scoped لسجلي المنتج والتعلم داخل EventStore واحد. النسخة الموحدة تفحص replay لكلا المجالين وتستبدلهما بمعاملة واحدة، وتحجب النسخ أو الحذف الجزئي. ترتبط ميزانية التعاهد بإعداد الخدمة ووقت اليوم، وتبقى الكلفة تقديرًا صريحًا versioned غير معاير. يغطي CA01–CA09 الفشل وCAS والهوية والحذف والاستعادة؛ نتائج الدمج النهائية في final-summary.json. حُدثت الصفوف ذات الصلة في CSV؛ لا يرفع ذلك حالة المتطلبات إلى اكتمال إنتاجي أو تحقق IndexedDB.
