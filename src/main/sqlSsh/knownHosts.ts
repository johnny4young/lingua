/**
 * Reads OpenSSH known_hosts text: plain and hashed host patterns, `*` and
 * `?` globs, `!` negation and `@revoked` lines. `@cert-authority` lines are
 * skipped, since a tunnel checks the host key itself.
 */

import { createHash, createHmac } from 'node:crypto';

export interface KnownHostKey {
  type: string;
  fingerprint: string;
  revoked?: boolean;
}

/** `SHA256:` and the unpadded base64 digest, as ssh-keygen -l prints it. */
export const sshFingerprint = (key: Buffer): string => `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;

/** The algorithm name at the start of a key in SSH wire format. */
export function sshKeyType(key: Buffer): string | null {
  if (key.length < 4) return null;
  const length = key.readUInt32BE(0);
  if (length === 0 || length > 64 || key.length < 4 + length) return null;
  return key.subarray(4, 4 + length).toString('latin1');
}

/** The name known_hosts stores: bare on port 22, `[host]:port` otherwise. */
export const knownHostToken = (host: string, port: number) => (port === 22 ? host.toLowerCase() : `[${host.toLowerCase()}]:${port}`);

const globToRegExp = (pattern: string) =>
  new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');

function hashedMatch(pattern: string, token: string): boolean {
  const [, magic, salt, hash] = pattern.split('|');
  if (magic !== '1' || !salt || !hash) return false;
  return createHmac('sha1', Buffer.from(salt, 'base64')).update(token).digest('base64') === hash;
}

function matchesHost(patterns: string, token: string): boolean {
  let matched = false;
  for (const raw of patterns.split(',')) {
    const negated = raw.startsWith('!');
    const pattern = negated ? raw.slice(1) : raw;
    const hit = pattern.startsWith('|') ? hashedMatch(pattern, token) : globToRegExp(pattern).test(token);
    if (hit && negated) return false;
    if (hit) matched = true;
  }
  return matched;
}

/** Every key the text lists for `host:port`, revoked ones marked. */
export function knownHostKeys(text: string, host: string, port: number): KnownHostKey[] {
  const token = knownHostToken(host, port);
  const keys: KnownHostKey[] = [];
  for (const line of text.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (!fields[0] || fields[0].startsWith('#')) continue;
    const marker = fields[0].startsWith('@') ? fields.shift() : undefined;
    if (marker === '@cert-authority') continue;
    const [patterns, type, encoded] = fields;
    if (!patterns || !type || !encoded || !matchesHost(patterns, token)) continue;
    const key = Buffer.from(encoded, 'base64');
    if (sshKeyType(key) !== type) continue;
    keys.push({ type, fingerprint: sshFingerprint(key), ...(marker === '@revoked' ? { revoked: true } : {}) });
  }
  return keys;
}

export type HostKeyVerdict = 'trusted' | 'unknown' | 'changed' | 'revoked';

/**
 * `unknown` only when no key at all is known for the host: a key of another
 * type than the known one could be a machine in the middle, so it counts as
 * changed and is never offered for trust.
 */
export function judgeHostKey(known: ReadonlyArray<KnownHostKey>, fingerprint: string): HostKeyVerdict {
  if (known.some((key) => key.revoked && key.fingerprint === fingerprint)) return 'revoked';
  if (known.some((key) => !key.revoked && key.fingerprint === fingerprint)) return 'trusted';
  return known.some((key) => !key.revoked) ? 'changed' : 'unknown';
}

const RSA_SIGNATURES = ['rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa'];

/** The host key algorithms to ask for, so a server holding several keys presents a known one. */
export function hostKeyAlgorithms(known: ReadonlyArray<KnownHostKey>): string[] | undefined {
  const types = [...new Set(known.filter((key) => !key.revoked).map((key) => key.type))];
  if (types.length === 0) return undefined;
  return types.flatMap((type) => (type === 'ssh-rsa' ? RSA_SIGNATURES : [type]));
}
