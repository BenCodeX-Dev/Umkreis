/**
 * Token buckets for API calls that reach third-party services (Ticketmaster quota, Nominatim and
 * Panoramax usage policies). One bucket per client address plus one shared bucket, so neither a single
 * client nor many clients together can turn this server into a fast proxy for those services.
 * State is in memory only. Behind a reverse proxy, set TRUST_PROXY=1 so each client is counted by the
 * address the proxy reports (see `clientAddress`); otherwise all clients share the proxy's address.
 */
export interface RateLimit {
  /** Requests a client may make in a burst. */
  capacity: number;
  /** Requests per second a client gets back. */
  refillPerSec: number;
}

export const CLIENT_LIMIT: RateLimit = { capacity: 60, refillPerSec: 1 };
export const GLOBAL_LIMIT: RateLimit = { capacity: 300, refillPerSec: 5 };
const MAX_CLIENTS = 1000;

type Bucket = { tokens: number; at: number };

function refill(b: Bucket, limit: RateLimit, t: number): void {
  b.tokens = Math.min(limit.capacity, b.tokens + ((t - b.at) / 1000) * limit.refillPerSec);
  b.at = t;
}

/** Returns `take(client)`: 0 when the request may proceed, otherwise the seconds to wait. */
export function createRateLimiter(client = CLIENT_LIMIT, shared = GLOBAL_LIMIT, now = () => Date.now()) {
  const buckets = new Map<string, Bucket>();
  const all: Bucket = { tokens: shared.capacity, at: now() };

  return function take(key: string): number {
    const t = now();
    let b = buckets.get(key);
    if (b) {
      refill(b, client, t);
      buckets.delete(key); // re-insert below so the Map stays ordered by last use
    } else {
      b = { tokens: client.capacity, at: t };
      if (buckets.size >= MAX_CLIENTS) buckets.delete(buckets.keys().next().value!);
    }
    buckets.set(key, b);
    refill(all, shared, t);
    if (b.tokens < 1) return Math.ceil((1 - b.tokens) / client.refillPerSec);
    if (all.tokens < 1) return Math.ceil((1 - all.tokens) / shared.refillPerSec);
    b.tokens -= 1;
    all.tokens -= 1;
    return 0;
  };
}

/**
 * The address a request is counted under. With `trustProxy`, the last X-Forwarded-For entry is used: it is the one
 * the proxy directly in front of this server added, so a client cannot pick its own key by sending the header.
 * Only enable it when the server is reachable through that proxy alone.
 */
export function clientAddress(socketAddress: string | undefined, forwardedFor: string | string[] | undefined, trustProxy: boolean): string {
  if (trustProxy) {
    const header = Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor;
    const last = header?.split(',').map((s) => s.trim()).filter(Boolean).pop();
    if (last && last.length <= 64) return last;
  }
  return socketAddress ?? 'unbekannt';
}
