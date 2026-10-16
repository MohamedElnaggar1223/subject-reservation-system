"""Insert the remaining screens' steps into the generator, each where it belongs in the cycle."""
p2 = '/tmp/f8/gen_part2b.py'
s = open(p2).read()

def after(anchor, text):
    global s
    i = s.index(anchor)
    j = s.index('\n', i) + 1
    # the step call may span lines: insert after the line that ends the call (the next line starting with "step(" or "group(" or EOF)
    k = j
    while k < len(s) and not (s.startswith('step(', k) or s.startswith('group(', k) or s.startswith('for ', k) or s.startswith('\n', k)):
        k = s.index('\n', k) + 1
    s = s[:k] + text + s[k:]

after("step('The A.S./A.L. part of the sheet'", """step('Board Series: every sitting with its dates', f'<p>The same dates live on {L("Board Series")}: every board\\'s sitting of the academic year, its entry deadline with the days left, what it will close and how many reservations wait — the place for a sitting no subject uses yet.</p>', img='p2-83-board-series')
step('Grade 10', f'<p>The session\\'s {L("Grade 10")} tab ticks the core subjects every grade-10 student sits in June, which the school can then reserve for its grade 10 at once. No June 2027 form has a grade-10 class (Q-10): the demo leaves it empty.</p>', form=Q('"Grade Level & Class": 11A … 12D — no grade-10 class on any form'), img='p2-86-grade-10')
""")
after("step('Pearson Edexcel June 2027, priced'", """step('Board Services', f'<p>{L("Board Services")}: what a reservation can carry beside the subject — cash-in, late cash-in, a certificate split — with each board\\'s fee per sitting, set the same way when the board publishes them.</p>', img='p2-84-board-services')
step('School Fees', f'<p>{L("School Fees")}: the year\\'s school fee, if the school sets one, blocks reserving until it is paid and can be pushed to the families. The forms ask none: "No fee schedules yet — the registration gate is off".</p>', img='p2-85-school-fees')
""")
after("step('A receipt', '', img='p2-45-receipt-print')", """step('Students', f'<p>{L("Students")}: every student with the grade they are in today and where they stand; the desk family is here.</p>', img='p2-87-students')
step("A student's record", '<p>The grade, the cohort, the sessions open to the student, the record\\'s changes — and buttons to the candidate\\'s details and to the desk.</p>', img='p2-88-student-record')
""")
after("step('Their receipts'", """step('Daily Takings', f'<p>{L("Daily Takings")}: the day\\'s money at the desk, by instrument, to close the drawer against.</p>', img='p2-90-daily-takings')
""")
after("step('Sent', f'<p>{L(\"Sent\")}", """step('Charges', f'<p>{L("Charges")}: what families owe beside the subjects — instalments, board services, the pushed school fee, adjustments. None in this cycle yet.</p>', img='p2-89-charges')
""")
after("step('The refund, to the balance'", """step('The balance, taken back as cash', f'<p>If the family wants the refund in cash (Part 4, step [[parent-withdraw]]), the finance officer sees it under {L("Cash refunds to hand out")} on the Finance Workbench.</p>', img='p2-79-workbench-cash-refund')
step('Release the cash', f'<p>{L("Release Cash")}: the amount handed over, {L("Record Release")}.</p>', img='p2-80-workbench-release-cash')
step('A second person approves it', f'<p>{L("Balance withdrawals")} (the admin or the finance admin, never the one who released it): "The cash is handed over; a second person approves it" → {L("Approve")}.</p>', img='p2-81-balance-withdrawals')
step('Signed for', '', img='p2-82-balance-withdrawal-approved')
""")
after("group('The entries to the board')", """step('Exam Deadlines', f'<p>{L("Exam Deadlines")}: the entry and retake deadlines of every sitting, the next one first.</p>', img='p2-91-exam-deadlines')
""")
after("step('Home, with the cycle running'", """step("The coordinator's Home", '<p>Each role lands on its own next step: the coordinator sees the same session with what the sheet still needs and the sittings to verify.</p>', img='p2-94-coordinator-home')
step("A teacher's Home", '<p>A teacher\\'s screens (lessons, attendance, forecasts) come after the reservation cycle; until then a teacher has the notifications and the profile.</p>', img='p2-95-teacher-home')
step('Notifications', f'<p>Every account has {L("Notifications")} …</p>', img='p2-92-admin-notifications')
step('Profile', f'<p>… and {L("Profile")}.</p>', img='p2-93-profile')
""")
open(p2, 'w').write(s)

p4 = '/tmp/f8/gen_part34.py'
s4 = open(p4).read()
anchor = "step('A receipt', f'<p>From My Registrations, {L(\"View\")} on a receipt.</p>', img='p4-26-parent-receipt')\n"
assert anchor in s4
s4 = s4.replace(anchor, anchor + """step('Take the balance back', f'<p>{L("Balance")} → {L("Request Withdrawal")}: the child, the {L("Amount (EGP)")}, {L("Submit Withdrawal Request")}. The cash is handed over at the desk (Part 2).</p>', img='p4-30-request-withdrawal', key='parent-withdraw')
step('History', f'<p>{L("History")}: every subject\\'s record — reserved, approved, paid, dropped, refunded — for the child chosen.</p>', img='p4-31-history')
step('School Fee', f'<p>{L("School Fee")}: the year\\'s fee and whether it is due (none in this demo).</p>', img='p4-32-school-fee')
step('Charges & Instalments', f'<p>{L("Charges & Instalments")}: what is owed beside the subjects (nothing here).</p>', img='p4-33-charges-instalments')
step('Profile', '', img='p4-34-profile')
""")
open(p4, 'w').write(s4)
print('ok')
