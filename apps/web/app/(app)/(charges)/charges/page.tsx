/**
 * Charges (RESERVATIONS_REWORK.md §3.6, §3.10): every charge by family and status; accept,
 * cancel, collect at the desk, refund, add.
 */

import { requireAuth } from '~/lib/auth/session';
import ChargesClient from './charges.client';

export const metadata = {
  title: 'Charges — IGCSE',
};

export default async function ChargesPage(): Promise<React.JSX.Element> {
  const session = await requireAuth();
  return <ChargesClient viewerRole={session.user.role ?? null} />;
}
