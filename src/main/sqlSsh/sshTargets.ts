/**
 * Main's side of SSH tunnels: the host config for a connection (pinned first
 * hop, keys trusted per hop, the private key read from disk), the one-time
 * trust of a key a hop presented, and what the sheet may learn about an
 * alias in ~/.ssh/config and the agent. Key and file contents never leave
 * main except to the SQL host.
 */

import { constants, realpathSync } from 'node:fs';
import { open } from 'node:fs/promises';
import net from 'node:net';
import { homedir } from 'node:os';
import path from 'node:path';
import type { SqlConnectionV1 } from '../../shared/sqlConnections';
import type { SqlDbFixHint } from '../../shared/sqlDb';
import type { HostError, HostSshConfig } from '../sqlHost/protocol';
import { createHostKeyStore, resolveHostKeyStorePath, type HostKeyStore } from './hostKeyStore';
import { judgeHostKey, knownHostKeys, knownHostToken, type KnownHostKey } from './knownHosts';
import { resolveSshConfig, type SshConfigHost } from './sshConfig';
import { isSshFolderFile } from './sshKeyPath';

const MAX_KNOWN_HOSTS_BYTES = 4 * 1024 * 1024;
const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_KEY_BYTES = 64 * 1024;
const AGENT_TIMEOUT_MS = 2_000;

export interface SshTargetDeps {
  hostKeys: HostKeyStore;
  home: string;
  /** A small text file, or null when it is missing or larger than `maxBytes`. */
  readText: (file: string, maxBytes: number) => Promise<string | null>;
  blockedPath: (file: string) => string | null;
  /** The agent socket or pipe this process sees. */
  agentSocket: () => string | undefined;
}

export class SshGuardError extends Error {
  constructor(
    readonly fix: SqlDbFixHint,
    message: string
  ) {
    super(message);
  }
}

export interface SshInfo {
  /** The alias as ssh would resolve it, when ~/.ssh/config names it. */
  config: SshConfigHost | null;
  agent: { available: boolean; keys?: number };
}

const real = (file: string) => {
  try {
    return realpathSync(file);
  } catch {
    return file;
  }
};

/** How many identities the agent holds, over the agent protocol; null when it does not answer. */
function agentKeyCount(socket: string): Promise<number | null> {
  return new Promise((resolve) => {
    const client = net.connect(socket);
    let data = Buffer.alloc(0);
    const finish = (count: number | null) => {
      client.destroy();
      resolve(count);
    };
    client.setTimeout(AGENT_TIMEOUT_MS, () => finish(null));
    client.once('error', () => finish(null));
    // SSH2_AGENTC_REQUEST_IDENTITIES, answered by SSH2_AGENT_IDENTITIES_ANSWER with the count first.
    client.once('connect', () => client.write(Buffer.from([0, 0, 0, 1, 11])));
    client.on('data', (chunk: Buffer) => {
      data = Buffer.concat([data, chunk]);
      if (data.length >= 9) finish(data[4] === 12 ? data.readUInt32BE(5) : null);
    });
  });
}

export function createSshTargets(deps: SshTargetDeps) {
  /** The last key each hop presented that no one trusted, the only key Trust may add. */
  const pending = new Map<string, KnownHostKey>();
  /** Keys inside ~/.ssh the user chose in the file dialog or ~/.ssh/config named, by real path. */
  const chosenKeys = new Set<string>();

  /** Whether a key file sits in a protected folder; ~/.ssh counts only as the tunnel key exception. */
  const keyFamily = (keyPath: string): 'free' | 'ssh' | 'blocked' => {
    const families = [deps.blockedPath(keyPath), deps.blockedPath(real(keyPath))];
    if (families.every((family) => family === null)) return 'free';
    return families.every((family) => family === null || family === 'credentials') && isSshFolderFile(keyPath, deps.home) ? 'ssh' : 'blocked';
  };

  const chooseKey = (keyPath: string) => {
    if (keyFamily(keyPath) === 'ssh') chosenKeys.add(real(keyPath));
  };

  const knownHostsText = () => deps.readText(path.join(deps.home, '.ssh', 'known_hosts'), MAX_KNOWN_HOSTS_BYTES);

  async function knownKeys(host: string, port: number, text = knownHostsText()): Promise<KnownHostKey[]> {
    const known = await text;
    return [...(known ? knownHostKeys(known, host, port) : []), ...(await deps.hostKeys.list(host, port))];
  }

  async function privateKey(keyPath: string): Promise<string> {
    if (keyFamily(keyPath) === 'blocked') throw new SshGuardError('ssh-key', 'The key file is in a protected folder Lingua does not open.');
    const text = await deps.readText(keyPath, MAX_KEY_BYTES);
    if (text === null) throw new SshGuardError('ssh-key', 'The key file cannot be read.');
    return text;
  }

  return {
    /** The tunnel for `entry`, starting at the first hop's checked address. `secret` is the SSH password or key passphrase. */
    async configFor(entry: SqlConnectionV1, firstAddress: string, secret: string | undefined): Promise<HostSshConfig> {
      const ssh = entry.ssh!;
      const named = [...(ssh.jumps ?? []), ssh];
      const text = knownHostsText();
      const hops = await Promise.all(
        named.map(async (hop, index) => ({
          host: index === 0 ? firstAddress : hop.host,
          port: hop.port,
          user: hop.user,
          known: await knownKeys(hop.host, hop.port, text),
          label: { host: hop.host, port: hop.port },
        }))
      );
      const base = { hops, auth: ssh.auth, target: { host: entry.host!, port: entry.port! } };
      if (ssh.auth === 'password') return { ...base, password: secret ?? '' };
      if (ssh.auth === 'key') return { ...base, privateKey: await privateKey(ssh.keyPath!), ...(secret ? { passphrase: secret } : {}) };
      const agent = deps.agentSocket();
      if (!agent) throw new SshGuardError('ssh-auth', 'No SSH agent is running for Lingua. Start one, or sign in with a key.');
      return { ...base, agent };
    },

    /** Keeps a key a hop presented so Trust can add exactly that key. */
    remember(error: HostError): void {
      if (error.hostKey) pending.set(knownHostToken(error.hostKey.host, error.hostKey.port), { type: error.hostKey.type, fingerprint: error.hostKey.fingerprint });
    },

    async trust(host: string, port: number, fingerprint: string): Promise<boolean> {
      const token = knownHostToken(host, port);
      const key = pending.get(token);
      if (!key || key.fingerprint !== fingerprint) return false;
      pending.delete(token);
      // A key someone came to know since the prompt (ssh in a terminal, say) wins over the pending one.
      if (judgeHostKey(await knownKeys(host, port), key.fingerprint) !== 'unknown') return false;
      return deps.hostKeys.trust(host, port, key);
    },

    /** A key the user picked in the file dialog. */
    chooseKey,

    /**
     * Whether a draft may name this key: anything outside the protected
     * folders, and inside ~/.ssh only a key the user chose or one already saved.
     */
    keyAllowed(keyPath: string, saved: ReadonlyArray<string>): boolean {
      const family = keyFamily(keyPath);
      if (family !== 'ssh') return family === 'free';
      return chosenKeys.has(real(keyPath)) || saved.some((file) => real(file) === real(keyPath));
    },

    async info(alias: string): Promise<SshInfo> {
      const text = await deps.readText(path.join(deps.home, '.ssh', 'config'), MAX_CONFIG_BYTES);
      const socket = deps.agentSocket();
      const keys = socket ? await agentKeyCount(socket) : null;
      const config = text ? resolveSshConfig(text, alias, deps.home) : null;
      // Use its settings fills this key in; naming it in ~/.ssh/config is the user's choice.
      if (config?.identityFile) chooseKey(config.identityFile);
      return {
        config,
        agent: keys === null ? { available: false } : { available: true, keys },
      };
    },
  };
}

export type SshTargets = ReturnType<typeof createSshTargets>;

/** A regular file of at most `maxBytes`; a FIFO or device never blocks, and growth past the cap is refused. */
export async function readSmallText(file: string, maxBytes: number): Promise<string | null> {
  try {
    const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      if (!(await handle.stat()).isFile()) return null;
      const buffer = Buffer.alloc(maxBytes + 1);
      const { bytesRead } = await handle.read(buffer, 0, maxBytes + 1, 0);
      return bytesRead > maxBytes ? null : buffer.subarray(0, bytesRead).toString('utf-8');
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

/** SSH targets on this machine: the user's ~/.ssh, Lingua's host key file and the agent this process sees. */
export function createSystemSshTargets(userDataDir: string, blockedPath: (file: string) => string | null): SshTargets {
  return createSshTargets({
    hostKeys: createHostKeyStore(resolveHostKeyStorePath(userDataDir)),
    home: homedir(),
    readText: readSmallText,
    blockedPath,
    agentSocket: () => (process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : process.env.SSH_AUTH_SOCK),
  });
}
