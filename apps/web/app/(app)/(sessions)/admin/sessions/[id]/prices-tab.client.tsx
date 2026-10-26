'use client';

/**
 * Prices (COORDINATOR_REWORK.md E1–E7, §5.3; Appendix A price lists, prices, a row's exam fee). Replaces
 * the fee grid of the old Fees tab.
 *
 * The spreadsheet version: the board's fee list open as a PDF beside the forms, each price typed into
 * the links sheet by hand (two lists printing the same code at different amounts, an old code for a new
 * syllabus, "S1 / S2" pairs). Here she pastes the list as printed; each line is matched to her rows by
 * its code (aliases and pairs understood) and shown before anything is used; a line in doubt is used only
 * when she says so; the rows still without a fee are listed with what could fill each (its units' sum,
 * the board's rule, another list). Course fees, the school's own, one per subject. A price change that
 * reaches families says so before it is saved (E7).
 *
 * Finance reads it (B3): no paste, no field to change.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, type ParsePriceListType } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge, Notice } from '~/components/ui/tone';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { cn } from '~/lib/utils';
import { Money, ErrorLine, INPUT_CLASS, TEXTAREA_CLASS } from '../sessions-shared';
import {
  fetchPrices, fetchReferenceBoards, pricesKey, REFERENCE_BOARDS_KEY, subjectTitle, useImpactSave, ImpactDialog, CommitSelect, refusalText,
  type SetupSession, type PricesData,
} from '../setup-shared';

type PriceRow = PricesData['rows'][number];

const rowName = (r: { kind: string; label: string }) => (r.kind === 'all_papers' ? 'All papers' : r.label);
/** A price row's subject as she names it ("Arabic O.L."): the prices read gives the name alone. */
const titleOf = (s: SetupSession, r: { offeringId: string; subject: string }) => {
  const o = s.offerings.find((x) => x.id === r.offeringId);
  return o ? subjectTitle(o) : r.subject;
};
const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The board fee lists a session's prices may come from: this cycle's and the ones before it (the mock's choice). */
function listMonths(s: SetupSession): { y: number; m: number }[] {
  const Y = s.seriesYear;
  return s.sessionType === 'june'
    ? [{ y: Y, m: 6 }, { y: Y - 1, m: 11 }, { y: Y - 1, m: 6 }, { y: Y - 1, m: 1 }]
    : [{ y: Y, m: 11 }, { y: Y, m: 6 }, { y: Y - 1, m: 11 }, { y: Y, m: 1 }];
}

export default function PricesTab({ s, canEdit }: { s: SetupSession; canEdit: boolean }) {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: pricesKey(s.id), queryFn: () => fetchPrices(s.id) });
  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;
  const edit = canEdit && s.status !== 'closed';
  return (
    <div className="space-y-5">
      <ListsInUse data={data} />
      {edit && <PasteList s={s} data={data} />}
      <MissingFees s={s} data={data} edit={edit} />
      <CourseFees s={s} edit={edit} />
      <EveryFee s={s} data={data} />
    </div>
  );
}

const card = 'rounded-xl border border-border bg-card p-5 shadow-sm';
const th = 'px-3 py-2 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground';
const td = 'px-3 py-2 align-top';

function ListsInUse({ data }: { data: PricesData }) {
  return (
    <section className={card} aria-labelledby="lists-title">
      <h2 id="lists-title" className="font-display text-base font-semibold text-foreground">Price lists in use</h2>
      {data.lists.length ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border"><th className={th}>List</th><th className={th}>Lines as printed</th><th className={th}>Not matched</th></tr></thead>
            <tbody>
              {data.lists.map((l) => (
                <tr key={l.id} className="border-b border-border last:border-0">
                  <td className={cn(td, 'font-medium')}><bdi data-i18n-skip="true">{l.name}</bdi></td>
                  <td className={cn(td, 'tabular-nums')}>{l.lines}</td>
                  <td className={cn(td, 'tabular-nums')}>{l.unmatched.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="mt-2 text-sm text-muted-foreground">None yet in this session.</p>}
    </section>
  );
}

/** E2: a board's list pasted as printed, matched, shown, then used. */
function PasteList({ s, data }: { s: SetupSession; data: PricesData }) {
  const queryClient = useQueryClient();
  const boards = useQuery({ queryKey: REFERENCE_BOARDS_KEY, queryFn: fetchReferenceBoards });
  const [board, setBoard] = useState<ParsePriceListType['board']>('cambridge');
  const months = listMonths(s);
  const boardName = boards.data?.find((b) => b.code === board)?.name ?? board;
  const nameOf = (k: { y: number; m: number }) => `${boardName} ${MONTHS[k.m]} ${k.y}`;
  // The list's month: the latest of last cycle's and this one's not already pasted for this board (a new list a year on).
  const firstFree = [months[2]!, months[0]!].find((k) => !data.lists.some((l) => l.name === nameOf(k))) ?? months[0]!;
  const [forKey, setForKey] = useState('');
  const picked = forKey ? { y: Number(forKey.slice(0, 4)), m: Number(forKey.slice(5)) } : firstFree;
  const name = nameOf(picked);
  const [text, setText] = useState('');
  const [doubt, setDoubt] = useState<Record<number, 'use' | ''>>({});
  const [done, setDone] = useState<{ rows: number; name: string } | null>(null);
  const parse = useMutation({
    mutationFn: async () => apiResponse(api.v1.sessions[':id']['price-lists'].parse.$post({ param: { id: s.id }, json: { board, text } })),
    onSuccess: () => { setDoubt({}); setDone(null); },
  });
  const byRow = useMemo(() => new Map(data.rows.map((r) => [r.rowId, r])), [data.rows]);
  const parsed = parse.data;
  const apply = useImpactSave(
    (v: { name: string; rows: { lineNo: number; code: string; name: string; amount: number; confirmed?: boolean }[] }, expected) =>
      apiResponse(api.v1.sessions[':id']['price-lists'].$post({ param: { id: s.id }, json: { board, name: v.name, rows: v.rows, ...(expected ? { expected } : {}) } })),
    async (res, v) => {
      setDone({ rows: res.rowsPriced, name: v.name });
      setText('');
      parse.reset();
      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  );
  const used = parsed?.rows.filter((r) => r.matches.some((m) => !m.toCheck && m.rowIds.length)) ?? [];
  const toCheck = parsed?.rows.filter((r) => r.matches.some((m) => m.toCheck)) ?? [];
  const notUsed = parsed?.rows.filter((r) => !r.matches.length || r.matches.every((m) => !m.toCheck && !m.rowIds.length)) ?? [];
  return (
    <section className={card} aria-labelledby="paste-title">
      <h2 id="paste-title" className="font-display text-base font-semibold text-foreground">Paste a list as printed</h2>
      <p className="mt-1 text-sm text-muted-foreground">Copy the board&apos;s fee list from the PDF or sheet and paste it as it is: one line per code, name and amount. Lines match your rows by code; old codes and two codes on one line are understood.</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="pl-board" className="block text-sm font-medium text-foreground">Board</label>
          <select id="pl-board" className={cn(INPUT_CLASS, 'mt-1 w-56')} value={board} onChange={(e) => { setBoard(e.target.value as ParsePriceListType['board']); setForKey(''); parse.reset(); }}>
            {(boards.data ?? []).map((b) => <option key={b.code} value={b.code} data-i18n-skip="true">{b.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="pl-for" className="block text-sm font-medium text-foreground">The board&apos;s fees for</label>
          <select id="pl-for" className={cn(INPUT_CLASS, 'mt-1 w-48')} value={`${picked.y}-${String(picked.m).padStart(2, '0')}`} onChange={(e) => setForKey(e.target.value)}>
            {months.map((k) => <option key={`${k.y}-${k.m}`} value={`${k.y}-${String(k.m).padStart(2, '0')}`}>{`${MONTHS[k.m]} ${k.y}`}</option>)}
          </select>
        </div>
        <p className="pb-2 text-sm text-foreground"><span>Its name:</span> <strong><bdi data-i18n-skip="true">{name}</bdi></strong></p>
      </div>
      <label htmlFor="pl-text" className="mt-3 block text-sm font-medium text-foreground">The list, pasted</label>
      <textarea id="pl-text" rows={7} className={cn(TEXTAREA_CLASS, 'mt-1 font-mono text-xs')} dir="ltr" value={text} placeholder="0970 CX    Biology    10,850"
        onChange={(e) => { setText(e.target.value); if (parse.data) parse.reset(); }} />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={!text.trim() || parse.isPending} onClick={() => parse.mutate()}>{parse.isPending ? 'Reading…' : 'Read the list'}</Button>
        {parsed && <Button variant="outline" onClick={() => parse.reset()}>Discard</Button>}
      </div>
      <ErrorLine message={parse.error ? refusalText(parse.error) : apply.error} />
      {done && <Notice tone="success" className="mt-3"><span>Used:</span> <span>{done.rows}</span> <span>rows priced from</span> <bdi data-i18n-skip="true">{done.name}</bdi>.</Notice>}
      {parsed && (
        <div className="mt-4 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground"><span>Matched</span> <span className="text-muted-foreground">(<span>{used.length}</span>)</span></h3>
            {used.length ? (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border"><th className={th}>Code as printed</th><th className={th}>Name as printed</th><th className={th}>Amount</th><th className={th}>Goes to</th><th className={th}>Now</th></tr></thead>
                  <tbody>
                    {used.map((r) => {
                      const targets = r.matches.filter((m) => !m.toCheck && m.rowIds.length).flatMap((m) => m.rowIds.map((id) => byRow.get(id))).filter((x): x is PriceRow => !!x);
                      return (
                        <tr key={`${r.lineNo}-${r.code}`} className="border-b border-border last:border-0">
                          <td className={cn(td, 'font-mono text-xs')} dir="ltr" data-i18n-skip="true">{r.code}</td>
                          <td className={td}><bdi data-i18n-skip="true">{r.name}</bdi></td>
                          <td className={td}><Money amount={r.amount} /></td>
                          <td className={td}>{targets.map((t) => <div key={t.rowId}><bdi data-i18n-skip="true">{titleOf(s, t)}</bdi> · <span data-i18n-skip="true">{rowName(t)}</span></div>)}</td>
                          <td className={td}>{targets.map((t) => <div key={t.rowId}>{t.examFee === null ? <span className="text-amber-700 dark:text-amber-400">not set</span> : t.examFee === r.amount ? <span className="text-muted-foreground">same</span> : <Money amount={t.examFee} />}</div>)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <p className="mt-1 text-sm text-muted-foreground">No line matched a row of this session.</p>}
          </div>
          {toCheck.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground"><span>To check</span> <span className="text-muted-foreground">(<span>{toCheck.length}</span>)</span></h3>
              {toCheck.map((r) => {
                const m = r.matches.find((x) => x.toCheck)!;
                return (
                  <Notice key={`${r.lineNo}-${r.code}`} tone="warning">
                    <p><span className="font-mono" dir="ltr" data-i18n-skip="true">{r.code}</span> <Money amount={r.amount} /> — <bdi data-i18n-skip="true">{m.label}</bdi></p>
                    {m.note && <p className="mt-1" lang="en" data-i18n-skip="true">{m.note}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <label htmlFor={`tc-${r.lineNo}`} className="font-medium">This line</label>
                      <select id={`tc-${r.lineNo}`} className={cn(INPUT_CLASS, 'h-9 w-auto')} value={doubt[r.lineNo] ?? ''} onChange={(e) => setDoubt({ ...doubt, [r.lineNo]: e.target.value as 'use' | '' })}>
                        <option value="">Leave it out until the school confirms</option>
                        <option value="use">{`Use it: ${m.label}`}</option>
                      </select>
                    </div>
                  </Notice>
                );
              })}
            </div>
          )}
          {(notUsed.length > 0 || parsed.skipped.length > 0) && (
            <div>
              <h3 className="text-sm font-semibold text-foreground"><span>Not used</span> <span className="text-muted-foreground">(<span>{notUsed.length + parsed.skipped.length}</span>)</span></h3>
              <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                {notUsed.map((r) => (
                  <li key={`${r.lineNo}-${r.code}`}><span className="font-mono" dir="ltr" data-i18n-skip="true">{r.code}</span> <bdi data-i18n-skip="true">{r.name}</bdi> — <span>{r.matches.length ? 'its subject or row is not offered in this session' : 'not recognised: no subject on our lists has this code'}</span></li>
                ))}
                {parsed.skipped.map((x) => <li key={`skip-${x.lineNo}`}><bdi data-i18n-skip="true">{x.text}</bdi> — <span>no amount read on this line</span></li>)}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={!(used.length || Object.values(doubt).includes('use')) || apply.isPending}
              onClick={() => apply.save({ name, rows: parsed.rows.map((r) => ({ lineNo: r.lineNo, code: r.code, name: r.name, amount: r.amount, ...(doubt[r.lineNo] === 'use' ? { confirmed: true } : {}) })) })}>
              {apply.isPending ? 'Using…' : 'Use these prices'}
            </Button>
            <span className="text-xs text-muted-foreground">One-paper rows that follow their subject, and sums of units, follow by themselves.</span>
          </div>
        </div>
      )}
      <ImpactDialog save={apply} />
    </section>
  );
}

/** Amendment 4: every ticked row without an exam fee, each filled by typing it, its units' sum, the board's rule or another list. */
function MissingFees({ s, data, edit }: { s: SetupSession; data: PricesData; edit: boolean }) {
  return (
    <section className={card} aria-labelledby="missing-title">
      <h2 id="missing-title" className="font-display text-base font-semibold text-foreground"><span>Missing exam fees</span> <span className="text-muted-foreground">(<span>{data.missing.length}</span>)</span></h2>
      <p className="mt-1 text-sm text-muted-foreground">Every ticked row without an exam fee. A subject with a fee not set is not offered to families. Not set is not 0.</p>
      {data.missing.length ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border"><th className={th}>Subject · row</th><th className={th}>Fill it by</th><th className={th}>Amount (EGP)</th></tr></thead>
            <tbody>{data.missing.map((r) => <MissingRow key={r.rowId} s={s} r={r} edit={edit} />)}</tbody>
          </table>
        </div>
      ) : <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">Every ticked row has its exam fee.</p>}
    </section>
  );
}

function MissingRow({ s, r, edit }: { s: SetupSession; r: PriceRow; edit: boolean }) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const set = useImpactSave(
    (json: { amount: number } | { source: 'units_sum' | 'board_rule' }, expected) =>
      apiResponse(api.v1.sessions[':id'].rows[':rowId']['exam-fee'].$put({ param: { id: s.id, rowId: r.rowId }, json: { ...json, ...(expected ? { expected } : {}) } })),
    () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
    () => setAmount(''),
  );
  const fills = [
    ...(r.fill.unitsSum !== null ? [{ v: 'units_sum', text: `Sum of its units: ${r.fill.unitsSum}` }] : []),
    ...(r.fill.boardRule !== null ? [{ v: 'board_rule', text: `The subject's fee (the board's rule): ${r.fill.boardRule}` }] : []),
    ...r.fill.fromLists.map((l) => ({ v: `list:${l.amount}`, text: `Copy from ${l.listName}: ${l.amount}` })),
  ];
  const label = `${titleOf(s, r)} ${rowName(r)}`;
  return (
    <tr className="border-b border-border last:border-0">
      <td className={td}><bdi data-i18n-skip="true">{titleOf(s, r)}</bdi> · <span data-i18n-skip="true">{rowName(r)}</span><ErrorLine message={set.error} /></td>
      <td className={td}>
        {fills.length ? (
          <CommitSelect className={cn(INPUT_CLASS, 'h-9 w-auto max-w-xs')} aria-label={`${label}: fill it by`} disabled={!edit || set.isPending} value="" reset
            onCommit={(v) => {
              if (v === 'units_sum' || v === 'board_rule') set.save({ source: v });
              else if (v.startsWith('list:')) set.save({ amount: Number(v.slice(5)) });
            }}>
            <option value="">typing it, or…</option>
            {fills.map((f) => <option key={f.v} value={f.v}>{f.text}</option>)}
          </CommitSelect>
        ) : <span className="text-xs text-muted-foreground">typing it (no list we hold prints it)</span>}
      </td>
      <td className={td}>
        <input type="number" min={0} step={50} inputMode="decimal" className={cn(INPUT_CLASS, 'h-9 w-32')} placeholder="not set" aria-label={`${label}: exam fee`}
          disabled={!edit || set.isPending} value={amount} onChange={(e) => setAmount(e.target.value)}
          onBlur={() => { if (amount !== '' && Number(amount) >= 0) set.save({ amount: Number(amount) }); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        <ImpactDialog save={set} />
      </td>
    </tr>
  );
}

/** E3: the school's course fee, one per subject (a row may have its own, in the subject editor). Empty is not set; 0 is a fee. */
function CourseFees({ s, edit }: { s: SetupSession; edit: boolean }) {
  return (
    <section className={card} aria-labelledby="course-title">
      <h2 id="course-title" className="font-display text-base font-semibold text-foreground">Course fees</h2>
      <p className="mt-1 text-sm text-muted-foreground"><span>The school&apos;s own fee, one per subject; a row may have its own in the subject&apos;s editor. Self study pays</span> <span>{s.selfStudyPercent}%</span> <span>of it. 0 is a fee; empty is not set.</span></p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-border"><th className={th}>Subject</th><th className={th}>The subject&apos;s course fee (EGP)</th><th className={th}>Rows with their own</th></tr></thead>
          <tbody>{s.offerings.map((o) => <CourseRow key={o.id} s={s} o={o} edit={edit} />)}</tbody>
        </table>
      </div>
    </section>
  );
}

function CourseRow({ s, o, edit }: { s: SetupSession; o: SetupSession['offerings'][number]; edit: boolean }) {
  const queryClient = useQueryClient();
  const stored = o.courseFee === null ? '' : String(o.courseFee);
  const [value, setValue] = useState(stored);
  // The field follows the stored fee (a save elsewhere, a refetch) while she is not in it; leaving it saves only what
  // she changed since she entered it, so a value read before a refetch is never written back.
  const entered = useRef<string | null>(null);
  useEffect(() => { if (entered.current === null) setValue(stored); }, [stored]);
  const save = useImpactSave(
    (courseFee: number | null, expected) => apiResponse(api.v1.sessions[':id'].offerings[':offeringId'].$put({ param: { id: s.id, offeringId: o.id }, json: { courseFee, ...(expected ? { expected } : {}) } })),
    () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
    () => setValue(o.courseFee === null ? '' : String(o.courseFee)),
  );
  const own = o.rows.filter((r) => r.courseFee !== null);
  return (
    <tr className="border-b border-border last:border-0">
      <td className={td}><bdi data-i18n-skip="true">{subjectTitle(o)}</bdi><ErrorLine message={save.error} /></td>
      <td className={td}>
        <input type="number" min={0} step={50} inputMode="decimal" className={cn(INPUT_CLASS, 'h-9 w-32')} placeholder="not set" aria-label={`${subjectTitle(o)}: course fee`}
          disabled={!edit || save.isPending} value={value} onChange={(e) => setValue(e.target.value)}
          onFocus={() => { entered.current = value; }}
          onBlur={() => {
            const was = entered.current;
            entered.current = null;
            const next = value === '' ? null : Number(value);
            if (value !== was && next !== o.courseFee && (next === null || next >= 0)) save.save(next);
            else if (value === was) setValue(stored);
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      </td>
      <td className={cn(td, 'text-xs text-muted-foreground')}>
        {own.length ? own.map((r, i) => <span key={r.id}>{i > 0 && ' · '}<span data-i18n-skip="true">{r.label}</span> <Money amount={r.courseFee} /></span>) : '—'}
        <ImpactDialog save={save} />
      </td>
    </tr>
  );
}

/** Every ticked row's exam fee and where it came from (a list, typed, the sum of its units, the board's rule). */
function EveryFee({ s, data }: { s: SetupSession; data: PricesData }) {
  const [open, setOpen] = useState(false);
  const rows = data.rows.filter((r) => r.ticked);
  const from = (r: PriceRow) => {
    if (r.examFee === null) return <span className="text-amber-700 dark:text-amber-400">not set</span>;
    if (r.priceList) return <><span>from</span> <bdi data-i18n-skip="true">{r.priceList.name}</bdi></>;
    if (r.examFeeSource === 'units_sum') return <span>the sum of its units</span>;
    if (r.examFeeSource === 'board_rule') return <span>the subject&apos;s fee (the board&apos;s rule)</span>;
    if (r.examFeeSource === 'list') return <span>a list of an earlier session</span>;
    return <span>typed</span>;
  };
  return (
    <section className={card} aria-labelledby="every-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="every-title" className="font-display text-base font-semibold text-foreground"><span>Every exam fee</span> <span className="text-muted-foreground">(<span>{rows.length}</span>)</span></h2>
        <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'}</Button>
      </div>
      {open && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border"><th className={th}>Subject · row</th><th className={th}>Exam fee</th><th className={th}>From</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.rowId} className="border-b border-border last:border-0">
                  <td className={td}><bdi data-i18n-skip="true">{titleOf(s, r)}</bdi> · <span data-i18n-skip="true">{rowName(r)}</span></td>
                  <td className={td}>{r.examFee === null ? <Badge tone="warning">not set</Badge> : <Money amount={r.examFee} />}</td>
                  <td className={cn(td, 'text-xs text-muted-foreground')}>{from(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
