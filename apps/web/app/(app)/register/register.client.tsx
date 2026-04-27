'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useSuspenseQuery, useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, COUNCIL_LABELS, REGISTRATION_STATUS_LABELS } from '@repo/validations';
import { formatPrice } from '~/lib/format';
import { Button } from '~/components/ui/button';

// ─── Types ────────────────────────────────────────────────────────────────────

type Session = {
  id: string;
  name: string;
  sessionType: string;
  startDate: string;
  endDate: string;
  status: string;
};

type Subject = {
  id: string;
  name: string;
  code: string;
  council: string;
  priceInSchool: number;
  isOfferedAtSchool: boolean;
  customPrice: number | null;
  isCore: boolean;
  isActive: boolean;
};

const fetchChildren = () => apiResponse(api.v1.links.children.$get());
type Child = Awaited<ReturnType<typeof fetchChildren>>[number];

const COUNCIL_COLORS: Record<string, string> = {
  pearson_edexcel: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-700',
  cambridge: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-900/20 dark:text-violet-300 dark:border-violet-700',
  oxford: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-700',
};

function getSubjectPrice(subject: Subject): number {
  return subject.isOfferedAtSchool ? subject.priceInSchool : (subject.customPrice ?? subject.priceInSchool);
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
  studentGrade?: number | null;
}

export default function RegisterClient({ userId, userRole, studentGrade: propStudentGrade }: Props): React.JSX.Element {
  const isParent = userRole === 'parent';
  const queryClient = useQueryClient();

  // ─── State ─────────────────────────────────────────────────────────────────

  const [selectedChild, setSelectedChild] = useState<Child | null>(null);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<Set<string>>(new Set());
  const [successMessage, setSuccessMessage] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [councilFilter, setCouncilFilter] = useState('all');

  // Effective student ID: the student being registered for
  const effectiveStudentId = isParent ? (selectedChild?.student.id ?? null) : userId;

  // Determine the effective grade: parent uses child's grade, student uses prop
  const effectiveGrade = isParent ? (selectedChild?.student.grade ?? null) : (propStudentGrade ?? null);

  // Core subject enforcement only applies to Grade 10 June sessions
  const isCoreEnforced = effectiveGrade === 10 && selectedSession?.sessionType === 'june';

  // ─── Queries ───────────────────────────────────────────────────────────────

  const { data: activeSessions = [] } = useSuspenseQuery<Session[]>({
    queryKey: ['sessions', 'active'],
    queryFn: () => apiResponse(api.v1.sessions.active.$get()),
  });

  const { data: children = [] } = useQuery({
    queryKey: ['links', 'children'],
    queryFn: fetchChildren,
    enabled: isParent,
  });

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

  const selectedSubjects = useMemo(
    () => availableSubjects.filter((s) => selectedSubjectIds.has(s.id)),
    [availableSubjects, selectedSubjectIds]
  );

  const totalCost = useMemo(
    () => selectedSubjects.reduce((sum, s) => sum + getSubjectPrice(s), 0),
    [selectedSubjects]
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

  const requestMutation = useMutation({
    mutationFn: () =>
      apiResponse(
        api.v1.registrations.request.$post({
          json: {
            sessionId: selectedSession!.id,
            subjectIds: Array.from(selectedSubjectIds),
          },
        })
      ),
    onSuccess: () => {
      setSuccessMessage(
        'Registration request submitted! Awaiting parent approval.'
      );
      setSelectedSubjectIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['registrations'] });
    },
    onError: (err: Error) => setSubmitError(err.message),
  });

  const directMutation = useMutation({
    mutationFn: () =>
      apiResponse(
        api.v1.registrations.direct.$post({
          json: {
            sessionId: selectedSession!.id,
            subjectIds: Array.from(selectedSubjectIds),
            studentId: selectedChild!.student.id,
          },
        })
      ),
    onSuccess: () => {
      setSuccessMessage(
        'Subjects registered successfully! Proceed to payment to confirm.'
      );
      setSelectedSubjectIds(new Set());
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

  if (activeSessions.length === 0) {
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
            <button
              onClick={() => setSuccessMessage('')}
              className="text-sm text-brand-600 dark:text-brand-400 underline mt-1"
            >
              Register more subjects
            </button>
          </div>
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
                  {child.student.grade && (
                    <span className="ml-1 text-muted-foreground">
                      · Grade {child.student.grade}
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
            {activeSessions.map((sess) => {
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
                  <div className="font-medium text-foreground text-sm">{sess.name}</div>
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

          {loadingSubjects ? (
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
              <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                {filteredSubjects.map((subject) => {
                  const price = getSubjectPrice(subject);
                  const isSelected = selectedSubjectIds.has(subject.id);
                  const isCore = subject.isCore;
                  const isCoreLocked = isCore && isCoreEnforced;

                  return (
                    <button
                      key={subject.id}
                      onClick={() => toggleSubject(subject.id, isCore)}
                      disabled={isCoreLocked}
                      className={`w-full text-left rounded-lg border px-4 py-3 transition-colors flex items-center gap-3 ${
                        isSelected || isCoreLocked
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/40'
                      } ${isCoreLocked ? 'cursor-not-allowed' : 'cursor-pointer'}`}
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
                          {!subject.isOfferedAtSchool && (
                            <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                              External
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">{subject.code}</div>
                      </div>

                      {/* Price */}
                      <div className="text-sm font-semibold text-foreground shrink-0">
                        {formatPrice(price)}
                      </div>
                    </button>
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
            {selectedSubjects.map((s) => (
              <div key={s.id} className="flex justify-between text-sm">
                <span className="text-foreground">{s.name}</span>
                <span className="text-foreground font-medium">
                  {formatPrice(getSubjectPrice(s))}
                </span>
              </div>
            ))}
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

          {submitError && (
            <div className="mb-4 rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
              {submitError}
            </div>
          )}

          <Button
            onClick={handleSubmit}
            disabled={isMutating}
            className="w-full"
            size="lg"
          >
            {isMutating
              ? 'Submitting...'
              : isParent
              ? `Register ${selectedSubjectIds.size} Subject${selectedSubjectIds.size !== 1 ? 's' : ''} — ${formatPrice(totalCost)}`
              : `Submit Request for ${selectedSubjectIds.size} Subject${selectedSubjectIds.size !== 1 ? 's' : ''}`}
          </Button>
        </div>
      )}
    </div>
  );
}
