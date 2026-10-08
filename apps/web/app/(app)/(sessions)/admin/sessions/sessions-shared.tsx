'use client';

/**
 * Shared by the Sessions and Session screens (RESERVATIONS_REWORK.md §4.1, §4.2, §4.6): the
 * fetchers — typed by the API, never by hand (PATTERNS.md) — and the small pieces every tab
 * shows. Text that carries a number, a name or a date is split into its own nodes so the page
 * translator (lib/i18n.tsx, lib/i18n-sessions.ts) finds the words.
 */

import { useEffect } from 'react';
import { api } from '~/lib/hono';
import { apiResponse, type SessionMoneyQueryType } from '@repo/validations';
import { Badge, type Tone } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { InstantText } from '~/app/(app)/exams/exams-shared';

// ─── Fetchers ────────────────────────────────────────────────────────────────

export const fetchSessions = () => apiResponse(api.v1.sessions.$get({ query: {} }));
export type SessionRow = Awaited<ReturnType<typeof fetchSessions>>[number];

export const fetchSession = (id: string) => apiResponse(api.v1.sessions[':id'].$get({ param: { id } }));
export type SessionDetail = Awaited<ReturnType<typeof fetchSession>>;
export type SessionSeries = SessionDetail['series'][number];

export const fetchOffers = (id: string) => apiResponse(api.v1.sessions[':id'].offers.$get({ param: { id } }));
export type OffersData = Awaited<ReturnType<typeof fetchOffers>>;
export type OfferRow = OffersData['offers'][number];
export type ItemRow = OfferRow['items'][number];

export const fetchAddable = (id: string) => apiResponse(api.v1.sessions[':id'].offers.addable.$get({ param: { id } }));
export type AddableRow = Awaited<ReturnType<typeof fetchAddable>>[number];

export const fetchFeeGrid = (seriesId: string) => apiResponse(api.v1['board-fees'].$get({ query: { seriesId } }));
export type FeeGrid = Awaited<ReturnType<typeof fetchFeeGrid>>;
export type FeeRow = FeeGrid['rows'][number];

export const fetchMoney = (id: string, query: Partial<SessionMoneyQueryType>) =>
  apiResponse(api.v1.sessions[':id'].money.$get({ param: { id }, query: { filter: query.filter ?? 'all', ...(query.offerId ? { offerId: query.offerId } : {}), ...(query.sectionId ? { sectionId: query.sectionId } : {}) } }));
export type MoneyData = Awaited<ReturnType<typeof fetchMoney>>;

export const SESSIONS_KEY = ['sessions'] as const;
export const sessionKey = (id: string) => ['sessions', id] as const;
export const offersKey = (id: string) => ['sessions', id, 'offers'] as const;
export const moneyKey = (id: string) => ['sessions', id, 'money'] as const;
export const feesKey = (seriesId: string) => ['board-fees', seriesId] as const;

// ─── Words ───────────────────────────────────────────────────────────────────

export const STATUS_TONE: Record<string, Tone> = { draft: 'neutral', active: 'success', closed: 'danger' };
export const STATUS_LABEL: Record<string, string> = { draft: 'Draft', active: 'Open', closed: 'Closed' };
export const AVAILABILITY_SHORT: Record<string, string> = {
  open: 'Open', retake_only: 'Retakes only', self_study_only: 'Self-study only', closed: 'Closed',
};
export const LINE_STATUS_LABEL: Record<string, string> = {
  pending_approval: 'Waiting for the parent', pending_payment: 'Unpaid', preregistered: 'Preregistered', confirmed: 'Paid',
  expired: 'Expired', dropped: 'Dropped', rejected: 'Rejected',
};
export const LINE_STATUS_TONE: Record<string, Tone> = {
  pending_approval: 'warning', pending_payment: 'warning', preregistered: 'info', confirmed: 'success', expired: 'neutral', dropped: 'neutral', rejected: 'neutral',
};

// ─── Pieces ──────────────────────────────────────────────────────────────────

const egp = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
/** An amount in pounds: "EGP 9,850" (the translator knows "EGP …"). */
export function Money({ amount, className }: { amount: number | null | undefined; className?: string }) {
  if (amount === null || amount === undefined) return <span className="text-muted-foreground">—</span>;
  return <span className={cn('whitespace-nowrap tabular-nums', className)} dir="ltr">{`EGP ${egp.format(amount)}`}</span>;
}

/** A date as the school reads it (Cairo), no time. */
export function Day({ iso }: { iso: string | null | undefined }) {
  return iso ? <InstantText iso={iso} time={false} /> : <span className="text-muted-foreground">—</span>;
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{STATUS_LABEL[status] ?? status}</Badge>;
}

export const INPUT_CLASS =
  'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50';
export const TEXTAREA_CLASS =
  'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-foreground">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A dialog over the page; Escape closes it. */
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className={cn('max-h-[90vh] w-full overflow-y-auto rounded-xl border border-border bg-card shadow-xl', wide ? 'max-w-3xl' : 'max-w-lg')}>
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="font-display text-lg font-semibold text-foreground">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

/** A panel at the page's end edge (a row's details); Escape closes it. */
export function Drawer({ title, subtitle, onClose, children }: { title: string; subtitle?: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="flex-1 cursor-default" aria-label="Close" onClick={onClose} />
      <div className="h-full w-full max-w-2xl overflow-y-auto border-s border-border bg-card shadow-xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border bg-card px-6 py-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground"><bdi data-i18n-skip="true">{title}</bdi></h2>
            {subtitle && <div className="mt-0.5 text-sm text-muted-foreground">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="space-y-6 px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

/** A datetime-local value in the browser's clock, from an instant. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** An error's sentence (the API's refusal, as it wrote it). */
export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong';
}

export function ErrorLine({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{message}</p>;
}
