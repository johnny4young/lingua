/**
 * Resolves one alias from OpenSSH config text: HostName, User, Port,
 * IdentityFile and ProxyJump, first value wins as ssh does. `Match` blocks
 * and `Include` are skipped, and values with `%` tokens are left out.
 */

import path from 'node:path';
import type { SqlSshHop } from '../../shared/sqlConnections';

export interface SshConfigHost {
  alias: string;
  hostName?: string;
  user?: string;
  port?: number;
  identityFile?: string;
  /** Hops in order from this machine, ready for the connection's jumps. */
  proxyJump?: Array<Partial<SqlSshHop> & { host: string }>;
}

const globToRegExp = (pattern: string) =>
  new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');

/** Whether the patterns match, and whether one of them names the alias without a wildcard. */
function hostPatterns(patterns: string[], alias: string): { matches: boolean; literal: boolean } {
  let matches = false;
  let literal = false;
  for (const raw of patterns) {
    const negated = raw.startsWith('!');
    const pattern = negated ? raw.slice(1) : raw;
    if (!globToRegExp(pattern).test(alias)) continue;
    if (negated) return { matches: false, literal: false };
    matches = true;
    if (!/[*?]/.test(pattern)) literal = true;
  }
  return { matches, literal };
}

function parseJump(value: string): SshConfigHost['proxyJump'] {
  if (value.toLowerCase() === 'none') return undefined;
  const hops = value.split(',').map((part) => {
    const match = /^(?:([^@]+)@)?(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(part.trim());
    if (!match) return null;
    const port = match[3] ? Number(match[3]) : undefined;
    return { host: match[2]!.replace(/^\[|\]$/g, ''), ...(match[1] ? { user: match[1] } : {}), ...(port ? { port } : {}) };
  });
  return hops.every((hop) => hop !== null) ? (hops as NonNullable<SshConfigHost['proxyJump']>) : undefined;
}

/** The settings ssh would use for `alias`, or null when no Host line names it outright. */
export function resolveSshConfig(text: string, alias: string, home: string): SshConfigHost | null {
  const found: SshConfigHost = { alias };
  let applies = true;
  let named = false;
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z]+)\s*(?:=\s*|\s+)(.+?)\s*$/.exec(line);
    if (!match || line.trim().startsWith('#')) continue;
    const keyword = match[1]!.toLowerCase();
    const value = match[2]!.replace(/^"(.*)"$/, '$1');
    if (keyword === 'host') {
      const result = hostPatterns(value.split(/\s+/), alias);
      applies = result.matches;
      named ||= result.literal;
      continue;
    }
    if (keyword === 'match') {
      applies = false;
      continue;
    }
    if (!applies || value.includes('%')) continue;
    if (keyword === 'hostname' && found.hostName === undefined) found.hostName = value;
    else if (keyword === 'user' && found.user === undefined) found.user = value;
    else if (keyword === 'port' && found.port === undefined && /^\d{1,5}$/.test(value)) found.port = Number(value);
    else if (keyword === 'identityfile' && found.identityFile === undefined) {
      found.identityFile = value.startsWith('~/') ? path.join(home, value.slice(2)) : value;
    } else if (keyword === 'proxyjump' && found.proxyJump === undefined) {
      const hops = parseJump(value);
      if (hops) found.proxyJump = hops;
    }
  }
  return named ? found : null;
}
