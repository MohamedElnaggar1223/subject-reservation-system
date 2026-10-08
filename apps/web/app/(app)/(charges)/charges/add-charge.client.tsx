'use client';

/**
 * Add a charge (§3.6): a board service the family asked for at the desk (its fee from the series'
 * grid), a price adjustment on a line after a fee change or a verification, or another charge —
 * with a reason. The API refuses what the registry and the setting do not allow (a late entry fee
 * while late entries are off; an adjustment or other charge from anyone but finance).
 */

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, CREATABLE_CHARGE_KINDS, SERVICE_CHARGE_KINDS, SERVICE_LEVELS, SERVICE_LEVEL_LABELS, type ServiceLevel } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Notice } from '~/components/ui/tone';
import { Field, INPUT_CLASS, Modal } from '~/app/(app)/(sessions)/admin/sessions/sessions-shared';
import { fetchStudents, fetchSummary, fetchSeries } from '~/app/(app)/(exceptions)/admin/exceptions/exceptions-shared';
import { kindLabel } from './charges-shared';
import { MONTH_LABEL } from '~/app/(app)/exams/exams-shared';

type Kind = (typeof CREATABLE_CHARGE_KINDS)[number];
const fetchServices = () => apiResponse(api.v1['board-services'].$get({ query: {} }));
const createRoute = api.v1.charges;
const createCharge = (json: Parameters<typeof createRoute.$post>[0]['json']) => apiResponse(createRoute.$post({ json }));

export function AddChargeModal({ viewerRole, onClose, onAdded }: { viewerRole: string | null; onClose: () => void; onAdded: () => void }) {
  const financeAdmin = viewerRole === 'finance_admin' || viewerRole === 'admin';
  const kinds = CREATABLE_CHARGE_KINDS.filter((k) => financeAdmin || (k !== 'price_adjustment' && k !== 'custom'));
  const [search, setSearch] = useState('');
  const [studentId, setStudentId] = useState('');
  const [kind, setKind] = useState<Kind>(kinds.includes('custom') ? 'custom' : kinds[0]!);
  const [serviceId, setServiceId] = useState('');
  const [seriesId, setSeriesId] = useState('');
  const [level, setLevel] = useState<ServiceLevel>('igcse');
  const [lineId, setLineId] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const isService = (SERVICE_CHARGE_KINDS as readonly string[]).includes(kind);

  const students = useQuery({ queryKey: ['students', 'pick', search], queryFn: () => fetchStudents(search) });
  const summary = useQuery({ queryKey: ['users', studentId, 'summary'], queryFn: () => fetchSummary(studentId), enabled: !!studentId });
  const services = useQuery({ queryKey: ['board-services'], queryFn: fetchServices, enabled: isService });
  const series = useQuery({ queryKey: ['board-series', 'pick'], queryFn: fetchSeries, enabled: isService || kind === 'late_entry_fee' });
  const service = services.data?.find((s) => s.id === serviceId);
  const lines = (summary.data?.registrations ?? []).filter((r) => !['expired', 'rejected', 'dropped'].includes(r.status));

  const add = useMutation({
    mutationFn: () => createCharge({
      studentId, kind,
      ...(isService ? { boardServiceId: serviceId, boardSeriesId: seriesId, ...(service?.levelRates ? { level } : {}) } : {}),
      ...(kind === 'late_entry_fee' && seriesId ? { boardSeriesId: seriesId } : {}),
      ...(lineId ? { registrationId: lineId } : {}),
      ...(amount && !isService ? { amount: Number(amount) } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(dueAt ? { dueAt: new Date(`${dueAt}T20:59:59Z`) } : {}),
      reason: reason.trim(),
    }),
    onSuccess: onAdded,
    onError: (err: Error) => setError(err.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!studentId) return setError('Pick a student.');
    if (isService && (!serviceId || !seriesId)) return setError('Choose the board service and the series it is for.');
    if (kind === 'price_adjustment' && !lineId) return setError('A price adjustment names the line it adjusts.');
    if ((kind === 'price_adjustment' || kind === 'custom') && !amount) return setError('Say how much it is.');
    if (reason.trim().length < 3) return setError('A reason is required.');
    setError('');
    add.mutate();
  }

  return (
    <Modal title="Add a charge" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Student" htmlFor="charge-student-search">
            <input id="charge-student-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, email or number…" className={INPUT_CLASS} />
            <select id="charge-student" aria-label="Student" value={studentId} onChange={(e) => { setStudentId(e.target.value); setLineId(''); }} className={`${INPUT_CLASS} mt-2`}>
              <option value="">Pick a student…</option>
              {(students.data?.students ?? []).map((s) => <option key={s.id} value={s.id}>{`${s.name}${s.gradeLabel ? ` (${s.gradeLabel})` : ''}`}</option>)}
            </select>
          </Field>
          <Field label="Kind" htmlFor="charge-kind">
            <select id="charge-kind" value={kind} onChange={(e) => { setKind(e.target.value as Kind); setServiceId(''); setSeriesId(''); }} className={INPUT_CLASS}>
              {kinds.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
            </select>
          </Field>
          {isService && (
            <>
              <Field label="Board service" htmlFor="charge-service">
                <select id="charge-service" value={serviceId} onChange={(e) => { setServiceId(e.target.value); setSeriesId(''); }} className={INPUT_CLASS}>
                  <option value="">Pick a service…</option>
                  {(services.data ?? []).filter((s) => s.kind === kind && s.isActive).map((s) => <option key={s.id} value={s.id}>{`${s.boardName} — ${s.label}`}</option>)}
                </select>
              </Field>
              <Field label="Board series" htmlFor="charge-series">
                <select id="charge-series" value={seriesId} disabled={!service} onChange={(e) => setSeriesId(e.target.value)} className={INPUT_CLASS}>
                  <option value="">Pick a series…</option>
                  {(series.data ?? []).filter((s) => s.boardCode === service?.boardCode).map((s) => <option key={s.id} value={s.id}>{`${MONTH_LABEL[s.month] ?? s.month} ${s.year}${s.label ? ` (${s.label})` : ''}`}</option>)}
                </select>
              </Field>
              {service?.levelRates && (
                <Field label="Level" htmlFor="charge-level">
                  <select id="charge-level" value={level} onChange={(e) => setLevel(e.target.value as ServiceLevel)} className={INPUT_CLASS}>
                    {SERVICE_LEVELS.map((l) => <option key={l} value={l}>{SERVICE_LEVEL_LABELS[l]}</option>)}
                  </select>
                </Field>
              )}
            </>
          )}
          {kind === 'late_entry_fee' && (
            <Field label="Board series" htmlFor="charge-late-series">
              <select id="charge-late-series" value={seriesId} onChange={(e) => setSeriesId(e.target.value)} className={INPUT_CLASS}>
                <option value="">Pick a series…</option>
                {(series.data ?? []).map((s) => <option key={s.id} value={s.id}>{`${s.boardCode} ${MONTH_LABEL[s.month] ?? s.month} ${s.year}${s.label ? ` (${s.label})` : ''}`}</option>)}
              </select>
            </Field>
          )}
          {(kind === 'price_adjustment' || isService) && (
            <Field label={kind === 'price_adjustment' ? 'The line it adjusts' : 'For a line (optional)'} htmlFor="charge-line">
              <select id="charge-line" value={lineId} disabled={!summary.data} onChange={(e) => setLineId(e.target.value)} className={INPUT_CLASS}>
                <option value="">{kind === 'price_adjustment' ? 'Pick a line…' : 'None'}</option>
                {lines.map((l) => <option key={l.id} value={l.id}>{`${l.subject?.name ?? '—'} · ${l.session?.name ?? ''}`}</option>)}
              </select>
            </Field>
          )}
          {isService ? (
            <Field label="Amount">
              <p className="py-2 text-sm text-muted-foreground">The series&apos; fee for the service (Board services).</p>
            </Field>
          ) : (
            <Field label="Amount (EGP)" htmlFor="charge-amount">
              <input id="charge-amount" type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={INPUT_CLASS} />
            </Field>
          )}
          <Field label="Due by (optional)" htmlFor="charge-due">
            <input id="charge-due" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className={INPUT_CLASS} />
          </Field>
          <Field label="Description (optional)" htmlFor="charge-description">
            <input id="charge-description" value={description} onChange={(e) => setDescription(e.target.value)} className={INPUT_CLASS} />
          </Field>
        </div>
        <Field label="Reason" htmlFor="charge-reason">
          <input id="charge-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why, and who asked" className={INPUT_CLASS} />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Close</Button>
          <Button type="submit" disabled={add.isPending}>{add.isPending ? 'Adding…' : 'Add the charge'}</Button>
        </div>
      </form>
    </Modal>
  );
}
