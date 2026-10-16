'use client';

/**
 * The school's name for the sign-in, sign-up and account pages (the lead's decision of 16 Oct 2026, 15):
 * read once on the server by app/(auth)/layout.tsx from the public read (`GET /v1/settings/public`) and
 * handed to the pages' brand through this context. Empty — the setting not set — the app's name stands alone.
 */

import { createContext, useContext } from 'react';

const SchoolNameContext = createContext('');

export function SchoolNameProvider({ name, children }: { name: string; children: React.ReactNode }): React.JSX.Element {
  return <SchoolNameContext.Provider value={name}>{children}</SchoolNameContext.Provider>;
}

/** The school's name as the admin set it on Settings, or '' when it is not set. */
export function useSchoolName(): string {
  return useContext(SchoolNameContext);
}
