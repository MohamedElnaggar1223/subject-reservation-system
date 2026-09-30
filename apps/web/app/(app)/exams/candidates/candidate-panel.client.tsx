'use client';

/**
 * One candidate, opened in place on the candidate register (FEATURES_PLAN.md
 * F4, "Candidates"; docs/features/EXAM_ENTRIES.md §1 and §6, the national ID).
 *
 * The spreadsheet version: the candidate's row, twenty columns wide, with the
 * passport photocopy in a folder, the UCI on last year's statement of entry,
 * the access-arrangement approval in someone's inbox and the ID number in a
 * cell anyone with the file can read; a mistyped UCI is overwritten with no
 * trace, and nothing stops two candidates sharing a number.
 *
 * Here: the fields the boards ask for on one form, saved in one click, and the
 * answer names what was saved. A recorded UCI is permanent: changing it asks
 * why, and the reason is audited. The ID document shows its type and last four
 * characters; "Show number" shows the rest for 30 seconds and says the look is
 * recorded. Every candidate number the candidate has had, per series, with how
 * it came and their entries there; one can be set by hand (a number the board
 * issued), and changing one asks why.
 */

import Link from 'next/link';
import type { Route } from 'next';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import {
  apiResponse, schoolDateString, ACCESS_ARRANGEMENTS, ACCESS_ARRANGEMENT_LABELS, GENDERS, GENDER_LABELS, ID_DOCUMENT_TYPES,
  ID_DOCUMENT_TYPE_LABELS, SetCandidateIdentity, SetCandidateNumber, UpdateCandidate,
  type AccessArrangement, type IdDocumentType, type SetCandidateIdentityType, type SetCandidateNumberType, type UpdateCandidateType,
} from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { Badge, Notice } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { DateText } from '../../academic/calendar/academic-shared';
import { SELECT_CLASS } from '../exams-shared';
import {
  EXAMS_KEY, fetchCandidate, Code, EntryStatusBadge,
  type BoardSeriesRow, type CandidateDetail, type CandidateRow,
} from '../exam-f4-shared';
import { SeriesWords } from './series-words';

const fetchIdentity = (studentId: string) => apiResponse(api.v1.exams.candidates[':studentId'].identity.$get({ param: { studentId } }));
type Identity = Awaited<ReturnType<typeof fetchIdentity>>;
const saveIdentity = (studentId: string, json: SetCandidateIdentityType) =>
  apiResponse(api.v1.exams.candidates[':studentId'].identity.$put({ param: { studentId }, json }));
type IdentitySaved = Awaited<ReturnType<typeof saveIdentity>>;
const saveNumber = (json: SetCandidateNumberType) => apiResponse(api.v1.exams['candidate-numbers'].$put({ json }));

const REVEAL_SECONDS = 30;
const MONTH_ORDER: Record<string, number> = { january: 1, june: 6, october: 10, november: 11 };
const SOURCE_LABELS: Record<string, string> = { assigned: 'Assigned by the school', manual: 'Set by hand', import: 'Imported' };
const TEXTAREA_CLASS =
  'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

export function CandidatePanel({
  studentId, row, series, chosenSeriesId, onClose,
}: {
  studentId: string; row: CandidateRow | null; series: BoardSeriesRow[]; chosenSeriesId: string | null; onClose: () => void;
}): React.JSX.Element {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [...EXAMS_KEY, 'candidate', studentId],
    queryFn: () => fetchCandidate(studentId),
  });

  if (isLoading) return <LoadingState label="Loading the candidate…" />;
  if (isError || !data) {
    return (
      <ErrorState
        title="The candidate did not load"
        message={error instanceof Error ? error.message : 'This is a connection problem. Try again.'}
        onRetry={() => refetch()}
      />
    );
  }
  const s = data.student;
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm" aria-label={s.name}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-foreground"><bdi data-i18n-skip="true">{s.name}</bdi></h2>
          <p className="text-xs text-muted-foreground">
            {s.studentCode && <Code>{s.studentCode}</Code>}
            {s.grade !== null && <> · <span>{`Grade ${s.grade}`}</span></>}
            {s.email && <> · <bdi data-i18n-skip="true" dir="ltr">{s.email}</bdi></>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/exams/entries?student=${studentId}` as Route}>See entries</Link>
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <DetailsForm studentId={studentId} detail={data} uciNeeded={!!row?.missing.includes('uci') || !!row?.uciNeeded} />
        <div className="space-y-4">
          <IdDocument studentId={studentId} idDocument={data.idDocument} />
          <Numbers studentId={studentId} detail={data} series={series} chosenSeriesId={chosenSeriesId} />
        </div>
      </div>
    </section>
  );
}

// ─── The details the boards ask for ──────────────────────────────────────────

type Form = {
  legalForenames: string; legalSurname: string; dateOfBirth: string; gender: string; uci: string;
  accessArrangements: AccessArrangement[]; accessArrangementsRef: string; accessArrangementsUntil: string; notes: string;
};

const FIELD_LABELS: Record<keyof Form, string> = {
  legalForenames: 'Forenames (as on the ID)',
  legalSurname: 'Surname (as on the ID)',
  dateOfBirth: 'Date of birth',
  gender: 'Gender',
  uci: 'UCI (Pearson)',
  accessArrangements: 'Access arrangements',
  accessArrangementsRef: "Board's approval reference",
  accessArrangementsUntil: 'Approval expires',
  notes: 'Notes',
};

function toForm(c: CandidateDetail['candidate']): Form {
  return {
    legalForenames: c?.legalForenames ?? '',
    legalSurname: c?.legalSurname ?? '',
    dateOfBirth: c?.dateOfBirth ?? '',
    gender: c?.gender ?? '',
    uci: c?.uci ?? '',
    accessArrangements: (c?.accessArrangements ?? []).filter((a): a is AccessArrangement => (ACCESS_ARRANGEMENTS as readonly string[]).includes(a)),
    accessArrangementsRef: c?.accessArrangementsRef ?? '',
    accessArrangementsUntil: c?.accessArrangementsUntil ?? '',
    notes: c?.notes ?? '',
  };
}

const text = (v: string) => v.trim() || null;
const uciOf = (v: string) => v.toUpperCase().replace(/\s+/g, '') || null;
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** What changed between the saved values and the form, as the API takes it. */
function changes(form: Form, base: Form): { json: UpdateCandidateType; changed: (keyof Form)[] } {
  const json: UpdateCandidateType = {};
  const changed: (keyof Form)[] = [];
  for (const k of ['legalForenames', 'legalSurname', 'accessArrangementsRef', 'notes'] as const) {
    if (text(form[k]) !== text(base[k])) { json[k] = text(form[k]); changed.push(k); }
  }
  if ((form.dateOfBirth || null) !== (base.dateOfBirth || null)) { json.dateOfBirth = form.dateOfBirth || null; changed.push('dateOfBirth'); }
  if ((form.accessArrangementsUntil || null) !== (base.accessArrangementsUntil || null)) {
    json.accessArrangementsUntil = form.accessArrangementsUntil || null;
    changed.push('accessArrangementsUntil');
  }
  if ((form.gender || null) !== (base.gender || null)) { json.gender = (GENDERS as readonly string[]).includes(form.gender) ? (form.gender as (typeof GENDERS)[number]) : null; changed.push('gender'); }
  if (uciOf(form.uci) !== uciOf(base.uci)) { json.uci = uciOf(form.uci); changed.push('uci'); }
  if (!sameSet(form.accessArrangements, base.accessArrangements)) { json.accessArrangements = form.accessArrangements; changed.push('accessArrangements'); }
  return { json, changed };
}

function DetailsForm({ studentId, detail, uciNeeded }: { studentId: string; detail: CandidateDetail; uciNeeded: boolean }) {
  const queryClient = useQueryClient();
  const [base, setBase] = useState<Form>(() => toForm(detail.candidate));
  const [form, setForm] = useState<Form>(base);
  const [uciReason, setUciReason] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<(keyof Form)[] | null>(null);
  const today = schoolDateString(new Date());
  const recordedUci = uciOf(base.uci);
  const uciCorrected = !!recordedUci && uciOf(form.uci) !== recordedUci;
  const pending = changes(form, base);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(null);
    setError('');
  };

  const save = useMutation({
    mutationFn: (json: UpdateCandidateType) => apiResponse(api.v1.exams.candidates[':studentId'].$put({ param: { studentId }, json })),
    onSuccess: (row) => {
      const next = toForm(row);
      setSaved(pending.changed);
      setBase(next);
      setForm(next);
      setUciReason('');
      setError('');
      queryClient.invalidateQueries({ queryKey: EXAMS_KEY });
    },
    onError: (err: Error) => setError(err.message),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pending.changed.length) {
      setSaved([]);
      return;
    }
    if (uciCorrected && uciReason.trim().length < 3) {
      setError('Say why the UCI is being corrected: it is permanent, and the reason is recorded.');
      return;
    }
    const parsed = UpdateCandidate.safeParse({ ...pending.json, ...(uciCorrected ? { uciCorrectionReason: uciReason.trim() } : {}) });
    if (!parsed.success) {
      setError([...new Set(parsed.error.issues.map((i) => i.message))].join(' · '));
      return;
    }
    save.mutate(parsed.data);
  };

  const arrangementsWithoutApproval = form.accessArrangements.length > 0 && !form.accessArrangementsRef.trim();
  const approvalExpired = form.accessArrangements.length > 0 && !!form.accessArrangementsUntil && form.accessArrangementsUntil < today;

  return (
    <form onSubmit={submit} className="space-y-4" aria-label="The candidate's details">
      <fieldset className="rounded-lg border border-border bg-background p-4">
        <legend className="px-1 text-sm font-semibold text-foreground">As on the ID document</legend>
        <p className="mb-3 text-xs text-muted-foreground">Type the name exactly as the passport or national ID writes it, in English letters: the board prints it on the certificate.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor={`forenames-${studentId}`} className="mb-1 text-xs text-muted-foreground">{FIELD_LABELS.legalForenames}</Label>
            <Input id={`forenames-${studentId}`} value={form.legalForenames} onChange={(e) => set('legalForenames', e.target.value)} maxLength={100} autoComplete="off" dir="ltr" />
          </div>
          <div>
            <Label htmlFor={`surname-${studentId}`} className="mb-1 text-xs text-muted-foreground">{FIELD_LABELS.legalSurname}</Label>
            <Input id={`surname-${studentId}`} value={form.legalSurname} onChange={(e) => set('legalSurname', e.target.value)} maxLength={100} autoComplete="off" dir="ltr" />
          </div>
          <div>
            <Label htmlFor={`dob-${studentId}`} className="mb-1 text-xs text-muted-foreground">{FIELD_LABELS.dateOfBirth}</Label>
            <Input id={`dob-${studentId}`} type="date" value={form.dateOfBirth} max={today} onChange={(e) => set('dateOfBirth', e.target.value)} />
          </div>
          <div>
            <Label htmlFor={`gender-${studentId}`} className="mb-1 text-xs text-muted-foreground">{FIELD_LABELS.gender}</Label>
            <select id={`gender-${studentId}`} value={form.gender} onChange={(e) => set('gender', e.target.value)} className={SELECT_CLASS}>
              <option value="">Not recorded</option>
              {GENDERS.map((g) => <option key={g} value={g}>{GENDER_LABELS[g]}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor={`uci-${studentId}`} className="mb-1 text-xs text-muted-foreground">{FIELD_LABELS.uci}</Label>
            <Input
              id={`uci-${studentId}`}
              value={form.uci}
              onChange={(e) => set('uci', e.target.value.toUpperCase())}
              maxLength={20}
              autoComplete="off"
              spellCheck={false}
              dir="ltr"
              className="font-mono"
              aria-invalid={uciNeeded && !uciOf(form.uci) ? true : undefined}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {uciNeeded && !uciOf(form.uci) ? <span className="font-semibold text-foreground">Pearson requires a UCI for this candidate. </span> : null}
              <span>Pearson&apos;s Unique Candidate Identifier: 13 characters, the same for life. Once recorded it is permanent; a correction asks why.</span>
            </p>
          </div>
          {uciCorrected && (
            <div className="sm:col-span-2">
              <Label htmlFor={`uci-reason-${studentId}`} className="mb-1 text-xs text-muted-foreground">Why the UCI is being corrected</Label>
              <Input
                id={`uci-reason-${studentId}`}
                value={uciReason}
                onChange={(e) => { setUciReason(e.target.value); setError(''); }}
                maxLength={500}
                placeholder="e.g. mistyped from last year's statement of entry"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                <span>Recorded now:</span> <Code>{recordedUci}</Code>. <span>The correction and its reason go in the audit log.</span>
              </p>
            </div>
          )}
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-border bg-background p-4">
        <legend className="px-1 text-sm font-semibold text-foreground">Access arrangements</legend>
        <p className="mb-3 text-xs text-muted-foreground">Only what the board has approved. Extra time lengthens every paper on the candidate&apos;s timetable.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {ACCESS_ARRANGEMENTS.map((a) => {
            const on = form.accessArrangements.includes(a);
            return (
              <label key={a} className={cn('flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm', on ? 'border-primary bg-primary/5' : 'border-border')}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => set('accessArrangements', on ? form.accessArrangements.filter((x) => x !== a) : [...form.accessArrangements, a])}
                  className="size-4 accent-primary"
                />
                <span className="text-foreground">{ACCESS_ARRANGEMENT_LABELS[a]}</span>
              </label>
            );
          })}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor={`aa-ref-${studentId}`} className="mb-1 text-xs text-muted-foreground">{FIELD_LABELS.accessArrangementsRef}</Label>
            <Input id={`aa-ref-${studentId}`} value={form.accessArrangementsRef} onChange={(e) => set('accessArrangementsRef', e.target.value)} maxLength={100} dir="ltr" className="font-mono" autoComplete="off" />
          </div>
          <div>
            <Label htmlFor={`aa-until-${studentId}`} className="mb-1 text-xs text-muted-foreground">{FIELD_LABELS.accessArrangementsUntil}</Label>
            <Input id={`aa-until-${studentId}`} type="date" value={form.accessArrangementsUntil} onChange={(e) => set('accessArrangementsUntil', e.target.value)} />
          </div>
        </div>
        {arrangementsWithoutApproval && (
          <Notice tone="warning" className="mt-3">Without the board&apos;s approval reference, the entry list flags these arrangements and the deadlines dashboard counts them as outstanding.</Notice>
        )}
        {approvalExpired && <Notice tone="warning" className="mt-3">The board&apos;s approval has expired: apply for it again and record the new reference.</Notice>}
      </fieldset>

      <div>
        <Label htmlFor={`notes-${studentId}`} className="mb-1 text-xs text-muted-foreground">{FIELD_LABELS.notes}</Label>
        <textarea id={`notes-${studentId}`} rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} maxLength={1000} className={TEXTAREA_CLASS} />
      </div>

      {error && <Notice tone="danger">{error}</Notice>}
      {saved && (
        saved.length ? (
          <Notice tone="success">
            <span className="font-semibold">Saved:</span>
            <span className="mt-1 flex flex-wrap gap-1">{saved.map((k) => <Badge key={k} tone="neutral">{FIELD_LABELS[k]}</Badge>)}</span>
          </Notice>
        ) : (
          <Notice tone="neutral">Nothing had changed, so nothing was saved.</Notice>
        )
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {pending.changed.length > 0 && (
          <span className="text-xs text-muted-foreground">
            <span className="tabular-nums">{pending.changed.length}</span> <span>{pending.changed.length === 1 ? 'change not saved yet' : 'changes not saved yet'}</span>
          </span>
        )}
        <Button type="button" variant="ghost" disabled={save.isPending || !pending.changed.length} onClick={() => { setForm(base); setUciReason(''); setError(''); }}>
          Undo changes
        </Button>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save the details'}</Button>
      </div>
    </form>
  );
}

// ─── The ID document ─────────────────────────────────────────────────────────

function IdDocument({ studentId, idDocument }: { studentId: string; idDocument: CandidateDetail['idDocument'] }) {
  const queryClient = useQueryClient();
  const [revealed, setRevealed] = useState<{ identity: Identity; until: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [editing, setEditing] = useState(false);
  const [docType, setDocType] = useState<IdDocumentType>(() => ID_DOCUMENT_TYPES.find((t) => t === idDocument?.documentType) ?? 'national_id');
  const [docNumber, setDocNumber] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<IdentitySaved | null>(null);

  // The number shows for 30 seconds, then hides on its own.
  useEffect(() => {
    if (!revealed) return;
    const t = setInterval(() => {
      const n = Date.now();
      if (n >= revealed.until) setRevealed(null);
      else setNow(n);
    }, 250);
    return () => clearInterval(t);
  }, [revealed]);

  // Each look is audited by the API, so it is asked for only on a click — never refetched in the background.
  const show = useMutation({
    mutationFn: () => fetchIdentity(studentId),
    onSuccess: (identity) => {
      const at = Date.now();
      setNow(at);
      setRevealed({ identity, until: at + REVEAL_SECONDS * 1000 });
      setError('');
    },
    onError: (err: Error) => setError(err.message),
  });

  const save = useMutation({
    mutationFn: (json: SetCandidateIdentityType) => saveIdentity(studentId, json),
    onSuccess: (r) => {
      setResult(r);
      setEditing(false);
      setDocNumber('');
      setRevealed(null);
      setError('');
      queryClient.invalidateQueries({ queryKey: EXAMS_KEY });
    },
    onError: (err: Error) => setError(err.message),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = SetCandidateIdentity.safeParse({ documentType: docType, documentNumber: docNumber });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the number against the document');
      return;
    }
    save.mutate(parsed.data);
  };

  const secondsLeft = revealed ? Math.max(0, Math.ceil((revealed.until - now) / 1000)) : 0;

  return (
    <section className="rounded-lg border border-border bg-background p-4" aria-labelledby={`id-doc-${studentId}`}>
      <h3 id={`id-doc-${studentId}`} className="text-sm font-semibold text-foreground">ID document</h3>
      <p className="mb-3 text-xs text-muted-foreground">The national ID or passport the name is checked against. Only the coordinator and the admin can see the number; each look is recorded.</p>

      {idDocument ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-foreground">
              <span className="font-medium">{ID_DOCUMENT_TYPE_LABELS[idDocument.documentType as IdDocumentType] ?? idDocument.documentType}</span>{' '}
              <Code className="tracking-wider">{idDocument.masked}</Code>
            </p>
            <p className="text-xs text-muted-foreground">
              <span>Recorded</span> <DateText date={schoolDateString(new Date(idDocument.recordedAt))} />
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!revealed && (
              <Button type="button" variant="outline" size="sm" disabled={show.isPending} onClick={() => show.mutate()}>
                {show.isPending ? 'Working…' : 'Show number'}
              </Button>
            )}
            {!editing && <Button type="button" variant="ghost" size="sm" onClick={() => { setEditing(true); setResult(null); setError(''); }}>Change ID document</Button>}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Badge tone="warning">No ID document recorded</Badge>
          {!editing && <Button type="button" size="sm" onClick={() => { setEditing(true); setResult(null); setError(''); }}>Record ID document</Button>}
        </div>
      )}

      {revealed && (
        <Notice tone="warning" className="mt-3" title={ID_DOCUMENT_TYPE_LABELS[revealed.identity.documentType as IdDocumentType] ?? revealed.identity.documentType}>
          <p className="my-1 font-mono text-xl font-bold tracking-widest text-foreground" dir="ltr" data-i18n-skip="true">{revealed.identity.documentNumber}</p>
          <p className="text-xs">
            <span>This view is recorded in the audit log.</span>{' '}
            <span>Hidden again in</span> <span className="tabular-nums">{secondsLeft}</span> <span>seconds</span>
          </p>
          {revealed.identity.recordedByName && (
            <p className="text-xs">
              <span>Recorded by</span> <bdi data-i18n-skip="true">{revealed.identity.recordedByName}</bdi>
            </p>
          )}
          <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setRevealed(null)}>Hide now</Button>
        </Notice>
      )}

      {editing && (
        <form onSubmit={submit} className="mt-3 space-y-3 rounded-lg border border-border p-3">
          <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
            <div>
              <Label htmlFor={`doc-type-${studentId}`} className="mb-1 text-xs text-muted-foreground">Document</Label>
              <select id={`doc-type-${studentId}`} value={docType} onChange={(e) => { setDocType(e.target.value as IdDocumentType); setError(''); }} className={SELECT_CLASS}>
                {ID_DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{ID_DOCUMENT_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor={`doc-number-${studentId}`} className="mb-1 text-xs text-muted-foreground">Number</Label>
              <Input
                id={`doc-number-${studentId}`}
                value={docNumber}
                onChange={(e) => { setDocNumber(e.target.value); setError(''); }}
                inputMode={docType === 'national_id' ? 'numeric' : 'text'}
                autoComplete="off"
                spellCheck={false}
                maxLength={30}
                dir="ltr"
                className="font-mono"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">An Egyptian national ID is 14 digits, starting with 2 or 3; a passport number is 5 to 20 letters and digits. Copy it from the document itself.</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => { setEditing(false); setDocNumber(''); setError(''); }} disabled={save.isPending}>Cancel</Button>
            <Button type="submit" size="sm" disabled={save.isPending || !docNumber.trim()}>{save.isPending ? 'Saving…' : 'Save the ID document'}</Button>
          </div>
        </form>
      )}

      {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
      {result && (
        <Notice tone={result.changed ? 'success' : 'neutral'} className="mt-3">
          {result.changed ? (
            <span>
              <span>ID document recorded:</span> <span>{ID_DOCUMENT_TYPE_LABELS[result.documentType as IdDocumentType] ?? result.documentType}</span>{' '}
              <Code className="tracking-wider">{result.masked}</Code>
            </span>
          ) : (
            <span>That document is already recorded; nothing changed.</span>
          )}
        </Notice>
      )}
    </section>
  );
}

// ─── Candidate numbers ───────────────────────────────────────────────────────

function Numbers({
  studentId, detail, series, chosenSeriesId,
}: {
  studentId: string; detail: CandidateDetail; series: BoardSeriesRow[]; chosenSeriesId: string | null;
}) {
  const queryClient = useQueryClient();
  const seriesById = useMemo(() => new Map(series.map((s) => [s.id, s])), [series]);

  // Every series the candidate has a number or an entry in, newest first.
  const lines = useMemo(() => {
    const byId = new Map<string, {
      seriesId: string; name: string; year: number; month: string;
      number: CandidateDetail['numbers'][number] | null; entries: CandidateDetail['entriesBySeries'];
    }>();
    for (const n of detail.numbers) {
      byId.set(n.boardSeriesId, { seriesId: n.boardSeriesId, name: n.seriesName, year: n.year, month: n.month, number: n, entries: [] });
    }
    for (const e of detail.entriesBySeries) {
      const line = byId.get(e.boardSeriesId);
      if (line) line.entries.push(e);
      else {
        const s = seriesById.get(e.boardSeriesId);
        byId.set(e.boardSeriesId, { seriesId: e.boardSeriesId, name: s?.name ?? '', year: s?.year ?? 0, month: s?.month ?? '', number: null, entries: [e] });
      }
    }
    return [...byId.values()].sort((a, b) => b.year - a.year || (MONTH_ORDER[b.month] ?? 0) - (MONTH_ORDER[a.month] ?? 0));
  }, [detail, seriesById]);

  const [formSeries, setFormSeries] = useState<string | null>(null);
  const [number, setNumber] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<{ number: string; seriesName: string } | null>(null);
  const current = formSeries ? detail.numbers.find((n) => n.boardSeriesId === formSeries) ?? null : null;

  const openForm = (seriesId: string | null) => {
    const id = seriesId ?? chosenSeriesId ?? lines[0]?.seriesId ?? series[0]?.id ?? '';
    setFormSeries(id);
    setNumber(detail.numbers.find((n) => n.boardSeriesId === id)?.number ?? '');
    setReason('');
    setError('');
    setSaved(null);
  };

  const save = useMutation({
    mutationFn: saveNumber,
    onSuccess: (row) => {
      const name = seriesById.get(row.boardSeriesId)?.name ?? lines.find((l) => l.seriesId === row.boardSeriesId)?.name ?? '';
      setSaved({ number: row.number, seriesName: name });
      setFormSeries(null);
      setNumber('');
      setReason('');
      setError('');
      queryClient.invalidateQueries({ queryKey: EXAMS_KEY });
    },
    onError: (err: Error) => setError(err.message),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formSeries) return;
    if (current && current.number === number.trim()) {
      setError('That is already the candidate\'s number in this series.');
      return;
    }
    if (current && reason.trim().length < 3) {
      setError('Say why the candidate number changes');
      return;
    }
    const parsed = SetCandidateNumber.safeParse({ studentId, boardSeriesId: formSeries, number, reason: current ? reason.trim() : undefined });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'A candidate number is four digits');
      return;
    }
    save.mutate(parsed.data);
  };

  return (
    <section className="rounded-lg border border-border bg-background p-4" aria-labelledby={`numbers-${studentId}`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id={`numbers-${studentId}`} className="text-sm font-semibold text-foreground">Candidate numbers</h3>
          <p className="text-xs text-muted-foreground">One number per series; the boards like a candidate to keep the same one.</p>
        </div>
        {formSeries === null && <Button type="button" variant="outline" size="sm" onClick={() => openForm(null)}>Set a number by hand</Button>}
      </div>

      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">No candidate number and no entry in any series yet.</p>
      ) : (
        // relative: the sr-only header is absolutely placed, and would otherwise widen the page past this scroller.
        <div className="relative overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="border-b border-border bg-muted">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Series</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Number</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Entries</th>
                <th scope="col" className="px-3 py-2 text-end font-semibold text-muted-foreground"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.map((l) => (
                <tr key={l.seriesId} className={cn(l.seriesId === chosenSeriesId && 'bg-primary/5')}>
                  <td className="px-3 py-2 text-foreground">
                    {l.name ? <SeriesWords name={l.name} /> : <span className="text-muted-foreground">Another series</span>}
                  </td>
                  <td className="px-3 py-2">
                    {l.number ? (
                      <>
                        <Code className="font-semibold">{l.number.number}</Code>
                        <p className="text-xs text-muted-foreground">
                          <span>{SOURCE_LABELS[l.number.source] ?? l.number.source}</span>
                          {l.number.centreNumber && <> · <span>Centre</span> <Code>{l.number.centreNumber}</Code></>}
                        </p>
                      </>
                    ) : (
                      <Badge tone="warning">No number</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {l.entries.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className="flex flex-wrap items-center gap-1">
                        {l.entries.map((e) => (
                          <span key={e.status} className="inline-flex items-center gap-1">
                            <span className="tabular-nums text-foreground">{e.n}</span> <EntryStatusBadge status={e.status} />
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-end">
                    <Button type="button" variant="ghost" size="sm" onClick={() => openForm(l.seriesId)}>{l.number ? 'Change' : 'Set'}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formSeries !== null && (
        <form onSubmit={submit} className="mt-3 space-y-3 rounded-lg border border-border p-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
            <div>
              <Label htmlFor={`number-series-${studentId}`} className="mb-1 text-xs text-muted-foreground">Board series</Label>
              <select
                id={`number-series-${studentId}`}
                value={formSeries}
                onChange={(e) => { const id = e.target.value; setFormSeries(id); setNumber(detail.numbers.find((n) => n.boardSeriesId === id)?.number ?? ''); setReason(''); setError(''); }}
                className={SELECT_CLASS}
              >
                {!seriesById.has(formSeries) && <option value={formSeries} data-i18n-skip="true">{lines.find((l) => l.seriesId === formSeries)?.name || '—'}</option>}
                {series.map((s) => <option key={s.id} value={s.id} data-i18n-skip="true">{s.name}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor={`number-${studentId}`} className="mb-1 text-xs text-muted-foreground">Number</Label>
              <Input
                id={`number-${studentId}`}
                value={number}
                onChange={(e) => { setNumber(e.target.value.replace(/\D/g, '').slice(0, 4)); setError(''); }}
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                placeholder="0001"
                dir="ltr"
                className="font-mono"
              />
            </div>
          </div>
          {current && (
            <div>
              <Label htmlFor={`number-reason-${studentId}`} className="mb-1 text-xs text-muted-foreground">Why the number changes</Label>
              <Input id={`number-reason-${studentId}`} value={reason} onChange={(e) => { setReason(e.target.value); setError(''); }} maxLength={500} placeholder="e.g. the board issued another number" />
              <p className="mt-1 text-xs text-muted-foreground">
                <span>Now</span> <Code>{current.number}</Code>. <span>Once entries with it have gone to a board that fixes numbers, it cannot change.</span>
              </p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => { setFormSeries(null); setError(''); }} disabled={save.isPending}>Cancel</Button>
            <Button type="submit" size="sm" disabled={save.isPending || number.length !== 4}>{save.isPending ? 'Saving…' : 'Save the number'}</Button>
          </div>
        </form>
      )}

      {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
      {saved && (
        <Notice tone="success" className="mt-3">
          <span>Candidate number saved:</span> <Code className="font-semibold">{saved.number}</Code>
          {saved.seriesName && <> · <SeriesWords name={saved.seriesName} /></>}
        </Notice>
      )}
    </section>
  );
}
