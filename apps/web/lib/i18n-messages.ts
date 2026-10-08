/**
 * Arabic for the messages and reminders screens, step D (RESERVATIONS_REWORK.md §3.8, §4.6, §4.8):
 * Messages (a new message, the log and its deliveries, the reminder rules and what went out, the
 * school's texts), the Money tab's "Remind", the Settings screen's Reminders group, the
 * notification types families see, and the API's refusals on these screens. Merged into the page
 * translator in lib/i18n.tsx as steps A, B and C's are: exact English text → Arabic (a word the app
 * already translates keeps its Arabic), and `translateMessagesText` for sentences that carry a
 * name, a number or a variable.
 *
 * Words: a message رسالة, a reminder تذكير, an audience الجمهور / المستلمون, a delivery توصيل, a
 * template (the school's text) نص, a channel قناة, in the app في التطبيق, a broadcast إعلان عام,
 * a list قائمة, scheduled مجدولة. Names, amounts, dates and variables in braces are data.
 */

export const messagesArabic: Record<string, string> = {
  // ── The page ──
  'Messages': 'الرسائل',
  'Families read these in their notifications (and by email); nobody can delete one. Reminders go out on their own, once each.':
    'تقرأ الأسر هذه الرسائل في إشعاراتها (وبالبريد الإلكتروني)؛ ولا يمكن لأحد حذفها. وتُرسل التذكيرات تلقائيًا، كل تذكير مرة واحدة.',
  'New message': 'رسالة جديدة',
  'Sent': 'المُرسلة',
  'Reminders': 'التذكيرات',
  'Texts': 'النصوص',

  // ── A new message ──
  'To everyone, a grade, the parents of a grade, a list the school already keeps, or chosen people.':
    'إلى الجميع، أو صف، أو أولياء أمور صف، أو قائمة تحتفظ بها المدرسة، أو أشخاص تختارهم.',
  "To a session's unpaid families or the holders of a charge: the payment reminder, or your own words.":
    'إلى الأسر غير المسددة في جلسة أو أصحاب رسم: تذكير الدفع أو كلماتك أنت.',
  'Who': 'إلى من',
  'Audience': 'المستلمون',
  'Everyone or a grade': 'الجميع أو صف',
  'A list in the system': 'قائمة في النظام',
  'Chosen people': 'أشخاص مختارون',
  'Groups': 'المجموعات',
  'Saved lists:': 'القوائم المحفوظة:',
  'List': 'القائمة',
  'Choose a session': 'اختر جلسة',
  'Choose a subject': 'اختر مادة',
  'Choose a section': 'اختر قسمًا',
  'Teaching group': 'مجموعة تدريس',
  'Choose a group': 'اختر مجموعة',
  'Charge': 'الرسم',
  'Year': 'العام',
  'Any year': 'أي عام',
  'To': 'إلى',
  'Parents': 'أولياء الأمور',
  'Parents and students': 'أولياء الأمور والطلاب',
  "A session's unpaid families": 'الأسر غير المسددة في جلسة',
  'A section': 'قسم',
  'A teaching group': 'مجموعة تدريس',
  'The reservers of a subject': 'من حجزوا مادة',
  'The holders of a charge': 'أصحاب رسم',
  'Keep this list in the picker as (optional)': 'احفظ هذه القائمة في الاختيار باسم (اختياري)',
  'e.g. Section 11C parents': 'مثلًا: أولياء أمور قسم 11C',
  'Counting…': 'جارٍ العدّ…',
  'person': 'شخص',
  'people': 'أشخاص',
  'messages, one about each child': 'رسالة، واحدة عن كل طفل',
  'Nobody is in this audience now.': 'لا أحد ضمن هذا الجمهور الآن.',
  'Search families, students and staff by name or email': 'ابحث عن الأسر والطلاب والموظفين بالاسم أو البريد',
  'Search people': 'ابحث عن أشخاص',
  'Remove': 'إزالة',
  'What': 'ماذا',
  'Text': 'النص',
  'Write the text': 'اكتب النص',
  'Language': 'اللغة',
  'English and Arabic': 'الإنجليزية والعربية',
  'English': 'الإنجليزية',
  'Arabic': 'العربية',
  'Insert:': 'أدرج:',
  'This audience cannot fill it': 'لا يستطيع هذا الجمهور ملأه',
  'Also in Arabic': 'بالعربية أيضًا',
  'Arabic title': 'العنوان بالعربية',
  'Arabic message': 'الرسالة بالعربية',
  'This audience cannot fill': 'لا يستطيع هذا الجمهور ملء',
  ': choose a list that has it, or take it out of the text.': ': اختر قائمة فيها هذه القيمة، أو احذفها من النص.',
  'Preview — the copy for': 'معاينة — النسخة الخاصة بـ',
  'Channels': 'القنوات',
  'In the app': 'في التطبيق',
  'WhatsApp': 'واتساب',
  '(no business account yet)': '(لا يوجد حساب أعمال بعد)',
  'The school has no WhatsApp Business account yet': 'لا تملك المدرسة حساب واتساب للأعمال بعد',
  'When': 'متى',
  'Now': 'الآن',
  'Tomorrow 09:00': 'غدًا 09:00',
  'Pick a time': 'اختر وقتًا',
  'Cairo time': 'بتوقيت القاهرة',
  'Settings': 'الإعدادات',
  'The whole school': 'المدرسة كلها',
  'Everyone': 'الجميع',
  'All staff': 'كل الموظفين',
  'All families': 'كل الأسر',
  'All parents': 'كل أولياء الأمور',
  'All students': 'كل الطلاب',
  'One person': 'شخص واحد',
  'no teacher yet': 'بلا معلم بعد',
  'None': 'لا شيء',
  'Sending…': 'جارٍ الإرسال…',
  'Schedule for': 'جدولة في',
  'Send to': 'إرسال إلى',
  'Send': 'إرسال',
  'Scheduled for': 'مجدولة في',
  'It goes out at that minute; you can cancel it in the log until then.': 'تُرسل في تلك الدقيقة؛ ويمكنك إلغاؤها من السجل حتى ذلك الحين.',
  'Sent to': 'أُرسلت إلى',
  'The deliveries are in the log.': 'التوصيلات في السجل.',
  'The deliveries are in Messages.': 'التوصيلات في صفحة الرسائل.',

  // ── The variables ──
  "the parent's name": 'اسم ولي الأمر',
  "the student's name": 'اسم الطالب',
  'the session': 'الجلسة',
  'the amount owed': 'المبلغ المستحق',
  'the due date': 'موعد الاستحقاق',
  'when reservations close, or the deadline': 'موعد انتهاء الحجز أو الموعد النهائي',
  'what is owed': 'ما هو مستحق',
  'the board series': 'دورة المجلس',
  'how many': 'العدد',
  'Variables:': 'المتغيرات:',

  // ── The log ──
  'Sent and scheduled': 'المرسلة والمجدولة',
  'Message': 'الرسالة',
  'All': 'الكل',
  'Sent by staff': 'أرسلها الموظفون',
  'Before messages': 'قبل صفحة الرسائل',
  'Nothing sent yet': 'لم يُرسل شيء بعد',
  'Template:': 'النص:',
  'not sent by email': 'لم تُرسل بالبريد',
  'Scheduled': 'مجدولة',
  'Not sent': 'لم تُرسل',
  'Deliveries': 'التوصيلات',
  'Cancel this scheduled message': 'إلغاء هذه الرسالة المجدولة',
  'Cancel the message': 'إلغاء الرسالة',
  'sent': 'أُرسلت',
  'failed': 'فشلت',
  'waiting': 'بانتظار',
  'Sending': 'جارٍ الإرسال',
  'Every delivery': 'كل التوصيلات',
  'Failed only': 'الفاشلة فقط',
  'Recipient': 'المستلم',
  'About': 'بشأن',
  'Channel': 'القناة',
  'Outcome': 'النتيجة',
  'Not yet': 'ليس بعد',
  'Finance officer': 'موظف المالية',
  'Finance admin': 'مسؤول المالية',
  'Coordinator': 'المنسق',
  'Gate': 'البوابة',

  // ── Reminders ──
  'Reminders go out on their day at': 'تُرسل التذكيرات في يومها الساعة',
  'Reminders are switched off: nothing goes out until they are switched on again.': 'التذكيرات متوقفة: لا يُرسل شيء حتى تُشغَّل من جديد.',
  'Payment due (lines, instalments, charges)': 'موعد الدفع (الأسطر والأقساط والرسوم)',
  'Reservations closing': 'انتهاء الحجز',
  'Board entry deadline (staff)': 'الموعد النهائي لقيد المجلس (للموظفين)',
  'School fee due': 'موعد الرسوم المدرسية',
  'Declared retakes to verify (coordinator)': 'إعادات مُعلنة للتحقق (للمنسق)',
  'Every session': 'كل الجلسات',
  "A session's own rule": 'قاعدة خاصة بجلسة',
  'the day': 'يوم الموعد',
  'then every': 'ثم كل',
  'days': 'أيام',
  'until paid': 'حتى السداد',
  'until the session closes': 'حتى إغلاق الجلسة',
  'until the deadline': 'حتى الموعد النهائي',
  'until verified': 'حتى التحقق',
  'In the app and by email': 'في التطبيق وبالبريد الإلكتروني',
  'after the date:': 'بعد الموعد:',
  "Follow every session's rule": 'اتبع قاعدة كل الجلسات',
  'Days (− before the date, + after)': 'الأيام (− قبل الموعد، + بعده)',
  'Then every … days until paid (empty: no repeat)': 'ثم كل … أيام حتى السداد (فارغ: بلا تكرار)',
  'Text after the date': 'النص بعد الموعد',
  'The same text': 'النص نفسه',
  'Why it changes (kept in the audit log)': 'سبب التغيير (يُحفظ في سجل التدقيق)',
  "Save the session's rule": 'احفظ قاعدة الجلسة',
  'What went out': 'ما أُرسل',
  'Each reminder is sent once on its day; a paid line or a verified sitting stops its own.': 'يُرسل كل تذكير مرة واحدة في يومه؛ ويوقف السطر المدفوع أو الجلسة المُتحقق منها تذكيرها.',
  'No reminder has gone out yet': 'لم يُرسل أي تذكير بعد',
  'Reminder': 'التذكير',
  'Days': 'الأيام',
  "the session's own rule:": 'قاعدة الجلسة الخاصة:',
  'student': 'طالب',
  'students': 'طلاب',
  'item': 'بند',
  'items': 'بنود',

  // ── Texts ──
  'New text': 'نص جديد',
  'Reminder text': 'نص تذكير',
  'Change the text': 'تغيير النص',
  'Name': 'الاسم',
  'Title (English)': 'العنوان (بالإنجليزية)',
  'Message (English)': 'الرسالة (بالإنجليزية)',
  'Title (Arabic)': 'العنوان (بالعربية)',
  'Message (Arabic)': 'الرسالة (بالعربية)',
  'Payment due': 'موعد الدفع',
  'Payment overdue': 'دفعة متأخرة',
  'School fee overdue': 'رسوم مدرسية متأخرة',

  // ── The saved audiences (their names, as the old form named the groups) ──
  'All Users': 'كل المستخدمين',
  'All Students': 'كل الطلاب',
  'All Parents': 'كل أولياء الأمور',
  'Grade 10 Students': 'طلاب الصف 10',
  'Grade 11 Students': 'طلاب الصف 11',
  'Grade 12 Students': 'طلاب الصف 12',
  'Parents of grade 10': 'أولياء أمور الصف 10',
  'Parents of grade 11': 'أولياء أمور الصف 11',
  'Parents of grade 12': 'أولياء أمور الصف 12',

  // ── The Money tab's "Remind" ──
  'Remind': 'تذكير',
  'Remind these families': 'تذكير هذه الأسر',
  'The payment reminder, now, to the parents and the student of each family ticked: what they owe in this session and by when.':
    'تذكير الدفع الآن إلى أولياء الأمور والطالب في كل أسرة محددة: ما عليهم في هذه الجلسة وموعده.',
  'No family here owes anything that can be paid now.': 'لا توجد هنا أسرة عليها ما يمكن دفعه الآن.',
  'due': 'الموعد',
  'Also by email': 'وبالبريد الإلكتروني أيضًا',
  'family': 'أسرة',
  'families': 'أسر',

  // ── Settings: the Reminders group ──
  'Whether the reminder rules on Messages > Reminders go out, and at what hour of their day.': 'هل تُرسل قواعد التذكير في الرسائل > التذكيرات، وفي أي ساعة من يومها.',
  'Send reminders automatically': 'إرسال التذكيرات تلقائيًا',
  "On: the scheduler sends the reminder rules on Messages > Reminders (payments due, reservations closing, board deadlines, the school fee, declared retakes to verify). Off: no reminder goes out until it is turned on again; nothing missed meanwhile is sent as a backlog, only each reminder's latest day.":
    'تشغيل: يرسل المجدول قواعد التذكير في الرسائل > التذكيرات (مواعيد الدفع، انتهاء الحجز، مواعيد المجالس، الرسوم المدرسية، الإعادات المعلنة للتحقق). إيقاف: لا يُرسل أي تذكير حتى يُشغَّل من جديد؛ ولا يُرسل ما فات دفعة واحدة، بل آخر يوم لكل تذكير فقط.',
  "Hour the day's reminders go out": 'ساعة إرسال تذكيرات اليوم',
  "Each reminder is due on its day (seven days before a payment's due date, the day itself, three days after…) at this hour, Cairo time. A day whose hour passed while the system was down goes out at the next minute, once.":
    'يُستحق كل تذكير في يومه (قبل موعد الدفع بسبعة أيام، ويوم الموعد نفسه، وبعده بثلاثة أيام…) في هذه الساعة بتوقيت القاهرة. واليوم الذي فاتت ساعته والنظام متوقف يُرسل في الدقيقة التالية مرة واحدة.',
  ':00, Cairo time': ':00 بتوقيت القاهرة',

  // ── The notification types families see ──
  'Message from the School': 'رسالة من المدرسة',
  'Payment Reminder': 'تذكير بالدفع',
  'Announcement': 'إعلان',

  // ── The API's refusals ──
  "Finance sends to a money list only: a session's unpaid families or the holders of a charge": 'ترسل المالية إلى قوائم الأموال فقط: الأسر غير المسددة في جلسة أو أصحاب رسم',
  "Finance reads the deliveries of money lists and payment reminders only": 'تقرأ المالية توصيلات قوائم الأموال وتذكيرات الدفع فقط',
  'Nobody is in this audience now: there is nothing to send': 'لا أحد ضمن هذا الجمهور الآن: لا يوجد ما يُرسل',
  'WhatsApp is not connected yet: the school has no WhatsApp Business account, so nothing can be sent there': 'واتساب غير متصل بعد: لا تملك المدرسة حساب واتساب للأعمال، فلا يمكن الإرسال عليه',
  'Choose a template or write a title and a text': 'اختر نصًا أو اكتب عنوانًا ورسالة',
  'The Arabic text needs both its title and its text': 'يحتاج النص العربي إلى عنوانه ورسالته معًا',
  'A reminder rule sends this template: change the rule before switching it off': 'قاعدة تذكير ترسل هذا النص: غيّر القاعدة قبل إيقافه',
  'This rule was just set by someone else: open it again': 'غيّر شخص آخر هذه القاعدة للتو: افتحها من جديد',
  'This session has no rule of its own for this reminder': 'ليس لهذه الجلسة قاعدة خاصة لهذا التذكير',
  'Only a payment is reminded after its date: this reminder runs up to its date': 'لا يُذكَّر بعد الموعد إلا بالدفع: هذا التذكير حتى موعده فقط',
  "This reminder is the school's, not a session's: it has no session override": 'هذا التذكير للمدرسة كلها لا لجلسة: ليس له قاعدة خاصة بجلسة',
};

/** Sentences of these screens that carry a name, a number or a variable. */
const WHO_AR: Record<string, string> = { 'Parents and students': 'أولياء الأمور والطلاب', Parents: 'أولياء الأمور', Students: 'الطلاب' };
const DAYS_AR = (w: string) => (w === 'the day' ? 'يوم الموعد' : w === '1 day before' ? 'قبل يوم واحد' : w === '1 day after' ? 'بعد يوم واحد'
  : w.replace(/^(\d+) days before$/, 'قبل $1 أيام').replace(/^(\d+) days after$/, 'بعد $1 أيام'));

export function translateMessagesText(text: string, exact: (t: string) => string | null = () => null): string | null {
  const word = (t: string) => exact(t) ?? t;
  const rules: [RegExp, (m: RegExpExecArray) => string][] = [
    // An audience as the picker and the log name it (the session's and the people's names are data).
    [/^(Unpaid|Overdue) in (.+?)( \((\d+) chosen\))? — (Parents and students|Parents|Students)$/,
      (m) => `${m[1] === 'Unpaid' ? 'غير المسددين' : 'المتأخرون'} في ${m[2]}${m[4] ? ` (${m[4]} مختارة)` : ''} — ${WHO_AR[m[5]!]}`],
    [/^Section (.+) — (Parents and students|Parents|Students)$/, (m) => `قسم ${m[1]} — ${WHO_AR[m[2]!]}`],
    [/^Reserved (.+) in (.+) — (Parents and students|Parents|Students)$/, (m) => `من حجزوا ${m[1]} في ${m[2]} — ${WHO_AR[m[3]!]}`],
    [/^(Unpaid|Holders of) (.+?)( \d{4}-\d{4})? — (Parents and students|Parents|Students)$/,
      (m) => `${m[1] === 'Unpaid' ? 'غير المسدد:' : 'أصحاب'} ${word(m[2]!)}${m[3] ?? ''} — ${WHO_AR[m[4]!]}`],
    [/^(.+) with (.+) — (Parents and students|Parents|Students)$/, (m) => `${m[1]} مع ${word(m[2]!)} — ${WHO_AR[m[3]!]}`],
    [/^Families of grade (\d+)$/, (m) => `أسر الصف ${m[1]}`],
    [/^Grade (\d+) students$/, (m) => `طلاب الصف ${m[1]}`],
    [/^(\d+) people$/, (m) => `${m[1]} أشخاص`],
    [/^Reminder: (.+?)(?: \((.+)\))?$/, (m) => `تذكير: ${word(m[1]!)}${m[2] ? ` (${m[2].split(', ').map(DAYS_AR).join('، ')})` : ''}`],
    [/^This audience cannot fill (.+): choose a list that has it, name a session, or take it out of the text$/, (m) => `لا يستطيع هذا الجمهور ملء ${m[1]}: اختر قائمة فيها هذه القيمة، أو حدد جلسة، أو احذفها من النص`],
    [/^This message was already (sent|cancelled|failed): only a scheduled message can be cancelled$/, (m) => `هذه الرسالة ${m[1] === 'sent' ? 'أُرسلت' : m[1] === 'cancelled' ? 'أُلغيت' : 'فشلت'} بالفعل: لا تُلغى إلا الرسالة المجدولة`],
    [/^The template "(.+)" is switched off: switch it on in Templates, or write the text$/, (m) => `النص «${m[1]}» متوقف: شغّله في النصوص أو اكتب النص`],
    [/^A saved audience is already called "(.+)"$/, (m) => `توجد قائمة محفوظة باسم «${m[1]}» بالفعل`],
    [/^A template is already called "(.+)"$/, (m) => `يوجد نص باسم «${m[1]}» بالفعل`],
    [/^(\d+) days before$/, (m) => `قبل ${m[1]} أيام`],
    [/^(\d+) days after$/, (m) => `بعد ${m[1]} أيام`],
    [/^1 day before$/, () => 'قبل يوم واحد'],
    [/^1 day after$/, () => 'بعد يوم واحد'],
    [/^(\d{2}):00 Cairo time$/, (m) => `${m[1]}:00 بتوقيت القاهرة`],
    [/^"(.+)" will not be sent\. The log keeps it, cancelled\.$/, (m) => `لن تُرسل «${m[1]}». ويحتفظ بها السجل ملغاة.`],
    [/^Session for \{session\}$/, () => 'الجلسة لـ {session}'],
  ];
  for (const [re, f] of rules) {
    const m = re.exec(text);
    if (m) return f(m);
  }
  return null;
}
