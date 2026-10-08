/**
 * Charges and instalments, the family's (RESERVATIONS_REWORK.md §3.6, §3.10): what is owed beside
 * the subjects, paid at the desk or by InstaPay.
 */

import { requireRole } from '~/lib/auth/session';
import { ROLES } from '@repo/validations';
import ChargesDueClient from './charges-due.client';

export const metadata = {
  title: 'Charges and instalments — IGCSE',
};

export default async function ChargesDuePage(): Promise<React.JSX.Element> {
  const session = await requireRole([ROLES.PARENT, ROLES.STUDENT]);
  return <ChargesDueClient viewerRole={session.user.role ?? null} />;
}
