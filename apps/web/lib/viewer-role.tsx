'use client';

/**
 * The signed-in person's role, for the pieces of a page that read it without being handed it: the links to a
 * screen outside the reservation cycle are hidden for the role that cannot reach it (lib/reservation-focus.ts,
 * `leadsOutsideTheCycle`). The app's shell (components/nav-shell.tsx) provides it from the server's session.
 */

import { createContext, useContext } from 'react';

const ViewerRoleContext = createContext<string | null>(null);

export const ViewerRoleProvider = ViewerRoleContext.Provider;

export function useViewerRole(): string | null {
  return useContext(ViewerRoleContext);
}
