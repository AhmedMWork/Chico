# Chico Admins 1.4.1

تحديث الواجهة بعد الدخول وتحسين استجابة Login. الحزمة كاملة وتشمل تصميم 1.4 لمن يرفع من 1.3 مباشرة.

## الواجهة

- أزيلت الشبكة الزخرفية من Login، وخُففت الإطارات المتداخلة.
- الترحيب وWeekly points وNext shift ضمن مساحة واحدة؛ الأرقام في شريط أداء موحد، ويتحول لصفين على الموبايل.
- كحلي أفتح مع Lavender وMint وCoral، أيقونات دائرية وفواصل خفيفة بدل كثرة الكروت.
- الإجراءات السريعة وقوائم التوب أبسط، وصورة OneState محفوظة. الحركة تدعم إعداد Reduce Motion.
- اللغة عربي وEnglish والرتب بالإنجليزية. العرض يعتمد على بيانات الحساب الفعلية.

## Login

- النموذج يستخدم POST حتى قبل تفعيل JavaScript؛ لا يرسل Password في رابط الصفحة. تظهر إرشادات عند تعطيل JavaScript.
- تمنع الواجهة إرسال طلبين بالضغط المتكرر أو تبديل النموذج أثناء الطلب.
- رسالة انتظار واضحة، ثم تنبيه عند بطء الاتصال، ومهلة 45 ثانية بدل انتظار مفتوح.
- رد HTML أو رد ناقص لا يُعامل كتسجيل دخول ناجح، وتظهر رسالة مفهومة.
- انقطاع الاتصال بالخدمة يرجع 503؛ كلمة المرور الخاطئة تبقى 401، وحد المحاولات 429.
- لا إعادة تلقائية لطلبات التسجيل أو تغيير كلمة المرور عند نتيجة غير مؤكدة.
- نفس Username وPassword وSave login، ونفس الجلسات والصلاحيات الحالية. لم تتغير مفاتيح البيئة أو ملفات SQL.

## تحديث GitHub وVercel

بتاريخ 15 أكتوبر 2026، رابط Vercel الفعلي `/api/status` يعرض `version: 1.3.0` و`configured: true`. ملف package.json على GitHub أيضًا 1.3.0. هذا يثبت إصدار الملفات وصيغة الإعدادات، ولا يثبت نجاح دخول حساب فعلي. يلزم رفع الحزمة الجديدة حتى تظهر تغييرات 1.4.1.

فك الحزمة الجديدة في مجلد مستقل، ثم افتح PowerShell داخل المجلد `Chico-Admins` المستخرج ونفّذ:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\update-from-release.ps1" -RepositoryPath "D:\New life\Chico\Chico-GitHub"
if ($LASTEXITCODE -ne 0) { throw "توقف التحديث. راجع الرسالة الظاهرة." }

Set-Location "D:\New life\Chico\Chico-GitHub"
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw "لم يكتمل تثبيت الاعتماديات." }
pnpm run typecheck
if ($LASTEXITCODE -ne 0) { throw "راجع خطأ TypeScript قبل الرفع." }
pnpm test
if ($LASTEXITCODE -ne 0) { throw "راجع الاختبار الذي لم ينجح قبل الرفع." }
git status --short
```

سكربت النسخ يحافظ على Git و.env.local. لا تنسخ مجلد app إلى app موجود يدويًا حتى لا يتكرر app/app.

بعد مراجعة الملفات ونجاح الفحوص:

```powershell
git add -- app components lib styles tests docs scripts package.json vercel.json README.md
git commit -m "Refine Chico dashboard and Login reliability v1.4.1"
if ($LASTEXITCODE -ne 0) { throw "راجع نتيجة git commit قبل المتابعة." }
git push origin main
```

انتظر نشر الـcommit الجديد بنجاح على Vercel. افتح:

https://chico-admin.vercel.app/api/status

المتوقع: `version: 1.4.1` و`configured: true`. لو الإصدار بقي 1.3.0 أو1.4.0، النشر الأحدث لم يصل بعد. لا تمسح الحسابات أو تعِد إنشاء Owner لحل مشكلة إصدار قديم.

## فحص الدخول على موقعك

1. ادخل بالحساب الحالي وفعّل Save login. يجب فتح Dashboard أو صفحة انتظار الاعتماد حسب حالة الحساب.
2. أعد تحميل الصفحة؛ يجب بقاء الجلسة. اختبر فتح الموقع بعد إغلاق المتصفح إذا فعّلت Save login.
3. من نافذة خاصة، جرّب Password خاطئًا مرة واحدة؛ يجب ظهور رسالة دون انتقال إلى Dashboard.
4. عند تعطل الخدمة، يجب ظهور رسالة واضحة بدل انتظار مفتوح. راجع Network: مسار `/api/login` وحالة HTTP فقط. لا تشارك Password أوCookie أومفاتيح الخدمة.
5. جرّب Menu وReports وRequests وNotifications على الموبايل والتابلت. الرتبة Helper أوSN.Helper لا يظهر لها نشر Report.

لا يوجد SQL جديد لهذا الإصدار. لا تغيّر SESSION_ENCRYPTION_KEY أوRATE_LIMIT_HMAC_KEY لمجرد تحديث التصميم؛ احتفظ بإعدادات Vercel الحالية.

## التحقق

نجح TypeScript و94 اختبارًا وبناء Next.js، وتم تحليل ملفات CSS دون أخطاء. تشمل الاختبارات الصلاحيات والخصوصية وSQL والجلسات، و9 اختبارات جديدة لطلب الدخول واستجابة الخدمة.

لم يُنفذ فحص متصفح أوSafari على iPhone فعلي في هذه البيئة، ولم يُختبر Login بحساب المستخدم على Vercel. النشر الخاص للمراجعة منفصل عن نشر Vercel، ولا يحتوي على مفتاح Supabase الخادمي اللازم لتشغيل حساباتك. لا يوجد ادعاء بضمان انعدام أعطال الخدمة الخارجية.
