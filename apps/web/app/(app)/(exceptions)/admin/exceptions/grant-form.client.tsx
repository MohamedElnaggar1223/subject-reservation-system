'use client';

/**
 * Grant an exception (RESERVATIONS_REWORK.md §4.7): the student or the family → the policy
 * (grouped) → the scope, narrowed to what the policy accepts → the value its policy takes → the
 * sentence it will apply → a reason → grant. The API checks everything again (the registry's
 * grantors, bounds and scopes); this form only offers what the registry says is possible.
 *
 * The desk's version of the task in the school's sheet is a note beside the family's row that
 * someone must remember when the next payment comes; here the rule is applied by every hook that
 * reads it, and the sentence says what it will do before it is granted.
 */

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, policySentence, type PolicyScope, type RegistryPolicyKey } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Notice } from '~/components/ui/tone';
import { Field, INPUT_CLASS, Money, fetchSessions, SESSIONS_KEY } from '~/app/(app)/(sessions)/admin/sessions/sessions-shared';
import {
  fetchStudents, fetchStudent, fetchSummary, fetchCharges, fetchOffersFor, fetchSubjects, fetchSeries,
  EXCEPTIONS_KEY, WHY_NOT, type PoliciesData, type PolicyRow,
} from './exceptions-shared';

type ScopeField = 'sessionId' | 'subjectId' | 'offerId' | 'offerItemId' | 'registrationId' | 'chargeId' | 'boardSeriesId' | 'academicYear';
const FIELD: Record<PolicyScope, ScopeField> = {
  session: 'sessionId', subject: 'subjectId', offer: 'offerId', item: 'offerItemId', line: 'registrationId',
  charge: 'chargeId', boardSeries: 'boardSeriesId', academicYear: 'academicYear',
};
type Row = { dueAt: string; amount: string };

const grantException = (json: Parameters<typeof api.v1.exceptions.$post>[0]['json']) => apiResponse(api.v1.exceptions.$post({ json }));
type Granted = Awaited<ReturnType<typeof grantException>>;

export function GrantForm({ data, viewerRole, prefill = {} }: { data: PoliciesData; viewerRole: string | null; prefill?: { studentId?: string; registrationId?: string; policyKey?: string } }): React.JSX.Element {
  const queryClient = useQueryClient();
  // The finance desk and the admin read the Student 360 (the family, the lines); a coordinator
  // grants the academic gates, which are never narrowed to a line or a charge.
  const readsFamilies = viewerRole === 'admin' || viewerRole === 'finance_admin' || viewerRole === 'finance_officer';
  // Opened from a line: the first policy this role may grant on one line; else the first grantable.
  const firstGrantable = (prefill.policyKey && data.policies.find((p) => p.key === prefill.policyKey && p.grantable)?.key)
    ?? (prefill.registrationId && data.policies.find((p) => p.grantable && p.scopes.includes('line'))?.key)
    ?? data.policies.find((p) => p.grantable)?.key ?? '';
  const [search, setSearch] = useState('');
  const [studentId, setStudentId] = useState(prefill.studentId ?? '');
  const [holder, setHolder] = useState<'student' | 'family'>('student');
  const [familyId, setFamilyId] = useState('');
  const [policyKey, setPolicyKey] = useState<string>(firstGrantable);
  const [scope, setScope] = useState<Partial<Record<ScopeField, string>>>(prefill.registrationId ? { registrationId: prefill.registrationId } : {});
  const [browseSession, setBrowseSession] = useState('');
  const [value, setValue] = useState('');
  const [rows, setRows] = useState<Row[]>([{ dueAt: '', amount: '' }, { dueAt: '', amount: '' }]);
  const [validUntil, setValidUntil] = useState('');
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState('');
  const [granted, setGranted] = useState<Granted | null>(null);

  const policy: PolicyRow | undefined = data.policies.find((p) => p.key === policyKey);
  const accepts = new Set<PolicyScope>((policy?.scopes ?? []) as PolicyScope[]);
  const needsOffers = accepts.has('offer') || accepts.has('item');

  const students = useQuery({ queryKey: ['students', 'pick', search], queryFn: () => fetchStudents(search) });
  // A student chosen before the form opened: find them in the picker by name.
  const preset = useQuery({ queryKey: ['students', prefill.studentId], queryFn: () => fetchStudent(prefill.studentId!), enabled: !!prefill.studentId });
  useEffect(() => { if (preset.data) setSearch(preset.data.student.name); }, [preset.data]);
  const summary = useQuery({ queryKey: ['users', studentId, 'summary'], queryFn: () => fetchSummary(studentId), enabled: !!studentId && readsFamilies });
  const sessions = useQuery({ queryKey: SESSIONS_KEY, queryFn: fetchSessions, enabled: accepts.has('session') || needsOffers });
  const subjects = useQuery({ queryKey: ['subjects', 'pick'], queryFn: fetchSubjects, enabled: accepts.has('subject') });
  const series = useQuery({ queryKey: ['board-series', 'pick'], queryFn: fetchSeries, enabled: accepts.has('boardSeries') });
  const charges = useQuery({ queryKey: ['charges', studentId], queryFn: () => fetchCharges(studentId), enabled: !!studentId && accepts.has('charge') });
  // The subjects in a session, for an offer or item scope: the session the scope names, or one
  // picked only to find them.
  const offerSession = scope.sessionId || browseSession;
  const offers = useQuery({
    queryKey: ['registrations', 'offers', studentId, offerSession],
    queryFn: () => fetchOffersFor(studentId, offerSession),
    enabled: !!studentId && !!offerSession && needsOffers,
  });

  const parents = (summary.data?.parents ?? []).filter((p) => p.linkStatus === 'approved');
  const lines = (summary.data?.registrations ?? []).filter((r) => !['expired', 'rejected', 'dropped'].includes(r.status));
  const student = students.data?.students.find((s) => s.id === studentId);
  const offer = offers.data?.offers.find((o) => o.id === scope.offerId);
  const line = lines.find((l) => l.id === scope.registrationId);

  const grouped = useMemo(() => data.groups.map((g) => ({ ...g, policies: data.policies.filter((p) => p.group === g.id) })), [data]);

  const setScopeField = (f: ScopeField, v: string) => setScope((s) => {
    const next = { ...s, [f]: v || undefined };
    if (f === 'sessionId' || f === 'offerId') delete next.offerItemId;
    if (f === 'sessionId') delete next.offerId;
    return next;
  });
  const pickPolicy = (key: string) => {
    setPolicyKey(key);
    const accepts = data.policies.find((p) => p.key === key)?.scopes ?? [];
    setScope(prefill.registrationId && accepts.includes('line') ? { registrationId: prefill.registrationId } : {});
    setValue('');
    setGranted(null);
    setFormError('');
  };

  // The sentence, as the registry words it.
  const whoWords = holder === 'family'
    ? `the family of ${parents.find((p) => p.id === familyId)?.name ?? '…'}`
    : student?.name ?? '…';
  const scopeWords = [
    scope.sessionId && sessions.data?.find((x) => x.id === scope.sessionId)?.name,
    scope.subjectId && subjects.data?.find((x) => x.id === scope.subjectId)?.name,
    scope.offerId && offer?.subject.name,
    scope.offerItemId && offer?.items.find((i) => i.id === scope.offerItemId)?.label,
    line && `${line.subject?.name ?? ''} · ${line.session?.name ?? ''}`,
    scope.chargeId && charges.data?.find((c) => c.id === scope.chargeId)?.description,
    scope.boardSeriesId && seriesLabel(series.data?.find((x) => x.id === scope.boardSeriesId)),
    scope.academicYear,
  ].filter(Boolean).join(' · ') || null;
  const scheduleTotal = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const valueWords = policy?.valueType === 'schedule'
    ? `${rows.filter((r) => r.dueAt && r.amount).length} instalments`
    : value || null;
  const worded = policy ? policySentence(policy.key as RegistryPolicyKey, { who: whoWords, value: valueWords, scope: scopeWords }) : '';
  const sentence = worded.charAt(0).toUpperCase() + worded.slice(1);

  const grant = useMutation({
    mutationFn: () => {
      const cleanScope = Object.fromEntries(Object.entries(scope).filter(([, v]) => !!v));
      const out = policy!.valueType === 'none' ? null
        : policy!.valueType === 'schedule' ? rows.filter((r) => r.dueAt && r.amount).map((r) => ({ dueAt: new Date(`${r.dueAt}T12:00:00Z`), amount: Number(r.amount) }))
          : policy!.valueType === 'date' ? value
            : Number(value);
      return grantException({
        policyKey: policy!.key,
        ...(holder === 'family' ? { familyId } : { studentId }),
        scope: cleanScope,
        value: out,
        // The end of that day at the school (never the next day in Cairo).
        validUntil: validUntil ? new Date(`${validUntil}T20:59:59Z`) : null,
        reason: reason.trim(),
      });
    },
    onSuccess: (r) => {
      setGranted(r);
      setFormError('');
      setReason('');
      setValue('');
      queryClient.invalidateQueries({ queryKey: EXCEPTIONS_KEY });
      queryClient.invalidateQueries({ queryKey: ['users', studentId, 'summary'] });
    },
    onError: (err: Error) => setFormError(err.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setGranted(null);
    if (!policy) return setFormError('Pick a policy.');
    if (!studentId) return setFormError('Pick a student.');
    if (holder === 'family' && !familyId) return setFormError('Pick the family\'s parent account.');
    if (policy.nullScope === null && !Object.values(scope).some(Boolean)) return setFormError('This policy needs a scope: choose what it is for.');
    if ((policy.valueType === 'percent' || policy.valueType === 'amount') && !(Number(value) >= 0 && value !== '')) return setFormError('This policy needs a value.');
    if (policy.valueType === 'date' && !value) return setFormError('This policy needs a date.');
    if (policy.valueType === 'schedule' && rows.filter((r) => r.dueAt && r.amount).length < 1) return setFormError('Add the instalments: a date and an amount each.');
    if (reason.trim().length < 3) return setFormError('A reason is required.');
    grant.mutate();
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <h2 className="font-display text-base font-semibold text-foreground">Grant an exception</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {/* 1. Who */}
        <Field label="Student" htmlFor="exc-student-search">
          <input id="exc-student-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, email or number…" className={INPUT_CLASS} />
          <select id="exc-student" aria-label="Student" value={studentId} onChange={(e) => { setStudentId(e.target.value); setFamilyId(''); setHolder('student'); setScope({}); }} className={`${INPUT_CLASS} mt-2`}>
            <option value="">{students.isError ? 'Could not load students' : 'Pick a student…'}</option>
            {(students.data?.students ?? []).map((s) => (
              <option key={s.id} value={s.id}>{`${s.name}${s.gradeLabel ? ` (${s.gradeLabel})` : ''}`}</option>
            ))}
          </select>
        </Field>
        <Field label="For" hint={holder === 'family' ? 'A family\'s exception covers every child linked to that parent account, now and later.' : undefined}>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="For">
            <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <input type="radio" name="exc-holder" checked={holder === 'student'} onChange={() => setHolder('student')} />
              <span>This student</span>
            </label>
            <label className={`flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm ${!readsFamilies || !parents.length || policy?.key === 'plan.instalments' ? 'opacity-50' : ''}`}>
              <input type="radio" name="exc-holder" checked={holder === 'family'} disabled={!readsFamilies || !parents.length || policy?.key === 'plan.instalments'}
                onChange={() => { setHolder('family'); setFamilyId(parents[0]?.id ?? ''); }} />
              <span>The whole family</span>
            </label>
            {holder === 'family' && parents.length > 1 && (
              <select aria-label="Parent account" value={familyId} onChange={(e) => setFamilyId(e.target.value)} className={INPUT_CLASS}>
                {parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
          </div>
        </Field>

        {/* 2. The policy, grouped */}
        <Field label="Policy" htmlFor="exc-policy">
          <select id="exc-policy" value={policyKey} onChange={(e) => pickPolicy(e.target.value)} className={INPUT_CLASS}>
            {grouped.map((g) => (
              <optgroup key={g.id} label={g.label}>
                {g.policies.map((p) => (
                  <option key={p.key} value={p.key} disabled={!p.grantable}>
                    {p.grantable ? p.label : `${p.label} — ${WHY_NOT[p.whyNot ?? ''] ?? ''}`}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>

        {/* 4. The value its policy takes */}
        {policy && (policy.valueType === 'percent' || policy.valueType === 'amount') && (
          <Field label={policy.valueType === 'percent' ? 'Value (%)' : 'Value (EGP)'} htmlFor="exc-value">
            <input id="exc-value" type="number" inputMode="decimal" min={policy.min ?? 0} max={policy.max ?? undefined} step="0.01" value={value} onChange={(e) => setValue(e.target.value)} className={INPUT_CLASS} />
          </Field>
        )}
        {policy?.valueType === 'date' && (
          <Field label="Date" htmlFor="exc-date">
            <input id="exc-date" type="date" value={value} onChange={(e) => setValue(e.target.value)} className={INPUT_CLASS} />
          </Field>
        )}
      </div>

      {/* 3. The scope, narrowed to what the policy accepts */}
      {policy && (
        <fieldset className="mt-5 rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-medium text-foreground">Scope</legend>
          <p className="mb-3 text-xs text-muted-foreground">
            {policy.nullScope === null
              ? <span>Required: choose what it is for.</span>
              : <><span>Leave it empty for</span> <span>{policy.nullScope}</span><span>.</span></>}
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {accepts.has('session') && (
              <Field label={data.scopeLabels.session} htmlFor="exc-scope-session">
                <select id="exc-scope-session" value={scope.sessionId ?? ''} onChange={(e) => setScopeField('sessionId', e.target.value)} className={INPUT_CLASS}>
                  <option value="">Any</option>
                  {(sessions.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </Field>
            )}
            {needsOffers && !accepts.has('session') && (
              <Field label="In session" htmlFor="exc-browse-session" hint="Only to find the subject; the exception is not narrowed to the session.">
                <select id="exc-browse-session" value={browseSession} onChange={(e) => { setBrowseSession(e.target.value); setScopeField('offerId', ''); }} className={INPUT_CLASS}>
                  <option value="">Pick a session…</option>
                  {(sessions.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </Field>
            )}
            {accepts.has('subject') && (
              <Field label={data.scopeLabels.subject} htmlFor="exc-scope-subject">
                <select id="exc-scope-subject" value={scope.subjectId ?? ''} onChange={(e) => setScopeField('subjectId', e.target.value)} className={INPUT_CLASS}>
                  <option value="">Any</option>
                  {(subjects.data ?? []).map((x) => <option key={x.id} value={x.id}>{`${x.name} (${x.code})`}</option>)}
                </select>
              </Field>
            )}
            {needsOffers && (
              <Field label={data.scopeLabels.offer} htmlFor="exc-scope-offer" hint={!studentId ? 'Pick the student first.' : !offerSession ? 'Pick the session first.' : undefined}>
                <select id="exc-scope-offer" value={scope.offerId ?? ''} disabled={!offers.data} onChange={(e) => setScopeField('offerId', e.target.value)} className={INPUT_CLASS}>
                  <option value="">{accepts.has('offer') ? 'Any' : 'Pick the subject…'}</option>
                  {(offers.data?.offers ?? []).map((o) => <option key={o.id} value={o.id}>{o.subject.name}</option>)}
                </select>
              </Field>
            )}
            {accepts.has('item') && (
              <Field label={data.scopeLabels.item} htmlFor="exc-scope-item">
                <select id="exc-scope-item" value={scope.offerItemId ?? ''} disabled={!offer} onChange={(e) => setScopeField('offerItemId', e.target.value)} className={INPUT_CLASS}>
                  <option value="">Any</option>
                  {(offer?.items ?? []).map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
                </select>
              </Field>
            )}
            {accepts.has('line') && (
              <Field label={data.scopeLabels.line} htmlFor="exc-scope-line" hint={!readsFamilies ? 'The finance desk picks a line.' : !studentId ? 'Pick the student first.' : undefined}>
                <select id="exc-scope-line" value={scope.registrationId ?? ''} disabled={!summary.data} onChange={(e) => setScopeField('registrationId', e.target.value)} className={INPUT_CLASS}>
                  <option value="">{policy.nullScope === null && accepts.size === 1 ? 'Pick a line…' : 'Any'}</option>
                  {lines.map((l) => <option key={l.id} value={l.id}>{`${l.subject?.name ?? '—'} · ${l.session?.name ?? ''} · EGP ${l.priceAtRegistration}`}</option>)}
                </select>
              </Field>
            )}
            {accepts.has('charge') && (
              <Field label={data.scopeLabels.charge} htmlFor="exc-scope-charge">
                <select id="exc-scope-charge" value={scope.chargeId ?? ''} disabled={!charges.data} onChange={(e) => setScopeField('chargeId', e.target.value)} className={INPUT_CLASS}>
                  <option value="">Any</option>
                  {(charges.data ?? []).filter((c) => c.status === 'requested' || c.status === 'pending_payment')
                    .map((c) => <option key={c.id} value={c.id}>{`${c.description} · EGP ${c.amount}`}</option>)}
                </select>
              </Field>
            )}
            {accepts.has('boardSeries') && (
              <Field label={data.scopeLabels.boardSeries} htmlFor="exc-scope-series">
                <select id="exc-scope-series" value={scope.boardSeriesId ?? ''} onChange={(e) => setScopeField('boardSeriesId', e.target.value)} className={INPUT_CLASS}>
                  <option value="">{policy.nullScope === null ? 'Pick a series…' : 'Any'}</option>
                  {(series.data ?? []).map((x) => <option key={x.id} value={x.id}>{seriesLabel(x)}</option>)}
                </select>
              </Field>
            )}
            {accepts.has('academicYear') && (
              <Field label={data.scopeLabels.academicYear} htmlFor="exc-scope-year" hint="As 2026-2027.">
                <input id="exc-scope-year" value={scope.academicYear ?? ''} onChange={(e) => setScopeField('academicYear', e.target.value.trim())} placeholder="2026-2027" dir="ltr" className={INPUT_CLASS} />
              </Field>
            )}
          </div>
        </fieldset>
      )}

      {/* A plan's schedule */}
      {policy?.valueType === 'schedule' && (
        <fieldset className="mt-5 rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-medium text-foreground">Instalments</legend>
          <p className="mb-3 text-xs text-muted-foreground">
            <span>They add up to the line's price</span>
            {line && <> (<Money amount={line.priceAtRegistration} />)</>}
            <span>; each is paid into the held wallet, and the line is paid from them at the last. The last date is at the latest the session's end or the line's deadline, whichever is earlier.</span>
          </p>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <span className="w-6 text-sm text-muted-foreground tabular-nums">{i + 1}</span>
                <input type="date" aria-label="Due" value={r.dueAt} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, dueAt: e.target.value } : x)))} className={`${INPUT_CLASS} max-w-44`} />
                <input type="number" aria-label="Amount (EGP)" inputMode="decimal" min="0" step="0.01" value={r.amount} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} className={`${INPUT_CLASS} max-w-36`} />
                {rows.length > 1 && <Button type="button" variant="ghost" size="sm" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</Button>}
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between text-sm">
            <Button type="button" variant="outline" size="sm" onClick={() => setRows([...rows, { dueAt: '', amount: '' }])}>Add an instalment</Button>
            <span><span>Total</span> <Money amount={scheduleTotal} /></span>
          </div>
        </fieldset>
      )}

      <div className="mt-5 grid gap-4 md:grid-cols-[1fr_14rem]">
        <Field label="Reason" htmlFor="exc-reason">
          <input id="exc-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why, and who agreed it" className={INPUT_CLASS} />
        </Field>
        <Field label="Valid until (optional)" htmlFor="exc-until">
          <input id="exc-until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className={INPUT_CLASS} />
        </Field>
      </div>

      {/* 5. The sentence */}
      {policy && (
        <div className="mt-5 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">It will apply as</p>
          <p className="mt-1 text-foreground">{sentence}</p>
          {policy.oneShot && <p className="mt-1 text-xs text-muted-foreground">Used up by the first reservation it lets through.</p>}
        </div>
      )}

      {formError && <Notice tone="danger" className="mt-4">{formError}</Notice>}
      {granted && (
        <Notice tone="success" className="mt-4" title="Granted">
          {granted.repriced && <p><span>The price is now</span> <Money amount={granted.repriced.to} /> (<span>was</span> <Money amount={granted.repriced.from} />).</p>}
          {granted.dueDatesMoved > 0 && <p><span>{granted.dueDatesMoved}</span> <span>due dates moved.</span></p>}
          {granted.pushesCancelled > 0 && <p><span>{granted.pushesCancelled}</span> <span>pushed school fees cancelled.</span></p>}
          {granted.plan && <p>The instalments are on the family's statement.</p>}
        </Notice>
      )}
      <div className="mt-4 flex justify-end">
        <Button type="submit" disabled={grant.isPending || !policy?.grantable}>{grant.isPending ? 'Granting…' : 'Grant'}</Button>
      </div>
    </form>
  );
}

function seriesLabel(s: { boardCode: string; month: string; year: number; label: string } | undefined): string {
  if (!s) return '';
  return `${s.boardCode} ${s.month} ${s.year}${s.label ? ` (${s.label})` : ''}`;
}
