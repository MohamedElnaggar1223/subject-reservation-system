/**
 * Remarks Desk — Staff (V3 §6.10)
 *
 * The school is the exam centre: staff submit approved+paid requests to
 * the board and record outcomes (fee auto-refunds on grade change).
 * Finance admins also configure fees and per-series deadlines here.
 */

import { requireFinance } from '~/lib/auth/session';
import RemarksDeskClient from './remarks-desk.client';

export const metadata = {
  title: 'Remarks Desk — IGCSE',
};

export default async function RemarksDeskPage(): Promise<React.JSX.Element> {
  const session = await requireFinance();
  return <RemarksDeskClient userRole={session.user.role ?? ''} />;
}
