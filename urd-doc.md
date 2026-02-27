# IGCSE Subject Reservation System — User Requirements Document (URD)

## Document Information

| Field | Value |
|-------|-------|
| Project | IGCSE Subject Reservation System |
| Document | User Requirements Document |
| Version | 1.0 |
| Date | January 2026 |

---

## Personas Reference

| ID | Persona |
|----|---------|
| P01 | Admin |
| P02 | Student |
| P03 | Parent |

---

## Priority Definitions

| Priority | Definition |
|----------|------------|
| P0 | Critical — Core functionality, system cannot launch without it |
| P1 | High — Important feature, needed for full workflow completion |
| P2 | Medium — Enhances user experience, can be added post-launch |
| P3 | Low — Nice to have, future consideration |

---

## 1. Authentication & Account Management

| ID | User Story | Persona(s) | Acceptance Criteria | Priority |
|----|------------|------------|---------------------|----------|
| AUTH-001 | As a student, I can create an account with my email and password | P02 | - Email must be unique<br>- Password meets security requirements (min 8 chars, 1 uppercase, 1 number)<br>- Email verification required<br>- Student selects their current grade (10, 11, 12) during registration | P0 |
| AUTH-002 | As a parent, I can create an account with my email and password | P03 | - Email must be unique<br>- Password meets security requirements<br>- Email verification required | P0 |
| AUTH-003 | As a parent, I can link my children (students) to my account | P03 | - Parent can add child by student email or unique student ID<br>- Student receives notification of link request<br>- Student must approve the link<br>- Parent can link multiple children | P0 |
| AUTH-004 | As a student, I can approve or reject a parent link request | P02 | - Student sees pending link requests<br>- Student can approve or reject<br>- Parent notified of decision | P0 |
| AUTH-005 | As a user, I can log in with my email and password | P01, P02, P03 | - Successful login redirects to appropriate dashboard<br>- Failed login shows error message<br>- Account lockout after 5 failed attempts | P0 |
| AUTH-006 | As a user, I can reset my password via email | P01, P02, P03 | - User requests reset with email<br>- Reset link sent via email (valid for 24 hours)<br>- User can set new password | P0 |
| AUTH-007 | As a user, I can update my profile information | P01, P02, P03 | - User can update name, phone number<br>- Email change requires verification<br>- Changes saved and confirmed | P1 |
| AUTH-008 | As an admin, I can log in to the admin dashboard | P01 | - Admin credentials separate from student/parent<br>- Access to full admin functionality upon login | P0 |

---

## 2. Session & Registration Window Management

| ID | User Story | Persona(s) | Acceptance Criteria | Priority |
|----|------------|------------|---------------------|----------|
| SES-001 | As an admin, I can create a registration window for an upcoming session | P01 | - Select session (June, November, January)<br>- Set start date and time<br>- Set end date and time<br>- Only one window can be active at a time | P0 |
| SES-002 | As an admin, I can view all registration windows (past, current, upcoming) | P01 | - List shows session name, dates, status (draft, active, closed)<br>- Can filter by status or session type | P0 |
| SES-003 | As an admin, I can edit a registration window before it opens | P01 | - Can modify dates/times for draft windows<br>- Cannot edit once window is active | P0 |
| SES-004 | As an admin, I can manually close an active registration window | P01 | - Confirmation required before closing<br>- All pending registrations are finalized<br>- Students/parents notified of early closure | P1 |
| SES-005 | As a student/parent, I can see the current registration window status | P02, P03 | - Dashboard shows if window is open/closed<br>- Displays session name and closing date/time<br>- Countdown timer if window is open | P0 |
| SES-006 | As the system, I automatically close registration windows at the specified end time | System | - Window status changes to "closed" at end time<br>- No new registrations or swaps allowed after closure<br>- Email notification sent to all users | P0 |

---

## 3. Subject Management

| ID | User Story | Persona(s) | Acceptance Criteria | Priority |
|----|------------|------------|---------------------|----------|
| SUB-001 | As an admin, I can create a new subject | P01 | - Enter subject name, code<br>- Select council (Pearson Edexcel, Cambridge, Oxford)<br>- Set price (in-school)<br>- Toggle external option (yes/no)<br>- Set external price (if applicable)<br>- Subject saved and available for registration | P0 |
| SUB-002 | As an admin, I can view all subjects in the system | P01 | - List shows name, code, council, prices, external option<br>- Can filter by council<br>- Can search by name or code | P0 |
| SUB-003 | As an admin, I can edit an existing subject | P01 | - Can update any field (name, code, council, prices, external option)<br>- Changes apply to future registrations only<br>- Existing registrations retain original pricing | P0 |
| SUB-004 | As an admin, I can deactivate a subject | P01 | - Subject no longer appears for new registrations<br>- Existing registrations remain unaffected<br>- Can reactivate later | P1 |
| SUB-005 | As a student/parent, I can browse available subjects | P02, P03 | - List shows subject name, code, council<br>- Shows in-school price<br>- Shows external price (if available)<br>- Can filter by council<br>- Can search by name or code | P0 |
| SUB-006 | As a student/parent, I can view subject details | P02, P03 | - See full subject information<br>- Clear indication if external option is available<br>- Both prices displayed if applicable | P0 |

---

## 4. Core Subject Management (Grade 10)

| ID | User Story | Persona(s) | Acceptance Criteria | Priority |
|----|------------|------------|---------------------|----------|
| CORE-001 | As an admin, I can designate subjects as "core" for Grade 10 | P01 | - Select subject from list<br>- Mark as core for Grade 10<br>- Core subjects automatically required in June session | P0 |
| CORE-002 | As an admin, I can remove core designation from a subject | P01 | - Only affects future June sessions<br>- Existing registrations remain locked | P1 |
| CORE-003 | As a Grade 10 student/parent, I am required to register all core subjects in June | P02, P03 | - Core subjects pre-selected and locked during June registration<br>- Cannot proceed without paying for core subjects<br>- Clear indication that these are mandatory | P0 |
| CORE-004 | As a Grade 10 student/parent, I cannot drop or swap core subjects | P02, P03 | - Drop/swap options disabled for core subjects<br>- Message explains these are mandatory<br>- Applies even within open registration window | P0 |

---

## 5. Subject Registration

| ID | User Story | Persona(s) | Acceptance Criteria | Priority |
|----|------------|------------|---------------------|----------|
| REG-001 | As a student, I can register for subjects in the current open session | P02 | - Select subjects from available list<br>- Choose in-school or external (if available) for each<br>- See total cost before payment<br>- Registration only confirmed after payment | P0 |
| REG-002 | As a parent, I can register subjects for any of my linked children | P03 | - Select which child to register for<br>- Same flow as student registration<br>- Child receives email notification of registration | P0 |
| REG-003 | As a student/parent, I can view my/my child's registered subjects | P02, P03 | - List shows all registered subjects per session<br>- Shows subject details, price paid, registration type (in-school/external)<br>- Shows registration date | P0 |
| REG-004 | As a student/parent, I cannot register if the registration window is closed | P02, P03 | - Registration button disabled when window closed<br>- Message indicates when next window opens (if known) | P0 |
| REG-005 | As a student/parent, I can see my registration history across all sessions | P02, P03 | - Historical view of all sessions<br>- Shows subjects registered per session<br>- Shows payment amounts | P1 |

---

## 6. Payments

| ID | User Story | Persona(s) | Acceptance Criteria | Priority |
|----|------------|------------|---------------------|----------|
| PAY-001 | As a student/parent, I can pay for subject registration using Fawry | P02, P03 | - Generate Fawry payment code<br>- Code valid for limited time (e.g., 24 hours)<br>- Registration confirmed upon payment verification | P0 |
| PAY-002 | As a student/parent, I can pay for subject registration using credit/debit card | P02, P03 | - Secure payment gateway integration<br>- Supports Visa, Mastercard<br>- Instant confirmation upon successful payment | P0 |
| PAY-003 | As a student/parent, I can pay for subject registration using mobile wallet | P02, P03 | - Supports Vodafone Cash, Orange Money, Etisalat Cash, etc.<br>- Payment confirmation flow<br>- Registration confirmed upon verification | P0 |
| PAY-004 | As a student/parent, I can pay for subject registration using bank transfer | P02, P03 | - System provides bank account details and reference number<br>- Admin manually verifies and confirms payment<br>- Student notified upon confirmation | P1 |
| PAY-005 | As a student/parent, I can use my escrow balance to pay (partially or fully) | P02, P03 | - See available escrow balance during checkout<br>- Choose to apply escrow funds<br>- Pay remaining balance via other methods if escrow insufficient | P0 |
| PAY-006 | As a student/parent, I receive a payment receipt via email | P02, P03 | - Receipt includes subjects registered, amounts, payment method<br>- Sent immediately after payment confirmation<br>- Downloadable PDF receipt available in dashboard | P0 |
| PAY-007 | As an admin, I can manually confirm bank transfer payments | P01 | - View pending bank transfer payments<br>- Enter confirmation details<br>- Student automatically notified and registration confirmed | P1 |

---

## 7. Subject Swapping

| ID | User Story | Persona(s) | Acceptance Criteria | Priority |
|----|------------|------------|---------------------|----------|
| SWAP-001 | As a student, I can drop a registered subject during an open window | P02 | - Select subject to drop<br>- Confirm drop action<br>- Full paid amount credited to escrow<br>- Subject removed from registration | P0 |
| SWAP-002 | As a student, I can swap a registered subject for another subject | P02 | - Select subject to drop and subject to add<br>- System calculates price difference<br>- If new subject costs more: pay the difference<br>- If new subject costs less: difference credited to escrow | P0 |
| SWAP-003 | As a student, I can switch between in-school and external for a registered subject | P02 | - Select registered subject<br>- Choose to switch registration type<br>- System calculates price difference<br>- In-school → External: difference to escrow<br>- External → In-school: pay the difference | P0 |
| SWAP-004 | As a parent, I can perform drops and swaps for my linked children | P03 | - Same functionality as student<br>- Child receives email notification of changes | P0 |
| SWAP-005 | As a student/parent, I cannot drop or swap core subjects (Grade 10) | P02, P03 | - Drop/swap buttons hidden or disabled for core subjects<br>- Tooltip or message explains why | P0 |
| SWAP-006 | As a student/parent, I cannot drop or swap when registration window is closed | P02, P03 | - Actions disabled when window closed<br>- Clear message explaining window status | P0 |

---

## 8. Escrow Management

| ID | User Story | Persona(s) | Acceptance Criteria | Priority |
|----|------------|------------|---------------------|----------|
| ESC-001 | As a student, I can view my escrow balance | P02 | - Dashboard shows current escrow balance<br>- Transaction history shows credits and debits | P0 |
| ESC-002 | As a parent, I can view escrow balances for all linked children | P03 | - See each child's escrow balance<br>- View transaction history per child | P0 |
| ESC-003 | As a parent, I can transfer escrow funds between my linked children | P03 | - Select source child and destination child<br>- Enter amount to transfer<br>- Cannot exceed source child's balance<br>- Both children notified via email | P0 |
| ESC-004 | As a student, I can request an escrow withdrawal | P02 | - Enter amount to withdraw (up to full balance)<br>- Request submitted to admin for processing<br>- Student notified when request is received | P0 |
| ESC-005 | As a parent, I can request an escrow withdrawal for my child | P03 | - Same as student flow<br>- Parent and child both notified | P0 |
| ESC-006 | As an admin, I can view all pending escrow withdrawal requests | P01 | - List shows student name, amount requested, date<br>- Can filter by status (pending, fulfilled) | P0 |
| ESC-007 | As an admin, I can mark an escrow withdrawal as fulfilled | P01 | - Select pending request<br>- Enter amount released (can be partial or full)<br>- Add notes if needed<br>- Student's escrow balance reduced accordingly<br>- Student notified via email | P0 |
| ESC-008 | As a student/parent, I can view my withdrawal request history | P02, P03 | - See all past requests<br>- Status (pending, partially fulfilled, fulfilled)<br>- Amount requested vs. amount released | P1 |

---

## 9. Notifications

| ID | User Story | Persona(s) | Acceptance Criteria | Priority |
|----|------------|------------|---------------------|----------|
| NOT-001 | As a user, I receive an email when a registration window opens | P02, P03 | - Email includes session name, dates, link to register<br>- Sent to all active students and parents | P0 |
| NOT-002 | As a user, I receive an email when a registration window is closing soon | P02, P03 | - Sent 24 hours before window closes<br>- Reminder to complete registrations | P1 |
| NOT-003 | As a user, I receive an email confirming my subject registration | P02, P03 | - Includes list of subjects registered<br>- Payment amount and method<br>- Registration confirmation number | P0 |
| NOT-004 | As a user, I receive an email when I drop or swap a subject | P02, P03 | - Details of what was dropped/swapped<br>- Financial impact (escrow credit or additional payment) | P0 |
| NOT-005 | As a user, I receive an email when my escrow balance changes | P02, P03 | - Shows previous balance, transaction, new balance<br>- Reason for change (drop, swap, transfer, withdrawal) | P0 |
| NOT-006 | As a user, I receive an email when my escrow withdrawal is fulfilled | P02, P03 | - Amount released<br>- Remaining escrow balance<br>- Instructions to collect from school | P0 |
| NOT-007 | As a parent, I receive emails for all actions related to my linked children | P03 | - All notifications sent to parent when action involves their child<br>- Clear indication of which child it concerns | P0 |
| NOT-008 | As an admin, I can send bulk email announcements to all users | P01 | - Compose message with subject and body<br>- Select recipients (all, students only, parents only, specific grades)<br>- Schedule or send immediately | P2 |

---

## 10. Reports & Audit Trail

| ID | User Story | Persona(s) | Acceptance Criteria | Priority |
|----|------------|------------|---------------------|----------|
| REP-001 | As an admin, I can generate a registration report per session | P01 | - Shows all registrations for selected session<br>- Includes student name, grade, subjects, amounts paid<br>- Filter by grade, council, registration type<br>- Exportable to CSV/Excel/PDF | P0 |
| REP-002 | As an admin, I can generate a financial summary report | P01 | - Total revenue per session<br>- Breakdown by payment method<br>- Breakdown by council<br>- Breakdown by in-school vs. external<br>- Exportable | P0 |
| REP-003 | As an admin, I can generate an escrow report | P01 | - Current escrow balances per student<br>- Total escrow liability<br>- Pending withdrawal requests<br>- Exportable | P0 |
| REP-004 | As an admin, I can generate a subject enrollment report | P01 | - Number of students enrolled per subject<br>- Breakdown by in-school vs. external<br>- Revenue per subject<br>- Exportable | P0 |
| REP-005 | As an admin, I can generate a Grade 10 core subjects compliance report | P01 | - List of Grade 10 students<br>- Core subjects registered (yes/no)<br>- Identifies any missing core registrations | P0 |
| REP-006 | As an admin, I can view the audit trail of all system actions | P01 | - Chronological log of all transactions<br>- Includes user, action, timestamp, details<br>- Filterable by user, action type, date range<br>- Exportable | P0 |
| REP-007 | As an admin, I can generate a student roster report | P01 | - All students by grade<br>- Contact information<br>- Linked parents<br>- Exportable | P1 |
| REP-008 | As an admin, I can view a dashboard with key metrics | P01 | - Active students count<br>- Registrations in current session<br>- Revenue in current session<br>- Total escrow liability<br>- Pending withdrawal requests count | P1 |

---

## 11. Grade Progression

| ID | User Story | Persona(s) | Acceptance Criteria | Priority |
|----|------------|------------|---------------------|----------|
| GRADE-001 | As the system, I automatically progress students to the next grade after the appropriate session | System | - Grade 10 → 11 after November session closes<br>- Grade 11 → 12 after June session closes<br>- Grade 12 → Graduated after November session closes | P0 |
| GRADE-002 | As an admin, I can manually adjust a student's grade | P01 | - Select student and new grade<br>- Enter reason for adjustment<br>- Change logged in audit trail<br>- Student notified of grade change | P1 |
| GRADE-003 | As a graduated student, I can no longer access registration features | P02 | - Dashboard shows "Graduated" status<br>- Registration features disabled<br>- Can still view history and escrow balance<br>- Can still request escrow withdrawal | P0 |

---

## Summary Statistics

| Priority | Count |
|----------|-------|
| P0 (Critical) | 47 |
| P1 (High) | 12 |
| P2 (Medium) | 1 |
| P3 (Low) | 0 |
| **Total** | **60** |

---

## Appendix: Feature Categories

| Category | User Story IDs | Count |
|----------|----------------|-------|
| Authentication & Account Management | AUTH-001 to AUTH-008 | 8 |
| Session & Registration Window Management | SES-001 to SES-006 | 6 |
| Subject Management | SUB-001 to SUB-006 | 6 |
| Core Subject Management | CORE-001 to CORE-004 | 4 |
| Subject Registration | REG-001 to REG-005 | 5 |
| Payments | PAY-001 to PAY-007 | 7 |
| Subject Swapping | SWAP-001 to SWAP-006 | 6 |
| Escrow Management | ESC-001 to ESC-008 | 8 |
| Notifications | NOT-001 to NOT-008 | 8 |
| Reports & Audit Trail | REP-001 to REP-008 | 8 |
| Grade Progression | GRADE-001 to GRADE-003 | 3 |
