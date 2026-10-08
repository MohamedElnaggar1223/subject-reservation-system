'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { authClient } from '~/lib/auth-client';
import { api } from '~/lib/hono';
import { apiResponse, ROLE_LABELS, isRole } from '@repo/validations';
import { cn } from '~/lib/utils';
import { useI18n, type TranslationKey } from '~/lib/i18n';

/* ─── Icons (inline SVGs to avoid deps) ─────────────────────────────────────── */

function Icon({ d, className }: { d: string; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={cn('size-5 shrink-0', className)}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

const icons = {
  home: 'M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25',
  register: 'M12 9v6m3-3H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z',
  registrations: 'M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z',
  subjects: 'M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25',
  approvals: 'M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  links: 'M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.553a4.5 4.5 0 00-1.242-7.244l4.5-4.5a4.5 4.5 0 016.364 6.364l-1.757 1.757',
  escrow: 'M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z',
  notifications: 'M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0',
  requests: 'M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5',
  profile: 'M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z',
  history: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z',
  checkout: 'M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z',
  // Admin
  dashboard: 'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z',
  sessions: 'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5',
  payments: 'M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  reports: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z',
  audit: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m5.231 13.481L15 17.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v16.5c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9zm3.75 11.625a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z',
  adminEscrow: 'M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125',
  signOut: 'M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9',
  menu: 'M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5',
  close: 'M6 18L18 6M6 6l12 12',
  documents: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z',
  language: 'M12 21a9 9 0 100-18m0 18a9 9 0 010-18m0 18c2.071 0 3.75-4.03 3.75-9S14.071 3 12 3m0 18c-2.071 0-3.75-4.03-3.75-9S9.929 3 12 3M3.6 9h16.8M3.6 15h16.8',
  // F0a
  students: 'M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5',
  sections: 'M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z',
  calendar: 'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5m-9-6h.008v.008H12v-.008zM12 15h.008v.008H12V15zm0 2.25h.008v.008H12v-.008zM9.75 15h.008v.008H9.75V15zm0 2.25h.008v.008H9.75v-.008zM7.5 15h.008v.008H7.5V15zm0 2.25h.008v.008H7.5v-.008zm6.75-4.5h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V15zm0 2.25h.008v.008h-.008v-.008zm2.25-4.5h.008v.008H16.5v-.008zm0 2.25h.008v.008H16.5V15z',
  bell: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z',
  rooms: 'M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21',
  settings: 'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  today: 'M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z',
} as const;

/* ─── Navigation Config ─────────────────────────────────────────────────────── */

type NavItem = {
  labelKey: TranslationKey;
  href: string;
  icon: keyof typeof icons;
};

type NavSection = {
  titleKey?: TranslationKey;
  items: NavItem[];
};

/** The academic structure (F0a): the coordinator's and admin's. */
const ACADEMIC_ITEMS: NavItem[] = [
  { labelKey: 'nav.students', href: '/students', icon: 'students' },
  { labelKey: 'nav.sections', href: '/academic/sections', icon: 'sections' },
  { labelKey: 'nav.enrolment', href: '/academic/enrolment', icon: 'registrations' },
  { labelKey: 'nav.academicYear', href: '/academic/years', icon: 'sessions' },
  { labelKey: 'nav.calendar', href: '/academic/calendar', icon: 'calendar' },
  { labelKey: 'nav.bellSchedules', href: '/academic/bells', icon: 'bell' },
  { labelKey: 'nav.rooms', href: '/academic/rooms', icon: 'rooms' },
];

/**
 * Exams: F4's exam-entry management — the deadlines first (what is due), then
 * the work in the order of a series — candidates, entries, the boards' lists,
 * the timetable, exam days, results, certificates — and F0b's catalogue and
 * board series. The coordinator's and admin's.
 */
const EXAMS_SECTION: NavSection = {
  titleKey: 'nav.exams',
  items: [
    { labelKey: 'nav.examDeadlines', href: '/exams/deadlines', icon: 'history' },
    { labelKey: 'nav.candidates', href: '/exams/candidates', icon: 'students' },
    { labelKey: 'nav.entries', href: '/exams/entries', icon: 'registrations' },
    { labelKey: 'nav.entryLists', href: '/exams/entry-lists', icon: 'approvals' },
    { labelKey: 'nav.forecasts', href: '/exams/forecasts', icon: 'reports' },
    { labelKey: 'nav.examTimetable', href: '/exams/timetable', icon: 'calendar' },
    { labelKey: 'nav.examDays', href: '/exams/days', icon: 'rooms' },
    { labelKey: 'nav.examResults', href: '/exams/results', icon: 'reports' },
    { labelKey: 'nav.certificates', href: '/exams/certificates', icon: 'documents' },
    { labelKey: 'nav.catalogue', href: '/exams/catalogue', icon: 'subjects' },
    { labelKey: 'nav.boardSeries', href: '/exams/series', icon: 'sessions' },
    // The reservations rework, step C (§3.6): the boards' services, their fees and deadlines per series.
    { labelKey: 'nav.boardServices', href: '/exams/services', icon: 'audit' },
  ],
};

/** F4: what a teacher does for exams — their candidates' forecasts, their invigilation. */
const TEACHER_EXAM_ITEMS: NavItem[] = [
  { labelKey: 'nav.forecasts', href: '/exams/forecasts', icon: 'approvals' },
  { labelKey: 'nav.invigilation', href: '/exams/invigilation', icon: 'rooms' },
];

/** F4: a family's statement of entry, exam timetable and results. */
const MY_EXAMS_ITEM: NavItem = { labelKey: 'nav.myExams', href: '/exams/my', icon: 'calendar' };

const ACCOUNT_SECTION: NavSection = {
  titleKey: 'nav.account',
  items: [
    { labelKey: 'nav.notifications', href: '/notifications', icon: 'notifications' },
    { labelKey: 'nav.profile', href: '/profile', icon: 'profile' },
  ],
};

/** Teaching is a capability (F0a): any staff account linked to a teacher record. */
const TEACHING_ITEM: NavItem = { labelKey: 'nav.myTeaching', href: '/teaching', icon: 'subjects' };

function getNavSections(role: string | null | undefined, teaches = false): NavSection[] {
  const teaching = teaches ? [TEACHING_ITEM, ...TEACHER_EXAM_ITEMS] : [];

  if (role === 'coordinator') {
    return [
      { items: [{ labelKey: 'nav.today', href: '/today', icon: 'today' }, ...teaching] },
      { titleKey: 'nav.academic', items: ACADEMIC_ITEMS },
      EXAMS_SECTION,
      // The reservations rework (§4.2): the coordinator keeps each session's subjects, teachers and items.
      // The reservations rework, step C (§3.7): the academic gates are the coordinator's to grant.
      { titleKey: 'nav.school', items: [{ labelKey: 'nav.sessions', href: '/admin/sessions', icon: 'sessions' }, { labelKey: 'nav.exceptions', href: '/admin/exceptions', icon: 'approvals' }, { labelKey: 'nav.settings', href: '/settings', icon: 'settings' }] },
      ACCOUNT_SECTION,
    ];
  }

  if (role === 'teacher') {
    return [
      { items: [{ labelKey: 'nav.today', href: '/today', icon: 'today' }, TEACHING_ITEM, ...TEACHER_EXAM_ITEMS] },
      ACCOUNT_SECTION,
    ];
  }

  if (role === 'gate') {
    return [
      { items: [{ labelKey: 'nav.today', href: '/today', icon: 'today' }, ...teaching] },
      ACCOUNT_SECTION,
    ];
  }

  if (role === 'admin') {
    return [
      {
        items: [
          { labelKey: 'nav.dashboard', href: '/admin/dashboard', icon: 'dashboard' },
          { labelKey: 'nav.today', href: '/today', icon: 'today' },
          ...teaching,
        ],
      },
      { titleKey: 'nav.academic', items: ACADEMIC_ITEMS },
      EXAMS_SECTION,
      {
        titleKey: 'nav.management',
        items: [
          { labelKey: 'nav.desk', href: '/desk', icon: 'home' },
          { labelKey: 'nav.team', href: '/admin/team', icon: 'profile' },
          { labelKey: 'nav.settings', href: '/settings', icon: 'settings' },
          { labelKey: 'nav.sessions', href: '/admin/sessions', icon: 'sessions' },
          { labelKey: 'nav.subjects', href: '/admin/subjects', icon: 'subjects' },
          { labelKey: 'nav.payments', href: '/admin/payments', icon: 'payments' },
          { labelKey: 'nav.escrow', href: '/admin/escrow', icon: 'adminEscrow' },
          { labelKey: 'nav.financeWorkbench', href: '/finance', icon: 'checkout' },
          { labelKey: 'nav.charges', href: '/charges', icon: 'payments' },
          { labelKey: 'nav.schoolFees', href: '/admin/school-fees', icon: 'escrow' },
          { labelKey: 'nav.exceptions', href: '/admin/exceptions', icon: 'approvals' },
          { labelKey: 'nav.remarksDesk', href: '/remarks-desk', icon: 'audit' },
          { labelKey: 'nav.resultsEntry', href: '/results-entry', icon: 'reports' },
          { labelKey: 'nav.dailyTakings', href: '/takings', icon: 'escrow' },
        ],
      },
      {
        titleKey: 'nav.oversight',
        items: [
          { labelKey: 'nav.reports', href: '/admin/reports', icon: 'reports' },
          { labelKey: 'nav.auditLog', href: '/admin/audit', icon: 'audit' },
          { labelKey: 'nav.announcements', href: '/admin/notifications', icon: 'notifications' },
        ],
      },
      {
        titleKey: 'nav.account',
        items: [
          { labelKey: 'nav.notifications', href: '/notifications', icon: 'notifications' },
          { labelKey: 'nav.profile', href: '/profile', icon: 'profile' },
        ],
      },
    ];
  }

  if (role === 'finance_officer' || role === 'finance_admin') {
    return [
      {
        items: [
          { labelKey: 'nav.desk', href: '/desk', icon: 'home' },
          { labelKey: 'nav.students', href: '/students', icon: 'students' },
          ...teaching,
          { labelKey: 'nav.financeWorkbench', href: '/finance', icon: 'payments' },
          // The reservations rework, step C (§3.6, §3.10): charges by family and status.
          { labelKey: 'nav.charges', href: '/charges', icon: 'checkout' },
          // The reservations rework (§4.2, §4.6): the sessions' fees and money.
          { labelKey: 'nav.sessions', href: '/admin/sessions', icon: 'sessions' },
          { labelKey: 'nav.dailyTakings', href: '/takings', icon: 'escrow' },
          { labelKey: 'nav.remarksDesk', href: '/remarks-desk', icon: 'audit' },
          { labelKey: 'nav.resultsEntry', href: '/results-entry', icon: 'reports' },
          // F4: certificates are handed over at the desk.
          { labelKey: 'nav.certificates', href: '/exams/certificates', icon: 'documents' },
        ],
      },
      ...(role === 'finance_admin'
        ? [
            {
              titleKey: 'nav.management' as const,
              items: [
                { labelKey: 'nav.schoolFees' as const, href: '/admin/school-fees', icon: 'escrow' as const },
                { labelKey: 'nav.boardServices' as const, href: '/exams/services', icon: 'audit' as const },
                { labelKey: 'nav.exceptions' as const, href: '/admin/exceptions', icon: 'approvals' as const },
                { labelKey: 'nav.settings' as const, href: '/settings', icon: 'settings' as const },
              ],
            },
          ]
        : []),
      {
        titleKey: 'nav.account',
        items: [
          { labelKey: 'nav.notifications', href: '/notifications', icon: 'notifications' },
          { labelKey: 'nav.profile', href: '/profile', icon: 'profile' },
        ],
      },
    ];
  }

  if (role === 'parent') {
    return [
      {
        items: [
          { labelKey: 'nav.home', href: '/', icon: 'home' },
        ],
      },
      {
        titleKey: 'nav.registration',
        items: [
          { labelKey: 'nav.registerSubjects', href: '/register', icon: 'register' },
          { labelKey: 'nav.myRegistrations', href: '/registrations', icon: 'registrations' },
          { labelKey: 'nav.history', href: '/registrations/history', icon: 'history' },
          { labelKey: 'nav.approvals', href: '/approvals', icon: 'approvals' },
          { labelKey: 'nav.remarks', href: '/remarks', icon: 'audit' },
          MY_EXAMS_ITEM,
        ],
      },
      {
        titleKey: 'nav.financial',
        items: [
          { labelKey: 'nav.statement', href: '/statement', icon: 'documents' },
          { labelKey: 'nav.schoolFee', href: '/school-fee', icon: 'payments' },
          // The reservations rework, step C (§3.6, §3.10): instalments and charges, paid here.
          { labelKey: 'nav.chargesDue', href: '/charges-due', icon: 'checkout' },
          { labelKey: 'nav.escrowBalance', href: '/escrow', icon: 'escrow' },
        ],
      },
      {
        titleKey: 'nav.account',
        items: [
          { labelKey: 'nav.linkedChildren', href: '/links', icon: 'links' },
          { labelKey: 'nav.notifications', href: '/notifications', icon: 'notifications' },
          { labelKey: 'nav.profile', href: '/profile', icon: 'profile' },
        ],
      },
    ];
  }

  // Student
  return [
    {
      items: [
        { labelKey: 'nav.home', href: '/', icon: 'home' },
      ],
    },
    {
      titleKey: 'nav.registration',
      items: [
        { labelKey: 'nav.registerSubjects', href: '/register', icon: 'register' },
        { labelKey: 'nav.myRegistrations', href: '/registrations', icon: 'registrations' },
        { labelKey: 'nav.statement', href: '/statement', icon: 'documents' },
        { labelKey: 'nav.history', href: '/registrations/history', icon: 'history' },
        { labelKey: 'nav.browseSubjects', href: '/subjects', icon: 'subjects' },
        { labelKey: 'nav.remarks', href: '/remarks', icon: 'audit' },
        MY_EXAMS_ITEM,
      ],
    },
    {
      titleKey: 'nav.requests',
      items: [
        { labelKey: 'nav.pendingRequests', href: '/pending-requests', icon: 'requests' },
      ],
    },
    {
      titleKey: 'nav.account',
      items: [
        { labelKey: 'nav.linkedParents', href: '/links', icon: 'links' },
        { labelKey: 'nav.notifications', href: '/notifications', icon: 'notifications' },
        { labelKey: 'nav.profile', href: '/profile', icon: 'profile' },
      ],
    },
  ];
}

/* ─── Nav Item Component ────────────────────────────────────────────────────── */

function NavLink({
  item,
  collapsed,
  badgeCount,
}: {
  item: NavItem;
  collapsed: boolean;
  badgeCount?: number;
}) {
  const pathname = usePathname();
  const { t } = useI18n();
  const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
  const showBadge = typeof badgeCount === 'number' && badgeCount > 0;
  const badgeLabel = showBadge ? (badgeCount > 99 ? '99+' : String(badgeCount)) : '';
  const label = t(item.labelKey);

  return (
    <Link
      href={item.href as never}
      className={cn(
        'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150',
        collapsed && 'justify-center px-2',
        isActive
          ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-sm'
          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
      )}
      title={collapsed ? label : undefined}
    >
      <span className="relative">
        <Icon d={icons[item.icon]} className={cn(isActive ? 'opacity-100' : 'opacity-60 group-hover:opacity-100')} />
        {/* Collapsed state: show a tiny dot over the icon because the
            count badge would be clipped by the narrower column. */}
        {collapsed && showBadge && (
          <span
            aria-label={`${badgeLabel} unread`}
            className="absolute -top-1 -right-1 size-2 rounded-full bg-primary ring-2 ring-sidebar"
          />
        )}
      </span>
      {!collapsed && (
        <>
          <span className="flex-1">{label}</span>
          {showBadge && (
            <span
              aria-label={`${badgeLabel} unread`}
              className={cn(
                'ml-auto inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums',
                isActive
                  ? 'bg-sidebar-primary-foreground text-sidebar-primary'
                  : 'bg-primary text-primary-foreground',
              )}
            >
              {badgeLabel}
            </span>
          )}
        </>
      )}
    </Link>
  );
}

/* ─── Main Shell ────────────────────────────────────────────────────────────── */

export default function NavShell({
  children,
  userName,
  userRole,
  userEmail,
  teaches = false,
}: {
  children: React.ReactNode;
  userName?: string | null;
  userRole?: string | null;
  userEmail?: string | null;
  /** The account is linked to a teacher record (F0a). */
  teaches?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { language, toggleLanguage, t } = useI18n();
  const sections = getNavSections(userRole, teaches);

  // L-5: Unread notification badge. Refetches every 30s so the number
  // reflects mark-as-read actions and new notifications without a
  // manual refresh. Failures are silent — a missing badge is much
  // better than a broken sidebar.
  const { data: unreadData } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => apiResponse(api.v1.notifications['unread-count'].$get()),
    refetchInterval: 30_000,
    // The (app) layout guard already ensures we only mount when
    // authenticated, so `enabled` can stay at its default (always).
    retry: false,
  });
  const unreadCount = (unreadData as { count?: number } | undefined)?.count ?? 0;

  const handleSignOut = async () => {
    await authClient.signOut();
    window.location.href = '/sign-in';
  };

  const languageLabel = language === 'en' ? t('language.arabic') : t('language.english');

  const sidebarContent = (
    <>
      {/* Brand */}
      <div className={cn('flex items-center gap-3 px-4 py-5', collapsed && 'justify-center px-2')}>
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground font-display text-sm font-bold">
          IG
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-sidebar-foreground font-display">IGCSE</p>
            <p className="truncate text-[11px] text-sidebar-foreground/50">{t('app.subjectReservation')}</p>
          </div>
        )}
      </div>

      {/* Nav Sections */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
        {sections.map((section, si) => (
          <div key={si} className={si > 0 ? 'mt-5' : ''}>
            {section.titleKey && !collapsed && (
              <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">
                {t(section.titleKey)}
              </p>
            )}
            {collapsed && si > 0 && (
              <div className="mx-auto mb-2 h-px w-6 bg-sidebar-border" />
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  collapsed={collapsed}
                  badgeCount={item.href === '/notifications' ? unreadCount : undefined}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* User footer */}
      <div className={cn('border-t border-sidebar-border p-3', collapsed && 'px-2')}>
        <button
          onClick={toggleLanguage}
          className={cn(
            'mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            collapsed && 'justify-center px-2',
          )}
          title={t('language.switchTo')}
          type="button"
          data-i18n-skip="true"
        >
          <Icon d={icons.language} className="opacity-60" />
          {!collapsed && <span>{languageLabel}</span>}
        </button>
        <div className={cn('flex items-center gap-3 rounded-lg px-3 py-2', collapsed && 'justify-center px-0')}>
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground uppercase">
            {(userName || userEmail || '?')[0]}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-sidebar-foreground">{userName || t('common.user')}</p>
              <p className="truncate text-[11px] text-sidebar-foreground/50">{userRole && isRole(userRole) ? ROLE_LABELS[userRole] : userRole || 'user'}</p>
            </div>
          )}
        </div>
        <button
          onClick={handleSignOut}
          className={cn(
            'mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            collapsed && 'justify-center px-2',
          )}
          title={t('common.signOut')}
          type="button"
        >
          <Icon d={icons.signOut} className="opacity-60" />
          {!collapsed && <span>{t('common.signOut')}</span>}
        </button>
      </div>
    </>
  );

  return (
    <div data-app-shell className="flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden lg:flex flex-col border-r border-sidebar-border bg-sidebar transition-all duration-200',
          collapsed ? 'w-[68px]' : 'w-64',
        )}
      >
        {sidebarContent}
        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute bottom-20 -right-3 z-10 hidden lg:flex size-6 items-center justify-center rounded-full border border-sidebar-border bg-sidebar text-sidebar-foreground/50 shadow-sm hover:text-sidebar-foreground transition-colors"
          style={{ insetInlineStart: collapsed ? '56px' : '248px' }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={cn('size-3 transition-transform', collapsed && 'rotate-180')}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <aside
            className="relative flex h-full w-64 flex-col bg-sidebar shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile top bar */}
        <header className="flex h-14 items-center gap-3 border-b border-border bg-card px-4 lg:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary transition-colors"
          >
            <Icon d={icons.menu} />
          </button>
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-bold font-display">
              IG
            </div>
            <span className="text-sm font-bold text-foreground font-display">IGCSE {t('app.subjectReservation')}</span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
