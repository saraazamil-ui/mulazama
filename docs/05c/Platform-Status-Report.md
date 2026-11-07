# MULAZAMA — Phase 05-C Platform Status

**التاريخ:** 5 نوفمبر 2026 (الرياض). لم ينشأ مشروع أصلي أو يُبنَ APK/AAB/IPA. نجاح الويب لا يثبت أي نتيجة للهاتف.

| المنصة | الموجود فعليًا | التحقق | الحالة |
|---|---|---|---|
| Web | React/TypeScript/Vite ونواة HME ومحول IndexedDB وWebCrypto وservice worker | اختبارات Node/DOM في final؛ Playwright وoffline في تقريرهما المستقل | تنفيذ هندسي؛ اعتماد الإنتاج Blocked |
| iOS | لا xcodeproj/xcworkspace/Podfile أو طبقة منصة فعلية | البناء/المحاكي/Keychain/VoiceOver Not Tested | Not Implemented |
| Android | لا مشروع Gradle/manifest أصلي أو طبقة منصة فعلية | APK/AAB/Keystore/TalkBack Not Tested | Not Implemented |

`evidence/release/native-inventory.json` أعيد توليده فعليًا: CommandLineTools موجود؛ xcodebuild يرفض غياب Xcode الكامل، Xcode.app غير موجود؛ adb/sdkmanager/Gradle غير متاحة؛ Java Runtime وAndroid Studio وSDK القياسي غير موجودة. لا تستنتج هوية متجر أو packageId أو توافقًا من هذه الفحوص.

## قرار المنصة المقترح

أقصر مسار للاستفادة من الواجهة الحالية هو غلاف Capacitor مع إبقاء نواة HME TypeScript مستقلة عن DOM. هذا اقتراح هندسي لم ينفذ أو يتحقق بناؤه؛ يلزم مرحلة منصة مستقلة لأن الأدوات الضرورية غائبة ولأن غلاف WebView وحده لا يغلق تخزين الهاتف ودورة حياته.

| الجزء | ما يمكن مشاركته | طبقة الهاتف المطلوبة ومعيار التحقق |
|---|---|---|
| HME/FSRS والعقود | core/application والتحقق وإعادة التاريخ بمعرف الإصدار | نفس golden vectors والعقود على runtime الهاتف دون تحويل صامت للتاريخ |
| العرض | React وCSS RTL مع مراجعة WebView | safe areas ولوحة المفاتيح وتكبير النظام وقارئات الشاشة؛ تجربة أجهزة فعلية |
| التخزين | EventStore API وCAS ومخطط الأحداث وملف الترحيل | SQLite معاملات حقيقية؛ Keychain/Android Keystore لتغليف المفاتيح؛ لا تخزين خام حساس في Preferences |
| الصوت | عقود وسجلات الإذن والمصدر | تسجيل/تشغيل وإيقاف عند background ومكالمات ورفض الإذن وحذف الملف؛ الصوت المرجعي يحتاج حقوقًا مستقلة |
| الإشعارات | توليد المرشحين وسياسة الخصوصية | جدولة نظامية وتغير timezone وإلغاء بعد reset/restore؛ لا نص حساس على قفل الشاشة |
| النسخ | صيغة الملف والتشفير ومخططات التحقق | اختيار ملفات/مشاركة وتأكيد استبدال وتراجع ذري ودعم interruption؛ لا مساواة نسخ نظام التشغيل بتصدير التطبيق |
| الإصدار | قواعدG01–G10 وعقود مصدر/نسخة/محتوى | attestations مستقلة platform=ios/android، لا إعادة استعمال دليلweb |

## خطة تنفيذ قابلة للتحقق

1. تثبيت قرار Capacitor وإصدار pinned، وضبط appId قانوني وملاك التوقيع؛ بناء مشروع Android أولًا في بيئة JDK/SDK/Gradle متاحة، وiOS في Xcode كامل. ملفات القفل ومصدر plugins تدخل بصمة الإصدار.
2. إنشاء EventStore SQLite ومحول مفاتيح منصة، واختبارات الترحيل والفشل وCAS والملء والحذف؛ عدم اعتماد IndexedDB WebView كضمان تلقائي.
3. تنفيذ lifecycle checkpoint/resume وتفسير interruption بلا إتمام مختلق؛ اختبارات kill/process/relaunch على محاكٍ وجهاز.
4. إدخال الملفات والصوت والإشعارات تباعًا مع رفض الأذونات وانقطاعها وفقد الملفات واختبار restore/delete.
5. تشغيل نفس conformance والعقود ثم RTL/VoiceOver/TalkBack وتكبير وأداء أجهزة متوسطة، مع أدلة مستقلة لكلمنصة وبقاء المحتوى محجوبًا حتى توقيعG01/G10.
6. بناء signed release تجريبي بقنوات توزيع مضبوطة بعد استيفاء بوابات المنصة؛ فحص privacy manifest/permissions وبيانات المتجر مستقل عن نجاح البناء.

لا حاجة لإنشاء skeleton غير قابل للبناء لمجرد وجود مجلد iOS/Android؛ المخرج الحالي يحدد صراحة العمل غير المنفذ واعتمادياته.
