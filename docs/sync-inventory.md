# مداد: جرد المزامنة (المرحلة 1)

## أنواع البيانات في Supabase (جدول docs، كل صف = مستند واحد)
| المعرّف | المحتوى | مكان الكتابة الرئيسي |
|---|---|---|
| ch-* (معرّف الفصل) | الفصل المترجم: العنوان، النص، الرقم، التقدم، التقييم، الملاحظة، العلامات | saveProgress، saveChapterField، setMarks، remoteSet |
| raw-* | الفصل الخام قبل الترجمة | rawSet، sbRawPut، rawDel |
| chat-* | محادثات المساعد لكل فصل | saveChat |
| img-* | صور الفصول | imgSet، imgDel |
| cv-* | أغلفة الروايات | saveCoversLocal، col.doc(coverId) |
| trash-* | سلة المحذوفات | col.doc(k) |
| _meta | الروايات كلها: الشخصيات، السلّم، العلاقات، المسرد، الأسماء الأصلية والروابط | saveMeta (25 موقعاً)، pushMeta |
| _prefs | الإعدادات والمصطلحات والسمة | queuePrefsSave (23 موقعاً) |
| _stats | إحصاءات القراءة اليومية | saveStats |
| _usage | الاستخدام | col.doc(USAGE_ID) |
| _discover | الاكتشاف | col.doc(DISC_ID) |
| notify_keys | مفاتيح الإشعارات | Edge/مساعد |

## طبقات التخزين على كل جهاز
- الحاسوب (Claude): نسخة في Claude db، وعند الربط: localCol (IndexedDB) كذاكرة، والفصول الخام في Supabase مباشرة (rawLazy).
- الهاتف (APK): IndexedDB عبر native.js، ومزامنة كل 5 ثوانٍ وفحص كامل كل 5 دقائق.
- localStorage: midad.ch و midad.raw و midad.meta و midad.prefs وغيرها كنسخ مؤقتة.

## آليات الدمج الحالية (التي يجب إزالتها أو تبسيطها في المرحلة 2)
1. progMerge: يدمج مجموعات الفصل (التقدم pAt، التقييم rAt، العلامات mAt).
2. applyRemotePrefs / stampPrefs: يدمج الإعدادات حسب وقت كل إعداد (prefsAt).
3. applyRemoteMeta / stampMeta: يدمج الروايات حسب _u لكل رواية.
4. sbReconcile: يطابق المكتبة كاملة كل 5 دقائق (أحياناً يحذف أو يرسل).
5. sbPull و native pull: يطبقان التحديثات بعد تجاوز sbLast.

## نقاط الخطر المعروفة (من التقارير)
- الفصول الخام تختفي بعد الترجمة (rawIndexLoad يستبدل المصفوفة).
- ترجمة العناوين كانت تكتب مستنداً ناقصاً فتمسح المخزن (أُصلحت بتحديث جزئي).
- الاستعادة من النسخة الاحتياطية لا تستبدل بيانات الرواية الموجودة (أُصلحت).
- المصطلحات والشخصيات لا تصل إلى الجهاز الآخر (غير مُعاد إنتاجها بعد).

## أعداد نقاط الكتابة (من الكود الحالي)
saveMeta 25، queuePrefsSave 23، saveChapterField 10، remoteSet 9، saveChat 8، col.doc(...).update 17، rawSet 6، rawDel 5، col.doc(...).delete 9.

## الخطوة التالية (المرحلة 2)
- كتابة اختبار لكل نوع بيانات: كتابة على جهاز ← ظهورها على الجهاز الآخر من Supabase.
- بعدها تبسيط الدمج: Supabase هو الحكم، والجهاز يقرأ منه فقط.
