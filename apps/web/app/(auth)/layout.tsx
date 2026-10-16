import type { JSX } from 'react';
import { hc } from 'hono/client';
import type { AppType } from '@repo/api';
import { apiResponse } from '@repo/validations';
import { env } from '~/env';
import { SchoolNameProvider } from '~/components/school-name';

/**
 * The sign-in, sign-up and account pages carry the school's name above the app's name (the lead's decision
 * of 16 Oct 2026, 15). It is read here, on the server, for a visitor who is not signed in — the public read
 * answers `{ schoolName }` alone — so the page arrives with it and nothing moves once it loads.
 */
async function schoolName(): Promise<string> {
  try {
    return (await apiResponse(hc<AppType>(env.apiUrl).v1.settings.public.$get())).schoolName;
  } catch (err) {
    // The name is the page's heading, not its use: an API that does not answer leaves the app's name alone
    // and the sign-in form working; the failure is logged, not hidden.
    console.warn('[auth] the school name could not be read:', err instanceof Error ? err.message : err);
    return '';
  }
}

export default async function AuthPagesLayout({ children }: { children: React.ReactNode }): Promise<JSX.Element> {
  return <SchoolNameProvider name={await schoolName()}>{children}</SchoolNameProvider>;
}
