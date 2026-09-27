/**
 * Whether a self-registered account must verify its email before it can
 * sign in (RF-22).
 *
 * An explicit REQUIRE_EMAIL_VERIFICATION wins. Unset means "yes" in
 * production and "no" elsewhere, so a production deploy that forgets the
 * variable fails safe instead of letting anyone register any address
 * unverified. Accounts staff create in person are marked verified and are
 * not affected: desk onboarding (desk.services.ts) and the admin's team form
 * (user.routes.ts POST /users, markEmailVerified).
 */
export function emailVerificationRequired(flag: string | undefined, nodeEnv: string | undefined): boolean {
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return nodeEnv === 'production';
}

/**
 * Whether a user is under a ban right now (RF-23). better-auth checks bans
 * only when a session is created, so the app checks on every request too.
 */
export function isBanned(u: { banned?: boolean | null; banExpires?: Date | string | null }, now = new Date()): boolean {
  if (!u.banned) return false;
  return !u.banExpires || new Date(u.banExpires) > now;
}
