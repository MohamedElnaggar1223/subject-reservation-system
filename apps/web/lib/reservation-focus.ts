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
 * - every link on a kept screen that opens a screen outside the cycle (`leadsOutsideTheCycle`).
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
    '/exams/candidates', '/exams/timetable', '/exams/days', '/exams/results', '/exams/certificates', '/exams/my',
    '/remarks-desk', '/results-entry',
    '/admin/reports', '/admin/audit',
  ],
  coordinator: [
    '/today',
    '/teaching', '/exams/forecasts', '/exams/invigilation',
    '/academic/sections', '/academic/enrolment', '/academic/years', '/academic/calendar', '/academic/bells', '/academic/rooms',
    '/exams/candidates', '/exams/timetable', '/exams/days', '/exams/results', '/exams/certificates', '/exams/my',
  ],
  finance_admin: [
    '/teaching', '/exams/forecasts', '/exams/invigilation',
    '/remarks-desk', '/results-entry', '/exams/certificates',
    // Links on the desk's academic panel and on the student record.
    '/academic/sections', '/academic/enrolment', '/exams/my',
  ],
  finance_officer: [
    '/teaching', '/exams/forecasts', '/exams/invigilation',
    '/remarks-desk', '/results-entry', '/exams/certificates',
    '/academic/sections', '/academic/enrolment', '/exams/my',
  ],
  teacher: ['/today', '/teaching', '/exams/forecasts', '/exams/invigilation'],
  gate: ['/today', '/teaching', '/exams/forecasts', '/exams/invigilation'],
  parent: ['/remarks', '/exams/my', '/subjects'],
  student: ['/subjects', '/remarks', '/exams/my'],
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
  {
    titleKey: 'nav.cycleSetUp',
    hrefs: ['/admin/sessions', '/exams/catalogue', '/admin/subjects', '/exams/series', '/exams/services', '/admin/school-fees', '/settings', '/imports', '/admin/team'],
  },
  { titleKey: 'nav.cycleReserve', hrefs: ['/desk', '/students', '/charges', '/admin/payments'] },
  { titleKey: 'nav.cycleFollowUp', hrefs: ['/admin/exceptions', '/admin/messages', '/admin/escrow'] },
  { titleKey: 'nav.cycleMoney', hrefs: ['/finance', '/takings'] },
  { titleKey: 'nav.cycleBoard', hrefs: ['/exams/deadlines', '/exams/entries', '/exams/entry-lists'] },
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

/** Whether a screen is outside the cycle for this role (always false with the switch off). */
export function isOutsideTheCycle(role: string | null | undefined, href: string): boolean {
  if (!RESERVATION_CYCLE_ONLY || !role || !isRole(role)) return false;
  const path = pathOf(href);
  return OUTSIDE_THE_CYCLE[role].some((screen) => under(path, screen));
}

const ON_ANY_LIST = [...new Set(Object.values(OUTSIDE_THE_CYCLE).flat())];

/**
 * Whether a link on a kept screen opens a screen outside the cycle (always false with the switch
 * off). A screen is outside the cycle or not whoever looks at it — the lists above differ only in
 * which screens each role reaches — so a link reads every role's list, and the component that
 * draws it need not know the viewer.
 */
export function leadsOutsideTheCycle(href: string): boolean {
  if (!RESERVATION_CYCLE_ONLY) return false;
  const path = pathOf(href);
  return ON_ANY_LIST.some((screen) => under(path, screen));
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
