// F6 — the screens of the reservation cycle, per role (RESERVATION_FOCUS.md §2: what the switch keeps),
// with the dev data of setup-1..7 (igcse_ui_dev). Staff at a desktop (1366×900), families at a phone
// (390×844), the sign-in and sign-up pages at both.
export const IDS = {
  june: '6d34f4aa-11fc-45a8-b04b-55e04a25b3a9',
  winter: '8ed91356-dedc-4028-a36d-f0be8acc2375',
  a1: 'LWt5OX5OJu635vIH3zP8N85lyLOBRaKP',
  b1: 'kVWOchMRbS7uMtalijInbJfLYn8SW3Wp',
  c1: 'd47sPmOu3WCiI7BdL6XxXBzs8Ckarl3P',
  c2: 'O6ygw3eZxPERuCAyokI03hIa7sbVfPNg',
  d1: 'WW0prJC4XjLa0N3tbZqbcLVS66XDqLXV',
  receiptA1Biology: '84852ac2-1a67-4372-b7a7-324ea7f7067b',
  bBiologyP4: '2ca9edbd-ac2b-4b0c-b228-1e7e4844a6eb',
  bArabic: 'ba8211f4-62ad-46aa-9dc6-4bcd8e39f2e1',
};

export const ACCOUNTS = {
  admin: { email: 'admin@igcse.local', password: 'AdminPass1', device: 'desktop' },
  coordinator: { email: 'coordinator.ui@igcse.local', password: 'TestPass1', device: 'desktop' },
  finance_admin: { email: 'finadmin.rana@igcse.local', password: 'TestPass1', device: 'desktop' },
  finance_officer: { email: 'officer.mona@igcse.local', password: 'TestPass1', device: 'desktop' },
  teacher: { email: 'teacher.ui@igcse.local', password: 'TestPass1', device: 'desktop' },
  gate: { email: 'gate.ui@igcse.local', password: 'TestPass1', device: 'desktop' },
  parent_a: { email: 'parent.a@igcse.local', password: 'TestPass1', device: 'phone' },
  parent_b: { email: 'parent.b@igcse.local', password: 'TestPass1', device: 'phone' },
  parent_c: { email: 'parent.c@igcse.local', password: 'TestPass1', device: 'phone' },
  parent_d: { email: 'parent.d@igcse.local', password: 'TestPass1', device: 'phone' },
  student_c1: { email: 'student.c1@igcse.local', password: 'TestPass1', device: 'phone' },
  student_a1: { email: 'student.a1@igcse.local', password: 'TestPass1', device: 'phone' },
  anon: { email: null, device: 'desktop' },
  anon_phone: { email: null, device: 'phone' },
};

const openDeskStudent = (name) => async (page) => {
  const box = page.locator('main input[type=search], main input[type=text]').first();
  await box.fill(name);
  await page.waitForTimeout(1200);
  await page.getByText(name, { exact: false }).first().click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1200);
};

const S = (id, role, path, extra = {}) => ({ id, role, path, ...extra });

export const SCREENS = [
  // ── 1. The staff landings and Sessions (set up) ──
  S('s01-home-admin', 'admin', '/'),
  S('s02-home-coordinator', 'coordinator', '/'),
  S('s03-home-teacher', 'teacher', '/'),
  S('s04-home-gate', 'gate', '/'),
  S('s05-sessions', 'admin', '/admin/sessions'),
  S('s06-session-subjects', 'admin', `/admin/sessions/${IDS.june}#subjects`),
  S('s07-session-fees', 'admin', `/admin/sessions/${IDS.june}#fees`),
  S('s08-session-money', 'admin', `/admin/sessions/${IDS.june}#money`),
  S('s09-session-grade10', 'admin', `/admin/sessions/${IDS.june}#grade10`),
  S('s10-session-verify', 'admin', `/admin/sessions/${IDS.june}#verify`),
  S('s11-session-coordinator', 'coordinator', `/admin/sessions/${IDS.june}#subjects`),
  S('s12-session-draft', 'admin', `/admin/sessions/${IDS.winter}#subjects`),
  S('s13-catalogue', 'admin', '/exams/catalogue'),
  S('s14-subjects', 'admin', '/admin/subjects'),
  S('s15-series', 'admin', '/exams/series'),
  S('s16-services', 'admin', '/exams/services'),
  S('s17-school-fees', 'admin', '/admin/school-fees'),
  S('s18-settings', 'admin', '/settings'),
  S('s19-imports', 'admin', '/imports'),
  S('s20-team', 'admin', '/admin/team'),
  // ── 2. The desk and the Student 360 (reserve and pay) ──
  S('s30-desk-officer', 'finance_officer', '/desk'),
  S('s31-desk-student', 'finance_officer', '/desk', { act: openDeskStudent('Student Placeholder A1') }),
  S('s32-desk-admin', 'admin', '/desk'),
  S('s33-students', 'admin', '/students'),
  S('s34-student-record', 'admin', `/students/${IDS.a1}`),
  // ── 3. Money and follow-up ──
  S('s40-charges', 'finance_admin', '/charges'),
  S('s41-payments', 'admin', '/admin/payments'),
  S('s42-exceptions', 'finance_admin', '/admin/exceptions'),
  S('s43-messages', 'admin', '/admin/messages'),
  S('s44-escrow-admin', 'admin', '/admin/escrow'),
  S('s45-finance', 'finance_admin', '/finance'),
  S('s46-takings', 'finance_officer', '/takings'),
  S('s47-session-money-officer', 'finance_officer', `/admin/sessions/${IDS.june}#money`),
  S('s48-sessions-officer', 'finance_officer', '/admin/sessions'),
  // ── 4. The entries to the board ──
  S('s50-deadlines', 'admin', '/exams/deadlines'),
  S('s51-entries', 'admin', '/exams/entries'),
  S('s52-entry-lists', 'admin', '/exams/entry-lists'),
  // ── 5. Account (staff) and the printed papers ──
  S('s55-notifications-staff', 'admin', '/notifications'),
  S('s56-profile-staff', 'admin', '/profile'),
  S('s58-receipt-print', 'finance_officer', `/receipt-print/${IDS.receiptA1Biology}`),
  S('s59-reservation-slip', 'finance_officer', `/reservation-slip/${IDS.a1}`),
  // ── 6. The families (at a phone) ──
  S('f01-home-parent-b', 'parent_b', '/'),
  S('f02-home-parent-d', 'parent_d', '/'),
  S('f03-home-parent-c', 'parent_c', '/'),
  S('f04-home-parent-a', 'parent_a', '/'),
  S('f05-home-student-c1', 'student_c1', '/'),
  S('f06-register-parent', 'parent_b', '/register'),
  S('f07-register-student', 'student_c1', '/register'),
  S('f08-registrations', 'parent_b', '/registrations'),
  S('f09-history', 'parent_c', '/registrations/history'),
  S('f10-approvals', 'parent_c', '/approvals'),
  S('f11-statement', 'parent_b', '/statement'),
  S('f12-school-fee', 'parent_d', '/school-fee'),
  S('f13-charges-due', 'parent_b', '/charges-due'),
  S('f14-escrow', 'parent_c', '/escrow'),
  S('f15-escrow-withdraw', 'parent_c', '/escrow/withdraw'),
  S('f16-escrow-transfer', 'parent_c', '/escrow/transfer'),
  S('f17-links', 'parent_b', '/links'),
  S('f18-checkout', 'parent_b', `/checkout?ids=${IDS.bBiologyP4}`),
  S('f19-pending-requests', 'student_c1', '/pending-requests'),
  S('f20-notifications-family', 'parent_b', '/notifications'),
  S('f21-profile-family', 'parent_b', '/profile'),
  S('f22-statement-student', 'student_a1', '/statement'),
  // ── 7. Sign-in and sign-up ──
  S('a01-sign-in', 'anon', '/sign-in'),
  S('a02-sign-in-phone', 'anon_phone', '/sign-in'),
  S('a03-sign-up', 'anon_phone', '/sign-up'),
  S('a04-sign-up-parent', 'anon_phone', '/sign-up/parent'),
  S('a05-sign-up-student', 'anon_phone', '/sign-up/student'),
  S('a06-forgot-password', 'anon_phone', '/forgot-password'),
  S('a07-verify-email', 'anon_phone', '/verify-email'),
  S('a08-unauthorized', 'anon', '/unauthorized'),
];
