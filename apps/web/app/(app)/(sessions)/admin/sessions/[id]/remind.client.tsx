'use client';

/**
 * "Remind" on the session's Money tab (RESERVATIONS_REWORK.md §4.6, step D): the payment reminder
 * to the families the tab shows — its filter, subject and section — now, as a batch audience
 * ("a session's unpaid families"). The dialog lists the families it found with what each owes,
 * all ticked; untick any; one click sends. It goes through POST /v1/messages, the money-list path
 * the finance officer may use. Lines that cannot be paid yet (a provisional board fee) and lines
 * paid by an instalment plan are not in it; a plan's instalments are.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, renderMessage } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Notice } from '~/components/ui/tone';
import { LoadingState } from '~/components/ui/query-state';
import { resolveAudience, fetchTemplates, MESSAGES_KEY, TEMPLATES_KEY } from '~/app/(app)/(messages)/admin/messages/messages-shared';
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

function RemindDialog({ sessionId, filter, offerId, sectionId, onClose }: { sessionId: string; filter: string; offerId: string; sectionId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const definition = {
    kind: 'batch' as const, list: 'session_unpaid' as const, sessionId,
    include: offerId ? 'lines' as const : 'both' as const, filter: filter === 'overdue' ? 'overdue' as const : 'unpaid' as const,
    ...(offerId ? { offerId } : {}), ...(sectionId ? { sectionId } : {}), who: 'families' as const,
  };
  const found = useQuery({ queryKey: [...MESSAGES_KEY, 'remind', JSON.stringify(definition)], queryFn: () => resolveAudience({ definition }) });
  const templates = useQuery({ queryKey: TEMPLATES_KEY, queryFn: fetchTemplates });
  const template = templates.data?.find((t) => t.key === 'payment_due') ?? null;
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [email, setEmail] = useState(true);
  const students = found.data?.students ?? [];
  const chosen = students.filter((s) => !unticked.has(s.id));
  const send = useMutation({
    mutationFn: () => apiResponse(api.v1.messages.$post({
      json: { audience: { definition: { ...definition, studentIds: chosen.map((s) => s.id) } }, templateId: template!.id, channels: email ? ['in_app', 'email'] : ['in_app'] },
    })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MESSAGES_KEY }),
  });
  const sample = found.data?.sample.find((s) => chosen.some((c) => c.name === s.student || c.name === s.name)) ?? found.data?.sample[0];
  const preview = template && sample ? renderMessage({ titleEn: template.titleEn, bodyEn: template.bodyEn, titleAr: template.titleAr, bodyAr: template.bodyAr }, 'both', sample.vars) : null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="remind-title">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-card shadow-xl">
        <div className="border-b border-border px-6 py-4">
          <h2 id="remind-title" className="font-display text-lg font-bold text-foreground">Remind these families</h2>
          <p className="mt-1 text-sm text-muted-foreground">The payment reminder, now, to the parents and the student of each family ticked: what they owe in this session and by when.</p>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {found.isLoading ? <LoadingState /> : found.isError ? <Notice tone="danger">{(found.error as Error).message}</Notice> : students.length === 0 ? (
            <Notice tone="info">No family here owes anything that can be paid now.</Notice>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border text-sm">
              {students.map((s) => (
                <li key={s.id}>
                  <label className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="inline-flex items-center gap-2">
                      <input type="checkbox" checked={!unticked.has(s.id)}
                        onChange={(e) => { const next = new Set(unticked); if (e.target.checked) next.delete(s.id); else next.add(s.id); setUnticked(next); }} />
                      <bdi data-i18n-skip="true">{s.name}</bdi>
                    </span>
                    <span className="text-xs text-muted-foreground"><Money amount={s.amount} />{s.dueAt && <> · <span>due</span> <Day iso={String(s.dueAt)} /></>}</span>
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
          <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> <span>Also by email</span></label>
          {send.isError && <Notice tone="danger">{(send.error as Error).message}</Notice>}
          {send.isSuccess && <Notice tone="success"><span>Sent to</span> <span>{send.data.people}</span> <span>{send.data.people === 1 ? 'person' : 'people'}</span>. <span>The deliveries are in Messages.</span></Notice>}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-6 py-3">
          <Button variant="outline" onClick={onClose}>{send.isSuccess ? 'Close' : 'Cancel'}</Button>
          {!send.isSuccess && (
            <Button onClick={() => send.mutate()} disabled={!template || chosen.length === 0 || send.isPending}>
              {send.isPending ? 'Sending…' : <><span>Remind</span> <span>{chosen.length}</span> <span>{chosen.length === 1 ? 'family' : 'families'}</span></>}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
