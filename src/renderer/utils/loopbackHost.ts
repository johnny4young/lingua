/** True for the hostnames that never leave this machine. */
export function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/** Local AI endpoints: the two loopback hosts both CSPs allow over plain http. */
export function isLocalAiEndpoint(endpoint: string): boolean {
  try {
    const { hostname } = new URL(endpoint.trim());
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

const LOCAL_SUFFIXES = ['.localhost', '.local', '.test', '.internal', '.lan', '.home.arpa'];

/**
 * True for hosts reachable without the internet: this machine, private and
 * link-local addresses, single-label names (hosts file, containers) and names
 * under local-only suffixes. A URL hostname keeps IPv6 in brackets.
 */
export function isLocalNetworkHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (isLoopbackHostname(host) || LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  if (!host.includes('.') && !host.startsWith('[')) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 0;
  }
  const v6 = /^\[([0-9a-f:.]+)\]$/.exec(host)?.[1];
  return v6 !== undefined && (v6 === '::1' || /^f[cd][0-9a-f]{0,2}:/.test(v6) || /^fe[89ab][0-9a-f]?:/.test(v6));
}
