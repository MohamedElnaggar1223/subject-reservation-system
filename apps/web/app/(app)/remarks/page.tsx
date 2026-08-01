/**
 * Remarks Page — Students & Parents (V3 §6.10)
 *
 * Request post-results services (re-marks) per paper, approve child
 * requests, attest consent, and pay the fee.
 */

import { requireAuth } from '~/lib/auth/session';
import { redirect } from 'next/navigation';
import RemarksClient from './remarks.client';

export const metadata = {
  title: 'Remarks — IGCSE',
};

export default async function RemarksPage(): Promise<React.JSX.Element> {
  const session = await requireAuth();
  const role = session.user.role ?? '';
  if (role !== 'student' && role !== 'parent') redirect('/');
  return <RemarksClient userRole={role} userId={session.user.id} />;
}
