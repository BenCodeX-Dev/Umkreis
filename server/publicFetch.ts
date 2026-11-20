import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from 'node:dns';
import type { IncomingMessage } from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import { Readable } from 'node:stream';
import type { FetchFn } from './providers/types.ts';

/**
 * Fetching URLs that came from third-party data (e.g. Panoramax picture links from any instance in
 * the federation) must not reach this machine or the local network. Checking the hostname string is
 * not enough – a public-looking name can resolve to 127.0.0.1 or 192.168.x.x. So the DNS answer is
 * checked, and the connection is made to exactly the address that was checked (no second lookup).
 */
const NON_PUBLIC = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3], // multicast, reserved, broadcast
] as const) {
  NON_PUBLIC.addSubnet(net, bits, 'ipv4');
}
for (const [net, bits] of [
  // IPv4-mapped (::ffff:a.b.c.d) needs no entry: BlockList checks those against the IPv4 rules above.
  ['::', 127], // unspecified and loopback
  ['64:ff9b::', 96], // NAT64
  ['100::', 64],
  ['2001::', 32], // Teredo
  ['2001:db8::', 32],
  ['2002::', 16], // 6to4
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  NON_PUBLIC.addSubnet(net, bits, 'ipv6');
}

export function isPublicIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 0) return false;
  return !NON_PUBLIC.check(ip, v === 4 ? 'ipv4' : 'ipv6');
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** A `lookup` for sockets that only hands out public addresses – all of them must be public. */
export function publicOnlyLookup(hostname: string, options: LookupOptions, callback: LookupCallback): void {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '');
    if (addresses.length === 0 || addresses.some((a) => !isPublicIp(a.address))) {
      const e: NodeJS.ErrnoException = new Error(`${hostname} verweist auf keine öffentliche Adresse.`);
      e.code = 'ENOTPUBLIC';
      return callback(e, '');
    }
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
}

const NO_BODY = new Set([204, 205, 304]);

/**
 * Wraps a Node response as a fetch `Response`. The peer controls the status line and headers, so this
 * throws on anything `Response` cannot represent (e.g. status 999) – callers must catch.
 */
export function toFetchResponse(res: IncomingMessage): Response {
  const status = res.statusCode ?? 0;
  if (!Number.isInteger(status) || status < 200 || status > 599) throw new RangeError(`Ungültiger HTTP-Status ${status}.`);
  const out = new Headers();
  for (const [k, v] of Object.entries(res.headers)) {
    if (v !== undefined) out.set(k, Array.isArray(v) ? v.join(', ') : v);
  }
  const body = NO_BODY.has(status) ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>);
  if (!body) res.resume();
  return new Response(body, { status, headers: out });
}

/**
 * GET over https to public addresses only, with the `fetch` call shape used elsewhere. Redirects are
 * not followed (a 3xx comes back as is), and only `headers` and `signal` from `init` are honoured.
 */
export const publicOnlyFetch: FetchFn = (input, init) =>
  new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(input instanceof Request ? input.url : String(input));
    } catch (err) {
      return reject(err);
    }
    if (url.protocol !== 'https:') return reject(new TypeError('Nur https-Adressen sind erlaubt.'));
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const req = https.request(url, { method: 'GET', headers, lookup: publicOnlyLookup, signal: init?.signal ?? undefined }, (res) => {
      // Runs in a socket callback: anything thrown here would be uncaught and stop the server.
      try {
        resolve(toFetchResponse(res));
      } catch (err) {
        res.destroy();
        reject(err);
      }
    });
    req.on('error', reject);
    req.end();
  });
