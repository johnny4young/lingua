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
  /**
   * Explicit desktop opt-in to private destinations (the Settings private-host
   * toggle); false by default. The caller's scheme allowlist still applies.
   */
  allowPrivateHosts?: boolean;
  /** Test seam: callers use their normal DNS lookup when omitted. */
  lookupImpl?: LookupImpl;
}

/**
 * Thrown when the destination policy rejects a URL or resolved address. Each
 * transport maps it to a `network-error` response carrying the guard message.
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

function embeddedIPv4(hextets: number[], hiIndex = 6): string {
  const hi = hextets[hiIndex]!;
  const lo = hextets[hiIndex + 1]!;
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().split('%')[0] ?? ip.toLowerCase(); // strip zone id
  if (lower === '::1' || lower === '::') return true; // loopback / unspecified
  const hextets = ipv6Hextets(lower);
  if (!hextets) return true; // unparseable → treat as unsafe
  const zeros = (from: number, to: number): boolean =>
    hextets.slice(from, to).every((h) => h === 0);
  // IPv4-mapped (::ffff:0:0/96) in ANY textual form — the low 32 bits are the
  // IPv4 target the socket connects to, so classify by that embedded address.
  if (zeros(0, 5) && hextets[5] === 0xffff) {
    return isPrivateIPv4(embeddedIPv4(hextets));
  }
  // IPv4-translated (::ffff:0:0:0/96, RFC 2765 SIIT) — same embed.
  if (zeros(0, 4) && hextets[4] === 0xffff && hextets[5] === 0) {
    return isPrivateIPv4(embeddedIPv4(hextets));
  }
  // IPv4-compatible (::a.b.c.d, deprecated but still routable) — same embed.
  if (zeros(0, 6)) {
    return isPrivateIPv4(embeddedIPv4(hextets));
  }
  const head = hextets[0]!;
  // NAT64 well-known prefix (64:ff9b::/96, RFC 6052): a NAT64 gateway dials the
  // embedded IPv4, so classify by it. Public embeds stay reachable, which is
  // what DNS64 hands out on IPv6-only networks.
  if (head === 0x64 && hextets[1] === 0xff9b && zeros(2, 6)) {
    return isPrivateIPv4(embeddedIPv4(hextets));
  }
  // NAT64 local-use prefix (64:ff9b:1::/48, RFC 8215): operator-defined
  // translation that IANA marks as not globally reachable, and whose IPv4
  // position depends on the operator's prefix length. Never a public target.
  if (head === 0x64 && hextets[1] === 0xff9b && hextets[2] === 1) return true;
  // Only global unicast (2000::/3) can be a public target. Everything else is
  // IETF-reserved or scoped: the rest of ::/8 and 64:ff9b::/16, 100::/8
  // (incl. the 100::/64 discard-only block), SRv6 SIDs (5f00::/16),
  // fc00::/7 unique-local, fe80::/10 link-local, fec0::/10 site-local and
  // ff00::/8 multicast. Allowlisting the global block keeps unassigned space
  // fail-closed instead of enumerating every reserved prefix.
  if ((head & 0xe000) !== 0x2000) return true;
  // 6to4 (2002::/16, RFC 3056) carries its IPv4 in hextets 1–2.
  if (head === 0x2002 && isPrivateIPv4(embeddedIPv4(hextets, 1))) return true;
  // Teredo (2001::/32, RFC 4380) embeds a server IPv4 in hextets 2–3 and the
  // bit-inverted client IPv4 in hextets 6–7; a Teredo relay or local client
  // tunnels to the latter, so both are attacker-chosen dial targets. Teredo
  // serves no public API, so the whole prefix is non-public.
  if (head === 0x2001 && hextets[1] === 0) return true;
  if (head === 0x2001 && hextets[1] === 0x0002 && hextets[2] === 0) return true; // 2001:2::/48 benchmarking
  if (head === 0x2001 && hextets[1] === 0x0db8) return true; // 2001:db8::/32 documentation
  if (head === 0x3fff && hextets[1]! < 0x1000) return true; // 3fff::/20 documentation (RFC 9637)
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
  // A single trailing dot is the fully-qualified spelling of the same name
  // (`localhost.`), which WHATWG URL keeps verbatim.
  const bareName = hostname.toLowerCase().replace(/\.$/u, '');
  if (
    !allowPrivateHosts &&
    (bareName === 'localhost' || bareName.endsWith('.localhost'))
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
