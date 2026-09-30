/**
 * Arabic for the F4 candidates screens (see index.ts for the words used): exact
 * English text → Arabic, and rules for sentences with a name, a number, a
 * code or a date in them.
 *
 * Covers the candidate register (/exams/candidates: the table, a candidate's
 * panel, the ID document, candidate numbers) and the deadlines dashboard
 * (/exams/deadlines), with the API's sentences both screens show. Access
 * arrangements are ترتيبات الإتاحة (as shared.ts); the ID document وثيقة الهوية;
 * a candidate number رقم المرشح; the hard stop الحد النهائي (as F0b's series
 * screen). UCI stays UCI: it is the board's own name for the identifier.
 */
import type { Rule } from './index';

/** "8 days", "two days", "11 days" with the noun Arabic counts take. */
function arabicDays(n: number): string {
  if (n === 1) return 'يوم واحد';
  if (n === 2) return 'يومين';
  if (n >= 3 && n <= 10) return `${n} أيام`;
  return `${n} يومًا`;
}

export const candidatesArabic: Record<string, string> = {
  // ── The candidate register ──
  'Candidates': 'المرشحون',
  "What the exam boards ask of each candidate: the name exactly as on the ID, date of birth, gender, Pearson's UCI, access arrangements, the ID document and a candidate number in each series. Fix the gaps before the entry deadline.":
    'ما تطلبه مجالس الامتحانات عن كل مرشح: الاسم كما في الهوية تمامًا، وتاريخ الميلاد، والنوع، ورقم UCI لدى Pearson، وترتيبات الإتاحة، ووثيقة الهوية، ورقم مرشح في كل دورة. أكمل النواقص قبل آخر موعد للقيد.',
  'candidate': 'مرشح',
  'Name, student ID, UCI, email or legal name': 'الاسم أو رقم الطالب أو UCI أو البريد أو الاسم كما في الهوية',
  'All candidates': 'كل المرشحين',
  'Download CSV': 'تنزيل CSV',
  'Enter opens the first candidate; the arrow keys move through the list.': 'يفتح Enter أول مرشح؛ وتتنقل الأسهم في القائمة.',
  'What the boards still need': 'ما تحتاجه المجالس بعد',
  'Still needed:': 'ما زال مطلوبًا:',
  'Everyone': 'الجميع',
  'No legal name': 'لا يوجد الاسم كما في الهوية',
  'No gender': 'لا يوجد النوع',
  'No UCI': 'لا يوجد UCI',
  'No candidate number': 'لا يوجد رقم مرشح',
  'No ID document': 'لا توجد وثيقة هوية',
  'Candidates entered in this series or with a confirmed registration in it, with their candidate number there:':
    'المرشحون المقيدون في هذه الدورة أو الذين لهم تسجيل مؤكد فيها، مع رقم المرشح فيها:',
  'Every student in grades 10 to 12 today, and anyone else with an exam entry. Choose a series to see and assign candidate numbers.':
    'كل طالب في الصفوف من 10 إلى 12 اليوم، وكل من له قيد امتحان. اختر دورة لعرض أرقام المرشحين وإسنادها.',
  'Loading the candidates…': 'جارٍ تحميل المرشحين…',
  'The candidates did not load': 'لم يتم تحميل المرشحين',
  'No candidate matches': 'لا يوجد مرشح مطابق',
  'No candidates yet': 'لا يوجد مرشحون بعد',
  'Clear the search or the filter to see everyone.': 'امسح البحث أو التصفية لعرض الجميع.',
  'Nobody is entered in this series or has a confirmed registration in it yet. Confirmed registrations appear here; so do entries added on the Entries screen.':
    'لا أحد مقيد في هذه الدورة أو له تسجيل مؤكد فيها بعد. تظهر هنا التسجيلات المؤكدة، وكذلك القيود المضافة من شاشة القيود.',
  'Students in grades 10 to 12 appear here once their grade is recorded on the Students screen.':
    'يظهر هنا طلاب الصفوف من 10 إلى 12 بمجرد تسجيل صفهم في شاشة الطلاب.',
  'Clear the filters': 'مسح عوامل التصفية',
  'Legal name as on ID': 'الاسم كما في الهوية',
  'Date of birth': 'تاريخ الميلاد',
  'Gender': 'النوع',
  'UCI': 'UCI',
  'Access arrangements': 'ترتيبات الإتاحة',
  'ID document': 'وثيقة الهوية',
  'Missing': 'ناقص',
  'Left the school': 'غادر المدرسة',
  'exam entry': 'قيد امتحان',
  'exam entries': 'قيود امتحانات',
  'No board approval': 'دون موافقة المجلس',
  'Approval expired': 'انتهت الموافقة',
  'Recorded': 'مسجلة',

  // ── Assigning candidate numbers ──
  'Candidate numbers in': 'أرقام المرشحين في',
  "Everyone in this series without a number gets one: the number they had in this board's last series where it is still free, otherwise the lowest free number. You see who gets which number before anything is saved.":
    'يحصل كل من ليس له رقم في هذه الدورة على رقم: الرقم الذي كان له في آخر دورة لهذا المجلس إن كان ما زال متاحًا، وإلا فأصغر رقم متاح. ترى من يحصل على أي رقم قبل حفظ أي شيء.',
  'Assign candidate numbers': 'إسناد أرقام المرشحين',
  'Candidate numbers assigned:': 'أرقام المرشحين المُسندة:',
  'Every candidate in this series already has a number; nothing changed.': 'لكل مرشح في هذه الدورة رقم بالفعل؛ لم يتغير شيء.',
  'Every candidate in this series already has a number.': 'لكل مرشح في هذه الدورة رقم بالفعل.',
  'numbered.': 'لهم أرقام.',
  'No centre number is recorded for this board. The numbers can be assigned, but every entry list row is flagged until it is set.':
    'لا يوجد رقم مركز مسجل لهذا المجلس. يمكن إسناد الأرقام، لكن كل صف في قائمة القيد يُعلَّم حتى يُسجَّل.',
  'Open Settings': 'فتح الإعدادات',
  'candidates get a number': 'مرشحين يحصلون على رقم',
  'already have one': 'لهم رقم بالفعل',
  'Where the number comes from': 'مصدر الرقم',
  "Kept from the board's last series": 'محفوظ من آخر دورة للمجلس',
  'Next free number': 'أول رقم متاح',
  'Assign these numbers': 'إسناد هذه الأرقام',

  // ── A candidate's panel ──
  'Loading the candidate…': 'جارٍ تحميل المرشح…',
  'The candidate did not load': 'لم يتم تحميل المرشح',
  'This is a connection problem. Try again.': 'هذه مشكلة في الاتصال. حاول مرة أخرى.',
  'See entries': 'عرض القيود',
  "The candidate's details": 'بيانات المرشح',
  'As on the ID document': 'كما في وثيقة الهوية',
  'Type the name exactly as the passport or national ID writes it, in English letters: the board prints it on the certificate.':
    'اكتب الاسم تمامًا كما يكتبه جواز السفر أو بطاقة الرقم القومي، بحروف إنجليزية: يطبعه المجلس على الشهادة.',
  'Forenames (as on the ID)': 'الأسماء الأولى (كما في الهوية)',
  'Surname (as on the ID)': 'اسم العائلة (كما في الهوية)',
  'UCI (Pearson)': 'UCI (Pearson)',
  "Board's approval reference": 'مرجع موافقة المجلس',
  'Approval expires': 'تنتهي الموافقة في',
  'Pearson requires a UCI for this candidate.': 'تشترط Pearson رقم UCI لهذا المرشح.',
  "Pearson's Unique Candidate Identifier: 13 characters, the same for life. Once recorded it is permanent; a correction asks why.":
    'المعرّف الفريد للمرشح لدى Pearson: 13 حرفًا ورقمًا، ثابت مدى الحياة. بعد تسجيله يصبح دائمًا؛ ويُطلب سبب لأي تصحيح.',
  'Why the UCI is being corrected': 'سبب تصحيح رقم UCI',
  "e.g. mistyped from last year's statement of entry": 'مثلًا: كُتب خطأ من بيان القيد للعام الماضي',
  'Recorded now:': 'المسجل الآن:',
  'The correction and its reason go in the audit log.': 'يُسجَّل التصحيح وسببه في سجل التدقيق.',
  "Only what the board has approved. Extra time lengthens every paper on the candidate's timetable.":
    'فقط ما وافق عليه المجلس. الوقت الإضافي يطيل كل ورقة في جدول المرشح.',
  "Without the board's approval reference, the entry list flags these arrangements and the deadlines dashboard counts them as outstanding.":
    'دون مرجع موافقة المجلس، تُعلِّم قائمة القيد هذه الترتيبات وتعدّها لوحة المواعيد من الأعمال المتبقية.',
  "The board's approval has expired: apply for it again and record the new reference.":
    'انتهت موافقة المجلس: قدّم الطلب مرة أخرى وسجّل المرجع الجديد.',
  'Say why the UCI is being corrected: it is permanent, and the reason is recorded.':
    'اذكر سبب تصحيح رقم UCI: فهو دائم، ويُسجَّل السبب.',
  'Saved:': 'تم حفظ:',
  'Nothing had changed, so nothing was saved.': 'لم يتغير شيء، فلم يُحفظ شيء.',
  'change not saved yet': 'تغيير لم يُحفظ بعد',
  'changes not saved yet': 'تغييرات لم تُحفظ بعد',
  'Undo changes': 'تراجع عن التغييرات',
  'Save the details': 'حفظ البيانات',

  // ── The ID document ──
  'The national ID or passport the name is checked against. Only the coordinator and the admin can see the number; each look is recorded.':
    'بطاقة الرقم القومي أو جواز السفر الذي يُطابَق عليه الاسم. لا يرى الرقم إلا المنسق والمدير؛ وتُسجَّل كل مشاهدة.',
  'Show number': 'إظهار الرقم',
  'Change ID document': 'تغيير وثيقة الهوية',
  'No ID document recorded': 'لا توجد وثيقة هوية مسجلة',
  'Record ID document': 'تسجيل وثيقة الهوية',
  'This view is recorded in the audit log.': 'هذه المشاهدة مسجلة في سجل التدقيق.',
  'Hidden again in': 'يُخفى مرة أخرى بعد',
  'seconds': 'ثانية',
  'Recorded by': 'سجّلها',
  'Hide now': 'إخفاء الآن',
  'Document': 'الوثيقة',
  'Number': 'الرقم',
  'An Egyptian national ID is 14 digits, starting with 2 or 3; a passport number is 5 to 20 letters and digits. Copy it from the document itself.':
    'الرقم القومي المصري 14 رقمًا ويبدأ بـ 2 أو 3؛ ورقم جواز السفر من 5 إلى 20 حرفًا ورقمًا. انقله من الوثيقة نفسها.',
  'Save the ID document': 'حفظ وثيقة الهوية',
  'Check the number against the document': 'راجع الرقم على الوثيقة',
  'ID document recorded:': 'سُجلت وثيقة الهوية:',
  'That document is already recorded; nothing changed.': 'هذه الوثيقة مسجلة بالفعل؛ لم يتغير شيء.',

  // ── Candidate numbers ──
  'Candidate numbers': 'أرقام المرشح',
  'One number per series; the boards like a candidate to keep the same one.': 'رقم واحد لكل دورة؛ وتفضّل المجالس أن يحتفظ المرشح بالرقم نفسه.',
  'Set a number by hand': 'تحديد رقم يدويًا',
  'No candidate number and no entry in any series yet.': 'لا يوجد رقم مرشح ولا قيد في أي دورة بعد.',
  'Another series': 'دورة أخرى',
  'Assigned by the school': 'أسندته المدرسة',
  'Set by hand': 'حُدد يدويًا',
  'Imported': 'مستورد',
  'Centre': 'المركز',
  'No number': 'لا يوجد رقم',
  'Set': 'تحديد',
  "That is already the candidate's number in this series.": 'هذا هو رقم المرشح في هذه الدورة بالفعل.',
  'Why the number changes': 'سبب تغيير الرقم',
  'e.g. the board issued another number': 'مثلًا: أصدر المجلس رقمًا آخر',
  'Once entries with it have gone to a board that fixes numbers, it cannot change.':
    'بعد إرسال قيود به إلى مجلس يثبّت الأرقام، لا يمكن تغييره.',
  'Save the number': 'حفظ الرقم',
  'Candidate number saved:': 'تم حفظ رقم المرشح:',

  // ── The API's sentences on these screens ──
  'No ID document is recorded for this candidate': 'لا توجد وثيقة هوية مسجلة لهذا المرشح',
  'This document number is already recorded for another candidate — check it against the document':
    'رقم الوثيقة هذا مسجل بالفعل لمرشح آخر - راجعه على الوثيقة',
  'The ID document could not be saved': 'تعذر حفظ وثيقة الهوية',
  'An Egyptian national ID is 14 digits, starting with 2 or 3': 'الرقم القومي المصري 14 رقمًا ويبدأ بـ 2 أو 3',
  'A passport number is 5 to 20 letters and digits': 'رقم جواز السفر من 5 إلى 20 حرفًا ورقمًا',
  'A UCI is 13 characters: the 5-digit centre number, a letter or digit, the 2-digit year, a 4-digit number and a check character':
    'رقم UCI من 13 خانة: رقم المركز من 5 أرقام، ثم حرف أو رقم، ثم السنة برقمين، ثم رقم من 4 أرقام، ثم خانة تحقق',
  'A candidate number is four digits': 'رقم المرشح أربعة أرقام',
  'Say why the candidate number changes': 'اذكر سبب تغيير رقم المرشح',
  'No candidate numbers are left in this series': 'لم تتبقَّ أرقام مرشحين في هذه الدورة',
  'Board series not found': 'دورة المجلس غير موجودة',
  'Student not found': 'الطالب غير موجود',
  'Forbidden': 'غير مسموح',
  'Failed to load the candidates': 'تعذر تحميل المرشحين',
  'Failed to load the candidate': 'تعذر تحميل المرشح',
  'Failed to save the candidate': 'تعذر حفظ بيانات المرشح',
  'Failed to load the ID document': 'تعذر تحميل وثيقة الهوية',
  'Failed to assign candidate numbers': 'تعذر إسناد أرقام المرشحين',
  'Failed to set the candidate number': 'تعذر تحديد رقم المرشح',
  'Use a date like 2026-09-13': 'اكتب التاريخ بصيغة مثل 2026-09-13',
  'Not a real date': 'تاريخ غير صحيح',

  // ── The deadlines dashboard ──
  'Exam deadlines': 'مواعيد الامتحانات',
  "Every date the boards set for every series, in date order, with what the school still has to do for it. The entry deadline is the school's hard stop: after it, nothing more is entered, paid or confirmed for that series.":
    'كل موعد حددته المجالس لكل دورة، مرتبة حسب التاريخ، مع ما بقي على المدرسة إنجازه. آخر موعد للقيد هو الحد النهائي للمدرسة: بعده لا يُقيَّد ولا يُدفع ولا يُؤكَّد شيء آخر لتلك الدورة.',
  'Series without an entry deadline': 'دورات بلا آخر موعد للقيد',
  'Nothing stops entries or payments for these series until the admin sets their entry deadline:':
    'لا شيء يوقف القيود أو المدفوعات لهذه الدورات حتى يحدد المدير آخر موعد للقيد لها:',
  'Open Board series': 'فتح دورات المجالس',
  'Loading the deadlines…': 'جارٍ تحميل المواعيد…',
  'The deadlines did not load': 'لم يتم تحميل المواعيد',
  'This is a connection problem, not an empty calendar. Try again.': 'هذه مشكلة في الاتصال، وليس التقويم فارغًا. حاول مرة أخرى.',
  'No board dates from the last 30 days on': 'لا توجد مواعيد للمجالس منذ آخر 30 يومًا',
  "Type each series' dates from the board's key-dates document on the Board series page; they appear here with what is still to do.":
    'اكتب مواعيد كل دورة من وثيقة المواعيد الرئيسية للمجلس في صفحة دورات المجالس؛ فتظهر هنا مع ما بقي إنجازه.',
  'Next 30 days': 'الثلاثون يومًا القادمة',
  'date': 'موعد',
  'dates': 'مواعيد',
  'with something still to do': 'فيها أعمال متبقية',
  'Nothing is due in the next 30 days.': 'لا يوجد موعد في الثلاثين يومًا القادمة.',
  'Every date, by month': 'كل المواعيد حسب الشهر',
  'From 30 days ago on. Passed dates are dimmed.': 'منذ 30 يومًا فصاعدًا. المواعيد المنقضية باهتة.',
  'No dates for this board.': 'لا توجد مواعيد لهذا المجلس.',
  'Passed today': 'انقضى اليوم',
  'Yesterday': 'أمس',
  'Tomorrow': 'غدًا',
  'What the date is': 'نوع الموعد',
  'When': 'متى',
  'Still to do': 'ما بقي إنجازه',
  'Hard stop': 'الحد النهائي',
  "Entry deadline (the school's hard stop)": 'آخر موعد للقيد (الحد النهائي للمدرسة)',
  'After this time nothing more is entered, paid or confirmed for the series.': 'بعد هذا الوقت لا يُقيَّد ولا يُدفع ولا يُؤكَّد شيء آخر للدورة.',
  'Nothing outstanding': 'لا شيء متبقٍ',
  'Open entries': 'فتح القيود',
  'Open the timetable': 'فتح الجدول',
  'Open forecasts': 'فتح الدرجات المتوقعة',
  'Open candidates': 'فتح المرشحين',
  'Open results': 'فتح النتائج',
  'Open certificates': 'فتح الشهادات',
  // What is outstanding (the API's sentences without a number)
  'No timetable imported yet': 'لم يُستورد جدول بعد',
  'The timetable is not published to families yet': 'لم يُنشر الجدول للأسر بعد',
  'No results imported yet': 'لم تُستورد نتائج بعد',
  'Results not published to families yet': 'لم تُنشر النتائج للأسر بعد',
  'No certificates received yet': 'لم تُستلم شهادات بعد',
};

export const candidatesRules: Rule[] = [
  // The deadlines dashboard
  [/^In (\d+) days$/, (m) => `بعد ${arabicDays(Number(m[1]))}`],
  [/^(\d+) days ago$/, (m) => `قبل ${arabicDays(Number(m[1]))}`],
  [/^(\d+) confirmed registrations have no entry yet$/, (m) => `تسجيلات مؤكدة بلا قيد بعد: ${m[1]}`],
  [/^(\d+) draft entries not sent to the board$/, (m) => `قيود مسودة لم تُرسل إلى المجلس: ${m[1]}`],
  [/^(\d+) registrations still waiting for approval or payment$/, (m) => `تسجيلات ما زالت بانتظار الموافقة أو الدفع: ${m[1]}`],
  [/^(\d+) retake entries not sent$/, (m) => `قيود إعادة لم تُرسل: ${m[1]}`],
  [/^(\d+) forecast grades missing$/, (m) => `درجات متوقعة ناقصة: ${m[1]}`],
  [/^(\d+) candidates' access arrangements have no board approval$/, (m) => `مرشحون ترتيبات وصولهم دون موافقة المجلس: ${m[1]}`],
  [/^(\d+) certificates waiting to be collected$/, (m) => `شهادات بانتظار الاستلام: ${m[1]}`],
  // The API's refusals on the candidates screen (names, codes and series stay as written)
  [/^The UCI (\S+) is permanent: say why it is being corrected$/, (m) => `رقم UCI ${m[1]} دائم: اذكر سبب تصحيحه`],
  [/^The UCI (\S+) is already recorded for (.+)$/, (m) => `رقم UCI ${m[1]} مسجل بالفعل لـ ${m[2]}`],
  [/^(.+)'s candidate number in (.+) is fixed: entries with it have gone to (.+)$/, (m) => `رقم المرشح ${m[1]} في ${m[2]} ثابت: أُرسلت قيود به إلى ${m[3]}`],
  [/^Candidate number (\d{4}) is already (.+)'s in (.+)$/, (m) => `رقم المرشح ${m[1]} مخصص بالفعل لـ ${m[2]} في ${m[3]}`],
];
