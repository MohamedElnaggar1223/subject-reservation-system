# IGCSE Subject Reservation System — Manual Testing Guide

**Version:** 2.0  
**Date:** March 2026  
**Read this first:** This guide is written so that anyone can follow it step by step, even with no technical background. Every single click, every URL, every button label is spelled out exactly as it appears on screen.

---

## How to Read This Guide

- **`code text`** → something you type exactly as written, letter for letter
- **[Button Name]** → a button you click on screen, the text matches what you see on it
- **→** → means "then" or "leads to"
- ✅ **Expected** → what you should see if it is working correctly
- ❌ **If you see instead** → what to note down if something is wrong
- 📝 **Write this down** → information you will need in a later step

Each test has a **PASS / FAIL** box at the end. Write ✅ or ❌ when you are done.

---

## SECTION 0 — Starting the Application

> Do this once before any tests. The app must be running for all tests to work.

---

### STEP 0.1 — Open a Terminal / PowerShell Window

1. Press the **Windows key** on your keyboard
2. Type `powershell` and press Enter
3. A blue or black window opens — this is PowerShell

---

### STEP 0.2 — Navigate to the Project Folder

In the PowerShell window, type the following and press Enter:

```
cd "C:\Users\Sameh\Desktop\subject-reservation-system"
```

You should now see the prompt show something like:
```
PS C:\Users\Sameh\Desktop\subject-reservation-system>
```

---

### STEP 0.3 — Start the Application

Type the following and press Enter:

```
pnpm dev
```

Wait. You will see a lot of text appear. Wait until you see lines that look like:

```
▲ Next.js 15.x.x
- Local: http://localhost:3000
```

and

```
Server is running on http://localhost:3001
```

> This means both the website (port 3000) and the API (port 3001) are running.
> **Do not close this window.** If you close it, the app stops.

---

### STEP 0.4 — Open Your Browser

1. Open Google Chrome (recommended)
2. In the address bar at the top, type `http://localhost:3000` and press Enter
3. You should be redirected to a page that says **"Sign in to your account"**

✅ **Expected:** You see a white page with two fields: "Email address" and "Password", and a blue "Sign in" button.

---

### STEP 0.5 — Create the Admin Account (One-Time Database Setup)

> The admin account cannot be created through the website — it must be set up directly in the database. This is done only once.

**Open a second PowerShell window** (repeat STEP 0.1) and do the following:

**A — Register a normal account first:**
1. In your browser, go to `http://localhost:3000/sign-up`
2. Click the card **"I'm a Student"**
3. Fill in:
   - Full Name: `Admin User`
   - Email Address: `admin@test.com`
   - Current Grade: select `Grade 10` (we will fix this in the database)
   - Password: `AdminPass1`
   - Confirm Password: `AdminPass1`
4. Click the blue **[Create Student Account]** button
5. You will be redirected — the account is now created

**B — Promote it to admin in the database:**

In your second PowerShell window, navigate to the project and run:

```
cd "C:\Users\Sameh\Desktop\subject-reservation-system"
```

Then connect to the database (replace the connection string with the one in your `apps/api/.env` file):

```
pnpm --filter "@repo/db" db:studio
```

> This opens Drizzle Studio in your browser at `http://localhost:4983`

1. Open `http://localhost:4983` in a new browser tab
2. In the left sidebar, click on the **`user`** table
3. Find the row with email `admin@test.com`
4. Click on that row to edit it
5. Change the **`role`** field from `student` to `admin`
6. Change the **`grade`** field to empty/null (admins do not have a grade)
7. Save the change

> **Alternative if Drizzle Studio does not open:** Use the following SQL command directly. In PowerShell, run:
> ```
> pnpm --filter "@repo/db" db:push
> ```
> Then connect to your PostgreSQL database with any SQL client (pgAdmin, TablePlus, etc.) and run:
> ```sql
> UPDATE "user" SET role = 'admin', grade = NULL WHERE email = 'admin@test.com';
> ```

**C — Sign back in as admin:**
1. Go to `http://localhost:3000/sign-in`
2. Sign in with `admin@test.com` / `AdminPass1`
3. After signing in, go to `http://localhost:3000/admin/dashboard`

✅ **Expected:** You see the Admin Dashboard page with metric cards (Students by grade, Parents, Active Sessions, etc.)

❌ **If you see "Unauthorized" or get redirected away:** The role was not saved correctly. Repeat step B.

---

## SECTION 1 — Create Test Accounts

> You need 4 accounts total: 1 admin (already done), 2 students, 1 parent.
> **Use different browser windows or incognito windows for each account** so you can stay logged in to all at once.

---

### TEST-001 — Create Student Account (Grade 10)

**Window:** Open a new **Incognito window** (Ctrl+Shift+N in Chrome)

1. Go to `http://localhost:3000/sign-up`
2. You see a page titled **"Create your account"** with two large cards
3. Click the card titled **"I'm a Student"** (the blue one with a graduation cap icon)
4. You are taken to `http://localhost:3000/sign-up/student`
5. Fill in the form **exactly** as follows:
   - **Full Name:** `Student One`
   - **Email Address:** `student1@test.com`
   - **Current Grade:** click the dropdown → select **"Grade 10"**
   - **Password:** `Password1`
   - **Confirm Password:** `Password1`
6. Click the blue **[Create Student Account]** button

✅ **Expected:** You are redirected to `http://localhost:3000/sign-up/student/complete` where you may need to confirm your grade. Follow any prompts. Then you should eventually land on the home page or sign-in page.

7. If redirected to sign-in, sign in with `student1@test.com` / `Password1`
8. After sign-in, go to `http://localhost:3000`

✅ **Expected:** Page shows **"Hello, Student One!"** and **"You are logged in with role: student"**

📝 **Note:** Keep this window open. This is your Student One window.

**PASS / FAIL:** ___

---

### TEST-002 — Create Student Account (Grade 11)

**Window:** Open a **second Incognito window** (Ctrl+Shift+N again)

1. Go to `http://localhost:3000/sign-up`
2. Click **"I'm a Student"**
3. Fill in:
   - **Full Name:** `Student Two`
   - **Email Address:** `student2@test.com`
   - **Current Grade:** **"Grade 11"**
   - **Password:** `Password1`
   - **Confirm Password:** `Password1`
4. Click **[Create Student Account]**
5. Sign in if needed and go to `http://localhost:3000`

✅ **Expected:** Page shows **"Hello, Student Two!"** and role: student

📝 Keep this window open. This is your Student Two window.

**PASS / FAIL:** ___

---

### TEST-003 — Create Parent Account

**Window:** Open a **third Incognito window**

1. Go to `http://localhost:3000/sign-up`
2. You see the two cards. Click the **"I'm a Parent"** card (the green one with a family icon)
3. You are taken to `http://localhost:3000/sign-up/parent`
4. Fill in:
   - **Full Name:** `Test Parent`
   - **Email Address:** `parent@test.com`
   - **Password:** `Password1`
   - **Confirm Password:** `Password1`
5. Click **[Create Parent Account]**
6. Sign in if needed and go to `http://localhost:3000`

✅ **Expected:** Page shows **"Hello, Test Parent!"** and role: parent

📝 Keep this window open. This is your Parent window.

**PASS / FAIL:** ___

---

## SECTION 2 — Authentication Tests

---

### TEST-004 — Wrong Password Does Not Lock the Account

**Window:** Open a **new regular browser tab** (not incognito)

1. Go to `http://localhost:3000/sign-in`
2. In the **"Email address"** field, type `student1@test.com`
3. In the **"Password"** field, type `WrongPassword`
4. Click the blue **[Sign in]** button

✅ **Expected:** A red error box appears with a message like "Invalid email or password"

5. Try again with password `AnotherWrongOne` → same red error, no lockout message
6. Try again with password `ThirdWrongAttempt` → same red error
7. Now type the correct password `Password1` and click **[Sign in]**

✅ **Expected:** You are logged in successfully. No "account locked" message ever appeared.

8. Sign out from this tab (not needed for later tests — just close the tab)

**PASS / FAIL:** ___

---

### TEST-005 — Profile Update

**Window:** Switch to your **Student One incognito window**

1. Go to `http://localhost:3000/profile`
2. You see a profile page with fields for your name and phone number
3. Change the **name** field from `Student One` to `Student One Updated`
4. In the **phone** field (if empty), type `01012345678`
5. Click the **[Save]** or **[Update Profile]** button

✅ **Expected:** A success message appears (green toast or banner). The page still shows the updated name and phone number.

6. Refresh the page by pressing F5

✅ **Expected:** The updated name `Student One Updated` and phone `01012345678` are still there (changes were saved)

7. Change the name back to `Student One` and save again (to keep things clean for later tests)

**PASS / FAIL:** ___

---

## SECTION 3 — Parent-Student Linking

---

### TEST-006 — Parent Sends a Link Request to Student One

**Window:** Switch to your **Parent incognito window**

1. Go to `http://localhost:3000/links`
2. You see the Links page
3. Look for a form or button to add a child. You should see a section titled something like **"Link a Child"** or **"Add Child"** with an input field
4. In the input field, type `student1@test.com`
5. Click **[Send Link Request]** or **[Link]**

✅ **Expected:** A success message appears. Below, you see a "Pending Requests" list showing `Student One` with a status of `pending`.

**PASS / FAIL:** ___

---

### TEST-007 — Student One Gets Notified of the Link Request

**Window:** Switch to your **Student One incognito window**

1. Go to `http://localhost:3000/notifications`
2. You see the Notifications page with a list of notifications

✅ **Expected:** There is at least one notification with a title like **"New Parent Link Request"** mentioning `Test Parent`. It should appear with an unread indicator (bold text or a colored dot).

3. Click on the notification to mark it as read

✅ **Expected:** The notification's unread indicator disappears (it becomes less prominent / no longer bold)

**PASS / FAIL:** ___

---

### TEST-008 — Student One Approves the Link Request

**Window:** Stay in your **Student One incognito window**

1. Go to `http://localhost:3000/links`
2. You see the Links page with a **"Pending Requests"** section
3. You should see a pending request from `Test Parent`
4. Click **[Approve]**

✅ **Expected:** 
- Success message appears
- The request disappears from "Pending" 
- A new section appears showing `Test Parent` as an approved/linked parent

**PASS / FAIL:** ___

---

### TEST-009 — Parent Gets Notified of Approval

**Window:** Switch to your **Parent incognito window**

1. Go to `http://localhost:3000/notifications`

✅ **Expected:** A new notification exists titled **"Link Request Approved"** mentioning `Student One`

2. Go to `http://localhost:3000/links`

✅ **Expected:** `Student One` now appears in a **"My Children"** or **"Linked Children"** list with status `approved`

**PASS / FAIL:** ___

---

### TEST-010 — Parent Links to Student Two

**Window:** Stay in your **Parent incognito window**

1. Go to `http://localhost:3000/links`
2. In the "Link a Child" input, type `student2@test.com`
3. Click **[Send Link Request]**

Then switch to **Student Two incognito window**:

4. Go to `http://localhost:3000/links`
5. You should see a pending request from `Test Parent`
6. Click **[Approve]**

Switch back to **Parent window**:

7. Go to `http://localhost:3000/links`

✅ **Expected:** Both `Student One` and `Student Two` are now shown in your children list

**PASS / FAIL:** ___

---

### TEST-011 — Reject a Link Request

**Window:** Parent window

1. Go to `http://localhost:3000/links`
2. Try to send another link request to `student1@test.com`

✅ **Expected (Option A):** Error message: "Already linked to this student" or "Link already exists" — this is correct behavior, no need to proceed

If the request was sent anyway:

3. Switch to **Student One window**, go to `http://localhost:3000/links`
4. Find the new pending request from `Test Parent`
5. Click **[Reject]**

✅ **Expected:**
- Request disappears from Student One's pending list
- Student One still shows `Test Parent` as an approved parent (the OLD approved link stays — only the new duplicate request was rejected)
- Parent receives a notification: "Link Request Rejected"

**PASS / FAIL:** ___

---

## SECTION 4 — Subject Management (Admin)

---

### TEST-012 — Admin Creates Subject 1: Mathematics (In-School, Core)

**Window:** Switch to your **Admin browser tab**

1. Go to `http://localhost:3000/admin/subjects`
2. You see the Subject Management page with a list (empty for now) and a button to add subjects
3. Click the **[Add Subject]** or **[New Subject]** or **[+ Subject]** button
4. A form appears. Fill in:
   - **Name:** `Mathematics`
   - **Code:** `MATH-4400`
   - **Council:** click the dropdown → select **"Pearson Edexcel"**
   - **In-School Price:** `500`
   - **Offered at School:** make sure this toggle is **ON** (checked/enabled)
   - **Custom Price:** leave empty
   - **Is Core Subject:** make sure this is **ON** (checked) — we will need it for Grade 10 tests
5. Click **[Save]** or **[Create Subject]**

✅ **Expected:** Mathematics appears in the subjects table with:
- Name: Mathematics
- Code: MATH-4400
- Council: Pearson Edexcel
- Price: 500
- Offered at School: Yes
- Core: Yes (a badge or checkmark)
- Status: Active

**PASS / FAIL:** ___

---

### TEST-013 — Admin Creates Subject 2: English Language (In-School, Core)

**Window:** Admin tab, stay on `http://localhost:3000/admin/subjects`

1. Click **[Add Subject]** again
2. Fill in:
   - **Name:** `English Language`
   - **Code:** `ENGL-4EA0`
   - **Council:** `Pearson Edexcel`
   - **In-School Price:** `450`
   - **Offered at School:** ON
   - **Is Core Subject:** ON
3. Click **[Save]**

✅ **Expected:** English Language appears in the list with Core badge

**PASS / FAIL:** ___

---

### TEST-014 — Admin Creates Subject 3: Physics (In-School, Not Core)

1. Click **[Add Subject]**
2. Fill in:
   - **Name:** `Physics`
   - **Code:** `PHYS-4PH0`
   - **Council:** `Pearson Edexcel`
   - **In-School Price:** `600`
   - **Offered at School:** ON
   - **Is Core Subject:** OFF (leave unchecked)
3. Click **[Save]**

✅ **Expected:** Physics in the list, no Core badge

**PASS / FAIL:** ___

---

### TEST-015 — Admin Creates Subject 4: Art and Design (NOT Offered at School — Custom Price)

1. Click **[Add Subject]**
2. Fill in:
   - **Name:** `Art and Design`
   - **Code:** `ART-9479`
   - **Council:** `Cambridge`
   - **In-School Price:** `400`
   - **Offered at School:** toggle this **OFF** (disabled/unchecked)
   - **Custom Price:** `650` (this field should appear when "Offered at School" is OFF)
   - **Is Core Subject:** OFF
3. Click **[Save]**

✅ **Expected:** Art and Design in the list showing:
- Offered at School: No
- Custom Price / Price: 650

**PASS / FAIL:** ___

---

### TEST-016 — Admin Creates Subject 5: Chemistry (for end-to-end test later)

1. Click **[Add Subject]**
2. Fill in:
   - **Name:** `Chemistry`
   - **Code:** `CHEM-4CH0`
   - **Council:** `Pearson Edexcel`
   - **In-School Price:** `550`
   - **Offered at School:** ON
   - **Is Core Subject:** OFF
3. Click **[Save]**

✅ **Expected:** Chemistry in the list

**PASS / FAIL:** ___

---

### TEST-017 — Admin Edits a Subject Price

**Window:** Admin tab, on `http://localhost:3000/admin/subjects`

1. Find **Physics** in the subjects list
2. Click its **[Edit]** button (pencil icon or edit label)
3. Change the **In-School Price** from `600` to `650`
4. Click **[Save]**

✅ **Expected:** Physics now shows price `650` in the list

**PASS / FAIL:** ___

---

### TEST-018 — Admin Deactivates and Reactivates a Subject

1. Find **Art and Design** in the subjects list
2. Click its **[Deactivate]** button (or trash/X icon)
3. If a confirmation dialog appears, click **[Confirm]** or **[Yes]**

✅ **Expected:** Art and Design either disappears from the list, or appears grayed out with label "Inactive"

4. If there's a filter, change it to show "All" or "Inactive" subjects to find Art and Design
5. Find Art and Design and click **[Activate]** or **[Reactivate]**

✅ **Expected:** Art and Design returns to active status

**PASS / FAIL:** ___

---

### TEST-019 — Student Can Browse Subjects (Read-Only)

**Window:** Switch to **Student One incognito window**

1. Go to `http://localhost:3000/subjects`
2. You see the Subjects page with a list of all active subjects

✅ **Expected:**
- Mathematics, English Language, Physics, Art and Design, Chemistry are all visible
- Core subjects are marked with a badge or label
- Prices are shown
- There are **NO** buttons to add, edit, or delete subjects — students can only view

3. Try typing `Math` in a search box if one exists

✅ **Expected:** The list filters to show only Mathematics

4. Try filtering by council (e.g., Cambridge)

✅ **Expected:** Only Cambridge subjects appear (Art and Design)

**PASS / FAIL:** ___

---

## SECTION 5 — Session Management (Admin)

---

### TEST-020 — Admin Creates a June Registration Session

**Window:** Admin tab

1. Go to `http://localhost:3000/admin/sessions`
2. You see the Sessions Management page (currently empty)
3. Click **[New Session]** or **[Create Session]** or **[+ Session]**
4. Fill in:
   - **Name:** `June 2026`
   - **Session Type:** click the dropdown → select **"June"**
   - **Start Date:** today's date (you can type it or use the date picker). Use a time in the past or right now so it is ready to activate. Example: `2026-03-01 00:00`
   - **End Date:** 7 days from today. Example: `2026-03-08 23:59`
5. Click **[Save]** or **[Create]**

✅ **Expected:** Session "June 2026" appears in the list with status **Draft**

**PASS / FAIL:** ___

---

### TEST-021 — Admin Activates the Session

1. Find **June 2026** in the sessions list
2. Click **[Activate]** button

✅ **Expected:**
- Status changes to **Active**
- A green indicator or "Active" badge appears next to June 2026

**PASS / FAIL:** ___

---

### TEST-022 — Students and Parents Can See the Open Session

**Window:** Switch to **Student One incognito window**

1. Go to `http://localhost:3000/register`
2. You should see a registration page showing the active session

✅ **Expected:**
- Page shows "June 2026" as the current open session
- Subject list is visible showing available subjects
- A closing date/deadline is shown

**Window:** Switch to **Parent incognito window**

3. Go to `http://localhost:3000/register`

✅ **Expected:** Parent also sees the open session and can select a child to register for

**PASS / FAIL:** ___

---

### TEST-023 — Admin Creates a Second Session (Different Type) — Both Active Simultaneously

**Window:** Admin tab

1. Go to `http://localhost:3000/admin/sessions`
2. Click **[New Session]**
3. Fill in:
   - **Name:** `November 2026`
   - **Session Type:** **"November"** (different from June)
   - **Start Date:** today
   - **End Date:** 7 days from today
4. Save and then click **[Activate]**

✅ **Expected:** Both **June 2026** (June type) and **November 2026** (November type) show status **Active** at the same time. The system allows this because they are different session types.

**PASS / FAIL:** ___

---

### TEST-024 — Cannot Have Two Active Sessions of the Same Type

**Window:** Admin tab

1. Go to `http://localhost:3000/admin/sessions`
2. Click **[New Session]**
3. Fill in:
   - **Name:** `June 2026 Duplicate`
   - **Session Type:** **"June"** (same as the already-active one)
   - **Start Date:** today
   - **End Date:** 7 days from now
4. Save the session (it creates as Draft)
5. Try to click **[Activate]** on this new session

✅ **Expected:** An error message appears: something like "An active June session already exists" or "Only one active session per type is allowed". The new session stays as Draft and does NOT become active.

6. Delete or leave this duplicate session as Draft — you do not need it.

**PASS / FAIL:** ___

---

### TEST-025 — Admin Edits an Active Session's End Date

1. Find **June 2026** (Active) in the sessions list
2. Click **[Edit]** on it
3. Change the **End Date** to 14 days from today
4. Save

✅ **Expected:** 
- End date updates successfully
- No error about editing an active session

Now verify this was logged:

5. Go to `http://localhost:3000/admin/audit`
6. Look through the audit entries

✅ **Expected:** You see an entry for action **SESSION_UPDATED** with the timestamp of your edit, showing what changed

**PASS / FAIL:** ___

---

## SECTION 6 — Subject Registration Flow

This is the most important part. Follow every step carefully.

---

### TEST-026 — Core Subjects Are Pre-Selected and Locked for Grade 10 June

**Window:** Switch to **Student One incognito window** (Student One is Grade 10)

1. Go to `http://localhost:3000/register`
2. You see the registration page for the active June 2026 session
3. Look at the subject list

✅ **Expected:**
- **Mathematics** is already checked/selected and **cannot be unchecked** (it may be grayed out, have a lock icon, or have a "Required" label)
- **English Language** is also already checked and **cannot be unchecked**
- A message somewhere says something like "Core subjects are required for Grade 10 June session"
- **Physics**, **Chemistry**, **Art and Design** are optional — you can check/uncheck them freely

❌ **If Mathematics and English Language can be unchecked:** This is a failure of CORE-003.

**PASS / FAIL:** ___

---

### TEST-027 — Student One Submits a Registration Request

**Window:** Student One incognito window, on `http://localhost:3000/register`

1. The core subjects (Mathematics, English Language) are already selected
2. Also check the box for **Chemistry**
3. You should see a cost summary somewhere showing the total (450 + 500 + 550 = 1500)
4. Click **[Submit Request]** or **[Request Registration]**

✅ **Expected:**
- Success message: "Registration request submitted" or similar
- You are redirected to or can navigate to `http://localhost:3000/registrations`
- On the registrations page, you see **Mathematics**, **English Language**, and **Chemistry** listed with status **pending_approval**

**PASS / FAIL:** ___

---

### TEST-028 — Parent Receives Notification of Registration Request

**Window:** Switch to **Parent incognito window**

1. Go to `http://localhost:3000/notifications`

✅ **Expected:** A new unread notification titled **"New Registration Request"** or **"Registration Request Received"** mentioning Student One

2. Click the notification to read it — the body should list the subjects and total cost

**PASS / FAIL:** ___

---

### TEST-029 — Parent Approves the Registration Request

**Window:** Stay in **Parent incognito window**

1. Go to `http://localhost:3000/approvals`
2. You see the Approvals page with a list of pending items
3. You should see Student One's registration request showing Mathematics, English Language, and Chemistry with a total cost

✅ **Expected:** Three items OR one grouped item showing all three subjects and the total

4. Click **[Approve]** 

✅ **Expected:**
- The request disappears from the pending list (or moves to an "Approved" section)
- Success message appears

**PASS / FAIL:** ___

---

### TEST-030 — Student One Receives Notification of Approval and Status Changes to pending_payment

**Window:** Switch to **Student One incognito window**

1. Go to `http://localhost:3000/notifications`

✅ **Expected:** A new notification: **"Registration Approved"** or similar

2. Go to `http://localhost:3000/registrations`

✅ **Expected:** Mathematics, English Language, and Chemistry now show status **pending_payment** (no longer pending_approval)

**PASS / FAIL:** ___

---

### TEST-031 — Student Cannot Pay (Payment is Parent-Only)

**Window:** Stay in **Student One incognito window**

1. Go to `http://localhost:3000/checkout` or look for a "Pay" button on the registrations page

✅ **Expected:** Either:
- There is no payment/checkout button visible for the student
- OR the button is disabled/grayed out with a message like "Payment must be made by a linked parent"
- OR the checkout page redirects the student away

❌ **If the student can reach a working checkout and submit a payment:** This is a failure of payment parent-only restriction.

**PASS / FAIL:** ___

---

### TEST-032 — Parent Pays via Bank Transfer

**Window:** Switch to **Parent incognito window**

1. Go to `http://localhost:3000/checkout`
2. You should see Student One's pending registrations ready for payment (Mathematics, English Language, Chemistry — total 1500)
3. Look for a payment method selector
4. Select **"Bank Transfer"**
5. Click **[Pay]** or **[Initiate Payment]** or **[Proceed to Pay]**

✅ **Expected:**
- A payment record is created
- The page shows bank account details and a unique reference number
- A message says payment is pending manual confirmation by admin

📝 **Write down** the reference number or payment ID shown on screen — you need it in the next test.

**PASS / FAIL:** ___

---

### TEST-033 — Admin Confirms the Bank Transfer Payment

**Window:** Switch to **Admin tab**

1. Go to `http://localhost:3000/admin/payments`
2. You see the Payments page with a list of pending bank transfers
3. Find the payment from `Test Parent` for Student One (amount should be 1500)
4. Click **[Confirm]** or **[Confirm Payment]**
5. If asked for a reference, enter the reference number you wrote down (or any text)
6. Click **[Confirm]**

✅ **Expected:**
- Payment status changes to **Completed** or **Confirmed**
- Go back to check the registrations

7. Go to `http://localhost:3000/admin/reports` → select **Registration Report** → select session **June 2026** → click **[Run Report]**

✅ **Expected:** Mathematics, English Language, and Chemistry for Student One all show status **confirmed**

**PASS / FAIL:** ___

---

### TEST-034 — Parent Receives Payment Receipt Notification

**Window:** Switch to **Parent incognito window**

1. Go to `http://localhost:3000/notifications`

✅ **Expected:** A notification titled **"Payment Confirmed"** or **"Payment Receipt"** showing the subjects, amount (1500), and payment method (Bank Transfer)

**PASS / FAIL:** ___

---

### TEST-035 — Student One Cannot Register the Same Subject Twice

**Window:** Switch to **Student One incognito window**

1. Go to `http://localhost:3000/register`
2. Look at the available subjects list

✅ **Expected:** **Mathematics**, **English Language**, and **Chemistry** are either:
- Not shown in the available subjects list (already registered)
- OR shown but disabled with a message like "Already registered"

3. If you can somehow still submit a registration for one of these, try it

✅ **Expected:** Error: "Already registered for this subject in this session" or similar

**PASS / FAIL:** ___

---

### TEST-036 — Parent Directly Registers for Student Two (No Approval Step)

**Window:** Parent incognito window

1. Go to `http://localhost:3000/register`
2. You should see an option to select which child to register for
3. Select **Student Two**
4. Select **Physics** from the subject list
5. Click **[Register]** or **[Proceed to Checkout]** — note: this should NOT go to pending_approval. As a parent registering directly, it goes straight to payment.

✅ **Expected:**
- You are taken directly to checkout (no approval step)
- Physics for Student Two appears ready for payment

6. Select **Bank Transfer** and initiate payment

✅ **Expected:** Payment pending for Student Two / Physics

7. As admin, go to `http://localhost:3000/admin/payments` and confirm this payment too.

✅ **Expected:** Physics for Student Two is now **confirmed**

**PASS / FAIL:** ___

---

### TEST-037 — Admin Override — Register Without Parent Approval

**Window:** Admin tab

1. Go to `http://localhost:3000/admin/subjects` — we need a subject not yet registered
   (Student One still has Art and Design available. We'll use that.)
2. Find the admin override feature. Look in the registrations area or navigation. Try going to `http://localhost:3000/admin/registrations` if such a page exists, or look for an "Override" or "Admin Register" button on the sessions or registrations pages.
3. Select student: **Student One**
4. Select subject: **Art and Design**
5. Select session: **June 2026**
6. Enter reason: `Testing admin override feature`
7. Submit

✅ **Expected:**
- Art and Design for Student One is created with status **confirmed** immediately (no pending_approval, no payment needed in this flow)
- Admin sees a success message

8. Verify in the Audit Log:
   - Go to `http://localhost:3000/admin/audit`
   - Look for action **REGISTRATION_ADMIN_OVERRIDE**

✅ **Expected:** An audit entry exists showing the admin performed the override, the student, subject, and reason

**PASS / FAIL:** ___

---

## SECTION 7 — Escrow Management

---

### TEST-038 — Student Escrow Is Read-Only

**Window:** Student One incognito window

1. Go to `http://localhost:3000/escrow`
2. You see the Escrow page

✅ **Expected:**
- Current balance shown (likely 0 EGP at this point)
- Transaction history shown (empty or has a few entries)
- **NO** transfer, withdraw, or top-up buttons visible
- The page is display-only — no action buttons

❌ **If you see a Transfer or Withdraw button for the student:** This is a failure.

**PASS / FAIL:** ___

---

### TEST-039 — Parent Views Escrow for All Children

**Window:** Parent incognito window

1. Go to `http://localhost:3000/escrow`
2. You see the Escrow page

✅ **Expected:**
- Both **Student One** and **Student Two** are shown with their individual balances
- Transfer and Withdraw action buttons exist for the parent
- Each child has a section or card showing their balance

**PASS / FAIL:** ___

---

### TEST-040 — Drop a Subject to Get Escrow Balance (Setup for Transfer Test)

> We need to drop a subject to put money into escrow. We'll drop Physics from Student Two (which was directly registered in TEST-036 and confirmed).

**Window:** Parent incognito window

1. Go to `http://localhost:3000/escrow` or navigate to Student Two's registrations
2. Look for Student Two's confirmed **Physics** registration
3. Click **[Drop]** on Physics (this is a direct parent drop — no student approval needed)

✅ **Expected:**
- Physics is immediately dropped
- Student Two's escrow balance increases by **650** EGP (the price of Physics)
- A success message appears

4. Go to `http://localhost:3000/escrow`

✅ **Expected:** Student Two's balance now shows **650 EGP** (or whatever Physics cost)

**PASS / FAIL:** ___

---

### TEST-041 — Parent Transfers Escrow Between Children

**Window:** Parent incognito window

1. Go to `http://localhost:3000/escrow/transfer`
2. You see the Transfer page
3. Fill in:
   - **From:** Student Two (has 650 EGP)
   - **To:** Student One
   - **Amount:** `200`
4. Click **[Transfer]**

✅ **Expected:**
- Success message
- Student Two's balance decreases by 200 (now 450)
- Student One's balance increases by 200 (now 200)

5. Go to `http://localhost:3000/escrow` to verify balances

✅ **Expected:** Balances reflect the transfer

6. Check notifications:
   - Student One should receive "Escrow Balance Changed" notification
   - Student Two should receive "Escrow Balance Changed" notification

**PASS / FAIL:** ___

---

### TEST-042 — Cannot Transfer More Than Available Balance

**Window:** Parent incognito window, on transfer page

1. Go to `http://localhost:3000/escrow/transfer`
2. Select Student Two as the source (has 450 EGP)
3. Enter amount: `9999`
4. Click **[Transfer]**

✅ **Expected:** Error message: "Insufficient escrow balance" or "Amount exceeds available balance". Transfer is rejected.

**PASS / FAIL:** ___

---

### TEST-043 — Parent Requests an Escrow Withdrawal

**Window:** Parent incognito window

1. Go to `http://localhost:3000/escrow/withdraw`
2. You see the Withdrawal page
3. Fill in:
   - **Child:** Student Two
   - **Amount:** `300`
4. Click **[Request Withdrawal]**

✅ **Expected:**
- Withdrawal request created with status **Pending**
- Success message appears
- You can see the request in a "Withdrawal History" section or on this same page

**PASS / FAIL:** ___

---

### TEST-044 — Admin Fulfills the Withdrawal Request

**Window:** Admin tab

1. Go to `http://localhost:3000/admin/escrow`
2. You see the Escrow admin page with pending withdrawal requests
3. Find the withdrawal request for **Student Two** (amount 300)
4. Click **[Fulfill]**
5. Enter amount released: `300`
6. Optionally add notes: `Processed at front desk`
7. Click **[Confirm]**

✅ **Expected:**
- Request status changes to **Fulfilled**
- Student Two's escrow balance decreases by 300 (from 450 to 150)

8. Switch to **Parent window**, check notifications

✅ **Expected:** Notification: **"Withdrawal Fulfilled"** or **"Escrow Withdrawal Processed"**

**PASS / FAIL:** ___

---

## SECTION 8 — Subject Drop and Swap

---

### TEST-045 — Student Requests to Drop a Subject

> Student One has Chemistry confirmed. We'll request to drop it.

**Window:** Student One incognito window

1. Go to `http://localhost:3000/registrations`
2. Find **Chemistry** with status **confirmed**
3. Click the **[Request Drop]** button next to Chemistry
4. A form or dialog appears asking for a reason
5. Enter: `Changed my mind`
6. Click **[Submit]** or **[Request Drop]**

✅ **Expected:**
- Success message
- Chemistry still shows as **confirmed** (not dropped yet — parent must approve)
- A pending drop request appears

7. Go to `http://localhost:3000/pending-requests`

✅ **Expected:** Chemistry drop request is listed with status **pending_approval**

8. Switch to **Parent window**, check `http://localhost:3000/notifications`

✅ **Expected:** Notification: **"Drop/Swap Request"** or **"Child Requested Subject Drop"** for Chemistry

**PASS / FAIL:** ___

---

### TEST-046 — Student Cannot Drop Core Subjects

**Window:** Student One incognito window, on `http://localhost:3000/registrations`

1. Find **Mathematics** (a core subject, confirmed)
2. Look at the action buttons next to Mathematics

✅ **Expected:**
- There is **NO** [Request Drop] button for Mathematics
- OR the button is disabled with a tooltip/message: "Core subjects cannot be dropped for Grade 10 June session"

❌ **If a drop button is clickable for Mathematics:** This is a failure of CORE-004.

**PASS / FAIL:** ___

---

### TEST-047 — Parent Approves the Drop Request

**Window:** Parent incognito window

1. Go to `http://localhost:3000/approvals`
2. Find the drop request for **Chemistry** from Student One
3. Click **[Approve]**

✅ **Expected:**
- Drop request resolved
- Chemistry registration status changes to **dropped**
- Student One's escrow balance increases by **550** (the price of Chemistry)

4. Switch to **Student One window**, check notifications

✅ **Expected:** Notification: **"Drop/Swap Processed"** or **"Drop Request Approved"** for Chemistry

5. Switch to **Parent window**, go to `http://localhost:3000/escrow`

✅ **Expected:** Student One's escrow balance is now **550 + 200** = **750 EGP** (from Chemistry drop + earlier transfer)

**PASS / FAIL:** ___

---

### TEST-048 — Parent Rejects a Drop Request

**Window:** Student One incognito window

1. Go to `http://localhost:3000/registrations`
2. Find a confirmed subject. We'll use **Physics** — wait, Student One has Mathematics, English Language, and Art and Design (override). Let's request to drop **English Language** (even though it's core, the parent can reject it — but wait, core cannot be dropped). 

   Actually, let's register Physics for Student One first. Go to `http://localhost:3000/register`, select Physics, submit the request.

   **Parent window:** Go to `http://localhost:3000/approvals`, approve Physics request. Go to `http://localhost:3000/checkout`, pay (use Bank Transfer). **Admin window:** Confirm the payment.

3. Now Student One has Physics confirmed. Request to drop it:
   - Go to `http://localhost:3000/registrations`
   - Click **[Request Drop]** on Physics
   - Reason: `Testing rejection`
   - Submit

4. Switch to **Parent window** → `http://localhost:3000/approvals`
5. Find the Physics drop request
6. Click **[Reject]**
7. A comments field may appear — enter: `You need this subject`
8. Click **[Confirm Rejection]** or **[Reject]**

✅ **Expected:**
- Drop request is rejected
- Physics is still **confirmed** — it was NOT dropped
- Escrow balance did NOT change

9. Switch to **Student One window** → `http://localhost:3000/notifications`

✅ **Expected:** Notification: drop request rejected, with parent's comment "You need this subject"

**PASS / FAIL:** ___

---

### TEST-049 — Student Requests a Swap

**Window:** Student One incognito window

1. Go to `http://localhost:3000/registrations`
2. Find **Physics** (confirmed)
3. Click **[Request Swap]**
4. A form appears. Select the new subject: **Chemistry** (it was dropped, so it should be available again)
5. The form should show the price difference: Physics (650) → Chemistry (550) = **−100** (Student One would receive 100 EGP in escrow)
6. Enter reason: `Want Chemistry instead`
7. Click **[Submit Swap Request]**

✅ **Expected:**
- Swap request created with status **pending_approval**
- Parent notified

**Window:** Parent incognito window → `http://localhost:3000/approvals`

8. Find the swap request (Physics → Chemistry)
9. Click **[Approve]**

✅ **Expected:**
- Physics registration is **dropped**
- Chemistry registration is **confirmed**
- Student One's escrow balance increases by **100** EGP (the price difference)

**PASS / FAIL:** ___

---

### TEST-050 — Cannot Drop or Swap When Window Is Closed

**Window:** Admin tab

1. Go to `http://localhost:3000/admin/sessions`
2. Find **June 2026** (Active)
3. Click **[Close]** on it
4. If asked to confirm, click **[Yes]** / **[Confirm]**

✅ **Expected:** June 2026 status changes to **Closed**

**Window:** Student One incognito window

5. Go to `http://localhost:3000/registrations`
6. Look for drop or swap buttons on any confirmed registration

✅ **Expected:** All drop/swap buttons are **disabled** or **missing**, with a message like "Registration window is closed"

7. Try going to `http://localhost:3000/register`

✅ **Expected:** Message: "No active registration window" or registration buttons are disabled

**Re-activate the session for future tests:**

8. **Admin window** → `http://localhost:3000/admin/sessions`
9. Create a new June session or find June 2026 and activate it again (if re-activation is possible)

**PASS / FAIL:** ___

---

## SECTION 9 — Notifications

---

### TEST-051 — Notification Center Shows All Notifications

**Window:** Student One incognito window

1. Go to `http://localhost:3000/notifications`
2. Scroll through the list

✅ **Expected:**
- Many notifications exist from all the previous tests (link request, registration approved, drop processed, swap decision, etc.)
- Each notification shows a title, body text, and timestamp
- Some appear read (normal appearance) and some appear unread (bold or highlighted)

3. Click **[Mark All as Read]** button if visible

✅ **Expected:** All notifications lose their "unread" styling — no more bold or highlighted entries

4. Refresh the page (F5)

✅ **Expected:** All still show as read after refresh

**PASS / FAIL:** ___

---

### TEST-052 — Admin Sends a Bulk Announcement

**Window:** Admin tab

1. Go to `http://localhost:3000/admin/notifications`
2. You see the announcement composer
3. Fill in:
   - **Title:** `Important: Testing Announcement`
   - **Body:** `This is a test announcement sent to all students.`
   - **Recipients:** select **"All Students"**
4. Click **[Send]** or **[Send Announcement]**

✅ **Expected:** Success message with a count of how many users received it (should be at least 2 — Student One and Student Two)

5. Switch to **Student One window** → `http://localhost:3000/notifications`

✅ **Expected:** New notification at the top: **"Important: Testing Announcement"** with the body text you entered

**PASS / FAIL:** ___

---

## SECTION 10 — Grade Progression

---

### TEST-053 — Admin Manual Grade Adjustment

**Window:** Admin tab

1. Go to `http://localhost:3000/admin/dashboard`
2. Look for a way to manage student grades. This may be accessible through a link on the dashboard, or navigate to `http://localhost:3000/admin/users` if such a page exists, or look for a "Grade Management" section
3. Find **Student Two** (currently Grade 11)
4. Click **[Change Grade]** or **[Edit Grade]**
5. Fill in:
   - **New Grade:** `12`
   - **Reason:** `Accelerated program approval`
6. Save

✅ **Expected:**
- Student Two's grade is now 12
- An audit log entry is created

7. Go to `http://localhost:3000/admin/audit`
8. Find the **GRADE_CHANGED** action

✅ **Expected:** Entry shows: user = admin, action = GRADE_CHANGED, previousData shows grade 11, newData shows grade 12, and your reason

9. Switch to **Student Two window** → `http://localhost:3000/notifications`

✅ **Expected:** Notification: **"Grade Updated"** showing the change from 11 to 12

10. Switch to **Parent window** → `http://localhost:3000/notifications`

✅ **Expected:** Parent also received a "Grade Updated" notification for Student Two (parent auto-CC)

**PASS / FAIL:** ___

---

### TEST-054 — Graduated Student Cannot Register

**Window:** Admin tab

1. Find **Student Two** in grade management
2. Change grade to **Graduated** (null/no grade — there should be a "Graduated" option in the dropdown)
3. Enter reason: `Testing graduation restriction`
4. Save

**Window:** Student Two incognito window

5. Go to `http://localhost:3000`

✅ **Expected:** Dashboard or home page shows "Graduated" status somewhere

6. Go to `http://localhost:3000/register`

✅ **Expected:**
- Registration page shows "You have graduated and cannot register for new subjects"
- OR the Register link is gone from navigation
- Cannot submit a registration

7. Go to `http://localhost:3000/registrations`

✅ **Expected:** Student Two CAN still see their registration history (graduated students keep read access to history)

8. Go to `http://localhost:3000/escrow`

✅ **Expected:** Student Two CAN still see their escrow balance (read-only remains after graduation)

**PASS / FAIL:** ___

---

### TEST-055 — Parent Can Still Withdraw Escrow for a Graduated Student

**Window:** Parent incognito window

1. Go to `http://localhost:3000/escrow`

✅ **Expected:** Student Two (graduated) still appears in the parent's escrow view with their current balance

2. Go to `http://localhost:3000/escrow/withdraw`
3. Select **Student Two**
4. Enter amount: `100` (they should have some balance from earlier)
5. Click **[Request Withdrawal]**

✅ **Expected:** Withdrawal request created successfully — graduation does not block the parent from managing the child's escrow

**PASS / FAIL:** ___

---

## SECTION 11 — Reports and Audit Trail

> Make sure the June 2026 session is active before running these. Re-create/activate it if needed.

---

### TEST-056 — Admin Views the Audit Log

**Window:** Admin tab

1. Go to `http://localhost:3000/admin/audit`
2. You see the full audit log

✅ **Expected:** The following action types appear somewhere in the log:
- `SUBJECT_CREATED` (from when you created subjects)
- `SESSION_CREATED` and `SESSION_UPDATED`
- `REGISTRATION_ADMIN_OVERRIDE`
- `PAYMENT_CONFIRMED`
- `GRADE_CHANGED`

3. Click on any log entry to expand it

✅ **Expected:** The entry shows **previousData** and **newData** in a readable format showing what changed

4. Use the filter: select action type **GRADE_CHANGED**

✅ **Expected:** The list filters to show only grade change events

5. Clear the filter and try filtering by a date range

✅ **Expected:** Only events within that date range appear

**PASS / FAIL:** ___

---

### TEST-057 — Admin Generates a Registration Report

**Window:** Admin tab

1. Go to `http://localhost:3000/admin/reports`
2. In the sidebar or dropdown, select **"Registration Report"**
3. A filter form appears. Enter:
   - **Session:** `June 2026`
4. Click **[Run Report]**

✅ **Expected:**
- A table appears with all registrations for June 2026
- Columns include: student name, grade, subject, price, status, who requested it, who approved it
- Row count shown (e.g., "5 results")

5. Click **[Download CSV]**

✅ **Expected:** A `.csv` file downloads to your computer. Open it in Excel/Notepad — it should contain the same data as the table.

**PASS / FAIL:** ___

---

### TEST-058 — Admin Generates a Financial Summary Report

1. On `http://localhost:3000/admin/reports`, select **"Financial Summary"**
2. Enter session: `June 2026`
3. Click **[Run Report]**

✅ **Expected:**
- Total revenue shown
- Breakdown by payment method (Bank Transfer count + amount)
- CSV download works

**PASS / FAIL:** ___

---

### TEST-059 — Admin Generates an Escrow Report

1. Select **"Escrow Report"**
2. No session filter needed — click **[Run Report]**

✅ **Expected:**
- All students with escrow accounts listed
- Balance per student shown
- Total escrow liability (sum of all balances) shown
- Pending withdrawal requests shown
- CSV download works

**PASS / FAIL:** ___

---

### TEST-060 — Admin Generates a Grade 10 Compliance Report

1. Select **"Grade 10 Core Compliance"**
2. Enter session: `June 2026`
3. Click **[Run Report]**

✅ **Expected:**
- Student One (Grade 10) appears
- For each core subject (Mathematics, English Language), a Yes/No column shows whether they are registered
- Both should show **Yes** since we confirmed them in earlier tests
- CSV download works

**PASS / FAIL:** ___

---

### TEST-061 — Admin Generates a Student Roster Report

1. Select **"Student Roster"**
2. Optionally filter by grade: `10`
3. Click **[Run Report]**

✅ **Expected:**
- Student One (Grade 10) appears
- Their name, email, grade, phone, and linked parent (Test Parent) are shown
- CSV download works

**PASS / FAIL:** ___

---

### TEST-062 — Admin Dashboard Shows Live Metrics

**Window:** Admin tab

1. Go to `http://localhost:3000/admin/dashboard`
2. Review all the metric cards

✅ **Expected cards and their values:**
- **Students by Grade** — should show at least 1 student in Grade 10, 1 graduated (Student Two)
- **Parents** — should show 1 (Test Parent)
- **Active Sessions** — should show 1 or 2 (depending on whether you re-activated sessions)
- **Pending Approvals** — count of any outstanding items
- **Escrow Liability** — sum of all student escrow balances (should be a positive number)

3. Look at the **Pending Approvals** table below the metric cards

✅ **Expected:** Any outstanding registration requests or change requests appear here with a "days waiting" column

**PASS / FAIL:** ___

---

### TEST-063 — Admin Generates a Pending Approvals Report

1. On `http://localhost:3000/admin/reports`, select **"Pending Approvals"**
2. Click **[Run Report]** (no filter needed)

✅ **Expected:**
- Any pending registration requests OR pending drop/swap requests appear
- Each row shows: student name, parent name, subject, request type, date submitted, days waiting
- CSV download works

**PASS / FAIL:** ___

---

### TEST-064 — Admin Generates a Subject Enrollment Report

1. Select **"Subject Enrollment"**
2. Enter session: `June 2026`
3. Click **[Run Report]**

✅ **Expected:**
- Each subject listed with the number of confirmed enrolled students
- Revenue per subject shown
- CSV download works

**PASS / FAIL:** ___

---

## SECTION 12 — Access Control and Security Tests

---

### TEST-065 — Student Cannot Access Admin Pages

**Window:** Student One incognito window

1. In the browser address bar, type `http://localhost:3000/admin/subjects` and press Enter

✅ **Expected:** You are either:
- Redirected to `http://localhost:3000/unauthorized`
- OR redirected to `http://localhost:3000/sign-in`
- OR see a "403 Forbidden" / "Unauthorized" message

2. Try `http://localhost:3000/admin/sessions` → same result
3. Try `http://localhost:3000/admin/reports` → same result

❌ **If you see the admin subjects/sessions/reports page:** This is a serious security failure.

**PASS / FAIL:** ___

---

### TEST-066 — Parent Cannot Access Another Parent's Children's Data

**Window:** Open a **new incognito window**

1. Go to `http://localhost:3000/sign-up` → **"I'm a Parent"**
2. Create a new account:
   - **Full Name:** `Second Parent`
   - **Email:** `parent2@test.com`
   - **Password:** `Password1`
   - **Confirm Password:** `Password1`
3. Sign in as `parent2@test.com`
4. Go to `http://localhost:3000/escrow`

✅ **Expected:** No children shown — the escrow page is empty or says "No linked children"

5. Go to `http://localhost:3000/approvals`

✅ **Expected:** No pending approvals — this parent has no linked children

6. Go to `http://localhost:3000/links`
7. Try to link `student1@test.com` and if you get through, Student One would need to approve — but DO NOT approve (to keep Student One only linked to Test Parent)

✅ **Expected:** Student One's data is completely invisible to Parent Two until and unless Student One explicitly approves a link

**PASS / FAIL:** ___

---

### TEST-067 — Price Snapshot Is Preserved After Subject Price Change

**Window:** Admin tab

1. Go to `http://localhost:3000/admin/subjects`
2. Find **Mathematics** and click **[Edit]**
3. Change the **In-School Price** from `500` to `9999`
4. Save

5. Go to `http://localhost:3000/admin/reports` → **Registration Report** → session: June 2026 → Run

✅ **Expected:** Student One's existing Mathematics registration still shows price **500** (the price at the time of registration), NOT 9999

6. Change Mathematics price back to `500` to clean up

**PASS / FAIL:** ___

---

## SECTION 13 — Full End-to-End Journey

> This final test re-runs the complete workflow from scratch to confirm everything connects.

---

### TEST-068 — Complete Workflow

**Accounts needed:** Admin, Student One, Parent (all from earlier sections)

**Window:** Admin tab

1. Confirm June 2026 session is **Active**. If not, create and activate one.

**Window:** Student One window (Grade 10)

2. Go to `http://localhost:3000/register`
3. Confirm that **Mathematics** and **English Language** are pre-selected and locked (core subjects)
4. Additionally select **Chemistry**
5. Click **[Submit Request]**

**Window:** Parent window

6. Go to `http://localhost:3000/notifications` — see the registration request notification
7. Go to `http://localhost:3000/approvals` — approve the request
8. Go to `http://localhost:3000/checkout` — select Bank Transfer, initiate payment

**Window:** Admin tab

9. Go to `http://localhost:3000/admin/payments` — confirm the bank transfer

**Window:** Student One window

10. Go to `http://localhost:3000/notifications` — see payment confirmed notification
11. Go to `http://localhost:3000/registrations` — confirm all three subjects show **confirmed**

**Window:** Student One window

12. Find Chemistry in registrations
13. Click **[Request Drop]** → reason: `Test end-to-end drop` → Submit

**Window:** Parent window

14. Go to `http://localhost:3000/approvals` — see the drop request
15. Click **[Approve]**
16. Go to `http://localhost:3000/escrow` — Student One's balance should have increased by 550 (Chemistry price)

**Window:** Admin tab

17. Go to `http://localhost:3000/admin/reports` → Registration Report for June 2026 → Run
18. Confirm approval trail is visible (who requested, who approved, who confirmed payment)
19. Go to `http://localhost:3000/admin/audit`
20. Confirm all actions from this end-to-end test appear in the log

✅ **Final Expected Result:** Every step completes without errors, all notifications fire, all financial changes are accurate, and the audit log contains a complete history.

**PASS / FAIL:** ___

---

## Testing Summary Checklist

Print this page or copy the table. Mark each test as ✅ PASS or ❌ FAIL.

| # | Test Description | Result | Notes |
|---|---|---|---|
| 001 | Create Student One account (Grade 10) | | |
| 002 | Create Student Two account (Grade 11) | | |
| 003 | Create Parent account | | |
| 004 | Wrong password — no lockout | | |
| 005 | Profile update (name + phone) | | |
| 006 | Parent sends link request to Student One | | |
| 007 | Student One gets link notification | | |
| 008 | Student One approves link | | |
| 009 | Parent gets approval notification | | |
| 010 | Parent links to Student Two | | |
| 011 | Reject a link request | | |
| 012 | Admin creates Mathematics (core, in-school) | | |
| 013 | Admin creates English Language (core, in-school) | | |
| 014 | Admin creates Physics (not core) | | |
| 015 | Admin creates Art and Design (non-school, custom price) | | |
| 016 | Admin creates Chemistry | | |
| 017 | Admin edits subject price | | |
| 018 | Admin deactivates and reactivates a subject | | |
| 019 | Student browses subjects (read-only, no edit buttons) | | |
| 020 | Admin creates June session (Draft) | | |
| 021 | Admin activates session | | |
| 022 | Students and parents see the open session | | |
| 023 | Two different session types active simultaneously | | |
| 024 | Duplicate session type blocked | | |
| 025 | Admin edits active session deadline | | |
| 026 | Core subjects pre-selected and locked for Grade 10 | | |
| 027 | Student submits registration request | | |
| 028 | Parent notified of registration request | | |
| 029 | Parent approves registration | | |
| 030 | Student notified, status becomes pending_payment | | |
| 031 | Student cannot pay (parent only) | | |
| 032 | Parent initiates bank transfer payment | | |
| 033 | Admin confirms bank transfer | | |
| 034 | Parent receives payment receipt notification | | |
| 035 | Cannot register same subject twice | | |
| 036 | Parent directly registers for Student Two (no approval) | | |
| 037 | Admin override — register without parent approval | | |
| 038 | Student escrow is read-only | | |
| 039 | Parent views escrow for all children | | |
| 040 | Drop subject to fund escrow | | |
| 041 | Parent transfers escrow between children | | |
| 042 | Cannot transfer more than available balance | | |
| 043 | Parent requests escrow withdrawal | | |
| 044 | Admin fulfills withdrawal | | |
| 045 | Student requests to drop a subject | | |
| 046 | Student cannot drop core subjects | | |
| 047 | Parent approves drop — escrow credited | | |
| 048 | Parent rejects drop — registration stays confirmed | | |
| 049 | Student requests swap — parent approves | | |
| 050 | All actions blocked when window is closed | | |
| 051 | Notification center — mark all read | | |
| 052 | Admin sends bulk announcement | | |
| 053 | Admin manual grade adjustment | | |
| 054 | Graduated student cannot register | | |
| 055 | Parent can withdraw for graduated student | | |
| 056 | Audit log — all actions tracked, filters work | | |
| 057 | Registration report + CSV download | | |
| 058 | Financial summary report + CSV download | | |
| 059 | Escrow report + CSV download | | |
| 060 | Grade 10 compliance report + CSV download | | |
| 061 | Student roster report + CSV download | | |
| 062 | Admin dashboard metrics | | |
| 063 | Pending approvals report + CSV download | | |
| 064 | Subject enrollment report + CSV download | | |
| 065 | Student cannot access admin pages | | |
| 066 | Parent cannot see another parent's children | | |
| 067 | Price snapshot preserved after price change | | |
| 068 | Full end-to-end journey | | |

---

## Troubleshooting Common Problems

| Problem | What to do |
|---|---|
| Page shows a white screen with an error | Press F12 → Console tab → copy the red error text |
| "Unauthorized" when you expect to be logged in | Go to `/sign-in`, log in again |
| "Network Error" or page won't load | Check that `pnpm dev` is still running in PowerShell. If the terminal closed, run it again. |
| Admin dashboard not accessible after role change | Sign out and sign in again to refresh the session |
| A button you expect to see is missing | Check that you are logged in as the right account (correct role) |
| CSV download does nothing | Check the browser's downloads folder (usually `C:\Users\Sameh\Downloads`) |
| Form shows "validation error" | Check all required fields are filled in correctly |

---

*Three features are intentionally not in this guide as they are deferred:*
- *NOT-002: 24-hour session closing reminder (scheduler not yet implemented)*
- *Graduation Plan UI (P3 priority — post-launch)*
- *PDF/Excel export (CSV implemented; PDF/Excel post-launch)*
