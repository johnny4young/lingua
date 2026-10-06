/**
 * Transport-neutral destination policy for the desktop network engines.
 *
 * This module only validates URLs and classifies resolved addresses. Callers
 * own protocol sets, DNS lookup, socket pinning, redirects and cancellation.
 * Keep it independent of HTTP/WebSocket transports and their option contracts.
 */

import { isIP } from 'node:net';

/** Node's `dns.lookup` result shape (subset we consume). */
interface LookupAddress {
  address: string;
  family: number;
}

/** Test seam: the DNS lookup used by the SSRF guard. */
export type LookupImpl = (
  hostname: string
) => Promise<LookupAddress[]>;

/** Shared destination-policy inputs; transport lifecycle stays with the caller. */
export interface NetworkTargetOptions {
  /** Explicit desktop opt-in to private destinations; false by default. */
  allowPrivateHosts?: boolean;
  /** Test seam: callers use their normal DNS lookup when omitted. */
  lookupImpl?: LookupImpl;
}

/**
 * Thrown internally when the SSRF guard rejects a hop. Caught in the top-level
 * executor and mapped to a `network-error` response with the guard message.
 */
export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

// ---------------------------------------------------------------------------
// Private-address detection
// ---------------------------------------------------------------------------

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/u.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value >>> 0;
}

function isPrivateIPv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) return true; // unparseable → treat as unsafe
  const inRange = (base: string, prefix: number): boolean => {
    const baseInt = ipv4ToInt(base);
    if (baseInt === null) return false;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (value & mask) === (baseInt & mask);
  };
  return (
    inRange('0.0.0.0', 8) || // "this" network / unspecified
    inRange('10.0.0.0', 8) || // RFC 1918
    inRange('100.64.0.0', 10) || // CGNAT (RFC 6598)
    inRange('127.0.0.0', 8) || // loopback
    inRange('169.254.0.0', 16) || // link-local (incl. cloud metadata 169.254.169.254)
    inRange('172.16.0.0', 12) || // RFC 1918
    inRange('192.0.0.0', 24) || // IETF protocol assignments
    inRange('192.0.2.0', 24) || // TEST-NET-1
    inRange('192.168.0.0', 16) || // RFC 1918
    inRange('198.18.0.0', 15) || // benchmarking
    inRange('198.51.100.0', 24) || // TEST-NET-2
    inRange('203.0.113.0', 24) || // TEST-NET-3
    inRange('224.0.0.0', 4) || // multicast
    inRange('240.0.0.0', 4) // reserved / broadcast
  );
}

/**
 * Expand an IPv6 literal (zone already stripped, lower-cased) to its eight
 * 16-bit hextets, or `null` if it does not parse. Handles `::` compression and
 * a trailing dotted-quad tail (`::ffff:1.2.3.4`). Parsing to numbers — rather
 * than string-matching one textual form — is what lets the SSRF guard classify
 * IPv4-mapped loopback written in ANY form (`::ffff:127.0.0.1`, `::ffff:7f00:1`,
 * or fully expanded) by the embedded IPv4 the socket actually dials.
 */
function ipv6Hextets(addr: string): number[] | null {
  let s = addr;
  const dotted = s.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/u);
  if (dotted && dotted.index !== undefined) {
    const v = ipv4ToInt(dotted[1]!);
    if (v === null) return null;
    s = `${s.slice(0, dotted.index)}${((v >>> 16) & 0xffff).toString(16)}:${(v & 0xffff).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const toParts = (part: string): number[] =>
    part === '' ? [] : part.split(':').map((h) => parseInt(h, 16));
  const head = toParts(halves[0] ?? '');
  const tail = halves.length === 2 ? toParts(halves[1] ?? '') : null;
  let hextets: number[];
  if (tail === null) {
    hextets = head;
  } else {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    hextets = [...head, ...Array<number>(fill).fill(0), ...tail];
  }
  if (hextets.length !== 8) return null;
  if (hextets.some((h) => Number.isNaN(h) || h < 0 || h > 0xffff)) return null;
  return hextets;
}

function embeddedIPv4(hextets: number[]): string {
  const hi = hextets[6]!;
  const lo = hextets[7]!;
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().split('%')[0] ?? ip.toLowerCase(); // strip zone id
  if (lower === '::1' || lower === '::') return true; // loopback / unspecified
  const hextets = ipv6Hextets(lower);
  if (!hextets) return true; // unparseable → treat as unsafe
  // IPv4-mapped (::ffff:0:0/96) in ANY textual form — the low 32 bits are the
  // IPv4 target the socket connects to, so classify by that embedded address.
  if (hextets.slice(0, 5).every((h) => h === 0) && hextets[5] === 0xffff) {
    return isPrivateIPv4(embeddedIPv4(hextets));
  }
  // IPv4-compatible (::a.b.c.d, deprecated but still routable) — same embed.
  if (hextets.slice(0, 6).every((h) => h === 0)) {
    return isPrivateIPv4(embeddedIPv4(hextets));
  }
  const head = hextets[0]!;
  if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((head & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/**
 * True when `ip` (a literal, already validated by `isIP`) falls in a range the
 * proxy must not reach without explicit opt-in.
 */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);
  return true; // not a valid IP literal → unsafe
}

/**
 * Resolve `hostname` and reject if ANY resolved address is private. An IP
 * literal is checked directly (no DNS round-trip). Throws `SsrfBlockedError`
 * on rejection; resolves silently when the target is public (or opted in).
 */
async function assertHostAllowed(
  rawHostname: string,
  allowPrivateHosts: boolean,
  lookupImpl: LookupImpl
): Promise<LookupAddress[]> {

  // WHATWG `URL` keeps the square brackets on an IPv6 host (`[::1]`), and
  // `isIP('[::1]')` is 0 — so without stripping them the literal is misread as a
  // DNS name and never reaches the IPv6 private-range check (the guard would
  // then rely on DNS accidentally failing). Strip once, up front.
  const hostname =
    rawHostname.startsWith('[') && rawHostname.endsWith(']')
      ? rawHostname.slice(1, -1)
      : rawHostname;

  const literalFamily = isIP(hostname);
  if (literalFamily !== 0) {
    if (!allowPrivateHosts && isPrivateAddress(hostname)) {
      throw new SsrfBlockedError(
        `Blocked request to private address ${hostname}`
      );
    }
    return [{ address: hostname, family: literalFamily }];
  }

  // `localhost` and friends may resolve to loopback via /etc/hosts; the DNS
  // resolution below catches those, but we also fast-path the obvious name.
  if (
    !allowPrivateHosts &&
    (hostname === 'localhost' || hostname.endsWith('.localhost'))
  ) {
    throw new SsrfBlockedError('Blocked request to localhost');
  }

  let addresses: LookupAddress[];
  try {
    addresses = await lookupImpl(hostname);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new SsrfBlockedError(`DNS resolution failed for ${hostname}: ${message}`);
  }
  if (addresses.length === 0) {
    throw new SsrfBlockedError(`DNS resolution returned no addresses for ${hostname}`);
  }
  for (const { address } of addresses) {
    if (!allowPrivateHosts && isPrivateAddress(address)) {
      throw new SsrfBlockedError(
        `Blocked request to ${hostname} — resolves to private address ${address}`
      );
    }
  }
  return addresses;
}

export interface GuardedNetworkTarget {
  readonly url: URL;
  readonly addresses: ReadonlyArray<LookupAddress>;
}

/** Validate a scheme and resolve a DNS-pinnable, SSRF-checked target. */
export async function resolveGuardedNetworkTarget(
  rawUrl: string,
  allowedProtocols: ReadonlySet<string>,
  allowPrivateHosts: boolean,
  lookupImpl: LookupImpl
): Promise<GuardedNetworkTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError('Invalid URL');
  }
  if (!allowedProtocols.has(url.protocol)) {
    throw new SsrfBlockedError(`Unsupported URL scheme: ${url.protocol}`);
  }
  const addresses = await assertHostAllowed(
    url.hostname,
    allowPrivateHosts,
    lookupImpl
  );
  return { url, addresses };
}
