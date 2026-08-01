/**
 * The Desk — staff home (UX_AUDIT G1/G2/G5)
 *
 * One screen for a family standing at the desk: find the student, see
 * everything, and act — onboard, register + take money, collect the
 * school fee, hand or take back receipts, print them.
 */

import { requireFinance } from '~/lib/auth/session';
import DeskClient from './desk.client';

export const metadata = {
  title: 'Desk — IGCSE',
};

export default async function DeskPage(): Promise<React.JSX.Element> {
  await requireFinance();
  return <DeskClient />;
}
