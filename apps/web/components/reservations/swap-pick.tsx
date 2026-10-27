'use client';

/**
 * What a swap goes to (RESERVATIONS_REWORK.md §3.5; COORDINATOR_REWORK.md F4): a swap names its new line like any
 * reservation — the row, the option and, where the family chooses among several teachers (D5), the teacher. The
 * choices are the family read's (components/reservations/offers.ts, v2), with the price each would cost; a retake
 * is offered where the school knows the earlier exam (one to declare is the reservation page's). Swapping goes
 * only to a subject that still takes reservations (F4). The new line inherits the dropped line's consent; a line
 * from before the rework has none, and the family ticks both.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { InferRequestType } from 'hono/client';
import { api } from '~/lib/hono';
import { DECLARATION_TEXT } from '@repo/validations';
import { useI18n } from '~/lib/i18n';
import { useRefundTerms, RefundTermsSentence, type RefundTermsState } from './reserve';
import { fetchReserveOffers, reserveOffersKey, optionKey } from './offers';
import { fetchStatement, statementKey } from './statement';

const LIVE = ['pending_approval', 'pending_payment', 'confirmed'];

type SwapLine = InferRequestType<(typeof api.v1.registrations)[':id']['swap']['$post']>['json']['line'];

export function useSwapChoices(sessionId: string, studentId: string, currentItemId: string | null) {
  const { language } = useI18n();
  const q = useQuery({ queryKey: reserveOffersKey(sessionId, studentId), queryFn: () => fetchReserveOffers(sessionId, studentId), retry: false });
  const pricesFinal = !!q.data?.session.pricesFinal;
  // What the student already holds in the session, but the line being swapped: never offered again (SAME_ENTRY_ONCE),
  // nor a row it excludes (D8, EXCLUSIVE_OPTIONS).
  const statementQuery = { studentId };
  const statement = useQuery({ queryKey: statementKey(statementQuery), queryFn: () => fetchStatement(statementQuery), retry: false });
  const heldItems = new Set((statement.data?.students.find((s) => s.student.id === studentId) ?? statement.data?.students[0])
    ?.sessions.find((x) => x.id === sessionId)?.lines
    .filter((l) => LIVE.includes(l.status) && l.offerItemId !== currentItemId).map((l) => l.offerItemId) ?? []);
  const excluded = (o: { rows: { id: string; exclusiveGroup: string | null }[] }, r: { id: string; exclusiveGroup: string | null }) =>
    heldItems.has(r.id) || (!!r.exclusiveGroup && o.rows.some((x) => x.exclusiveGroup === r.exclusiveGroup && heldItems.has(x.id)));
  const choices = (q.data?.offerings ?? []).filter((o) => o.accepting).flatMap((o) => o.rows
    .filter((r) => r.id !== currentItemId && !r.closed && !excluded(o, r))
    .flatMap((r) => r.options
      // A retake, or a row that carries an earlier exam, only where the school knows it (it is filled in).
      .filter((x) => x.price && (x.attempt === 'first' && !x.needsCarriedFrom ? true : !!r.knownSitting))
      .flatMap((x) => {
        const several = x.mode === 'in_school' && o.teacherChoice === 'families' && !o.teacherTbc && x.teachers.length > 1;
        // Where the family chooses the teacher (D5), one choice per teacher: the swap names it.
        const teachers: ({ id: string; name: string; online: boolean } | null)[] = several ? x.teachers : [null];
        return teachers.map((t) => {
          const line: SwapLine = { offerItemId: r.id, attempt: x.attempt, mode: x.mode, expectedPrice: x.price!.total, ...(t ? { teacherId: t.id } : {}) };
          return {
            key: `${r.id}|${optionKey(x)}|${t?.id ?? ''}`,
            label: `${o.name} — ${x.label[language]}${t ? ` · ${t.name}${t.online ? ' (online)' : ''}` : ''}`,
            price: x.price!.total,
            notFinal: !pricesFinal,
            line,
          };
        });
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
