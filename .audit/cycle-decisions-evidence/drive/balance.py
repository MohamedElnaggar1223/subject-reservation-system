#!/usr/bin/env python3
"""Decision 14 (16 Oct 2026): "Wallet" and "Escrow" on the screens become "Balance" / الرصيد; "escrow" stays
the code's, the routes' and the audit's word. Each source string changed and, where a dictionary carries
its Arabic, the dictionary's key (and its Arabic) with it. Every old text must occur exactly as listed."""
import os
ROOT = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/cycle-decisions/apps/web/'
A = 'app/(app)/'

SRC = [
  (A + 'family-next.client.tsx', "label: 'Wallet',", "label: 'Balance',"),
  (A + 'home-summary.client.tsx', "'Wallet: '", "'Balance: '"),
  (A + 'page.tsx', "title: 'Escrow Balance',", "title: 'Balance',"),
  (A + '(exceptions)/admin/exceptions/exceptions-admin.client.tsx', "every deposit goes back to the family's escrow,", "every deposit goes back to the family's balance,"),
  (A + '(exceptions)/admin/exceptions/grant-form.client.tsx', "each is paid into the held wallet,", "each is paid into the held balance,"),
  (A + 'settings/settings.client.tsx', "their open checkouts are closed, any wallet money returned, and families told.", "their open checkouts are closed, any money from the balance put back, and families told."),
  (A + 'desk/desk.client.tsx', "added to the student's escrow. The family has been told.", "added to the student's balance. The family has been told."),
  (A + 'desk/desk.client.tsx', "taken back from the student's escrow. The payment can be recorded again.", "taken back from the student's balance. The payment can be recorded again."),
  (A + 'desk/desk.client.tsx', '<p className="text-xs text-muted-foreground">Escrow</p>', '<p className="text-xs text-muted-foreground">Balance</p>'),
  (A + 'desk/desk.client.tsx', 'Transfer found — credited to escrow', 'Transfer found — added to the balance'),
  (A + 'desk/desk.client.tsx', "Its amount is taken back from the student's escrow and it leaves today's takings; the payment can then be recorded again. Possible only today, and only while that escrow is unspent.",
   "Its amount is taken back from the student's balance and it leaves today's takings; the payment can then be recorded again. Possible only today, and only while that amount is unspent."),
  (A + 'desk/desk.client.tsx', "the amount that arrived is added to the student's escrow, to use on a later payment or take back as cash.", "the amount that arrived is added to the student's balance, to use on a later payment or take back as cash."),
  (A + 'desk/desk.client.tsx', 'confirmLabel="Add to Escrow"', 'confirmLabel="Add to the balance"'),
  (A + 'pending-requests/pending-requests.client.tsx', "EGP escrow credit`", "EGP to the balance`"),
  (A + '(charges)/charges/charges.client.tsx', "'Refund to escrow'", "'Refund to the balance'"),
  (A + '(charges)/charges/charges.client.tsx', "the amount goes to the family's escrow. A paper receipt", "the amount goes to the family's balance. A paper receipt"),
  (A + 'checkout/checkout.client.tsx', 'Only if you have not paid. Escrow applied to it goes back to the balance.', 'Only if you have not paid. What your balance paid toward it goes back to the balance.'),
  (A + 'checkout/checkout.client.tsx', "no payment was required because escrow covered the full amount.'", "no payment was required because your balance covered the full amount.'"),
  (A + 'checkout/checkout.client.tsx', '                  Paid from escrow\n', '                  Paid from your balance\n'),
  (A + 'checkout/checkout.client.tsx', '(+ <Money amount={escrowToApply} /> <span>escrow</span>)', '(+ <Money amount={escrowToApply} /> <span>from your balance</span>)'),
  (A + 'checkout/checkout.client.tsx', '>Apply Escrow Balance</h2>', '>Use your balance</h2>'),
  (A + 'checkout/checkout.client.tsx', '<span>Escrow applied</span>', '<span>From your balance</span>'),
  (A + 'checkout/checkout.client.tsx', '<Money amount={escrowToApply} /> <span>from escrow</span></>', '<Money amount={escrowToApply} /> <span>from your balance</span></>'),
  (A + 'takings/takings.client.tsx', 'paid from escrow\n', 'paid from balances\n'),
  (A + 'takings/takings.client.tsx', "(and {formatPrice(data.totals.correctedEscrow)} escrow)", "(and {formatPrice(data.totals.correctedEscrow)} to balances)"),
  (A + 'takings/takings.client.tsx', "and added to the family&apos;s escrow. Included in money in.", "and added to the family&apos;s balance. Included in money in."),
  (A + 'takings/takings.client.tsx', '</span> — credited to escrow', '</span> — added to the balance'),
  (A + 'takings/takings.client.tsx', "`; ${formatPrice(r.escrowAmountApplied)} from escrow, returned`", "`; ${formatPrice(r.escrowAmountApplied)} from the balance, returned`"),
  (A + 'takings/takings.client.tsx', "` (${formatPrice(r.escrowAmountApplied)} from escrow, returned)`", "` (${formatPrice(r.escrowAmountApplied)} from the balance, returned)`"),
  (A + 'finance/finance.client.tsx', "EGP returned to escrow.`", "EGP returned to the balance.`"),
  (A + 'finance/finance.client.tsx', "'Withdrawal rejected — unreleased amount returned to escrow.'", "'Withdrawal rejected — unreleased amount returned to the balance.'"),
  (A + 'finance/finance.client.tsx', "'Receipt returned — any pending drop refund has been released to escrow.'", "'Receipt returned — any pending drop refund has been released to the balance.'"),
  (A + 'finance/finance.client.tsx', "<span>escrow</span>", "<span>from the balance</span>"),
  (A + 'finance/finance.client.tsx', "<span>to escrow on return</span>", "<span>to the balance on return</span>"),
  (A + 'finance/finance.client.tsx', "EGP applied from escrow goes back`", "EGP applied from the balance goes back`"),
  (A + 'finance/finance.client.tsx', "The unreleased held amount will be returned to the student&apos;s escrow. A reason is required.", "The unreleased held amount will be returned to the student&apos;s balance. A reason is required."),
  (A + 'approvals/approvals.client.tsx', "))} escrow`", "))} to the balance`"),
  (A + 'registrations/registrations.client.tsx', 'released to escrow once the subject&apos;s', 'released to the balance once the subject&apos;s'),
  (A + 'registrations/registrations.client.tsx', 'will be credited to your escrow`', 'will be added to your balance`'),
  (A + 'registrations/registrations.client.tsx', 'leaving that amount available if escrow is applied at checkout.`', 'leaving that amount available if the balance is used at checkout.`'),
  (A + 'registrations/registrations.client.tsx', "' Same price — full escrow credit then payment of same amount required.'", "' Same price — the full amount goes to the balance, then the same amount is paid.'"),
  (A + 'registrations/history/history.client.tsx', ")} escrow credit`", ")} to the balance`"),
  (A + 'links/links.client.tsx', 'your behalf, view your registration history, and manage your escrow\n            balance. You can', 'your behalf, view your registration history, and see your balance with\n            the school. You can'),
  (A + 'escrow/escrow.client.tsx', '>My Escrow Balance</h1>', '>Your balance with the school</h1>'),
  (A + 'escrow/escrow.client.tsx', '>Wallet</h1>', '>Your balance with the school</h1>'),
  (A + 'escrow/page.tsx', "title: 'Escrow — IGCSE Reservation',", "title: 'Balance — IGCSE Reservation',"),
  (A + 'escrow/transfer/transfer.client.tsx', 'Back to Escrow', 'Back to the balance'),
  (A + 'escrow/transfer/transfer.client.tsx', '>Transfer Escrow Funds</h1>', '>Move money between children</h1>'),
  (A + 'escrow/transfer/transfer.client.tsx', 'Move funds between your linked children&apos;s escrow accounts.', 'Move money between your linked children&apos;s balances with the school.'),
  (A + 'escrow/transfer/page.tsx', "title: 'Transfer Escrow — IGCSE Reservation',", "title: 'Move balance — IGCSE Reservation',"),
  (A + 'escrow/withdraw/withdraw.client.tsx', 'Withdraw cash from a child&apos;s escrow balance. Admin will process your request.', 'Withdraw cash from a child&apos;s balance with the school. The admin processes your request.'),
  (A + 'admin/escrow/escrow-admin.client.tsx', 'Pending and partially-fulfilled escrow withdrawals — oldest first.', 'Withdrawals from families&apos; balances, pending or partly fulfilled — oldest first.'),
  (A + 'admin/escrow/escrow-admin.client.tsx', '>Escrow Balance</p>', '>Balance</p>'),
  (A + 'admin/escrow/escrow-admin.client.tsx', '>Current Escrow Balance</span>', '>Current balance</span>'),
  (A + 'admin/escrow/escrow-admin.client.tsx', 'The unreleased held amount will be returned to escrow.', 'The unreleased held amount will be returned to the balance.'),
  (A + 'exams/series/series.client.tsx', '(wallet money returned, families told)', '(money from the balance put back, families told)'),
  ('components/student-academic-panel.tsx', 'their open checkouts close with any escrow returned, and the family is told.', 'their open checkouts close with any money from the balance put back, and the family is told.'),
  ('components/reservations/statement.tsx', '<Total label="Escrow"', '<Total label="Balance"'),
  ('components/reservations/statement.tsx', '<p className="text-xs text-muted-foreground">Escrow</p>', '<p className="text-xs text-muted-foreground">Balance</p>'),
  ('components/reservations/statement.tsx', '<span>from escrow</span>', '<span>from the balance</span>'),
  ('components/reservations/reserve.tsx', '>Escrow to apply (EGP)</label>', '>Balance to use (EGP)</label>'),
]

# Dictionaries: (file, old text, new text) — keys and Arabic together.
DICT = [
  ('lib/i18n.tsx', "    'nav.escrow': 'Escrow',", "    'nav.escrow': 'Balance withdrawals',"),
  ('lib/i18n.tsx', "    'nav.escrowBalance': 'Wallet',", "    'nav.escrowBalance': 'Balance',"),
  ('lib/i18n.tsx', "    'nav.escrow': 'الرصيد',", "    'nav.escrow': 'سحوبات الرصيد',"),
  ('lib/i18n.tsx', "    'nav.escrowBalance': 'المحفظة',", "    'nav.escrowBalance': 'الرصيد',"),
  ('lib/i18n.tsx', "  'Your registrations have been confirmed — no payment was required because escrow covered the full amount.': 'تم تأكيد تسجيلاتك - لم يكن الدفع مطلوبًا لأن الرصيد غطى المبلغ بالكامل.',",
   "  'Your registrations have been confirmed — no payment was required because your balance covered the full amount.': 'تم تأكيد تسجيلاتك - لم يكن الدفع مطلوبًا لأن رصيدك غطى المبلغ بالكامل.',"),
  ('lib/i18n.tsx', "  'Paid from escrow': 'مدفوع من الرصيد',", "  'Paid from your balance': 'مدفوع من رصيدك',"),
  ('lib/i18n.tsx', "  'Apply Escrow Balance': 'استخدام رصيد الحساب',", "  'Use your balance': 'استخدم رصيدك',"),
  ('lib/i18n.tsx', "  'Escrow applied': 'تم استخدام الرصيد',", "  'From your balance': 'من رصيدك',\n  'from your balance': 'من رصيدك',"),
  ('lib/i18n.tsx', "  'Same price — full escrow credit then payment of same amount required.': 'نفس السعر - سيتم إضافة رصيد كامل ثم يلزم دفع نفس المبلغ.',",
   "  'Same price — the full amount goes to the balance, then the same amount is paid.': 'نفس السعر - يذهب المبلغ كاملًا إلى الرصيد، ثم يُدفع المبلغ نفسه.',"),
  ('lib/i18n.tsx', "  'Back to Escrow': 'العودة للرصيد',", "  'Back to the balance': 'العودة إلى الرصيد',"),
  ('lib/i18n.tsx', "  'Transfer Escrow Funds': 'تحويل رصيد الحساب',", "  'Move money between children': 'نقل المال بين الأبناء',"),
  ('lib/i18n.tsx', "  'Current Escrow Balance': 'رصيد الحساب الحالي',", "  'Current balance': 'الرصيد الحالي',"),
  ('lib/i18n.tsx', "  'My Escrow Balance': 'رصيد حسابي',", "  'Your balance with the school': 'رصيدك لدى المدرسة',"),
  ('lib/i18n.tsx', "  'Withdraw cash from a child&apos;s escrow balance. Admin will process your request.': 'اسحب نقدًا من رصيد ابنك/ابنتك. ستعالج الإدارة طلبك.',\n  \"Withdraw cash from a child's escrow balance. Admin will process your request.\": 'اسحب نقدًا من رصيد ابنك/ابنتك. ستعالج الإدارة طلبك.',",
   "  \"Withdraw cash from a child's balance with the school. The admin processes your request.\": 'اسحب نقدًا من رصيد ابنك أو ابنتك لدى المدرسة. تعالج الإدارة طلبك.',"),
  ('lib/i18n.tsx', "  'Move funds between your linked children&apos;s escrow accounts.': 'حوّل الأموال بين حسابات الرصيد الخاصة بأبنائك المرتبطين.',\n  \"Move funds between your linked children's escrow accounts.\": 'حوّل الأموال بين حسابات الرصيد الخاصة بأبنائك المرتبطين.',",
   "  \"Move money between your linked children's balances with the school.\": 'انقل المال بين أرصدة أبنائك المرتبطين لدى المدرسة.',"),
  ('lib/i18n.tsx', "  'Pending and partially-fulfilled escrow withdrawals — oldest first.': 'طلبات السحب المعلقة والمنفذة جزئيًا - الأقدم أولًا.',",
   "  \"Withdrawals from families' balances, pending or partly fulfilled — oldest first.\": 'طلبات السحب من أرصدة الأسر، المعلقة أو المنفذة جزئيًا - الأقدم أولًا.',"),
  ('lib/i18n.tsx', "  'Escrow — IGCSE Reservation': 'الرصيد - حجز IGCSE',", "  'Balance — IGCSE Reservation': 'الرصيد - حجز IGCSE',"),
  ('lib/i18n.tsx', "  'Transfer Escrow — IGCSE Reservation': 'تحويل الرصيد - حجز IGCSE',", "  'Move balance — IGCSE Reservation': 'نقل الرصيد - حجز IGCSE',"),
  ('lib/i18n.tsx', "  const escrowCreditMatch = /^(.+) EGP escrow credit$/.exec(text);\n  if (escrowCreditMatch) return `رصيد مضاف ${escrowCreditMatch[1]} جنيه`;",
   "  const escrowCreditMatch = /^(.+) EGP to the balance$/.exec(text);\n  if (escrowCreditMatch) return `${escrowCreditMatch[1]} جنيه إلى الرصيد`;"),
  ('lib/i18n-money.ts', "  'Refund to escrow': 'استرداد إلى الرصيد',", "  'Refund to the balance': 'استرداد إلى الرصيد',"),
  ('lib/i18n-money.ts', "every deposit goes back to the family's escrow, the unpaid instalments", "every deposit goes back to the family's balance, the unpaid instalments"),
  ('lib/i18n-money.ts', "the amount goes to the family's escrow\\. A paper receipt", "the amount goes to the family's balance\\. A paper receipt"),
  ('lib/i18n-money.ts', "'; each is paid into the held wallet, and the line is paid from them at the last.", "'; each is paid into the held balance, and the line is paid from them at the last."),
  ('lib/i18n-money.ts', "'؛ يُدفع كل قسط في المحفظة المحجوزة،", "'؛ يُدفع كل قسط في الرصيد المحجوز،"),
  ('lib/i18n-money.ts', "'{who} pays {scope} in {value}, each into the held wallet; the line is paid from them at the last': 'يدفع {who} {scope} على {value}، كلٌّ منها في المحفظة المحجوزة؛",
   "'{who} pays {scope} in {value}, each into the held balance; the line is paid from them at the last': 'يدفع {who} {scope} على {value}، كلٌّ منها في الرصيد المحجوز؛"),
  ('lib/i18n-money.ts', " * رسم, an instalment قسط, the held wallet المحفظة المحجوزة,", " * رسم, an instalment قسط, the held balance الرصيد المحجوز,"),
  ('lib/i18n-reservations.ts', "  'Escrow to apply (EGP)': 'المبلغ من المحفظة (جنيه)',", "  'Balance to use (EGP)': 'المبلغ من الرصيد (جنيه)',"),
  ('lib/i18n-reservations.ts', "  'Escrow': 'المحفظة',", "  'Escrow': 'الرصيد',"),
  ('lib/i18n-reservations.ts', "  'from escrow': 'من المحفظة',", "  'from the balance': 'من الرصيد',"),
  ('lib/i18n-ui-audit.ts', "  'to escrow on return': 'إلى الرصيد عند الإعادة',", "  'to the balance on return': 'إلى الرصيد عند الإعادة',"),
  ('lib/i18n-ui-audit.ts', "  // ── The wallet (the family's escrow) ──\n  'Wallet': 'المحفظة',", "  // ── The family's balance with the school (\"Wallet\" until the lead's decision of 16 Oct 2026, 14) ──"),
  ('lib/i18n-ui-audit.ts', " * wallet المحفظة, the desk المكتب.", " * balance الرصيد (the lead's decision of 16 Oct 2026, 14; was the wallet), the desk المكتب."),
  ('lib/i18n-focus.ts', "  'In the wallet:': 'في المحفظة:',", "  'In the balance:': 'في الرصيد:',"),
  ('lib/i18n-focus.ts', " * fee المصاريف الدراسية, the wallet المحفظة,", " * fee المصاريف الدراسية, the balance الرصيد,"),
  ('lib/i18n-sessions.ts', "(wallet money returned, families told)", "(money from the balance put back, families told)"),
  ('lib/i18n-sessions.ts', "(ويعود مال المحفظة وتُبلَّغ الأسر)", "(ويعود ما أُخذ من الرصيد وتُبلَّغ الأسر)"),
  ('lib/i18n-catalogue.ts', "(يُعاد رصيد المحفظة وتُبلَّغ الأسر)", "(يُعاد ما أُخذ من الرصيد وتُبلَّغ الأسر)"),
  ('lib/i18n-foundation/core.ts', "their open checkouts are closed, any wallet money returned, and families told.':", "their open checkouts are closed, any money from the balance put back, and families told.':"),
  ('lib/i18n-foundation/core.ts', "ويُعاد أي مبلغ إلى المحفظة،", "ويُعاد ما أُخذ من الرصيد،"),
  ('../../packages/validations/src/exception/policies.ts', "'{who} pays {scope} in {value}, each into the held wallet; the line is paid from them at the last'", "'{who} pays {scope} in {value}, each into the held balance; the line is paid from them at the last'"),
  ('lib/i18n-foundation/students.ts', "their open checkouts close with any escrow returned, and the family is told.", "their open checkouts close with any money from the balance put back, and the family is told."),
]

MANY = ('Back to Escrow', 'ويُعاد أي مبلغ إلى المحفظة،')
def check(rel, old):
    s = open(os.path.join(ROOT, rel), encoding='utf-8').read()
    n = s.count(old)
    if n == 0 or (n > 1 and old not in MANY):
        return f'{n} times in {rel}: {old[:90]!r}'

problems = [p for p in (check(r, o) for r, o, _ in SRC + DICT) if p]
if problems:
    raise SystemExit('\n'.join(problems))
for rel, old, new in SRC + DICT:
    p = os.path.join(ROOT, rel)
    s = open(p, encoding='utf-8').read()
    open(p, 'w', encoding='utf-8').write(s.replace(old, new))
print('applied', len(SRC), 'source and', len(DICT), 'dictionary edits')
