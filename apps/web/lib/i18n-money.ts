/**
 * Arabic for the reservations rework's money screens, step C (RESERVATIONS_REWORK.md §3.6, §3.7,
 * §4.7): the Exceptions screen (the policy registry's labels, scopes and sentences, "Check
 * these"), the school fee's "Push to families", and the API's refusals on them. Merged into the
 * page translator in lib/i18n.tsx as step A's are: exact English text → Arabic (a word the app
 * already translates keeps its Arabic), and `translateMoneyText` for sentences carrying a name, a
 * number, a date or a policy's parts.
 *
 * Words: an exception استثناء, a policy قاعدة, a scope نطاق, a family الأسرة, a line سطر, a charge
 * رسم, an instalment قسط, the held wallet المحفظة المحجوزة, a one-shot gate (once) مرة واحدة, the
 * course fee رسوم التدريس, the board fee رسوم المجلس. Names, codes and amounts are data.
 */

export const moneyArabic: Record<string, string> = {
  // ── The registry: groups, scopes, what no scope means ──
  'Prices': 'الأسعار',
  'Refunds': 'الاسترداد',
  'Deadlines': 'المواعيد النهائية',
  'Gates': 'الشروط',
  'Eligibility': 'الأهلية',
  'Payment plans': 'خطط السداد',
  'Session': 'الجلسة',
  'Subject (any session)': 'المادة (أي جلسة)',
  'Subject in a session': 'مادة في جلسة',
  'Item (paper, unit or route)': 'بند (ورقة أو وحدة أو مسار)',
  'One reservation line': 'سطر حجز واحد',
  'One charge': 'رسم واحد',
  'Board series': 'دورة المجلس',
  'Academic year': 'العام الدراسي',
  'every line reserved from now on': 'كل سطر يُحجز من الآن',
  'every session': 'كل الجلسات',
  'every academic year': 'كل الأعوام الدراسية',
  'any subject': 'أي مادة',
  'every series of their grade-10 year': 'كل دورات عامه في الصف العاشر',

  // ── The registry: policies ──
  'Self-study share of the course fee': 'نسبة رسوم التدريس في الدراسة الذاتية',
  'Self-study share of the board fee': 'نسبة رسوم المجلس في الدراسة الذاتية',
  'Retake in school: share of the course fee': 'الإعادة في المدرسة: نسبة رسوم التدريس',
  'One-paper retake: share of its course fee': 'إعادة ورقة واحدة: نسبة رسوم تدريسها',
  'Discount (%)': 'خصم (%)',
  'Discount (EGP)': 'خصم (جنيه)',
  'Custom price': 'سعر خاص',
  'Refund percent': 'نسبة الاسترداد',
  'Course start for refunds': 'بداية الدراسة لحساب الاسترداد',
  'Session window extension': 'تمديد فترة الجلسة',
  'Payment due date': 'موعد السداد',
  'Late board entry': 'قيد متأخر لدى المجلس',
  'School fee waiver': 'إعفاء من الرسوم المدرسية',
  'Self-study on a first entry': 'دراسة ذاتية في القيد الأول',
  'An item not open to them': 'بند غير متاح له',
  'First entry without a required item': 'قيد أول دون بند مطلوب',
  'No prior sitting, or outside the carry-forward period': 'دون جلوس سابق، أو خارج فترة الترحيل',
  'Two items of one exclusive group': 'بندان من مجموعة حصرية واحدة',
  'A second line on one entry in a series': 'سطر ثانٍ على القيد نفسه في دورة',
  'Grade 10 without a core subject': 'الصف العاشر دون مادة أساسية',
  'Grade 10: sit a series other than June': 'الصف العاشر: الجلوس في دورة غير يونيو',
  'Instalment plan': 'خطة أقساط',
  'not yours to grant': 'ليس من صلاحيتك منحه',
  'not applied yet': 'لا يُطبَّق بعد',
  'off (setting)': 'مُعطَّل (إعداد)',

  // ── The Exceptions screen ──
  'One rule lifted for one student or one family — a price, a refund, a deadline, a gate, a payment plan. Every hook reads them; everything is audited.':
    'قاعدة تُرفع لطالب واحد أو لأسرة واحدة — سعر أو استرداد أو موعد أو شرط أو خطة سداد. تقرؤها كل المواضع التي تطبقها، وكل شيء مُسجَّل في سجل التدقيق.',
  'Grant an exception': 'منح استثناء',
  'Search by name, email or number…': 'ابحث بالاسم أو البريد أو الرقم…',
  'Could not load students': 'تعذّر تحميل الطلاب',
  'Pick a student…': 'اختر طالبًا…',
  'For': 'لـ',
  'A family\'s exception covers every child linked to that parent account, now and later.': 'استثناء الأسرة يشمل كل طفل مرتبط بحساب ولي الأمر هذا، الآن ولاحقًا.',
  'This student': 'هذا الطالب',
  'The whole family': 'الأسرة كلها',
  'Parent account': 'حساب ولي الأمر',
  'Policy': 'القاعدة',
  'Value (%)': 'القيمة (%)',
  'Value (EGP)': 'القيمة (جنيه)',
  'Scope': 'النطاق',
  'Required: choose what it is for.': 'مطلوب: اختر ما يخصه.',
  'Leave it empty for': 'اتركه فارغًا ليشمل',
  'Any': 'أي',
  'In session': 'في الجلسة',
  'Only to find the subject; the exception is not narrowed to the session.': 'للعثور على المادة فقط؛ لا يُقيَّد الاستثناء بالجلسة.',
  'Pick a session…': 'اختر جلسة…',
  'Pick the student first.': 'اختر الطالب أولًا.',
  'Pick the session first.': 'اختر الجلسة أولًا.',
  'Pick the subject…': 'اختر المادة…',
  'The finance desk picks a line.': 'مكتب المالية يختار السطر.',
  'Pick a line…': 'اختر سطرًا…',
  'Pick a series…': 'اختر دورة…',
  'As 2026-2027.': 'بصيغة 2026-2027.',
  'Instalments': 'الأقساط',
  'They add up to the line\'s price': 'مجموعها سعر السطر',
  '; each is paid into the held wallet, and the line is paid from them at the last. The last date is at the latest the session\'s end or the line\'s deadline, whichever is earlier.':
    '؛ يُدفع كل قسط في المحفظة المحجوزة، ويُسدَّد السطر منها عند آخرها. وآخر موعد هو نهاية الجلسة أو موعد السطر، أيهما أسبق.',
  'Due': 'الاستحقاق',
  'Amount (EGP)': 'المبلغ (جنيه)',
  'Remove': 'إزالة',
  'Add an instalment': 'إضافة قسط',
  'Total': 'الإجمالي',
  'Why, and who agreed it': 'السبب، ومن وافق عليه',
  'Valid until (optional)': 'صالح حتى (اختياري)',
  'It will apply as': 'سيُطبَّق هكذا',
  'Used up by the first reservation it lets through.': 'يُستهلك بأول حجز يسمح به.',
  'Granted': 'الممنوحة',
  'The price is now': 'السعر الآن',
  'was': 'كان',
  'due dates moved.': 'مواعيد سداد نُقلت.',
  'pushed school fees cancelled.': 'رسوم مدرسية مُرسلة أُلغيت.',
  'The instalments are on the family\'s statement.': 'الأقساط في كشف حساب الأسرة.',
  'Granting…': 'جارٍ المنح…',
  'Grant': 'منح',
  'Pick a policy.': 'اختر قاعدة.',
  'Pick a student.': 'اختر طالبًا.',
  'Pick the family\'s parent account.': 'اختر حساب ولي أمر الأسرة.',
  'This policy needs a scope: choose what it is for.': 'هذه القاعدة تحتاج نطاقًا: اختر ما يخصه.',
  'This policy needs a value.': 'هذه القاعدة تحتاج قيمة.',
  'This policy needs a date.': 'هذه القاعدة تحتاج تاريخًا.',
  'Add the instalments: a date and an amount each.': 'أضف الأقساط: تاريخ ومبلغ لكل قسط.',
  'A reason is required.': 'السبب مطلوب.',
  'Family of': 'أسرة',
  'instalment': 'قسط',
  'instalments': 'أقساط',
  'Active': 'ساري',
  'Used': 'مُستخدم',
  'Lapsed': 'منتهي المدة',
  'Revoked': 'مُلغى',
  'All': 'الكل',
  'Show': 'عرض',
  'Nothing here': 'لا شيء هنا',
  'No exception with this status.': 'لا يوجد استثناء بهذه الحالة.',
  'Value': 'القيمة',
  'Status': 'الحالة',
  'Actions': 'الإجراءات',
  'until': 'حتى',
  'Revoke': 'إلغاء',
  'Release in full': 'إفراج كامل',
  'Confirm': 'تأكيد',
  'Revoke this exception': 'إلغاء هذا الاستثناء',
  'Release the plan in full': 'الإفراج الكامل عن الخطة',
  'Confirm this exception': 'تأكيد هذا الاستثناء',
  'Note (optional)': 'ملاحظة (اختيارية)',
  'Check these': 'راجع هذه',
  'Exceptions whose meaning the reservations rework changed. They apply to nothing until you confirm them as scoped, or revoke them.':
    'استثناءات تغيّر معناها مع إعادة بناء الحجوزات. لا تُطبَّق على شيء حتى تؤكدها بنطاقها أو تلغيها.',
  'A refund percent scoped to one subject, which the old system never applied: confirm it to apply it to that subject\'s lines from now on (on the course fee), or revoke it':
    'نسبة استرداد مقيدة بمادة واحدة لم يطبقها النظام القديم قط: أكّدها لتُطبَّق على أسطر تلك المادة من الآن (على رسوم التدريس)، أو ألغها',
  'A deadline extension scoped to one subject, which the old system never applied: confirm it to let this student reserve and pay that subject after the close, or revoke it':
    'تمديد موعد مقيد بمادة واحدة لم يطبقه النظام القديم قط: أكّده ليتمكن هذا الطالب من حجز تلك المادة ودفعها بعد الإغلاق، أو ألغه',

  // ── Push to families ──
  'Push to families': 'إرسال إلى الأسر',
  'The year\'s fee goes on each student\'s statement, due by the date, and the family is told. Paid, waived and graduate students are skipped and listed.':
    'تُضاف رسوم العام إلى كشف حساب كل طالب، مستحقة بحلول التاريخ، وتُبلَّغ الأسرة. ويُتخطى من دفع أو أُعفي والخريجون ويُدرجون في قائمة.',
  'No school fee set': 'لم تُحدَّد رسوم مدرسية',
  'To': 'إلى',
  'A grade': 'صف',
  'A section': 'فصل',
  'Grade (that year)': 'الصف (في ذلك العام)',
  'Pick a section…': 'اختر فصلًا…',
  'Due by': 'مستحقة بحلول',
  'Set the year\'s school fee first.': 'حدّد رسوم العام المدرسية أولًا.',
  'Pick a section.': 'اختر فصلًا.',
  'Pick the date it is due by.': 'اختر تاريخ الاستحقاق.',
  'Pushing…': 'جارٍ الإرسال…',
  'Push the fee': 'إرسال الرسوم',
  'Pushed to': 'أُرسلت إلى',
  'student': 'طالب',
  'students': 'طلاب',
  'In all': 'الإجمالي',
  'Skipped': 'المتخطَّون',
  'Why': 'السبب',
  'not a student': 'ليس طالبًا',
  'left the school': 'غادر المدرسة',
  'a graduate owes no school fee (A-13)': 'لا رسوم مدرسية على الخريج (A-13)',
  'no school fee is open for their grade that year': 'لا رسوم مدرسية مفتوحة لصفه في ذلك العام',
  'the fee is waived': 'الرسوم مُعفاة',
  'already paid': 'مدفوعة بالفعل',
  'a school-fee payment is in progress': 'دفعة رسوم مدرسية قيد التنفيذ',
  'already pushed': 'أُرسلت بالفعل',

  // ── Charges (the screen, the desk, the Money tab) ──
  'Requested — awaiting the school': 'مطلوب — بانتظار موافقة المدرسة',
  'Awaiting payment': 'بانتظار الدفع',
  'Refunded': 'مُسترد',
  'Cancelled': 'ملغي',
  'Cash-in': 'طلب الشهادة (Cash-in)',
  'Late cash-in': 'طلب الشهادة المتأخر',
  'Certificate split': 'فصل الشهادة',
  'Late entry fee': 'رسوم القيد المتأخر',
  'School fee': 'الرسوم المدرسية',
  'Instalment': 'قسط',
  'Price adjustment': 'تعديل سعر',
  'Other charge': 'رسم آخر',
  'Charges': 'الرسوم الأخرى',
  'What families owe beside their subjects — board services, instalments, the pushed school fee, adjustments — by family and status.':
    'ما تدين به الأسر بجانب موادها — خدمات المجالس والأقساط والرسوم المدرسية المرسلة والتعديلات — حسب الأسرة والحالة.',
  'Add a charge': 'إضافة رسم',
  'To accept': 'بانتظار القبول',
  'Unpaid': 'غير مدفوعة',
  'Search a family or student…': 'ابحث عن أسرة أو طالب…',
  'Collected at the desk': 'حُصّل في المكتب',
  'No charge with this status.': 'لا يوجد رسم بهذه الحالة.',
  '(no family linked)': '(لا أسرة مرتبطة)',
  'a payment is being checked': 'دفعة قيد المراجعة',
  'refunded': 'مُسترد',
  'due': 'مستحق',
  'Accept': 'قبول',
  'Refund': 'استرداد',
  'Accept the request': 'قبول الطلب',
  'Cancel the charge': 'إلغاء الرسم',
  'Refund to escrow': 'استرداد إلى الرصيد',
  'Collect': 'تحصيل',
  'Collecting…': 'جارٍ التحصيل…',
  'Paid with': 'طريقة الدفع',
  'Collected': 'حُصّل',
  'payment': 'دفعة',
  'payments': 'دفعات',
  ', one per deadline.': '، دفعة لكل موعد.',
  'Receipts to hand over:': 'إيصالات للتسليم:',
  'Not collected — hand this money back:': 'لم يُحصَّل — أعد هذا المبلغ:',
  'The subjects and charges': 'المواد والرسوم',
  'The charges': 'الرسوم',
  'Kind': 'النوع',
  'Board service': 'خدمة المجلس',
  'Pick a service…': 'اختر خدمة…',
  'Level': 'المستوى',
  'IGCSE / O Level': 'IGCSE / O Level',
  'AS / A Level': 'AS / A Level',
  'The line it adjusts': 'السطر الذي يعدّله',
  'For a line (optional)': 'لسطر (اختياري)',
  'None': 'لا شيء',
  "Amount (EGP, empty for the grid's fee)": 'المبلغ (جنيه، فارغ لرسوم الجدول)',
  'Due by (optional)': 'مستحق بحلول (اختياري)',
  'Description (optional)': 'الوصف (اختياري)',
  'Why, and who asked': 'السبب، ومن طلب',
  'Adding…': 'جارٍ الإضافة…',
  'Add the charge': 'إضافة الرسم',
  'Choose the board service and the series it is for.': 'اختر خدمة المجلس والدورة التي تخصها.',
  'A price adjustment names the line it adjusts.': 'تعديل السعر يحدد السطر الذي يعدّله.',
  'Say how much it is.': 'حدّد المبلغ.',
  'To collect now': 'للتحصيل الآن',
  'pushed, due': 'مُرسلة، مستحقة',
  'the registration gate asks for it': 'يشترطها التسجيل',
  'subject waiting for payment': 'مادة بانتظار الدفع',
  'asked for by the family — accept it on the': 'طلبتها الأسرة — اقبلها في صفحة',
  'page first': 'أولًا',
  'Also collect now': 'تحصيل أيضًا الآن',
  '(collected first: the registration needs it)': '(تُحصَّل أولًا: يشترطها التسجيل)',
  'Owed': 'مستحق',
  'No charge in this session yet.': 'لا رسوم في هذه الجلسة بعد.',
  'Charge': 'الرسم',

  // ── Board services ──
  'Board services': 'خدمات المجالس',
  'Remarks, cash-in and certificate splits: what each board offers, what it costs in a series and until when, and what comes back on a changed grade.':
    'إعادة التصحيح وطلب الشهادة وفصلها: ما يقدمه كل مجلس، وكم يكلّف في كل دورة وحتى متى، وما يُسترد إذا تغيّرت الدرجة.',
  "The board's services": 'خدمات المجلس',
  'Priced': 'التسعير',
  'On a changed grade': 'إذا تغيّرت الدرجة',
  'Asked by': 'يطلبها',
  'Remark': 'إعادة تصحيح',
  'per paper': 'لكل ورقة',
  'per request': 'لكل طلب',
  'by level': 'حسب المستوى',
  'No refund': 'لا استرداد',
  'Refunded in full': 'يُسترد كاملًا',
  'Refunded less a fixed amount': 'يُسترد ناقص مبلغ ثابت',
  'the family or the desk': 'الأسرة أو المكتب',
  'the desk': 'المكتب',
  'Not offered': 'غير متاحة',
  'Dates and fees in a series': 'المواعيد والرسوم في دورة',
  'Series': 'الدورة',
  "Pick a series to set each service's last date and its fees.": 'اختر دورة لتحديد آخر موعد لكل خدمة ورسومها.',
  'Last date': 'آخر موعد',
  'Fee': 'الرسوم',
  'one rate': 'سعر واحد',
  'Not set': 'غير محددة',
  'Provisional': 'مؤقتة',
  'Confirmed': 'مؤكدة',
  'copied from the old fee list': 'منسوخة من قائمة الرسوم القديمة',
  'as the board published it': 'كما نشرها المجلس',
  "The board's list of dates and fees": 'قائمة المجلس بالمواعيد والرسوم',
  'Save the dates': 'حفظ المواعيد',
  'Save the fees': 'حفظ الرسوم',
  'The dates are saved.': 'حُفظت المواعيد.',
  'The fees are saved.': 'حُفظت الرسوم.',
  'Edit the service': 'تعديل الخدمة',
  'Kept by the school (EGP)': 'تحتفظ به المدرسة (جنيه)',
  'A family may ask for it in the app': 'يمكن للأسرة طلبها في التطبيق',
  'Offered': 'متاحة',
  'Service 1 — clerical re-check': 'الخدمة 1 — مراجعة إدارية',
  'Service 1S — clerical re-check with a copy of the script': 'الخدمة 1S — مراجعة إدارية مع نسخة من ورقة الإجابة',
  'Service 2 — review of marking': 'الخدمة 2 — مراجعة التصحيح',
  'Service 2S — review of marking with a copy of the script': 'الخدمة 2S — مراجعة التصحيح مع نسخة من ورقة الإجابة',
  'Access to scripts': 'الاطلاع على أوراق الإجابة',
  'Clerical re-check': 'مراجعة إدارية',
  'Review of marking': 'مراجعة التصحيح',
  'Priority review of marking': 'مراجعة التصحيح العاجلة',
  'Cash-in (claim the award)': 'طلب الشهادة (Cash-in)',

  // ── Remarks by board service ──
  'No remark service offered for this subject': 'لا توجد خدمة إعادة تصحيح متاحة لهذه المادة',
  'Pick the subject first': 'اختر المادة أولًا',
  "The board's last date for it:": 'آخر موعد لدى المجلس:',
  "A remark is charged at its series' fee for the board's service, set on the": 'تُحتسب إعادة التصحيح برسوم دورتها لخدمة المجلس، المحددة في صفحة',
  'page. The amounts below are the old list, copied into a series (provisional) the first time a service has no fee there.':
    '. المبالغ أدناه هي القائمة القديمة، وتُنسخ إلى الدورة (مؤقتة) أول مرة لا يكون فيها للخدمة رسوم هناك.',

  // ── The family's charges and instalments ──
  'Charges and instalments': 'الرسوم والأقساط',
  "What you owe beside the subjects: a plan's instalments, the boards' services you asked for, adjustments. Tick what to pay; a plan's instalments can be paid together.":
    'ما عليك بجانب المواد: أقساط الخطة، وخدمات المجالس التي طلبتها، والتعديلات. اختر ما تدفعه؛ ويمكن دفع أقساط الخطة معًا.',
  'Nothing owed beside the subjects': 'لا شيء مستحق بجانب المواد',
  'Instalments, board services and other charges appear here when the school adds them or you ask for one.': 'تظهر هنا الأقساط وخدمات المجالس والرسوم الأخرى عندما تضيفها المدرسة أو تطلب أحدها.',
  'of': 'من',
  'held for the subject until the last instalment pays it': 'محجوزة للمادة حتى يسددها آخر قسط',
  // ── The statement's charges and a plan line (the reviewer's final pass, item 3) ──
  'to pay': 'للدفع',
  'held for it, paid in instalments': 'محجوزة لها، مدفوعة بالأقساط',
  'Paid by its instalment plan': 'مدفوعة بخطة أقساطها',
  'Instalment plan ended': 'انتهت خطة الأقساط',
  'asked for, awaiting the school': 'مطلوبة، بانتظار المدرسة',
  'held from instalments': 'محجوز من الأقساط',
  'owes': 'المستحق',
  'To pay now': 'للدفع الآن',
  'At the school desk': 'في مكتب المدرسة',
  'InstaPay': 'إنستاباي',
  'Starting…': 'جارٍ البدء…',
  'Pay': 'ادفع',
  'deposit slip': 'إيصال إيداع',
  'A payment for it is in progress.': 'دفعة له قيد التنفيذ.',
  'Paid on the': 'تُدفع في صفحة',
  'page.': '.',
  'Asked for: the school accepts it before it can be paid.': 'مطلوب: تقبله المدرسة قبل أن يُدفع.',
  'Payment started': 'بدأ الدفع',
  'Pay at the school finance desk, quoting': 'ادفع في مكتب المالية بالمدرسة مع ذكر',
  'Bank': 'البنك',
  'Account name': 'اسم الحساب',
  'Account number': 'رقم الحساب',
  'Exact amount': 'المبلغ بالضبط',
  'Reference sent: finance checks it and the instalment counts once confirmed.': 'أُرسل الرقم المرجعي: تراجعه المالية ويُحتسب القسط بعد التأكيد.',
  'Your InstaPay transaction reference': 'الرقم المرجعي لتحويل إنستاباي',
  'Send the reference': 'إرسال الرقم المرجعي',
  'Waiting for the money': 'بانتظار المبلغ',
  'Refund rule': 'قاعدة الاسترداد',
  'The refund rule': 'قاعدة الاسترداد',
  "The series' fee for the service (Board services).": 'رسوم الخدمة في الدورة (خدمات المجالس).',

  'Exception on this line': 'استثناء على هذا السطر',
  'Grant an exception for this student': 'منح استثناء لهذا الطالب',
  'Students': 'الطلاب',
  'Add the students.': 'أضف الطلاب.',
  // ── The two settings step C adds (the Settings screen) ──
  'What the school allows an exception to lift.': 'ما تسمح المدرسة للاستثناء برفعه.',
  'Allow late board entries by exception': 'السماح بالقيد المتأخر لدى المجلس باستثناء',
  'Off: the board\'s entry deadline is a hard stop (owner decision MO-10) and the "Late board entry" exception cannot be granted. On: the admin may grant one student a late entry in one series, with the board\'s late fee charged to the family (question Q-20 to the owner).':
    'مُعطَّل: موعد قيد المجلس حدٌّ نهائي (قرار المالك MO-10) ولا يمكن منح استثناء «قيد متأخر لدى المجلس». مُفعَّل: يمكن للمدير منح طالب واحد قيدًا متأخرًا في دورة واحدة، مع تحميل الأسرة رسوم التأخير لدى المجلس (سؤال Q-20 للمالك).',
  'Expire an unpaid line this many days after it was due': 'إنهاء السطر غير المدفوع بعد هذا العدد من الأيام من موعد استحقاقه',
  'A line still unpaid this many days after its due date expires (reason "overdue"), and an instalment plan on it is settled as a drop that day. 0: never — a due date then drives reminders and the "overdue" list only, and the line waits for its board\'s deadline or the session\'s close.':
    'ينتهي السطر الذي لم يُدفع بعد هذا العدد من الأيام من موعد استحقاقه (السبب «متأخر»)، وتُسوّى خطة الأقساط عليه كسحب في ذلك اليوم. 0: أبدًا — يقود موعد الاستحقاق حينها التذكيرات وقائمة «المتأخر» فقط، وينتظر السطر موعد مجلسه أو إغلاق الجلسة.',
  // ── The API's refusals on these screens ──
  'Percentage must be 0–100': 'النسبة بين 0 و100',
  'A family is a parent account': 'الأسرة حساب ولي أمر',
  'This parent has no linked child yet': 'لا يوجد طفل مرتبط بولي الأمر هذا بعد',
  'Exceptions can only be granted to students': 'لا تُمنح الاستثناءات إلا للطلاب',
  'A plan needs its instalments: a date and an amount each': 'الخطة تحتاج أقساطها: تاريخ ومبلغ لكل قسط',
  'Exception not found or already revoked': 'الاستثناء غير موجود أو أُلغي بالفعل',
  'This line has been paid for or has a payment: its price stays — add a price adjustment or refund the difference instead':
    'هذا السطر مدفوع أو عليه دفعة: يبقى سعره — أضف تعديل سعر أو استرد الفرق بدلًا من ذلك',
  'This charge has a payment: its amount stays — refund the difference instead': 'على هذا الرسم دفعة: يبقى مبلغه — استرد الفرق بدلًا من ذلك',
  'A converted line keeps its price: add a price adjustment instead': 'السطر المحوَّل يحتفظ بسعره: أضف تعديل سعر بدلًا من ذلك',
  'That line was not found for this student or family': 'لم يُعثر على هذا السطر لهذا الطالب أو الأسرة',
  'That charge was not found for this student or family': 'لم يُعثر على هذا الرسم لهذا الطالب أو الأسرة',
  'The line is no longer awaiting payment': 'السطر لم يعد بانتظار الدفع',
  'No live instalment plan with that id': 'لا توجد خطة أقساط سارية بهذا المعرّف',
};

/** The registry's sentences, in Arabic, with the same three parts (§3.7). */
const SENTENCES_AR: Record<string, string> = {
  '{who} pays {value}% of the course fee on a self-study line, {scope}': '{who} يدفع {value}% من رسوم التدريس في سطر الدراسة الذاتية، {scope}',
  '{who} pays {value}% of the board fee on a self-study line, {scope}': '{who} يدفع {value}% من رسوم المجلس في سطر الدراسة الذاتية، {scope}',
  '{who} pays {value}% of the course fee on a retake taught in school, {scope}': '{who} يدفع {value}% من رسوم التدريس في إعادة تُدرَّس في المدرسة، {scope}',
  '{who} pays {value}% of a one-paper item\'s course fee, {scope}': '{who} يدفع {value}% من رسوم تدريس بند الورقة الواحدة، {scope}',
  '{who} pays {value}% less on {scope}': '{who} يدفع أقل بنسبة {value}% على {scope}',
  '{who} pays EGP {value} less on {scope}': '{who} يدفع {value} جنيه أقل على {scope}',
  '{who} pays EGP {value} in all (board fee included) for {scope}': '{who} يدفع {value} جنيه إجمالًا (شاملة رسوم المجلس) عن {scope}',
  'On a drop, {who} gets {value}% of the course fee back (the board fee by its own rule), {scope}': 'عند السحب، يسترد {who} {value}% من رسوم التدريس (ورسوم المجلس بقاعدتها)، {scope}',
  'For {who}, the refund weeks count from {value}, {scope}': 'لـ {who}، تُحسب أسابيع الاسترداد من {value}، {scope}',
  '{who} may still reserve and pay until {value}, {scope} (never past a board\'s entry deadline)': 'يمكن لـ {who} الحجز والدفع حتى {value}، {scope} (دون تجاوز موعد قيد المجلس أبدًا)',
  '{who} owes {scope} by {value} (never past its deadline)': 'يستحق على {who} سداد {scope} بحلول {value} (دون تجاوز موعده أبدًا)',
  '{who} may still be entered in {scope} until {value}, the board\'s late fee charged': 'يمكن قيد {who} في {scope} حتى {value}، مع رسوم التأخير لدى المجلس',
  '{who} may reserve without paying the school fee, {scope}': 'يمكن لـ {who} الحجز دون دفع الرسوم المدرسية، {scope}',
  '{who} may reserve {scope} as a first entry in self-study (once)': 'يمكن لـ {who} حجز {scope} قيدًا أول بالدراسة الذاتية (مرة واحدة)',
  '{who} may reserve {scope} although it is not open to them (once)': 'يمكن لـ {who} حجز {scope} وإن لم يكن متاحًا له (مرة واحدة)',
  '{who} may make a first entry of {scope} without its required items (once)': 'يمكن لـ {who} قيد {scope} أول مرة دون بنوده المطلوبة (مرة واحدة)',
  '{who} may reserve {scope} without a prior sitting in the carry-forward period (once)': 'يمكن لـ {who} حجز {scope} دون جلوس سابق في فترة الترحيل (مرة واحدة)',
  '{who} may reserve two items of one group of {scope} together (once)': 'يمكن لـ {who} حجز بندين من مجموعة واحدة في {scope} معًا (مرة واحدة)',
  '{who} may hold a second live line on the same unit or award in {scope} (once)': 'يمكن لـ {who} الاحتفاظ بسطر ثانٍ قائم على الوحدة أو الشهادة نفسها في {scope} (مرة واحدة)',
  '{who} may reserve {scope} in grade 10 without every core subject': 'يمكن لـ {who} حجز {scope} في الصف العاشر دون كل المواد الأساسية',
  '{who} may sit {scope} in grade 10': 'يمكن لـ {who} الجلوس في {scope} في الصف العاشر',
  '{who} pays {scope} in {value}, each into the held wallet; the line is paid from them at the last': 'يدفع {who} {scope} على {value}، كلٌّ منها في المحفظة المحجوزة؛ ويُسدَّد السطر منها عند آخرها',
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Each sentence template as a pattern whose groups are its parts, in the order they appear. */
const SENTENCE_RULES = Object.entries(SENTENCES_AR).map(([en, ar]) => {
  const order: string[] = [];
  const pattern = escape(en).replace(/\\\{(who|value|scope)\\\}/g, (_m, k: string) => {
    order.push(k);
    return '(.+?)';
  });
  return { re: new RegExp(`^${pattern}$`), order, ar };
});

/**
 * Sentences of these screens that carry a name, a number, a date or a policy's parts.
 * `exact` is the page translator's word lookup, for the parts (a scope's words, a session name).
 */
export function translateMoneyText(text: string, exact: (t: string) => string | null): string | null {
  const part = (p: string) => {
    const fam = /^[Tt]he family of (.+)$/.exec(p);
    if (fam) return `أسرة ${fam[1]}`;
    const inst = /^(\d+) instalments?$/.exec(p);
    if (inst) return `${inst[1]} أقساط`;
    return p.split(' · ').map((x) => exact(x) ?? x).join(' · ');
  };
  for (const r of SENTENCE_RULES) {
    const m = r.re.exec(text);
    if (!m) continue;
    const parts: Record<string, string> = {};
    r.order.forEach((k, i) => { parts[k] = part(m[i + 1] ?? ''); });
    return r.ar.replace('{who}', parts.who ?? '').replace('{value}', parts.value ?? '').replace('{scope}', parts.scope ?? '');
  }
  const rules: [RegExp, (m: RegExpExecArray) => string][] = [
    // A plan's instalment on the statement, and the year's fee taken with a reservation at the desk.
    [/^Instalment (\d+) of (\d+)$/, (m) => `القسط ${m[1]} من ${m[2]}`],
    [/^Collected EGP ([\d,.]+) in (\d+) payments, the subjects per entry deadline and the charges on their own\.$/,
      (m) => `تم تحصيل ${m[1]} جنيه في ${m[2]} دفعات: المواد لكل موعد قيد والرسوم كلٌّ على حدة.`],
    [/^The (\d{4}-\d{4}) school fee collected first \(EGP ([\d,.]+)\)\.$/, (m) => `حُصّلت المصاريف الدراسية ${m[1]} أولًا (${m[2]} جنيه).`],
    // A policy the caller cannot grant now, as the picker lists it: "label — why".
    [/^(.+) — (not yours to grant|not applied yet|off \(setting\))$/, (m) => `${exact(m[1]!) ?? m[1]} — ${exact(m[2]!) ?? m[2]}`],
    // A student in a picker: "name (Grade 12)".
    [/^(.+) \(Grade (\d+)\)$/, (m) => `${m[1]} (الصف ${m[2]})`],
    // The confirmation dialogs (the policy's label first).
    [/^(.+): it stops applying now\. A plan's line expires and its deposits are settled as a drop today; a re-price it made on an unpaid line is undone\.$/,
      (m) => `${exact(m[1]!) ?? m[1]}: يتوقف تطبيقه الآن. ينتهي سطر الخطة وتُسوّى ودائعها كسحب اليوم؛ ويُلغى ما أجراه من تعديل سعر على سطر غير مدفوع.`],
    [/^(.+): every deposit goes back to the family's escrow, the unpaid instalments are cancelled, and the line stays payable in full by its usual date\.$/,
      (m) => `${exact(m[1]!) ?? m[1]}: تعود كل وديعة إلى رصيد الأسرة، وتُلغى الأقساط غير المدفوعة، ويبقى السطر قابلًا للدفع كاملًا بموعده المعتاد.`],
    [/^(.+): from now on it applies as it is scoped\.$/, (m) => `${exact(m[1]!) ?? m[1]}: يُطبَّق من الآن بنطاقه.`],
    [/^A price exception on (.+), whose unit is now reserved under another subject: it applies only to that row's lines — re-scope it to the new item \(revoke and grant again\) or confirm it as it is$/,
      (m) => `استثناء سعر على ${m[1]}، وحدتها تُحجز الآن تحت مادة أخرى: لا يُطبَّق إلا على أسطر ذلك الصف — أعد تحديد نطاقه على البند الجديد (ألغه وامنحه من جديد) أو أكّده كما هو`],
    // A plan line's price, and a service fee still provisional.
    [/^This line is paid by its instalment plan \(granted (.+), (\d+) instalments\): its price stays — release the plan in full first, or add a price adjustment$/,
      (m) => `يُسدَّد هذا السطر بخطة أقساطه (مُنحت ${m[1]}، ${m[2]} أقساط): يبقى سعره — أفرج عن الخطة كاملة أولًا أو أضف تعديل سعر`],
    [/^(.+): the board's fee for it is provisional until finance confirms it on the Board services page — it can be paid once confirmed$/,
      (m) => `${m[1]}: رسوم المجلس له مؤقتة حتى تؤكدها المالية في صفحة خدمات المجالس — ويمكن دفعه بعد التأكيد`],
    [/^The same exception is already active \(granted (.+) by (.+)\): revoke it, or change its scope or value$/,
      (m) => `الاستثناء نفسه سارٍ بالفعل (مُنح ${m[1]} بواسطة ${m[2]}): ألغه أو غيّر نطاقه أو قيمته`],
    [/^This line already had an instalment plan \((.+)\): one plan per line — the line is paid in full now$/,
      () => 'كان لهذا السطر خطة أقساط: خطة واحدة لكل سطر — ويُسدَّد السطر كاملًا الآن'],
    // The Charges screen's dialogs (the charge's description first).
    [/^(.+): the family is told it is due, and it can be paid\.$/, (m) => `${m[1]}: تُبلَّغ الأسرة باستحقاقه ويمكن دفعه.`],
    [/^(.+): nothing is owed for it any more; the family is told\.$/, (m) => `${m[1]}: لم يعد مستحقًا؛ وتُبلَّغ الأسرة.`],
    [/^(.+): the amount goes to the family's escrow\. A paper receipt that is out comes back first\.$/, (m) => `${m[1]}: يذهب المبلغ إلى رصيد الأسرة. ويُعاد الإيصال الورقي المسلَّم أولًا.`],
    // The desk: the fee collected though the registration was refused.
    [/^The (\d{4}-\d{4}) school fee \(EGP (.+)\) was collected; the subjects were not registered: (.+)$/,
      (m) => `حُصّلت الرسوم المدرسية لعام ${m[1]} (${m[2]} جنيه)؛ ولم تُسجَّل المواد: ${exact(m[3]!) ?? m[3]}`],
    // The API's refusals that carry a policy's label, a role or an amount.
    [/^(.+) takes no value$/, (m) => `${exact(m[1]!) ?? m[1]} لا يأخذ قيمة`],
    [/^(.+) needs a value$/, (m) => `${exact(m[1]!) ?? m[1]} يحتاج قيمة`],
    [/^(.+) takes a date$/, (m) => `${exact(m[1]!) ?? m[1]} يأخذ تاريخًا`],
    [/^(.+) applies to something specific: choose what it is for$/, (m) => `${exact(m[1]!) ?? m[1]} يخص شيئًا محددًا: اختر ما يخصه`],
    [/^(.+) cannot be narrowed by (.+)$/, (m) => `لا يمكن تقييد ${exact(m[1]!) ?? m[1]} بـ ${m[2]}`],
    [/^(.+) is registered but not yet applied by pricing: it cannot be granted yet$/, (m) => `${exact(m[1]!) ?? m[1]} مسجَّل لكن التسعير لا يطبقه بعد: لا يمكن منحه الآن`],
    [/^Only (.+) may (grant|revoke|confirm) "(.+)"$/, (m) => `لا يملك ${m[2] === 'grant' ? 'منح' : m[2] === 'revoke' ? 'إلغاء' : 'تأكيد'} «${exact(m[3]!) ?? m[3]}» إلا ${m[1]}`],
    [/^The amount must be between (.+) and (.+)$/, (m) => `يجب أن يكون المبلغ بين ${m[1]} و${m[2]}`],
    [/^Late board entries are off: the board's entry deadline is a hard stop \(owner question Q-20; the setting exceptions\.boardEntryDeadline\)$/,
      () => 'القيد المتأخر مُعطَّل: موعد قيد المجلس حدٌّ نهائي (سؤال المالك Q-20؛ الإعداد exceptions.boardEntryDeadline)'],
  ];
  for (const [re, f] of rules) {
    const m = re.exec(text);
    if (m) return f(m);
  }
  return null;
}
