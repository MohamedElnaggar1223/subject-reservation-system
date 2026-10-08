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
  'Escrow to apply (EGP)': 'المبلغ من المحفظة (جنيه)',
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
  'Escrow': 'المحفظة',
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
  'from escrow': 'من المحفظة',
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
const lines = (n: string) => `${n} ${Number(n) === 1 ? 'سطر' : 'أسطر'}`;

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
  [/^Sent to your parent for approval: (\d+) lines?\.$/, (m) => `أُرسل إلى ولي أمرك للموافقة: ${lines(m[1]!)}.`],
  [/^Preregistered: (\d+) lines?\. Pay now to hold the money until the session opens\.$/, (m) => `تم التسجيل المسبق: ${lines(m[1]!)}. ادفع الآن لاحتجاز المبلغ حتى تُفتح الجلسة.`],
  [/^Reserved: (\d+) lines? awaiting payment\. Pay by exam series on the next screen\.$/, (m) => `تم الحجز: ${lines(m[1]!)} في انتظار الدفع. ادفع لكل دورة امتحان في الشاشة التالية.`],
  [/^Reserved (\d+) lines?\.$/, (m) => `تم حجز ${lines(m[1]!)}.`],
  [/^Collected EGP ([\d,.]+)( in (\d+) payments, one per entry deadline)?\.$/, (m) => `تم تحصيل ${m[1]} جنيه${m[3] ? ` في ${m[3]} دفعات، دفعة لكل موعد قيد` : ''}.`],
  [/^(\d+) on a provisional board fee: collected once the fee is confirmed\.$/, (m) => `${m[1]} على رسوم مجلس مؤقتة: تُحصَّل حين تُؤكَّد الرسوم.`],
  [/^Not collected — hand this money back: (.+)\.$/, (m) => `لم يُحصَّل — أعد هذا المبلغ: ${m[1]}.`],
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
];

/** Sentences of these screens that carry a name, a number or a date. */
export function translateReservationsText(text: string): string | null {
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
