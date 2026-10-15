# Chico Admins 1.4 — تحديث التصميم

نسخة 1.4 تعيد ترتيب Login وOverview وTeam Hub، وتوحد تصميم بقية الشاشات. قاعدة البيانات والصلاحيات التشغيلية مستمرة من 1.3.

## ما تغير

- Slate / Ice Blue مع Coral للتنبيهات وViolet للنقاط وModerators. الخلفية داكنة دائمًا.
- Login بمشهد OneState الحقيقي، حقول واضحة، Login / Create account وSave login.
- Overview: ملخص باسم الإداري، Weekly points، Next shift، Tickets / Hours / Rating / Flags، إجراءات سريعة، نشاط وأرصدة، ثم Top Helpers وTop Moderators.
- Team Hub: مؤشرات الفريق والقرارات المطلوبة أولًا؛ أهداف الرتب في قسم يفتح عند الحاجة.
- عناوين قصيرة بين عربي وEnglish. أسماء الرتب بالإنجليزية فقط.
- تحديث تصميم Profile وNotifications وRequests والجداول والنوافذ والنماذج.
- التنقل من الموبايل بشريط ثابت، وMenu لبقية الصفحات. المدخلات 16px، ومساحات لمس مناسبة، ودعم safe-area وreduced-motion.
- Notification غير المقروء واضح باللون والعدد مع نبض هادئ. زر Refresh يتحرك أثناء التحميل.

## التشغيل والصلاحيات

- هذه النسخة لا تضيف SQL أو migrations. لا تعِد تشغيل SQL018 أوSQL019 بعد نجاحهما.
- لا تعِد إنشاء Owner. استخدم الحساب الحالي.
- لا تغيّر متغيرات Vercel أو.env.local لمجرد تحديث التصميم.
- نُقل فحص scripts/check-env.mjs إلى vercel.json كما في آخر نسخة GitHub لدى المستخدم.
- Owner أوResponsible فقط لإدارة الفريق. Helper وSN.Helper لا يملكون نشر Reports حتى مع صلاحية Owner.
- لا تُرسل إحصائيات الزملاء في المتابعة العادية؛ التوب فقط هو ملخص الأداء المشترك.
- البيانات الناقصة تظهر كبيانات غير متاحة، ولا تُستبدل بأرقام تجريبية أو صفر.

## تحديث المستودع من Windows

1. فك ضغط ملف الإصدار. المجلد الداخلي اسمه Chico-Admins.
2. شغّل PowerShell من داخل هذا المجلد ثم:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\update-from-release.ps1" -RepositoryPath "D:\New life\Chico\Chico-GitHub"
Set-Location "D:\New life\Chico\Chico-GitHub"
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
```

3. راجع git status. بعد نجاح الفحوص:

```powershell
git add -- app components styles docs scripts package.json tests vercel.json README.md
git commit -m "Redesign Chico Admins workspace v1.4"
git push origin main
```

4. انتظر Vercel ينهي نشر commit الجديد. المسار `/api/status` يعرض version: 1.4.0 مع configured: true بعد نشر إعداداتك الحالية.

سكربت التحديث يحافظ على Git و.env.local وملف عملية تجهيز Owner. لا تنسخ مجلد app نفسه إلى app موجود؛ هذا يسبب app/app متكررًا. ابدأ السكربت من المجلد المستخرج الجديد.

## التحقق وحدوده

نجح TypeScript و85 اختبارًا وبناء Next.js وبناء Sites. الاختبارات تشمل (الصلاحيات وSQL والجلسات والطلبات والإشعارات والعرض)، وتم تحليل ملفات CSS دون أخطاء. تمت إضافة فحص عرض لإجراء Report الجديد حسب الرتبة، وتحديث فحوص اللغة وفق التسميات المطلوبة.

تجربة المتصفح وSafari على iPhone فعلي غير منفذة في هذه البيئة. نقاط المراجعة على الجهاز: 320 / 390 / 430 / 768 / 834 / 1024 / 1440 px، فتح Menu وإغلاقه، عدم وجود تمرير أفقي للصفحة، ظهور لوحة المفاتيح دون حجب زر الحفظ، فتح Modal، واتجاه أسماء الرتب وUsername.

لا يوجد قياس بصري أو أداء Lighthouse معلن لهذه النسخة. لا توجد صلاحية Push للحساب المتصل هنا إلى AhmedMWork/Chico؛ نشر Vercel الفعلي يتم بعد رفع المستخدم للحزمة.
