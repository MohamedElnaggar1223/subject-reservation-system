/**
 * The gate (FEATURES_PLAN.md F2): today's leave, a pass scanned, check-out,
 * returns. The gate role; the coordinator and the admin can stand in.
 */

import { requireRole } from '~/lib/auth/session';
import GateClient from './gate.client';

export const metadata = {
  title: 'Gate — IGCSE',
};

export default async function GatePage(): Promise<React.JSX.Element> {
  await requireRole(['gate', 'coordinator', 'admin']);
  return <GateClient />;
}
