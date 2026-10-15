/**
 * Arabic for F6, the UI audit of the reservation cycle (docs/features/UI_AUDIT.md): the words F6 adds
 * or rewrites on the cycle's screens. Merged into the page translator in lib/i18n.tsx as the other
 * screens' files are (exact English text → Arabic; numbers, names and dates are their own text nodes,
 * so every entry here is words only), and before them: where F6 rewrote a sentence whose old Arabic
 * read the model's words ("السطر" for a reservation line), the entry here is the one used.
 *
 * Words, as the rest of the app has them: a session الجلسة, the links sheet الكشف, a reservation حجز,
 * a board المجلس, a sitting الدورة, the statement كشف الحساب, the school fee المصاريف الدراسية, the
 * wallet المحفظة, the desk المكتب.
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
};
