/**
 * Printing a timetable (FEATURES_PLAN.md F1): every section, teacher or room
 * on its own page — the coordinator's and the admin's.
 */

import PrintClient from './print.client';

export const metadata = {
  title: 'Print the timetable — IGCSE',
};

export default async function PrintPage({ params }: { params: Promise<{ id: string }> }): Promise<React.JSX.Element> {
  const { id } = await params;
  return <PrintClient id={id} />;
}
