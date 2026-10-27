/**
 * Arabic for the reservations rework's screens, step B (RESERVATIONS_REWORK.md §4.3–§4.6): the
 * Reserve page (desk and family), the statement and the Student 360's statement, the teacher on a
 * line, the session's To verify tab and the Money tab's additions, the reservation slip, the
 * checkout's consent and the swap's new line. Merged into the page translator in lib/i18n.tsx:
 * exact English text → Arabic (a word the app already translates keeps its Arabic), and
 * `translateReservationsText` for sentences that carry a name, a number or a date.
 *
 * Words, as step A's: a reservation line سطر, the board المجلس, a sitting دورة, a retake إعادة,
 * self-study دراسة ذاتية, the course fee رسوم التدريس, the board's fee رسوم المجلس, provisional
 * مؤقتة, the statement كشف الحساب, the refund policy سياسة الاسترداد, the declaration الإقرار, to
 * verify التحقق. Names, codes and amounts are data.
 */

export const reservationsArabic: Record<string, string> = {
  // ── The Reserve page ──
  'Reserve': 'الحجز',
  'Reserve Subjects': 'حجز المواد',
  'Reserve at the desk': 'الحجز من المكتب',
  '+ Reserve': '+ حجز',
  'Close': 'إغلاق',
  'Grade 10 in June: the core subjects are ticked and stay ticked.': 'الصف 10 في يونيو: المواد الأساسية محددة وتبقى محددة.',
  'A retake is set when the system knows the earlier sitting. For a new family choose "retake" and name the sitting: it is recorded and listed on the session\'s To verify tab. A teacher may be left as "no preference". A line on a provisional board fee (ⓟ) is reserved now and collected once the fee is confirmed.':
    'تُحدَّد الإعادة تلقائيًا حين يعرف النظام الدورة السابقة. لأسرة جديدة اختر «إعادة» وسمِّ الدورة: تُسجَّل وتُدرج في تبويب «للتحقق» في الجلسة. يمكن ترك المعلم «بلا تفضيل». السطر ذو رسوم المجلس المؤقتة (ⓟ) يُحجز الآن ويُحصَّل حين تُؤكَّد الرسوم.',
  'Tick what you want to sit. A retake the school does not know about yet: choose "retake" and name the sitting, as on the form; the school verifies it. A provisional board fee (ⓟ) is confirmed before you pay.':
    'حدد ما ستمتحن فيه. إعادة لا تعرفها المدرسة بعد: اختر «إعادة» وسمِّ الدورة كما في الاستمارة، وتتحقق منها المدرسة. رسوم المجلس المؤقتة (ⓟ) تُؤكَّد قبل الدفع.',
  'Subject · what is entered': 'المادة · ما يُقيَّد',
  'Teacher': 'المعلم',
  'Entry': 'القيد',
  'Price': 'السعر',
  'O.L.': 'O.L.',
  'A.S. / A.L.': 'A.S. / A.L.',
  'Other': 'أخرى',
  'line': 'سطر',
  'lines': 'أسطر',
  'Due': 'الاستحقاق',
  'on a provisional board fee:': 'على رسوم مجلس مؤقتة:',
  '(payable once confirmed)': '(تُدفع حين تُؤكَّد)',
  'Paid per entry deadline:': 'يُدفع لكل موعد قيد:',
  '(retake deadline)': '(موعد الإعادة)',
  'entered for': 'مُقيَّد في',
  '(result on record)': '(النتيجة مسجلة)',
  'This line was paid while the answer was being given: open it again and answer again': 'دُفع هذا السطر أثناء إعطاء الإجابة: افتحه من جديد وأجب مرة أخرى',
  'The refund terms could not be loaded, so nothing can be reserved yet: reload the page to try again.': 'تعذّر تحميل شروط الاسترداد، فلا يمكن الحجز بعد: أعد تحميل الصفحة للمحاولة مرة أخرى.',
  'Loading the refund terms…': 'جارٍ تحميل شروط الاسترداد…',
  'The price of the subject to swap to has changed since the swap was asked for: ask for the swap again to see the new price':
    'تغيّر سعر المادة المطلوب الاستبدال إليها منذ طلب الاستبدال: اطلب الاستبدال مرة أخرى لترى السعر الجديد',
  'A payment for this line is in progress: a rejection is refused until the Finance Workbench confirms or rejects it.': 'دفعة هذا السطر قيد التنفيذ: يُرفض عدم التأكيد حتى يؤكدها مكتب المالية أو يرفضها.',
  'Not paid: the line ends and the family is told it may reserve a first entry.': 'غير مدفوع: ينتهي السطر وتُبلَّغ الأسرة بأنها تستطيع حجز قيد أول.',
  "Paid and held until the session opens: the line stands as a first entry; its capture or the deadline's refund settles it.": 'مدفوع ومحتجز حتى تُفتح الجلسة: يبقى السطر قيدًا أول؛ ويحسمه تحصيله أو استرداد الموعد.',
  "Paid, before the board's first-entry deadline: the line stands and is entered as a first entry; finance decides whether anything is owed.": 'مدفوع، قبل موعد القيد الأول للمجلس: يبقى السطر ويُقيَّد قيدًا أول؛ وتقرر المالية إن كان هناك مستحق.',
  "Paid, after the board's first-entry deadline: the line is dropped and refunded by the refund policy (the paper receipt comes back first).": 'مدفوع، بعد موعد القيد الأول للمجلس: يُسحب السطر ويُسترد وفق سياسة الاسترداد (يُعاد الإيصال الورقي أولًا).',
  'retakes of the previous sitting only': 'إعادات الدورة السابقة فقط',
  'Name the earlier sitting on each retake': 'سمِّ الدورة السابقة لكل إعادة',
  'Refund policy and declaration read and signed by the parent': 'قرأ ولي الأمر سياسة الاسترداد والإقرار ووقّع عليهما',
  'Refund policy and declaration read and signed by the parent.': 'قرأ ولي الأمر سياسة الاسترداد والإقرار ووقّع عليهما.',
  'I confirm that I have read the refund policy.': 'أؤكد أنني قرأت سياسة الاسترداد.',
  'I confirm that I have read the refund policy: a drop is refunded in full.': 'أؤكد أنني قرأت سياسة الاسترداد: يُسترد السحب كاملًا.',
  'I confirm that the information given is true, complete and accurate.': 'أؤكد أن المعلومات المقدمة صحيحة وكاملة ودقيقة.',
  'Reserve only': 'حجز فقط',
  'Paid with': 'طريقة الدفع',
  'Balance to use (EGP)': 'المبلغ من الرصيد (جنيه)',
  'Reserve and collect': 'حجز وتحصيل',
  'now': 'الآن',
  'Reserving…': 'جارٍ الحجز…',
  'Send to my parent': 'أرسل إلى ولي أمري',
  'grade-10 core': 'أساسية للصف 10',
  'Retakes only': 'إعادات فقط',
  'Self-study only (not taught this cycle)': 'دراسة ذاتية فقط (لا تُدرَّس هذه الدورة)',
  'sat': 'امتُحن في',
  'already reserved': 'محجوز بالفعل',
  'closed for new entries': 'مغلق أمام القيود الجديدة',
  'board fee not set yet': 'لم تُحدَّد رسوم المجلس بعد',
  'declared — listed to verify': 'مُصرَّح بها — مدرجة للتحقق',
  'to be verified by the school': 'تتحقق منها المدرسة',
  '— self-study': '— دراسة ذاتية',
  'No preference': 'بلا تفضيل',
  'Carried from the sitting…': 'منقولة من الدورة…',
  'From the sitting…': 'من الدورة…',
  'First entry, in school': 'قيد أول، في المدرسة',
  'First entry, self-study (not taught this cycle)': 'قيد أول، دراسة ذاتية (لا تُدرَّس هذه الدورة)',
  'First entry, self-study': 'قيد أول، دراسة ذاتية',
  'Retake, in school': 'إعادة، في المدرسة',
  'Retake, in school — name the sitting': 'إعادة، في المدرسة — سمِّ الدورة',
  'Retake, self-study': 'إعادة، دراسة ذاتية',
  'Retake, self-study — name the sitting': 'إعادة، دراسة ذاتية — سمِّ الدورة',
  'Not open to this student': 'غير متاح لهذا الطالب',
  'Nothing is offered in this session yet': 'لا شيء معروض في هذه الجلسة بعد',
  'Print the reservation slip': 'اطبع قسيمة الحجز',
  'Receipts to hand over:': 'الإيصالات المطلوب تسليمها:',
  'On a provisional board fee, collected once the fee is confirmed:': 'على رسوم مجلس مؤقتة، تُحصَّل حين تُؤكَّد الرسوم:',
  'Refund policy and declaration read and signed by the parent (asked for subjects the school reserved)': 'قرأ ولي الأمر سياسة الاسترداد والإقرار ووقّع عليهما (يُطلب للمواد التي حجزتها المدرسة)',
  'Statement': 'كشف الحساب',
  'Hide statement': 'إخفاء كشف الحساب',
  // ── The family's page ──
  'Choose your child and the session, tick what they will sit, and pay by exam series.': 'اختر ابنك والجلسة، وحدد ما سيمتحن فيه، وادفع لكل دورة امتحان.',
  'Tick what you will sit; your parent approves and pays.': 'حدد ما ستمتحن فيه؛ يوافق ولي أمرك ويدفع.',
  'Child': 'الابن',
  'No linked children yet:': 'لا يوجد أبناء مرتبطون بعد:',
  'link to your child': 'اربط حسابك بابنك',
  'Reservations close': 'يُغلق الحجز',
  'not open yet: a preregistration holds the money until it opens': 'لم تُفتح بعد: التسجيل المسبق يحتجز المبلغ حتى تُفتح',
  'The school fee comes first': 'المصاريف الدراسية أولًا',
  'school fee': 'المصاريف الدراسية',
  'is paid before reserving.': 'تُدفع قبل الحجز.',
  'Pay the school fee now →': 'ادفع المصاريف الدراسية الآن ←',
  'Ask your parent to pay it from their account.': 'اطلب من ولي أمرك دفعها من حسابه.',
  'No session is open for reservations': 'لا توجد جلسة مفتوحة للحجز',
  'Check back later, or ask the school when the next one opens.': 'عد لاحقًا، أو اسأل المدرسة متى تُفتح الجلسة التالية.',
  'Pay now →': 'ادفع الآن ←',
  'See the statement': 'اعرض كشف الحساب',
  'Reserve more': 'احجز المزيد',
  // ── The statement ──
  'Every line with its price and why, what is paid and what is still owed, and the payments — one per exam board deadline.': 'كل سطر بسعره وسببه، وما دُفع وما بقي، والدفعات — دفعة لكل موعد للمجلس.',
  'Show': 'عرض',
  'Family statement (every child)': 'كشف حساب الأسرة (كل الأبناء)',
  'Family total': 'إجمالي الأسرة',
  'Paid': 'المدفوع',
  'Outstanding': 'المتبقي',
  'Escrow': 'الرصيد',
  'held': 'محتجز',
  'Show ended lines (expired, rejected)': 'إظهار الأسطر المنتهية (منتهية الصلاحية، مرفوضة)',
  'No children linked yet': 'لا يوجد أبناء مرتبطون بعد',
  'Nothing reserved yet.': 'لا شيء محجوز بعد.',
  'Line': 'السطر',
  'Receipt': 'الإيصال',
  'Status': 'الحالة',
  'from': 'من',
  '(declared by the family)': '(صرّحت بها الأسرة)',
  '(declared at the desk)': '(صُرّح بها في المكتب)',
  '(on record)': '(مسجلة)',
  '(before the system)': '(قبل النظام)',
  'verified': 'تم التحقق',
  'not confirmed': 'لم تُؤكَّد',
  'refunded': 'مُسترد',
  'board fee provisional, confirmed before payment': 'رسوم المجلس مؤقتة، تُؤكَّد قبل الدفع',
  'School fee': 'المصاريف الدراسية',
  'waived': 'معفاة',
  'paid': 'مدفوع',
  'Payments': 'الدفعات',
  'One payment per entry deadline: each series is paid for on its own.': 'دفعة لكل موعد قيد: تُدفع كل دورة وحدها.',
  'Subjects': 'المواد',
  'Remark': 'إعادة التصحيح',
  'Preregistration': 'تسجيل مسبق',
  'deadline': 'الموعد',
  'from the balance': 'من الرصيد',
  'Reversed': 'مُلغاة',
  'In progress': 'جارية',
  'Change the teacher': 'تغيير المعلم',
  'No preference (the coordinator assigns)': 'بلا تفضيل (يعيّن المنسق)',
  'Self-study (no teacher)': 'دراسة ذاتية (بلا معلم)',
  'The price stays': 'يبقى السعر',
  ": a refund or an adjustment is the finance office's own act.": ': الاسترداد أو التعديل قرار مكتب المالية وحده.',
  "The student's enrolment follows the new teacher.": 'يتبع التحاق الطالب المعلمَ الجديد.',
  'e.g. The family asked at the desk': 'مثلًا: طلبت الأسرة ذلك في المكتب',
  // ── The To verify tab ──
  'To verify': 'للتحقق',
  'Answered': 'تمت الإجابة',
  'Retakes and carried sittings declared by a family or at the desk. Verified, the line stands. Not confirmed: a line not yet paid ends and the family may reserve a first entry; a paid line stands as a first entry before the board\'s first-entry deadline, and is dropped with its refund after it.':
    'إعادات ودورات منقولة صرّحت بها أسرة أو المكتب. عند التحقق يبقى السطر. إن لم تُؤكَّد: ينتهي السطر غير المدفوع ويمكن للأسرة حجز قيد أول؛ ويبقى السطر المدفوع قيدًا أول قبل موعد القيد الأول للمجلس، ويُسحب مع استرداده بعده.',
  'Student': 'الطالب',
  'Declared sitting': 'الدورة المُصرَّح بها',
  'Declared by': 'صرّح بها',
  'Answer by': 'الإجابة قبل',
  'Answer': 'الإجابة',
  'Retake': 'إعادة',
  'Carry forward': 'نقل نتيجة',
  'First entry': 'قيد أول',
  'self-study': 'دراسة ذاتية',
  'in school': 'في المدرسة',
  'The family': 'الأسرة',
  'The desk': 'المكتب',
  'payment in progress': 'دفعة جارية',
  'not yet': 'ليس بعد',
  'passed': 'انقضى',
  'stands as a first entry': 'يبقى قيدًا أول',
  'Verify': 'تحقق',
  'Not confirmed': 'لم تُؤكَّد',
  'Nothing to verify': 'لا شيء للتحقق',
  'Nothing answered yet': 'لم تتم الإجابة عن شيء بعد',
  'Verify the declared sitting': 'تحقق من الدورة المُصرَّح بها',
  'The sitting is not confirmed': 'الدورة لم تُؤكَّد',
  'The line stands as it is.': 'يبقى السطر كما هو.',
  'Previous centre (another centre only)': 'المركز السابق (لمركز آخر فقط)',
  'Previous candidate number': 'رقم الجلوس السابق',
  "What was seen (the board's statement)": 'ما تمت رؤيته (بيان المجلس)',
  "The finance desk answers with the board's statement in hand.": 'يجيب مكتب المالية وبيان المجلس بين يديه.',
  'e.g. Statement of results, June 2026': 'مثلًا: بيان النتائج، يونيو 2026',
  'What was checked': 'ما الذي تم التحقق منه',
  'Reason': 'السبب',
  // ── The Money tab ──
  'Every section': 'كل الفصول',
  'Remind': 'تذكير',
  'Reminders arrive with the messages step': 'تأتي التذكيرات مع خطوة الرسائل',
  // ── The slip ──
  'IGCSE Subject Reservation System': 'نظام حجز مواد IGCSE',
  'Reservation slip': 'قسيمة الحجز',
  'Student ID': 'رقم الطالب',
  'Session': 'الجلسة',
  'Total': 'الإجمالي',
  'ⓟ board fee provisional: confirmed before payment.': 'ⓟ رسوم المجلس مؤقتة: تُؤكَّد قبل الدفع.',
  'Parent signature': 'توقيع ولي الأمر',
  'Desk': 'المكتب',
  'Print': 'طباعة',
  // ── The checkout and the swap ──
  'The school reserved these subjects for you: confirm before paying': 'حجزت المدرسة هذه المواد لكم: أكّدوا قبل الدفع',
  'Swap to': 'الاستبدال إلى',
  'Choose what to swap to': 'اختر ما تستبدل إليه',
  // ── Settings ──
  'Declared sittings': 'الدورات المُصرَّح بها',
  // The settings page's group hint uses a typographic apostrophe.
  'What happens to a retake a family declared when the school has not verified it by the board’s deadline.': 'ما يحدث لإعادة صرّحت بها أسرة ولم تتحقق منها المدرسة قبل موعد المجلس.',
  'A family (or the desk) may declare the sitting a retake follows; the coordinator verifies it on the session\'s To verify tab. "Enter as declared": the form trusts the family — the line is entered and the entry check lists it as declared, unverified. "Hold": at the line\'s deadline a line awaiting payment expires, and a paid one is dropped with that day\'s refund (the paper receipt comes back first).':
    'قد تصرّح الأسرة (أو المكتب) بالدورة التي تتبعها الإعادة؛ ويتحقق منها المنسق في تبويب «للتحقق» في الجلسة. «القيد كما صُرّح»: الاستمارة تثق بالأسرة — يُقيَّد السطر وتُدرجه مراجعة القيد على أنه مُصرَّح به ولم يُتحقق منه. «الإيقاف»: عند موعد السطر ينتهي السطر الذي ينتظر الدفع، ويُسحب المدفوع مع استرداد ذلك اليوم (يُعاد الإيصال الورقي أولًا).',
  'A declared sitting still unverified at its deadline': 'دورة مُصرَّح بها لم يُتحقق منها عند موعدها',
  'Enter as declared': 'القيد كما صُرّح',
  'Hold: expire or drop at the deadline': 'الإيقاف: الإنهاء أو السحب عند الموعد',
};

const MONTHS_AR: Record<string, string> = { January: 'يناير', June: 'يونيو', October: 'أكتوبر', November: 'نوفمبر' };
const SHORT_MONTHS_AR: Record<string, string> = {
  Jan: 'يناير', Feb: 'فبراير', Mar: 'مارس', Apr: 'أبريل', May: 'مايو', Jun: 'يونيو',
  Jul: 'يوليو', Aug: 'أغسطس', Sep: 'سبتمبر', Oct: 'أكتوبر', Nov: 'نوفمبر', Dec: 'ديسمبر',
};
// F6: a family reads its reservations (حجز), not the model's "lines" (سطر).
const lines = (n: string) => `${n} ${Number(n) === 1 ? 'حجز' : 'حجوزات'}`;

/** "100% to week 2 · 50% in week 3 · 0% from week 4" in Arabic. */
function refundSteps(text: string): string | null {
  const out: string[] = [];
  for (const p of text.split(' · ')) {
    let m: RegExpExecArray | null;
    if ((m = /^(\d+(?:\.\d+)?)% to week (\d+)$/.exec(p))) out.push(`${m[1]}% حتى الأسبوع ${m[2]}`);
    else if ((m = /^(\d+(?:\.\d+)?)% in week (\d+)$/.exec(p))) out.push(`${m[1]}% في الأسبوع ${m[2]}`);
    else if ((m = /^(\d+(?:\.\d+)?)% in weeks (\d+)–(\d+)$/.exec(p))) out.push(`${m[1]}% في الأسابيع ${m[2]}–${m[3]}`);
    else if ((m = /^(\d+(?:\.\d+)?)% from week (\d+)$/.exec(p))) out.push(`${m[1]}% من الأسبوع ${m[2]}`);
    else return null;
  }
  return out.join(' · ');
}

const RULES: [RegExp, (m: RegExpExecArray) => string | null][] = [
  // The refund-policy acknowledgement, with the session's steps.
  [/^I confirm that I have read the refund policy: of the course fee, (.+), counted from the first lesson\.$/, (m) => {
    const steps = refundSteps(m[1]!);
    return steps ? `أؤكد أنني قرأت سياسة الاسترداد: من رسوم التدريس، ${steps}، محسوبة من أول حصة.` : null;
  }],
  // A converted session's acknowledgement, with its refund windows as dates.
  [/^I confirm that I have read the refund policy: (.+); nothing outside these dates\.$/, (m) => {
    const parts = m[1]!.split(' · ').map((p) => {
      const w = /^(\d+)% from (\d{1,2}) (\w{3}) (\d{4}) to (\d{1,2}) (\w{3}) (\d{4})$/.exec(p);
      return w ? `${w[1]}% من ${w[2]} ${SHORT_MONTHS_AR[w[3]!] ?? w[3]} ${w[4]} إلى ${w[5]} ${SHORT_MONTHS_AR[w[6]!] ?? w[6]} ${w[7]}` : null;
    });
    return parts.every((x) => x) ? `أؤكد أنني قرأت سياسة الاسترداد: ${parts.join(' · ')}؛ ولا شيء خارج هذه التواريخ.` : null;
  }],
  // Sentences of the Reserve page's results.
  [/^Sent to your parent for approval: (\d+) (?:lines?|reservations?)\.$/, (m) => `أُرسل إلى ولي أمرك للموافقة: ${lines(m[1]!)}.`],
  [/^Preregistered: (\d+) (?:lines?|reservations?)\. Pay now to hold the money until the session opens\.$/, (m) => `تم التسجيل المسبق: ${lines(m[1]!)}. ادفع الآن لاحتجاز المبلغ حتى تُفتح الجلسة.`],
  [/^Reserved: (\d+) (?:lines?|reservations?) awaiting payment\. Pay by exam series on the next screen\.$/, (m) => `تم الحجز: ${lines(m[1]!)} في انتظار الدفع. ادفع لكل دورة امتحان في الشاشة التالية.`],
  [/^Reserved (\d+) (?:lines?|reservations?)\.$/, (m) => `تم حجز ${lines(m[1]!)}.`],
  [/^Collected EGP ([\d,.]+)( in (\d+) payments, one per entry deadline)?\.$/, (m) => `تم تحصيل ${m[1]} جنيه${m[3] ? ` في ${m[3]} دفعات، دفعة لكل موعد قيد` : ''}.`],
  [/^(\d+) on a provisional board fee: collected once the fee is confirmed\.$/, (m) => `${m[1]} على رسوم مجلس مؤقتة: تُحصَّل حين تُؤكَّد الرسوم.`],
  [/^Not collected — hand this money back: (.+)\.$/, (m) => `لم يُحصَّل — أعد هذا المبلغ: ${m[1]}.`],
  // The Reserve page's school-fee notice (the year isolated left-to-right).
  [/^The (\d{4}-\d{4}) school fee(?: \(EGP ([\d,.]+)\))? is paid before reserving\.$/,
    (m) => `تُدفع المصاريف الدراسية \u2066${m[1]}\u2069${m[2] ? ` (${m[2]} جنيه)` : ''} قبل الحجز.`],
  // The pricing basis, on hover and under a price.
  [/^course ([\d,.]+) × ([\d.]+)% \+ board ([\d,.]+) × ([\d.]+)%( \(board fee provisional\))?$/, (m) =>
    `التدريس ${m[1]} × ${m[2]}% + المجلس ${m[3]} × ${m[4]}%${m[5] ? ' (رسوم المجلس مؤقتة)' : ''}`],
  [/^course ([\d,.]+) \+ board ([\d,.]+) \(recorded before the rework\)$/, (m) => `التدريس ${m[1]} + المجلس ${m[2]} (مسجل قبل إعادة التصميم)`],
  [/^custom price ([\d,.]+) \(an exception; board fee included\)$/, (m) => `سعر خاص ${m[1]} (استثناء؛ يشمل رسوم المجلس)`],
  [/^course ([\d,.]+) \+ board ([\d,.]+)$/, (m) => `التدريس ${m[1]} + المجلس ${m[2]}`],
  // The API's refusals on these screens.
  [/^Already reserved for this student in this session: (.+)$/, (m) => `محجوز بالفعل لهذا الطالب في هذه الجلسة: ${m[1]}`],
  [/^A first entry of (.+) follows no earlier sitting: choose "retake" to name one$/, (m) => `القيد الأول في ${m[1]} لا يتبع دورة سابقة: اختر «إعادة» لتسمية دورة`],
  [/^(.+) follows a sitting of (.+): the sitting named is another board's$/, (m) => `${m[1]} يتبع دورة لـ ${m[2]}: الدورة المذكورة لمجلس آخر`],
  [/^The earlier sitting of (.+) must come before the series it is entered in$/, (m) => `يجب أن تسبق الدورة السابقة لـ ${m[1]} الدورة التي يُقيَّد فيها`],
  [/^A retake of (.+) names the sitting it follows$/, (m) => `إعادة ${m[1]} تسمّي الدورة التي تتبعها`],
  [/^A payment for this line is in progress: confirm or reject it in the Finance Workbench first$/, () => 'هناك دفعة جارية لهذا السطر: أكّدها أو ارفضها في مكتب المالية أولًا'],
  [/^The finance desk verifies a sitting with the board's statement in hand: say what was seen$/, () => 'يتحقق مكتب المالية من الدورة وبيان المجلس بين يديه: اذكر ما تمت رؤيته'],
  [/^This declared sitting was already (verified|rejected)$/, (m) => (m[1] === 'verified' ? 'تم التحقق من هذه الدورة المُصرَّح بها بالفعل' : 'رُفضت هذه الدورة المُصرَّح بها بالفعل')],
  [/^This line follows no declared sitting: there is nothing to verify$/, () => 'لا يتبع هذا السطر دورة مُصرَّحًا بها: لا شيء للتحقق'],
  [/^This line is no longer reserved: there is nothing to verify$/, () => 'لم يعد هذا السطر محجوزًا: لا شيء للتحقق'],
  [/^A line cannot be confirmed without the family's consent to the refund policy and the declaration — reserve it again with both ticked$/, () => 'لا يمكن تأكيد سطر دون موافقة الأسرة على سياسة الاسترداد والإقرار — احجزه مرة أخرى مع تحديد الاثنين'],
  [/^The school reserved these subjects for the family: tick the refund policy and the declaration before paying$/, () => 'حجزت المدرسة هذه المواد للأسرة: حدد سياسة الاسترداد والإقرار قبل الدفع'],
  [/^Tick the refund policy and the declaration for the new subject: the subject being dropped was registered before the school recorded them$/, () => 'حدد سياسة الاسترداد والإقرار للمادة الجديدة: المادة المسحوبة سُجّلت قبل أن تسجلهما المدرسة'],
  [/^Nothing to change: the line already has this teacher$/, () => 'لا شيء للتغيير: هذا معلم السطر بالفعل'],
  [/^(.+) has one teacher this cycle: "no preference" is for a subject with several$/, (m) => `لـ ${m[1]} معلم واحد هذه الدورة: «بلا تفضيل» لمادة لها أكثر من معلم`],
  [/^(.+) is reserved as self-study and priced so: to be taught, drop it and reserve it in school$/, (m) => `${m[1]} محجوزة دراسةً ذاتية وبسعرها: لتُدرَّس اسحبها واحجزها في المدرسة`],
  [/^That teacher does not teach (.+) this cycle: choose one of the subject's teachers on the session$/, (m) => `هذا المعلم لا يدرّس ${m[1]} هذه الدورة: اختر أحد معلمي المادة في الجلسة`],
  [/^Nobody teaches (.+) this cycle: it can only be self-study$/, (m) => `لا أحد يدرّس ${m[1]} هذه الدورة: لا تكون إلا دراسة ذاتية`],
  [/^This line is no longer reserved: its teacher cannot be changed$/, () => 'لم يعد هذا السطر محجوزًا: لا يمكن تغيير معلمه'],
  // What happened to the student's group after a teacher change (lib/groups-followed.ts; the desk's
  // teacher change and the Session screen's Replace a teacher). A teaching group is "group" / مجموعة
  // everywhere (the lead's decision of 16 Oct 2026, 12; F1's مجموعة تدريس agrees); a section (11A) is
  // فصل. The group's and the teacher's names are data, kept left-to-right.
  [/^The student moves to the group (.+)\.$/, (m) => `ينتقل الطالب إلى مجموعة ${iso(m[1]!)}.`],
  [/^(\d+) students? moves? to the group (.+)\.$/, (m) => `ينتقل ${studentsAr(Number(m[1]))} إلى مجموعة ${iso(m[2]!)}.`],
  [/^The whole group (.+) goes to (.+): the student stays in it\.$/, (m) => `تنتقل مجموعة ${iso(m[1]!)} كلها إلى ${teacherAr(m[2]!)}: ويبقى الطالب فيها.`],
  [/^The whole group (.+) waits for a teacher: the student stays in it\.$/, (m) => `تنتظر مجموعة ${iso(m[1]!)} كلها معلمًا: ويبقى الطالب فيها.`],
  [/^The whole group (.+) waits for a teacher\.$/, (m) => `تنتظر مجموعة ${iso(m[1]!)} كلها معلمًا.`],
  [/^The whole group (.+) goes to (.+)\.$/, (m) => `تنتقل مجموعة ${iso(m[1]!)} كلها إلى ${teacherAr(m[2]!)}.`],
  [/^The student leaves the group (.+) after today: self-study from now\.$/, (m) => `يغادر الطالب مجموعة ${iso(m[1]!)} بعد اليوم: دراسة ذاتية من الآن.`],
  [/^(\d+) students? leaves? the group (.+) after today: self-study from now\.$/, (m) => `يغادر ${studentsAr(Number(m[1]))} مجموعة ${iso(m[2]!)} بعد اليوم: دراسة ذاتية من الآن.`],
  [/^No group of this subject is without a teacher yet: the student stays in (.+) and waits to be placed\.$/,
    (m) => `لا مجموعة في هذه المادة بلا معلم بعد: يبقى الطالب في ${iso(m[1]!)} وينتظر توزيعه.`],
  [/^No group of this subject is without a teacher yet: (\d+) students? stays? in (.+) and waits? to be placed\.$/,
    (m) => `لا مجموعة في هذه المادة بلا معلم بعد: يبقى ${studentsAr(Number(m[1]))} في ${iso(m[2]!)} و${waitAr(Number(m[1]))}.`],
  [/^(.+) has no group of this subject yet: the student stays in (.+) and waits to be placed\.$/,
    (m) => `ليس لدى ${teacherAr(m[1]!)} مجموعة في هذه المادة بعد: يبقى الطالب في ${iso(m[2]!)} وينتظر توزيعه.`],
  [/^(.+) has no group of this subject yet: (\d+) students? stays? in (.+) and waits? to be placed\.$/,
    (m) => `ليس لدى ${teacherAr(m[1]!)} مجموعة في هذه المادة بعد: يبقى ${studentsAr(Number(m[2]))} في ${iso(m[3]!)} و${waitAr(Number(m[2]))}.`],
  [/^The move was refused: the student stays in (.+)\.$/, (m) => `رُفض النقل: يبقى الطالب في ${iso(m[1]!)}.`],
  [/^The move was refused: (\d+) students? stays? in (.+)\.$/, (m) => `رُفض النقل: يبقى ${studentsAr(Number(m[1]))} في ${iso(m[2]!)}.`],
];

/** A name inside an Arabic sentence, isolated so it stays one left-to-right unit. */
function iso(name: string): string {
  return `\u2068${name}\u2069`;
}
/** A teacher as the group sentences name one: a name (data), or the new teacher the screen could not name. */
function teacherAr(name: string): string {
  return name === 'The new teacher' ? 'المعلم الجديد' : iso(name);
}
/** A count of students with its noun (1, 2, 3–10, 11–99, hundreds), as D's counts agree with their number. */
function studentsAr(n: number): string {
  if (n === 1) return 'طالب واحد';
  if (n === 2) return 'طالبان';
  const r = n % 100;
  if (r >= 3 && r <= 10) return `${n} طلاب`;
  if (r >= 11 && r <= 99) return `${n} طالبًا`;
  return `${n} طالب`;
}
/** "and wait(s) to be placed", the verb agreeing with the count (one, two, more). */
function waitAr(n: number): string {
  return n === 1 ? 'ينتظر توزيعه' : n === 2 ? 'ينتظران توزيعهما' : 'ينتظرون توزيعهم';
}

/** Sentences of these screens that carry a name, a number or a date. */
export function translateReservationsText(text: string): string | null {
  for (const [re, f] of FAMILY_RULES) {
    const m = re.exec(text);
    if (m) return f(m);
  }
  for (const [re, f] of RULES) {
    const m = re.exec(text);
    if (m) return f(m);
  }
  // The desk's result: several sentences, each translated on its own.
  const parts = text.split(/(?<=\.) (?=[A-Z0-9])/);
  if (parts.length > 1) {
    const out: string[] = [];
    for (const p of parts) {
      const t = translateReservationsText(p);
      if (!t) return null;
      out.push(t);
    }
    return out.join(' ');
  }
  const month = /^(January|June|October|November) (\d{4})$/.exec(text);
  if (month) return `${MONTHS_AR[month[1]!]} ${month[2]}`;
  return null;
}

// ─── P3: the family's and the desk's screens (COORDINATOR_REWORK.md F1–F5, §5, P3) ──────────────────────
//
// Words families and the desk read (the lead's "mock" row): no board jargon — no award, suite, series, sitting,
// component, mapping, option code, provisional, cut-off or offer item, in English or Arabic; "last day to pay",
// "prices not final yet", "the earlier exam". The parent is addressed ("your child"), the student's own view
// addresses the student. A date not set is said plainly (موعد الدفع لم يُحدد بعد), never "pay before to be
// announced". Subject names stay in English in Arabic (data). `apps/web/scripts/check-reservation-words.mjs`
// checks these screens, this file and the Arabic the translator gives their phrases.

/**
 * An API sentence in the family's words: the board's words a refusal may carry (a sitting, a series, a provisional
 * fee, an item) in theirs. Each rule is a whole word, so a subject's name or code is never touched.
 */
const FAMILY_WORDS: [RegExp, string][] = [
  [/\bWhole subject\b/g, 'All papers'],
  [/\bboard fee provisional\b/gi, 'prices not final yet'],
  [/\bprovisional\b/gi, 'not final yet'],
  [/\bcut-offs?\b/gi, 'last day to pay'],
  [/\bsittings\b/gi, 'exams'],
  [/\bsitting\b/gi, 'exam'],
  [/\bseries\b/gi, 'exam'],
  [/\bawards\b/gi, 'qualifications'],
  [/\baward\b/gi, 'qualification'],
  [/\bcomponents\b/gi, 'papers'],
  [/\bcomponent\b/gi, 'paper'],
  [/\bsuites\b/gi, 'sets'],
  [/\bsuite\b/gi, 'set'],
  [/\bmappings?\b/gi, 'links'],
  [/\boption codes?\b/gi, 'codes'],
  [/\boffer items?\b/gi, 'choice'],
  [/\bThat item\b/g, 'That choice'],
  [/\bitems\b/gi, 'choices'],
  [/\bitem\b/gi, 'choice'],
];

export function familyWords(text: string): string {
  let out = text;
  for (const [re, to] of FAMILY_WORDS) out = out.replace(re, to);
  return out;
}

/** The family's and the desk's phrases (merged after the other dictionaries in lib/i18n.tsx: these win). */
export const familyArabic: Record<string, string> = {
  // The reservation page
  'Reserve now': 'احجز الآن',
  'Reserving for': 'الحجز لـ',
  'Your choices': 'اختياراتك',
  'subject': 'مادة',
  'subjects': 'مواد',
  'Nothing picked yet.': 'لم تختر شيئًا بعد.',
  'when the school closes them': 'حين تغلقه المدرسة',
  'The payment date is not set yet': 'موعد الدفع لم يُحدد بعد',
  'Every subject open to your child this session, with its choices and their prices. Pick one choice per subject; the total is at the bottom.':
    'كل مادة متاحة لابنك في هذه الجلسة، بخياراتها وأسعارها. اختر خيارًا واحدًا لكل مادة؛ والإجمالي في الأسفل.',
  'Every subject open to you this session, with its choices and their prices. Pick one choice per subject; your parent approves and pays.':
    'كل مادة متاحة لك في هذه الجلسة، بخياراتها وأسعارها. اختر خيارًا واحدًا لكل مادة؛ يوافق ولي أمرك ويدفع.',
  'Every subject this student may take, with only the choices open to them and their prices. Pick what the parent asks for; the total is at the bottom.':
    'كل مادة يمكن لهذا الطالب أخذها، بالخيارات المتاحة له فقط وأسعارها. اختر ما يطلبه ولي الأمر؛ والإجمالي في الأسفل.',
  'Reservations for this session are closed. What is already reserved can still be paid.': 'الحجز في هذه الجلسة مغلق. ما حُجز بالفعل يمكن دفعه.',
  'Prices are not final yet: you can reserve now and pay once the school confirms them.': 'الأسعار ليست نهائية بعد: يمكنك الحجز الآن والدفع حين تؤكدها المدرسة.',
  'Prices are not final yet: reserve now, and collect once they are.': 'الأسعار ليست نهائية بعد: احجز الآن، وحصّل حين تصبح نهائية.',
  'Reservations have not opened yet': 'لم يُفتح الحجز بعد',
  'Taught online': 'تُدرَّس عبر الإنترنت',
  'Not taking new reservations.': 'لا تقبل حجوزات جديدة.',
  'Sat before: only the retake choices are shown.': 'امتُحن فيها من قبل: تظهر خيارات الإعادة فقط.',
  'Sat it before? Show the retake choices': 'امتُحن فيها من قبل؟ اعرض خيارات الإعادة',
  'What will your child take?': 'ماذا سيأخذ ابنك؟',
  'What will you take?': 'ماذا ستأخذ؟',
  'What will the student take?': 'ماذا سيأخذ الطالب؟',
  'When did your child sit it?': 'متى امتحن ابنك فيها؟',
  'When did you sit it?': 'متى امتحنتَ فيها؟',
  'When did the student sit it?': 'متى امتحن الطالب فيها؟',
  'When did your child sit the A.S.?': 'متى امتحن ابنك في A.S.؟',
  'When did you sit the A.S.?': 'متى امتحنتَ في A.S.؟',
  'When did the student sit the A.S.?': 'متى امتحن الطالب في A.S.؟',
  'Not taking it': 'لن تُؤخذ',
  'Already reserved': 'محجوزة بالفعل',
  'waiting for payment': 'بانتظار الدفع',
  'waiting for your approval': 'بانتظار موافقتك',
  "waiting for your parent's approval": 'بانتظار موافقة ولي أمرك',
  "waiting for the parent's approval": 'بانتظار موافقة ولي الأمر',
  'price not set yet': 'السعر لم يُحدد بعد',
  '(closed to new reservations)': '(مغلقة أمام الحجوزات الجديدة)',
  'Teacher to be announced': 'سيُعلَن المعلم لاحقًا',
  'The school assigns the teacher': 'تحدد المدرسة المعلم',
  'Teacher:': 'المعلم:',
  '(online)': '(عبر الإنترنت)',
  'Choose the teacher…': 'اختر المعلم…',
  'Choose…': 'اختر…',
  'Sat in': 'امتُحن فيها في',
  'Take it off the choices': 'احذفها من الاختيارات',
  'The price shown is now up to date: reserve again.': 'السعر المعروض محدَّث الآن: احجز مرة أخرى.',
  'Choose the teacher': 'اختر المعلم',
  'Choose the earlier exam': 'اختر الامتحان السابق',
  'Answer this question': 'أجب عن هذا السؤال',
  'Pick at least one subject.': 'اختر مادة واحدة على الأقل.',
  'Tick the refund policy and the declaration.': 'حدد سياسة الاسترداد والإقرار.',
  'Tick that the parent read and signed the refund policy and the declaration.': 'حدد أن ولي الأمر قرأ سياسة الاسترداد والإقرار ووقّع عليهما.',
  'Some choices are not finished: they are marked in red above.': 'بعض الاختيارات لم تكتمل: معلَّمة بالأحمر أعلاه.',
  'A few questions from the school': 'أسئلة من المدرسة',
  'Your answer': 'إجابتك',
  'You can pay once the school confirms its prices.': 'يمكنك الدفع حين تؤكد المدرسة أسعارها.',
  'Not open to this student': 'غير متاح لهذا الطالب',
  'Grade 10: an exam month other than June': 'الصف 10: شهر امتحان غير يونيو',
  // The statement and the slip
  'declared by the family': 'صرّحت بها الأسرة',
  'declared at the desk': 'صُرّح بها في المكتب',
  'on record': 'مسجلة',
  'before the system': 'قبل النظام',
  'not final yet': 'ليست نهائية بعد',
  'transfer being checked: kept until': 'التحويل قيد المراجعة: محجوزة حتى',
  'last day to pay': 'آخر يوم للدفع',
  'prices not final yet: payable once the school confirms them': 'الأسعار ليست نهائية بعد: تُدفع حين تؤكدها المدرسة',
  'Your transfer is being checked by the school': 'تحويلك قيد المراجعة لدى المدرسة',
  'its subjects are kept for it until': 'وموادّه محجوزة له حتى',
  'Open until': 'مفتوحة حتى',
  'Being checked': 'قيد المراجعة',
  'Tick the refund policy and the declaration': 'حدد سياسة الاسترداد والإقرار',
  '* Prices are not final yet: payable once the school confirms them.': '* الأسعار ليست نهائية بعد: تُدفع حين تؤكدها المدرسة.',
  // The register page
  'One page per child: pick the subjects, agree once, and reserve. You pay at the checkout.': 'صفحة لكل ابن: اختر المواد، ووافق مرة واحدة، واحجز. الدفع في صفحة الدفع.',
  'Pick what you will sit; your parent approves and pays.': 'اختر ما ستمتحن فيه؛ يوافق ولي أمرك ويدفع.',
  'Reserve for': 'الحجز لـ',
  'Your subjects': 'موادك',
  'Reserved for': 'تم الحجز لـ',
  // The checkout
  'Cancel this checkout': 'ألغِ عملية الدفع هذه',
  "Quote this reference (or the student's name) at the desk. Your registrations are confirmed as soon as the finance officer records your payment.":
    'اذكر هذا المرجع (أو اسم الطالب) في المكتب. تُؤكَّد حجوزاتك بمجرد أن يسجل موظف المالية دفعتك.',
  '1 — Transfer via InstaPay to the school account': '1 — حوّل عبر إنستاباي إلى حساب المدرسة',
  '2 — Submit your transaction reference': '2 — أرسل مرجع التحويل',
  'Reference submitted. The finance team will verify your transfer against the bank statement and confirm your registrations — usually within one school day.':
    'تم إرسال المرجع. سيراجع فريق المالية تحويلك مقابل كشف البنك ويؤكد حجوزاتك — عادةً خلال يوم دراسي واحد.',
  "You can find the reference in your InstaPay app under the transfer's details.": 'تجد المرجع في تطبيق إنستاباي ضمن تفاصيل التحويل.',
  'Payment already started': 'الدفع بدأ بالفعل',
  'The last day to pay has passed. Submit your transfer reference by': 'انقضى آخر يوم للدفع. أرسل مرجع التحويل قبل',
  ': after that the payment is cancelled and the subjects are released.': ': بعده تُلغى الدفعة وتُحرَّر المواد.',
  'Your transfer is being checked by the finance office: reference': 'تحويلك قيد المراجعة لدى مكتب المالية: المرجع',
  'They confirm it against the bank statement, usually within one school day.': 'يؤكدونه مقابل كشف البنك، عادةً خلال يوم دراسي واحد.',
  'Your subjects are kept for it until': 'موادك محجوزة له حتى',
  'Quote this reference at the finance desk': 'اذكر هذا المرجع في مكتب المالية',
  'Reference submitted. The finance team will verify it.': 'تم إرسال المرجع. سيراجعه فريق المالية.',
  'The subjects reserved for': 'المواد المحجوزة لـ',
  'What you are paying for': 'ما تدفع مقابله',
  'prices not final yet: paid once the school confirms them': 'الأسعار ليست نهائية بعد: تُدفع حين تؤكدها المدرسة',
  'The price shown is now up to date: pay again.': 'السعر المعروض محدَّث الآن: ادفع مرة أخرى.',
  'Take it off this payment': 'احذفها من هذه الدفعة',
  'Total to pay now': 'الإجمالي المطلوب دفعه الآن',
  '(the earliest last day to pay of these subjects)': '(أقرب آخر يوم للدفع بين هذه المواد)',
  'Prices are not final yet for': 'الأسعار ليست نهائية بعد لـ',
  'they stay reserved, and you can pay them once the school confirms them.': 'تبقى محجوزة، ويمكنك دفعها حين تؤكدها المدرسة.',
  'This payment is for the others.': 'هذه الدفعة للمواد الأخرى.',
  "You'll get a payment reference to quote at the school finance desk. Pay by cash, card, or InstaPay at the desk — registrations confirm on the spot.":
    'ستحصل على مرجع دفع تذكره في مكتب المالية بالمدرسة. ادفع نقدًا أو بالبطاقة أو بإنستاباي في المكتب — تُؤكَّد الحجوزات في الحال.',
  "You'll get the school's account details to transfer the exact amount via InstaPay, then submit your transaction reference. The finance team verifies the transfer before your registrations are confirmed.":
    'ستحصل على بيانات حساب المدرسة لتحويل المبلغ بالضبط عبر إنستاباي، ثم ترسل مرجع التحويل. يراجع فريق المالية التحويل قبل تأكيد حجوزاتك.',
  // Registrations
  'Refund policy: you will receive': 'سياسة الاسترداد: ستسترد',
  'back (of': '(من',
  "), released to the balance once the subject's receipt is returned to the school.": ')، تُضاف إلى الرصيد بمجرد إعادة إيصال المادة إلى المدرسة.',
  'Prices are not final yet: it can be paid once the school confirms them.': 'الأسعار ليست نهائية بعد: يمكن دفعها حين تؤكدها المدرسة.',
  'Reverting...': 'جارٍ التراجع...',
  'Bring paper receipt': 'أحضر الإيصال الورقي',
  'back to the school finance desk': 'إلى مكتب المالية بالمدرسة',
  'to release your': 'لتحرير',
  '. The drop only completes once the school has it.': '. لا يكتمل السحب إلا حين تستلمه المدرسة.',
  'is ready to collect from the finance desk.': 'جاهز للاستلام من مكتب المالية.',
  '— keep it safe, it must be returned if you drop or swap this subject.': '— احتفظ به، فيجب إعادته إن سحبت هذه المادة أو استبدلتها.',
  'Reservations for this session are closed: swapping is no longer possible. A drop still is, with its refund shown first.':
    'الحجز في هذه الجلسة مغلق: لم يعد الاستبدال ممكنًا. السحب ما زال ممكنًا، ويُعرض مبلغ الاسترداد أولًا.',
  'Swap': 'استبدال',
  'The refund below is credited after approval and receipt return.': 'يُضاف الاسترداد أدناه بعد الموافقة وإعادة الإيصال.',
  'Prices are not final yet: the new subject can be paid once the school confirms them.': 'الأسعار ليست نهائية بعد: يمكن دفع المادة الجديدة حين تؤكدها المدرسة.',
  'Old subject refunded per the refund policy below.': 'تُسترد المادة القديمة وفق سياسة الاسترداد أدناه.',
  'awaiting payment': 'بانتظار الدفع',
  'Select All': 'تحديد الكل',
  'Pay Selected': 'ادفع المحدد',
  'Pay All': 'ادفع الكل',
  'Waiting on your parent to approve these. They will find them under "Pending Approvals" when they sign in — we have already notified them.':
    'بانتظار موافقة ولي أمرك عليها. سيجدها تحت «طلبات بانتظار الموافقة» عند تسجيل الدخول — وقد أبلغناه بالفعل.',
  // Approvals
  'No subject requests': 'لا توجد طلبات مواد',
  'None of your children are waiting on a subject-registration approval.': 'لا ينتظر أي من أبنائك موافقتك على حجز مادة.',
  'prices not final yet': 'الأسعار ليست نهائية بعد',
  'Student not found': 'الطالب غير موجود',
  // The family's next step and its home
  'is open for reservations.': 'مفتوحة للحجز.',
  '— kept until': '— محجوزة حتى',
  'pay by': 'الدفع قبل',
  'Last day to pay:': 'آخر يوم للدفع:',
  '; after it the subject can no longer be paid.': '؛ بعده لا يمكن دفع المادة.',
  'once the school confirms its prices.': 'حين تؤكد المدرسة أسعارها.',
  'Payable once the school confirms its prices.': 'تُدفع حين تؤكد المدرسة أسعارها.',
  'You need a linked child before you can register subjects or pay fees. If your child already has an account, request the link; otherwise the school office can set both up for you in one visit.':
    'تحتاج إلى ربط ابنك قبل أن تحجز المواد أو تدفع الرسوم. إن كان لابنك حساب فاطلب الربط؛ وإلا فيمكن لمكتب المدرسة إعداد الحسابين لك في زيارة واحدة.',
  'You’re all caught up': 'لا شيء ينتظرك',
  'Nothing is owed and nothing is waiting for your approval.': 'لا شيء مستحق ولا شيء بانتظار موافقتك.',
  'Nothing is waiting on you right now.': 'لا شيء ينتظرك الآن.',
  'Everything outstanding for your family, in one place.': 'كل ما على أسرتك، في مكان واحد.',
  'Here is where things stand.': 'هذا وضعك الآن.',
  'Open now:': 'مفتوحة الآن:',
  // The balance
  'Held for a Subject': 'محتجز لمادة',
  'Hold Released': 'أُفرج عن المبلغ المحتجز',
  'Instalment Held for a Subject': 'قسط محتجز لمادة',
  'Instalments Applied to Subject': 'الأقساط طُبّقت على المادة',
  'Instalments Released': 'أُفرج عن الأقساط',
  'Instalments Kept by the Plan': 'الأقساط احتفظت بها الخطة',
  'Instalment Reversed': 'أُلغي القسط',
  'Charge Refund': 'استرداد رسوم',
  'held for subjects paid in instalments (applied to them when the plan is paid)': 'محتجز لمواد تُدفع بالأقساط (يُطبَّق عليها حين تُسدَّد الخطة)',
  // The desk
  'Cash': 'نقدًا',
  'Receipt marked as handed to the parent.': 'سُجّل أن الإيصال سُلّم لولي الأمر.',
  'Receipt returned — any pending drop refund is released.': 'أُعيد الإيصال — يُحرَّر أي استرداد سحب معلق.',
  'Payment reversed — registrations back to pending payment, receipts voided. The money returned counts as money out today.':
    'أُلغيت الدفعة — عادت الحجوزات إلى انتظار الدفع وأُبطلت الإيصالات. المبلغ المُعاد يُحسب مالًا خارجًا اليوم.',
  'Payment reversed — registrations back to pending payment, receipts voided. Recorded as a correction to the day it was confirmed; today’s drawer is unchanged.':
    'أُلغيت الدفعة — عادت الحجوزات إلى انتظار الدفع وأُبطلت الإيصالات. سُجّلت تصحيحًا ليوم تأكيدها؛ ودرج اليوم لم يتغير.',
  'Could not search right now. Check your connection and try again.': 'تعذّر البحث الآن. تحقق من اتصالك وحاول مرة أخرى.',
  'No student matches "': 'لا يوجد طالب يطابق «',
  '". If they are new, use': '». إن كان جديدًا فاستخدم',
  'to create their accounts.': 'لإنشاء حساباتهم.',
  'Transferred': 'انتقل',
  'Withdrawn': 'انسحب',
  'Started grade 10 in': 'بدأ الصف 10 في',
  'Hide academic record': 'إخفاء السجل الدراسي',
  'Academic record': 'السجل الدراسي',
  'Parents:': 'أولياء الأمور:',
  'none linked — onboard the family above': 'لا أحد مرتبط — سجّل الأسرة أعلاه',
  'school fee paid': 'المصاريف الدراسية مدفوعة',
  'school fee waived — nothing to collect': 'المصاريف الدراسية معفاة — لا شيء للتحصيل',
  'Active exceptions:': 'الاستثناءات السارية:',
  '(outside)': '(خارجية)',
  'e.g. Wrong student — money returned to the parent': 'مثلًا: طالب خطأ — أُعيد المبلغ لولي الأمر',
  'Was the money returned to the family?': 'هل أُعيد المبلغ إلى الأسرة؟',
  'Yes — the money was given back': 'نعم — أُعيد المبلغ',
  'Cash handed back, card refunded or transfer returned. Counts as money out today.': 'نقد أُعيد، أو بطاقة استُردت، أو تحويل أُعيد. يُحسب مالًا خارجًا اليوم.',
  'No — it was never received': 'لا — لم يُستلم أصلًا',
  'Family onboarded — accounts ready and linked. Share the temporary passwords with them.': 'سُجّلت الأسرة — الحسابات جاهزة ومرتبطة. شارك كلمات المرور المؤقتة معهم.',
  "Enter emails. Existing accounts are reused; new ones need a name and temporary password. The link is approved on the spot — you're vouching for them in person.":
    'أدخل البريد الإلكتروني. تُستخدم الحسابات الموجودة؛ والجديدة تحتاج اسمًا وكلمة مرور مؤقتة. يُعتمد الربط في الحال — فأنت تضمنهم شخصيًا.',
  'Parent email *': 'بريد ولي الأمر *',
  'Parent name (new account)': 'اسم ولي الأمر (حساب جديد)',
  'Temp password (new account)': 'كلمة مرور مؤقتة (حساب جديد)',
  'Student email *': 'بريد الطالب *',
  'Student name (new account)': 'اسم الطالب (حساب جديد)',
  'Grade 9 (starts grade 10 next year)': 'الصف 9 (يبدأ الصف 10 العام المقبل)',
  'Prices not final yet, collected once the school confirms them:': 'الأسعار ليست نهائية بعد، تُحصَّل حين تؤكدها المدرسة:',
  'Past its last day to pay': 'انقضى آخر يوم لدفعها',
  ': it can no longer be paid. Reserve it again while it is offered.': ': لم يعد ممكنًا دفعها. احجزها من جديد ما دامت معروضة.',
  'reaches its last day to pay today': 'يحل آخر يوم لدفعه اليوم',
  'reach their last day to pay today': 'يحل آخر يوم لدفعها اليوم',
  ': the subjects in one, the charges in their own.': ': المواد في دفعة واحدة، والرسوم الأخرى في دفعاتها.',
  'Something went wrong': 'حدث خطأ ما',
  'Something went wrong fetching this data — it is not empty, it just did not load.': 'حدث خطأ أثناء جلب هذه البيانات — ليست فارغة، لكنها لم تُحمَّل.',
  'At school': 'في المدرسة',
  'Starts next year': 'يبدأ العام المقبل',
  'Grade not recorded': 'الصف غير مسجل',
  'Please write a short reason — it is stored in the audit trail.': 'اكتب سببًا قصيرًا — يُحفظ في سجل التدقيق.',
  // The API's sentences with no data (after familyWords)
  'The prices of this session are not final yet: the subject is reserved, and it can be paid once the school confirms its prices':
    'أسعار هذه الجلسة ليست نهائية بعد: المادة محجوزة، ويمكن دفعها حين تؤكد المدرسة أسعارها',
  'The price of one or more of these subjects changed while this was open (the exam board confirmed its fee) — look at the new price and pay again':
    'تغيّر سعر مادة أو أكثر من هذه المواد أثناء فتح هذه الصفحة (أكّد المجلس رسومه) — انظر إلى السعر الجديد وادفع مرة أخرى',
  'One or more registrations are not ready for payment': 'حجز واحد أو أكثر غير جاهز للدفع',
  'That choice is not on offer in this session': 'هذا الخيار غير معروض في هذه الجلسة',
};

const MONTHS_LONG_AR: Record<string, string> = {
  January: 'يناير', February: 'فبراير', March: 'مارس', April: 'أبريل', May: 'مايو', June: 'يونيو',
  July: 'يوليو', August: 'أغسطس', September: 'سبتمبر', October: 'أكتوبر', November: 'نوفمبر', December: 'ديسمبر',
};
/** A date or an exam month the API wrote ("1 November 2026", "June 2026"), its month in Arabic. */
const dateAr = (d: string) => d.replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/g, (m) => MONTHS_LONG_AR[m] ?? m);
/** "First entry in school" and the other cells, as the API names an option. */
const OPTION_AR: Record<string, string> = {
  'a first entry in school': 'قيد أول في المدرسة', 'a first entry in self study': 'قيد أول دراسة ذاتية',
  'a retake in school': 'إعادة في المدرسة', 'a retake in self study': 'إعادة دراسة ذاتية',
};
const countAr = (n: number, one: string, many: string) => (n === 1 ? `${one} واحد` : `${n} ${many}`);

/** The family's and the desk's sentences with data: the reservation's results and the refusals they show (after familyWords). */
const FAMILY_RULES: [RegExp, (m: RegExpExecArray) => string | null][] = [
  [/^Reserved: (\d+) reservations? waiting for payment\.$/, (m) => `تم الحجز: ${countAr(Number(m[1]), 'حجز', 'حجوزات')} بانتظار الدفع.`],
  [/^Reserved: (\d+) reservations?\.$/, (m) => `تم الحجز: ${countAr(Number(m[1]), 'حجز', 'حجوزات')}.`],
  [/^(\d+) reserved, not collected: prices are not final yet\.$/, (m) => `${countAr(Number(m[1]), 'حجز', 'حجوزات')} دون تحصيل: الأسعار ليست نهائية بعد.`],
  [/^Collected EGP ([\d,.]+)\.$/, (m) => `تم تحصيل ${m[1]} جنيه.`],
  // Refusals at a subject (Appendix A's codes; the sentences of window.services and line-rules.services).
  [/^(.+) is not taking reservations \(it closed on (.+)\)$/, (m) => `${m[1]} لا تقبل حجوزات (أُغلقت في ${dateAr(m[2]!)})`],
  [/^(.+) is not taking reservations$/, (m) => `${m[1]} لا تقبل حجوزات`],
  [/^(.+) is not open for reservations yet$/, (m) => `${dateAr(m[1]!)} لم تُفتح للحجز بعد`],
  [/^Choose the teacher of (.+)$/, (m) => `اختر معلم ${m[1]}`],
  [/^Answer: (.+)$/, (m) => `أجب: ${m[1]}`],
  [/^(.+) was sat before \((.+)\): reserve it as a retake$/, (m) => `امتُحن في ${m[1]} من قبل (${dateAr(m[2]!)}): احجزها إعادةً`],
  [/^A retake of (.+) names the exam it follows$/, (m) => `إعادة ${m[1]} تسمّي الامتحان الذي تتبعه`],
  [/^(.+) carries an earlier exam forward: name the one it is carried from$/, (m) => `${m[1]} تنقل نتيجة امتحان سابق: سمِّ الامتحان المنقول منه`],
  [/^(.+) is not one of the earlier exams (.+) is carried from$/, (m) => `${dateAr(m[1]!)} ليس من الامتحانات السابقة التي تُنقل منها ${m[2]}`],
  [/^(.+) and (.+) cannot be reserved together$/, (m) => `لا يمكن حجز ${m[1]} و${m[2]} معًا`],
  [/^(.+) is already reserved in (.+) \((.+)\): the board takes one entry$/, (m) => `${m[1]} محجوزة بالفعل في ${dateAr(m[2]!)} (${m[3]}): يقبل المجلس قيدًا واحدًا`],
  [/^(.+) is not offered as (a first entry in school|a first entry in self study|a retake in school|a retake in self study)$/, (m) => `${m[1]} غير معروضة ${OPTION_AR[m[2]!]}`],
  [/^(.+) is not offered in this session$/, (m) => `${m[1]} غير معروضة في هذه الجلسة`],
  [/^(.+) is a retake of one paper: it takes no first entry$/, (m) => `${m[1]} إعادة لورقة واحدة: لا تقبل قيدًا أول`],
  [/^(.+): the exam board's (entry|retake) deadline \((.+)\) has passed$/, (m) => `${m[1]}: انقضى آخر موعد ${m[2] === 'retake' ? 'للإعادة' : 'للقيد'} لدى المجلس (${dateAr(m[3]!)})`],
  [/^(.+): its exams start on (.+) and its board takes no more entries$/, (m) => `${m[1]}: تبدأ امتحاناتها في ${dateAr(m[2]!)} ولا يقبل مجلسها قيودًا أخرى`],
  [/^(.+) was not paid by (.+), its last day to pay: it can no longer be paid — reserve it again while it is offered$/,
    (m) => `${m[1]} لم تُدفع حتى ${dateAr(m[2]!)}، آخر يوم للدفع: لم يعد ممكنًا دفعها — احجزها من جديد ما دامت معروضة`],
  [/^(.+)'s price is not confirmed yet: the subject is reserved, and it can be paid once the school confirms its price$/,
    (m) => `سعر ${m[1]} لم يُؤكَّد بعد: المادة محجوزة، ويمكن دفعها حين تؤكد المدرسة سعرها`],
  [/^(.+) is not waiting for payment$/, (m) => `${m[1]} ليست بانتظار الدفع`],
  [/^(.+) is in grade (\d+) in (\S+), and this session takes (.+?)(\. A coordinator can grant an exception\.)?$/,
    (m) => `${m[1]} في الصف ${m[2]} في ${m[3]}، وهذه الجلسة تقبل ${gradesAr(m[4]!)}${m[5] ? '. يمكن للمنسق منح استثناء.' : ''}`],
  [/^(.+) finished grade 12 in (\S+), and this session takes (.+)$/, (m) => `أنهى ${m[1]} الصف 12 في ${m[2]}، وهذه الجلسة تقبل ${gradesAr(m[3]!)}`],
];

/** "grades 11 and 12 and graduates" → Arabic, word by word. */
function gradesAr(text: string): string {
  return text.replace(/\bgrades?\b/g, 'الصفوف').replace(/\bgraduates\b/g, 'الخريجين').replace(/ and /g, ' و').replace(/, /g, '، ');
}
