/**
 * Arabic for the F0a strings shared across screens (standing, grade labels,
 * the team page, settings, sessions, the desk's academic card, the home
 * page): exact English text → Arabic.
 */
export const coreArabic: Record<string, string> = {
  // Standing and grade labels (StandingBadge, gradeLabel)
  'At school': 'في المدرسة',
  'Starts next year': 'يبدأ العام القادم',
  'Withdrawn': 'منسحب',
  'Transferred': 'منقول',
  'Grade not recorded': 'الصف غير مسجل',
  'Grade 9 (starts grade 10 next year)': 'الصف 9 (يبدأ الصف 10 العام القادم)',
  'Not started yet': 'لم يبدأ بعد',
  'Left the school': 'غادر المدرسة',
  'Starts grade 10 next year': 'يبدأ الصف 10 العام القادم',

  // Desk (Student 360)
  'Grade this year (new account)…': 'الصف هذا العام (حساب جديد)…',
  'Started grade 10 in': 'بدأ الصف 10 في',
  'Academic record': 'السجل الأكاديمي',
  'Hide academic record': 'إخفاء السجل الأكاديمي',

  // Home page (student)
  'You transferred to another school': 'انتقلت إلى مدرسة أخرى',
  'You have left the school': 'لقد غادرت المدرسة',
  'Your record shows you left on': 'يشير سجلك إلى أنك غادرت في',
  'Registration is closed. Your registrations, receipts and any balance stay available here.':
    'التسجيل مغلق. تبقى تسجيلاتك وإيصالاتك وأي رصيد متاحة هنا.',
  'Your grade is not recorded yet': 'لم يُسجَّل صفك بعد',
  'The school office needs to record which grade you are in before you can register for exams. Ask them to update your record.':
    'يجب أن يسجل مكتب المدرسة صفك قبل أن تتمكن من التسجيل في الامتحانات. اطلب منهم تحديث سجلك.',
  'You start grade 10 next academic year': 'تبدأ الصف 10 في العام الدراسي القادم',
  'Exam registration opens to you from grade 10.': 'يُفتح لك التسجيل في الامتحانات بدءًا من الصف 10.',
  'Your student record shows you have graduated. The school lets graduates retake subjects in the October, November and January series, and a window is open now.':
    'يشير سجل الطالب إلى أنك تخرجت. تسمح المدرسة للخريجين بإعادة المواد في دورات أكتوبر ونوفمبر ويناير، وهناك نافذة تسجيل مفتوحة الآن.',

  // Register page
  'A graduate retake: the school registers graduates for the': 'إعادة لخريج: تسجل المدرسة الخريجين في دورة',
  'series.': '.',
  'This series is not open to this student': 'هذه الدورة غير متاحة لهذا الطالب',

  // Roles (ROLE_LABELS), weekdays (WEEKDAY_LABELS), the October series
  'Admin': 'مدير النظام',
  'Finance Admin': 'مدير مالي',
  'Finance Officer': 'موظف مالي',
  'Coordinator': 'منسق أكاديمي',
  'Teacher': 'معلم',
  'Gate': 'البوابة',
  'Sunday': 'الأحد',
  'Monday': 'الاثنين',
  'Tuesday': 'الثلاثاء',
  'Wednesday': 'الأربعاء',
  'Thursday': 'الخميس',
  'Friday': 'الجمعة',
  'Saturday': 'السبت',
  'October': 'أكتوبر',

  // Settings (the screen and the SETTINGS registry)
  'School settings': 'إعدادات المدرسة',
  'Rules the school can change without a developer. Each change needs a reason and is recorded in the audit log.':
    'قواعد تستطيع المدرسة تغييرها دون مطوّر. كل تغيير يحتاج إلى سبب ويُسجَّل في سجل التدقيق.',
  'Who may register': 'من يحق له التسجيل',
  'Which students may register for which exam series.': 'أي الطلاب يحق لهم التسجيل في أي دورة امتحانات.',
  'School fee': 'المصاريف الدراسية',
  'When the annual school fee gates registration.': 'متى تكون المصاريف الدراسية السنوية شرطًا للتسجيل.',
  'Calendar': 'التقويم',
  'The school week the calendar and the day’s lists build on.': 'أسبوع الدراسة الذي يُبنى عليه التقويم وقوائم اليوم.',
  'On': 'مفعّل',
  'Off': 'متوقف',
  'School default': 'الإعداد الافتراضي للمدرسة',
  'Never changed': 'لم يتغير من قبل',
  'Last changed': 'آخر تغيير',
  'Who may change it:': 'من يحق له تغييره:',
  'Change': 'تغيير',
  'New value': 'القيمة الجديدة',
  'Save change': 'حفظ التغيير',
  'Saved:': 'تم الحفظ:',
  'Pick a different value first.': 'اختر قيمة مختلفة أولًا.',
  'A reason is required.': 'السبب مطلوب.',
  'Could not load the settings': 'تعذر تحميل الإعدادات',
  'e.g. Agreed at the staff meeting on 3 October': 'مثال: تم الاتفاق في اجتماع الموظفين يوم 3 أكتوبر',
  'Turning this off expires the waiting registrations graduates already made for the October, November and January series; their open checkouts are closed, any wallet money returned, and families told.':
    'إيقاف هذا الخيار يُنهي التسجيلات المنتظرة التي قام بها الخريجون لدورات أكتوبر ونوفمبر ويناير؛ وتُغلق عمليات الدفع المفتوحة لها، ويُعاد أي مبلغ إلى المحفظة، وتُبلَّغ الأسر.',
  'Graduates may retake after grade 12': 'يحق للخريجين الإعادة بعد الصف 12',
  'A student who has finished grade 12 may still register for the October, November and January series of the academic year right after it (retakes to improve grades), never the June after it. Turning this off expires the waiting registrations graduates already made for those series.':
    'يحق للطالب الذي أنهى الصف 12 التسجيل في دورات أكتوبر ونوفمبر ويناير في العام الدراسي التالي مباشرة (إعادة لتحسين الدرجات)، وليس في يونيو التالي. إيقاف هذا الخيار يُنهي التسجيلات المنتظرة التي قام بها الخريجون لتلك الدورات.',
  'Graduates retaking owe no school fee': 'لا مصاريف دراسية على الخريجين المعيدين',
  'A graduate registering under the rule above owes no school fee: the fee is for enrolled grades. Off: a graduate pays the uniform fee of that academic year, if one is set (per-grade fees have no row for graduates).':
    'الخريج الذي يسجل وفق القاعدة أعلاه لا يدفع مصاريف دراسية: المصاريف للصفوف المقيدة. عند الإيقاف: يدفع الخريج المصاريف الموحدة لذلك العام الدراسي إن وُجدت (المصاريف حسب الصف لا تشمل الخريجين).',
  'A series in next year before its school fee opens': 'دورة في العام القادم قبل فتح مصاريفه الدراسية',
  "A November window can open in June, in the academic year before the series. When that year's school fee has not been opened yet: proceed without it (the fee gate is off without a schedule), or hold the registration until the fee opens.":
    'قد تُفتح نافذة نوفمبر في يونيو، أي في العام الدراسي السابق للدورة. إذا لم تُفتح مصاريف ذلك العام بعد: يتم التسجيل دونها (لا يُطبَّق شرط المصاريف دون جدول)، أو يُعلَّق التسجيل حتى تُفتح المصاريف.',
  'Register without the fee': 'التسجيل دون المصاريف',
  'Hold until the fee opens': 'التعليق حتى تُفتح المصاريف',
  'School days of the week': 'أيام الدراسة في الأسبوع',
  'The weekdays the school is open during term. The calendar marks holidays, early dismissals, exam-only days and extra school days on top of these.':
    'أيام الأسبوع التي تفتح فيها المدرسة خلال الفصل الدراسي. يضيف التقويم فوقها العطلات والانصراف المبكر وأيام الامتحانات فقط وأيام الدراسة الإضافية.',

  // Team
  'Create accounts and assign roles. Anyone on the staff can also teach: link their account to a teacher record and they get the teaching screens for their own lessons.':
    'أنشئ الحسابات وحدد الأدوار. يمكن لأي موظف أن يُدرّس أيضًا: اربط حسابه بسجل معلم ليحصل على شاشات التدريس لحصصه.',
  'Role': 'الدور',
  'Teaches as': 'يُدرّس باسم',
  'Does not teach': 'لا يُدرّس',
  'New teacher record (this name)': 'سجل معلم جديد (بهذا الاسم)',
  'Grade this year': 'الصف هذا العام',
  'Pick…': 'اختر…',
  'Grade / ID': 'الصف / الرقم',
  'Standing': 'الوضع',
  'staff': 'الموظفون',
  'students': 'الطلاب',
  'parents': 'أولياء الأمور',
  'No unlinked record': 'لا يوجد سجل غير مرتبط',
  'Does not teach — link…': 'لا يُدرّس - ربط…',
  'Unlink': 'إلغاء الربط',
  'No accounts here yet.': 'لا توجد حسابات هنا بعد.',
  'Creating…': 'جارٍ الإنشاء…',
  'Students need a grade.': 'يحتاج الطلاب إلى صف.',
  'Name, email, and a temporary password are required.': 'الاسم والبريد الإلكتروني وكلمة مرور مؤقتة مطلوبة.',
  'A teacher account teaches as a teacher record: pick one, or create one.': 'حساب المعلم يُدرّس باسم سجل معلم: اختر سجلًا أو أنشئ واحدًا.',
  'Link this account to a teacher record first (Teaches as), then make it a teacher.': 'اربط هذا الحساب بسجل معلم أولًا (يُدرّس باسم)، ثم اجعله معلمًا.',
  'A teacher account keeps its record: change the role first': 'حساب المعلم يحتفظ بسجله: غيّر الدور أولًا',
  'Min 8, 1 upper, 1 digit': '8 أحرف على الأقل، حرف كبير ورقم',
  'Search by name or email…': 'ابحث بالاسم أو البريد الإلكتروني…',
  'Runs the desk: payments, receipts and registrations on a family’s behalf.': 'يدير المكتب: المدفوعات والإيصالات والتسجيلات نيابة عن الأسرة.',
  'The desk, plus refunds, exceptions and fee schedules.': 'المكتب، إضافة إلى المبالغ المستردة والاستثناءات وجداول الرسوم.',
  'The academic lead: calendar, sections, the student record and grade-10 exceptions.': 'المسؤول الأكاديمي: التقويم والفصول وسجل الطالب واستثناءات الصف 10.',
  'Their own teaching. Needs a teacher record — pick one or create one.': 'تدريسه الخاص. يحتاج إلى سجل معلم - اختر سجلًا أو أنشئ واحدًا.',
  'Reception and security: the school day and, later, the leave list.': 'الاستقبال والأمن: اليوم الدراسي، ولاحقًا قائمة الانصراف.',
  'Everything, except what only a parent may do for their own family.': 'كل شيء، عدا ما لا يفعله إلا ولي الأمر لأسرته.',

  // Exceptions (the F0a type)
  'Grade 10: sit a series other than June': 'الصف 10: دخول دورة غير يونيو',

  // Sessions
  'Board entry deadline': 'آخر موعد للقيد لدى المجلس',
  'No board entry deadline set': 'لم يُحدَّد آخر موعد للقيد لدى المجلس',
  'Board Deadline': 'موعد المجلس',
  'Set Board Deadline': 'تحديد موعد المجلس',
  '— Open': '- مفتوحة',
  'Correct Series': 'تصحيح الدورة',
  'Correct series': 'تصحيح الدورة',
  'Correct exam series': 'تصحيح دورة الامتحانات',
  'Exam series year': 'سنة دورة الامتحانات',
  '(suggested from the start date)': '(مقترحة من تاريخ البدء)',
  'Enter the exam series year, e.g. 2027.': 'أدخل سنة دورة الامتحانات، مثل 2027.',
  'Enter the series year, e.g. 2027.': 'أدخل سنة الدورة، مثل 2027.',
  'Grades are read in this academic year: who is in grade 10, and who has graduated.': 'تُحسب الصفوف في هذا العام الدراسي: من في الصف 10، ومن تخرج.',
  'January and October series are A-Level only (no IGCSE sitting exists in Egypt).': 'دورتا يناير وأكتوبر للمستوى المتقدم فقط (لا توجد جلسة IGCSE في مصر).',
  'January and October series are A-Level only — no IGCSE sitting exists in Egypt': 'دورتا يناير وأكتوبر للمستوى المتقدم فقط - لا توجد جلسة IGCSE في مصر',
  'Now:': 'الحالي:',
  'Series': 'الدورة',
  'Year': 'السنة',
  'Becomes:': 'تصبح:',
  "Waiting registrations the corrected series no longer allows (a student's grade in that year) expire now; their open checkouts are closed, any wallet money returned, and families told. Confirmed registrations are not touched.":
    'التسجيلات المنتظرة التي لم تعد الدورة المصححة تسمح بها (حسب صف الطالب في ذلك العام) تنتهي الآن؛ وتُغلق عمليات الدفع المفتوحة لها، ويُعاد أي مبلغ إلى المحفظة، وتُبلَّغ الأسر. لا تتأثر التسجيلات المؤكدة.',
  'e.g. The window was entered as June 2026; it is for June 2027': 'مثال: أُدخلت النافذة على أنها يونيو 2026، وهي ليونيو 2027',
  'Series corrected:': 'تم تصحيح الدورة:',
  'Waiting registrations expired:': 'التسجيلات المنتظرة المنتهية:',
  'Open checkouts closed (families told):': 'عمليات الدفع المفتوحة المغلقة (تم إبلاغ الأسر):',
  'No waiting registration was affected.': 'لم يتأثر أي تسجيل منتظر.',
};
