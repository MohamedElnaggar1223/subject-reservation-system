'use client';

/**
 * The statement (RESERVATIONS_REWORK.md §4.5; docs/features/RESERVATIONS_LINES.md §5) — for a
 * child, a whole family, and the Student 360 at the desk.
 *
 * The spreadsheet version: the response sheet's row per subject with the fee note typed by hand,
 * the receipt book beside it, and nothing at all for the family (no price was ever on a form).
 * Here every line shows its price and why ("course 14,000 × 50% + board 9,200 × 100%"), what was
 * paid and is still owed, when, and its receipt; the payments below it, one per entry deadline;
 * the escrow. Every number is the ledger's. (Charges — services, pushed school fees, instalments —
 * join the lines when step C lands: the API's `charges` per student is their place.)
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InferRequestType } from 'hono/client';
import { api } from '~/lib/hono';
import { apiResponse, REGISTRATION_STATUS_LABELS, RECEIPT_STATUS_LABELS } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge, type Tone } from '~/components/ui/tone';
import { ErrorState, LoadingState, EmptyState } from '~/components/ui/query-state';
import { Money, Day, Modal, Field, INPUT_CLASS, TEXTAREA_CLASS, ErrorLine, errorText } from '~/app/(app)/(sessions)/admin/sessions/sessions-shared';
import { fetchReserveOffers } from './reserve';

export const fetchStatement = (q: { studentId?: string; familyId?: string }) => apiResponse(api.v1.statement.$get({ query: q }));
export type StatementData = Awaited<ReturnType<typeof fetchStatement>>;
type StudentStatement = StatementData['students'][number];
type StatementLine = StudentStatement['sessions'][number]['lines'][number];
export const statementKey = (q: { studentId?: string; familyId?: string }) => ['statement', q.studentId ?? '', q.familyId ?? ''] as const;

const STATUS_TONE: Record<string, Tone> = {
  pending_approval: 'warning', pending_payment: 'warning', preregistered: 'info', confirmed: 'success',
  dropped_pending_receipt: 'warning', dropped: 'neutral', rejected: 'neutral', expired: 'neutral',
};
const ENDED = ['expired', 'rejected'];
const SOURCE: Record<string, string> = { declared_by_family: 'declared by the family', declared_by_desk: 'declared at the desk', known: 'on record', legacy: 'before the system' };

function entryText(l: StatementLine) {
  return `${l.attempt === 'retake' ? 'Retake' : 'First entry'}, ${l.mode === 'self_study' ? 'self-study' : 'in school'}`;
}

/**
 * A statement: `money` false shows the lines without prices (the coordinator's view of a
 * student's lines); `teacherChange` adds the teacher action (staff).
 */
export function StatementView({ query, money = true, teacherChange = false }: {
  query: { studentId?: string; familyId?: string };
  money?: boolean;
  teacherChange?: boolean;
}): React.JSX.Element {
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: statementKey(query), queryFn: () => fetchStatement(query) });
  const [showEnded, setShowEnded] = useState(false);
  const [teacherFor, setTeacherFor] = useState<StatementLine | null>(null);
  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState message={error instanceof Error ? error.message : undefined} onRetry={() => refetch()} />;
  if (!data.students.length) return <EmptyState title="No children linked yet" />;
  return (
    <div className="space-y-6">
      {data.students.length > 1 && money && (
        <div className="grid gap-3 sm:grid-cols-4">
          <Total label="Family total" amount={data.totals.price} />
          <Total label="Paid" amount={data.totals.paid} />
          <Total label="Outstanding" amount={data.totals.outstanding} tone={data.totals.outstanding > 0 ? 'warning' : undefined} />
          <Total label="Escrow" amount={data.totals.escrowFree} hint={data.totals.escrowHeld > 0 ? <><span>held</span> <Money amount={data.totals.escrowHeld} /></> : undefined} />
        </div>
      )}
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" className="h-3.5 w-3.5" checked={showEnded} onChange={(e) => setShowEnded(e.target.checked)} />
        <span>Show ended lines (expired, rejected)</span>
      </label>
      {data.students.map((s) => (
        <StudentBlock key={s.student.id} s={s} money={money} showEnded={showEnded} teacherChange={teacherChange} onTeacher={setTeacherFor} />
      ))}
      {teacherFor && <TeacherModal line={teacherFor} onClose={() => setTeacherFor(null)} />}
    </div>
  );
}

function Total({ label, amount, hint, tone }: { label: string; amount: number; hint?: React.ReactNode; tone?: Tone }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${tone === 'warning' ? 'text-amber-700 dark:text-amber-400' : 'text-foreground'}`}><Money amount={amount} /></p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function StudentBlock({ s, money, showEnded, teacherChange, onTeacher }: {
  s: StudentStatement; money: boolean; showEnded: boolean; teacherChange: boolean; onTeacher: (l: StatementLine) => void;
}) {
  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-foreground"><bdi data-i18n-skip="true">{s.student.name}</bdi></h2>
          <p className="text-xs text-muted-foreground">
            <span>{s.student.gradeLabel}</span>
            {s.student.section && <> · <bdi data-i18n-skip="true">{s.student.section}</bdi></>}
            {s.student.number && <> · <bdi className="font-mono" data-i18n-skip="true">{s.student.number}</bdi></>}
          </p>
        </div>
        {money && (
          <div className="flex flex-wrap gap-6 text-end text-sm">
            <div><p className="text-xs text-muted-foreground">Price</p><p className="font-semibold"><Money amount={s.totals.price} /></p></div>
            <div><p className="text-xs text-muted-foreground">Paid</p><p className="font-semibold"><Money amount={s.totals.paid} /></p></div>
            <div><p className="text-xs text-muted-foreground">Outstanding</p><p className={`font-semibold ${s.totals.outstanding > 0 ? 'text-amber-700 dark:text-amber-400' : ''}`}><Money amount={s.totals.outstanding} /></p></div>
            <div><p className="text-xs text-muted-foreground">Escrow</p><p className="font-semibold"><Money amount={s.escrow.free} /></p>
              {s.escrow.held > 0 && <p className="text-xs text-muted-foreground"><span>held</span> <Money amount={s.escrow.held} /></p>}</div>
          </div>
        )}
      </div>

      {s.sessions.length === 0 && <p className="text-sm text-muted-foreground">Nothing reserved yet.</p>}
      {s.sessions.map((sess) => {
        const lines = sess.lines.filter((l) => showEnded || !ENDED.includes(l.status));
        if (!lines.length) return null;
        return (
          <div key={sess.id} className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground"><bdi data-i18n-skip="true">{sess.name}</bdi></h3>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-start font-medium">Line</th>
                    {money && <th className="px-3 py-2 text-end font-medium">Price</th>}
                    {money && <th className="px-3 py-2 text-end font-medium">Paid</th>}
                    {money && <th className="px-3 py-2 text-end font-medium">Outstanding</th>}
                    {money && <th className="px-3 py-2 text-start font-medium">Due</th>}
                    {money && <th className="px-3 py-2 text-start font-medium">Receipt</th>}
                    <th className="px-3 py-2 text-start font-medium">Status</th>
                    {teacherChange && <th className="px-3 py-2" />}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id} className="border-b border-border last:border-0 align-top">
                      <td className="px-3 py-2">
                        <div className="font-medium text-foreground"><bdi data-i18n-skip="true">{l.label}</bdi></div>
                        <div className="text-xs text-muted-foreground">
                          <span>{entryText(l)}</span>
                          {l.teacher && <> · <bdi data-i18n-skip="true">{l.teacher}</bdi></>}
                          {l.series && <> · <bdi data-i18n-skip="true">{l.series}</bdi></>}
                        </div>
                        {l.priorSitting && (
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            <span>from</span> <bdi data-i18n-skip="true">{l.priorSitting.name}</bdi>{' '}
                            <span>({SOURCE[l.priorSitting.source ?? ''] ?? l.priorSitting.source})</span>
                            {l.priorSitting.outcome === 'verified' && <> <Badge tone="success">verified</Badge></>}
                            {l.priorSitting.outcome === 'rejected' && <> <Badge tone="danger">not confirmed</Badge></>}
                            {!l.priorSitting.outcome && (l.priorSitting.source === 'declared_by_family' || l.priorSitting.source === 'declared_by_desk') && <> <Badge tone="warning">to be verified by the school</Badge></>}
                          </div>
                        )}
                      </td>
                      {money && (
                        <td className="px-3 py-2 text-end">
                          <span title={l.basisText}><Money amount={l.price} /></span>
                          {l.provisional && <> <Badge tone="warning">ⓟ</Badge></>}
                          <div className="text-[11px] text-muted-foreground" dir="ltr">{l.basisText}</div>
                        </td>
                      )}
                      {money && <td className="px-3 py-2 text-end"><Money amount={l.paid} />{l.refunded > 0 && <div className="text-xs text-muted-foreground"><span>refunded</span> <Money amount={l.refunded} /></div>}</td>}
                      {money && <td className="px-3 py-2 text-end">{l.outstanding > 0 ? <Money amount={l.outstanding} className="font-semibold text-amber-700 dark:text-amber-400" /> : <span className="text-muted-foreground">—</span>}</td>}
                      {money && (
                        <td className="px-3 py-2">
                          <Day iso={l.dueAt} />
                          {l.overdueDays > 0 && <div><Badge tone="danger"><span>{l.overdueDays}</span>&nbsp;<span>{l.overdueDays === 1 ? 'day overdue' : 'days overdue'}</span></Badge></div>}
                          {l.provisional && l.outstanding > 0 && <div className="text-xs text-muted-foreground">board fee provisional, confirmed before payment</div>}
                        </td>
                      )}
                      {money && (
                        <td className="px-3 py-2 text-xs">
                          {l.receipt ? (
                            <>
                              <span className="font-mono" data-i18n-skip="true">{l.receipt.number}</span>
                              <div className="text-muted-foreground">{RECEIPT_STATUS_LABELS[l.receipt.status as keyof typeof RECEIPT_STATUS_LABELS] ?? l.receipt.status}</div>
                            </>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                      )}
                      <td className="px-3 py-2"><Badge tone={STATUS_TONE[l.status] ?? 'neutral'}>{REGISTRATION_STATUS_LABELS[l.status as keyof typeof REGISTRATION_STATUS_LABELS] ?? l.status}</Badge></td>
                      {teacherChange && (
                        <td className="px-3 py-2 text-end">
                          {['pending_approval', 'pending_payment', 'preregistered', 'confirmed'].includes(l.status) && (
                            <Button size="sm" variant="ghost" onClick={() => onTeacher(l)}>Teacher</Button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {money && (s.remarks.length > 0 || s.schoolFees.length > 0 || s.charges.length > 0) && (
        <div className="space-y-1 text-sm">
          {s.schoolFees.map((f) => (
            <div key={f.academicYear} className="flex flex-wrap justify-between gap-2 border-b border-border py-1.5 last:border-0">
              <span><span>School fee</span> <span dir="ltr">{f.academicYear}</span>{f.waived && <> <Badge tone="info">waived</Badge></>}</span>
              <span className="flex gap-4"><Money amount={f.amount} /> <span><span>paid</span> <Money amount={f.paid} /></span>{f.outstanding > 0 && <Money amount={f.outstanding} className="font-semibold text-amber-700 dark:text-amber-400" />}</span>
            </div>
          ))}
          {s.remarks.map((r) => (
            <div key={r.id} className="flex flex-wrap justify-between gap-2 border-b border-border py-1.5 last:border-0">
              <bdi data-i18n-skip="true">{r.label}</bdi>
              <span className="flex gap-4"><Money amount={r.fee} /> <span><span>paid</span> <Money amount={r.paid} /></span></span>
            </div>
          ))}
          {s.charges.map((c) => (
            <div key={c.id} className="flex flex-wrap justify-between gap-2 border-b border-border py-1.5 last:border-0">
              <bdi data-i18n-skip="true">{c.label}</bdi>
              <span className="flex gap-4"><Money amount={c.price} /> <span><span>paid</span> <Money amount={c.paid} /></span></span>
            </div>
          ))}
        </div>
      )}

      {money && s.payments.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Payments</h3>
          <p className="text-xs text-muted-foreground">One payment per entry deadline: each series is paid for on its own.</p>
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {s.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 px-3 py-2">
                <div>
                  <div><Day iso={p.at} /> · <span>{p.purpose === 'registration' ? 'Subjects' : p.purpose === 'school_fee' ? 'School fee' : p.purpose === 'remark' ? 'Remark' : p.purpose === 'preregistration' ? 'Preregistration' : p.purpose}</span>
                    {' '}<span className="text-muted-foreground">({p.instrument ?? p.method})</span></div>
                  {p.covers.length > 0 && <div className="text-xs text-muted-foreground"><bdi data-i18n-skip="true">{p.covers.map((c) => `${c.label}${c.receipt ? ` · ${c.receipt}` : ''}`).join(', ')}</bdi></div>}
                  {p.series.length > 0 && <div className="text-xs text-muted-foreground"><bdi data-i18n-skip="true">{p.series.join(', ')}</bdi>{p.deadline && <> · <span>deadline</span> <Day iso={p.deadline} /></>}</div>}
                </div>
                <div className="text-end">
                  <Money amount={p.total} className="font-semibold" />
                  {p.escrowApplied > 0 && <div className="text-xs text-muted-foreground"><span>from escrow</span> <Money amount={p.escrowApplied} /></div>}
                  <div><Badge tone={p.status === 'completed' ? 'success' : p.status === 'refunded' ? 'neutral' : 'warning'}>{p.status === 'completed' ? 'Paid' : p.status === 'refunded' ? 'Reversed' : 'In progress'}</Badge></div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// ─── The teacher on a line (§3.5) ────────────────────────────────────────────

const changeTeacher = (id: string, json: InferRequestType<(typeof api.v1.registrations)[':id']['teacher']['$put']>['json']) =>
  apiResponse(api.v1.registrations[':id'].teacher.$put({ param: { id }, json }));

function TeacherModal({ line, onClose }: { line: StatementLine; onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['registrations', 'offers', line.session.id, line.studentId],
    queryFn: () => fetchReserveOffers(line.session.id, line.studentId),
  });
  const item = data?.offers.flatMap((o) => o.items).find((i) => i.id === line.offerItemId);
  const teachers = item?.teachers ?? [];
  const [choice, setChoice] = useState<string>(line.mode === 'self_study' ? 'self' : line.teacherId ?? '');
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => changeTeacher(line.id, choice === 'self'
      ? { teacherId: null, mode: 'self_study', reason }
      : { teacherId: choice || null, reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['statement'] });
      qc.invalidateQueries({ queryKey: ['desk'] });
      onClose();
    },
    onError: (e) => setFailure(errorText(e)),
  });
  return (
    <Modal title="Change the teacher" onClose={onClose}>
      {isLoading ? <LoadingState /> : (
        <div className="space-y-4">
          <p className="text-sm text-foreground"><bdi data-i18n-skip="true">{line.label}</bdi></p>
          <Field label="Teacher" htmlFor="line-teacher">
            <select id="line-teacher" className={INPUT_CLASS} value={choice} onChange={(e) => setChoice(e.target.value)}>
              {line.mode !== 'self_study' && teachers.length > 1 && <option value="">No preference (the coordinator assigns)</option>}
              {line.mode !== 'self_study' && teachers.map((t) => <option key={t.id} value={t.id} data-i18n-skip="true">{t.name}{t.mode === 'online' ? ' (online)' : ''}</option>)}
              <option value="self">Self-study (no teacher)</option>
            </select>
          </Field>
          <p className="text-xs text-muted-foreground">
            <span>The price stays</span> <Money amount={line.price} /><span>: a refund or an adjustment is the finance office&apos;s own act.</span>{' '}
            <span>The student&apos;s enrolment follows the new teacher.</span>
          </p>
          <Field label="Reason" htmlFor="line-teacher-reason">
            <textarea id="line-teacher-reason" className={TEXTAREA_CLASS} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. The family asked at the desk" />
          </Field>
          <ErrorLine message={failure} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button disabled={reason.trim().length < 5 || m.isPending} onClick={() => { setFailure(null); m.mutate(); }}>Save</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
