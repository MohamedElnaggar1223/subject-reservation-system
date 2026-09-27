import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';

/**
 * The client address used to key rate limits (RF-11).
 *
 * Only a header the deployment names in CLIENT_IP_HEADER is trusted, and
 * only because a proxy in front of the API (Cloudflare's cf-connecting-ip,
 * or a load balancer's x-real-ip) overwrites whatever the client sent. With
 * no such proxy the header is just client input: trusting it let anyone
 * send a new "address" on every request and never be throttled, which made
 * password guessing against staff accounts unlimited.
 *
 * Without a configured header the socket's remote address is used. Behind
 * a proxy that address is the proxy's, so every user would share one
 * bucket; that is why a proxied deployment must set CLIENT_IP_HEADER.
 *
 * Name a header the proxy OVERWRITES (cf-connecting-ip, x-real-ip). If it
 * must be x-forwarded-for, the RIGHTMOST entry is taken: that is the one
 * the nearest proxy appended, while everything to its left arrived from the
 * client and can be anything. This is only right with exactly one proxy in
 * front. And cf-connecting-ip is only trustworthy if the origin refuses
 * traffic that did not come through Cloudflare.
 */
export function clientIp(
  c: Pick<Context, 'req' | 'env'>,
  trustedHeader: string | undefined
): string {
  if (trustedHeader) {
    const value = c.req.header(trustedHeader)?.split(',').at(-1)?.trim();
    if (value) return value;
  }
  try {
    const info = getConnInfo(c as Context);
    if (info.remote.address) return info.remote.address;
  } catch {
    // Not running under @hono/node-server (e.g. in-process tests).
  }
  return 'unknown';
}

/**
 * The rate-limit bucket for an address. IPv4 counts per address. IPv6 counts
 * per /64: one subscriber usually holds a whole /64, so keying on the full
 * address would let a single attacker rotate through billions of addresses
 * and never be throttled. An IPv4-mapped IPv6 address counts as its IPv4.
 * Audit rows keep the exact address; only the limiter groups.
 */
export function rateLimitKey(address: string): string {
  const addr = address.split('%')[0]!.trim().toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(addr);
  if (mapped) return mapped[1]!;
  if (!addr.includes(':')) return addr;
  const [head, tail] = addr.split('::') as [string, string | undefined];
  const h = head ? head.split(':') : [];
  const t = tail === undefined ? [] : tail ? tail.split(':') : [];
  const groups = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '') || '0').join(':') + '::/64';
}
