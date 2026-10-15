# Safari وiPhone — خطة قبول 1.3

**الحالة: مجهز، لم يُنفذ على جهاز Apple.** هذا التقرير لا يصف Linux WebKit أوأحجام CSS بأنها Safari حقيقي.

يحتاج Safari الحقيقي إلى Mac. اختبار iPhone أوiPad الحقيقي يحتاج جهازًا متصلًا بـMac ومفتوح القفل مع الوثوق بالجهاز المضيف وتفعيل Remote Automation. راجع [Apple](https://developer.apple.com/documentation/safari-developer-tools/ios-enabling-webdriver) و[WebKit](https://webkit.org/blog/9395/webdriver-is-coming-to-safari-in-ios-13/).

## التشغيل على Mac

بعد تثبيت المصدر وبنائه بـ`pnpm run build:vercel`، افتح طرفيتين:

```sh
# مرة واحدة على جهاز التجربة؛ قد يطلب صلاحية مشغل Mac
safaridriver --enable
# طرفية مستقلة
safaridriver --port 4444
```

في طرفية أخرى شغل Next على عنوان الاختبار. ثم:

```sh
node scripts/qa-safari.mjs
```

الافتراضي `http://127.0.0.1:3000/`، ويختبر صفحة الدخول العامة فقط؛ لا يوجد عرض تجريبي أوحساب وهمي في المنتج. يسجل التقرير `coverage=public-login-only`. يفحص RTL والصور وتجاوز عرض الشاشة على أحجام مختلفة. ينتج `qa-output/safari-result.json` ولا تُكتب النتيجة يدويًا.

لفحص الواجهات بعد الدخول استخدم قاعدة staging وحساب اختبار مخول، واضبط `SAFARI_USERNAME` و`SAFARI_PASSWORD` محليًا و`SAFARI_ALLOW_AUTH_TEST=yes`. لا تحفظ القيم في Git أوالأوامر المشتركة أوتقارير الاختبار. التقرير يحدد تغطية الدخول، ولا يجلب بيانات إنتاج. يختبر متابعتي وقوائم الرتب والطلبات والملف والتنبيهات والسجل وفتح حوار وقائمة الهاتف. يعتمد ظهور كل مساحة على صلاحية حساب الاختبار.

على GitHub يوجد تشغيل يدوي في Actions باسم **Safari on macOS (manual)**. هذا فحص Mac Safari، ولا يثبت فحص iPhone. لم يتم تشغيله؛ اتصال GitHub الحالي لا يملك الكتابة على المستودع المرسل.

## iPhone أوiPad فعلي

على نفس Mac بعد توصيل الجهاز وتفعيل الإعدادات الرسمية، اجعل عنوان Next متاحًا للجهاز على الشبكة المحلية. لا تستخدم عنوان127.0.0.1 للوصول من الهاتف إلىMac.

```sh
SAFARI_TARGET=ios SAFARI_TEST_ORIGIN=http://MAC_LAN_ADDRESS:3000 node scripts/qa-safari.mjs
```

`ios` يرسل `platformName=ios` و`safari:useSimulator=false`. يمكن تحديد `SAFARI_DEVICE_UDID` محليًا عند وجود أكثر من جهاز؛ لا تضع معرف الجهاز فيGit أوسجل الإداريين أوالشات. الاختبار لا يكتب هذا المعرف في التقرير. لم يُجر اختبار المحاكي أيضًا.

## القبول اليدوي بعد الربط

| التجربة | المطلوب |
|---|---|
| iPhone رأسي وأفقي | لا تمرير أفقي، الأزرار ظاهرة، مراعاة المساحة الآمنة |
| iPad رأسي وأفقي | ترتيب الأعمدة والجدول والقائمة الجانبية |
| لوحة المفاتيح | الحقول لا تختفي خلفها، عدم التكبير التلقائي، حفظ/إغلاق متاحان |
| حفظ الدخول | أغلق Safari وافتحه، وافحص المهلة والخروج من كل الجلسات |
| الصور | اختيار صورة رمزية وتغييرها، دون حفظ الصورة الأصلية أوEXIF |
| الأدوار | Helper لا ينشر، Moderator يرى إحصائياته فقط، Responsible يدير الفريق |
| الإجازة | طلب برابط Discord، لا خصم عند الإرسال، خصم مرة واحدة عند القبول |
| الوصول | ترتيب التركيز وVoiceOver وReduce Motion وتباين النص |

هذه الحالات الحية لم تُنفذ. WebDriver لا يغطي كل سلوك لوحة مفاتيح iOS أواختيار الصور أوVoiceOver؛ يلزم المرور اليدوي عليها.

قيد بيئة التطوير الحالية حسب [Sites SKILL.md](skill://plugin_connector_1p_689987207de08191979cf68eca2941c6/sites/SKILL.md): “If `$control-browser` is unavailable, skip browser QA: do not start a preview server, install a browser, or improvise another browser-control path.” لذلك جرى فحص الكود وHTML والبناء وتجهيز مسار Apple، دون ادعاء تجربة متصفح فعلية.
