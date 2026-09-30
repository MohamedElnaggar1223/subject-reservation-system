/**
 * The leave pass (FEATURES_PLAN.md F2, "The gate"): a signed, expiring token
 * the family's screen shows as a QR code and the gate scans.
 *
 *   L1.<leave id>.<pass version>.<expires, Unix seconds>.<signature>
 *
 * The signature is the first 16 bytes of HMAC-SHA256 over everything before
 * it, base64url, under a key derived from LEAVE_PASS_SECRET or, when that is
 * not set, from BETTER_AUTH_SECRET with a label of its own (so the pass key
 * is never the session key). A pass expires at the end of its leave's date in
 * Cairo. It proves the leave was approved for today; it never replaces the
 * gate's check of who collects. Reissuing a pass bumps the leave's
 * `pass_version`, so a copy of the old one is refused; a leave cancelled,
 * already checked out, or for another day is refused whatever the pass says.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { env } from '../env';

const PREFIX = 'L1';

function passKey(): Buffer {
  const secret = env.LEAVE_PASS_SECRET || env.BETTER_AUTH_SECRET;
  return createHmac('sha256', secret).update('igcse campus-leave pass v1').digest();
}

function sign(body: string): string {
  return createHmac('sha256', passKey()).update(body).digest().subarray(0, 16).toString('base64url');
}

/** The pass for a leave: its token and when it stops working. */
export function signLeavePass(leaveId: string, version: number, expiresAt: Date): { token: string; expiresAt: Date } {
  const exp = Math.floor(expiresAt.getTime() / 1000);
  const body = `${PREFIX}.${leaveId}.${version}.${exp}`;
  return { token: `${body}.${sign(body)}`, expiresAt: new Date(exp * 1000) };
}

export type PassCheck =
  | { ok: true; leaveId: string; version: number; expiresAt: Date }
  | { ok: false; reason: 'malformed' | 'forged' | 'expired'; leaveId: string | null };

/** Read a scanned token: its signature, then its expiry. The leave itself is checked by the caller. */
export function readLeavePass(token: string, now: Date = new Date()): PassCheck {
  const parts = token.trim().split('.');
  if (parts.length !== 5 || parts[0] !== PREFIX) return { ok: false, reason: 'malformed', leaveId: null };
  const [, leaveId, v, e, sig] = parts as [string, string, string, string, string];
  const version = Number(v);
  const exp = Number(e);
  if (!/^[0-9a-f-]{36}$/i.test(leaveId) || !Number.isInteger(version) || version < 1 || !Number.isInteger(exp)) {
    return { ok: false, reason: 'malformed', leaveId: null };
  }
  const expected = Buffer.from(sign(`${PREFIX}.${leaveId}.${version}.${exp}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'forged', leaveId };
  if (exp * 1000 <= now.getTime()) return { ok: false, reason: 'expired', leaveId };
  return { ok: true, leaveId, version, expiresAt: new Date(exp * 1000) };
}
