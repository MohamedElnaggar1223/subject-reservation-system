/**
 * Arabic for the reservations rework's screens, step A (RESERVATIONS_REWORK.md §4.1, §4.2, §4.6):
 * Sessions, the Session screen and its Subjects, Fees, Money and Grade 10 tabs, the pricing,
 * payment and refund settings, and the retake deadline on the board series. Merged into the page
 * translator in lib/i18n.tsx: exact English text → Arabic (a word the app already translates
 * keeps its Arabic), and `translateSessionsText` for sentences that carry a name, a number or a
 * date.
 *
 * Words: a session is الجلسة (as the app's Sessions), a board's sitting a دورة, an exam board
 * المجلس, a reservation line سطر, the course fee رسوم التدريس, the board's fee رسوم المجلس, a
 * provisional fee مؤقتة, a retake إعادة, self-study دراسة ذاتية. Names, codes and amounts are data.
 */

export const sessionsArabic: Record<string, string> = {
  // MO-9 (F7's review of 2ca07a4, item 2): a self-study-only subject at 0 says why; a copy names what came across closed.
  'Why the course fee is 0': 'سبب أن رسوم التدريس 0',
  'Self-study only at 0: its lines are priced at the board fee alone.': 'دراسة ذاتية فقط برسوم 0: تُسعَّر سطورها برسوم المجلس وحدها.',
  'Say why the course fee is 0 (at least 5 characters)': 'اذكر سبب أن رسوم التدريس 0 (5 أحرف على الأقل)',
  'Copied; some subjects need a look': 'نُسخت؛ وبعض المواد تحتاج إلى نظرة',
  'Closed, no teacher to teach them:': 'مغلقة، لا معلم لتدريسها:',
  'Closed, no course fee (open them once it is set):': 'مغلقة، بلا رسوم تدريس (افتحها حين تُحدَّد):',
  'Self-study only at a course fee of 0, priced at the board fee alone:': 'دراسة ذاتية فقط برسوم تدريس 0، تُسعَّر برسوم المجلس وحدها:',
  'Open the session': 'افتح الجلسة',
  // ── Sessions ──
  'Sessions': 'الجلسات',
  'New session': 'جلسة جديدة',
  'No sessions yet': 'لا توجد جلسات بعد',
  'A session is one cycle — June, or November to January — with every level in it.': 'الجلسة دورة واحدة — يونيو، أو نوفمبر إلى يناير — تضم كل المستويات.',
  'in all': 'إجمالًا',
  'open': 'مفتوحة',
  'draft': 'مسودة',
  'Winter': 'الشتاء',
  'Winter (November – January)': 'الشتاء (نوفمبر – يناير)',
  'June of': 'يونيو عام',
  'November of': 'نوفمبر عام',
  'It will be called': 'سيكون اسمها',
  'Refunds:': 'الاسترداد:',
  'Reserve': 'الحجز',
  'Reserve from': 'الحجز من',
  'Reserve to': 'الحجز حتى',
  'Course starts': 'بداية الدراسة',
  'Payment due': 'موعد السداد',
  'Copy from': 'نسخ من',
  'Copy from…': 'نسخ من…',
  'Start empty': 'البدء فارغة',
  'Subjects, teachers, what can be entered and course fees come across; board fees come across provisional until the board publishes.':
    'تُنسخ المواد والمعلمون وما يمكن قيده ورسوم التدريس؛ وتُنسخ رسوم المجلس مؤقتة حتى ينشرها المجلس.',
  'A session whose reserving starts now or earlier opens at once; otherwise it opens on its start date. Families may preregister for a session that has not opened.':
    'الجلسة التي يبدأ حجزها الآن أو قبله تُفتح فورًا؛ وإلا تُفتح في تاريخ بدايتها. ويمكن للأسر التسجيل المسبق في جلسة لم تُفتح بعد.',
  'Create session': 'إنشاء الجلسة',
  'Creating…': 'جارٍ الإنشاء…',
  'subject': 'مادة',
  'subjects': 'مواد',
  'board': 'مجلس',
  'boards': 'مجالس',
  'lines': 'أسطر',
  'paid': 'مدفوعة',
  'unpaid': 'غير مدفوعة',
  'outstanding': 'مستحقة',
  'overdue': 'متأخرة',
  'exams': 'الامتحانات',
  'Dates not set': 'لم تُحدَّد المواعيد',
  'Money': 'المال',

  // ── The Session screen ──
  'Session': 'الجلسة',
  'Deadlines': 'المواعيد النهائية',
  'passed': 'انقضى',
  'retakes': 'الإعادات',
  'by the refund windows (a converted session)': 'حسب نوافذ الاسترداد (جلسة محوَّلة)',
  'fixed: a family has agreed to it': 'ثابتة: وافقت عليها أسرة',
  'No series yet: a subject\'s series is attached when it is added.': 'لا توجد دورات بعد: تُربط دورة المادة عند إضافتها.',
  'Open now': 'افتح الآن',
  'Open this session now': 'افتح هذه الجلسة الآن',
  'Opening…': 'جارٍ الفتح…',
  'Families can reserve from now. Preregistrations are captured: a paid one is confirmed, an unpaid one waits for payment — and one whose series\' deadline has passed is refunded in full instead.':
    'يمكن للأسر الحجز من الآن. تُعتمد التسجيلات المسبقة: المدفوع يُؤكَّد، وغير المدفوع ينتظر السداد — ومن انقضى موعد دورته يُستردّ بالكامل بدلًا من ذلك.',
  'Close this session': 'إغلاق هذه الجلسة',
  'Close session': 'إغلاق الجلسة',
  'Families can no longer reserve or pay here. Unpaid lines expire; their checkouts close and any money held comes back to the family.':
    'لا يمكن للأسر الحجز أو الدفع هنا بعد الآن. تنتهي الأسطر غير المدفوعة، وتُغلق عمليات الدفع، ويعود أي مال محجوز إلى الأسرة.',
  'Edit the session': 'تعديل الجلسة',
  'Kept with the change. An open session\'s end needs one.': 'يُحفظ مع التغيير. نهاية الجلسة المفتوحة تحتاج سببًا.',
  'Moving the payment date moves the due date of every unpaid line with it (never past its series\' deadline).':
    'تغيير موعد السداد يغيّر موعد استحقاق كل سطر غير مدفوع معه (دون تجاوز موعد دورته).',
  'Nothing on this session is yours to see.': 'لا شيء في هذه الجلسة متاح لك.',
  'Fees': 'الرسوم',

  // ── Subjects tab ──
  'Add subject': 'إضافة مادة',
  'Add a subject': 'إضافة مادة',
  'No subjects in this session yet': 'لا مواد في هذه الجلسة بعد',
  'Add the subjects the school offers this cycle, or copy them from the last session of this kind.': 'أضف المواد التي تقدمها المدرسة في هذه الدورة، أو انسخها من آخر جلسة من النوع نفسه.',
  'O.L.': 'O.L.',
  'A.S. / A.L.': 'A.S. / A.L.',
  'What can be entered': 'ما يمكن قيده',
  'Board fee': 'رسوم المجلس',
  'board fee': 'رسوم المجلس',
  'Lines': 'الأسطر',
  'No teacher': 'لا معلم',
  'No board fee': 'لا رسوم مجلس',
  'No fee': 'لا رسوم',
  'Series has no dates': 'الدورة بلا مواعيد',
  'Map on the Catalogue': 'اربطها في الكتالوج',
  'Grade 10 core': 'أساسية للصف 10',
  'Retakes only': 'إعادات فقط',
  'Self-study only': 'دراسة ذاتية فقط',
  '(retake)': '(إعادة)',
  '(self-study)': '(دراسة ذاتية)',
  '(online)': '(عبر الإنترنت)',
  'online': 'عبر الإنترنت',
  'provisional': 'مؤقتة',
  'The board has not published this fee yet: families can reserve, not pay, until it is confirmed on the Fees tab.':
    'لم ينشر المجلس هذه الرسوم بعد: يمكن للأسر الحجز لا الدفع حتى تُؤكَّد في تبويب الرسوم.',
  'live lines': 'أسطر قائمة',
  'This cycle': 'هذه الدورة',
  'Availability': 'الإتاحة',
  'Closing stops new lines; the lines already made stand.': 'الإغلاق يوقف الأسطر الجديدة؛ وتبقى الأسطر القائمة.',
  'Course starts (if not the session\'s)': 'بداية الدراسة (إن اختلفت عن الجلسة)',
  'Teachers': 'المعلمون',
  'Replace teacher': 'استبدال معلم',
  'Remove subject': 'إزالة المادة',
  'Add an item': 'إضافة بند',
  'Show every teacher': 'أظهر كل المعلمين',
  'Show this subject\'s teachers only': 'أظهر معلمي هذه المادة فقط',
  'No teacher in this subject\'s pool yet.': 'لا معلم في قائمة هذه المادة بعد.',
  'Remove this subject': 'إزالة هذه المادة',
  'A subject with lines cannot be removed: close it instead (its lines stand).': 'لا يمكن إزالة مادة لها أسطر: أغلقها بدلًا من ذلك (تبقى أسطرها).',
  'Series': 'الدورة',
  'This series has no dates yet: it takes no reservation until they are set.': 'لا مواعيد لهذه الدورة بعد: لا تقبل حجزًا حتى تُحدَّد.',
  'Course fee (if not the subject\'s)': 'رسوم التدريس (إن اختلفت عن المادة)',
  'Only one of the group': 'واحد فقط من المجموعة',
  'Items with the same group cannot be reserved together.': 'لا يمكن حجز بنود المجموعة نفسها معًا.',
  'A first entry of the subject in this series includes it': 'القيد الأول للمادة في هذه الدورة يشمله',
  'lines move with it to the new series, each audited.': 'أسطر تنتقل معه إلى الدورة الجديدة، ويُسجَّل كل منها.',
  'Untick': 'إلغاء التحديد',
  'Untick this item': 'إلغاء تحديد هذا البند',
  'An item with live lines cannot be unticked: move or drop them first. With only history, it is closed and kept.':
    'لا يمكن إلغاء بند له أسطر قائمة: انقلها أو اسحبها أولًا. وإن لم يكن له إلا سجل، يُغلق ويُحفظ.',
  'Save item': 'حفظ البند',
  'Needs an earlier sitting carried forward': 'يحتاج دورة سابقة تُرحَّل',
  'Its own teachers': 'معلموه الخاصون',
  'None: the subject\'s teachers.': 'لا أحد: معلمو المادة.',
  'What it enters': 'ما يقيده',
  'Papers or units': 'أوراق أو وحدات',
  'The award': 'المؤهل',
  'An option code': 'رمز خيار',
  'The subject row': 'صف المادة',
  'Option code': 'رمز الخيار',
  'No paper or unit of this board in the catalogue at this level.': 'لا ورقة أو وحدة لهذا المجلس في الكتالوج بهذا المستوى.',
  'Its board fee is the qualification\'s (the board prices the whole qualification for a one-paper retake)': 'رسوم مجلسه هي رسوم المؤهل (يسعّر المجلس المؤهل كاملًا لإعادة ورقة واحدة)',
  'Required in a first entry': 'مطلوب في القيد الأول',
  'Label': 'الوصف',
  'Kind': 'النوع',
  'Paper 4 only (retake)': 'الورقة 4 فقط (إعادة)',
  'Its board fee is read for the subject row; an item entering a unit or an award is made from the catalogue when the subject is added.':
    'تُقرأ رسوم المجلس لصف المادة؛ أما البند الذي يقيد وحدة أو مؤهلًا فيُنشأ من الكتالوج عند إضافة المادة.',
  'Replace a teacher': 'استبدال معلم',
  'Every line, item and this year\'s class of the teacher who leaves moves to the other, audited.': 'تنتقل كل أسطر المعلم المغادر وبنوده وفصله هذا العام إلى الآخر، مع التسجيل.',
  'Who leaves': 'من يغادر',
  'Who takes over': 'من يتولى',
  'Replace': 'استبدال',
  'Search by name or code': 'ابحث بالاسم أو الرمز',
  'Every active subject is already in this session.': 'كل المواد الفعالة موجودة في هذه الجلسة بالفعل.',
  'An open subject names who teaches it.': 'المادة المفتوحة تحدد من يدرّسها.',
  'What can be entered and its series come from the catalogue; change them on the subject\'s row after.': 'ما يمكن قيده ودورته من الكتالوج؛ غيّرهما من صف المادة بعد ذلك.',
  'Copy subjects from another session': 'نسخ المواد من جلسة أخرى',
  'Its subjects, teachers, items and course fees come across (the subjects this session has are kept); its board fees come across provisional.':
    'تُنسخ موادها ومعلموها وبنودها ورسوم التدريس (وتبقى مواد هذه الجلسة)؛ وتُنسخ رسوم المجلس مؤقتة.',
  'No other session of this kind to copy from.': 'لا توجد جلسة أخرى من هذا النوع للنسخ منها.',

  // ── Fees tab ──
  'No series yet': 'لا دورات بعد',
  'A series appears here when a subject\'s item is entered in it.': 'تظهر الدورة هنا عند قيد بند مادة فيها.',
  'Finance and the admin set the board fees; you can read them here.': 'تحدد المالية والإدارة رسوم المجلس؛ ويمكنك قراءتها هنا.',
  'Paste the fee list': 'لصق قائمة الرسوم',
  'Confirm all': 'تأكيد الكل',
  'A confirmed fee differs from what lines were priced at': 'رسوم مؤكدة تختلف عما سُعّرت به الأسطر',
  'unpaid lines can be re-priced on their board part;': 'سطرًا غير مدفوع يمكن إعادة تسعير جزء المجلس فيه؛',
  'with a payment stay as they are (finance adjusts them).': 'لها دفعة تبقى كما هي (تسويها المالية).',
  'Re-price unpaid lines': 'إعادة تسعير الأسطر غير المدفوعة',
  'Re-price': 'إعادة التسعير',
  'Lines with no payment are re-priced on their board part, with the discounts they were priced with; each family is told the old and the new price. Lines with a payment are listed and left as they are.':
    'يُعاد تسعير جزء المجلس في الأسطر التي لا دفعة لها، بالخصومات التي سُعّرت بها، وتُبلَّغ كل أسرة بالسعر القديم والجديد. أما الأسطر التي لها دفعة فتُدرج وتبقى كما هي.',
  'lines re-priced': 'سطرًا أُعيد تسعيره',
  'listed, untouched (they have a payment)': 'مُدرجة دون تغيير (لها دفعة)',
  'Difference': 'الفرق',
  'Code': 'الرمز',
  'Title': 'العنوان',
  'Used by': 'تستخدمها',
  'Amount': 'المبلغ',
  'State': 'الحالة',
  'confirmed': 'مؤكدة',
  'to re-price': 'لإعادة التسعير',
  'No subject of this session reads a fee from this series yet.': 'لا مادة في هذه الجلسة تقرأ رسومًا من هذه الدورة بعد.',
  'These are the board\'s published fees': 'هذه رسوم المجلس المنشورة',
  'Save fees': 'حفظ الرسوم',
  'One fee per line, as the board\'s list has it: a code and an amount ("0970 CX 10,850", "WMA11 4,800").': 'رسم واحد في كل سطر كما في قائمة المجلس: رمز ومبلغ ("0970 CX 10,850"، "WMA11 4,800").',
  'The fee list': 'قائمة الرسوم',
  'matched': 'مطابقة',
  'not recognised': 'غير معروفة',
  'Not recognised': 'غير معروف',
  'Read the list': 'قراءة القائمة',
  'Add these fees': 'إضافة هذه الرسوم',
  'Copy fees from an earlier series': 'نسخ الرسوم من دورة سابقة',
  'Every row comes across provisional (the rows this series has are kept): families can reserve, not pay, until the board publishes and you confirm.':
    'يُنسخ كل صف مؤقتًا (وتبقى صفوف هذه الدورة): يمكن للأسر الحجز لا الدفع حتى ينشر المجلس وتؤكد أنت.',

  // ── Money tab ──
  'Unpaid': 'غير مدفوع',
  'Overdue': 'متأخر',
  'Provisional': 'مؤقتة',
  'families': 'أسر',
  'provisional (not payable yet)': 'مؤقتة (لا تُدفع بعد)',
  'Every subject': 'كل المواد',
  'No lines here': 'لا أسطر هنا',
  'First entry': 'قيد أول',
  'Retake': 'إعادة',
  'In school': 'في المدرسة',
  'day overdue': 'يوم تأخير',
  'days overdue': 'أيام تأخير',
  'Waiting for the parent': 'بانتظار ولي الأمر',
  'Preregistered': 'مسجّل مسبقًا',
  'Expired': 'منتهٍ',
  'Dropped': 'مسحوب',
  'Rejected': 'مرفوض',
  'course + board': 'التدريس + المجلس',
  'Export': 'تصدير',
  'Every section': 'كل الفصول',
  'awaiting the parent': 'بانتظار ولي الأمر',

  // ── Grade 10 tab ──
  'The core': 'المواد الأساسية',
  'Every grade-10 student sits these in June; a family reserving on its own must include them.': 'يمتحن كل طالب في الصف 10 هذه المواد في يونيو؛ والأسرة التي تحجز بنفسها يجب أن تشملها.',
  'No IGCSE subject in this session yet.': 'لا مادة IGCSE في هذه الجلسة بعد.',
  'Register grade 10': 'تسجيل الصف 10',
  'Registering…': 'جارٍ التسجيل…',
  'lines made for': 'أسطر أُنشئت لـ',
  'students.': 'طلاب.',
  'Not registered:': 'لم يُسجَّل:',
  'grade-10 students': 'طلاب الصف 10',
  'to register': 'للتسجيل',
  'already done': 'تم بالفعل',
  'cannot be registered': 'لا يمكن تسجيلهم',
  'Nothing to do: every grade-10 student has the core, or cannot be registered.': 'لا شيء للقيام به: كل طلاب الصف 10 لديهم المواد الأساسية، أو لا يمكن تسجيلهم.',
  'Done': 'تم',

  // ── Settings (prices, payment, refunds) ──
  'Prices': 'الأسعار',
  'How a line’s price is made from the course fee and the board’s fee.': 'كيف يُحسب سعر السطر من رسوم التدريس ورسوم المجلس.',
  'Payment': 'السداد',
  'When a line’s money is due.': 'متى يستحق مال السطر.',
  'Refunds': 'الاسترداد',
  'What a new session’s refund policy is.': 'ما سياسة الاسترداد للجلسة الجديدة.',
  'Share of the course fee': 'نسبة رسوم التدريس',
  'Through week': 'حتى الأسبوع',
  'through week': 'حتى الأسبوع',
  'after that': 'بعد ذلك',
  'Add a step': 'إضافة خطوة',

  // ── The session's header (F0a's series correction) ──
  'Correct the series': 'تصحيح الدورة',
  'Correct': 'تصحيح',
  'The series decides the academic year every line is judged by. The subjects go to the same series of the new year with their lines; a line whose student may no longer sit it expires, and its checkout closes.':
    'تحدد الدورة العام الدراسي الذي يُحكم به على كل سطر. تنتقل المواد إلى الدورة نفسها في العام الجديد مع أسطرها؛ وينتهي السطر الذي لم يعد طالبه مؤهلًا لها، ويُغلق دفعه.',
  'Whole subject': 'المادة كاملة',
  'One paper (retake)': 'ورقة واحدة (إعادة)',
  'Unit': 'وحدة',
  'Route': 'مسار',
  'Qualification': 'مؤهل',
  'Open: first entries and retakes': 'مفتوحة: القيد الأول والإعادات',

  // ── The settings this step adds (their labels and descriptions come from the API) ──
  'Self-study: share of the course fee': 'الدراسة الذاتية: نسبة رسوم التدريس',
  'A self-study line pays this share of the school\'s course fee ("Self Study 50% School fees" on every form).':
    'يدفع سطر الدراسة الذاتية هذه النسبة من رسوم تدريس المدرسة ("Self Study 50% School fees" في كل نموذج).',
  'Self-study: share of the board fee': 'الدراسة الذاتية: نسبة رسوم المجلس',
  'A self-study line pays this share of the board\'s fee. The forms halve the "School fees" only, so the board fee is paid in full by default (A-16, question Q-12 to the admin).':
    'يدفع سطر الدراسة الذاتية هذه النسبة من رسوم المجلس. النماذج تخفض "رسوم المدرسة" إلى النصف فقط، لذا تُدفع رسوم المجلس كاملة افتراضيًا (A-16، السؤال Q-12 للإدارة).',
  'Retake in school: share of the course fee': 'الإعادة في المدرسة: نسبة رسوم التدريس',
  'A retake taught again in school pays this share of the course fee ("Retake in School 100%").': 'تدفع الإعادة التي تُدرَّس مجددًا في المدرسة هذه النسبة من رسوم التدريس ("Retake in School 100%").',
  'One-paper retake: share of its own course fee': 'إعادة ورقة واحدة: نسبة رسوم تدريسها',
  'Scales the course fee the school sets for a one-paper retake item (Paper 4 only, 1H only…).': 'تضبط رسوم التدريس التي تحددها المدرسة لبند إعادة ورقة واحدة (الورقة 4 فقط، 1H فقط…).',
  'Take payment while a board fee is provisional': 'قبول الدفع ورسوم المجلس مؤقتة',
  'Off: a line whose board fee is still provisional (copied from an earlier series, or typed before the board publishes) can be reserved but not paid; the checkout and the desk say "board fee provisional, confirmed before payment". On: it can be paid at the provisional price, and a later difference is a price adjustment by finance.':
    'إيقاف: السطر الذي ما زالت رسوم مجلسه مؤقتة (منسوخة من دورة سابقة أو مكتوبة قبل نشر المجلس) يُحجز ولا يُدفع؛ وتقول صفحة الدفع والمكتب "رسوم المجلس مؤقتة وتُؤكَّد قبل الدفع". تشغيل: يُدفع بالسعر المؤقت، وأي فرق لاحق تسويه المالية.',
  'Days to pay a line reserved late': 'أيام سداد السطر المحجوز متأخرًا',
  'A line reserved after its session\'s payment due date is due this many days after it is reserved; a line whose board fee is provisional, this many days after the fee is confirmed. Never later than its series\' deadline.':
    'السطر المحجوز بعد موعد سداد جلسته يستحق بعد هذا العدد من الأيام من حجزه؛ والسطر ذو رسوم المجلس المؤقتة بعد هذا العدد من الأيام من تأكيد الرسوم. ولا يتجاوز موعد دورته أبدًا.',
  'Refund policy of a new June session': 'سياسة الاسترداد لجلسة يونيو الجديدة',
  'Copied into each new June session, in weeks from the first lesson: the share of the course fee a family gets back on a drop. The session can change it until the first family consents to it (SCHOOL_FORMS.md §2.1).':
    'تُنسخ إلى كل جلسة يونيو جديدة، بالأسابيع من أول درس: نسبة رسوم التدريس التي تستردها الأسرة عند السحب. ويمكن للجلسة تغييرها حتى توافق عليها أول أسرة (SCHOOL_FORMS.md §2.1).',
  'Refund policy of a new winter session': 'سياسة الاسترداد لجلسة الشتاء الجديدة',
  'Copied into each new November – January session, in weeks from the first lesson (the November forms: 100% within 2 weeks, 50% in weeks 3 to 6, nothing after).':
    'تُنسخ إلى كل جلسة نوفمبر – يناير جديدة، بالأسابيع من أول درس (نماذج نوفمبر: 100% خلال أسبوعين، و50% في الأسابيع 3 إلى 6، ولا شيء بعد ذلك).',

  // ── Board series (retakes) ──
  'Retakes until': 'الإعادات حتى',
  'Retakes until (your clock)': 'الإعادات حتى (بتوقيتك)',
  'Past it, every payment still unconfirmed for this series closes on its own (wallet money returned, families told) and every registration still waiting expires. It may fall while a session is still open: what is entered in this series stops at it, and the rest of the session goes on. A retake of the board\'s previous sitting runs to the retake date where the board gives one (Cambridge). Leave the deadline empty and the exams\' start is the cut-off.':
    'بعده تُغلق تلقائيًا كل دفعة غير مؤكدة لهذه الدورة (ويعود مال المحفظة وتُبلَّغ الأسر) وينتهي كل تسجيل ما زال منتظرًا. ويمكن أن يقع والجلسة مفتوحة: ما يُقيَّد في هذه الدورة يتوقف عنده ويستمر باقي الجلسة. وإعادة الدورة السابقة للمجلس تمتد حتى موعد الإعادات حين يحدده المجلس (كامبريدج). وإن تُرك الموعد فارغًا فبداية الامتحانات هي الحد.',

  // ── A change refused because its students kept changing (lib/student-locks.ts) ──
  'The students with lines here changed while this change was running (new reservations kept arriving): nothing was changed. Try again.':
    'تغيّر الطلاب الذين لهم سطور هنا أثناء تنفيذ هذا التغيير (استمرت حجوزات جديدة في الوصول): لم يتغيّر شيء. حاول مرة أخرى.',

  // ── Fees tab: lines provisional on confirmed fees ──
  'Lines still provisional on confirmed fees': 'سطور ما زالت مؤقتة على رسوم مؤكدة',
  'These waiting lines read only confirmed fees here but are still marked provisional, so they cannot be paid.':
    'هذه السطور المنتظرة تقرأ هنا رسومًا مؤكدة فقط لكنها ما زالت مؤقتة، فلا يمكن سدادها.',
  'Confirming their fees again makes them payable.': 'تأكيد رسومها مرة أخرى يجعلها قابلة للسداد.',
  'Confirm their fees again': 'أكّد رسومها مرة أخرى',

  // ── F6a: the session in the school's words (docs/features/SESSION_WORDS.md; the mapping table §2) ──
  // The links sheet.
  'What the form offers': 'ما يعرضه النموذج',
  'Reservations': 'الحجوزات',
  'reservation': 'حجز',
  'reservations': 'حجوزات',
  'reserved': 'محجوزة',
  'All papers': 'كل الأوراق',
  'All papers:': 'كل الأوراق:',
  'first entry': 'قيد أول',
  'retake in school': 'إعادة في المدرسة',
  'retake self study': 'إعادة دراسة ذاتية',
  'only': 'فقط',
  'self study only': 'دراسة ذاتية فقط',
  'in school or self study': 'في المدرسة أو دراسة ذاتية',
  '(self study only)': '(دراسة ذاتية فقط)',
  'self study': 'دراسة ذاتية',
  '(ONLINE ONLY)': '(أونلاين فقط)',
  '(External)': '(خارجي)',
  '2nd entry only': 'القيد الثاني فقط',
  'Who teaches it?': 'من يدرّسها؟',
  'Board fee not set': 'رسوم المجلس غير محددة',
  'Set its papers on the Catalogue': 'حدّد أوراقها في الكتالوج',
  'not published yet': 'لم تُنشر بعد',
  'not set yet': 'لم تُحدَّد بعد',
  "Preview the family's form": 'معاينة نموذج الأسرة',
  'No subjects on this sheet yet': 'لا مواد في هذا الكشف بعد',
  "Bring last cycle's subjects with their teachers and fees, then change what differs; or add the subjects one by one.":
    'انقل مواد الدورة السابقة بمعلميها ورسومها ثم غيّر ما اختلف؛ أو أضف المواد واحدة واحدة.',
  'Add subjects': 'إضافة المواد',
  'Every active subject is already on this sheet.': 'كل مادة مفعّلة موجودة في هذا الكشف بالفعل.',
  'Its subjects, teachers, papers and course fees come across (the subjects this session has are kept); its board fees come across as not published yet.':
    'تُنقل موادها ومعلموها وأوراقها ورسوم التدريس (وتبقى مواد هذه الجلسة كما هي)؛ وتُنقل رسوم المجلس على أنها لم تُنشر بعد.',
  'Subjects, teachers, their papers and course fees come across; board fees come across as not published yet, until the board publishes.':
    'تُنقل المواد والمعلمون وأوراقها ورسوم التدريس؛ وتُنقل رسوم المجلس على أنها لم تُنشر بعد، حتى ينشرها المجلس.',
  // The subject's form, in the form's order.
  'Teachers this cycle': 'المعلمون في هذه الدورة',
  'online only': 'أونلاين فقط',
  'External team': 'فريق خارجي',
  'An external team': 'فريق خارجي',
  'An outside provider who teaches it, by the name the links sheet gives.': 'جهة خارجية تدرّسها، بالاسم الوارد في كشف الروابط.',
  'Offered as': 'تُعرض على أنها',
  'First entry and retakes': 'قيد أول وإعادات',
  'Taught this cycle: a first entry, a retake in school, a retake in self study.': 'تُدرَّس هذه الدورة: قيد أول، وإعادة في المدرسة، وإعادة دراسة ذاتية.',
  '2nd entry only: a retake in school or in self study.': 'القيد الثاني فقط: إعادة في المدرسة أو دراسة ذاتية.',
  'Retake (Self Study ONLY)': 'إعادة (دراسة ذاتية فقط)',
  'Not taught this cycle: self study at the self-study share of the course fee.': 'لا تُدرَّس هذه الدورة: دراسة ذاتية بنسبة الدراسة الذاتية من رسوم التدريس.',
  'Not offered this cycle': 'غير معروضة هذه الدورة',
  'Families do not see it.': 'لا تراها الأسر.',
  'Who teaches it? A subject offered for first entries names its teachers.': 'من يدرّسها؟ المادة المعروضة للقيد الأول تحدد معلميها.',
  'Course fee (EGP)': 'رسوم التدريس (جنيه)',
  'Self Study': 'دراسة ذاتية',
  'School fees:': 'من رسوم المدرسة:',
  'One paper only': 'ورقة واحدة فقط',
  'The Catalogue gives this subject no papers yet.': 'لا يعطي الكتالوج هذه المادة أوراقًا بعد.',
  "Set this subject's papers on the Catalogue": 'حدّد أوراق هذه المادة في الكتالوج',
  "A retake of one paper carries the other papers from the sitting the family names. Its course fee, when empty, is the subject's.":
    'إعادة ورقة واحدة ترحّل باقي الأوراق من الدورة التي تسميها الأسرة. ورسوم تدريسها، إن تُركت فارغة، هي رسوم المادة.',
  'Its papers, if the Catalogue gives it any, are set once it is added.': 'تُحدَّد أوراقها، إن أعطاها الكتالوج أوراقًا، بعد إضافتها.',
  'Not offered': 'غير معروضة',
  'Retake in school or self study': 'إعادة في المدرسة أو دراسة ذاتية',
  'Retake self study only': 'إعادة دراسة ذاتية فقط',
  'How this paper is offered': 'كيف تُعرض هذه الورقة',
  'Its course fee': 'رسوم تدريسها',
  'Components': 'المكوّنات',
  'Offered': 'معروضة',
  'Self study only': 'دراسة ذاتية فقط',
  'A.2. (carry forward)': 'A.2. (ترحيل نتيجة A.S.)',
  'A.2. (carry forward on an earlier June or November)': 'A.2. (ترحيل نتيجة A.S. من يونيو أو نوفمبر سابق)',
  "A.2. (carry forward) takes the A.S. result of an earlier June or November sitting, named by the family. A course fee left empty is the subject's.":
    'يأخذ A.2. (الترحيل) نتيجة A.S. من دورة يونيو أو نوفمبر سابقة تسميها الأسرة. ورسوم التدريس المتروكة فارغة هي رسوم المادة.',
  'Units': 'الوحدات',
  'Taught by': 'يدرّسها',
  'Not this cycle': 'ليست هذه الدورة',
  'How this unit is offered': 'كيف تُعرض هذه الوحدة',
  "Its teachers (none ticked: the subject's)": 'معلموها (إن لم يُحدَّد أحد: معلمو المادة)',
  'Sitting': 'الدورة',
  'A unit moved to another sitting takes its reservations with it; the reason is kept with each.': 'الوحدة المنقولة إلى دورة أخرى تنقل حجوزاتها معها؛ ويُحفظ السبب مع كل منها.',
  'Qualifications': 'المؤهلات',
  'How this qualification is offered': 'كيف يُعرض هذا المؤهل',
  'Its teacher (the family chooses the qualification with the teacher)': 'معلمه (تختار الأسرة المؤهل مع المعلم)',
  'it has a reservation: it stands when it is not offered this cycle, and no new one is taken.': 'لها حجز: يبقى حين لا تُعرض هذه الدورة، ولا يُقبل حجز جديد.',
  'its reservations stand when it is not offered this cycle, and no new one is taken.': 'تبقى حجوزاتها حين لا تُعرض هذه الدورة، ولا يُقبل حجز جديد.',
  'Its reservation stands': 'يبقى حجزها',
  'Its': 'تبقى',
  'reservations stand': 'حجوزات لها',
  'Added. Its papers and their fees, if the Catalogue gives it any, can be set below.': 'أُضيفت. يمكن تحديد أوراقها ورسومها أدناه إن أعطاها الكتالوج أوراقًا.',
  'Nothing to change.': 'لا شيء يتغيّر.',
  'A subject with reservations cannot be removed: set it to "Not offered this cycle" instead (its reservations stand).':
    'لا يمكن حذف مادة لها حجوزات: اجعلها "غير معروضة هذه الدورة" بدلًا من ذلك (تبقى حجوزاتها).',
  "Every reservation, paper and this year's class of the teacher who leaves moves to the other, audited.":
    'ينتقل كل حجز وكل ورقة وفصل هذا العام للمعلم المغادر إلى الآخر، مع التدقيق.',
  // The preview of the family's form.
  "The family's form": 'نموذج الأسرة',
  'What a family sees for': 'ما تراه الأسرة لمادة',
  'on the Reserve page, every choice open. Nothing is reserved from here.': 'في صفحة الحجز، وكل الخيارات مفتوحة. لا يُحجز شيء من هنا.',
  'Not offered this cycle: families do not see it.': 'غير معروضة هذه الدورة: لا تراها الأسر.',
  'Families see nothing of it to reserve: nothing under it is offered.': 'لا ترى الأسر فيها ما يُحجز: لا شيء منها معروض.',
  // The session's header: the deadlines where she expects them.
  "No sittings yet: a subject's sitting is added with the subject.": 'لا دورات بعد: تُضاف دورة المادة مع المادة.',
  'entries by': 'القيد حتى',
  'retakes by': 'الإعادات حتى',
  "The board's dates": 'مواعيد المجلس',
  'This sitting was not found.': 'لم تُعثر على هذه الدورة.',
  'No sittings yet': 'لا دورات بعد',
  'A sitting appears here once a subject on the sheet is entered in it.': 'تظهر الدورة هنا حين تُقيَّد فيها مادة من الكشف.',
  // The form endpoint's refusals (fixed sentences; those with a name are rules below).
  'A paper or unit is named twice in the form': 'ورقة أو وحدة مذكورة مرتين في النموذج',
  'That paper or unit is not under this subject': 'هذه الورقة أو الوحدة ليست من هذه المادة',
  "That paper is not one of this subject's papers on the Catalogue": 'هذه الورقة ليست من أوراق هذه المادة في الكتالوج',
  'Failed to save the subject': 'تعذّر حفظ المادة',
  'Failed to load the preview': 'تعذّر تحميل المعاينة',

  // ── Notifications (a line's price) ──
  'Price Changed': 'تغيّر السعر',
  'Price To Be Confirmed': 'السعر في انتظار التأكيد',
};

const MONTHS_AR: Record<string, string> = { January: 'يناير', June: 'يونيو', October: 'أكتوبر', November: 'نوفمبر' };

/** "100% to week 2 · 50% in week 3 · 0% from week 4" in Arabic, part by part. */
function refundSentence(text: string): string | null {
  const parts = text.split(' · ');
  const out: string[] = [];
  for (const p of parts) {
    let m: RegExpExecArray | null;
    if ((m = /^(\d+(?:\.\d+)?)% to week (\d+)$/.exec(p))) out.push(`${m[1]}% حتى الأسبوع ${m[2]}`);
    else if ((m = /^(\d+(?:\.\d+)?)% in week (\d+)$/.exec(p))) out.push(`${m[1]}% في الأسبوع ${m[2]}`);
    else if ((m = /^(\d+(?:\.\d+)?)% in weeks (\d+)–(\d+)$/.exec(p))) out.push(`${m[1]}% في الأسابيع ${m[2]}–${m[3]}`);
    else if ((m = /^(\d+(?:\.\d+)?)% from week (\d+)$/.exec(p))) out.push(`${m[1]}% من الأسبوع ${m[2]}`);
    else return null;
  }
  return out.join(' · ');
}

/** Sentences of these screens that carry a name, a number or a date. */
export function translateSessionsText(text: string): string | null {
  const rules: [RegExp, (m: RegExpExecArray) => string][] = [
    // A session's derived name.
    [/^November (\d{4}) – January (\d{4})(?: — (.+))?$/, (m) => `نوفمبر ${m[1]} – يناير ${m[2]}${m[3] ? ` — ${m[3]}` : ''}`],
    [/^June (\d{4}) — (.+)$/, (m) => `يونيو ${m[1]} — ${m[2]}`],
    [/^(\d+) days?$/, (m) => `${m[1]} ${Number(m[1]) === 1 ? 'يوم' : 'أيام'}`],
    [/^Amount for (.+)$/, (m) => `المبلغ لـ ${m[1]}`],
    [/^New amount for (.+)$/, (m) => `المبلغ الجديد لـ ${m[1]}`],
    [/^\((\d+)\)$/, (m) => `(${m[1]})`],
    // The API's refusals on these screens.
    [/^Board fee provisional, confirmed before payment: this line can be reserved but not paid until the exam board publishes its fee and the school confirms it$/,
      () => 'رسوم المجلس مؤقتة وتُؤكَّد قبل الدفع: يمكن حجز هذا السطر لا دفعه حتى ينشر المجلس رسومه وتؤكدها المدرسة'],
    [/^The price of one or more of these subjects changed while this was open \(the exam board confirmed its fee\) — look at the new price and pay again$/,
      () => 'تغيّر سعر مادة أو أكثر أثناء فتح هذه الصفحة (أكد المجلس رسومه) — راجع السعر الجديد وادفع مرة أخرى'],
    [/^(.+) is already in this session$/, (m) => `${m[1]} موجودة في هذه الجلسة بالفعل`],
    [/^Who teaches (.+)\? An open subject names its teachers — or make it self-study only$/, (m) => `من يدرّس ${m[1]}؟ المادة المفتوحة تحدد معلميها — أو اجعلها دراسة ذاتية فقط`],
    // MO-9: self-study only at 0 says why (F7's review of 2ca07a4, item 2).
    [/^(.+) is self-study only at a course fee of 0: say why \(its lines are priced at the board fee alone\)$/,
      (m) => `${m[1]} دراسة ذاتية فقط برسوم تدريس 0: اذكر السبب (تُسعَّر سطورها برسوم المجلس وحدها)`],
    // MO-9: an open subject carries the school's course fee (F7's review of 8 Oct, item 6).
    [/^(.+) has no course fee: set the school's course fee before it is open in this session \(a line is never priced without one\)$/,
      (m) => `${m[1]} بلا رسوم تدريس: حدّد رسوم التدريس في المدرسة قبل فتحها في هذه الجلسة (لا يُسعَّر سطر من دونها)`],
    // F6a: the form's refusals that carry a name (offer.services.ts linesStandRefusal; line-rules).
    [/^(.+) has (\d+) reservations?: (?:it stands|they stand) when it is not offered this cycle, and no new one is taken\. Tick "Its (?:reservation stands|\d+ reservations stand)" to save$/,
      (m) => `${m[1]} لها ${m[2]} ${Number(m[2]) === 1 ? 'حجز' : 'حجوزات'}: ${Number(m[2]) === 1 ? 'يبقى' : 'تبقى'} حين لا تُعرض هذه الدورة، ولا يُقبل حجز جديد. ضع علامة "${Number(m[2]) === 1 ? 'يبقى حجزها' : `تبقى ${m[2]} حجوزات لها`}" للحفظ`],
    [/^(.+) is a retake of one paper: it takes no first entry$/, (m) => `${m[1]} إعادة ورقة واحدة: لا تقبل قيدًا أول`],
    // generateItems' label for a one-paper retake ("Paper 4 only (retake)"): the paper's name is data.
    [/^(Paper \S+|Theory paper|\S+) only \(retake\)$/, (m) => `${m[1]} فقط (إعادة)`],
    [/^(January|June|October|November) is not a sitting of this session$/, (m) => `${MONTHS_AR[m[1]!]} ليست دورة من دورات هذه الجلسة`],
    [/^Copy from a session of the same kind \(June from June, winter from winter\)$/, () => 'انسخ من جلسة من النوع نفسه (يونيو من يونيو، والشتاء من الشتاء)'],
    [/^IGCSE sits neither October nor January: an IGCSE item is entered in a June or November series$/, () => 'لا تُعقد IGCSE في أكتوبر ولا يناير: يُقيَّد بند IGCSE في دورة يونيو أو نوفمبر'],
    [/^(\d+) checkouts? still open would pay for two deadlines after this move — confirm or cancel (?:it|them) first$/, (m) => `${m[1]} عملية دفع مفتوحة ستدفع لموعدين بعد هذا النقل — أكّدها أو ألغها أولًا`],
    [/^The entry is with the board \(its deadline, (.+), has passed\): ask the finance desk to drop it$/, (m) => `القيد لدى المجلس (انقضى موعده ${m[1]}): اطلب من مكتب المالية سحبه`],
    [/^Grade 10 June session requires all core subjects\. Missing: (.+)$/, (m) => `جلسة يونيو للصف 10 تتطلب كل المواد الأساسية. الناقصة: ${m[1]}`],
  ];
  for (const [re, f] of rules) {
    const m = re.exec(text);
    if (m) return f(m);
  }
  const refund = refundSentence(text);
  if (refund) return refund;
  const month = /^(January|June|October|November) (\d{4})$/.exec(text);
  if (month) return `${MONTHS_AR[month[1]!]} ${month[2]}`;
  return null;
}
