/**
 * F6b — the reservation cycle only (FEATURES_PLAN.md §1 F6b; docs/features/RESERVATION_FOCUS.md).
 *
 * The owner, 14 Oct 2026: "we are currently purely focusing and prioritizing the reservation system
 * only and its complete cycle … any items that do not belong in this lifecycle should just be hidden
 * for now and we will work on them later". Hidden, never removed: no page, route or endpoint is
 * deleted, and every hidden screen stays reachable by its URL.
 *
 * One constant switches it. `RESERVATION_CYCLE_ONLY = false` gives back every sidebar, landing and
 * link exactly as it was before F6b. Everything F6b hides or reorders reads this file:
 * - the sidebar (`components/nav-shell.tsx`): a role's items less its list below, in the cycle's
 *   order (`CYCLE_STAGES`), its landing first;
 * - the landing after sign-in and on "/" (`CYCLE_LANDING`);
 * - every link on a kept screen that opens a screen outside the cycle for the viewer (`leadsOutsideTheCycle`).
 *
 * The cycle, as the school lives it: the admin sets it up (the session's sheet, the teachers it
 * names, the subjects' papers on the Catalogue, the fees, the boards' dates, the settings behind
 * them, the day-one import) → families reserve (the Reserve page, or the desk on their behalf, with
 * the onboarding of a new family) → they pay (the desk, the checkout, instalments, receipts, the
 * wallet) → the school follows up (declared sittings, exceptions, reminders and messages, a pushed
 * charge or the school fee) → drops and refunds → money is known (the session's Money tab, the
 * finance workbench, daily takings, the statement) → the entries go to the board (exam entries,
 * entry lists, the series' deadlines).
 */

import { isRole, type Role } from '@repo/validations';

/** The switch: true while the school works on the reservation cycle only. */
export const RESERVATION_CYCLE_ONLY: boolean = true;

/**
 * F1's screens (docs/features/SCHEDULING.md §9): the timetables with their editor and print, teaching
 * groups, the timetable rules, cover, and the families' week. The timetable is outside the cycle, so
 * they are on every role's list (the lead, 15 Oct 2026, at F1's merge after F6b); each still opens
 * by its URL, and the switch off puts them back on the sidebars that had them.
 */
const TIMETABLE_SCREENS = ['/timetable/versions', '/timetable/groups', '/timetable/rules', '/timetable/cover', '/my-timetable'] as const;

/**
 * The coordinator rework (COORDINATOR_REWORK.md §9.3, A6, G1, G2, G5): the screens set-up no longer goes
 * through — the Exam Catalogue, Board Series, Board Services, School Fees, the exam deadlines, candidates,
 * entries and entry lists, Subject Management — hidden for the coordinator and the admin. Each still opens
 * by its URL; her Set up is Sessions (and Team for the admin).
 */
const SET_UP_PARKED = [
  '/exams/catalogue', '/exams/series', '/exams/services', '/admin/school-fees',
  '/exams/deadlines', '/exams/candidates', '/exams/entries', '/exams/entry-lists', '/admin/subjects',
] as const;

/**
 * What is outside the cycle, per role: the screens that role would otherwise reach from its
 * sidebar or from a link on one of its kept screens. A path hides itself and everything under it
 * ("/academic/sections" hides "/academic/sections?section=…"). Why each line is here is in
 * docs/features/RESERVATION_FOCUS.md §2, role by role.
 */
export const OUTSIDE_THE_CYCLE: Readonly<Record<Role, readonly string[]>> = {
  admin: [
    '/admin/dashboard', // replaced by the landing: the cycle's next step
    '/today', // the school's day
    '/teaching', '/exams/forecasts', '/exams/invigilation', // teaching (an admin who teaches)
    '/academic/sections', '/academic/enrolment', '/academic/years', '/academic/calendar', '/academic/bells', '/academic/rooms',
    // Candidates is a step of the hand-off since the lead's decision of 16 Oct 2026 (5): not on this list.
    '/exams/timetable', '/exams/days', '/exams/results', '/exams/certificates', '/exams/my',
    '/remarks-desk', '/results-entry',
    '/admin/reports', '/admin/audit',
    // The lead's decisions of 16 Oct 2026 (8, 13): Subjects — the Catalogue is the subject list and the session's
    // form joins its teachers to the pool, its fee columns contradict the session's fees; Payments — no new payment
    // uses the old bank transfer, InstaPay is confirmed on the Finance Workbench. Both reachable by URL.
    '/admin/subjects', '/admin/payments',
    ...TIMETABLE_SCREENS, // F1: the timetable
    ...SET_UP_PARKED, // the coordinator rework (§9.3)
  ],
  coordinator: [
    '/today',
    '/teaching', '/exams/forecasts', '/exams/invigilation',
    '/academic/sections', '/academic/enrolment', '/academic/years', '/academic/calendar', '/academic/bells', '/academic/rooms',
    '/exams/timetable', '/exams/days', '/exams/results', '/exams/certificates', '/exams/my',
    ...TIMETABLE_SCREENS,
    // The coordinator rework (§9.3): set-up is the session's. Settings holds no session rule of hers any more
    // (G3), and the day-one import is parked with the Catalogue it maps onto (§9.2).
    ...SET_UP_PARKED, '/settings', '/imports',
  ],
  finance_admin: [
    '/teaching', '/exams/forecasts', '/exams/invigilation',
    '/remarks-desk', '/results-entry', '/exams/certificates',
    // Links on the desk's academic panel and on the student record.
    '/academic/sections', '/academic/enrolment', '/exams/my',
    ...TIMETABLE_SCREENS,
  ],
  finance_officer: [
    '/teaching', '/exams/forecasts', '/exams/invigilation',
    '/remarks-desk', '/results-entry', '/exams/certificates',
    '/academic/sections', '/academic/enrolment', '/exams/my',
    ...TIMETABLE_SCREENS,
  ],
  teacher: ['/today', '/teaching', '/exams/forecasts', '/exams/invigilation', ...TIMETABLE_SCREENS],
  gate: ['/today', '/teaching', '/exams/forecasts', '/exams/invigilation', ...TIMETABLE_SCREENS],
  parent: ['/remarks', '/exams/my', '/subjects', ...TIMETABLE_SCREENS],
  student: ['/subjects', '/remarks', '/exams/my', ...TIMETABLE_SCREENS],
};

/** Where each role lands after sign-in, and its sidebar's first item, while the switch is on. */
export const CYCLE_LANDING: Readonly<Record<Role, string>> = {
  admin: '/',
  coordinator: '/',
  finance_admin: '/desk',
  finance_officer: '/desk',
  teacher: '/',
  gate: '/',
  parent: '/',
  student: '/',
};

/**
 * The staff sidebar in the cycle's order: after the landing, one group per stage, each holding the
 * role's kept items in this order. A family's sidebar keeps its own groups (Registration,
 * Financial, Account), which already run in the cycle's order.
 */
export const CYCLE_STAGES: readonly { titleKey: string; hrefs: readonly string[] }[] = [
  // The coordinator rework (§9.3): the coordinator's Set up is Sessions, the admin's Sessions and Team (the
  // parked screens are on their lists above; a finance admin keeps School Fees and Board Services here).
  {
    titleKey: 'nav.cycleSetUp',
    hrefs: ['/admin/sessions', '/exams/catalogue', '/admin/subjects', '/exams/series', '/exams/services', '/admin/school-fees', '/admin/team'],
  },
  { titleKey: 'nav.cycleReserve', hrefs: ['/desk', '/students', '/charges', '/admin/payments'] },
  { titleKey: 'nav.cycleFollowUp', hrefs: ['/admin/exceptions', '/admin/messages', '/admin/escrow'] },
  { titleKey: 'nav.cycleMoney', hrefs: ['/finance', '/takings'] },
  // The school's settings and the day-one import, out of Set up (§9.3): the admin's and the finance admin's.
  { titleKey: 'nav.school', hrefs: ['/settings', '/imports'] },
  // Candidates (the lead's decision of 16 Oct 2026, 5): the entry lists refuse an entry without a candidate
  // number, legal name, date of birth or UCI — a step of the hand-off, before the entries.
  { titleKey: 'nav.cycleBoard', hrefs: ['/exams/deadlines', '/exams/candidates', '/exams/entries', '/exams/entry-lists'] },
  { titleKey: 'nav.account', hrefs: ['/notifications', '/profile'] },
];

/**
 * The finance officer reads a session for its Money tab (who has not paid, Remind) and its To
 * verify tab, never its sheet or its fees: on that sidebar Sessions sits with the follow-up.
 */
export const STAGE_OVERRIDE: Readonly<Partial<Record<Role, Readonly<Record<string, string>>>>> = {
  finance_officer: { '/admin/sessions': 'nav.cycleFollowUp' },
};

const pathOf = (href: string) => href.split(/[?#]/)[0] ?? href;
const under = (path: string, screen: string) => path === screen || path.startsWith(`${screen}/`);

/**
 * The coordinator rework's hiding (§9.3), whatever the switch above says: the parked set-up screens leave the
 * coordinator's and the admin's sidebars (with the switch off too), and the coordinator's Settings and import.
 */
export function parkedForSetUp(role: string | null | undefined, href: string): boolean {
  const path = pathOf(href);
  if (role === 'admin') return SET_UP_PARKED.some((screen) => under(path, screen));
  if (role === 'coordinator') return [...SET_UP_PARKED, '/settings', '/imports'].some((screen) => under(path, screen));
  return false;
}

/** Whether a screen is outside the cycle for this role (always false with the switch off). */
export function isOutsideTheCycle(role: string | null | undefined, href: string): boolean {
  if (!RESERVATION_CYCLE_ONLY || !role || !isRole(role)) return false;
  const path = pathOf(href);
  return OUTSIDE_THE_CYCLE[role].some((screen) => under(path, screen));
}

const ON_ANY_LIST = [...new Set(Object.values(OUTSIDE_THE_CYCLE).flat())];

/** Whether a screen is on any role's list (always false with the switch off): a part of the cycle hidden for all. */
function onAnyList(href: string): boolean {
  if (!RESERVATION_CYCLE_ONLY) return false;
  const path = pathOf(href);
  return ON_ANY_LIST.some((screen) => under(path, screen));
}

/**
 * Whether a link on a kept screen opens a screen hidden for the signed-in role: outside the cycle for it (with the
 * switch on), or a set-up screen the coordinator rework parked for it. Each role's list is its own — Exam Deadlines'
 * "Open candidates" stays for finance, whose list does not hold Candidates. Without a role (a component that cannot
 * know the viewer) a link is hidden when any role's list holds it, as before.
 */
export function leadsOutsideTheCycle(href: string, role: string | null | undefined): boolean {
  if (role && isRole(role)) return isOutsideTheCycle(role, href) || parkedForSetUp(role, href);
  return onAnyList(href);
}

/**
 * Whether the timetable (F1) is hidden: its screens are on the lists above while the switch is on.
 * A kept screen that draws a piece of the timetable in place (the student record's week) asks this,
 * so the block comes back with the screens when the switch is off or the timetable leaves the lists.
 */
export function timetableHidden(): boolean {
  return onAnyList('/my-timetable');
}

/**
 * Whether the remarks are hidden (the Remarks Desk is on the lists above while the switch is on). Board
 * Services stays in the cycle — the services a reservation can carry and their fees per series are the
 * cycle's money — but its remark services belong to the remarks: the screen hides their rows while this is
 * true (the lead's decision of 16 Oct 2026, 7). The API is untouched; the switch off shows them again.
 */
export function remarksHidden(): boolean {
  return onAnyList('/remarks-desk');
}

/**
 * Whether Exam Deadlines lists only the dates that stop entries — the entry and retake deadlines, and the
 * exams' start where it is the cut-off (a sitting with no entry deadline) — while the switch is on (the
 * lead's decision of 16 Oct 2026, 10): forecasts, arrangements, the timetable, results and certificates are
 * outside the cycle, their screens on the lists above.
 */
export function entryDatesOnly(): boolean {
  return onAnyList('/exams/results');
}

/** Where a role lands after sign-in while the switch is on. */
export function cycleLandingFor(role: string | null | undefined): string {
  return role && isRole(role) ? CYCLE_LANDING[role] : '/';
}

/** The stage group an item sits in on this role's sidebar, or null when no stage names it. */
export function cycleStageOf(role: string | null | undefined, href: string): string | null {
  const override = role && isRole(role) ? STAGE_OVERRIDE[role]?.[href] : undefined;
  if (override) return override;
  return CYCLE_STAGES.find((s) => s.hrefs.includes(href))?.titleKey ?? null;
}
