#!/usr/bin/env python3
"""F6: the checkout's money in the screens' format (EGP 14,350, the shared Money) and its sentences split
around the amount and the date, so each part has its Arabic. One file, exact edits, each asserted."""
import re
p = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/ui-audit/apps/web/app/(app)/checkout/checkout.client.tsx'
s = open(p, encoding='utf-8').read()

def once(old, new):
    global s
    assert s.count(old) == 1, (s.count(old), old[:80])
    s = s.replace(old, new)

once("import { InstantText } from '../exams/exams-shared';",
     "import { InstantText } from '../exams/exams-shared';\nimport { Money, Day } from '~/app/(app)/(sessions)/admin/sessions/sessions-shared';")
once("""            A payment of {(open.amount + open.escrowAmountApplied).toFixed(2)} EGP ({methodLabel}) was started for{' '}
            {summary.student.name} on {new Date(open.createdAt).toLocaleDateString()}. It covers:""",
     """            <span>A payment of</span> <Money amount={open.amount + open.escrowAmountApplied} /> (<span>{methodLabel}</span>) <span>was started for</span>{' '}
            <bdi>{summary.student.name}</bdi> <span>on</span> <Day iso={String(open.createdAt)} />. <span>It covers:</span>""")
once("Transfer {(openMeta.instapay?.amountDue ?? open.amount).toFixed(2)} EGP by InstaPay, then submit the reference.",
     "<span>Transfer</span> <Money amount={openMeta.instapay?.amountDue ?? open.amount} /> <span>by InstaPay, then submit the reference.</span>")
once("['Exact Amount', `${(instapay?.amountDue ?? result.amount ?? 0).toFixed(2)} EGP`],",
     "['Exact Amount', `EGP ${(instapay?.amountDue ?? result.amount ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`],")
once("(+ {escrowToApply.toFixed(2)} escrow)", "(+ <Money amount={escrowToApply} /> <span>escrow</span>)")
once("Available: {summary.escrowBalance.toFixed(2)} EGP", "<span>Available:</span> <Money amount={summary.escrowBalance} />")
once("<span>- {escrowToApply.toFixed(2)} EGP</span>", "<span>- <Money amount={escrowToApply} /></span>")
once("""                ? `Confirm ${escrowToApply.toFixed(2)} EGP from escrow`
                : `Pay ${amountDue.toFixed(2)} EGP via ${PAYMENT_METHOD_LABELS[selectedMethod]}`}""",
     """                ? <><span>Confirm</span> <Money amount={escrowToApply} /> <span>from escrow</span></>
                // "Pay EGP 14,350 at the school desk" (F6: was "Pay 14350.00 EGP via Pay at School").
                : <><span>Pay</span> <Money amount={amountDue} /> <span>{selectedMethod === 'instapay' ? 'by InstaPay' : 'at the school desk'}</span></>}""")
# The rest: "{X.toFixed(2)} EGP" in JSX text becomes the shared Money.
n = 0
def repl(m):
    global n
    n += 1
    return '<Money amount={%s} />' % m.group(1)
s = re.sub(r'\{([^{}]+?)\.toFixed\(2\)\} EGP', repl, s)
open(p, 'w', encoding='utf-8').write(s)
print('ok, Money in', n, 'more places')
