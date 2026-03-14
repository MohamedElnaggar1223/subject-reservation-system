'use client';

import { useState, useMemo } from 'react';
import { useSuspenseQuery, useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, COUNCIL_LABELS, REGISTRATION_STATUS_LABELS } from '@repo/validations';

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

type Child = {
  id: string;
  name: string;
  email: string;
  grade: number | null;
  studentId: string | null;
};

const COUNCIL_COLORS: Record<string, string> = {
  pearson_edexcel: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-700',
  cambridge: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-900/20 dark:text-violet-300 dark:border-violet-700',
  oxford: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-700',
};

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(price);
}

function getSubjectPrice(subject: Subject): number {
  return subject.isOfferedAtSchool ? subject.priceInSchool : (subject.customPrice ?? subject.priceInSchool);
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
  const [successMessage, setSuccessMessage] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [councilFilter, setCouncilFilter] = useState('all');

  // Effective student ID: the student being registered for
  const effectiveStudentId = isParent ? (selectedChild?.id ?? null) : userId;

  // ─── Queries ───────────────────────────────────────────────────────────────

  const { data: activeSessions = [] } = useSuspenseQuery<Session[]>({
    queryKey: ['sessions', 'active'],
    queryFn: () => apiResponse(api.v1.sessions.active.$get()),
  });

  const { data: children = [] } = useSuspenseQuery<Child[]>({
    queryKey: ['links', 'children'],
    queryFn: () => apiResponse(api.v1.links.children.$get()),
    enabled: isParent,
  });

  // Load available subjects when both session and student are selected
  const { data: availableSubjects = [], isFetching: loadingSubjects } = useQuery<Subject[]>({
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
            studentId: selectedChild!.id,
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
    if (isCore) return; // Core subjects cannot be deselected
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
      <div className="max-w-3xl mx-auto px-4 py-12 text-center">
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-12">
          <div className="text-4xl mb-4">📅</div>
          <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100 mb-2">
            No Open Registration Windows
          </h2>
          <p className="text-slate-500 dark:text-slate-400">
            There are no active registration windows at this time. Check back later or contact the school for more information.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Register Subjects</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1">
          {isParent
            ? 'Select a child, then choose a session and subjects to register directly.'
            : 'Select subjects to register. Your request will be sent to your parent for approval.'}
        </p>
      </div>

      {/* Success Banner */}
      {successMessage && (
        <div className="rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 p-4 flex items-start gap-3">
          <span className="text-green-600 text-xl">✓</span>
          <div>
            <p className="font-medium text-green-800 dark:text-green-300">{successMessage}</p>
            <button
              onClick={() => setSuccessMessage('')}
              className="text-sm text-green-600 dark:text-green-400 underline mt-1"
            >
              Register more subjects
            </button>
          </div>
        </div>
      )}

      {/* Step 1: Select Child (Parent only) */}
      {isParent && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
          <h2 className="font-semibold text-slate-800 dark:text-slate-100 mb-3">
            Step 1 — Select Child
          </h2>
          {children.length === 0 ? (
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              No linked children. Go to{' '}
              <a href="/links" className="text-blue-600 dark:text-blue-400 underline">
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
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                      : 'border-slate-200 dark:border-slate-600 hover:border-blue-300 dark:hover:border-blue-600 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {child.name}
                  {child.grade && (
                    <span className="ml-1 text-slate-400 dark:text-slate-500">
                      · Grade {child.grade}
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
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
          <h2 className="font-semibold text-slate-800 dark:text-slate-100 mb-3">
            {isParent ? 'Step 2' : 'Step 1'} — Select Registration Window
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {activeSessions.map((sess) => {
              const end = new Date(sess.endDate);
              const now = new Date();
              const daysLeft = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
              return (
                <button
                  key={sess.id}
                  onClick={() => handleSessionSelect(sess)}
                  className={`text-left rounded-lg border p-4 transition-colors ${
                    selectedSession?.id === sess.id
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                      : 'border-slate-200 dark:border-slate-600 hover:border-blue-300 dark:hover:border-blue-600'
                  }`}
                >
                  <div className="font-medium text-slate-800 dark:text-slate-100">{sess.name}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Closes {end.toLocaleDateString()}
                  </div>
                  {daysLeft <= 7 && (
                    <div className="text-xs text-amber-600 dark:text-amber-400 font-medium mt-1">
                      ⚠ {daysLeft} day{daysLeft !== 1 ? 's' : ''} remaining
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Step 3: Select Subjects */}
      {selectedSession && effectiveStudentId && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-800 dark:text-slate-100">
              {isParent ? 'Step 3' : 'Step 2'} — Select Subjects
            </h2>
            {/* Council filter */}
            <select
              value={councilFilter}
              onChange={(e) => setCouncilFilter(e.target.value)}
              className="text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 px-2 py-1"
            >
              <option value="all">All Councils</option>
              <option value="pearson_edexcel">Pearson Edexcel</option>
              <option value="cambridge">Cambridge</option>
              <option value="oxford">Oxford</option>
            </select>
          </div>

          {loadingSubjects ? (
            <div className="text-center py-8 text-slate-400 dark:text-slate-500">
              Loading subjects…
            </div>
          ) : filteredSubjects.length === 0 ? (
            <div className="text-center py-8 text-slate-400 dark:text-slate-500">
              {availableSubjects.length === 0
                ? 'All available subjects are already registered for this session.'
                : 'No subjects match the selected filter.'}
            </div>
          ) : (
            <>
              {coreSubjects.length > 0 && (
                <div className="mb-3 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-2">
                  ★ Core subjects (Grade 10 June) are pre-selected and mandatory.
                </div>
              )}
              <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                {filteredSubjects.map((subject) => {
                  const price = getSubjectPrice(subject);
                  const isSelected = selectedSubjectIds.has(subject.id);
                  const isCore = subject.isCore;

                  return (
                    <button
                      key={subject.id}
                      onClick={() => toggleSubject(subject.id, isCore)}
                      disabled={isCore}
                      className={`w-full text-left rounded-lg border px-4 py-3 transition-colors flex items-center gap-3 ${
                        isSelected || isCore
                          ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
                          : 'border-slate-200 dark:border-slate-600 hover:border-blue-300 dark:hover:border-blue-600'
                      } ${isCore ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      {/* Checkbox */}
                      <div
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${
                          isSelected || isCore
                            ? 'border-blue-500 bg-blue-500'
                            : 'border-slate-300 dark:border-slate-500'
                        }`}
                      >
                        {(isSelected || isCore) && (
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>

                      {/* Subject info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-slate-800 dark:text-slate-100 text-sm">
                            {subject.name}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded border ${COUNCIL_COLORS[subject.council] ?? ''}`}>
                            {COUNCIL_LABELS[subject.council as keyof typeof COUNCIL_LABELS] ?? subject.council}
                          </span>
                          {isCore && (
                            <span className="text-xs px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-700">
                              Core ★
                            </span>
                          )}
                          {!subject.isOfferedAtSchool && (
                            <span className="text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600">
                              External
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{subject.code}</div>
                      </div>

                      {/* Price */}
                      <div className="text-sm font-semibold text-slate-700 dark:text-slate-300 shrink-0">
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
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
          <h2 className="font-semibold text-slate-800 dark:text-slate-100 mb-4">
            {isParent ? 'Step 4' : 'Step 3'} — Summary
          </h2>

          <div className="space-y-2 mb-4">
            {selectedSubjects.map((s) => (
              <div key={s.id} className="flex justify-between text-sm">
                <span className="text-slate-700 dark:text-slate-300">{s.name}</span>
                <span className="text-slate-900 dark:text-slate-100 font-medium">
                  {formatPrice(getSubjectPrice(s))}
                </span>
              </div>
            ))}
            <div className="border-t border-slate-200 dark:border-slate-700 pt-2 flex justify-between font-semibold">
              <span className="text-slate-800 dark:text-slate-100">Total</span>
              <span className="text-slate-900 dark:text-slate-50">{formatPrice(totalCost)}</span>
            </div>
          </div>

          {!isParent && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3">
              💡 Your request will be sent to your linked parent for approval. Payment is required after approval.
            </p>
          )}

          {submitError && (
            <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-400">
              {submitError}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={isMutating}
            className="w-full rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-3 transition-colors"
          >
            {isMutating
              ? 'Submitting…'
              : isParent
              ? `Register ${selectedSubjectIds.size} Subject${selectedSubjectIds.size !== 1 ? 's' : ''} — ${formatPrice(totalCost)}`
              : `Submit Request for ${selectedSubjectIds.size} Subject${selectedSubjectIds.size !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}
    </div>
  );
}
