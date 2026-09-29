'use client';

/**
 * The student's academic record (FEATURES_PLAN.md F0a): today's grade and
 * standing, the cohort and the three years it gives, this year's section
 * (and a warning when a correction left them in a section of another
 * grade), the section history, the exam series open now and whether the
 * student may register for each, and the record's changes — with the
 * actions the viewer's role allows. Embedded in /students/[id] and in the
 * desk's Student 360, so it assumes no page layout; finance roles read it.
 *
 * The spreadsheet version: the grade is a cell someone retypes every
 * September (and forgets for a student who repeats a year), the class is
 * the tab the student's row sits on, a withdrawal is a row struck through
 * with a note in the margin, and "may she sit November?" is a question for
 * the coordinator, who checks the rule from memory. Here the grade is
 * derived from one fact (the year they started grade 10) and never retyped,
 * the section history keeps itself, each open series answers the question
 * with the rule's own sentence, and a correction or a leaving is one form
 * that says beforehand what it will do (registrations expired, checkouts
 * closed, family told) and afterwards what it did.
 */

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  apiResponse,
  academicYearShortLabel,
  academicYearStartFromLabel,
  academicYearStartOf,
  cohortFromGrade,
  gradeInAcademicYear,
  gradeLabel,
  schoolDateString,
  ROLES,
  type CorrectCohortType,
  type RecordLeavingType,
} from '@repo/validations';
import { api } from '~/lib/hono';
import { useI18n } from '~/lib/i18n';
import { cn } from '~/lib/utils';
import { Button } from '~/components/ui/button';
import { ReasonModal } from '~/components/ui/reason-modal';
import { Badge, Notice, StandingBadge } from '~/components/ui/tone';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { StudentEnrolmentBlock } from '~/components/student-enrolment-block';

// ─── Shared with the students and sections screens ───────────────────────────

/**
 * One student's academic record (GET /v1/students/:id). Not exported: its
 * inferred type reaches into the API's eligibility service, which a
 * declaration cannot name (TS2742). A screen that shows the same record
 * declares the same one-line fetcher under `studentRecordKey`, so the two
 * share one request.
 */
const fetchStudentRecord = (id: string) => apiResponse(api.v1.students[':id'].$get({ param: { id } }));
export const studentRecordKey = (id: string) => ['students', 'record', id] as const;
type StudentRecord = Awaited<ReturnType<typeof fetchStudentRecord>>;
type SeriesRow = StudentRecord['series'][number];
type ChangeRow = StudentRecord['changes'][number];

/**
 * Dates as the school reads them, in the screen's language (Latin digits,
 * like every other number in the app). A school day (YYYY-MM-DD) is a
 * calendar date with no zone; an instant is read in Cairo.
 */
export function useSchoolDates() {
  const { language } = useI18n();
  const locale = language === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB';
  return {
    day: (d: string) =>
      new Date(`${d}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
    instant: (iso: string) =>
      new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Cairo' }),
  };
}

/** A modal dialog in the house style (the ReasonModal's shell): Escape closes, focus moves in. */
export function Dialog({
  title,
  description,
  busy = false,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  description?: React.ReactNode;
  busy?: boolean;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        ref={ref}
        className={cn(
          'max-h-[92vh] w-full overflow-y-auto rounded-xl border border-border bg-card p-6 text-start shadow-xl',
          wide ? 'max-w-2xl' : 'max-w-lg',
        )}
      >
        <h2 id={titleId} className="font-display text-lg font-bold text-foreground">
          {title}
        </h2>
        {description && <div className="mt-1 text-sm text-muted-foreground">{description}</div>}
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

const fieldClass =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary';

/**
 * A sentence the API or a person wrote (a refusal, a reason): shown as
 * written. The page translator skips it — its month rule would otherwise
 * turn "June" into Arabic in the middle of an English sentence — and the
 * text takes its own direction, so an English sentence reads right in an
 * Arabic page and an Arabic reason reads right in an English one.
 */
export function AsWritten({ children, className }: { children: string; className?: string }) {
  return (
    <span data-i18n-skip="true" dir="auto" className={className}>
      {children}
    </span>
  );
}

/**
 * Why a section membership ended. The API writes two reasons itself
 * ("Moved to 11B", "Left the school (withdrawn)"): those are shown in the
 * screen's language; anything else is the reason a person typed.
 */
export function EndReason({ text }: { text: string }) {
  const moved = /^Moved to (.+)$/.exec(text);
  if (moved) {
    return (
      <span>
        <span>Moved to</span> <span dir="ltr">{moved[1]}</span>
      </span>
    );
  }
  const left = /^Left the school \((withdrawn|transferred)\)$/.exec(text);
  if (left) {
    return (
      <span>
        <span>Left the school</span> · <span>{left[1] === 'transferred' ? 'Transferred' : 'Withdrawn'}</span>
      </span>
    );
  }
  return <AsWritten>{text}</AsWritten>;
}

// ─── The panel ───────────────────────────────────────────────────────────────

type ActionResult = { title: string; lines: [string, React.ReactNode][]; note?: string };
type DialogState = null | 'cohort' | 'leave' | 'readmit' | { grant: SeriesRow };

/** A grade-10 student refused a series other than June: the one refusal an exception lifts. */
const isGrade10Refusal = (s: SeriesRow) => s.code === 'grade10_june_only';

const shortYear = (label: string) => {
  const start = academicYearStartFromLabel(label);
  return start === null ? label : academicYearShortLabel(start);
};

export function StudentAcademicPanel({
  studentId,
  viewerRole,
  className,
}: {
  studentId: string;
  viewerRole: string;
  className?: string;
}) {
  const qc = useQueryClient();
  const dates = useSchoolDates();
  const { data: r, isLoading, isError, error, refetch } = useQuery({
    queryKey: studentRecordKey(studentId),
    queryFn: () => fetchStudentRecord(studentId),
  });
  const [dialog, setDialog] = useState<DialogState>(null);
  const [dialogError, setDialogError] = useState('');
  const [result, setResult] = useState<ActionResult | null>(null);

  const isAdmin = viewerRole === ROLES.ADMIN;
  const isAcademic = isAdmin || viewerRole === ROLES.COORDINATOR;

  const closeDialog = () => {
    setDialog(null);
    setDialogError('');
  };
  const done = (res: ActionResult) => {
    closeDialog();
    setResult(res);
    // The record, the lists it appears in (students, sections) and the desk's summary.
    qc.invalidateQueries({ queryKey: ['students'] });
    qc.invalidateQueries({ queryKey: ['academic'] });
    qc.invalidateQueries({ queryKey: ['desk'] });
  };
  const failed = (err: Error) => setDialogError(err.message);

  const correct = useMutation({
    mutationFn: (json: CorrectCohortType) =>
      apiResponse(api.v1.students[':id'].cohort.$put({ param: { id: studentId }, json })),
    onSuccess: (d) =>
      done({
        title: 'Cohort corrected',
        lines: [
          ['Grade this year:', gradeLabel(d.grade)],
          ['Started grade 10 in', academicYearShortLabel(d.cohortYear)],
          ['Registrations expired:', d.registrationsExpired],
          ['Open checkouts closed:', d.paymentsClosed],
        ],
        note: 'The family has been told of the change.',
      }),
    onError: failed,
  });

  const leave = useMutation({
    mutationFn: (json: RecordLeavingType) =>
      apiResponse(api.v1.students[':id'].leave.$post({ param: { id: studentId }, json })),
    onSuccess: (d) =>
      done({
        title: 'Leaving recorded',
        lines: [
          ['Section memberships ended:', d.sectionsEnded],
          ['Registrations expired:', d.registrationsExpired],
          ['Open checkouts closed:', d.paymentsClosed],
        ],
        note: 'Everything the student did stays on record. Only the admin can readmit them.',
      }),
    onError: failed,
  });

  const readmit = useMutation({
    mutationFn: (reason: string) =>
      apiResponse(api.v1.students[':id'].readmit.$post({ param: { id: studentId }, json: { reason } })),
    onSuccess: () =>
      done({
        title: 'Readmitted',
        lines: [],
        note: 'They may register again and be placed in a section. What expired when they left stays expired.',
      }),
    onError: failed,
  });

  const grant = useMutation({
    mutationFn: ({ sessionId, reason }: { sessionId: string; reason: string }) =>
      apiResponse(
        api.v1.exceptions.$post({ json: { type: 'grade10_other_series', studentId, sessionId, reason } }),
      ),
    onSuccess: (_d, v) => {
      const s = r?.series.find((x) => x.sessionId === v.sessionId);
      done({
        title: 'Exception granted',
        lines: s ? [['Series:', s.name]] : [],
        note: 'They may now register for this series. The exception can be revoked here.',
      });
    },
    onError: failed,
  });

  // The coordinator's own undo: the Exceptions page is the admin's and finance's.
  const [revokeError, setRevokeError] = useState('');
  const revoke = useMutation({
    mutationFn: (exceptionId: string) => apiResponse(api.v1.exceptions[':id'].revoke.$post({ param: { id: exceptionId } })),
    onSuccess: (d) => {
      done({
        title: 'Exception revoked',
        lines: [['Registrations expired:', d.registrationsExpired]],
        note: 'They may no longer register for that series; waiting registrations it allowed have expired, and their open checkouts closed.',
      });
    },
    onError: (err: Error) => setRevokeError(err.message),
  });

  if (isLoading) return <LoadingState label="Loading the academic record…" />;
  if (isError || !r) {
    return (
      <ErrorState
        title="Could not load the academic record"
        message={error instanceof Error ? error.message : undefined}
        onRetry={() => refetch()}
      />
    );
  }

  const left = r.standing === 'withdrawn' || r.standing === 'transferred';
  const current = academicYearStartFromLabel(r.academicYear) ?? academicYearStartOf();
  const canCorrect = isAdmin;
  const canLeave = isAcademic && !left;
  const canReadmit = isAdmin && left;

  return (
    <section className={cn('mt-4 space-y-4 text-start', className)} aria-label="Academic record">
      {result && (
        <Notice tone="success" title={result.title}>
          {result.lines.length > 0 && (
            <ul className="space-y-0.5">
              {result.lines.map(([k, v]) => (
                <li key={k}>
                  <span>{k}</span> <span className="font-semibold">{v}</span>
                </li>
              ))}
            </ul>
          )}
          {result.note && <p className={cn(result.lines.length > 0 && 'mt-1')}>{result.note}</p>}
          <button type="button" className="mt-2 text-xs underline hover:no-underline" onClick={() => setResult(null)}>
            Dismiss
          </button>
        </Notice>
      )}

      {left && r.student.leftOn && (
        <Notice tone="danger" title={r.standing === 'transferred' ? 'Transferred to another school' : 'Withdrawn from the school'}>
          <p>
            <span>Left on</span> <span className="font-semibold">{dates.day(r.student.leftOn)}</span>
          </p>
          {r.student.leftReason && (
            <p>
              <span>Reason:</span> <AsWritten>{r.student.leftReason}</AsWritten>
            </p>
          )}
          <p className="mt-1">They are refused new registrations. Only the admin can readmit them.</p>
        </Notice>
      )}

      {r.sectionMismatch && r.section && (
        <Notice tone="warning" title="Their section does not match their grade">
          <p>
            <span>Section:</span> <span className="font-semibold">{r.section.name}</span> <span>({gradeLabel(r.section.grade)})</span>
          </p>
          <p>
            <span>Grade this year:</span> <span className="font-semibold">{r.gradeLabel}</span>
          </p>
          <p className="mt-1">
            {isAcademic ? (
              <Link href={`/academic/sections?section=${r.section.sectionId}`} className="underline hover:no-underline">
                Move them to a section of their grade
              </Link>
            ) : (
              <span>The coordinator moves them to a section of their grade.</span>
            )}
          </p>
        </Notice>
      )}

      {/* Today, the cohort, the section */}
      <div className="grid gap-4 md:grid-cols-3">
        <Block title="Today">
          <p className="font-display text-2xl font-bold text-foreground">{r.gradeLabel}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StandingBadge standing={r.standing} />
            <span className="text-xs text-muted-foreground">
              <span>Academic year</span> <span dir="ltr">{academicYearShortLabel(current)}</span>
            </span>
          </div>
        </Block>

        <Block title="Cohort">
          {r.cohort ? (
            <>
              <p className="text-sm text-foreground">
                <span>Started grade 10 in</span> <span className="font-semibold" dir="ltr">{r.cohort.label}</span>
              </p>
              <ol className="mt-2 space-y-1">
                {r.cohort.years.map((y) => {
                  const now = academicYearShortLabel(current) === y.academicYear;
                  return (
                    <li
                      key={y.grade}
                      className={cn(
                        'flex items-center justify-between rounded-lg px-2.5 py-1 text-sm',
                        now ? 'bg-primary/10 font-semibold text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      <span>{gradeLabel(y.grade)}</span>
                      <span dir="ltr">{y.academicYear}</span>
                    </li>
                  );
                })}
              </ol>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {canCorrect
                ? 'Not recorded. Use Correct cohort to record the grade they are in this year.'
                : 'Not recorded. The admin records it before the student can register.'}
            </p>
          )}
        </Block>

        <Block title="Section this year">
          {r.section ? (
            <>
              <p className="font-display text-2xl font-bold text-foreground">
                {isAcademic ? (
                  <Link href={`/academic/sections?section=${r.section.sectionId}`} className="hover:underline">
                    {r.section.name}
                  </Link>
                ) : (
                  r.section.name
                )}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                <span>{gradeLabel(r.section.grade)}</span> · <span>Since</span> <span>{dates.day(r.section.startedOn)}</span>
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {left || r.standing !== 'in_school' ? 'No section this year.' : 'Not in a section yet.'}
            </p>
          )}
        </Block>
      </div>

      {/* F0b: what they are taught this year */}
      <StudentEnrolmentBlock studentId={studentId} canEdit={isAcademic} />

      {/* Actions the viewer may take */}
      {canCorrect || canLeave || canReadmit ? (
        <div className="flex flex-wrap gap-2">
          {canCorrect && (
            <Button variant="outline" className="h-10" onClick={() => setDialog('cohort')}>
              Correct cohort
            </Button>
          )}
          {canLeave && (
            <Button variant="outline" className="h-10" onClick={() => setDialog('leave')}>
              Record leaving
            </Button>
          )}
          {canReadmit && (
            <Button className="h-10" onClick={() => setDialog('readmit')}>
              Readmit
            </Button>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          The coordinator and the admin change the academic record; you can read it here.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* The exam series open now */}
        <Block title="Exam series open now">
          {r.series.length === 0 ? (
            <p className="text-sm text-muted-foreground">No exam series is open or being prepared.</p>
          ) : (
            <ul className="divide-y divide-border">
              {r.series.map((s) => (
                <li key={s.sessionId} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{s.name}</span>
                    <Badge tone={s.status === 'active' ? 'info' : 'neutral'}>
                      {s.status === 'active' ? 'Open' : 'Being prepared'}
                    </Badge>
                    <Badge tone={s.allowed ? 'success' : 'danger'}>{s.allowed ? 'May register' : 'May not register'}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <span>Grade in this series:</span> <span>{gradeLabel(s.grade)}</span> ·{' '}
                    <span dir="ltr">{shortYear(s.academicYear)}</span>
                  </p>
                  {!s.allowed && s.reason && (
                    <p className="mt-1 text-sm text-foreground">
                      <AsWritten>{s.reason}</AsWritten>
                    </p>
                  )}
                  {s.grade10ExceptionId && (
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge tone="info">Grade-10 exception</Badge>
                      {isAcademic && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8"
                          disabled={revoke.isPending}
                          onClick={() => {
                            setRevokeError('');
                            if (confirm(`Revoke the grade-10 exception for ${s.name}? Waiting registrations it allowed will expire.`)) {
                              revoke.mutate(s.grade10ExceptionId!);
                            }
                          }}
                        >
                          Revoke the exception
                        </Button>
                      )}
                    </div>
                  )}
                  {revokeError && s.grade10ExceptionId && (
                    <p className="mt-1 text-sm text-destructive" role="alert">{revokeError}</p>
                  )}
                  {s.graduateRetake && (
                    <p className="mt-1 text-xs text-muted-foreground">A graduate retake: no school fee.</p>
                  )}
                  {isAcademic && !left && isGrade10Refusal(s) && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 h-9"
                      onClick={() => setDialog({ grant: s })}
                    >
                      Grant the grade-10 exception
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Block>

        {/* Section history */}
        <Block title="Section history">
          {r.sectionHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">Never in a section.</p>
          ) : (
            <ul className="divide-y divide-border">
              {r.sectionHistory.map((h) => (
                <li key={h.membershipId} className="py-2 first:pt-0 last:pb-0 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium text-foreground">
                      {h.name} <span className="text-xs font-normal text-muted-foreground" dir="ltr">{academicYearShortLabel(h.startYear)}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      <span>{dates.day(h.startedOn)}</span> –{' '}
                      {h.endedOn ? <span>{dates.day(h.endedOn)}</span> : <span className="font-medium text-foreground">now</span>}
                    </span>
                  </div>
                  {h.endReason && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      <EndReason text={h.endReason} />
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Block>
      </div>

      {/* The record's changes */}
      <Block title="Changes to the record">
        {r.changes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No corrections, leavings or readmissions.</p>
        ) : (
          <ul className="divide-y divide-border">
            {r.changes.map((c) => (
              <ChangeItem key={c.id} change={c} />
            ))}
          </ul>
        )}
      </Block>

      {dialog === 'cohort' && (
        <CohortDialog
          record={r}
          current={current}
          busy={correct.isPending}
          error={dialogError}
          onConfirm={(json) => correct.mutate(json)}
          onClose={closeDialog}
        />
      )}
      {dialog === 'leave' && (
        <LeaveDialog
          busy={leave.isPending}
          error={dialogError}
          onConfirm={(json) => leave.mutate(json)}
          onClose={closeDialog}
        />
      )}
      {dialog === 'readmit' && (
        <ReasonModal
          title="Readmit this student"
          description="They may register again and be placed in a section. What expired when they left stays expired. Recorded with your reason."
          confirmLabel="Readmit"
          minLength={5}
          isPending={readmit.isPending}
          error={dialogError}
          onConfirm={(reason) => readmit.mutate(reason)}
          onClose={closeDialog}
        />
      )}
      {dialog && typeof dialog === 'object' && (
        <ReasonModal
          title={dialog.grant.name}
          description="Grade 10 sits the June series only. This exception lets the student register for this series; it is recorded with your reason and can be revoked here."
          confirmLabel="Grant the exception"
          isPending={grant.isPending}
          error={dialogError}
          onConfirm={(reason) => grant.mutate({ sessionId: dialog.grant.sessionId, reason })}
          onClose={closeDialog}
        />
      )}
    </section>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

// ─── The record's changes ────────────────────────────────────────────────────

/** A field of an audit row's before/after snapshot (free-form JSON). */
function field(snapshot: unknown, key: string): string | number | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const v = (snapshot as Record<string, unknown>)[key];
  return typeof v === 'string' || typeof v === 'number' ? v : null;
}

const cohortText = (v: string | number | null) => (typeof v === 'number' ? academicYearShortLabel(v) : 'Not recorded');

function ChangeItem({ change: c }: { change: ChangeRow }) {
  const dates = useSchoolDates();
  const reason = field(c.after, 'reason');
  let title = 'Record changed';
  let detail: React.ReactNode = null;
  if (c.action === 'STUDENT_COHORT_CORRECTED') {
    title = 'Cohort corrected';
    detail = (
      <p>
        <span>Started grade 10 in</span> <span dir="ltr">{cohortText(field(c.before, 'cohortYear'))}</span> <span aria-hidden className="inline-block rtl:rotate-180">→</span>{' '}
        <span className="font-semibold" dir="ltr">{cohortText(field(c.after, 'cohortYear'))}</span>
      </p>
    );
  } else if (c.action === 'STUDENT_LEFT') {
    title = field(c.after, 'kind') === 'transferred' ? 'Transferred to another school' : 'Withdrawn from the school';
    const on = field(c.after, 'leftOn');
    detail = typeof on === 'string' && (
      <p>
        <span>Left on</span> <span>{dates.day(on)}</span>
      </p>
    );
  } else if (c.action === 'STUDENT_COHORT_INFERRED') {
    // The F0a backfill read a graduation from the old records: staff review it here.
    title = 'Cohort inferred by the backfill';
    const on = field(c.after, 'graduatedAt');
    detail = (
      <p>
        <span>Started grade 10 in</span> <span className="font-semibold" dir="ltr">{cohortText(field(c.after, 'cohortYear'))}</span>
        {typeof on === 'string' && <> · <span>Graduated on</span> <span>{dates.instant(on)}</span></>}
        {field(c.after, 'basis') === 'registration' && <> · <span>From a past registration</span></>}
      </p>
    );
  } else if (c.action === 'STUDENT_COHORT_RECORDED') {
    title = 'Grade recorded at first setup';
    detail = (
      <p>
        <span>Started grade 10 in</span> <span className="font-semibold" dir="ltr">{cohortText(field(c.after, 'cohortYear'))}</span>
      </p>
    );
  } else if (c.action === 'STUDENT_COHORT_UNRECORDED') {
    title = 'Grade not recorded at the move to cohorts';
  } else if (c.action === 'STUDENT_READMITTED') {
    title = 'Readmitted';
  } else if (c.action === 'USER_GRADE_CHANGED') {
    title = 'Grade changed';
  }
  return (
    <li className="py-2.5 first:pt-0 last:pb-0 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-foreground">{title}</span>
        <span className="text-xs text-muted-foreground">
          <span>{dates.instant(c.at)}</span>
          {c.by && (
            <>
              {' · '}
              <span>{c.by}</span>
            </>
          )}
        </span>
      </div>
      <div className="mt-0.5 space-y-0.5 text-xs text-muted-foreground">
        {detail}
        {typeof reason === 'string' && (
          <p>
            <span>Reason:</span> <AsWritten>{reason}</AsWritten>
          </p>
        )}
      </div>
    </li>
  );
}

// ─── The cohort correction (admin) ───────────────────────────────────────────

const GRADES_NOW = [9, 10, 11, 12] as const;

function CohortDialog({
  record,
  current,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  record: StudentRecord;
  current: number;
  busy: boolean;
  error: string;
  onConfirm: (json: CorrectCohortType) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'grade' | 'cohort'>('grade');
  const [gradeNow, setGradeNow] = useState<(typeof GRADES_NOW)[number] | null>(null);
  const [cohortYear, setCohortYear] = useState<number | null>(null);
  const [reason, setReason] = useState('');

  const was = record.student.cohortYear;
  const next = mode === 'grade' ? (gradeNow === null ? null : cohortFromGrade(gradeNow, current)) : cohortYear;
  const unchanged = next !== null && next === was;
  const cohortChoices = Array.from({ length: 8 }, (_, i) => current + 1 - i);
  const ready = next !== null && !unchanged && reason.trim().length >= 5;

  return (
    <Dialog
      title="Correct the cohort"
      description="For a student who repeats a year, or whose grade was entered wrong. Their grade in every year follows from the year they started grade 10."
      busy={busy}
      onClose={onClose}
      wide
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          onConfirm(mode === 'grade' ? { gradeNow: gradeNow!, reason: reason.trim() } : { cohortYear: cohortYear!, reason: reason.trim() });
        }}
        className="space-y-4"
      >
        <p className="text-sm text-foreground">
          <span>Recorded now:</span> <span className="font-semibold">{record.gradeLabel}</span>
          {was !== null && (
            <>
              {' · '}
              <span>Started grade 10 in</span> <span dir="ltr">{academicYearShortLabel(was)}</span>
            </>
          )}
        </p>

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-foreground">What do you know?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(['grade', 'cohort'] as const).map((m) => (
              <label
                key={m}
                className={cn(
                  'flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm',
                  mode === m ? 'border-primary bg-primary/5' : 'border-border',
                )}
              >
                <input type="radio" name="cohort-mode" checked={mode === m} onChange={() => setMode(m)} />
                <span className="font-medium text-foreground">
                  {m === 'grade' ? 'The grade they are in this year' : 'The year they started grade 10'}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {mode === 'grade' ? (
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-foreground">
              <span>Grade in</span> <span dir="ltr">{academicYearShortLabel(current)}</span>
            </legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {GRADES_NOW.map((g) => (
                <label
                  key={g}
                  className={cn(
                    'flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary',
                    gradeNow === g ? 'border-primary bg-primary/5 text-foreground' : 'border-border text-foreground',
                  )}
                >
                  <input type="radio" name="grade-now" className="sr-only" checked={gradeNow === g} onChange={() => setGradeNow(g)} />
                  <span>{g === 9 ? 'Grade 9' : gradeLabel(g)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <div>
            <label htmlFor="cohort-year" className="mb-1 block text-sm font-medium text-foreground">
              Started grade 10 in
            </label>
            <select
              id="cohort-year"
              value={cohortYear ?? ''}
              onChange={(e) => setCohortYear(e.target.value ? Number(e.target.value) : null)}
              className={fieldClass}
            >
              <option value="">Choose the academic year</option>
              {cohortChoices.map((y) => (
                <option key={y} value={y}>
                  {academicYearShortLabel(y)}
                </option>
              ))}
            </select>
          </div>
        )}

        {next !== null && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
            {unchanged ? (
              <p className="text-foreground">That is the cohort already recorded: nothing would change.</p>
            ) : (
              <>
                <p className="font-medium text-foreground">After the correction</p>
                <ul className="mt-1 space-y-0.5 text-foreground">
                  <li>
                    <span>Grade this year:</span> <span className="font-semibold">{gradeLabel(gradeInAcademicYear(next, current))}</span>
                  </li>
                  <li>
                    <span>Started grade 10 in</span> <span className="font-semibold" dir="ltr">{academicYearShortLabel(next)}</span>
                  </li>
                </ul>
                {record.series.length > 0 && (
                  <>
                    <p className="mt-2 font-medium text-foreground">In the exam series open now</p>
                    <ul className="mt-1 space-y-0.5">
                      {record.series.map((s) => {
                        const year = academicYearStartFromLabel(s.academicYear);
                        const after = year === null ? null : gradeInAcademicYear(next, year);
                        return (
                          <li key={s.sessionId} className="text-foreground">
                            <span>{s.name}</span>
                            {': '}
                            <span>{gradeLabel(s.grade)}</span> <span aria-hidden className="inline-block rtl:rotate-180">→</span> <span className="font-semibold">{gradeLabel(after)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
                <p className="mt-2 text-muted-foreground">
                  Registrations for series they may no longer sit expire, their open checkouts close with any escrow returned, and the family is told. The correction is recorded with your reason.
                </p>
              </>
            )}
          </div>
        )}

        <div>
          <label htmlFor="cohort-reason" className="mb-1 block text-sm font-medium text-foreground">
            Reason
          </label>
          <textarea
            id="cohort-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Repeating grade 11"
            className={cn(fieldClass, 'resize-none')}
          />
          <p className="mt-1 text-xs text-muted-foreground">At least 5 characters; kept in the audit trail.</p>
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            <AsWritten>{error}</AsWritten>
          </p>
        )}

        <div className="flex gap-3">
          <Button type="button" variant="outline" className="h-10 flex-1" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" className="h-10 flex-1" disabled={busy || !ready}>
            {busy ? 'Working…' : 'Correct the cohort'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ─── A student leaving (coordinator, admin) ──────────────────────────────────

function LeaveDialog({
  busy,
  error,
  onConfirm,
  onClose,
}: {
  busy: boolean;
  error: string;
  onConfirm: (json: RecordLeavingType) => void;
  onClose: () => void;
}) {
  const today = schoolDateString(new Date());
  const [kind, setKind] = useState<RecordLeavingType['kind'] | null>(null);
  const [leftOn, setLeftOn] = useState(today);
  const [reason, setReason] = useState('');
  const ready = !!kind && !!leftOn && leftOn <= today && reason.trim().length >= 5;

  return (
    <Dialog
      title="Record that the student left"
      description="They are refused new registrations, their section membership ends that day, and registrations still waiting expire with their open checkouts closed. Everything they did stays on record; only the admin can readmit them."
      busy={busy}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onConfirm({ kind: kind!, leftOn, reason: reason.trim() });
        }}
        className="space-y-4"
      >
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-foreground">How did they leave?</legend>
          <div className="space-y-2">
            {(
              [
                ['withdrawn', 'Withdrawn', 'The family took them out of the school.'],
                ['transferred', 'Transferred', 'They moved to another school.'],
              ] as const
            ).map(([value, label, hint]) => (
              <label
                key={value}
                className={cn(
                  'flex min-h-11 cursor-pointer gap-3 rounded-lg border px-3 py-2 text-sm',
                  kind === value ? 'border-primary bg-primary/5' : 'border-border',
                )}
              >
                <input type="radio" name="leave-kind" className="mt-0.5" checked={kind === value} onChange={() => setKind(value)} />
                <span>
                  <span className="font-medium text-foreground">{label}</span>
                  <span className="block text-xs text-muted-foreground">{hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="leave-date" className="mb-1 block text-sm font-medium text-foreground">
            The day they left
          </label>
          <input
            id="leave-date"
            type="date"
            value={leftOn}
            max={today}
            onChange={(e) => setLeftOn(e.target.value)}
            className={fieldClass}
          />
          {leftOn > today && <p className="mt-1 text-xs text-destructive">The day cannot be in the future.</p>}
        </div>
        <div>
          <label htmlFor="leave-reason" className="mb-1 block text-sm font-medium text-foreground">
            Reason
          </label>
          <textarea
            id="leave-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. The family moved to Alexandria"
            className={cn(fieldClass, 'resize-none')}
          />
          <p className="mt-1 text-xs text-muted-foreground">At least 5 characters; kept in the audit trail.</p>
        </div>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            <AsWritten>{error}</AsWritten>
          </p>
        )}
        <div className="flex gap-3">
          <Button type="button" variant="outline" className="h-10 flex-1" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="destructive" className="h-10 flex-1" disabled={busy || !ready}>
            {busy ? 'Working…' : 'Record leaving'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
