'use client';

/**
 * "Remind" on the session's Money tab (RESERVATIONS_REWORK.md §4.6, step D): the payment reminder
 * to the families the tab shows — its subject and section; its filter "Overdue" narrows to what is
 * past its due date — now, as batch audiences ("a session's unpaid families"). What is past its due
 * date gets the overdue text ("… was due on … and is still unpaid"), what is not yet due the due
 * text, per line: a family with both gets one of each (the review of 5c2f2bf, item 8). The dialog
 * lists the families with what each owes, all ticked; untick any; one click sends. It goes through
 * POST /v1/messages, the payment-list path the finance officer may use. A line that cannot be paid
 * now (a provisional board fee, a payment already in progress, a plan line, past its deadline) is
 * not in it; a plan's instalments are. Per family, the overdue part names everything overdue, each
 * item with its date, and the due part what falls due on its first day (the review of 9e7a4d6, item
 * 1, and its follow-up 2). "Overdue" is past the due instant (item 5) — except under the tab's own
 * Overdue filter, where it is the tab's whole-day rule, so the dialog lists exactly the families the
 * tab lists (follow-up 1).
 *
 * The two parts are two messages (two POSTs). The dialog records which went: when the second fails,
 * the list and the email choice are frozen, the button reads "Send the rest", and a retry sends only
 * what did not go (the review of 9e7a4d6, item 4). A part refused because nobody is in it now (the
 * families paid meanwhile, NOTHING_TO_SEND) is done, with nobody sent to.
 */

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, renderMessage, NOTHING_TO_SEND } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge, Notice } from '~/components/ui/tone';
import { LoadingState } from '~/components/ui/query-state';
import { resolveAudience, fetchTemplates, countWords, MESSAGES_KEY, TEMPLATES_KEY, type Resolved } from '~/app/(app)/(messages)/admin/messages/messages-shared';
import { Money, Day } from '../sessions-shared';

export function Remind({ sessionId, filter, offerId, sectionId }: { sessionId: string; filter: string; offerId: string; sectionId: string }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>Remind</Button>
      {open && <RemindDialog sessionId={sessionId} filter={filter} offerId={offerId} sectionId={sectionId} onClose={() => setOpen(false)} />}
    </>
  );
}

type Part = 'overdue' | 'due';
const TEMPLATE_KEY: Record<Part, string> = { overdue: 'payment_overdue', due: 'payment_due' };

function RemindDialog({ sessionId, filter, offerId, sectionId, onClose }: { sessionId: string; filter: string; offerId: string; sectionId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const definition = (part: Part) => ({
    kind: 'batch' as const, list: 'session_unpaid' as const, sessionId,
    include: offerId ? 'lines' as const : 'both' as const,
    // Under the tab's Overdue filter, the tab's own rule (a whole day or more); elsewhere the due instant.
    filter: part === 'due' ? 'due' as const : filter === 'overdue' ? 'overdue_days' as const : 'overdue' as const,
    ...(offerId ? { offerId } : {}), ...(sectionId ? { sectionId } : {}), who: 'families' as const,
  });
  // Under the tab's "Overdue" filter only what is past due; otherwise both parts.
  const parts: Part[] = filter === 'overdue' ? ['overdue'] : ['overdue', 'due'];
  const found = useQuery({
    queryKey: [...MESSAGES_KEY, 'remind', sessionId, filter, offerId, sectionId],
    queryFn: async () => Object.fromEntries(await Promise.all(parts.map(async (p) => [p, await resolveAudience({ definition: definition(p) })] as const))) as Partial<Record<Part, Resolved>>,
  });
  const templates = useQuery({ queryKey: TEMPLATES_KEY, queryFn: fetchTemplates });
  const templateOf = (p: Part) => templates.data?.find((t) => t.key === TEMPLATE_KEY[p]) ?? null;
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [email, setEmail] = useState(true);

  // The families, each with what is overdue and what is not yet due.
  const families = new Map<string, { id: string; name: string; overdue: number; due: number; overdueAt: string | null; dueAt: string | null }>();
  for (const p of parts) {
    for (const s of found.data?.[p]?.students ?? []) {
      const f = families.get(s.id) ?? { id: s.id, name: s.name, overdue: 0, due: 0, overdueAt: null, dueAt: null };
      if (p === 'overdue') { f.overdue = s.amount ?? 0; f.overdueAt = s.dueAt ? String(s.dueAt) : null; } else { f.due = s.amount ?? 0; f.dueAt = s.dueAt ? String(s.dueAt) : null; }
      families.set(s.id, f);
    }
  }
  const list = [...families.values()].sort((a, b) => a.name.localeCompare(b.name));
  const chosen = list.filter((f) => !unticked.has(f.id));
  const chosenIn = (p: Part) => (found.data?.[p]?.students ?? []).map((s) => s.id).filter((id) => !unticked.has(id));

  // The parts that went, with the people each reached: a retry sends only the others.
  const [sent, setSent] = useState<Partial<Record<Part, number>>>({});
  const sentRef = useRef(sent);
  const toSend = parts.filter((p) => sent[p] === undefined && chosenIn(p).length > 0 && templateOf(p));
  const started = Object.keys(sent).length > 0;
  const finished = started && toSend.length === 0;
  const people = Object.values(sent).reduce((n, x) => n + (x ?? 0), 0);

  const send = useMutation({
    mutationFn: async () => {
      for (const p of parts) {
        if (sentRef.current[p] !== undefined) continue;
        const ids = chosenIn(p);
        const t = templateOf(p);
        if (!ids.length || !t) continue;
        let reached = 0;
        try {
          reached = (await apiResponse(api.v1.messages.$post({
            json: { audience: { definition: { ...definition(p), studentIds: ids } }, templateId: t.id, channels: email ? ['in_app', 'email'] : ['in_app'] },
          }))).people;
        } catch (e) {
          // Nobody is left in this part (they paid meanwhile): it is done. Anything else stops here.
          if ((e as Error).message !== NOTHING_TO_SEND) throw e;
        }
        sentRef.current = { ...sentRef.current, [p]: reached };
        setSent(sentRef.current);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MESSAGES_KEY }),
  });

  // The preview: the first family's overdue copy when there is one, else its due copy.
  const previewPart: Part | null = parts.find((p) => (found.data?.[p]?.sample.length ?? 0) > 0) ?? null;
  const sample = previewPart ? found.data?.[previewPart]?.sample[0] : undefined;
  const t = previewPart ? templateOf(previewPart) : null;
  const preview = t && sample ? renderMessage({ titleEn: t.titleEn, bodyEn: t.bodyEn, titleAr: t.titleAr, bodyAr: t.bodyAr }, 'both', sample.vars) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="remind-title">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-card shadow-xl">
        <div className="border-b border-border px-6 py-4">
          <h2 id="remind-title" className="font-display text-lg font-bold text-foreground">Remind these families</h2>
          <p className="mt-1 text-sm text-muted-foreground">The payment reminder, now, to the parents and the student of each family ticked: what they owe in this session and by when. What is past its due date gets the overdue text.</p>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {found.isLoading ? <LoadingState /> : found.isError ? <Notice tone="danger">{(found.error as Error).message}</Notice> : list.length === 0 ? (
            <Notice tone="info">No family here owes anything that can be paid now.</Notice>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border text-sm">
              {list.map((f) => (
                <li key={f.id}>
                  <label className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="inline-flex items-center gap-2">
                      <input type="checkbox" checked={!unticked.has(f.id)} disabled={started}
                        onChange={(e) => { const next = new Set(unticked); if (e.target.checked) next.delete(f.id); else next.add(f.id); setUnticked(next); }} />
                      <bdi data-i18n-skip="true">{f.name}</bdi>
                    </span>
                    <span className="flex flex-col items-end gap-0.5 text-xs text-muted-foreground">
                      {f.overdue > 0 && <span><Badge tone="danger">overdue</Badge> <Money amount={f.overdue} />{f.overdueAt && <> · <span>since</span> <Day iso={f.overdueAt} /></>}</span>}
                      {f.due > 0 && <span><Money amount={f.due} />{f.dueAt && <> · <span>due</span> <Day iso={f.dueAt} /></>}</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {preview && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm" aria-label="Preview">
              <p className="text-xs text-muted-foreground"><span>Preview — the copy for</span> <bdi data-i18n-skip="true">{sample!.name}</bdi></p>
              <p className="mt-1 font-semibold text-foreground" data-i18n-skip="true"><bdi>{preview.title}</bdi></p>
              <div className="mt-1 space-y-2 text-foreground" data-i18n-skip="true">{preview.body.split(/\n{2,}/).map((p, i) => <p key={i} dir="auto">{p}</p>)}</div>
            </div>
          )}
          <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={email} disabled={started} onChange={(e) => setEmail(e.target.checked)} /> <span>Also by email</span></label>
          {send.isError && <Notice tone="danger">{(send.error as Error).message}</Notice>}
          {started && !finished && !send.isPending && (
            <Notice tone="info"><span>{`Already sent to ${countWords(people, 'person')}`}</span>. <span>Sending again sends only the rest.</span></Notice>
          )}
          {finished && (people > 0
            ? <Notice tone="success"><span>{`Sent to ${countWords(people, 'person')}`}</span>. <span>The deliveries are in Messages.</span></Notice>
            : <Notice tone="info">Nobody was left to remind: the families paid meanwhile.</Notice>)}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-6 py-3">
          <Button variant="outline" onClick={onClose}>{finished ? 'Close' : 'Cancel'}</Button>
          {!finished && (
            <Button onClick={() => send.mutate()} disabled={!templates.data || chosen.length === 0 || send.isPending}>
              {send.isPending ? 'Sending…' : started ? 'Send the rest' : `Remind ${countWords(chosen.length, 'family')}`}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
