/**
 * Results Entry — Staff (V3 §5.4)
 *
 * One screen: pick a session, type grades inline, save all. Beats the
 * spreadsheet it replaces.
 */

import { requireFinance } from '~/lib/auth/session';
import ResultsEntryClient from './results-entry.client';

export const metadata = {
  title: 'Results Entry — IGCSE',
};

export default async function ResultsEntryPage(): Promise<React.JSX.Element> {
  await requireFinance();
  return <ResultsEntryClient />;
}
