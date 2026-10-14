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
import { DECLARATION_TEXT } from '@repo/validations';
import { fetchReserveOffers, reserveOffersKey, useRefundTerms, RefundTermsSentence, type RefundTermsState } from './reserve';

type SwapLine = InferRequestType<(typeof api.v1.registrations)[':id']['swap']['$post']>['json']['line'];

const ENTRY: Record<string, string> = {
  'first|in_school': 'first entry, in school',
  'first|self_study': 'first entry, self-study',
  'retake|in_school': 'retake, in school',
  'retake|self_study': 'retake, self-study',
};

/** A swap's retake follows a sitting the student sat (a confirmed line); a declared one goes through the Reserve page. */
const sat = (it: { knownSittings: { status: string; source: string }[] }) => it.knownSittings.some((k) => k.source !== 'line' || k.status === 'confirmed');

export function useSwapChoices(sessionId: string, studentId: string, currentItemId: string | null) {
  const q = useQuery({ queryKey: reserveOffersKey(sessionId, studentId), queryFn: () => fetchReserveOffers(sessionId, studentId), retry: false });
  const choices = (q.data?.offers ?? []).flatMap((o) => o.items
    .filter((it) => it.id !== currentItemId && (it.open.first || it.open.retake) && !it.held)
    .flatMap((it) => it.prices
      .filter((p) => !p.noFee && p.open && (p.attempt === 'first' || sat(it)) && (!it.needsPriorSeries || sat(it)))
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
  // What the family's tick freezes when the dropped line has no consent to give (weeks, or dates).
  const terms = useRefundTerms(sessionId);
  return { ...q, choices, terms };
}

/** The family's two ticks, shown when the dropped line has no consent to give (converted from before the rework). */
export function SwapConsent({ terms, value, onChange }: { terms: RefundTermsState; value: { refund: boolean; decl: boolean }; onChange: (v: { refund: boolean; decl: boolean }) => void }) {
  return (
    <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-0.5 h-4 w-4" checked={value.refund} disabled={!terms.ready} onChange={(e) => onChange({ ...value, refund: e.target.checked })} />
        <RefundTermsSentence state={terms} />
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
