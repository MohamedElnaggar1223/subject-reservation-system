/**
 * Exceptions (RESERVATIONS_REWORK.md §3.7, §4.7): grant, list, revoke, and "Check these".
 * The form offers only what the policy registry lets this role grant (GET /v1/policies).
 */

import { requireAuth } from '~/lib/auth/session';
import ExceptionsAdminClient from './exceptions-admin.client';

export const metadata = {
  title: 'Exceptions — IGCSE Admin',
};

export default async function ExceptionsAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<React.JSX.Element> {
  const session = await requireAuth();
  // Opened from the Student 360 or a line: the student (and the line) already chosen.
  const q = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === 'string' && v ? v : undefined);
  return <ExceptionsAdminClient viewerRole={session.user.role ?? null} prefill={{ studentId: one(q.studentId), registrationId: one(q.registrationId), policyKey: one(q.policyKey) }} />;
}
