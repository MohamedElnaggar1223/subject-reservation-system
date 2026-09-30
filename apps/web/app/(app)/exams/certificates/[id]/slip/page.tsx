/**
 * A certificate's collection slip, printed for the collector to sign
 * (docs/features/EXAM_ENTRIES.md §5): the desk, the coordinator and the admin.
 */

import { requireStudentRecords } from '~/lib/auth/session';
import SlipClient from './slip.client';

export const metadata = {
  title: 'Certificate collection slip — IGCSE',
};

export default async function CertificateSlipPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ print?: string }>;
}): Promise<React.JSX.Element> {
  await requireStudentRecords();
  const [{ id }, { print }] = await Promise.all([params, searchParams]);
  return <SlipClient id={id} autoPrint={print === '1'} />;
}
