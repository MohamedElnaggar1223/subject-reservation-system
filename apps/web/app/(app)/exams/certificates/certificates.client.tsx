'use client';

/**
 * Exam certificates (FEATURES_PLAN.md F4, "Certificates"; docs/features/EXAM_ENTRIES.md §5).
 *
 * The paper version: the boards' envelopes sit in a box in the office; a
 * register (a notebook, or a sheet) has a line per certificate where the
 * officer writes who took it and when, and the collector signs the page.
 * Whether a certificate is here means leafing through the box; whether it
 * was already handed over means finding the right line; nobody can say
 * which ones have waited more than a year, and two officers can hand the
 * same envelope to two people.
 *
 * Here: type the candidate's name or student ID and press Enter — their
 * certificate opens ready to hand over. The desk writes the collector's
 * name, who they are to the candidate and which ID they showed, can attach
 * the scan of the signed slip, and prints the slip to sign (centre number,
 * the candidate as on their ID, the series, what it lists, the collector,
 * the date, who handed it over, signature lines). A certificate is handed
 * over once: a second desk is told who took it and when. "Unclaimed past
 * the retention period" lists the ones the school may return or destroy;
 * the coordinator records a series' certificates as received in one step
 * and the families are told to collect.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import {
  apiResponse, schoolDateString, CERTIFICATE_STATUSES, CERTIFICATE_STATUS_LABELS, COLLECTOR_RELATIONS, COLLECTOR_RELATION_LABELS,
  COLLECTOR_ID_DOCUMENTS, COLLECTOR_ID_DOCUMENT_LABELS,
} from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/query-state';
import { ReasonModal } from '~/components/ui/reason-modal';
import { Badge, Notice, type Tone } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { InstantText, MaybeDate, SELECT_CLASS, type BoardSeriesRow } from '../exams-shared';
import { fetchCertificates, EXAMS_KEY, useSeriesChoice, SeriesSelect, BoardText, Code } from '../exam-f4-shared';

// ─── Requests (types come from the API) ──────────────────────────────────────

type CertificatesQuery = Parameters<typeof fetchCertificates>[0];
type CertificateRow = Awaited<ReturnType<typeof fetchCertificates>>['certificates'][number];
type CertificateStatus = (typeof CERTIFICATE_STATUSES)[number];
type Relation = (typeof COLLECTOR_RELATIONS)[number];

type CollectJson = Parameters<(typeof api.v1.exams.certificates)[':id']['collect']['$post']>[0]['json'];
const collectCertificate = (id: string, json: CollectJson) => apiResponse(api.v1.exams.certificates[':id'].collect.$post({ param: { id }, json }));

type DisposeJson = Parameters<(typeof api.v1.exams.certificates)[':id']['dispose']['$post']>[0]['json'];
const disposeCertificate = (id: string, json: DisposeJson) => apiResponse(api.v1.exams.certificates[':id'].dispose.$post({ param: { id }, json }));

type ReceiveJson = Parameters<typeof api.v1.exams.certificates.receive.$post>[0]['json'];
const receiveCertificates = (json: ReceiveJson) => apiResponse(api.v1.exams.certificates.receive.$post({ json }));
type ReceiveAnswer = Awaited<ReturnType<typeof receiveCertificates>>;

const uploadSlipScan = (file: File, studentId: string) =>
  apiResponse(api.v1.files.upload.$post({ form: { file, purpose: 'supporting_document', studentId } }));

const STATUS_TONE: Record<CertificateStatus, Tone> = { received: 'warning', collected: 'success', returned_to_board: 'neutral', destroyed: 'neutral' };

const slipHref = (id: string, print = false) => `/exams/certificates/${id}/slip${print ? '?print=1' : ''}` as Route;

/** "Cambridge International June 2026: 0625 Physics" lists "0625 Physics": the series is its own column. */
function listed(c: CertificateRow): string {
  const prefix = `${c.seriesName}: `;
  return c.description.startsWith(prefix) ? c.description.slice(prefix.length) : c.description;
}

// ─── The screen ──────────────────────────────────────────────────────────────

export default function CertificatesClient({ academic }: { academic: boolean }): React.JSX.Element {
  const { series } = useSeriesChoice();
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [seriesId, setSeriesId] = useState('');
  const [status, setStatus] = useState<CertificateStatus | ''>('');
  const [unclaimed, setUnclaimed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openFirst, setOpenFirst] = useState(false);
  const [disposing, setDisposing] = useState<CertificateRow | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // The list follows the search a quarter of a second after the last key.
  useEffect(() => {
    const t = setTimeout(() => setApplied(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const query: CertificatesQuery = {
    ...(seriesId ? { boardSeriesId: seriesId } : {}),
    ...(status ? { status } : {}),
    ...(unclaimed ? { unclaimedOnly: 'true' as const } : {}),
    ...(applied ? { search: applied } : {}),
  };
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: [...EXAMS_KEY, 'certificates', query],
    queryFn: () => fetchCertificates(query),
    placeholderData: keepPreviousData,
  });
  const rows = data?.certificates ?? [];

  // Enter opens the first match — a certificate still waiting, if the candidate has one.
  useEffect(() => {
    if (!openFirst || isFetching || applied !== search.trim()) return;
    const first = rows.find((r) => r.status === 'received') ?? rows[0];
    if (first) setOpenId(first.id);
    setOpenFirst(false);
  }, [openFirst, isFetching, applied, search, rows]);

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    setApplied(search.trim());
    setOpenFirst(true);
  };

  const filtered = !!(applied || seriesId || status || unclaimed);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 animate-fade-up">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Certificates</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            The boards&apos; certificates the school holds: hand each one over once, to the candidate or someone they send, with a signed slip. Unclaimed ones are kept for the retention period, then returned to the board or destroyed.
          </p>
        </div>
      </div>

      {academic && <ReceivePanel series={series} />}

      <div className="mb-4 rounded-xl border border-border bg-card p-4 shadow-sm">
        <label htmlFor="certificate-search" className="mb-1 block text-sm font-medium text-foreground">Find a candidate</label>
        <input
          id="certificate-search"
          ref={searchRef}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={onSearchKey}
          placeholder="Name or student ID"
          autoComplete="off"
          autoFocus
          suppressHydrationWarning
          className="h-11 w-full rounded-lg border border-border bg-background px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <p className="mt-1 text-xs text-muted-foreground">Enter opens the first match, ready to hand over.</p>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="certificate-series" className="mb-1 text-xs text-muted-foreground">Series</Label>
            <select id="certificate-series" value={seriesId} onChange={(e) => setSeriesId(e.target.value)} className={cn(SELECT_CLASS, 'min-w-64')}>
              <option value="">All series</option>
              {series.map((s) => <option key={s.id} value={s.id} data-i18n-skip="true">{s.name}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="certificate-status" className="mb-1 text-xs text-muted-foreground">Status</Label>
            <select id="certificate-status" value={status} onChange={(e) => setStatus(e.target.value as CertificateStatus | '')} className={cn(SELECT_CLASS, 'min-w-56')}>
              <option value="">Any status</option>
              {CERTIFICATE_STATUSES.map((s) => <option key={s} value={s}>{CERTIFICATE_STATUS_LABELS[s]}</option>)}
            </select>
          </div>
          <label className={cn('flex h-10 items-center gap-2 rounded-lg border px-3 text-sm', unclaimed ? 'border-primary bg-primary/5' : 'border-border')}>
            <input type="checkbox" checked={unclaimed} onChange={(e) => setUnclaimed(e.target.checked)} />
            <span>Unclaimed past the retention period</span>
            {data && (
              <span className="text-muted-foreground">
                (<span className="tabular-nums">{data.retentionMonths}</span> <span>months</span>)
              </span>
            )}
          </label>
          {filtered && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setApplied(''); setSeriesId(''); setStatus(''); setUnclaimed(false); }}>
              Clear
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <LoadingState label="Loading the certificates…" />
      ) : isError ? (
        <ErrorState title="The certificates did not load" message="This is a connection problem, not an empty list. Try again." onRetry={() => refetch()} />
      ) : rows.length === 0 ? (
        filtered ? (
          <EmptyState title="No certificate matches" message="Check the spelling, or clear the filters. A certificate appears here once the coordinator records the series' certificates as received." />
        ) : (
          <EmptyState title="No certificates yet" message="When a board's certificates arrive, the coordinator records them as received here and the families are told to collect them." />
        )
      ) : (
        <>
          <p className="mb-2 text-sm text-muted-foreground">
            <span className="tabular-nums font-semibold text-foreground">{rows.length}</span> <span>{rows.length === 1 ? 'certificate' : 'certificates'}</span>
          </p>
          <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="border-b border-border bg-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Candidate</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Series</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">What it lists</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Received on</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Status</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Keep until</th>
                  <th scope="col" className="px-3 py-2 text-end font-semibold text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((c) => (
                  <CertificateRowView
                    key={c.id}
                    c={c}
                    open={openId === c.id}
                    onToggle={() => setOpenId(openId === c.id ? null : c.id)}
                    academic={academic}
                    onDispose={() => setDisposing(c)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {disposing && <DisposeModal c={disposing} onClose={() => setDisposing(null)} />}
    </div>
  );
}

// ─── One certificate ─────────────────────────────────────────────────────────

function CertificateRowView({ c, open, onToggle, academic, onDispose }: {
  c: CertificateRow; open: boolean; onToggle: () => void; academic: boolean; onDispose: () => void;
}) {
  const status = c.status as CertificateStatus;
  return (
    <>
      <tr className={cn(open && 'bg-muted/40', c.unclaimed && 'bg-red-50/40 dark:bg-red-900/10')}>
        <td className="px-3 py-2.5 align-top">
          <bdi data-i18n-skip="true" className="font-medium text-foreground">{c.studentName}</bdi>
          {c.studentCode && <p className="text-xs text-muted-foreground"><Code>{c.studentCode}</Code></p>}
        </td>
        <td className="px-3 py-2.5 align-top text-foreground"><BoardText>{c.seriesName}</BoardText></td>
        <td className="px-3 py-2.5 align-top text-foreground"><BoardText>{listed(c)}</BoardText></td>
        <td className="px-3 py-2.5 align-top text-foreground">
          <MaybeDate date={c.receivedOn} />
          {c.receivedByName && (
            <p className="text-xs text-muted-foreground"><span>by</span> <bdi data-i18n-skip="true">{c.receivedByName}</bdi></p>
          )}
        </td>
        <td className="px-3 py-2.5 align-top">
          <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{CERTIFICATE_STATUS_LABELS[status] ?? c.status}</Badge>
          <StatusDetail c={c} />
        </td>
        <td className="px-3 py-2.5 align-top text-foreground">
          {status === 'received' ? (
            <>
              <MaybeDate date={c.keepUntil} />
              {c.unclaimed && <p className="mt-1"><Badge tone="danger">Unclaimed past this date</Badge></p>}
            </>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-3 py-2.5 text-end align-top">
          <div className="flex flex-wrap justify-end gap-1">
            {status === 'received' && (
              <Button size="sm" variant={open ? 'outline' : 'default'} onClick={onToggle} aria-expanded={open}>{open ? 'Close' : 'Hand over'}</Button>
            )}
            {status === 'collected' && (
              <Link href={slipHref(c.id)} className="inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-sm font-semibold text-foreground shadow-xs hover:bg-accent">
                Collection slip
              </Link>
            )}
            {status === 'collected' && !c.signatureFileId && <AttachSignedSlip c={c} />}
            {status === 'collected' && c.signatureFileId && <Badge tone="success">Signed slip on file</Badge>}
            {academic && status === 'received' && (
              <Button size="sm" variant="ghost" onClick={onDispose}>Return or destroy</Button>
            )}
          </div>
        </td>
      </tr>
      {open && (
        <tr className="bg-muted/30">
          <td colSpan={7} className="px-3 py-4"><HandOver c={c} onClose={onToggle} /></td>
        </tr>
      )}
    </>
  );
}

/**
 * The desk's usual order: record the hand-over, print the slip, the collector
 * signs, then the scan is attached here — once (it is evidence).
 */
function AttachSignedSlip({ c }: { c: CertificateRow }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const attach = useMutation({
    mutationFn: async (f: File) => {
      const up = await apiResponse(api.v1.files.upload.$post({ form: { file: f, purpose: 'supporting_document', studentId: c.studentId } }));
      return apiResponse(api.v1.exams.certificates[':id'].slip.$post({ param: { id: c.id }, json: { signatureFileId: up.id } }));
    },
    onSuccess: () => { setError(''); queryClient.invalidateQueries({ queryKey: EXAMS_KEY }); },
    onError: (err: Error) => setError(err.message),
  });
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <label className="inline-flex h-8 cursor-pointer items-center rounded-md border border-border bg-background px-3 text-sm font-semibold text-foreground shadow-xs hover:bg-accent">
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) attach.mutate(f); e.target.value = ''; }}
          disabled={attach.isPending}
        />
        {attach.isPending ? 'Attaching…' : 'Attach the signed slip'}
      </label>
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

function StatusDetail({ c }: { c: CertificateRow }) {
  if (c.status === 'collected' && c.collectedAt) {
    const relation = c.collectorRelation ? COLLECTOR_RELATION_LABELS[c.collectorRelation as Relation] : null;
    return (
      <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
        <p>
          <span>by</span> <bdi data-i18n-skip="true" className="font-medium text-foreground">{c.collectorName}</bdi>
          {relation && <> · <span>{relation}</span></>}
        </p>
        <p><InstantText iso={c.collectedAt} /></p>
        {c.collectedByName && <p><span>Handed over by</span> <bdi data-i18n-skip="true">{c.collectedByName}</bdi></p>}
      </div>
    );
  }
  if ((c.status === 'returned_to_board' || c.status === 'destroyed') && c.disposedAt) {
    return (
      <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
        <p><InstantText iso={c.disposedAt} time={false} />{c.disposedByName && <> · <bdi data-i18n-skip="true">{c.disposedByName}</bdi></>}</p>
        {c.disposalReason && <p><span>Reason:</span> <bdi data-i18n-skip="true" dir="auto">{c.disposalReason}</bdi></p>}
      </div>
    );
  }
  return null;
}

// ─── Handing a certificate over (the desk) ───────────────────────────────────

function HandOver({ c, onClose }: { c: CertificateRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [relation, setRelation] = useState<Relation | ''>('');
  const [name, setName] = useState('');
  const [idSeen, setIdSeen] = useState<(typeof COLLECTOR_ID_DOCUMENTS)[number] | ''>('');
  const [scan, setScan] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ collectorName: string | null } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const firstRadio = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstRadio.current?.focus();
  }, []);

  const upload = useMutation({
    mutationFn: (file: File) => uploadSlipScan(file, c.studentId),
    onSuccess: (f) => { setScan({ id: f.id, name: f.name }); setError(''); },
    onError: (err: Error) => setError(err.message),
  });

  const save = useMutation({
    mutationFn: () => collectCertificate(c.id, {
      collectorName: name.trim(),
      collectorRelation: relation as Relation,
      collectorIdChecked: idSeen || null,
      signatureFileId: scan?.id ?? null,
    }),
    onSuccess: (row) => {
      setDone({ collectorName: row.collectorName });
      setError('');
      queryClient.invalidateQueries({ queryKey: [...EXAMS_KEY, 'certificates'] });
    },
    onError: (err: Error) => {
      setError(err.message);
      // Another desk may have handed it over: show the certificate as it is now.
      queryClient.invalidateQueries({ queryKey: [...EXAMS_KEY, 'certificates'] });
    },
  });

  if (done) {
    return (
      <Notice tone="success" title="Handed over">
        <p>
          <span>Recorded as collected by</span> <bdi data-i18n-skip="true" className="font-semibold">{done.collectorName}</bdi>
        </p>
        <p className="mt-1">Print the slip for them to sign, and keep it with the school&apos;s certificate records.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href={slipHref(c.id, true)} className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
            Print the collection slip
          </Link>
          <Button variant="outline" onClick={onClose}>Done</Button>
        </div>
      </Notice>
    );
  }

  // Opened from the search on a certificate no longer waiting: say where it went instead of a form.
  if (c.status !== 'received') {
    return (
      <Notice tone={error ? 'danger' : c.status === 'collected' ? 'success' : 'neutral'} title={CERTIFICATE_STATUS_LABELS[c.status as CertificateStatus] ?? c.status}>
        {error && <p className="font-medium">{error}</p>}
        <StatusDetail c={c} />
        <div className="mt-3 flex flex-wrap gap-2">
          {c.status === 'collected' && (
            <Link href={slipHref(c.id)} className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-4 text-sm font-semibold text-foreground hover:bg-accent">
              Collection slip
            </Link>
          )}
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
      </Notice>
    );
  }

  const pick = (r: Relation) => {
    setRelation(r);
    if (r === 'candidate' && !name.trim()) setName(c.studentName);
    if (r !== 'candidate' && name === c.studentName) setName('');
    setTimeout(() => nameRef.current?.focus(), 0);
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!relation) return setError('Say who is collecting it.');
        if (name.trim().length < 2) return setError('Write the collector’s name as on their ID.');
        setError('');
        save.mutate();
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">
          <span>Hand over the certificate of</span> <bdi data-i18n-skip="true">{c.studentName}</bdi>
        </p>
        <Link href={slipHref(c.id)} target="_blank" className="text-xs text-primary underline-offset-4 hover:underline">
          Print a blank slip to sign first (opens in a new tab)
        </Link>
      </div>

      <fieldset>
        <legend className="mb-2 text-xs text-muted-foreground">Who is collecting it</legend>
        <div className="flex flex-wrap gap-2">
          {COLLECTOR_RELATIONS.map((r, i) => (
            <label key={r} className={cn('flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm', relation === r ? 'border-primary bg-primary/5' : 'border-border bg-background')}>
              <input ref={i === 0 ? firstRadio : undefined} type="radio" name={`relation-${c.id}`} checked={relation === r} onChange={() => pick(r)} />
              <span>{COLLECTOR_RELATION_LABELS[r]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label htmlFor={`collector-${c.id}`} className="mb-1 text-xs text-muted-foreground">Collector&apos;s name, as on their ID</Label>
          <Input id={`collector-${c.id}`} ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="off" />
        </div>
        <div>
          <Label htmlFor={`id-seen-${c.id}`} className="mb-1 text-xs text-muted-foreground">Which ID you checked</Label>
          <select id={`id-seen-${c.id}`} value={idSeen} onChange={(e) => setIdSeen(e.target.value as typeof idSeen)} className={SELECT_CLASS}>
            <option value="">—</option>
            {COLLECTOR_ID_DOCUMENTS.map((d) => <option key={d} value={d}>{COLLECTOR_ID_DOCUMENT_LABELS[d]}</option>)}
          </select>
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs text-muted-foreground">Scan of the signed slip (if you have it now)</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id={`scan-${c.id}`}
            type="file"
            accept="application/pdf,image/*"
            className="peer sr-only"
            disabled={upload.isPending}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f);
            }}
          />
          <label
            htmlFor={`scan-${c.id}`}
            className={cn('inline-flex h-8 cursor-pointer items-center rounded-md border border-border bg-background px-3 text-sm font-semibold text-foreground shadow-xs hover:bg-accent peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50', upload.isPending && 'pointer-events-none opacity-50')}
          >
            {upload.isPending ? 'Uploading…' : scan ? 'Choose another file' : 'Attach the scan'}
          </label>
          {scan && (
            <span className="text-sm text-foreground">
              <span>Attached:</span> <bdi data-i18n-skip="true">{scan.name}</bdi>{' '}
              <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setScan(null)}>Remove</button>
            </span>
          )}
        </div>
      </div>

      {error && <Notice tone="danger">{error}</Notice>}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={save.isPending || upload.isPending}>{save.isPending ? 'Recording…' : 'Record the hand-over'}</Button>
        <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button>
      </div>
    </form>
  );
}

// ─── Returning or destroying (the coordinator, the admin) ────────────────────

function DisposeModal({ c, onClose }: { c: CertificateRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const dispose = useMutation({
    mutationFn: (json: DisposeJson) => disposeCertificate(c.id, json),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...EXAMS_KEY, 'certificates'] });
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });
  return (
    <ReasonModal
      title="Return or destroy this certificate"
      description="Return it to the board at any time, with a reason (a misspelt name, a candidate who moved abroad). Destroy it only once it has gone unclaimed past its keep-until date."
      choice={{
        legend: 'What happens to it',
        options: [
          { value: 'returned_to_board', label: 'Return it to the board' },
          { value: 'destroyed', label: 'Destroy it', hint: 'Only once unclaimed past the retention period' },
        ],
      }}
      confirmLabel="Record it"
      destructive
      isPending={dispose.isPending}
      error={error}
      onConfirm={(reason, choice) => {
        setError('');
        dispose.mutate({ action: choice as DisposeJson['action'], reason });
      }}
      onClose={onClose}
    />
  );
}

// ─── Receiving a series' certificates (the coordinator, the admin) ───────────

function ReceivePanel({ series }: { series: BoardSeriesRow[] }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [seriesId, setSeriesId] = useState('');
  const [receivedOn, setReceivedOn] = useState(() => schoolDateString(new Date()));
  const [plan, setPlan] = useState<ReceiveAnswer | null>(null);
  const [done, setDone] = useState<ReceiveAnswer | null>(null);
  const [error, setError] = useState('');

  const check = useMutation({
    mutationFn: () => receiveCertificates({ boardSeriesId: seriesId, receivedOn, commit: false }),
    onSuccess: (a) => { setPlan(a); setDone(null); setError(''); },
    onError: (err: Error) => { setPlan(null); setError(err.message); },
  });
  const record = useMutation({
    mutationFn: () => receiveCertificates({ boardSeriesId: seriesId, receivedOn, commit: true }),
    onSuccess: (a) => {
      setDone(a);
      setPlan(null);
      setError('');
      queryClient.invalidateQueries({ queryKey: [...EXAMS_KEY, 'certificates'] });
    },
    onError: (err: Error) => setError(err.message),
  });

  if (!open) {
    return (
      <div className="mb-4 flex justify-end">
        <Button variant="outline" onClick={() => setOpen(true)}>Receive a series&apos; certificates</Button>
      </div>
    );
  }

  const chosen = series.find((s) => s.id === seriesId);
  return (
    <section aria-labelledby="receive-heading" className="mb-6 rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="receive-heading" className="font-display text-lg font-semibold text-foreground">Receive certificates</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            When a board&apos;s certificates arrive, record them in one step: every candidate with a published result in the series gets one, listing what they sat. Their families are told to collect.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => { setOpen(false); setPlan(null); setDone(null); setError(''); }}>Close</Button>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <SeriesSelect id="receive-series" series={series} value={seriesId} onChange={(id) => { setSeriesId(id); setPlan(null); setDone(null); setError(''); }} />
        <div>
          <Label htmlFor="receive-date" className="mb-1 text-xs text-muted-foreground">Received on</Label>
          <Input id="receive-date" type="date" value={receivedOn} onChange={(e) => { setReceivedOn(e.target.value); setPlan(null); }} className="w-44" />
        </div>
        <Button onClick={() => check.mutate()} disabled={!seriesId || !receivedOn || check.isPending}>{check.isPending ? 'Checking…' : 'Check who gets one'}</Button>
      </div>

      {error && <Notice tone="danger" className="mt-4">{error}</Notice>}

      {plan && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-foreground">
            <strong className="tabular-nums">{plan.toReceive.length}</strong> <span>{plan.toReceive.length === 1 ? 'certificate to record' : 'certificates to record'}</span>
            {plan.already > 0 && (
              <>
                {' · '}
                <span className="tabular-nums">{plan.already}</span> <span>already recorded for this series</span>
              </>
            )}
          </p>
          {plan.toReceive.length > 0 && (
            <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {plan.toReceive.map((p) => (
                <li key={p.studentId} className="flex flex-wrap justify-between gap-2 px-3 py-2 text-sm">
                  <bdi data-i18n-skip="true" className="font-medium text-foreground">{p.name}</bdi>
                  <BoardText className="text-muted-foreground">{p.description}</BoardText>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            {plan.toReceive.length > 0 ? (
              <Button onClick={() => record.mutate()} disabled={record.isPending}>
                {record.isPending ? 'Recording…' : (
                  <>
                    <span><span>Record</span> <span className="tabular-nums">{plan.toReceive.length}</span> <span>as received</span></span>
                  </>
                )}
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">Every candidate of this series already has a certificate recorded.</p>
            )}
            <Button variant="outline" onClick={() => setPlan(null)} disabled={record.isPending}>Cancel</Button>
          </div>
        </div>
      )}

      {done && (
        <Notice tone="success" className="mt-4" title="Certificates recorded">
          <p>
            <span>Recorded</span> <strong className="tabular-nums">{done.created}</strong> <span>certificates for</span> <BoardText>{chosen?.name ?? ''}</BoardText>
          </p>
          <p className="mt-1">Their families were told to collect them at the school office.</p>
        </Notice>
      )}
    </section>
  );
}
