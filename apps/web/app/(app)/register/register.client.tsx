'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useSuspenseQuery, useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, gradeLabel, COUNCIL_LABELS, REGISTRATION_STATUS_LABELS } from '@repo/validations';
import { Notice } from '~/components/ui/tone';
import { formatPrice } from '~/lib/format';
import { Button } from '~/components/ui/button';
import { InstantText } from '../exams/exams-shared';

// ─── Types ────────────────────────────────────────────────────────────────────

type Session = {
  id: string;
  name: string;
  sessionType: string;
  qualificationLevel: string;
  startDate: string;
  endDate: string;
  status: string;
};

type SubjectPricing = {
  courseFee: number;
  registrationFee: number;
  total: number;
  isOutsideSchool: boolean;
};

type Subject = {
  id: string;
  name: string;
  code: string;
  council: string;
  qualificationLevel: string;
  courseFee: number;
  registrationFee: number;
  isOfferedAtSchool: boolean;
  isCore: boolean;
  isActive: boolean;
  teachers: { id: string; name: string }[];
  isRetake: boolean;
  pricing: SubjectPricing;
  outsidePricing: SubjectPricing | null;
  // F0b: the exam board series the subject is entered in (paid for per series).
  boardSeries: { id: string; name: string; entryDeadline: string | null } | null;
};

type SubjectChoice = {
  teacherId?: string;
  takeOutsideSchool?: boolean;
};

type SchoolFeeStatus = {
  academicYear: string;
  student: { id: string; name: string; grade: number | null };
  amount: number | null;
  dueAt: string | null;
  required: boolean;
  paid: boolean;
  pendingPayment: { id: string; externalReference: string | null } | null;
};

const fetchChildren = () => apiResponse(api.v1.links.children.$get());
type Child = Awaited<ReturnType<typeof fetchChildren>>[number];
const fetchEligibility = (studentId: string, sessionId: string) =>
  apiResponse(api.v1.registrations.eligibility.$get({ query: { studentId, sessionId } }));

const COUNCIL_COLORS: Record<string, string> = {
  pearson_edexcel: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-700',
  cambridge: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-900/20 dark:text-violet-300 dark:border-violet-700',
  oxford: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-700',
};

const LEVEL_LABELS: Record<string, string> = {
  igcse: 'IGCSE',
  as_level: 'AS Level',
  a_level: 'A Level',
};

/** Effective pricing given the student's outside-school choice */
function getEffectivePricing(subject: Subject, choice: SubjectChoice | undefined): SubjectPricing {
  if (choice?.takeOutsideSchool && subject.outsidePricing) return subject.outsidePricing;
  return subject.pricing;
}

// ─── Countdown Hook ──────────────────────────────────────────────────────────

function useCountdown(endDate: string) {
  const calcRemaining = useCallback(() => {
    const end = new Date(endDate).getTime();
    const now = Date.now();
    const diff = Math.max(0, end - now);
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return { days, hours, minutes, total: diff };
  }, [endDate]);

  const [remaining, setRemaining] = useState(calcRemaining);

  useEffect(() => {
    setRemaining(calcRemaining());
    const interval = setInterval(() => {
      setRemaining(calcRemaining());
    }, 60_000); // Update every minute
    return () => clearInterval(interval);
  }, [calcRemaining]);

  return remaining;
}

function CountdownDisplay({ endDate }: { endDate: string }) {
  const { days, hours, minutes, total } = useCountdown(endDate);

  if (total === 0) {
    return (
      <div className="text-xs text-destructive font-medium mt-1">
        Registration closed
      </div>
    );
  }

  if (days > 7) return null; // Only show countdown in the last 7 days

  return (
    <div className="text-xs text-amber-600 dark:text-amber-400 font-medium mt-1">
      {days > 0 && `${days}d `}{hours}h {minutes}m remaining
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  userId: string;
  userRole: string | null;
}

export default function RegisterClient({ userId, userRole }: Props): React.JSX.Element {
  const isParent = userRole === 'parent';
  const queryClient = useQueryClient();

  // ─── State ─────────────────────────────────────────────────────────────────

  const [selectedChild, setSelectedChild] = useState<Child | null>(null);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<Set<string>>(new Set());
  const [subjectChoices, setSubjectChoices] = useState<Record<string, SubjectChoice>>({});
  const [successMessage, setSuccessMessage] = useState('');
  const [payNowIds, setPayNowIds] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState('');
  const [councilFilter, setCouncilFilter] = useState('all');

  // Effective student ID: the student being registered for
  const effectiveStudentId = isParent ? (selectedChild?.student.id ?? null) : userId;

  // F0a: may this student register for the chosen window's series, and in
  // which grade? The grade is the one in the series' academic year (a June
  // 2027 window is grade 10 for a student who is in grade 9 today), so the
  // page asks the API rather than reading today's grade.
  const { data: eligibility } = useQuery({
    queryKey: ['registrations', 'eligibility', effectiveStudentId, selectedSession?.id],
    queryFn: () => fetchEligibility(effectiveStudentId!, selectedSession!.id),
    enabled: !!selectedSession && !!effectiveStudentId,
    retry: false,
  });
  const refusedReason = eligibility && !eligibility.allowed ? eligibility.reason : null;

  // Core subject enforcement only applies to Grade 10 June sessions — grade
  // 10 in the series' academic year.
  const isCoreEnforced = eligibility?.grade === 10 && selectedSession?.sessionType === 'june';

  // ─── Queries ───────────────────────────────────────────────────────────────

  const { data: activeSessions = [] } = useSuspenseQuery<Session[]>({
    queryKey: ['sessions', 'active'],
    queryFn: () => apiResponse(api.v1.sessions.active.$get()),
  });

  // V3 §6.8: parents can preregister for upcoming (draft) sessions
  const { data: upcomingSessions = [] } = useQuery<Session[]>({
    queryKey: ['sessions', 'upcoming'],
    queryFn: async () => (await apiResponse(api.v1.sessions.upcoming.$get())) as Session[],
    enabled: isParent,
  });

  const allSelectableSessions = useMemo(
    () => [...activeSessions, ...(isParent ? upcomingSessions : [])],
    [activeSessions, upcomingSessions, isParent]
  );
  const isPreregSession = selectedSession?.status === 'draft';

  const { data: children = [] } = useQuery({
    queryKey: ['links', 'children'],
    queryFn: fetchChildren,
    enabled: isParent,
  });

  // School-fee gate status (D-H): banner + block when the annual fee is unpaid
  const { data: feeStatus } = useQuery<SchoolFeeStatus>({
    queryKey: ['school-fees', 'status', effectiveStudentId],
    queryFn: async () =>
      (await apiResponse(
        api.v1['school-fees'].status.$get({
          query: { studentId: isParent ? effectiveStudentId! : undefined },
        })
      )) as SchoolFeeStatus,
    enabled: !!effectiveStudentId,
    retry: false,
  });
  const schoolFeeBlocked = !!feeStatus && feeStatus.required && !feeStatus.paid;

  // Load available subjects when both session and student are selected
  const { data: availableSubjects = [], isFetching: loadingSubjects, error: subjectsError } = useQuery<Subject[]>({
    queryKey: ['registrations', 'available', selectedSession?.id, effectiveStudentId],
    queryFn: () =>
      apiResponse(
        api.v1.registrations.available.$get({
          query: {
            sessionId: selectedSession!.id,
            studentId: isParent ? effectiveStudentId! : undefined,
          },
        })
      ),
    enabled: !!selectedSession && !!effectiveStudentId,
    retry: false,
  });

  // ─── Derived Data ──────────────────────────────────────────────────────────

  const filteredSubjects = useMemo(() => {
    if (councilFilter === 'all') return availableSubjects;
    return availableSubjects.filter((s) => s.council === councilFilter);
  }, [availableSubjects, councilFilter]);

  // F0b: subjects grouped by the exam board series they are entered in; each
  // series is paid for on its own when their entry deadlines differ.
  const seriesSorted = useMemo(() => {
    return [...filteredSubjects].sort((a, b) => (a.boardSeries?.name ?? '~').localeCompare(b.boardSeries?.name ?? '~'));
  }, [filteredSubjects]);
  const multipleSeries = new Set(filteredSubjects.map((x) => x.boardSeries?.id ?? 'none')).size > 1;


  const selectedSubjects = useMemo(
    () => availableSubjects.filter((s) => selectedSubjectIds.has(s.id)),
    [availableSubjects, selectedSubjectIds]
  );

  const totalCost = useMemo(
    () => selectedSubjects.reduce((sum, s) => sum + getEffectivePricing(s, subjectChoices[s.id]).total, 0),
    [selectedSubjects, subjectChoices]
  );

  const coreSubjects = useMemo(
    () => availableSubjects.filter((s) => s.isCore),
    [availableSubjects]
  );

  // Auto-select core subjects only for Grade 10 June sessions
  useEffect(() => {
    if (!isCoreEnforced) return;
    if (coreSubjects.length === 0) return;
    setSelectedSubjectIds((prev) => {
      const next = new Set(prev);
      for (const core of coreSubjects) next.add(core.id);
      return next;
    });
  }, [coreSubjects, isCoreEnforced]);

  // ─── Mutations ─────────────────────────────────────────────────────────────

  // Only include options for selected subjects, and only meaningful keys
  const buildSubjectOptions = () => {
    const options: Record<string, SubjectChoice> = {};
    for (const id of selectedSubjectIds) {
      const choice = subjectChoices[id];
      if (choice && (choice.teacherId || choice.takeOutsideSchool)) {
        options[id] = choice;
      }
    }
    return Object.keys(options).length > 0 ? options : undefined;
  };

  const requestMutation = useMutation({
    mutationFn: () =>
      apiResponse(
        api.v1.registrations.request.$post({
          json: {
            sessionId: selectedSession!.id,
            subjectIds: Array.from(selectedSubjectIds),
            subjectOptions: buildSubjectOptions(),
          },
        })
      ),
    onSuccess: () => {
      setSuccessMessage(
        'Registration request submitted! Awaiting parent approval.'
      );
      setSelectedSubjectIds(new Set());
      setSubjectChoices({});
      queryClient.invalidateQueries({ queryKey: ['registrations'] });
    },
    onError: (err: Error) => setSubmitError(err.message),
  });

  const directMutation = useMutation({
    mutationFn: () =>
      apiResponse(
        isPreregSession
          ? api.v1.registrations.preregister.$post({
              json: {
                sessionId: selectedSession!.id,
                subjectIds: Array.from(selectedSubjectIds),
                studentId: selectedChild!.student.id,
                subjectOptions: buildSubjectOptions(),
              },
            })
          : api.v1.registrations.direct.$post({
              json: {
                sessionId: selectedSession!.id,
                subjectIds: Array.from(selectedSubjectIds),
                studentId: selectedChild!.student.id,
                subjectOptions: buildSubjectOptions(),
              },
            })
      ),
    onSuccess: (created) => {
      setSuccessMessage(
        isPreregSession
          ? 'Preregistered! Pay now to lock the funds in the held wallet — they auto-apply when the session opens.'
          : 'Subjects registered! Pay now to confirm them.'
      );
      // G12: hand the parent straight to checkout with these registrations
      const rows = created as unknown as { id: string }[];
      setPayNowIds(Array.isArray(rows) ? rows.map((r) => r.id) : []);
      setSelectedSubjectIds(new Set());
      setSubjectChoices({});
      queryClient.invalidateQueries({ queryKey: ['registrations'] });
    },
    onError: (err: Error) => setSubmitError(err.message),
  });

  const isMutating = requestMutation.isPending || directMutation.isPending;

  // ─── Handlers ──────────────────────────────────────────────────────────────

  function toggleSubject(subjectId: string, isCore: boolean) {
    // Core subjects cannot be deselected only for Grade 10 June sessions
    if (isCore && isCoreEnforced) return;
    setSelectedSubjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(subjectId)) {
        next.delete(subjectId);
      } else {
        next.add(subjectId);
      }
      return next;
    });
  }

  function handleSessionSelect(session: Session) {
    setSelectedSession(session);
    setSelectedSubjectIds(new Set());
    setSubmitError('');
    setSuccessMessage('');
  }

  function handleSubmit() {
    setSubmitError('');
    if (isParent) {
      directMutation.mutate();
    } else {
      requestMutation.mutate();
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  if (activeSessions.length === 0 && (!isParent || upcomingSessions.length === 0)) {
    return (
      <div className="px-6 py-8 max-w-5xl mx-auto animate-fade-up">
        <div className="bg-card rounded-xl border border-border shadow-sm p-12 text-center">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-foreground font-display mb-2">
            No Open Registration Windows
          </h2>
          <p className="text-muted-foreground text-sm">
            There are no active registration windows at this time. Check back later or contact the school for more information.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto space-y-6 animate-fade-up">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground font-display tracking-tight">Register Subjects</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isParent
            ? 'Select a child, then choose a session and subjects to register directly.'
            : 'Select subjects to register. Your request will be sent to your parent for approval.'}
        </p>
      </div>

      {/* Success Banner */}
      {successMessage && (
        <div className="rounded-xl bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-700 p-4 flex items-start gap-3">
          <div className="w-5 h-5 rounded-full bg-brand-600 flex items-center justify-center shrink-0 mt-0.5">
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <p className="font-medium text-brand-800 dark:text-brand-300 text-sm">{successMessage}</p>
            <div className="flex gap-3 mt-2">
              {payNowIds.length > 0 && (
                <a
                  href={`/checkout?ids=${payNowIds.join(',')}`}
                  className="inline-flex items-center px-3 py-1.5 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700"
                >
                  Pay now →
                </a>
              )}
              <button
                onClick={() => { setSuccessMessage(''); setPayNowIds([]); }}
                className="text-sm text-brand-600 dark:text-brand-400 underline"
              >
                Register more subjects
              </button>
            </div>
          </div>
        </div>
      )}

      {/* School-fee gate banner (D-H) */}
      {schoolFeeBlocked && (
        <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 p-4">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
            The {feeStatus?.academicYear} school fee
            {feeStatus?.amount != null && <> ({formatPrice(feeStatus.amount)})</>} must be paid before
            registering subjects{isParent && selectedChild ? ` for ${selectedChild.student.name}` : ''}.
          </p>
          {isParent ? (
            <a
              href={`/school-fee${effectiveStudentId ? `?studentId=${effectiveStudentId}` : ''}`}
              className="inline-block mt-2 text-sm font-semibold text-amber-800 dark:text-amber-300 underline"
            >
              Pay the school fee now →
            </a>
          ) : (
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
              Ask your parent to pay it from their account.
            </p>
          )}
        </div>
      )}

      {/* Step 1: Select Child (Parent only) */}
      {isParent && (
        <div className="bg-card rounded-xl border border-border shadow-sm p-5">
          <h2 className="font-semibold text-foreground font-display mb-3">
            Step 1 — Select Child
          </h2>
          {children.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No linked children. Go to{' '}
              <a href="/links" className="text-primary underline">
                Manage Links
              </a>{' '}
              to connect with a student.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {children.map((child) => (
                <button
                  key={child.id}
                  onClick={() => {
                    setSelectedChild(child);
                    setSelectedSession(null);
                    setSelectedSubjectIds(new Set());
                  }}
                  className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    selectedChild?.id === child.id
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border hover:border-primary/40 text-foreground'
                  }`}
                >
                  {child.student.name}
                  {child.student.grade != null && (
                    <span className="ms-1 text-muted-foreground">
                      · {gradeLabel(child.student.grade)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Step 2: Select Session */}
      {(!isParent || selectedChild) && (
        <div className="bg-card rounded-xl border border-border shadow-sm p-5">
          <h2 className="font-semibold text-foreground font-display mb-3">
            {isParent ? 'Step 2' : 'Step 1'} — Select Registration Window
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {allSelectableSessions.map((sess) => {
              const end = new Date(sess.endDate);
              return (
                <button
                  key={sess.id}
                  onClick={() => handleSessionSelect(sess)}
                  className={`text-left rounded-lg border p-4 transition-colors ${
                    selectedSession?.id === sess.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/40'
                  }`}
                >
                  <div className="font-medium text-foreground text-sm flex items-center gap-2">
                    {sess.name}
                    <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {LEVEL_LABELS[sess.qualificationLevel] ?? sess.qualificationLevel}
                    </span>
                    {sess.status === 'draft' && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                        Preregistration
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Closes {end.toLocaleDateString()}
                  </div>
                  <CountdownDisplay endDate={sess.endDate} />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Step 3: Select Subjects */}
      {selectedSession && effectiveStudentId && (
        <div className="bg-card rounded-xl border border-border shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-foreground font-display">
              {isParent ? 'Step 3' : 'Step 2'} — Select Subjects
            </h2>
            {/* Council filter */}
            <select
              value={councilFilter}
              onChange={(e) => setCouncilFilter(e.target.value)}
              className="text-sm rounded-lg border border-border bg-card text-foreground px-2 py-1"
            >
              <option value="all">All Councils</option>
              <option value="pearson_edexcel">Pearson Edexcel</option>
              <option value="cambridge">Cambridge</option>
              <option value="oxford">Oxford</option>
            </select>
          </div>

          {eligibility?.graduateRetake && (
            <Notice tone="info" className="mb-3">
              <span>A graduate retake: the school registers graduates for the</span> <span>{eligibility.series.label}</span> <span>series.</span>
            </Notice>
          )}
          {refusedReason ? (
            <Notice tone="warning" title="This series is not open to this student">
              {refusedReason}
            </Notice>
          ) : loadingSubjects ? (
            <div className="text-center py-8 text-muted-foreground">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent mx-auto mb-2" />
              Loading subjects...
            </div>
          ) : subjectsError ? (
            <div className="text-center py-8">
              <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive">
                {subjectsError instanceof Error ? subjectsError.message : 'Failed to load subjects. Please try again.'}
              </div>
            </div>
          ) : filteredSubjects.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              {availableSubjects.length === 0
                ? 'No subjects are available for registration in this session. This may be because all subjects have already been registered, or no subjects are currently active.'
                : 'No subjects match the selected filter.'}
            </div>
          ) : (
            <>
              {isCoreEnforced && coreSubjects.length > 0 && (
                <div className="mb-3 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-2">
                  Core subjects (Grade 10 June) are pre-selected and mandatory.
                </div>
              )}
              <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                {seriesSorted.map((subject, index) => {
                  const seriesKey = subject.boardSeries?.id ?? 'none';
                  const newSeries = multipleSeries && (index === 0 || (seriesSorted[index - 1]!.boardSeries?.id ?? 'none') !== seriesKey);
                  const choice = subjectChoices[subject.id];
                  const pricing = getEffectivePricing(subject, choice);
                  const isSelected = selectedSubjectIds.has(subject.id);
                  const isCore = subject.isCore;
                  const isCoreLocked = isCore && isCoreEnforced;
                  const canChooseOutside = subject.isRetake && subject.isOfferedAtSchool;
                  const showTeacherPicker =
                    isSelected && !pricing.isOutsideSchool && subject.teachers.length > 0;

                  return (
                    <div key={subject.id}>
                    {newSeries && (
                      <div className="mb-2 mt-3 first:mt-0 border-b border-border pb-1">
                        <p className="text-sm font-semibold text-foreground">
                          {subject.boardSeries ? <bdi>{subject.boardSeries.name}</bdi> : <span>No board series</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {subject.boardSeries?.entryDeadline
                            ? <><span>Entry deadline</span> <InstantText iso={subject.boardSeries.entryDeadline} /> · <span>paid for on its own</span></>
                            : <span>No entry deadline yet · paid for on its own</span>}
                        </p>
                      </div>
                    )}
                    <div
                      className={`rounded-lg border transition-colors ${
                        isSelected || isCoreLocked
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/40'
                      }`}
                    >
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleSubject(subject.id, isCore)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleSubject(subject.id, isCore); }}
                        className={`w-full text-left px-4 py-3 flex items-center gap-3 ${
                          isCoreLocked ? 'cursor-not-allowed' : 'cursor-pointer'
                        }`}
                      >
                        {/* Checkbox */}
                        <div
                          className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${
                            isSelected || isCoreLocked
                              ? 'border-primary bg-primary'
                              : 'border-muted-foreground/30'
                          }`}
                        >
                          {(isSelected || isCoreLocked) && (
                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>

                        {/* Subject info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-foreground text-sm">
                              {subject.name}
                            </span>
                            <span className={`text-xs px-2 py-0.5 rounded border ${COUNCIL_COLORS[subject.council] ?? ''}`}>
                              {COUNCIL_LABELS[subject.council as keyof typeof COUNCIL_LABELS] ?? subject.council}
                            </span>
                            {isCore && (
                              <span className="text-xs px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-700">
                                Core
                              </span>
                            )}
                            {subject.isRetake && (
                              <span className="text-xs px-2 py-0.5 rounded bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-400 border border-violet-200 dark:border-violet-700">
                                Retake
                              </span>
                            )}
                            {!subject.isOfferedAtSchool && (
                              <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                                Outside school · 50%
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {subject.code} · Course {formatPrice(pricing.courseFee)} + Registration {formatPrice(pricing.registrationFee)}
                          </div>
                        </div>

                        {/* Price */}
                        <div className="text-sm font-semibold text-foreground shrink-0">
                          {formatPrice(pricing.total)}
                        </div>
                      </div>

                      {/* Per-subject choices — teacher + outside-school (V3) */}
                      {isSelected && (canChooseOutside || showTeacherPicker) && (
                        <div className="px-4 pb-3 pt-0 ml-8 space-y-2">
                          {canChooseOutside && (
                            <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                              <input
                                type="checkbox"
                                checked={choice?.takeOutsideSchool ?? false}
                                onChange={(e) =>
                                  setSubjectChoices((prev) => ({
                                    ...prev,
                                    [subject.id]: {
                                      ...prev[subject.id],
                                      takeOutsideSchool: e.target.checked,
                                      // teacher is irrelevant outside school
                                      teacherId: e.target.checked ? undefined : prev[subject.id]?.teacherId,
                                    },
                                  }))
                                }
                                className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                              />
                              Take outside school (retake) — 50% fee
                              {subject.outsidePricing && (
                                <span className="text-muted-foreground">
                                  ({formatPrice(subject.outsidePricing.total)})
                                </span>
                              )}
                            </label>
                          )}
                          {showTeacherPicker && (
                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-muted-foreground">Preferred teacher (optional):</span>
                              <select
                                value={choice?.teacherId ?? ''}
                                onChange={(e) =>
                                  setSubjectChoices((prev) => ({
                                    ...prev,
                                    [subject.id]: {
                                      ...prev[subject.id],
                                      teacherId: e.target.value || undefined,
                                    },
                                  }))
                                }
                                className="rounded-lg border border-border bg-card text-foreground px-2 py-1 text-xs"
                              >
                                <option value="">No preference</option>
                                {subject.teachers.map((t) => (
                                  <option key={t.id} value={t.id}>{t.name}</option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Step 4: Summary & Submit */}
      {selectedSubjectIds.size > 0 && (
        <div className="bg-card rounded-xl border border-border shadow-sm p-5">
          <h2 className="font-semibold text-foreground font-display mb-4">
            {isParent ? 'Step 4' : 'Step 3'} — Summary
          </h2>

          <div className="space-y-2 mb-4">
            {selectedSubjects.map((s) => {
              const pricing = getEffectivePricing(s, subjectChoices[s.id]);
              const teacherName = s.teachers.find((t) => t.id === subjectChoices[s.id]?.teacherId)?.name;
              return (
                <div key={s.id} className="flex justify-between text-sm gap-3">
                  <span className="text-foreground min-w-0">
                    {s.name}
                    {pricing.isOutsideSchool && (
                      <span className="text-xs text-muted-foreground ml-1">(outside school, 50%)</span>
                    )}
                    {teacherName && (
                      <span className="text-xs text-muted-foreground ml-1">· {teacherName}</span>
                    )}
                  </span>
                  <span className="text-foreground font-medium shrink-0">
                    {formatPrice(pricing.total)}
                  </span>
                </div>
              );
            })}
            <div className="border-t border-border pt-2 flex justify-between font-semibold">
              <span className="text-foreground">Total</span>
              <span className="text-foreground">{formatPrice(totalCost)}</span>
            </div>
          </div>

          {!isParent && (
            <div className="text-xs text-muted-foreground mb-4 bg-muted rounded-lg p-3">
              Your request will be sent to your linked parent for approval. Payment is required after approval.
            </div>
          )}

          {isPreregSession && (
            <div className="text-xs text-violet-700 dark:text-violet-400 mb-4 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-700 rounded-lg p-3">
              This session hasn&apos;t opened yet. Prices lock now; your payment is held in the
              wallet and applied automatically when the session opens. You can cancel before then
              (refund windows apply).
            </div>
          )}

          {submitError && (
            <div className="mb-4 rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
              {submitError}
            </div>
          )}

          <Button
            onClick={handleSubmit}
            disabled={isMutating || schoolFeeBlocked}
            className="w-full"
            size="lg"
            title={schoolFeeBlocked ? 'Pay the school fee first' : undefined}
          >
            {isMutating
              ? 'Submitting...'
              : isParent
              ? `${isPreregSession ? 'Preregister' : 'Register'} ${selectedSubjectIds.size} Subject${selectedSubjectIds.size !== 1 ? 's' : ''} — ${formatPrice(totalCost)}`
              : `Submit Request for ${selectedSubjectIds.size} Subject${selectedSubjectIds.size !== 1 ? 's' : ''}`}
          </Button>
        </div>
      )}
    </div>
  );
}
