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
