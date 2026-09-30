/**
 * The leave policy (FEATURES_PLAN.md F2): the coordinator and the admin (the
 * settings store decides who may change each rule).
 */

import { requireRole } from '~/lib/auth/session';
import PolicyClient from './policy.client';

export const metadata = {
  title: 'Leave policy — IGCSE',
};

export default async function LeavePolicyPage(): Promise<React.JSX.Element> {
  await requireRole(['coordinator', 'admin']);
  return <PolicyClient />;
}
