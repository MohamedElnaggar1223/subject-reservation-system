
# ═══════════════════════════════════════════ PART 3 ═══════════════════════════════════════════
part('p3', "Part 3 — The student's journey",
     'A grade-11 student, <i>Student One</i> (<code>student1@igcse.local</code>), in the same family as Part 4\'s parent. In the forms the student filled one Google Form per subject; here the student reserves on one page and the request waits for the parent, who pays.')
group('The account and the link')
step('Sign up', f'<p>On the sign-in page {L("Create one")} → {L("I\'m a Student")}: {L("Full Name")}, {L("Email Address")}, {L("Current Grade")} (11 — "Second year of IGCSE"), {L("Password")}, {L("Confirm Password")}, {L("Create Student Account")}.</p>',
     form=Q('Every form asked: "Student full Name", "Grade Level & Class", "Student Mobile Number", "Student Email address" — once per subject. Here once.'), img='p3-01-student-sign-up')
step('Home', '<p>Home says the next step: June 2027 is open for reservations.</p>', img='p3-02-student-home')
step("The parent's link request", f'<p>When the parent asks to link (Part 4, step [[parent-link]]): {L("Linked Parents")} → {L("Pending Requests")} → {L("Approve")}.</p>', img='p3-03-link-request', key='student-link')
step('Linked', '', img='p3-04-link-approved')
group('Reserving, as the forms asked')
step('Choose a teacher', f'<p>{L("Reserve Subjects")}: the open session is chosen. Tick {L("Arabic: All papers")}; {L("Teacher")} "Teacher 2"; {L("Entry")} "First entry, in school". The price is shown at once.</p>',
     form=Q('Arabic O.L.: Teacher "T1, T2, T3" · "First Entry in School 100% fees (All Papers)"'), img='p3-05-student-reserve')
step('A one-paper retake, with its sitting', f'<p>Tick {L("Chemistry: Paper 41/42 only (retake)")}: it is a retake in self study; name {L("Carried from the sitting…")} "Cambridge International June 2026". The school verifies it ("to be verified by the school").</p>',
     form=Q('"Retake Self Study 50% fees (Paper 41/42 ONLY)": From June 2026 / From November 2026 / None'), img='p3-05b-student-reserve-retake')
step('Send to my parent', f'<p>Tick the refund policy and the declaration, {L("Send to my parent")}: "Sent to your parent for approval".</p>',
     form=Q('"I confirm that I read the refund policy" · "I confirm that the information given in this form is true, complete and accurate."'), img='p3-06-student-sent-to-parent')
step('The request waits for the parent', '<p>Home: "subjects waiting for your parent\'s approval". The parent approves (Part 4, step [[parent-approve]]).</p>', img='p3-07-student-home-waiting')
group('Later: a drop, the statement, the notifications')
step('My Registrations', f'<p>{L("My Registrations")}: each subject with its state and its receipt ("keep it safe, it must be returned if you drop or swap this subject").</p>', img='p3-08-student-registrations')
step('Ask to drop a subject', f'<p>On Physics {L("Request Drop")}: the refund it would bring is shown before anything is asked ("100% = EGP 16,850 … released to the balance once the subject\'s receipt is returned"); a {L("Reason")}; {L("Submit Request")}.</p>',
     form=Q('"Please choose one of the options": "I confirm my registration" / "I will drop the course"'), img='p3-09-student-request-drop')
step('The request waits', f'<p>{L("Pending Requests")}: the drop, waiting for the parent, with its effect on the balance.</p>', img='p3-10-student-pending-requests')
step('My statement', f'<p>{L("Statement")}: every subject with its price and how it is made ("course 12,000 × 50% + board 10,850 × 100%"), what is paid, what is owed and by when, the receipt; the payments per board deadline; the balance.</p>', img='p3-11-student-statement')
step('Notifications', f'<p>{L("Notifications")}: the drop approved, the payment reminder and the school\'s message, the approval, the payments confirmed.</p>', img='p3-12-student-notifications')

# ═══════════════════════════════════════════ PART 4 ═══════════════════════════════════════════
part('p4', "Part 4 — The parent's journey",
     '<i>Parent One</i> (<code>parent1@igcse.local</code>), Student One\'s parent. On the forms the parent typed the guardian\'s name, email and mobile on every form and paid at the desk with no price in writing; here the parent links the child once, reserves, pays per board, and sees every price, receipt and refund.')
group('The account and the child')
step('Sign up', f'<p>{L("Create one")} → {L("I\'m a Parent")}: {L("Full Name")}, {L("Email Address")}, {L("Password")}, {L("Confirm Password")}, {L("Create Parent Account")}.</p>',
     form=Q('"Guardian Name · Guardian Email Address · Guardian Mobile Number" — on each of the 25 forms'), img='p4-01-parent-sign-up')
step('Home: start by linking the child', f'<p>"Start by linking your child" → {L("Link my child")}.</p>', img='p4-02-parent-home-no-child')
step("Link the child", f'<p>{L("Linked Children")} → {L("+ Add Child")} → {L("Student Email or Student ID")} → {L("Send Request")}. The child approves it (Part 3, step [[student-link]]).</p>', img='p4-03-link-child', key='parent-link')
step('Awaiting the child', '', img='p4-04-link-awaiting')
step("Home: the next step", f'<p>With the child linked, Home names the next step for each child: {L("Reserve subjects")}.</p>', img='p4-05-parent-home-next-step')
group('Reserving for the child')
step('Reserve Subjects', f'<p>{L("Reserve Subjects")}: the only child and the open session are chosen.</p>', img='p4-06-reserve-page')
step('Biology, with a teacher', f'<p>Tick {L("Biology: All papers")}, {L("Teacher")} "Teacher 4", first entry in school: EGP 22,850.</p>',
     form=Q('Biology O.L.: Teacher "T1, T2, T3"'), img='p4-07a-reserve-biology')
step('Mathematics, and a self-study retake of Physics', f'<p>{L("Mathematics: All papers")} with Teacher 21; {L("Physics: All papers")} with {L("Entry")} "Retake, self-study — name the sitting" and "Cambridge International June 2026": EGP 16,850, the school\'s fee halved.</p>',
     form=Q('Physics O.L.: "Retake Self Study 50% fees (All Papers)" Yes', '"Self Study 50% (ONLY 2nd entry)"'), img='p4-07b-reserve-maths-physics')
step('The total, per board, and the two confirmations', f'<p>"3 reservations · EGP 60,900", due 30 Nov 2026, paid per entry deadline: Cambridge 39,700, Pearson 21,200. Tick both confirmations, {L("Reserve (3)")}.</p>',
     form=Q('"I confirm that I read the refund policy" · "Student Declaration"'), img='p4-07c-reserve-consents')
step('Reserved', f'<p>"Reserved: 3 reservations awaiting payment. Pay by exam series on the next screen." {L("Pay now →")}.</p>', img='p4-08-reserved')
group('Paying')
step('Home: what is owed and by when', '<p>Home: "June 2027: EGP 60,900 to pay — due by 30 Nov 2026" and Pay now.</p>', img='p4-09-home-pay-now')
step('Pay by exam board', f'<p>The subjects of boards with different entry deadlines are paid one board at a time: Pearson Edexcel June 2027 (Mathematics, EGP 21,200) and Cambridge International June 2027 (Biology, Physics, EGP 39,700), each {L("Pay for this series")}.</p>', img='p4-10-checkout-by-board')
step('Cambridge, by InstaPay', f'<p>{L("InstaPay")}, {L("Pay EGP 39,700 by InstaPay")}.</p>', img='p4-11-checkout-instapay')
step("The school's account, and the transfer's reference", f'<p>The school\'s bank, account name and number and the exact amount; after transferring, the {L("Transaction reference from your InstaPay receipt")} → {L("Submit Reference")}. Finance confirms it against the bank statement (Part 2, step [[workbench]]).</p>', img='p4-12-instapay-details')
step('Reference sent', '', img='p4-13-instapay-reference-sent')
step('Pearson, at the school desk', f'<p>{L("My Registrations")}: tick Mathematics, {L("Pay Selected")} → {L("Pay at School")}. (Home\'s Pay now leads to the three subjects together, whose checkout now says "Payment already started": a finding.)</p>', img='p4-14-registrations-pay-selected')
step('The reference to quote at the desk', '<p>Quote it (or the child\'s name) at the desk and pay; the line is paid when the finance officer records it (Part 2).</p>', img='p4-15-pay-at-desk-reference')
group("The child's request, a drop and the balance")
step("Home: the child's request", '<p>When the child sends a request (Part 3): "subjects waiting for your approval" → Approve.</p>', img='p4-16-parent-home-approval')
step('Approve', f'<p>{L("Approvals")}: the child\'s subjects with their prices; {L("Select all")}, {L("Approve Selected")}, {L("Confirm Approval")}.</p>', img='p4-17-approvals', key='parent-approve')
step('Approved', f'<p>"Proceed to Payment" — or later, as the reminders will say.</p>', img='p4-18-approved')
step('A reminder, and the school\'s message', f'<p>{L("Notifications")}: the payment reminder the school sent from the Money tab ("… is due on 20 December 2026 …", in English and Arabic) and its message to the unpaid families.</p>', img='p4-25-parent-notifications')
step("The child asks to drop a subject", f'<p>Home: "1 drop or swap request to review" → {L("Review")}.</p>', img='p4-19-parent-home-drop-request', key='parent-drop')
step('The drop request', f'<p>{L("Drop & Swap Requests")}: Physics, its price and what the drop puts back on the balance (+EGP 16,850).</p>', img='p4-20-approvals-drop-request')
step('Approve the drop', f'<p>{L("Approve")} → {L("Confirm Approval")}.</p>', img='p4-21-approve-drop')
step('Bring the receipt back', '<p>My Registrations: "Dropped — Return Receipt to School": the refund is released when the paper receipt is back at the desk (Part 2).</p>', img='p4-22-drop-bring-receipt')
step('The statement after the drop', f'<p>{L("Statement")}: Physics dropped and refunded (EGP 16,850), what is still owed with its due date, every receipt and payment.</p>', img='p4-23-statement-after-drop')
step('The balance', f'<p>{L("Balance")}: "Your balance with the school" — the refund, to use on a later payment, move to another child, or take back ({L("Request Withdrawal")}).</p>', img='p4-24-balance')
step('A receipt', f'<p>From My Registrations, {L("View")} on a receipt.</p>', img='p4-26-parent-receipt')
step('Take the balance back', f'<p>{L("Balance")} → {L("Request Withdrawal")}: the child, the {L("Amount (EGP)")}, {L("Submit Withdrawal Request")}. The cash is handed over at the desk (Part 2).</p>', img='p4-30-request-withdrawal', key='parent-withdraw')
step('History', f'<p>{L("History")}: every subject\'s record — reserved, approved, paid, dropped, refunded — for the child chosen.</p>', img='p4-31-history')
step('School Fee', f'<p>{L("School Fee")}: the year\'s fee and whether it is due (none in this demo).</p>', img='p4-32-school-fee')
step('Charges & Instalments', f'<p>{L("Charges & Instalments")}: what is owed beside the subjects (nothing here).</p>', img='p4-33-charges-instalments')
step('Profile', '', img='p4-34-profile')
group('In Arabic')
step('Switch to Arabic', f'<p>{L("Arabic")} at the foot of the sidebar: every screen reads right to left in Arabic; names, codes and board names stay as written.</p>', img='p4-27-parent-home-arabic')
step('The statement in Arabic', '', img='p4-28-parent-statement-arabic')
step('Reserve in Arabic', '', img='p4-29-parent-reserve-arabic')
