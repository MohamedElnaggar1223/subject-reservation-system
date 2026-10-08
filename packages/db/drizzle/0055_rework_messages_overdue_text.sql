-- Reservations rework, step D, the review of 9e7a4d6..9037be2 (follow-up 2): the school's overdue
-- payment text names everything overdue, each item with its own date ({items}: "Biology (overdue
-- since 4 October 2026) and A lab coat (overdue since 6 October 2026)"), under one sum. The old text
-- put the sum under one date ("{amount} ... ({items}) was due on {due}"), which is not true of a
-- family behind on two dates. Changed only where the school has not rewritten the text itself.
UPDATE message_template
SET body_en = 'Dear {guardian}, {amount} for {student} is overdue and still unpaid: {items}. Please pay in the app or at the school''s finance desk.',
    body_ar = 'عزيزي ولي الأمر {guardian}، مبلغ {amount} الخاص بـ {student} متأخر ولم يُسدَّد بعد: {items}. يرجى الدفع من التطبيق أو في مكتب الشؤون المالية بالمدرسة.',
    updated_at = now()
WHERE id = 'tpl-payment-overdue'
  AND body_en = 'Dear {guardian}, {amount} for {student} ({items}) was due on {due} and is still unpaid. Please pay in the app or at the school''s finance desk.'
  AND body_ar = 'عزيزي ولي الأمر {guardian}، كان مبلغ {amount} الخاص بـ {student} ({items}) مستحقًا في {due} ولم يُسدَّد بعد. يرجى الدفع من التطبيق أو في مكتب الشؤون المالية بالمدرسة.';
