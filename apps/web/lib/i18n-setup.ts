/**
 * The coordinator's screens (COORDINATOR_REWORK.md §5; P2): Sessions, the Session with its check list
 * and tabs, the subject editor and her Home — their words in Arabic, for the page translator
 * (lib/i18n.tsx), and `herWords`, which puts an API refusal in her words.
 *
 * Her vocabulary (§13 P2): none of the board's words for an exam (its month, its level, its parts, its
 * codes for an option) on her screens, in English or Arabic; the exam month is شهر الامتحان. The app's
 * Arabic is kept: الجلسة (session), المادة (subject), المجلس (board), رسوم المقرر (course fee), قيد أول
 * (first entry), إعادة (retake), دراسة ذاتية (self study), في المدرسة (in school), الإدارة (the admin).
 * `apps/web/scripts/check-setup-words.mjs` checks this file and her screens' source for the words.
 *
 * Text with a number, a name or a date in it is split into its own nodes on the screens, so most entries
 * are whole phrases; `translateSetupText` takes the sentences that carry data (an aria-label with a
 * subject's name, a week, a share, a day count), each anchored at both ends so no other screen's text is
 * taken. Subject, teacher, board and list names are data and stay as written (data-i18n-skip).
 */

// ─── Her words for an API refusal ────────────────────────────────────────────

/**
 * The board's words a refusal may carry (a row's sitting, a series rule), in hers. Each rule is a whole
 * word, so a subject's name or code is never touched.
 */
const HER_WORDS: [RegExp, string][] = [
  // An all-papers row's stored label (WHOLE_ITEM_LABEL); her screens and families read "All papers".
  [/\bWhole subject\b/g, 'All papers'],
  [/\bsittings\b/gi, 'exam months'],
  [/\bsitting\b/gi, 'exam month'],
  [/\bseries\b/gi, 'exam month'],
  [/\bawards\b/gi, 'qualifications'],
  [/\baward\b/gi, 'qualification'],
  [/\bcomponents\b/gi, 'papers'],
  [/\bcomponent\b/gi, 'paper'],
  [/\bsuites\b/gi, 'sets'],
  [/\bsuite\b/gi, 'set'],
  [/\bmappings\b/gi, 'links'],
  [/\bmapping\b/gi, 'link'],
  [/\boption codes\b/gi, 'codes'],
  [/\boption code\b/gi, 'code'],
];

export function herWords(text: string): string {
  let out = text;
  for (const [re, to] of HER_WORDS) out = out.replace(re, to);
  return out;
}

// ─── Arabic ──────────────────────────────────────────────────────────────────

const CELL_AR: Record<string, string> = {
  'First entry in school': 'قيد أول في المدرسة',
  'Retake in school': 'إعادة في المدرسة',
  'Retake self study': 'إعادة دراسة ذاتية',
  'First entry self study': 'قيد أول دراسة ذاتية',
};

const MONTH_AR: Record<string, string> = {
  January: 'يناير', February: 'فبراير', March: 'مارس', April: 'أبريل', May: 'مايو', June: 'يونيو', July: 'يوليو',
  August: 'أغسطس', September: 'سبتمبر', October: 'أكتوبر', November: 'نوفمبر', December: 'ديسمبر',
};
/** A session's or an exam's name with its months in Arabic ("June 2027" → "يونيو 2027"). */
const months = (s: string) => s.replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/g, (m) => MONTH_AR[m] ?? m);

export const setupArabic: Record<string, string> = {
  // Sessions and New session
  'June': 'يونيو',
  'November / January': 'نوفمبر / يناير',
  'A session is one cycle — June, or November / January. Families see it once it accepts reservations.': 'الجلسة موسم تسجيل واحد — يونيو، أو نوفمبر / يناير. تراها العائلات عندما تبدأ قبول الحجوزات.',
  'New session': 'جلسة جديدة',
  'No sessions yet': 'لا توجد جلسات بعد',
  'A session is one cycle — June, or November / January — with every subject in it.': 'الجلسة موسم تسجيل واحد — يونيو، أو نوفمبر / يناير — بكل موادها.',
  '— (optional)': '— (اختياري)',
  '(optional)': '(اختياري)',
  'Payment due': 'موعد السداد',
  'First lesson': 'أول درس',
  'Money': 'المال',
  'paid': 'مدفوع',
  'waiting for payment': 'بانتظار الدفع',
  'outstanding': 'مستحق',
  'prices final': 'الأسعار نهائية',
  'prices not final': 'الأسعار غير نهائية',
  'Type': 'النوع',
  'Year': 'السنة',
  'Start from': 'البدء من',
  'Every subject, row, teacher, note, question, policy and share comes across. Earlier exams and dates move on a year; prices come across as last year\'s, not final.': 'تنتقل كل مادة وصف ومعلم وملاحظة وسؤال وسياسة ونسبة. تتقدم الامتحانات السابقة والتواريخ سنة؛ وتنتقل الأسعار كأسعار العام الماضي، غير نهائية.',
  'No subjects: add them from the boards’ lists.': 'بلا مواد: أضفها من قوائم المجالس.',
  'Copy the last session of this type (there is none yet)': 'انسخ آخر جلسة من هذا النوع (لا توجد بعد)',
  'Empty': 'فارغة',
  'The session\'s name — made from the type and the year': 'اسم الجلسة — من النوع والسنة',
  'already exists.': 'موجودة بالفعل.',
  'Creating…': 'جارٍ الإنشاء…',
  'Create': 'إنشاء',
  'copied from': 'منسوخة من',
  'subject': 'مادة',
  'subjects': 'مواد',
  'reservation': 'حجز',
  'reservations': 'حجوزات',

  // The cells (D3)
  ...CELL_AR,
  'first entry in school': 'قيد أول في المدرسة',
  'retake in school': 'إعادة في المدرسة',
  'retake self study': 'إعادة دراسة ذاتية',
  'first entry self study': 'قيد أول دراسة ذاتية',

  // Status
  'Accepting reservations': 'يقبل الحجوزات',
  'Draft — families cannot see it': 'مسودة — لا تراها العائلات',
  'Closed': 'مغلقة',

  // The impact pattern
  'The counts changed while you were looking': 'تغيّرت الأعداد أثناء المراجعة',
  'Before this is saved': 'قبل الحفظ',
  'Saving…': 'جارٍ الحفظ…',
  'Save it': 'احفظه',

  // The check list
  'Check before you open': 'راجع قبل الفتح',
  'Needs a look': 'يحتاج إلى مراجعة',
  'Show': 'إظهار',
  'Hide': 'إخفاء',
  'Nothing left: the session can open.': 'لم يبقَ شيء: يمكن فتح الجلسة.',
  'Nothing needs a look.': 'لا شيء يحتاج إلى مراجعة.',
  'Blocks opening': 'يمنع الفتح',
  'Show the list': 'إظهار القائمة',
  'Hide the list': 'إخفاء القائمة',
  'Waiting for the admin:': 'بانتظار الإدارة:',
  'has not published its': 'لم ينشر بعد آخر موعد للقيد لامتحانات',
  'entry deadline yet.': '.',
  'A board has not published its entry deadline yet.': 'لم ينشر أحد المجالس آخر موعد للقيد بعد.',
  'Opening waits until the admin enters it.': 'الفتح ينتظر حتى تُدخله الإدارة.',
  'Enter it once when it does: it joins the reference data for every session.': 'أدخله مرة واحدة عند نشره: ينضم إلى البيانات المرجعية لكل الجلسات.',
  'The copy moved the dates one year:': 'نقل النسخ التواريخ سنة واحدة:',
  'The dates are the defaults:': 'التواريخ هي الافتراضية:',
  'payment due': 'موعد السداد',
  'first lesson': 'أول درس',
  'Set them in the header, or keep them.': 'حدّدها في أعلى الصفحة، أو أبقِها كما هي.',
  'Keep them': 'أبقِها كما هي',
  'Set them': 'حدّدها',
  'Set it': 'حدّده',
  'course fee': 'رسوم مقرر',
  'course fees': 'رسوم مقرر',
  'exam fee': 'رسوم امتحان',
  'exam fees': 'رسوم امتحان',
  'Go to Prices': 'إلى الأسعار',
  'The prices are last cycle\'s, copied: paste this year\'s lists, check what is left, then switch prices final.': 'الأسعار منسوخة من الموسم الماضي: الصق قوائم هذا العام، وراجع ما تبقى، ثم اجعل الأسعار نهائية.',
  'The payment due date has passed and prices are not final: families cannot pay yet.': 'مضى موعد السداد والأسعار غير نهائية: لا تستطيع العائلات الدفع بعد.',
  'On your forms a retaker who picks a teacher retakes in school, so retake in school starts ticked wherever first entry in school is. Untick any the school does not offer.': 'في نماذجك، من يعيد ويختار معلمًا يعيد في المدرسة، لذا تبدأ «إعادة في المدرسة» محددة حيثما كان «قيد أول في المدرسة». ألغِ تحديد ما لا تقدمه المدرسة.',
  'Looks right': 'يبدو صحيحًا',
  'Open the subject': 'افتح المادة',
  'Open the session': 'افتح الجلسة',
  'switched off — not offered to families until you switch it on.': 'متوقفة — لا تُعرض على العائلات حتى تشغّلها.',
  'nothing ticked — not offered to families.': 'لا شيء محدد — لا تُعرض على العائلات.',
  'taught in school, but no teacher is named.': 'تُدرَّس في المدرسة، لكن لم يُسمَّ معلم.',
  'teacher to be confirmed. Families read “teacher to be announced”.': 'المعلم لم يُؤكَّد بعد. تقرأ العائلات «سيُعلن عن المعلم لاحقًا».',
  'not on our list: families read its name as you typed it, and we are told to add it.': 'ليست في قائمتنا: تقرأ العائلات اسمها كما كتبته، ونُبلَّغ لإضافتها.',
  'Switch it on': 'شغّلها',
  'is older than': 'أقدم مما يحتفظ به',
  'carries a result forward. It stays, since your list wins; the board may refuse the entry.': 'من نتائج سابقة. تبقى لأن قائمتك هي المعتمدة؛ وقد يرفض المجلس القيد.',
  'The board\'s deadline cancels unpaid reservations first. Move your dates earlier?': 'موعد المجلس يلغي الحجوزات غير المدفوعة أولًا. هل تقدّم تواريخك؟',
  'Set the dates': 'حدّد التواريخ',
  'Retake deadline (if the board has one)': 'آخر موعد لقيد الإعادة (إن كان للمجلس موعد)',
  'Try again': 'حاول مرة أخرى',
  'Save the date': 'احفظ التاريخ',
  'The date is saved, but the waiting reservations\' due dates did not move. Try again.': 'حُفظ التاريخ، لكن مواعيد سداد الحجوزات المنتظرة لم تتغير. حاول مرة أخرى.',
  'a board date (the admin)': 'موعد مجلس (الإدارة)',
  'the dates': 'التواريخ',

  // The Session screen
  'Subjects': 'المواد',
  'Prices': 'الأسعار',
  'What families agree to': 'ما توافق عليه العائلات',
  'Reservations': 'الحجوزات',
  'Sessions': 'الجلسات',
  'Nothing on this session is yours to see.': 'لا شيء في هذه الجلسة ضمن صلاحياتك.',
  'offered to families': 'معروضة على العائلات',
  'self study pays': 'الدراسة الذاتية تدفع',
  'of the course fee': 'من رسوم المقرر',
  'Opening waits for:': 'الفتح ينتظر:',
  'Prices final': 'الأسعار نهائية',
  '— families can pay': '— تستطيع العائلات الدفع',
  'Families have reserved: prices stay final.': 'حجزت العائلات: تبقى الأسعار نهائية.',
  'Families can no longer reserve here. You can open it again later.': 'لن تستطيع العائلات الحجز هنا بعد الآن. يمكنك فتحها مرة أخرى لاحقًا.',
  'Unpaid reservations now:': 'الحجوزات غير المدفوعة الآن:',
  'Closing…': 'جارٍ الإغلاق…',
  'Close it': 'أغلقها',
  'Today closing also cancels every unpaid reservation and ends its checkout; money held comes back to the family\'s balance.': 'الإغلاق اليوم يلغي أيضًا كل حجز غير مدفوع وينهي عملية الدفع الخاصة به؛ ويعود المال المحجوز إلى رصيد العائلة.',
  'Clear': 'مسح',
  'Switches Accepting off at the end of that day.': 'يوقف قبول الحجوزات في نهاية ذلك اليوم.',
  'Unpaid reservations are cancelled': 'تُلغى الحجوزات غير المدفوعة بعد',
  'day after it.': 'يوم من موعد السداد.',
  'days after it.': 'أيام من موعد السداد.',
  'The refund weeks count from it.': 'تُحسب أسابيع الاسترداد منه.',
  'Closed on': 'أُغلقت في',
  'Switch Accepting on to open it again.': 'شغّل قبول الحجوزات لفتحها مرة أخرى.',

  // Subjects
  'None yet.': 'لا شيء بعد.',
  'Add a subject': 'أضف مادة',
  'Pick from the board\'s list…': 'اختر من قائمة المجلس…',
  'Adding…': 'جارٍ الإضافة…',
  'Add': 'إضافة',
  'or': 'أو',
  'Copy a subject from another session': 'انسخ مادة من جلسة أخرى',
  'Not on the list': 'ليست في القائمة',
  'Accepting': 'تقبل الحجوزات',
  'Opens with the session': 'تُفتح مع الجلسة',
  'Switched off': 'متوقفة',
  'not on the list (flagged to us)': 'ليست في القائمة (أُبلغنا)',
  'teacher to be confirmed': 'المعلم لم يُؤكَّد بعد',
  '(online)': '(عبر الإنترنت)',
  '(external team)': '(فريق خارجي)',
  'no teacher': 'لا معلم',
  'No row ticked.': 'لا صف محدد.',
  'exam fee not set': 'رسوم الامتحان غير محددة',
  'course fee not set': 'رسوم المقرر غير محددة',
  'not set': 'غير محددة',
  'Not offered to families: a price is not set': 'لا تُعرض على العائلات: سعر غير محدد',
  'Its rows, ticks, teachers, note, questions and fees come across; its earlier exams and dates move to this session\'s year.': 'تنتقل صفوفها وتحديداتها ومعلموها وملاحظتها وأسئلتها ورسومها؛ وتنتقل امتحاناتها السابقة وتواريخها إلى سنة هذه الجلسة.',
  'From': 'من',
  'No other session yet': 'لا توجد جلسة أخرى بعد',
  'Subject': 'المادة',
  'Pick a subject…': 'اختر مادة…',
  'Every subject there is already here': 'كل مواد تلك الجلسة موجودة هنا بالفعل',
  'Copying…': 'جارٍ النسخ…',
  'Copy it': 'انسخها',
  'A subject not on the list': 'مادة ليست في القائمة',
  'Families read its name as you type it. We are told, and add it to the list.': 'تقرأ العائلات اسمها كما تكتبه. نُبلَّغ بها ونضيفها إلى القائمة.',
  'Board': 'المجلس',
  'Group': 'المجموعة',
  'Name families read': 'الاسم الذي تقرؤه العائلات',
  'Code (optional)': 'الرمز (اختياري)',
  'Add it': 'أضفها',

  // Prices
  'Price lists in use': 'قوائم الأسعار المستخدمة',
  'List': 'القائمة',
  'Lines as printed': 'الأسطر كما طُبعت',
  'Not matched': 'غير مطابقة',
  'None yet in this session.': 'لا شيء بعد في هذه الجلسة.',
  'Paste a list as printed': 'الصق قائمة كما طُبعت',
  'Copy the board\'s fee list from the PDF or sheet and paste it as it is: one line per code, name and amount. Lines match your rows by code; old codes and two codes on one line are understood.': 'انسخ قائمة رسوم المجلس من ملف PDF أو الجدول والصقها كما هي: سطر لكل رمز واسم ومبلغ. تُطابَق الأسطر مع صفوفك بالرمز؛ وتُفهم الرموز القديمة ورمزان في سطر واحد.',
  'The board\'s fees for': 'رسوم المجلس لامتحانات',
  'Its name:': 'اسمها:',
  'The list, pasted': 'القائمة الملصقة',
  'Reading…': 'جارٍ القراءة…',
  'Read the list': 'اقرأ القائمة',
  'Discard': 'تجاهل',
  'Used:': 'استُخدمت:',
  'rows priced from': 'صفوف سُعّرت من',
  'Matched': 'المطابقة',
  'Code as printed': 'الرمز كما طُبع',
  'Name as printed': 'الاسم كما طُبع',
  'Amount': 'المبلغ',
  'Goes to': 'يذهب إلى',
  'Now': 'الآن',
  'same': 'نفسه',
  'No line matched a row of this session.': 'لم يطابق أي سطر صفًا في هذه الجلسة.',
  'To check': 'للمراجعة',
  'This line': 'هذا السطر',
  'Leave it out until the school confirms': 'استبعده حتى تؤكد المدرسة',
  'Not used': 'غير مستخدمة',
  'its subject or row is not offered in this session': 'مادته أو صفه غير معروض في هذه الجلسة',
  'not recognised: no subject on our lists has this code': 'غير معروف: لا مادة في قوائمنا بهذا الرمز',
  'no amount read on this line': 'لم يُقرأ مبلغ في هذا السطر',
  'Using…': 'جارٍ الاستخدام…',
  'Use these prices': 'استخدم هذه الأسعار',
  'One-paper rows that follow their subject, and sums of units, follow by themselves.': 'صفوف الورقة الواحدة التابعة لمادتها، ومجاميع الوحدات، تتبع تلقائيًا.',
  'Missing exam fees': 'رسوم امتحان ناقصة',
  'Every ticked row without an exam fee. A subject with a fee not set is not offered to families. Not set is not 0.': 'كل صف محدد بلا رسوم امتحان. المادة ذات الرسوم غير المحددة لا تُعرض على العائلات. غير محدد ليس صفرًا.',
  'Subject · row': 'المادة · الصف',
  'Fill it by': 'املأه عن طريق',
  'Amount (EGP)': 'المبلغ (جنيه)',
  'Every ticked row has its exam fee.': 'لكل صف محدد رسوم امتحانه.',
  'typing it, or…': 'كتابته، أو…',
  'typing it (no list we hold prints it)': 'كتابته (لا قائمة لدينا تطبعه)',
  'Course fees': 'رسوم المقرر',
  'The school\'s own fee, one per subject; a row may have its own in the subject\'s editor. Self study pays': 'رسوم المدرسة نفسها، واحدة لكل مادة؛ وقد يكون لصف رسومه الخاصة في محرر المادة. الدراسة الذاتية تدفع',
  'of it. 0 is a fee; empty is not set.': 'منها. الصفر رسوم؛ والفارغ غير محدد.',
  'Course fee (EGP)': 'رسوم المقرر (جنيه)',
  'Rows with their own': 'صفوف لها رسومها الخاصة',
  'from': 'من',
  'the sum of its units': 'مجموع وحداته',
  'the subject\'s fee (the board\'s rule)': 'رسوم المادة (قاعدة المجلس)',
  'a list of an earlier session': 'قائمة جلسة سابقة',
  'typed': 'مكتوبة',
  'Every exam fee': 'كل رسوم الامتحانات',
  'Exam fee': 'رسوم الامتحان',

  // What families agree to
  'Grade 10': 'الصف 10',
  'Grade 11': 'الصف 11',
  'Grade 12': 'الصف 12',
  'Graduates retaking': 'خريجون يعيدون',
  'Yes / no': 'نعم / لا',
  'Short text': 'نص قصير',
  'A choice': 'اختيار',
  'Declaration': 'الإقرار',
  'One text for the whole school, set by the admin; each family\'s agreement keeps a copy of it.': 'نص واحد للمدرسة كلها تحدده الإدارة؛ وتحتفظ موافقة كل عائلة بنسخة منه.',
  'Self study, grades and unpaid reservations': 'الدراسة الذاتية والصفوف الدراسية والحجوزات غير المدفوعة',
  'Self study pays': 'الدراسة الذاتية تدفع',
  'and the whole exam fee. Shown on every subject; a row may have its own amount.': 'ورسوم الامتحان كاملة. تظهر على كل مادة؛ وقد يكون لصف مبلغه الخاص.',
  'Grades that may reserve': 'الصفوف التي يحق لها الحجز',
  'on the payment due date': 'في موعد السداد',
  'or at the board\'s deadline, if that is earlier. Reminders go before.': 'أو في موعد المجلس إن كان أبكر. وتُرسل التذكيرات قبله.',
  'Refund policy': 'سياسة الاسترداد',
  'Of the course fee, counted from the first lesson. Families read the sentence below, made from these rows, so the words and the money cannot disagree.': 'من رسوم المقرر، محسوبة من أول درس. تقرأ العائلات الجملة أدناه المصنوعة من هذه الصفوف، فلا تختلف الكلمات عن المال.',
  'Fixed: a family has agreed to it': 'ثابتة: وافقت عليها عائلة',
  'From week': 'من الأسبوع',
  'Up to': 'حتى',
  'Then to': 'ثم حتى',
  'of the course fee back': 'من رسوم المقرر تُسترد',
  'Remove': 'إزالة',
  'Add a step': 'أضف خطوة',
  'Save the policy': 'احفظ السياسة',
  'Undo': 'تراجع',
  'Families read:': 'تقرأ العائلات:',
  'Extra questions': 'أسئلة إضافية',
  'Optional. The answers go into the reservations export; they never change a price or who may reserve.': 'اختيارية. تدخل الإجابات في تصدير الحجوزات؛ ولا تغيّر سعرًا أو من يحق له الحجز.',
  'asked with every reservation': 'تُسأل مع كل حجز',
  'asked with': 'تُسأل مع',
  'None.': 'لا شيء.',
  'Asked': 'تُسأل',
  'with every reservation': 'مع كل حجز',
  'Answer': 'الإجابة',
  'Question': 'السؤال',
  'e.g. Will the student bring their own calculator?': 'مثال: هل سيحضر الطالب آلته الحاسبة؟',
  'Choices, one per line': 'الخيارات، واحد في كل سطر',
  'Add the question': 'أضف السؤال',

  // Reservations
  'The export did not download; nothing is lost. Try again.': 'لم يُنزَّل التصدير؛ لم يضع شيء. حاول مرة أخرى.',
  'No reservations yet.': 'لا حجوزات بعد.',
  'A draft is invisible to families.': 'المسودة لا تراها العائلات.',
  'student': 'طالب',
  'students': 'طلاب',
  'Read only: payments are the finance desk\'s.': 'للقراءة فقط: المدفوعات من شأن مكتب المالية.',
  'Export (CSV)': 'تصدير (CSV)',
  'Student': 'الطالب',
  'What': 'ماذا',
  'Teacher': 'المعلم',
  'Earlier exam': 'الامتحان السابق',
  'Price': 'السعر',
  'Status': 'الحالة',
  'Answers': 'الإجابات',
  'to be announced': 'سيُعلن لاحقًا',
  'self study': 'دراسة ذاتية',
  'declared': 'مُصرَّح به',
  'Paid': 'مدفوع',
  'Waiting for payment': 'بانتظار الدفع',
  'not final': 'غير نهائي',
  '“Earlier exam” is what the family declared for a one-paper retake or an A.2.: listed for anyone who wants to check it.': '«الامتحان السابق» هو ما صرّحت به العائلة لإعادة ورقة واحدة أو A.2.: مدرج لمن يريد التحقق منه.',

  // The subject editor
  'This subject accepts reservations': 'هذه المادة تقبل الحجوزات',
  'Closes on': 'تُغلق في',
  'Closing stops new reservations; waiting ones can still be paid.': 'الإغلاق يوقف الحجوزات الجديدة؛ ويمكن دفع المنتظرة.',
  'To look at (from the check list)': 'للمراجعة (من قائمة المراجعة)',
  'Save': 'حفظ',
  'Undo the changes': 'تراجع عن التغييرات',
  'Changes not saved yet.': 'تغييرات لم تُحفظ بعد.',
  'Saved.': 'محفوظ.',
  'Remove this subject': 'أزل هذه المادة',
  'What families see': 'ما تراه العائلات',
  'It leaves this session with its rows, teachers and questions. A subject families reserved stays: switch it off instead.': 'تخرج من هذه الجلسة بصفوفها ومعلميها وأسئلتها. المادة التي حجزتها عائلات تبقى: أوقفها بدلًا من ذلك.',
  'Remove it': 'أزلها',
  'What can be entered, and how it is studied': 'ما يمكن القيد فيه، وكيف يُدرس',
  'Tick the rows the school offers, and how each is studied. The rows come from': 'حدد الصفوف التي تقدمها المدرسة، وكيف يُدرس كل منها. الصفوف من قائمة',
  '\'s list for this subject.': 'لهذه المادة.',
  'Course fee — the subject\'s (EGP)': 'رسوم المقرر — للمادة (جنيه)',
  'of the course fee (the session\'s share) and the whole exam fee. A row may have its own course fee. Empty is not set; 0 is a fee.': 'من رسوم المقرر (نسبة الجلسة) ورسوم الامتحان كاملة. قد يكون لصف رسوم مقرر خاصة. الفارغ غير محدد؛ والصفر رسوم.',
  'Offered': 'معروض',
  'Row': 'الصف',
  'Exam fee (EGP)': 'رسوم الامتحان (جنيه)',
  'Its own course fee (EGP)': 'رسوم المقرر الخاصة به (جنيه)',
  'The subject\'s course fee (EGP)': 'رسوم المقرر للمادة (جنيه)',
  'Ringed ticks were made by a default, not by your form. Saving says they look right.': 'التحديدات المحاطة بإطار جاءت افتراضيًا لا من نموذجك. الحفظ يعني أنها تبدو صحيحة.',
  'Open the subject to see it and save it there.': 'افتح المادة لتراه واحفظه هناك.',
  'e.g. Paper 3 only': 'مثال: الورقة 3 فقط',
  'Its exam fee (EGP)': 'رسوم امتحانه (جنيه)',
  'Add the row': 'أضف الصف',
  '+ Add a row not on the list': '+ أضف صفًا ليس في القائمة',
  'Retake in school starts ticked wherever first entry in school is: on your forms a retaker may pick a teacher. Untick it where the school does not offer it.': 'تبدأ «إعادة في المدرسة» محددة حيثما كان «قيد أول في المدرسة»: في نماذجك يمكن لمن يعيد أن يختار معلمًا. ألغِ تحديدها حيث لا تقدمها المدرسة.',
  'from a price list': 'من قائمة أسعار',
  'a retake of one paper; the others carried from an earlier exam': 'إعادة ورقة واحدة؛ والبقية منقولة من امتحان سابق',
  'a retake of one paper': 'إعادة ورقة واحدة',
  'carries the A.S. from an earlier exam': 'ينقل نتيجة A.S. من امتحان سابق',
  'not on the list': 'ليس في القائمة',
  'exam in January': 'الامتحان في يناير',
  'exam in November': 'الامتحان في نوفمبر',
  'Fewer options': 'خيارات أقل',
  'More options': 'خيارات أخرى',
  'A one-paper row is a retake': 'صف الورقة الواحدة إعادة',
  'the subject\'s: not set': 'رسوم المادة: غير محددة',
  'the subject\'s:': 'رسوم المادة:',
  'its own': 'خاصة به',
  '— not taught this cycle': '— لا تُدرَّس هذا الموسم',
  'its own amount': 'مبلغه الخاص',
  'Teachers for this row': 'معلمو هذا الصف',
  'as the subject': 'كالمادة',
  'Add…': 'إضافة…',
  'Exam in': 'الامتحان في',
  'Pay by': 'السداد قبل',
  'Families taking it say which earlier exam it follows, from the subject\'s list below.': 'العائلات التي تختاره تحدد الامتحان السابق الذي يتبعه، من قائمة المادة أدناه.',
  'does not ask which earlier exam a one-paper retake follows.': 'لا يسأل عن الامتحان السابق الذي تتبعه إعادة الورقة الواحدة.',
  'new': 'جديد',
  'online': 'عبر الإنترنت',
  'Teachers': 'المعلمون',
  'No teacher yet.': 'لا معلم بعد.',
  'Add a teacher': 'أضف معلمًا',
  'Add the teacher': 'أضف المعلم',
  'Add a teacher…': 'أضف معلمًا…',
  'The school\'s teachers': 'معلمو المدرسة',
  'A new teacher…': 'معلم جديد…',
  'Name as families will read it': 'الاسم كما ستقرؤه العائلات',
  'The new teacher\'s name': 'اسم المعلم الجديد',
  'Is this one of the school\'s teachers?': 'هل هذا أحد معلمي المدرسة؟',
  'Use': 'استخدم',
  'No:': 'لا:',
  'is someone new': 'شخص جديد',
  'Teacher to be confirmed': 'المعلم لم يُؤكَّد بعد',
  'families read “teacher to be announced”': 'تقرأ العائلات «سيُعلن عن المعلم لاحقًا»',
  'Who picks the teacher': 'من يختار المعلم',
  'Families choose (one is preselected)': 'العائلات تختار (واحد محدد مسبقًا)',
  'The school assigns': 'المدرسة تعيّن',
  'Earlier exams': 'الامتحانات السابقة',
  'does not ask which earlier exam a one-paper retake follows, so families are not asked.': 'لا يسأل عن الامتحان السابق الذي تتبعه إعادة الورقة الواحدة، فلا تُسأل العائلات.',
  'Earlier exams a retake carries from': 'الامتحانات السابقة التي تُنقل منها الإعادة',
  'Asked of a family taking': 'تُسأل العائلة التي تختار',
  ': they pick the exam they sat from this list. A student the school knows sat it has it filled in.': ': تختار الامتحان الذي جلس له الطالب من هذه القائمة. ويُملأ للطالب الذي تعرف المدرسة أنه جلس له.',
  'It stays, since your list wins; the board may refuse the entry.': 'يبقى لأن قائمتك هي المعتمدة؛ وقد يرفض المجلس القيد.',
  'Add an older earlier exam': 'أضف امتحانًا سابقًا أقدم',
  'Add an older one…': 'أضف امتحانًا أقدم…',
  'For families': 'للعائلات',
  'Note on the subject': 'ملاحظة على المادة',
  'e.g. Taught on Saturdays.': 'مثال: تُدرَّس أيام السبت.',
  'Extra questions for this subject': 'أسئلة إضافية لهذه المادة',
  'e.g. Which calculator will the student use?': 'مثال: أي آلة حاسبة سيستخدم الطالب؟',
  'Preview as': 'معاينة كـ',
  'A first-time student': 'طالب لأول مرة',
  'A retaker': 'طالب يعيد',
  'A student the school knows sat this subject: retake choices only, that exam filled in.': 'طالب تعرف المدرسة أنه جلس لهذه المادة: خيارات الإعادة فقط، وذلك الامتحان مملوء.',
  'A student with no earlier exam on record: first entries; a retake is declared, as on your forms.': 'طالب بلا امتحان سابق مسجل: القيد الأول؛ ويُصرَّح بالإعادة كما في نماذجك.',
  'Changes not saved yet: the preview shows the saved subject.': 'تغييرات لم تُحفظ بعد: تعرض المعاينة المادة المحفوظة.',
  'Switched off: families do not see it.': 'متوقفة: لا تراها العائلات.',
  'Not offered to families until every price is set.': 'لا تُعرض على العائلات حتى تُحدَّد كل الأسعار.',
  'Nothing to choose: no row is ticked.': 'لا شيء للاختيار: لا صف محدد.',
  'One of': 'واحد من',
  'price not set': 'السعر غير محدد',
  'Teacher, to choose:': 'المعلم، للاختيار:',
  'Teacher:': 'المعلم:',
  'teacher to be announced': 'سيُعلن عن المعلم لاحقًا',
  'Sat in': 'جلس له في',
  'When did you sit it?': 'متى جلست له؟',
  'Sat it before? Show retake choices': 'جلس له من قبل؟ اعرض خيارات الإعادة',

  // The API's refusals she can meet, in her words (herWords runs first)
  'What this change does to families changed while you were looking: look at the new counts and save again': 'تغيّر ما يفعله هذا التعديل بالعائلات أثناء المراجعة: راجع الأعداد الجديدة واحفظ مرة أخرى',
  'The close date must be in the future (switch Accepting off to close it now)': 'يجب أن يكون تاريخ الإغلاق في المستقبل (أوقف قبول الحجوزات للإغلاق الآن)',
  'A family has consented to this session\'s refund policy: it can no longer change (an exception changes one student\'s)': 'وافقت عائلة على سياسة الاسترداد لهذه الجلسة: لم يعد تغييرها ممكنًا (الاستثناء يغيّرها لطالب واحد)',
  'Families have reserved in this session: its prices stay final (a price changed later re-prices the unpaid lines and lists the paid ones for finance)': 'حجزت عائلات في هذه الجلسة: تبقى أسعارها نهائية (تغيير سعر لاحقًا يعيد تسعير غير المدفوع ويدرج المدفوع للمالية)',
  'Nothing to change': 'لا شيء للتغيير',
  'A one-paper row is always a retake: it takes no first entry': 'صف الورقة الواحدة إعادة دائمًا: لا يقبل قيدًا أول',
  'A custom row has a name': 'للصف الخاص اسم',
  'The board\'s entry deadline must be in the future': 'يجب أن يكون آخر موعد للقيد لدى المجلس في المستقبل',
  'The retake deadline cannot be before the entry deadline': 'لا يمكن أن يسبق آخر موعد لقيد الإعادة آخر موعد للقيد',
  'Another session of this type and year is already open: close it first': 'جلسة أخرى من هذا النوع والسنة مفتوحة بالفعل: أغلقها أولًا',

  // Her Home
  'Welcome back,': 'مرحبًا بعودتك،',
  'Your sessions, and what to do in each before it opens.': 'جلساتك، وما يلزم في كل منها قبل فتحها.',
  'All sessions': 'كل الجلسات',
  'Reading the sessions…': 'جارٍ قراءة الجلسات…',
  'The sessions did not load; nothing is lost. Try again.': 'لم تُحمَّل الجلسات؛ لم يضع شيء. حاول مرة أخرى.',
  'No session is open or being prepared.': 'لا جلسة مفتوحة أو قيد الإعداد.',
  'Start the next one: copy the last session of its type, and its subjects, teachers and policy come across.': 'ابدأ الجلسة التالية: انسخ آخر جلسة من نوعها، فتنتقل موادها ومعلموها وسياستها.',
  'What families are doing:': 'ما تفعله العائلات:',
};

/** Her screens' sentences that carry a number, a name or a date (aria-labels and options among them). */
export function translateSetupText(text: string): string | null {
  let m: RegExpExecArray | null;
  const cell = '(First entry in school|Retake in school|Retake self study|First entry self study)';
  // A subject's or a row's control, named with it ("Arabic O.L.: course fee", "Unit 5 (WBI15): Retake self study").
  if ((m = /^(.+): accepting reservations$/.exec(text))) return `${m[1]}: يقبل الحجوزات`;
  if ((m = /^(.+): course fee$/.exec(text))) return `${m[1]}: رسوم المقرر`;
  if ((m = /^(.+): exam fee$/.exec(text))) return `${m[1]}: رسوم الامتحان`;
  if ((m = /^(.+): fill it by$/.exec(text))) return `${m[1]}: املأه عن طريق`;
  if ((m = /^(.+): its own course fee$/.exec(text))) return `${m[1]}: رسوم مقرر خاصة به`;
  if ((m = /^(.+): self-study course amount$/.exec(text))) return `${m[1]}: مبلغ الدراسة الذاتية`;
  if ((m = new RegExp(`^${cell}: tick or untick every offered row$`).exec(text))) return `${CELL_AR[m[1]!]}: حدد أو ألغِ التحديد لكل الصفوف المعروضة`;
  if ((m = new RegExp(`^(.+): ${cell}$`).exec(text))) return `${m[1]}: ${CELL_AR[m[2]!]}`;
  if ((m = new RegExp(`^(.+): ${cell} \\(ticked by a default\\)$`).exec(text))) return `${m[1]}: ${CELL_AR[m[2]!]} (محدد افتراضيًا)`;
  if ((m = /^Offer (.+) to families$/.exec(text))) return `اعرض ${m[1]} على العائلات`;
  if ((m = /^(.+): online$/.exec(text))) return `${m[1]}: عبر الإنترنت`;
  if ((m = /^(.+): external team$/.exec(text))) return `${m[1]}: فريق خارجي`;
  if ((m = /^Remove the teacher (.+)$/.exec(text))) return `إزالة المعلم ${m[1]}`;
  if ((m = /^Remove the question: (.+)$/.exec(text))) return `إزالة السؤال: ${m[1]}`;
  if ((m = /^Add a teacher to (.+)$/.exec(text))) return `أضف معلمًا إلى ${m[1]}`;
  if ((m = /^with (.+ (?:O\.L\.|A\.S\.\/A\.L\.))$/.exec(text))) return `مع ${m[1]}`;
  if ((m = /^Remove (.+ (?:O\.L\.|A\.S\.\/A\.L\.))$/.exec(text))) return `إزالة ${m[1]}`;
  // The refund policy's rows.
  if ((m = /^week (\d+)$/.exec(text))) return `الأسبوع ${m[1]}`;
  if ((m = /^Step (\d+): up to week$/.exec(text))) return `الخطوة ${m[1]}: حتى الأسبوع`;
  if ((m = /^Step (\d+): refund$/.exec(text))) return `الخطوة ${m[1]}: الاسترداد`;
  if ((m = /^From week (\d+): refund$/.exec(text))) return `من الأسبوع ${m[1]}: الاسترداد`;
  if ((m = /^Remove step (\d+)$/.exec(text))) return `أزل الخطوة ${m[1]}`;
  // The share, the cancel days.
  if ((m = /^(\d+)% of the course fee$/.exec(text))) return `${m[1]}% من رسوم المقرر`;
  if ((m = /^the session's (\d+)% of the course fee$/.exec(text))) return `نسبة الجلسة ${m[1]}% من رسوم المقرر`;
  if ((m = /^(\d+) days? after the payment due date$/.exec(text))) return `بعد ${m[1]} ${m[1] === '1' ? 'يوم' : 'أيام'} من موعد السداد`;
  // New session's "start from"; closing a session.
  if ((m = /^Copy the last (June|November \/ January) session \((.+)\)$/.exec(text))) return `انسخ آخر جلسة ${m[1] === 'June' ? 'يونيو' : 'نوفمبر / يناير'} (${months(m[2]!)})`;
  if ((m = /^Close ((?:June|November) \d{4}.*)$/.exec(text))) return `إغلاق ${months(m[1]!)}`;
  if ((m = /^Create ((?:June|November) \d{4}.*)$/.exec(text))) return `إنشاء ${months(m[1]!)}`;
  if ((m = /^Open ((?:June|November) \d{4}.*)$/.exec(text))) return `فتح ${months(m[1]!)}`;
  // A session's name ("November 2027 – January 2028").
  if ((m = /^November (\d{4}) – January (\d{4})$/.exec(text))) return `نوفمبر ${m[1]} – يناير ${m[2]}`;
  // Prices: a line in doubt, what fills a missing fee, a board's deadline waited on.
  if ((m = /^Use it: (.+)$/.exec(text))) return `استخدمه: ${m[1]}`;
  if ((m = /^Copy from (.+): ([\d.,]+)$/.exec(text))) return `انسخ من ${months(m[1]!)}: ${m[2]}`;
  if ((m = /^Sum of its units: ([\d.,]+)$/.exec(text))) return `مجموع وحداته: ${m[1]}`;
  if ((m = /^The subject's fee \(the board's rule\): ([\d.,]+)$/.exec(text))) return `رسوم المادة (قاعدة المجلس): ${m[1]}`;
  if ((m = /^(.+)'s entry deadline \(the admin\)$/.exec(text))) return `آخر موعد للقيد لدى ${m[1]} (الإدارة)`;
  // The check list's counted lines.
  if ((m = /^(\d+) of (\d+) subjects are not offered to families: a price is not set \((\d+) course fees?, (\d+) exam fees?\)\.$/.exec(text))) {
    return `${m[1]} من ${m[2]} مادة لا تُعرض على العائلات: سعر غير محدد (${m[3]} رسوم مقرر، ${m[4]} رسوم امتحان).`;
  }
  if ((m = /^Ticked by a default, not by your forms: (\d+) ticks? on (\d+) subjects?\.$/.exec(text))) return `محدد افتراضيًا، لا من نماذجك: ${m[1]} تحديد في ${m[2]} مادة.`;
  if ((m = /^(.+) after (.+)'s entry deadline \((.+)\): (\d+) rows?\.$/.exec(text))) {
    const late: Record<string, string> = {
      'reservations close': 'إغلاق الحجز', 'payment is due': 'موعد السداد', 'unpaid reservations are cancelled': 'إلغاء الحجوزات غير المدفوعة',
      'the row closes': 'إغلاق الصف', 'the row is due': 'موعد سداد الصف',
    };
    const what = m[1]!.split(/, | and /).map((x) => late[x] ?? x).join('، و');
    return `${what} بعد آخر موعد للقيد لدى ${m[2]} (${months(m[3]!)}): ${m[4]} صف.`;
  }
  if ((m = /^(\w+ \d{4}) is (\d+) months before this exam: older than (.+) carries a result forward \((\d+) months\)\.$/.exec(text))) {
    return `${months(m[1]!)} قبل هذا الامتحان بـ${m[2]} شهرًا: أقدم مما ينقله ${m[3]} من النتائج (${m[4]} شهرًا).`;
  }
  // The impact before saving (impactSentence, @repo/validations): each part it can say, joined.
  if (text === 'This changes nothing for families.') return 'هذا لا يغيّر شيئًا للعائلات.';
  if ((m = /^This (.+)\.$/.exec(text))) {
    const parts = m[1]!.split(/(?:, | and )(?=(?:re-prices|lists|changes|moves) )/);
    const said = parts.map((p) => {
      let x: RegExpExecArray | null;
      if ((x = /^re-prices (\d+) unpaid reservations? \(the families are told\)$/.exec(p))) return `يعيد تسعير ${x[1]} حجز غير مدفوع (تُبلَّغ العائلات)`;
      if ((x = /^lists (\d+) paid reservations? for finance \(their price stays\)$/.exec(p))) return `يدرج ${x[1]} حجز مدفوع للمالية (يبقى سعرها)`;
      if ((x = /^changes (\d+) reservations? \(made payable, or closed to new ones\)$/.exec(p))) return `يغيّر ${x[1]} حجز (يصبح قابلًا للدفع، أو يُغلق أمام الجديد)`;
      if ((x = /^moves the due date of (\d+) unpaid reservations?$/.exec(p))) return `ينقل موعد سداد ${x[1]} حجز غير مدفوع`;
      return null;
    });
    if (said.every((x) => x !== null)) return `هذا ${said.join('، و')}.`;
  }
  // The API's refusals with a name or a count (after herWords).
  if ((m = /^(.+): (\d+) reservations? use the (first entry in school|retake in school|retake in self study|first entry in self study) option — it stays ticked; close the row to stop new ones$/.exec(text))) {
    const opt: Record<string, string> = { 'first entry in school': 'قيد أول في المدرسة', 'retake in school': 'إعادة في المدرسة', 'retake in self study': 'إعادة دراسة ذاتية', 'first entry in self study': 'قيد أول دراسة ذاتية' };
    return `${m[1]}: ${m[2]} حجز يستخدم خيار «${opt[m[3]!]}» — يبقى محددًا؛ أغلق الصف لإيقاف الحجوزات الجديدة`;
  }
  if ((m = /^(.+) has reservations in this session: close it instead \(they stand\)$/.exec(text))) return `لدى ${m[1]} حجوزات في هذه الجلسة: أوقفها بدلًا من ذلك (تبقى الحجوزات)`;
  if ((m = /^(.+) has (\d+) reservations?: a row with reservations is not removed — close it instead \(they stand\)$/.exec(text))) return `لدى ${m[1]} ${m[2]} حجز: الصف الذي عليه حجوزات لا يُزال — أغلقه بدلًا من ذلك (تبقى الحجوزات)`;
  if ((m = /^(.+) has reservations in its exam month: a row's exam month does not change while reservations use it — close the row and add another$/.exec(text))) return `لدى ${m[1]} حجوزات في شهر امتحانه: لا يتغير شهر امتحان الصف ما دامت الحجوزات تستخدمه — أغلق الصف وأضف آخر`;
  if ((m = /^(.+) is already in this session$/.exec(text))) return `${m[1]} موجودة بالفعل في هذه الجلسة`;
  if ((m = /^(.+) is already under (.+): a row is added once$/.exec(text))) return `${m[1]} موجود بالفعل في ${m[2]}: يُضاف الصف مرة واحدة`;
  if ((m = /^"(.+)" has answers: it is kept with them \(change its words instead\)$/.exec(text))) return `«${m[1]}» له إجابات: يبقى معها (غيّر كلماته بدلًا من ذلك)`;
  if ((m = /^(.+) cannot open yet: (.+)$/.exec(text))) return `لا يمكن فتح ${months(m[1]!)} بعد: ${m[2]}`;
  if ((m = /^(.+) is closed: reopen it to change it$/.exec(text))) return `${months(m[1]!)} مغلقة: أعد فتحها لتغييرها`;
  return null;
}
