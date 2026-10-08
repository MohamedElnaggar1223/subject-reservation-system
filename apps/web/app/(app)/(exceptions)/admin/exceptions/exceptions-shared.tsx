'use client';

/**
 * The Exceptions screen's fetchers and words (RESERVATIONS_REWORK.md §3.7, §4.7). Every row type
 * comes from the API through its fetcher, never by hand (PATTERNS.md). Text carrying a name, a
 * number or a date is split into its own nodes so the page translator (lib/i18n.tsx,
 * lib/i18n-money.ts) finds the words.
 */

import { api } from '~/lib/hono';
import { apiResponse, type ExceptionStatus } from '@repo/validations';
import { Badge, type Tone } from '~/components/ui/tone';
import { Money, Day } from '~/app/(app)/(sessions)/admin/sessions/sessions-shared';

// ─── Fetchers ────────────────────────────────────────────────────────────────

export const fetchPolicies = () => apiResponse(api.v1.policies.$get());
export type PoliciesData = Awaited<ReturnType<typeof fetchPolicies>>;
export type PolicyRow = PoliciesData['policies'][number];

export type StatusFilter = ExceptionStatus | 'all';
export const fetchExceptions = (status: StatusFilter) =>
  apiResponse(api.v1.exceptions.$get({ query: status === 'all' ? {} : { status } }));
export type ExceptionRow = Awaited<ReturnType<typeof fetchExceptions>>[number];

export const fetchCheckThese = () => apiResponse(api.v1.exceptions['check-these'].$get());
export type CheckRow = Awaited<ReturnType<typeof fetchCheckThese>>[number];

export const fetchStudents = (search: string) => apiResponse(api.v1.students.$get({ query: search ? { search } : {} }));
export const fetchSummary = (id: string) => apiResponse(api.v1.users[':id'].summary.$get({ param: { id } }));
export const fetchStudent = (id: string) => apiResponse(api.v1.students[':id'].$get({ param: { id } }));
export const fetchCharges = (studentId: string) => apiResponse(api.v1.charges.$get({ query: { studentId } }));
export const fetchOffersFor = (studentId: string, sessionId: string) =>
  apiResponse(api.v1.registrations.offers.$get({ query: { studentId, sessionId } }));
export const fetchSubjects = () => apiResponse(api.v1.subjects.$get({ query: {} }));
export const fetchSeries = () => apiResponse(api.v1['board-series'].$get({ query: {} }));

export const POLICIES_KEY = ['policies'] as const;
export const EXCEPTIONS_KEY = ['exceptions'] as const;

// ─── Words ───────────────────────────────────────────────────────────────────

export const STATUS_FILTERS: StatusFilter[] = ['active', 'used', 'lapsed', 'revoked', 'all'];
export const STATUS_LABEL: Record<StatusFilter, string> = { active: 'Active', used: 'Used', lapsed: 'Lapsed', revoked: 'Revoked', all: 'All' };
const STATUS_TONE: Record<string, Tone> = { active: 'success', used: 'info', lapsed: 'neutral', revoked: 'neutral' };

export function ExceptionStatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{STATUS_LABEL[status as StatusFilter] ?? status}</Badge>;
}

/** Why a policy cannot be granted by this caller now. */
export const WHY_NOT: Record<string, string> = {
  not_your_role: 'not yours to grant',
  not_applied_yet: 'not applied yet',
  off_by_setting: 'off (setting)',
};

/** Who an exception is for: the student, or the family (every linked child). */
export function Holder({ student, family }: { student: { name: string } | null; family: { name: string } | null }) {
  if (family) {
    return (
      <span>
        <span>Family of</span> <bdi className="font-medium text-foreground">{family.name}</bdi>
      </span>
    );
  }
  return <bdi className="font-medium text-foreground">{student?.name ?? '—'}</bdi>;
}

type ScopeParts = {
  session?: { name: string } | null;
  subject?: { name: string } | null;
  offer?: { subject: { name: string } | null } | null;
  offerItem?: { label: string } | null;
  registration?: { subject: { name: string } | null; session: { name: string } | null } | null;
  charge?: { description: string } | null;
  boardSeries?: { boardCode: string; month: string; year: number; label: string } | null;
  academicYear?: string | null;
};

/** The scope an exception is narrowed to, in words (or what no scope means for its policy). */
export function ScopeText({ row, nullScope }: { row: ScopeParts; nullScope: string | null | undefined }) {
  const parts: React.ReactNode[] = [];
  if (row.session) parts.push(<bdi key="s">{row.session.name}</bdi>);
  if (row.subject) parts.push(<bdi key="j">{row.subject.name}</bdi>);
  if (row.offer?.subject) parts.push(<bdi key="o">{row.offer.subject.name}</bdi>);
  if (row.offerItem) parts.push(<bdi key="i">{row.offerItem.label}</bdi>);
  if (row.registration) {
    parts.push(
      <span key="r"><bdi>{row.registration.subject?.name ?? '—'}</bdi>{row.registration.session && <> · <bdi>{row.registration.session.name}</bdi></>}</span>,
    );
  }
  if (row.charge) parts.push(<bdi key="c">{row.charge.description}</bdi>);
  if (row.boardSeries) parts.push(<bdi key="b" dir="ltr">{`${row.boardSeries.boardCode} ${row.boardSeries.month} ${row.boardSeries.year}${row.boardSeries.label ? ` (${row.boardSeries.label})` : ''}`}</bdi>);
  if (row.academicYear) parts.push(<bdi key="y" dir="ltr">{row.academicYear}</bdi>);
  if (!parts.length) return <span className="text-muted-foreground">{nullScope ?? '—'}</span>;
  return <span className="text-card-foreground">{parts.flatMap((p, i) => (i ? [<span key={`sep${i}`}> · </span>, p] : [p]))}</span>;
}

/** An exception's value, by its policy's value type. */
export function ValueText({ valueType, n, date, schedule }: {
  valueType: string | undefined; n: number | null; date: string | null; schedule: unknown;
}) {
  if (valueType === 'percent') return n === null ? <span>—</span> : <span dir="ltr" className="tabular-nums">{`${n}%`}</span>;
  if (valueType === 'amount') return <Money amount={n} />;
  if (valueType === 'date') return <Day iso={date} />;
  if (valueType === 'schedule' && Array.isArray(schedule)) {
    const total = (schedule as { amount: number }[]).reduce((s, r) => s + Number(r.amount), 0);
    return <span><span>{schedule.length}</span> <span>{schedule.length === 1 ? 'instalment' : 'instalments'}</span> · <Money amount={total} /></span>;
  }
  return <span className="text-muted-foreground">—</span>;
}
