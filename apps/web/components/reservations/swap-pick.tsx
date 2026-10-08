'use client';

/**
 * What a swap goes to (RESERVATIONS_REWORK.md §3.5): since step B a swap names its new line like
 * any reservation — the item, the entry and, where the offer has several, the teacher ("no
 * preference" until the coordinator assigns). The choices are read from the same offers the
 * Reserve page reads, with the price each would cost; a retake is offered where the system knows
 * the earlier sitting (a sitting to declare is the Reserve page's). The new line inherits the
 * dropped line's consent; a line from before the rework has none, and the family ticks both.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { InferRequestType } from 'hono/client';
import { api } from '~/lib/hono';
import { refundConsentText, DECLARATION_TEXT, type RefundPolicy } from '@repo/validations';
import { fetchReserveOffers, reserveOffersKey } from './reserve';

type SwapLine = InferRequestType<(typeof api.v1.registrations)[':id']['swap']['$post']>['json']['line'];

const ENTRY: Record<string, string> = {
  'first|in_school': 'first entry, in school',
  'first|self_study': 'first entry, self-study',
  'retake|in_school': 'retake, in school',
  'retake|self_study': 'retake, self-study',
};

export function useSwapChoices(sessionId: string, studentId: string, currentItemId: string | null) {
  const q = useQuery({ queryKey: reserveOffersKey(sessionId, studentId), queryFn: () => fetchReserveOffers(sessionId, studentId), retry: false });
  const choices = (q.data?.offers ?? []).flatMap((o) => o.items
    .filter((it) => it.id !== currentItemId && (it.open.first || it.open.retake) && !it.held)
    .flatMap((it) => it.prices
      .filter((p) => !p.noFee && p.open && (p.attempt === 'first' || it.knownSittings.length > 0) && (!it.needsPriorSeries || it.knownSittings.length > 0))
      .map((p) => {
        const line: SwapLine = { offerItemId: it.id, attempt: p.attempt, mode: p.mode, expectedPrice: p.total ?? undefined };
        if (p.mode === 'in_school' && it.teachers.length > 1) line.teacherId = null;
        return {
          key: `${it.id}|${p.attempt}|${p.mode}`,
          label: `${o.subject.name}${it.kind === 'whole' ? '' : ` — ${it.label}`} · ${ENTRY[`${p.attempt}|${p.mode}`]}`,
          price: p.total ?? 0,
          provisional: p.provisional,
          line,
        };
      })));
  const policy = (q.data?.session.refundPolicy ?? null) as RefundPolicy | null;
  return { ...q, choices, policy };
}

/** The family's two ticks, shown when the dropped line has no consent to give (converted from before the rework). */
export function SwapConsent({ policy, value, onChange }: { policy: RefundPolicy | null; value: { refund: boolean; decl: boolean }; onChange: (v: { refund: boolean; decl: boolean }) => void }) {
  return (
    <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-0.5 h-4 w-4" checked={value.refund} onChange={(e) => onChange({ ...value, refund: e.target.checked })} />
        <span>{refundConsentText(policy?.steps ? { kind: 'weeks', steps: policy.steps } : null)}</span>
      </label>
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-0.5 h-4 w-4" checked={value.decl} onChange={(e) => onChange({ ...value, decl: e.target.checked })} />
        <span>{DECLARATION_TEXT}</span>
      </label>
    </div>
  );
}

export function useSwapConsent() {
  const [needed, setNeeded] = useState(false);
  const [ticks, setTicks] = useState({ refund: false, decl: false });
  return {
    needed,
    ticks,
    setTicks,
    /** An error that asks for the ticks turns them on. */
    onError: (message: string) => { if (message.startsWith('Tick the refund policy and the declaration')) setNeeded(true); },
    consent: needed && ticks.refund && ticks.decl ? { refundPolicy: true as const, declaration: true as const } : undefined,
    blocked: needed && !(ticks.refund && ticks.decl),
  };
}
