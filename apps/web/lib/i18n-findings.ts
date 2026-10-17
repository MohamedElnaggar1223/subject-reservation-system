/**
 * Arabic for the fix round of F8's findings (docs/features/WALKTHROUGH_FINDINGS.md): the words the round adds to
 * the cycle's screens, and the API's own sentences it rewrote (F8-10: amounts as "EGP 16,850", a payment's method in
 * words, the balance). Merged into the page translator in lib/i18n.tsx last, after the decisions' (lib/i18n-decisions.ts),
 * so a sentence rewritten here wins over an older one.
 *
 * Words as the app already uses them: a board fee رسوم المجلس, a syllabus المنهج, a retake إعادة, the balance الرصيد,
 * a transfer تحويل, InstaPay إنستاباي, the finance desk مكتب المالية. The school's name and people's names are data.
 */

export const findingsArabic: Record<string, string> = {
  // F8-05: the board's rule for a one-paper retake's board fee (the Catalogue's board card).
  'A one-paper retake:': 'إعادة ورقة واحدة:',
  "the paper's own board fee": 'رسوم المجلس للورقة نفسها',
  "the syllabus's board fee": 'رسوم المجلس للمنهج كله',
  "A one-paper retake's board fee": 'رسوم المجلس لإعادة ورقة واحدة',
  "The syllabus's fee (the list prices the syllabus)": 'رسوم المنهج (تُسعّر القائمة المنهج)',
  "The paper's own fee (the list prices each paper)": 'رسوم الورقة نفسها (تُسعّر القائمة كل ورقة)',
  'A one-paper retake added to a session from now on reads it; one already on a sheet keeps its fee.':
    'تقرؤه كل إعادة ورقة واحدة تُضاف إلى دورة من الآن؛ وتحتفظ الإعادة الموجودة في جدول برسومها.',

  // F8-08: the family's Home while a payment is under way.
  'being checked by the school': 'قيد التحقق لدى المدرسة',
  'your InstaPay transfer is with the finance office; nothing to do until it is confirmed.': 'تحويلك عبر إنستاباي لدى مكتب المالية؛ لا شيء عليك حتى يُؤكَّد.',
  'your payment is with the finance office; nothing to do until it is confirmed.': 'دفعتك لدى مكتب المالية؛ لا شيء عليك حتى تُؤكَّد.',
  'to pay at the finance desk, as you chose': 'للدفع في مكتب المالية، كما اخترت',
  'in a payment you started and have not finished': 'في دفعة بدأتها ولم تُكملها',
  'Finish the payment': 'أكمل الدفع',

  // F8-09: the desk while a transfer awaits finance's check.
  "awaiting the transfer's check": 'بانتظار التحقق من التحويل',
  'a payment the family started': 'دفعة بدأتها الأسرة',
  'confirm or reject it on the': 'أكّدها أو ارفضها في',
  'with a payment under way': 'بدفعة قيد التنفيذ',

  // F8-10: how a payment was made, in words (the statement; @repo/validations' paidByWords).
  'in cash at the school': 'نقدًا في المدرسة',
  'by card at the school': 'بالبطاقة في المدرسة',
  'by InstaPay at the school': 'عبر إنستاباي في المدرسة',
  'at the school': 'في المدرسة',
  'by InstaPay': 'عبر إنستاباي',
  'through Fawry': 'عبر فوري',
  'by card': 'بالبطاقة',
  'by mobile wallet': 'بالمحفظة الإلكترونية',
  'by bank transfer': 'بتحويل بنكي',
  'from the instalments held for it': 'من الأقساط المحجوزة لها',
  'by another method': 'بطريقة أخرى',
  // A receipt's state on the statement (RECEIPT_STATUS_LABELS), English in Arabic before.
  'Ready to Hand Over': 'جاهز للتسليم',
  'With Parent': 'مع ولي الأمر',
  'Must Be Returned': 'يجب إعادته',
  'Returned to School': 'أُعيد إلى المدرسة',
  'Marked Lost': 'سُجّل مفقودًا',
  'Voided': 'ملغى',
  // Pending Requests' amounts.
  'to the balance': 'إلى الرصيد',
  'more to pay': 'مبلغ إضافي للدفع',
  // The API's titles the families read (notifications).
  'Balance withdrawal processed': 'تمت معالجة السحب من الرصيد',
  'Balance withdrawal requested': 'طُلب سحب من الرصيد',

  // The notification centre a family reads (its type labels; "escrow" was the code's word, decision 14).
  'Balance Updated': 'تغيّر الرصيد',
  'Drop / Swap Processed': 'عولج طلب الحذف / التبديل',
  'Drop / Swap Request': 'طلب حذف / تبديل',
  'Payment Reversed': 'أُلغيت الدفعة',
  'New Charge': 'رسم جديد',
  'Just now': 'الآن',
  'Mark all read': 'تعليم الكل كمقروء',
  'Marking...': 'جارٍ التعليم...',

  // F8-11: the printed papers' subtitle.
  'Subject Registration Receipt': 'إيصال تسجيل مادة',

  // F8-02: adding a subject on the Catalogue; the Subjects page without the old fee and core.
  'Import several from a list': 'استيراد عدة مواد من قائمة',
  'Subject added': 'أُضيفت المادة',
  'is in the catalogue. Map what it enters with its board, then add it to a session on the Session screen.':
    'في الدليل الآن. حدّد ما تقيّده لدى مجلسها، ثم أضفها إلى دورة من شاشة الدورة.',
  "A subject the school's forms name. Then map what it enters with its board, and add it to a session on the Session screen.":
    'مادة تذكرها استمارات المدرسة. ثم حدّد ما تقيّده لدى مجلسها، وأضفها إلى دورة من شاشة الدورة.',
  'Name, as the forms write it': 'الاسم كما تكتبه الاستمارات',
  'e.g. Psychology A.S./A.L.': 'مثال: Psychology A.S./A.L.',
  "Code (the board's syllabus code where it has one)": 'الرمز (رمز منهج المجلس إن وُجد)',
  'e.g. 9990': 'مثال: 9990',
  'IGCSE (O.L.)': 'IGCSE (O.L.)',
  'A Level (A.S./A.L.)': 'A Level (A.S./A.L.)',
  'e.g. 15,000': 'مثال: 15,000',
  "The course fee is the default the session's sheet offers when the subject is added; the board fees and grade-10 core are set on the session.":
    'رسوم التدريس هي ما يعرضه جدول الدورة افتراضيًا عند إضافة المادة؛ وتُحدَّد رسوم المجالس ومواد الصف العاشر الأساسية في الدورة.',
  'A subject needs its name and its code.': 'تحتاج المادة إلى اسمها ورمزها.',
  'Give the course fee (0 or more).': 'أدخل رسوم التدريس (0 أو أكثر).',
  'Add the subject': 'إضافة المادة',
  "The default the session's sheet offers when the subject is added. The board fees and grade-10 core are set on the session.":
    'ما يعرضه جدول الدورة افتراضيًا عند إضافة المادة. وتُحدَّد رسوم المجالس ومواد الصف العاشر الأساسية في الدورة.',
  'Paste rows as:': 'الصق الأسطر بهذا الترتيب:',
  'name, code, board, level, course fee': 'الاسم، الرمز، المجلس، المستوى، رسوم التدريس',
  "Paste cells straight from Excel (tab separated), or use commas. Fees may include thousands separators. Board: Pearson Edexcel, Cambridge, or Oxford. Level: IGCSE, AS Level, or A Level. The course fee is the default the session's sheet offers; the board fees and grade-10 core are set on the session. Every row is reported back — nothing imports silently.":
    'الصق الخلايا من Excel مباشرة (مفصولة بعلامات جدولة)، أو استخدم الفواصل. قد تتضمن الرسوم فواصل الآلاف. المجلس: Pearson Edexcel أو Cambridge أو Oxford. المستوى: IGCSE أو AS Level أو A Level. رسوم التدريس هي ما يعرضه جدول الدورة افتراضيًا؛ وتُحدَّد رسوم المجالس ومواد الصف العاشر الأساسية في الدورة. يُبلَّغ عن كل سطر — لا يُستورد شيء بصمت.',
  "Not offered at school — the session's sheet offers it as self study.": 'غير مقدَّمة في المدرسة — يعرضها جدول الدورة دراسةً ذاتية.',
  'Close Import': 'إغلاق الاستيراد',
  'Import': 'استيراد',

  // F8-01: deleting a draft session.
  'Delete this draft': 'حذف هذه المسودة',
  'Delete this draft session': 'حذف دورة المسودة هذه',
  "Only a draft nobody has reserved in can be deleted. Its subjects, items and fees on this sheet go with it; the subjects stay in the catalogue and the boards' series keep their dates and fee lists. Recorded in the audit trail with your reason.":
    'لا تُحذف إلا مسودة لم يحجز فيها أحد. تُحذف معها مواد هذا الجدول وبنوده ورسومه؛ وتبقى المواد في الدليل وتحتفظ دورات المجالس بمواعيدها وقوائم رسومها. يُسجَّل ذلك في سجل التدقيق مع سببك.',
  'Delete the draft': 'حذف المسودة',
  'Draft Session Deleted': 'حُذفت دورة مسودة',

  // F8-04: a second qualification on the subject's form.
  'Another qualification': 'مؤهل آخر',
  'The board has another award of this subject at this level. Offered beside this one, the family chooses one of the two with its teacher.':
    'لدى المجلس مؤهل آخر لهذه المادة في هذا المستوى. إن عُرض بجانب هذا، تختار الأسرة أحدهما مع معلمه.',
  'Add a qualification:': 'إضافة مؤهل:',
  'Its course fee (EGP)': 'رسوم تدريسه (جنيه)',
  "Empty: the subject's.": 'فارغًا: رسوم المادة.',
  'Add the qualification': 'إضافة المؤهل',

  // F8-12: the exception's result, one in the singular.
  'due date moved.': 'موعد سداد نُقل.',
  'pushed school fee cancelled.': 'رسوم مدرسية مدفوعة أُلغيت.',
};

/** Data inside an Arabic sentence (an amount, a name), kept one left-to-right unit. */
const iso = (s: string) => `⁨${s}⁩`;
/** An amount as the API and the screens write it ("EGP 16,850"), in the Arabic screens' order ("16,850 جنيه"). */
const egp = (s: string) => {
  const m = /^-?EGP (.+)$/.exec(s);
  return iso(m ? `${s.startsWith('-') ? '-' : ''}${m[1]} جنيه` : s);
};
const MONTHS_AR: Record<string, string> = {
  Jan: 'يناير', Feb: 'فبراير', Mar: 'مارس', Apr: 'أبريل', May: 'مايو', Jun: 'يونيو',
  Jul: 'يوليو', Aug: 'أغسطس', Sep: 'سبتمبر', Oct: 'أكتوبر', Nov: 'نوفمبر', Dec: 'ديسمبر',
};
/** A payment's method in words (paidByWords), in Arabic; an unknown phrase is kept as it is. */
const how = (s: string) => findingsArabic[s] ?? s;

/** Sentences with data in them (a name, an amount, a count): each rule anchored to its sentence's end. */
const FINDINGS_RULES: [RegExp, (m: RegExpExecArray) => string][] = [
  // The notification centre's times ("12m ago").
  [/^(\d+)m ago$/, (m) => `قبل ${m[1]} دقيقة`],
  [/^(\d+)h ago$/, (m) => `قبل ${m[1]} ساعة`],
  [/^(\d+)d ago$/, (m) => `قبل ${m[1]} يوم`],
  // A date as the app writes it in a sentence ("20 Dec 2026": the exception's "by …").
  [/^(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})$/, (m) => `${m[1]} ${MONTHS_AR[m[2]!]} ${m[3]}`],
  // F8-04: the subject's form after a second qualification is added.
  [/^Added (.+)\. Each qualification's teacher is set below; the family chooses the qualification with the teacher\.$/,
    (m) => `أُضيف ${iso(m[1]!)}. يُحدَّد معلم كل مؤهل أدناه؛ وتختار الأسرة المؤهل مع معلمه.`],
  // F8-10: the API's payment and balance notices, as the families read them.
  [/^Payment confirmed — (.+)$/, (m) => `تم تأكيد الدفع — ${iso(m[1]!)}`],
  [/^Payment of (-?EGP [\d,.]+) (.+) has been confirmed for your registration in (.+)\. Your subjects are now fully registered\.$/,
    (m) => `تم تأكيد دفعة ${egp(m[1]!)} ${how(m[2]!)} لتسجيلك في ${iso(m[3]!)}. موادك مسجلة الآن بالكامل.`],
  [/^Payment of (-?EGP [\d,.]+) (.+) has been confirmed for (.+)'s registration\.$/,
    (m) => `تم تأكيد دفعة ${egp(m[1]!)} ${how(m[2]!)} لتسجيل ${iso(m[3]!)}.`],
  [/^Added to (.+)'s balance$/, (m) => `أُضيف إلى رصيد ${iso(m[1]!)}`],
  [/^Taken from (.+)'s balance$/, (m) => `خُصم من رصيد ${iso(m[1]!)}`],
  [/^(EGP [\d,.]+) was (added to|taken from) (.+)'s balance\. New balance: (-?EGP [\d,.]+)\. Reason: (.+)$/,
    (m) => `${m[2] === 'added to' ? 'أُضيف' : 'خُصم'} ${egp(m[1]!)} ${m[2] === 'added to' ? 'إلى' : 'من'} رصيد ${iso(m[3]!)}. الرصيد الجديد: ${egp(m[4]!)}. السبب: ${iso(m[5]!)}`],
  [/^Balance withdrawal fulfilled for (.+)$/, (m) => `نُفّذ السحب من رصيد ${iso(m[1]!)}`],
  [/^(EGP [\d,.]+) was released from (.+)'s balance\. Remaining balance: (-?EGP [\d,.]+)\.$/,
    (m) => `صُرف ${egp(m[1]!)} من رصيد ${iso(m[2]!)}. الرصيد المتبقي: ${egp(m[3]!)}.`],
  [/^(EGP [\d,.]+) was withdrawn from your balance\. Remaining balance: (-?EGP [\d,.]+)\.$/,
    (m) => `سُحب ${egp(m[1]!)} من رصيدك. الرصيد المتبقي: ${egp(m[2]!)}.`],
  [/^(.+) has requested a withdrawal of (EGP [\d,.]+) from your balance\. The request is pending admin processing\.$/,
    (m) => `طلب ${iso(m[1]!)} سحب ${egp(m[2]!)} من رصيدك. الطلب بانتظار معالجة الإدارة.`],
  [/^The withdrawal request for (.+) was rejected\. (EGP [\d,.]+) has been returned to the balance\. Reason: (.+)$/,
    (m) => `رُفض طلب السحب لـ ${iso(m[1]!)}. أُعيد ${egp(m[2]!)} إلى الرصيد. السبب: ${iso(m[3]!)}`],
];

export function translateFindingsText(text: string): string | null {
  for (const [re, ar] of FINDINGS_RULES) {
    const m = re.exec(text);
    if (m) return ar(m);
  }
  return null;
}
