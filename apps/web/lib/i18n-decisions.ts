/**
 * Arabic for the lead's sixteen decisions of 16 Oct 2026 (FEATURES_PLAN.md §6; docs/features/CYCLE_DECISIONS.md):
 * the words the follow-up adds to the cycle's screens. Merged into the page translator in lib/i18n.tsx last,
 * after F6's, so a sentence rewritten here wins over an older one. A string that replaced an older one in
 * another dictionary was changed there, key and Arabic together; this file holds the new ones.
 *
 * Words: a section (11A) فصل; a teaching group مجموعة; the family's money held by the school الرصيد
 * ("your balance with the school", رصيدك لدى المدرسة); the school's name is data (never translated).
 */

export const decisionsArabic: Record<string, string> = {
  // 9: the Student 360's block, in the cycle's words.
  "This year's subjects and teachers": 'مواد هذا العام ومعلموها',

  // 7: Board Services while the remarks are outside the cycle.
  'Cash-in and certificate splits: what each board offers, what it costs in a series and until when.':
    'طلب الشهادة وفصلها: ما يقدمه كل مجلس، وكم يكلّف في كل دورة وحتى متى.',

  // 10: Exam Deadlines, the dates that stop entries.
  "The entry and retake deadlines of every series, in date order, with what the school still has to do for them — and, for a series with no entry deadline, the day its exams start, when entries close. The entry deadline is the school's hard stop: after it, nothing more is entered, paid or confirmed for that series.":
    'مواعيد القيد والإعادة لكل دورة، بترتيب التاريخ، مع ما بقي على المدرسة فعله لها — وللدورة التي لا موعد قيد لها، يوم بدء امتحاناتها حين يُغلق القيد. موعد القيد هو التوقف النهائي للمدرسة: بعده لا يُقيَّد ولا يُدفع ولا يُؤكَّد شيء لتلك الدورة.',
  'The series has no entry deadline: entries close when its exams start.': 'لا موعد قيد لهذه الدورة: يُغلق القيد حين تبدأ امتحاناتها.',

  // 2: the subject's form, an IAL unit's sitting.
  'An IAL unit sits in October, January or June.': 'تُعقد وحدة IAL في أكتوبر أو يناير أو يونيو.',

  // F6's second review, note b: a read of the sheet that failed after a saved change.
  "The sheet could not be read again just now: the subject's form comes back once it is.":
    'تعذرت قراءة الكشف مرة أخرى الآن: يعود نموذج المادة حين تتم قراءته.',
  'Read the sheet again': 'اقرأ الكشف مرة أخرى',
  'The sheet could not be read again just now: it shows the subjects as last read.':
    'تعذرت قراءة الكشف مرة أخرى الآن: يعرض المواد كما قُرئت آخر مرة.',

  // 15: the school's name — the Settings screen's group, its card and its field.
  'The school': 'المدرسة',
  'Its name, as the sign-in and sign-up pages show it.': 'اسمها كما تعرضه صفحتا تسجيل الدخول وإنشاء الحساب.',
  "The school's name": 'اسم المدرسة',
  "Shown on the sign-in, sign-up and account pages, above the app's name, so a family knows the account is their school's. Empty: the app's name alone. A logo waits until the school provides one.":
    'يظهر في صفحات تسجيل الدخول وإنشاء الحساب والحساب فوق اسم التطبيق، لتعرف الأسرة أن الحساب حساب مدرستها. فارغًا: اسم التطبيق وحده. الشعار ينتظر أن توفّره المدرسة.',
  'Not set: the sign-in page shows the app\'s name alone': 'غير محدد: تعرض صفحة تسجيل الدخول اسم التطبيق وحده',
  'Empty: the app\'s name alone.': 'فارغًا: اسم التطبيق وحده.',
};
