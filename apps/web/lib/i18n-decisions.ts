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
  // 1: a first entry in self-study on what is taught, by the student's exception (the review of dd68598, item 2).
  'First entry, self-study': 'قيد أول، دراسة ذاتية',

  // 14: the balance's sentences on the desk, the finance workbench and the checkout (the review of dd68598, item 4).
  'Transfer found — added to the balance': 'وُجد التحويل — أُضيف إلى الرصيد',
  'Add to the balance': 'إضافة إلى الرصيد',
  'Withdrawal rejected — unreleased amount returned to the balance.': 'رُفض السحب — أُعيد المبلغ غير المصروف إلى الرصيد.',
  'Receipt returned — any pending drop refund has been released to the balance.': 'أُعيد الإيصال — أُفرج عن أي استرداد سحب معلّق إلى الرصيد.',
  'Only if you have not paid. What your balance paid toward it goes back to the balance.': 'فقط إذا لم تدفع. ما دفعه رصيدك منها يعود إلى الرصيد.',
  // The rest of the desk's two transfer dialogs (desk.client.tsx), which had no Arabic before: the screen the
  // sentences above sit on reads in one language.
  'Transfer found': 'وُجد التحويل',
  'Undo': 'تراجع',
  'Record a transfer found later?': 'تسجيل تحويل وُجد لاحقًا؟',
  'Where it was found': 'أين وُجد',
  'e.g. On the 28 Sep bank statement, sent 27 Sep': 'مثال: في كشف الحساب البنكي بتاريخ 28 سبتمبر، أُرسل 27 سبتمبر',
  'Transfer reference on the bank statement': 'مرجع التحويل في كشف الحساب البنكي',
  'e.g. FT-2026-000123': 'مثال: FT-2026-000123',
  'As printed on the statement': 'كما هو مطبوع في الكشف',
  'Undo this transfer found later?': 'التراجع عن هذا التحويل الذي وُجد لاحقًا؟',
  'Why it was recorded by mistake': 'لماذا سُجّل خطأً',
  'e.g. Wrong family — the transfer belongs to another student': 'مثال: أسرة خاطئة — التحويل لطالب آخر',
  'Undo Transfer': 'التراجع عن التحويل',

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

/** Data inside an Arabic sentence (a payment's label, a reference), kept one left-to-right unit. */
const iso = (s: string) => `⁨${s}⁩`;

/** An amount as formatPrice writes it ("EGP 8,800"), in the Arabic screens' order ("8,800 جنيه"). */
const egp = (s: string) => {
  const m = /^EGP (.+)$/.exec(s);
  return iso(m ? `${m[1]} جنيه` : s);
};

/** The payment labels the desk's transfer dialogs are given (desk.client.tsx: "… by InstaPay"). */
function paymentLabel(label: string): string {
  const undo = /^The transfer recorded today against (.+) by InstaPay$/.exec(label);
  if (undo) return `التحويل المسجَّل اليوم مقابل ${egp(undo[1]!)} عبر إنستاباي`;
  const paid = /^(.+) by InstaPay$/.exec(label);
  if (paid) return `${egp(paid[1]!)} عبر إنستاباي`;
  return iso(label);
}

/**
 * The desk's sentences about the balance that carry data (a payment's label, a transfer's reference, an amount):
 * decision 14's words, translated whole (the review of dd68598, item 4). Asked before the other screens' rules in
 * lib/i18n.tsx, which none of these sentences matches.
 */
const DECISION_RULES: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^(.+)\. Its amount is taken back from the student's balance and it leaves today's takings; the payment can then be recorded again\. Possible only today, and only while that amount is unspent\.$/,
    (m) => `${paymentLabel(m[1]!)}. يُستعاد المبلغ من رصيد الطالب ويخرج من إيرادات اليوم؛ ثم يمكن تسجيل الدفعة من جديد. ممكن اليوم فقط، وما دام المبلغ لم يُصرف.`],
  [/^(.+?)(?: \(the family gave reference (.+)\))?\. The payment had already closed, so its subjects stay as they are; the amount that arrived is added to the student's balance, to use on a later payment or take back as cash\. This cannot be undone\. Recorded in the audit trail and in today's takings\.$/,
    (m) => `${paymentLabel(m[1]!)}${m[2] ? ` (أعطت الأسرة المرجع ${iso(m[2])})` : ''}. كانت الدفعة قد أُغلقت، فتبقى موادها كما هي؛ ويُضاف المبلغ الذي وصل إلى رصيد الطالب، ليُستخدم في دفعة لاحقة أو يُسترد نقدًا. لا يمكن التراجع عن هذا. يُسجَّل في سجل التدقيق وفي إيرادات اليوم.`],
  [/^Transfer (.+) recorded — (.+) added to the student's balance\. The family has been told\.$/,
    (m) => `سُجّل التحويل ${iso(m[1]!)} — أُضيف ${egp(m[2]!)} إلى رصيد الطالب. وأُبلغت الأسرة.`],
  [/^Amount on the bank statement \(EGP, at most (.+)\)$/,
    (m) => `المبلغ في كشف الحساب البنكي (بالجنيه، ${egp(m[1]!)} على الأكثر)`],
  [/^Transfer undone — (.+) taken back from the student's balance\. The payment can be recorded again\.$/,
    (m) => `أُلغي التحويل — استُعيد ${egp(m[1]!)} من رصيد الطالب. يمكن تسجيل الدفعة من جديد.`],
];

export function translateDecisionsText(text: string): string | null {
  for (const [re, ar] of DECISION_RULES) {
    const m = re.exec(text);
    if (m) return ar(m);
  }
  return null;
}
