/**
 * Board services (RESERVATIONS_REWORK.md §3.6): the catalogue per board, and per series each
 * service's last date and fees.
 */

import { requireAuth } from '~/lib/auth/session';
import ServicesClient from './services.client';

export const metadata = {
  title: 'Board services — IGCSE',
};

export default async function BoardServicesPage(): Promise<React.JSX.Element> {
  const session = await requireAuth();
  return <ServicesClient viewerRole={session.user.role ?? null} />;
}
