import { requireAuth } from '~/lib/auth/session';
import { redirect } from 'next/navigation';
import NavShell from '~/components/nav-shell';

/**
 * M-1: Client-side enforcement of AUTH-001/002 "Email verification required".
 *
 * Better-auth has a server config (`requireEmailVerification`) that gates
 * sign-in when enabled, but that flag defaults to false in dev and depends
 * on env. This layout adds a belt-and-braces check: no matter what the
 * server policy is, unverified users cannot access the authenticated app
 * shell — they get bounced to /verify-email with a resend prompt.
 *
 * Admins and finance staff are exempted because they're seeded/provisioned
 * outside the normal sign-up flow and shouldn't be locked out if their
 * emailVerified flag was never set.
 */
const VERIFICATION_EXEMPT_ROLES = ['admin', 'finance_officer', 'finance_admin'];
const EMAIL_VERIFICATION_ENFORCED =
  process.env.REQUIRE_EMAIL_VERIFICATION === 'true' ||
  process.env.NODE_ENV === 'production';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireAuth();

  // Users who haven't completed role setup need to pick student/parent first
  if (!session.user.role || session.user.role === 'user') {
    redirect('/complete-setup');
  }

  if (
    EMAIL_VERIFICATION_ENFORCED &&
    !VERIFICATION_EXEMPT_ROLES.includes(session.user.role) &&
    session.user.emailVerified === false
  ) {
    redirect('/verify-email?reason=unverified');
  }

  return (
    <NavShell
      userName={session.user.name}
      userRole={session.user.role}
      userEmail={session.user.email}
    >
      {children}
    </NavShell>
  );
}
