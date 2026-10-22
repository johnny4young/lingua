/**
 * SSH tunnels for the SQL host. A tunnel signs in through every hop and
 * checks each host key against the keys main sent. Each driver connection
 * gets a socket that is its own forwarded channel to the database, so no
 * local port exists for another process to use. Tunnels are shared by
 * identical configs and closed when the last session lets go, or when their
 * SSH connection drops.
 */

import { createHash } from 'node:crypto';
import { Duplex } from 'node:stream';
import { Client, utils, type ConnectConfig } from 'ssh2';
import { judgeHostKey, sshFingerprint, sshKeyType, type HostKeyVerdict } from '../sqlSsh/knownHosts';
import type { HostError, HostSshConfig, HostSshHop } from './protocol';

const READY_TIMEOUT_MS = 15_000;
const KEEPALIVE_MS = 15_000;

export class TunnelError extends Error {
  constructor(readonly detail: HostError) {
    super(detail.message);
  }
}

export interface Tunnel {
  /** A new connection to the database through the tunnel, for a driver's `stream` option. */
  socket: () => Duplex;
  release: () => Promise<void>;
}

interface Open {
  clients: Client[];
}

/**
 * A socket-shaped stream over one forwarded channel. It opens as soon as it
 * is made; `connect()` is what pg calls, and the `connect` event fires once
 * the channel is up. Writes before that wait for it.
 */
class TunnelSocket extends Duplex {
  private channel: Duplex | null = null;
  private readonly queued: Array<{ chunk: Buffer; callback: (error?: Error | null) => void }> = [];

  constructor(open: () => Promise<Duplex>) {
    super();
    open().then(
      (channel) => {
        if (this.destroyed) {
          channel.destroy();
          return;
        }
        this.channel = channel;
        channel.on('data', (data: Buffer) => {
          if (!this.push(data)) channel.pause();
        });
        channel.once('end', () => this.push(null));
        channel.once('error', (error: Error) => this.destroy(error));
        channel.once('close', () => this.destroy());
        for (const { chunk, callback } of this.queued.splice(0)) channel.write(chunk, callback);
        this.emit('connect');
      },
      (error: Error) => this.destroy(error)
    );
  }

  connect(): this {
    return this;
  }
  setNoDelay(): this {
    return this;
  }
  setKeepAlive(): this {
    return this;
  }
  setTimeout(): this {
    return this;
  }
  ref(): this {
    return this;
  }
  unref(): this {
    return this;
  }

  override _read(): void {
    this.channel?.resume();
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (this.channel) this.channel.write(chunk, callback);
    else this.queued.push({ chunk, callback });
  }

  override _final(callback: (error?: Error | null) => void): void {
    if (this.channel) this.channel.end(callback);
    else callback();
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.channel?.destroy();
    for (const { callback: pending } of this.queued.splice(0)) pending(error ?? new Error('The tunnel closed.'));
    callback(error);
  }
}

const label = (hop: HostSshHop) => (hop.label.port === 22 ? hop.label.host : `${hop.label.host}:${hop.label.port}`);

function authOf(ssh: HostSshConfig): Partial<ConnectConfig> {
  if (ssh.auth === 'password') return { password: ssh.password ?? '' };
  if (ssh.auth === 'agent') return { agent: ssh.agent ?? '' };
  return { privateKey: ssh.privateKey ?? '', ...(ssh.passphrase ? { passphrase: ssh.passphrase } : {}) };
}

function hopError(err: unknown, hop: HostSshHop, seen: { verdict: HostKeyVerdict; type: string; fingerprint: string } | null): HostError {
  const name = label(hop);
  if (seen && seen.verdict !== 'trusted') {
    if (seen.verdict === 'unknown') {
      return {
        step: 'ssh',
        fix: 'ssh-host-unknown',
        message: `${name} presented a host key no one trusts yet (${seen.fingerprint}).`,
        hostKey: { host: hop.label.host, port: hop.label.port, fingerprint: seen.fingerprint, type: seen.type },
      };
    }
    return {
      step: 'ssh',
      fix: 'ssh-host-changed',
      message: `${name} presented ${seen.fingerprint}, which ${seen.verdict === 'revoked' ? 'is revoked' : 'is not the key known for it'}; the tunnel was not opened.`,
    };
  }
  const level = (err as { level?: string }).level;
  const message = err instanceof Error ? err.message : String(err);
  if (level === 'client-authentication') return { step: 'ssh', fix: 'ssh-auth', message: `${name} refused the sign-in: ${message}` };
  return { step: 'ssh', fix: 'ssh-unreachable', message: `${name}: ${message}` };
}

function connectHop(client: Client, hop: HostSshHop, ssh: HostSshConfig, sock: Duplex | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    let seen: { verdict: HostKeyVerdict; type: string; fingerprint: string } | null = null;
    client.once('ready', () => resolve());
    client.once('error', (err) => reject(new TunnelError(hopError(err, hop, seen))));
    client.connect({
      ...(sock ? { sock } : { host: hop.host, port: hop.port }),
      username: hop.user,
      readyTimeout: READY_TIMEOUT_MS,
      keepaliveInterval: KEEPALIVE_MS,
      ...authOf(ssh),
      hostVerifier: (key: Buffer) => {
        const type = sshKeyType(key) ?? '';
        const fingerprint = sshFingerprint(key);
        seen = { verdict: judgeHostKey(hop.known, type, fingerprint), type, fingerprint };
        return seen.verdict === 'trusted';
      },
    });
  });
}

function forward(client: Client, host: string, port: number, from: HostSshHop): Promise<Duplex> {
  return new Promise((resolve, reject) =>
    client.forwardOut('127.0.0.1', 0, host, port, (err, stream) =>
      err ? reject(new TunnelError({ step: 'ssh', fix: 'ssh-unreachable', message: `${label(from)} could not reach ${host}:${port}: ${err.message}` })) : resolve(stream)
    )
  );
}

async function open(ssh: HostSshConfig, onDrop: () => void): Promise<Open> {
  if (ssh.auth === 'key') {
    const parsed = utils.parseKey(ssh.privateKey ?? '', ssh.passphrase);
    if (parsed instanceof Error) throw new TunnelError({ step: 'ssh', fix: 'ssh-key', message: `The private key cannot be used: ${parsed.message}` });
  }
  const clients: Client[] = [];
  try {
    let sock: Duplex | undefined;
    for (const [index, hop] of ssh.hops.entries()) {
      const client = new Client();
      clients.push(client);
      await connectHop(client, hop, ssh, sock);
      const next = ssh.hops[index + 1];
      if (next) sock = await forward(client, next.host, next.port, hop);
    }
    for (const client of clients) client.once('close', onDrop);
    return { clients };
  } catch (err) {
    for (const client of clients.reverse()) client.end();
    throw err;
  }
}

function close({ clients }: Open): void {
  for (const client of [...clients].reverse()) client.end();
}

export function createTunnelPool() {
  const tunnels = new Map<string, { refs: number; ready: Promise<Open> }>();

  return {
    async acquire(ssh: HostSshConfig): Promise<Tunnel> {
      const key = createHash('sha256').update(JSON.stringify(ssh)).digest('hex');
      let entry = tunnels.get(key);
      if (!entry) {
        const created: { refs: number; ready: Promise<Open> } = { refs: 0, ready: Promise.resolve(null as never) };
        created.ready = open(ssh, () => {
          // A dropped SSH connection closes the tunnel; the next session opens a new one.
          if (tunnels.get(key) === created) tunnels.delete(key);
          void created.ready.then(close, () => undefined);
        });
        created.ready.catch(() => {
          if (tunnels.get(key) === created) tunnels.delete(key);
        });
        tunnels.set(key, created);
        entry = created;
      }
      entry.refs += 1;
      const current = entry;
      let opened: Open;
      try {
        opened = await current.ready;
      } catch (err) {
        current.refs -= 1;
        throw err;
      }
      let released = false;
      const bastion = opened.clients.at(-1)!;
      return {
        socket: () => new TunnelSocket(() => forward(bastion, ssh.target.host, ssh.target.port, ssh.hops.at(-1)!)),
        release: async () => {
          if (released) return;
          released = true;
          current.refs -= 1;
          if (current.refs > 0) return;
          if (tunnels.get(key) === current) tunnels.delete(key);
          close(opened);
        },
      };
    },

    /** Closes every tunnel, as the host exits. */
    dispose(): void {
      for (const entry of tunnels.values()) void entry.ready.then(close, () => undefined);
      tunnels.clear();
    },
  };
}

export type TunnelPool = ReturnType<typeof createTunnelPool>;
