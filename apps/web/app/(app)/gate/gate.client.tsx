'use client';

/**
 * The gate (FEATURES_PLAN.md F2) — built for a phone or a tablet in a
 * gatehouse, with a USB or Bluetooth QR scanner or the device's camera.
 *
 * The paper version: a list the office sends down in the morning, phone calls
 * for every change, a parent at the barrier while the guard rings the office
 * to ask whether the child may go and whether this uncle is allowed, and a
 * sheet signed by whoever collects. Here: today's leave by time, refreshed
 * by itself; a pass scanned (the scanner types into the box that always has
 * the focus; the camera button reads it on a phone) or the student found by
 * name; one sheet with everyone authorised — the parents, the approved
 * collectors with photo and ID number — and anyone the school says may not
 * collect, in red; one tap for who is collecting, one for "ID seen", one to
 * check out. A person the school has not approved is refused on the spot,
 * and a person a custody note names raises an alert to the coordinator.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { Badge, Notice } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { LEAVE_KEY, fetchGateToday, StatusBadge, TimesText, Photo, type GateLeave } from '../leave/leave-shared';
import { DateText } from '../academic/calendar/academic-shared';

type Opened = { leave: GateLeave; token: string | null };

export default function GateClient(): React.JSX.Element {
  const qc = useQueryClient();
  const today = useQuery({ queryKey: [...LEAVE_KEY, 'gate'], queryFn: fetchGateToday, refetchInterval: 20_000 });
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'waiting' | 'out' | 'all'>('waiting');
  const [opened, setOpened] = useState<Opened | null>(null);
  const [scanError, setScanError] = useState('');
  const [camera, setCamera] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);

  const scan = useMutation({
    mutationFn: async (token: string) => apiResponse(api.v1.leave.gate.scan.$post({ json: { token } })),
    onSuccess: (leave, token) => { setScanError(''); setOpened({ leave, token }); },
    onError: (e: Error) => setScanError(e.message),
  });
  const onCode = useCallback((code: string) => { setCamera(false); if (code.trim()) scan.mutate(code.trim()); }, [scan]);

  // The scanner types into the pass box: keep the focus there whenever nothing else is open.
  useEffect(() => {
    if (opened || camera) return;
    const id = window.setInterval(() => {
      const a = document.activeElement;
      if (!a || a === document.body) scanRef.current?.focus();
    }, 1000);
    return () => window.clearInterval(id);
  }, [opened, camera]);

  const data = today.data;
  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.leaves ?? []).filter((l) => {
      if (q && !l.student.name.toLowerCase().includes(q) && !(l.student.code ?? '').toLowerCase().includes(q)) return false;
      if (filter === 'waiting') return l.status === 'approved' || l.status === 'cancelled';
      if (filter === 'out') return l.status === 'checked_out';
      return true;
    });
  }, [data, search, filter]);

  return (
    <div className="mx-auto max-w-3xl px-3 py-4 sm:px-6 sm:py-6">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Gate</h1>
          {data && <p className="text-sm text-muted-foreground"><DateText date={data.date} weekday long /></p>}
        </div>
        {data && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <Count n={data.counts.toLeave} label="To leave" />
            <Count n={data.counts.out} label="Out" />
            <Count n={data.counts.noShows + data.counts.lateReturns} label="Alerts" alert />
          </div>
        )}
      </header>

      <form className="mb-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); const v = scanRef.current?.value ?? ''; if (scanRef.current) scanRef.current.value = ''; onCode(v); }}>
        <Input ref={scanRef} autoFocus aria-label="Scan a pass" placeholder="Scan a pass (or type its code)" className="h-12 text-base" autoComplete="off" />
        <Button type="button" size="lg" className="h-12" onClick={() => setCamera(true)}>Camera</Button>
      </form>
      {scan.isPending && <p className="mb-2 text-sm text-muted-foreground">Checking the pass…</p>}
      {scanError && <Notice tone="danger" className="mb-3 text-base font-semibold">{scanError}</Notice>}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input aria-label="Find a student" placeholder="Find a student by name" value={search} onChange={(e) => setSearch(e.target.value)} className="h-11 flex-1" />
        <div role="tablist" aria-label="Show" className="flex rounded-lg border border-border bg-card p-1">
          {([['waiting', 'To leave'], ['out', 'Out'], ['all', 'All']] as const).map(([k, label]) => (
            <button key={k} role="tab" type="button" aria-selected={filter === k} onClick={() => setFilter(k)}
              className={cn('h-9 rounded-md px-3 text-sm font-medium', filter === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>{label}</button>
          ))}
        </div>
      </div>

      {today.isLoading ? <LoadingState label="Loading today's leave…" /> : today.isError || !data ? (
        <ErrorState title="Today's leave did not load" message="Do not release anyone without checking with the office." onRetry={() => today.refetch()} />
      ) : list.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">{data.leaves.length === 0 ? 'No leave today.' : 'Nobody here.'}</p>
      ) : (
        <ul className="space-y-2">
          {list.map((l) => (
            <li key={l.id}>
              <button type="button" onClick={() => setOpened({ leave: l, token: null })}
                className={cn('flex w-full items-center gap-3 rounded-2xl border bg-card p-3 text-start shadow-sm active:bg-accent', l.custody.length ? 'border-red-300 dark:border-red-800' : 'border-border', l.status === 'cancelled' && 'opacity-70')}>
                <span className="w-16 shrink-0 text-center text-xl font-bold tabular-nums text-foreground" dir="ltr">{l.leaveTime}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-semibold text-foreground"><bdi>{l.student.name}</bdi></span>
                  <span className="block truncate text-sm text-muted-foreground">
                    <span>{l.student.gradeLabel}</span>{l.student.section && <> · <span>{l.student.section}</span></>}
                    {' · '}{l.named.kind === 'alone' ? <span>Leaves alone</span> : <bdi>{l.named.name}</bdi>}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    <StatusBadge status={l.status} noShow={l.noShow} late={l.lateReturn} />
                    {l.custody.length > 0 && <Badge tone="danger">Custody alert</Badge>}
                  </span>
                </span>
                {l.named.kind === 'collector' && <Photo fileId={l.named.photoFileId} name={l.named.name} size="sm" />}
              </button>
            </li>
          ))}
        </ul>
      )}
      {opened && <CheckoutSheet opened={opened} onClose={() => { setOpened(null); qc.invalidateQueries({ queryKey: [...LEAVE_KEY, 'gate'] }); }} />}
      {camera && <CameraScanner onCode={onCode} onClose={() => setCamera(false)} />}
    </div>
  );
}

function Count({ n, label, alert = false }: { n: number; label: string; alert?: boolean }) {
  return (
    <div className={cn('min-w-16 rounded-lg border px-2 py-1', alert && n > 0 ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400' : 'border-border bg-card')}>
      <p className="text-lg font-bold tabular-nums">{n}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

// ─── Check-out ───────────────────────────────────────────────────────────────

type Who = { kind: 'parent'; parentId: string } | { kind: 'collector'; collectorId: string } | { kind: 'alone' } | { kind: 'other' };

function CheckoutSheet({ opened, onClose }: { opened: Opened; onClose: () => void }) {
  const [leave, setLeave] = useState(opened.leave);
  const named: Who | null = leave.named.kind === 'parent' && leave.named.id ? { kind: 'parent', parentId: leave.named.id }
    : leave.named.kind === 'collector' && leave.named.id ? { kind: 'collector', collectorId: leave.named.id }
      : leave.named.kind === 'alone' ? { kind: 'alone' } : null;
  const [who, setWho] = useState<Who | null>(named);
  const [idChecked, setIdChecked] = useState(false);
  const [otherName, setOtherName] = useState('');
  const [otherId, setOtherId] = useState('');
  const [refusal, setRefusal] = useState<{ message: string; custody: boolean } | null>(null);
  const [doneText, setDoneText] = useState('');
  const same = (a: Who | null, b: Who) => JSON.stringify(a) === JSON.stringify(b);

  const checkOut = useMutation({
    mutationFn: async () => apiResponse(api.v1.leave.gate[':id']['check-out'].$post({ param: { id: leave.id }, json: {
      collectedBy: who!.kind === 'other' ? { kind: 'other', name: otherName, idNumber: otherId || null } : who!,
      idChecked: who!.kind === 'alone' ? false : idChecked, via: opened.token ? 'pass' : 'lookup', token: opened.token,
    } })),
    onSuccess: (l) => { setLeave(l); setRefusal(null); setDoneText(`Left at ${l.checkout?.time ?? ''}`); },
    onError: (e: Error) => setRefusal({ message: e.message, custody: e.message.startsWith('Custody restriction') }),
  });
  const back = useMutation({
    mutationFn: async () => apiResponse(api.v1.leave.gate[':id'].return.$post({ param: { id: leave.id }, json: {} })),
    onSuccess: (l) => { setLeave(l); setDoneText(`Back at ${l.returnedTime ?? ''}`); },
    onError: (e: Error) => setRefusal({ message: e.message, custody: false }),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const needsId = who && who.kind !== 'alone';
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div className="max-h-[95vh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-card p-4 shadow-xl sm:rounded-2xl sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="sheet-title" className="font-display text-2xl font-bold text-foreground"><bdi>{leave.student.name}</bdi></h2>
            <p className="text-sm text-muted-foreground"><span>{leave.student.gradeLabel}</span>{leave.student.section && <> · <span>{leave.student.section}</span></>}{leave.student.code && <> · <span className="font-mono">{leave.student.code}</span></>}</p>
            <p className="mt-1 text-lg font-semibold text-foreground"><TimesText leaveTime={leave.leaveTime} returning={leave.returning} returnTime={leave.returnTime} /></p>
            {opened.token && <Badge tone="success" className="mt-1">Pass checked</Badge>}
          </div>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>

        {leave.custody.length > 0 && (
          <div role="alert" className="mt-3 rounded-xl border-2 border-red-400 bg-red-50 p-3 text-red-800 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300">
            <p className="font-bold">May NOT collect this student:</p>
            <ul className="mt-2 space-y-2">
              {leave.custody.map((c) => (
                <li key={c.id} className="flex items-center gap-3">
                  <Photo fileId={c.photoFileId} name={c.personName} />
                  <span><bdi className="font-semibold">{c.personName}</bdi>{c.relation && <> · <span>{c.relation}</span></>}{c.idNumber && <> · <span>ID</span> <span dir="ltr" className="font-mono">{c.idNumber}</span></>}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {doneText ? (
          <Notice tone="success" className="mt-4 text-base" title={doneText}>
            {leave.checkout?.name && <p><span>With</span> <bdi>{leave.checkout.name}</bdi>. <span>The family has been told.</span></p>}
            <Button className="mt-3" size="lg" onClick={onClose}>Done</Button>
          </Notice>
        ) : leave.status === 'approved' ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm font-semibold text-foreground">Who is collecting?</p>
            <div className="grid gap-2">
              {leave.authorised.parents.map((p) => (
                <PersonButton key={p.id} selected={same(who, { kind: 'parent', parentId: p.id })} onSelect={() => setWho({ kind: 'parent', parentId: p.id })}
                  name={p.name} detail={`Parent${p.phone ? ` · ${p.phone}` : ''}`} named={leave.named.kind === 'parent' && leave.named.id === p.id} />
              ))}
              {leave.authorised.collectors.map((c) => (
                <PersonButton key={c.id} selected={same(who, { kind: 'collector', collectorId: c.id })} onSelect={() => setWho({ kind: 'collector', collectorId: c.id })}
                  name={c.name} detail={`${c.relation} · ID ${c.idNumber}`} photoFileId={c.photoFileId} named={leave.named.kind === 'collector' && leave.named.id === c.id} />
              ))}
              {leave.mayLeaveAlone && (
                <PersonButton selected={who?.kind === 'alone'} onSelect={() => setWho({ kind: 'alone' })} name="Leaves alone" detail="Allowed for their grade" named={leave.named.kind === 'alone'} />
              )}
              <PersonButton selected={who?.kind === 'other'} onSelect={() => setWho({ kind: 'other' })} name="Someone else" detail="Not on this list: checked against the school's records" />
            </div>
            {leave.named.kind === 'collector' && leave.named.approved === false && (
              <Notice tone="warning">The person the family named is not an approved collector.</Notice>
            )}
            {who?.kind === 'other' && (
              <div className="grid gap-2 sm:grid-cols-2">
                <Input aria-label="Name on their ID" placeholder="Name on their ID" value={otherName} onChange={(e) => setOtherName(e.target.value)} className="h-11" />
                <Input aria-label="ID number" placeholder="ID number" inputMode="numeric" dir="ltr" value={otherId} onChange={(e) => setOtherId(e.target.value)} className="h-11" />
              </div>
            )}
            {needsId && (
              <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-border px-3 text-base">
                <input type="checkbox" className="size-5" checked={idChecked} onChange={(e) => setIdChecked(e.target.checked)} />
                <span>I checked their ID card against this record</span>
              </label>
            )}
            {refusal && (
              <div role="alert" className={cn('rounded-xl border-2 p-3 text-base font-semibold', refusal.custody ? 'border-red-500 bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-300' : 'border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300')}>
                {refusal.custody && <p className="text-lg">DO NOT RELEASE</p>}
                <p>{refusal.message}</p>
              </div>
            )}
            <Button size="lg" className="h-14 w-full text-lg" disabled={!who || checkOut.isPending || (!!needsId && !idChecked) || (who.kind === 'other' && otherName.trim().length < 2)} onClick={() => checkOut.mutate()}>
              {checkOut.isPending ? 'Checking…' : 'Check out'}
            </Button>
          </div>
        ) : leave.status === 'checked_out' ? (
          <div className="mt-4 space-y-3">
            <p className="text-base text-foreground"><span>Left at</span> <span dir="ltr">{leave.checkout?.time}</span>{leave.checkout?.name && <> <span>with</span> <bdi>{leave.checkout.name}</bdi></>}</p>
            {refusal && <Notice tone="danger">{refusal.message}</Notice>}
            {leave.returning ? (
              <Button size="lg" className="h-14 w-full text-lg" disabled={back.isPending} onClick={() => back.mutate()}>Back at school now</Button>
            ) : <p className="text-sm text-muted-foreground">Not coming back today.</p>}
          </div>
        ) : leave.status === 'cancelled' ? (
          <Notice tone="danger" className="mt-4 text-base font-semibold"><span>Leave cancelled at</span> <span dir="ltr">{leave.cancelledTime}</span> <span>— do not release.</span></Notice>
        ) : (
          <Notice tone="info" className="mt-4"><span>Back at school at</span> <span dir="ltr">{leave.returnedTime}</span>.</Notice>
        )}
      </div>
    </div>
  );
}

function PersonButton({ selected, onSelect, name, detail, photoFileId, named = false }: { selected: boolean; onSelect: () => void; name: string; detail: string; photoFileId?: string | null; named?: boolean }) {
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onSelect}
      className={cn('flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2 text-start', selected ? 'border-primary bg-primary/5 ring-2 ring-primary' : 'border-border bg-background')}>
      {photoFileId !== undefined && <Photo fileId={photoFileId} name={name} size="md" />}
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold text-foreground"><bdi>{name}</bdi></span>
        <span className="block truncate text-sm text-muted-foreground" dir="auto">{detail}</span>
      </span>
      {named && <Badge tone="info">Named on the request</Badge>}
    </button>
  );
}

// ─── The camera ──────────────────────────────────────────────────────────────

type Detector = { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> };

/**
 * Reads a pass with the device's camera: the browser's own barcode reader
 * where it has one (Chrome on Android), otherwise jsQR on frames of the
 * video (Safari), loaded only when the camera opens.
 */
function CameraScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer = 0;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        const Native = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
        const detector = Native ? new Native({ formats: ['qr_code'] }) : null;
        const jsQR = detector ? null : (await import('jsqr')).default;
        const canvas = document.createElement('canvas');
        const tick = async () => {
          if (stopped) return;
          try {
            if (detector) {
              const found = await detector.detect(video);
              if (found[0]?.rawValue) { onCode(found[0].rawValue); return; }
            } else if (jsQR && video.videoWidth) {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
              ctx.drawImage(video, 0, 0);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const code = jsQR(img.data, img.width, img.height);
              if (code?.data) { onCode(code.data); return; }
            }
          } catch { /* a frame that cannot be read: try the next */ }
          timer = window.setTimeout(tick, 200);
        };
        tick();
      } catch {
        setError('The camera did not open: allow the camera for this site, or use the scanner or the list.');
      }
    })();
    return () => { stopped = true; window.clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, [onCode]);
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black p-4" role="dialog" aria-modal="true" aria-label="Scan a pass with the camera">
      <video ref={videoRef} playsInline muted className="max-h-[70vh] w-full max-w-md rounded-xl" />
      <p className="mt-3 text-center text-sm text-white">Hold the pass in the frame.</p>
      {error && <p className="mt-2 max-w-md text-center text-sm text-red-300">{error}</p>}
      <Button variant="secondary" size="lg" className="mt-4" onClick={onClose}>Close the camera</Button>
    </div>
  );
}
