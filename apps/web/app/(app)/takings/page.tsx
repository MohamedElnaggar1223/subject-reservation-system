/**
 * Daily Takings (UX_AUDIT G4)
 *
 * End-of-day cash-drawer reconciliation: one date, every confirmed
 * payment, per-instrument totals, printable.
 */

import { requireFinance } from '~/lib/auth/session';
import TakingsClient from './takings.client';

export const metadata = {
  title: 'Daily Takings — IGCSE',
};

export default async function TakingsPage(): Promise<React.JSX.Element> {
  await requireFinance();
  return <TakingsClient />;
}
