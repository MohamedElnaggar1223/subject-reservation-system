import type { QueryClient } from '@tanstack/react-query';

type EscrowBalance = {
  balance: number;
};

type ChildEscrowBalance = {
  id: string;
  escrowBalance: number;
};

type FinancialCacheOptions = {
  studentId?: string | null;
  escrowDelta?: number;
};

function applyEscrowDelta(current: number, delta: number): number {
  return Math.max(0, current + delta);
}

export function invalidateFinancialState(
  queryClient: QueryClient,
  options: FinancialCacheOptions = {},
) {
  const { studentId, escrowDelta } = options;

  if (studentId && typeof escrowDelta === 'number' && escrowDelta !== 0) {
    queryClient.setQueryData<EscrowBalance>(
      ['escrow', 'balance', studentId],
      (balance) =>
        balance
          ? { ...balance, balance: applyEscrowDelta(balance.balance, escrowDelta) }
          : balance,
    );

    queryClient.setQueryData<ChildEscrowBalance[]>(
      ['escrow', 'children'],
      (children) =>
        children?.map((child) =>
          child.id === studentId
            ? { ...child, escrowBalance: applyEscrowDelta(child.escrowBalance, escrowDelta) }
            : child,
        ),
    );
  }

  queryClient.invalidateQueries({ queryKey: ['escrow'] });
  queryClient.invalidateQueries({ queryKey: ['payments'] });
  queryClient.invalidateQueries({ queryKey: ['finance'] });
  queryClient.invalidateQueries({ queryKey: ['registrations'] });
  queryClient.invalidateQueries({ queryKey: ['change-requests'] });
  queryClient.invalidateQueries({ queryKey: ['reports'] });
  queryClient.invalidateQueries({ queryKey: ['admin', 'escrow'] });
  queryClient.invalidateQueries({ queryKey: ['notifications'] });
}
