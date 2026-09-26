'use client';

/**
 * Home Summary Card (UX_AUDIT — app-first destination)
 *
 * Leads the parent/student dashboard with ACTIONS, not links: what the
 * family owes, what is waiting on them, and a one-click path to each.
 * The self-serve mirror of the staff Student 360.
 */

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '~/lib/hono';
import { apiResponse } from '@repo/validations';
import { formatPrice } from '~/lib/format';

// Explicit type — this endpoint's RPC inference degrades in the web
// compile (documented pattern; see PATTERNS.md)
type ChildSummary = {
  student: { id: string; name: string; grade: number | null };
  owing: number;
  owingRegistrationIds: string[];
  escrow: { freeBalance: number; heldBalance: number };
  schoolFee: { academicYear: string; required: boolean; waived: boolean; paid: boolean; amount: number | null };
  pendingApprovalCount: number;
  pendingChangeRequestCount: number;
  receiptsToReturn: number;
  preregisteredUnpaid: number;
};

type HomeSummary = {
  role: 'parent' | 'student';
  children: ChildSummary[];
  totals: { owing: number; actionsNeeded: number };
  openSessions: { id: string; name: string; endDate: string; qualificationLevel: string }[];
};

type Action = { label: string; href: string; tone: 'pay' | 'act' | 'info' };

const TONES: Record<Action['tone'], string> = {
  pay: 'bg-brand-600 text-white hover:bg-brand-700',
  act: 'bg-amber-600 text-white hover:bg-amber-700',
  info: 'bg-card text-foreground border border-border hover:bg-muted',
};

function buildActions(s: HomeSummary): Action[] {
  const isParent = s.role === 'parent';
  const many = s.children.length > 1;
  const actions: Action[] = [];

  for (const c of s.children) {
    const who = many ? ` — ${c.student.name}` : '';

    if (c.schoolFee.required && !c.schoolFee.paid) {
      actions.push({
        label: isParent
          ? `Pay the ${c.schoolFee.academicYear} school fee${c.schoolFee.amount != null ? ` (${formatPrice(c.schoolFee.amount)})` : ''}${who}`
          : `School fee unpaid${who} — ask your parent`,
        href: isParent ? `/school-fee?studentId=${c.student.id}` : '/registrations',
        tone: isParent ? 'pay' : 'info',
      });
    }

    if (c.owing > 0) {
      actions.push({
        label: isParent
          ? `Pay ${formatPrice(c.owing)} for registered subjects${who}`
          : `${formatPrice(c.owing)} awaiting payment${who}`,
        href: isParent
          ? `/checkout?ids=${c.owingRegistrationIds.join(',')}`
          : '/registrations',
        tone: isParent ? 'pay' : 'info',
      });
    }

    if (isParent && c.pendingApprovalCount > 0) {
      actions.push({
        label: `Approve ${c.pendingApprovalCount} subject request${c.pendingApprovalCount === 1 ? '' : 's'}${who}`,
        href: '/approvals',
        tone: 'act',
      });
    }

    if (isParent && c.pendingChangeRequestCount > 0) {
      actions.push({
        label: `Review ${c.pendingChangeRequestCount} drop/swap request${c.pendingChangeRequestCount === 1 ? '' : 's'}${who}`,
        href: '/approvals',
        tone: 'act',
      });
    }

    if (c.receiptsToReturn > 0) {
      actions.push({
        label: `Return ${c.receiptsToReturn} receipt${c.receiptsToReturn === 1 ? '' : 's'} to the school${who} to release the refund`,
        href: '/registrations',
        tone: 'act',
      });
    }

    if (isParent && c.preregisteredUnpaid > 0) {
      actions.push({
        label: `${c.preregisteredUnpaid} preregistered subject${c.preregisteredUnpaid === 1 ? '' : 's'} awaiting payment${who}`,
        href: '/registrations',
        tone: 'pay',
      });
    }
  }

  return actions;
}

export default function HomeSummaryCard(): React.JSX.Element | null {
  const { data, isLoading, isError } = useQuery<HomeSummary>({
    queryKey: ['home-summary'],
    queryFn: async () =>
      (await apiResponse(api.v1.users.me['home-summary'].$get())) as HomeSummary,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="mb-8 rounded-xl border border-border bg-card p-6 shadow-sm animate-pulse">
        <div className="h-4 w-40 rounded bg-muted" />
        <div className="mt-3 h-8 w-64 rounded bg-muted" />
      </div>
    );
  }

  // Non-fatal: the dashboard's quick links still render below
  if (isError || !data) return null;

  const isParent = data.role === 'parent';
  const actions = buildActions(data);

  // Parent with no linked children — the true first-run state
  if (isParent && data.children.length === 0) {
    return (
      <div className="mb-8 rounded-xl border border-amber-200 bg-amber-50 p-6 dark:border-amber-700 dark:bg-amber-900/20">
        <h2 className="font-semibold text-amber-900 dark:text-amber-200">Start by linking your child</h2>
        <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
          You need a linked child before you can register subjects or pay fees. If your child
          already has an account, request the link; otherwise the school office can set both up
          for you in one visit.
        </p>
        <Link
          href="/links"
          className="mt-3 inline-flex items-center rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700"
        >
          Link my child →
        </Link>
      </div>
    );
  }

  const nothingToDo = actions.length === 0;

  return (
    <div className="mb-8 rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-bold text-foreground">
            {nothingToDo ? 'You\u2019re all caught up' : 'What needs you'}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {nothingToDo
              ? isParent
                ? 'Nothing is owed and nothing is waiting for your approval.'
                : 'Nothing is waiting on you right now.'
              : isParent
                ? 'Everything outstanding for your family, in one place.'
                : 'Here is where things stand.'}
          </p>
        </div>

        {data.totals.owing > 0 && (
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Total outstanding</p>
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
              {formatPrice(data.totals.owing)}
            </p>
          </div>
        )}
      </div>

      {!nothingToDo && (
        <div className="mt-4 flex flex-col gap-2">
          {actions.map((a) => (
            <Link
              key={`${a.label}-${a.href}`}
              href={a.href as never}
              className={`inline-flex items-center justify-between gap-3 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${TONES[a.tone]}`}
            >
              <span>{a.label}</span>
              <span aria-hidden>→</span>
            </Link>
          ))}
        </div>
      )}

      {/* Balances worth knowing without hunting for them */}
      {data.children.some((c) => c.escrow.freeBalance > 0 || c.escrow.heldBalance > 0) && (
        <div className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
          {data.children
            .filter((c) => c.escrow.freeBalance > 0 || c.escrow.heldBalance > 0)
            .map((c) => (
              <p key={c.student.id}>
                {data.children.length > 1 ? `${c.student.name}: ` : 'Wallet: '}
                {formatPrice(c.escrow.freeBalance)} available
                {c.escrow.heldBalance > 0 && (
                  <> · {formatPrice(c.escrow.heldBalance)} held for preregistered subjects</>
                )}
              </p>
            ))}
        </div>
      )}

      {/* Registration windows closing — the deadline nobody should miss */}
      {data.openSessions.length > 0 && (
        <div className="mt-3 text-xs text-muted-foreground">
          Open now:{' '}
          {data.openSessions
            .map((s) => `${s.name} (closes ${new Date(s.endDate).toLocaleDateString()})`)
            .join(' · ')}
        </div>
      )}
    </div>
  );
}
