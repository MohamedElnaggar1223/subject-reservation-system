/**
 * Arabic for F6, the UI audit of the reservation cycle (docs/features/UI_AUDIT.md): the words F6 adds
 * or rewrites on the cycle's screens. Merged into the page translator in lib/i18n.tsx as the other
 * screens' files are (exact English text → Arabic; numbers, names and dates are their own text nodes,
 * so every entry here is words only), and before them: where F6 rewrote a sentence whose old Arabic
 * read the model's words ("السطر" for a reservation line), the entry here is the one used.
 *
 * Words, as the rest of the app has them: a session الجلسة, the links sheet الكشف, a reservation حجز,
 * a board المجلس, a sitting الدورة, the statement كشف الحساب, the school fee المصاريف الدراسية, the
 * balance الرصيد (the lead's decision of 16 Oct 2026, 14; was the wallet), the desk المكتب.
 */

export const uiAuditArabic: Record<string, string> = {
  // ── The admin's and the coordinator's landing ──
  'Closed to new reservations — still in progress': 'مغلقة أمام الحجوزات الجديدة — وما زال العمل فيها جاريًا',
  'Families still owe money, or entries still go to the board: each card says which.': 'ما زالت على الأسر مبالغ، أو ما زالت القيود في طريقها إلى المجلس: كل بطاقة تقول أيّهما.',

  // ── Sessions ──
  'Families reserve': 'تحجز الأسر',

  // ── The Session screen: Money, Fees, To verify ──
  'No reservation here': 'لا حجز هنا',
  'Reservation': 'الحجز',
  'more fee on the board’s list, not read by any subject on this sheet': 'رسم آخر في قائمة المجلس لا تقرؤه أي مادة في هذا الكشف',
  'more fees on the board’s list, not read by any subject on this sheet': 'رسوم أخرى في قائمة المجلس لا تقرؤها أي مادة في هذا الكشف',
  'Show them': 'اعرضها',
  'Hide them': 'أخفها',
  'Retakes and carried sittings declared by a family or at the desk. Verified: the reservation stands. Not confirmed: a reservation not yet paid ends and the family may reserve a first entry; a paid one stands as a first entry before the board’s first-entry deadline, and is dropped with its refund after it.':
    'إعادات ونتائج مرحَّلة صرّحت بها الأسرة أو المكتب. إذا تحقّقتَ منها: يبقى الحجز. إذا لم تُؤكَّد: ينتهي الحجز غير المدفوع ويمكن للأسرة حجز قيد أول؛ ويبقى الحجز المدفوع قيدًا أول قبل موعد القيد الأول لدى المجلس، ويُسحب مع استرداد مبلغه بعده.',
  'The reservation stands as it is.': 'يبقى الحجز كما هو.',
  "Paid and held until the session opens: the reservation stands as a first entry; its capture or the deadline's refund settles it.":
    'مدفوع ومحتجز حتى تُفتح الجلسة: يبقى الحجز قيدًا أول؛ ويُسوّى بتحصيله أو باسترداد مبلغه عند الموعد.',
  "Paid, before the board's first-entry deadline: the reservation stands and is entered as a first entry; finance decides whether anything is owed.":
    'مدفوع، قبل موعد القيد الأول لدى المجلس: يبقى الحجز ويُقيَّد قيدًا أول؛ وتقرر المالية إن كان هناك مبلغ مستحق.',

  // ── The entries to the board ──
  'Each paid reservation becomes its entry with the board: a Cambridge syllabus with its option code, Pearson units one by one, a paid cash-in as its award. See what it would make first; nothing is made until you confirm.':
    'يصبح كل حجز مدفوع قيده لدى المجلس: منهج Cambridge برمز خياره، ووحدات Pearson واحدة واحدة، وطلب احتساب مدفوع بمؤهله. اطّلع أولًا على ما سيُنشأ؛ لا يُنشأ شيء قبل أن تؤكد.',
  'What the check above and the fee sentences on the Entries screen follow. Each was set from the board’s handbook; change one when the handbook says otherwise.':
    'ما يتبعه الفحص أعلاه وجمل الرسوم في شاشة القيود. كل قاعدة مأخوذة من دليل المجلس؛ غيّرها حين يقول الدليل غير ذلك.',
  "What the check above and the fee sentences on the Entries screen follow. Each was set from the board's handbook; change one when the handbook says otherwise.":
    'ما يتبعه الفحص أعلاه وجمل الرسوم في شاشة القيود. كل قاعدة مأخوذة من دليل المجلس؛ غيّرها حين يقول الدليل غير ذلك.',

  // ── The desk ──
  '+ New family': '+ أسرة جديدة',
  'Transfer to check': 'تحويل للمراجعة',
  // The school fee is المصاريف الدراسية everywhere (the sidebar, the landings); C's dictionary had الرسوم المدرسية.
  'School fee': 'المصاريف الدراسية',

  'school fee due': 'المصاريف الدراسية مستحقة',
  'reservation': 'حجز',
  'reservations': 'حجوزات',

  // ── Payments (bank transfers) ──
  'InstaPay transfer waits for its confirmation on the Finance Workbench.': 'تحويل إنستاباي ينتظر تأكيده في مكتب المالية.',
  'InstaPay transfers wait for their confirmation on the Finance Workbench.': 'تحويلات إنستاباي تنتظر تأكيدها في مكتب المالية.',
  'Open the Finance Workbench': 'افتح مكتب المالية',
  'No bank transfer is waiting': 'لا تحويل بنكي في الانتظار',
  'Transfers families make by InstaPay are confirmed on the Finance Workbench.': 'تُؤكَّد تحويلات الأسر عبر إنستاباي في مكتب المالية.',

  // ── Exceptions ──
  'Paper, unit or component': 'الورقة أو الوحدة أو المكوّن',
  'One reservation': 'حجز واحد',
  'One rule lifted for one student or one family — a price, a refund, a deadline, a gate, a payment plan. Each takes effect where its rule applies; everything is audited.':
    'قاعدة تُرفع لطالب واحد أو لأسرة واحدة — سعر أو استرداد أو موعد أو شرط أو خطة سداد. تسري حيث تنطبق قاعدتها، وكل شيء مُسجَّل في سجل التدقيق.',

  // ── The Finance Workbench (its sentences split around the date and the amount) ──
  'Session closed — the family has until': 'أُغلقت الجلسة — أمام الأسرة حتى',
  'to submit the reference; then it lapses on its own.': 'لتقديم المرجع؛ وبعدها يسقط من تلقاء نفسه.',
  'Confirm or reject before the board deadline,': 'أكّد أو ارفض قبل موعد المجلس،',
  '— after it this payment is closed automatically.': '— وبعده تُغلق هذه الدفعة تلقائيًا.',
  'Releases': 'يُفرج عن',
  'to the balance on return': 'إلى الرصيد عند الإعادة',
  'Requested on': 'طُلب في',

  'Nothing to print': 'لا شيء للطباعة',
  'This student has no reservation to put on a slip yet.': 'لا حجز لهذا الطالب يُطبع على إيصال بعد.',
  'Day': 'اليوم',
  'Verified': 'مؤكَّد',

  // ── Escrow (withdrawals) ──
  'Approved: the cash handed over is signed for.': 'تم الاعتماد: صُرف المبلغ وتم التوقيع عليه.',
  'The cash is handed over; a second person approves it (not the one who released it).': 'سُلّم المبلغ نقدًا؛ ويعتمده شخص ثانٍ (غير الذي صرفه).',


  // ── The family's home ──
  'Your children’s subjects and payments, and the next step for each.': 'مواد أبنائك ومدفوعاتهم، والخطوة التالية لكل منهم.',
  'Your subjects, payments and requests, and the next step for each.': 'موادك ومدفوعاتك وطلباتك، والخطوة التالية لكل منها.',
  'Coming up': 'القادم',

  // ── Checkout (its sentences split around the amount and the date) ──
  'A payment of': 'دفعة بقيمة',
  'was started for': 'بدأت لـ',
  'on': 'في',
  'It covers:': 'وتشمل:',
  'Transfer': 'حوّل',
  'by InstaPay, then submit the reference.': 'عبر إنستاباي، ثم أرسل المرجع.',
  'by InstaPay': 'عبر إنستاباي',
  'at the school desk': 'في مكتب المدرسة',

  // ── The family's balance with the school ("Wallet" until the lead's decision of 16 Oct 2026, 14) ──
  'Charges & Instalments': 'الرسوم والأقساط',
  'Money the school holds for each child — refunds and credits — to use on a later payment, move to another child, or take back.':
    'مبالغ تحتفظ بها المدرسة لكل ابن/ابنة — استردادات وأرصدة — تُستخدم في دفعة لاحقة، أو تُنقل إلى ابن/ابنة آخر، أو تُسترد.',
  'held for preregistered subjects (auto-applied when their session opens)': 'محتجزة لمواد مسجلة مسبقًا (تُطبَّق تلقائيًا عند فتح جلستها)',
  'Held:': 'المحتجز:',
  'transferred from': 'حُوّلت من',

  // ── The statement ──
  'Show ended reservations (expired, rejected)': 'إظهار الحجوزات المنتهية (منتهية الصلاحية، مرفوضة)',
  'Every reservation with its price and why, what is paid and what is still owed, and the payments — one per exam board deadline.':
    'كل حجز بسعره وسببه، وما دُفع وما بقي، والدفعات — دفعة لكل موعد للمجلس.',

  // ── Students ──
  'Graduation worked out from the old records (not confirmed)': 'تخرّج مستنتج من السجلات القديمة (غير مؤكد)',

  // ── The subject's form: Replace a teacher ──
  'Anything else you changed on the subject’s form stays; its teachers are read again after the replacement.':
    'ما غيّرته في نموذج المادة يبقى كما هو؛ ويُقرأ معلموها من جديد بعد الاستبدال.',

  // ── Board series: the dates, the sessions a sitting feeds ──
  'No session yet': 'لا جلسة بعد',
  'payment open': 'دفعة مفتوحة',
  'date set': 'تاريخ محدد',
  'dates set': 'تواريخ محددة',
  'none set': 'لم يُحدَّد أي منها',
  'Late fees, exams, results and certificates — the school rarely needs them; the entry deadline above is what stops reservations.':
    'الرسوم المتأخرة والامتحانات والنتائج والشهادات — نادرًا ما تحتاجها المدرسة؛ وموعد القيد أعلاه هو ما يوقف الحجوزات.',
  "A sitting appears here once a subject on a session's sheet is entered in it; add one here only to type a board's dates early.":
    'تظهر الدورة هنا حين تُقيَّد فيها مادة من كشف جلسة؛ أضفها هنا فقط لتكتب مواعيد المجلس مبكرًا.',

  // ── Settings ──
  'On this page': 'في هذه الصفحة',
  'How a reservation’s price is made from the course fee and the board’s fee.': 'كيف يُحسب سعر الحجز من رسوم التدريس ورسوم المجلس.',
  'When a reservation’s money is due.': 'متى يستحق مبلغ الحجز.',
  'How the school’s level codes are read from the units each entry covers.': 'كيف تُقرأ رموز المستويات في المدرسة من الوحدات التي يغطيها كل قيد.',

  // ── School fees: refund windows of the reservations before the rework ──
  'Refund windows (reservations made before October 2026)': 'نوافذ الاسترداد (للحجوزات قبل أكتوبر 2026)',
  'Each session carries its own refund policy, shown on its header (for June: 100% to week 2 · 50% in week 3 · 0% from week 4). These windows apply only to reservations made before the reservations were reworked, in October 2026.':
    'لكل جلسة سياسة استرداد خاصة بها تظهر في رأسها (ليونيو: 100% حتى الأسبوع 2 · 50% في الأسبوع 3 · 0% من الأسبوع 4). وهذه النوافذ تنطبق فقط على الحجوزات التي سبقت إعادة بناء الحجز في أكتوبر 2026.',
  'No refund windows: the sessions’ own refund policies apply.': 'لا نوافذ استرداد: تنطبق سياسات الاسترداد الخاصة بكل جلسة.',

  // ── The family's home: the list of the family's other pages (its name for a screen reader) ──
  'Everything else': 'كل ما عدا ذلك',

  // ── Escrow: a partial hand-over waiting for its approval ──
  'Partially Fulfilled': 'نُفِّذ جزئيًا',
  'Fulfilled': 'نُفِّذ',
  'Part of the cash is handed over; a second person approves it (not the one who released it). The rest can still be released or rejected.':
    'سُلِّم جزء من المبلغ نقدًا؛ ويعتمده شخص ثانٍ (غير من سلّمه). ويمكن بعدُ تسليم الباقي أو رفضه.',

  // ── The import review: a one-paper line ──
  'Retake — one paper only is always a retake; name the sitting it follows below.':
    'إعادة — الورقة الواحدة إعادة دائمًا؛ سمِّ الدورة التي تتبعها أدناه.',

  // ── Sign-in and sign-up ──
  "The school's subject reservations, in one place.": 'حجوزات المواد في المدرسة، في مكان واحد.',
  'Everything for exam season, from choosing subjects to paying for them, without the paperwork.': 'كل ما تحتاجه لموسم الامتحانات، من اختيار المواد حتى دفع رسومها، دون أوراق.',
  'Show password': 'إظهار كلمة المرور',
  'Hide password': 'إخفاء كلمة المرور',
  "Reserve each child's subjects": 'احجز مواد كل ابن',
  'Pay at the school desk or by InstaPay': 'ادفع في مكتب المدرسة أو عبر إنستاباي',
  'See every receipt, and what is still owed': 'اطّلع على كل إيصال وعلى ما بقي مستحقًا',
  'Reserve your own subjects and follow each one until it is paid.': 'احجز موادك وتابع كل مادة حتى تُدفع.',
  "Link each child's account, reserve their subjects, and pay at the school desk or by InstaPay.":
    'اربط حساب كل ابن، واحجز مواده، وادفع في مكتب المدرسة أو عبر إنستاباي.',
  'Create your account, then link each child and reserve their subjects.': 'أنشئ حسابك، ثم اربط كل ابن واحجز مواده.',
  'After you create the account': 'بعد إنشاء الحساب',
  "Link each child's account — your child accepts the link": 'اربط حساب كل ابن — ويقبل ابنك طلب الربط',
  'Reserve their subjects': 'احجز مواده',
  'This link is incomplete': 'هذا الرابط غير مكتمل',
  'Open the link in the email again, or copy all of it into the browser.': 'افتح الرابط من البريد مرة أخرى، أو انسخه كاملًا في المتصفح.',
  'This page is not open to your account': 'هذه الصفحة غير متاحة لحسابك',
  "It belongs to another part of the school's work. Your own pages are on your home.":
    'إنها تخص جزءًا آخر من عمل المدرسة. صفحاتك موجودة في صفحتك الرئيسية.',
  'Go to your home': 'اذهب إلى صفحتك الرئيسية',
};
