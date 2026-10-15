#!/usr/bin/env python3
"""F6: the family's wallet pages (escrow, withdraw, transfer) — the money as the screens write it, the
wallet's title in a family's words, the dates the school's. Exact edits, each asserted."""
import re
B = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/ui-audit/apps/web/app/(app)/escrow/'
MONEY_IMPORT = "import { Money, Day } from '~/app/(app)/(sessions)/admin/sessions/sessions-shared';\nimport { InstantText } from '~/app/(app)/exams/exams-shared';\n"
EGP = "`EGP ${%s.toLocaleString('en-US', { maximumFractionDigits: 2 })}`"

def edit(path, pairs, add_import=True):
    s = open(path, encoding='utf-8').read()
    for old, new in pairs:
        assert s.count(old) == 1, (path, s.count(old), old[:90])
        s = s.replace(old, new)
    if add_import:
        s = s.replace("import { Button } from '~/components/ui/button';\n", "import { Button } from '~/components/ui/button';\n" + MONEY_IMPORT, 1)
    open(path, 'w', encoding='utf-8').write(s)

edit(B + 'escrow.client.tsx', [
    ("""            {(balance?.balance ?? 0).toFixed(2)}{' '}
            <span className="text-lg text-muted-foreground font-normal font-sans">EGP</span>""",
     """            <Money amount={balance?.balance ?? 0} />"""),
    ("""              + {heldBalance.toFixed(2)} EGP held for preregistered subjects
              (auto-applied when their session opens)""",
     """              + <Money amount={heldBalance} /> <span>held for preregistered subjects (auto-applied when their session opens)</span>"""),
    ("""Escrow Management</h1>""", """Wallet</h1>"""),
    ("""            Manage your children&apos;s escrow balances.""",
     """            Money the school holds for each child — refunds and credits — to use on a later payment, move to another child, or take back."""),
    ("""                <div className="text-right">
                  <p className="text-lg font-bold text-foreground font-display">
                    {child.escrowBalance.toFixed(2)}
                  </p>
                  <p className="text-xs text-muted-foreground">EGP</p>""",
     """                <div className="text-end">
                  <p className="text-lg font-bold text-foreground font-display">
                    <Money amount={child.escrowBalance} />
                  </p>"""),
    ("""                      + {(child.heldBalance ?? 0).toFixed(2)} held""",
     """                      + <Money amount={child.heldBalance ?? 0} /> <span>held</span>"""),
    ("""              Balance: {(balance?.balance ?? 0).toFixed(2)} EGP
              {heldBalance > 0 && (
                <span className="text-violet-700 dark:text-violet-400"> · Held: {heldBalance.toFixed(2)} EGP</span>
              )}""",
     """              <span>Balance:</span> <Money amount={balance?.balance ?? 0} />
              {heldBalance > 0 && (
                <span className="text-violet-700 dark:text-violet-400"> · <span>Held:</span> <Money amount={heldBalance} /></span>
              )}"""),
    ("""                {new Date(tx.createdAt).toLocaleString()}""", """                <InstantText iso={String(tx.createdAt)} />"""),
    ("""              {tx.type === 'credit' ? '+' : '-'} {tx.amount.toFixed(2)} EGP""",
     """              {tx.type === 'credit' ? '+' : '-'} <Money amount={tx.amount} />"""),
])

edit(B + 'withdraw/withdraw.client.tsx', [
    ("""                    {child.name} — {child.escrowBalance.toFixed(2)} EGP available""",
     """                    {child.name} — {%s} available""" % (EGP % 'child.escrowBalance')),
    ("""                      {new Date(req.createdAt).toLocaleDateString()}""", """                      <Day iso={String(req.createdAt)} />"""),
    ("""{req.requestedAmount.toFixed(2)} EGP</span>""", """<Money amount={req.requestedAmount} /></span>"""),
    ("""{req.releasedAmount.toFixed(2)} EGP</span>""", """<Money amount={req.releasedAmount} /></span>"""),
])

edit(B + 'transfer/transfer.client.tsx', [
    ("""            {parsedAmount.toFixed(2)} EGP transferred from {fromChild?.name} to {toChild?.name}.""",
     """            <Money amount={parsedAmount} /> <span>transferred from</span> <bdi>{fromChild?.name}</bdi> <span>to</span> <bdi>{toChild?.name}</bdi>."""),
    ("""                  {child.name} ({gradeLabel(child.grade)}) — {child.escrowBalance.toFixed(2)} EGP
                </option>
              ))}
            </select>
            {fromChild && (""",
     """                  {child.name} ({gradeLabel(child.grade)}) — {%s}
                </option>
              ))}
            </select>
            {fromChild && (""" % (EGP % 'child.escrowBalance')),
    ("""Available balance: <span className="font-semibold text-foreground">{fromChild.escrowBalance.toFixed(2)} EGP</span>""",
     """<span>Available balance:</span> <span className="font-semibold text-foreground"><Money amount={fromChild.escrowBalance} /></span>"""),
    ("""                  {child.name} ({gradeLabel(child.grade)}) — {child.escrowBalance.toFixed(2)} EGP""",
     """                  {child.name} ({gradeLabel(child.grade)}) — {%s}""" % (EGP % 'child.escrowBalance')),
])
print('ok')
