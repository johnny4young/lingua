import net, { type AddressInfo } from 'node:net';
import { Server, utils, type Connection } from 'ssh2';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sshFingerprint } from '../../../src/main/sqlSsh/knownHosts';
import type { HostSshConfig, HostSshHop } from '../../../src/main/sqlHost/protocol';
import { createTunnelPool } from '../../../src/main/sqlHost/tunnel';

const hostKey = utils.generateKeyPairSync('ed25519');
const userKey = utils.generateKeyPairSync('ed25519', { passphrase: 'open sesame', cipher: 'aes256-ctr', rounds: 16 });
const hostFingerprint = sshFingerprint(Buffer.from(hostKey.public.split(' ')[1]!, 'base64'));
const userPublic = utils.parseKey(userKey.public);

let sshPort = 0;
let echoPort = 0;
const connections = new Set<Connection>();
const forwarded: string[] = [];

/** One SSH server playing every hop: password u/pw or the user key, forwarding to any local port. */
beforeAll(async () => {
  const echo = net.createServer((socket) => socket.pipe(socket));
  await new Promise<void>((resolve) => echo.listen(0, '127.0.0.1', resolve));
  echoPort = (echo.address() as AddressInfo).port;
  const server = new Server({ hostKeys: [hostKey.private] }, (client) => {
    connections.add(client);
    client.on('close', () => connections.delete(client));
    // A client that refuses the host key ends the handshake; that is the point of those tests.
    client.on('error', () => undefined);
    client.on('authentication', (ctx) => {
      if (ctx.username === 'u' && ctx.method === 'password' && ctx.password === 'pw') return ctx.accept();
      if (ctx.username === 'u' && ctx.method === 'publickey' && !(userPublic instanceof Error) && ctx.key.data.equals(userPublic.getPublicSSH())) {
        if (!ctx.signature) return ctx.accept();
        return userPublic.verify(ctx.blob!, ctx.signature, ctx.hashAlgo) ? ctx.accept() : ctx.reject();
      }
      ctx.reject(['password', 'publickey']);
    });
    client.on('ready', () =>
      client.on('tcpip', (accept, reject, info) => {
        forwarded.push(`${info.destIP}:${info.destPort}`);
        const upstream = net.connect(info.destPort, info.destIP);
        upstream.once('error', () => reject?.());
        upstream.once('connect', () => {
          const channel = accept();
          channel.pipe(upstream).pipe(channel);
        });
      })
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  sshPort = (server.address() as AddressInfo).port;
  return () => {
    server.close();
    echo.close();
  };
});

afterEach(() => {
  forwarded.length = 0;
});

const hop = (overrides: Partial<HostSshHop> = {}): HostSshHop => ({
  host: '127.0.0.1',
  port: sshPort,
  user: 'u',
  known: [{ type: 'ssh-ed25519', fingerprint: hostFingerprint }],
  label: { host: 'bastion.test', port: sshPort },
  ...overrides,
});

const config = (overrides: Partial<HostSshConfig> = {}): HostSshConfig => ({
  hops: [hop()],
  auth: 'password',
  password: 'pw',
  target: { host: '127.0.0.1', port: echoPort },
  ...overrides,
});

function roundTrip(port: number, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => socket.write(text));
    socket.once('data', (data) => {
      resolve(data.toString());
      socket.end();
    });
    socket.once('error', reject);
    socket.once('close', () => reject(new Error('closed without an answer')));
  });
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 20));
};

describe('SSH tunnel pool', () => {
  it('forwards a local 127.0.0.1 port to the database through the bastion, shared by identical configs', async () => {
    const pool = createTunnelPool();
    const first = await pool.acquire(config());
    const second = await pool.acquire(config());
    expect(second.port).toBe(first.port);
    expect(await roundTrip(first.port, 'SELECT 1')).toBe('SELECT 1');
    expect(forwarded).toEqual([`127.0.0.1:${echoPort}`]);
    await first.release();
    expect(await roundTrip(second.port, 'still open')).toBe('still open');
    await second.release();
    await until(() => connections.size === 0);
    expect(connections.size).toBe(0);
    await expect(roundTrip(first.port, 'closed')).rejects.toThrow();
  });

  it('signs in with a key and its passphrase, and through a jump host', async () => {
    const pool = createTunnelPool();
    const tunnel = await pool.acquire(
      config({ auth: 'key', password: undefined, privateKey: userKey.private, passphrase: 'open sesame', hops: [hop({ label: { host: 'jump.test', port: sshPort } }), hop()] })
    );
    expect(await roundTrip(tunnel.port, 'via jump')).toBe('via jump');
    // The jump forwarded to the bastion, which forwarded to the database.
    expect(forwarded).toEqual([`127.0.0.1:${sshPort}`, `127.0.0.1:${echoPort}`]);
    await tunnel.release();
    await expect(pool.acquire(config({ auth: 'key', privateKey: userKey.private, passphrase: 'wrong' }))).rejects.toMatchObject({
      detail: { step: 'ssh', fix: 'ssh-key' },
    });
  });

  it('offers an unknown host key for trust, refuses a changed one, and names a refused sign-in', async () => {
    const pool = createTunnelPool();
    await expect(pool.acquire(config({ hops: [hop({ known: [] })] }))).rejects.toMatchObject({
      detail: { fix: 'ssh-host-unknown', hostKey: { host: 'bastion.test', port: sshPort, fingerprint: hostFingerprint, type: 'ssh-ed25519' } },
    });
    await expect(pool.acquire(config({ hops: [hop({ known: [{ type: 'ssh-ed25519', fingerprint: 'SHA256:other' }] })] }))).rejects.toMatchObject({
      detail: { fix: 'ssh-host-changed' },
    });
    await expect(pool.acquire(config({ password: 'nope' }))).rejects.toMatchObject({ detail: { step: 'ssh', fix: 'ssh-auth' } });
    await expect(pool.acquire(config({ target: { host: '127.0.0.1', port: 1 } })).then((t) => roundTrip(t.port, 'x'))).rejects.toThrow();
    // A failed open is not kept: the same config tries again.
    const ok = await pool.acquire(config());
    expect(await roundTrip(ok.port, 'again')).toBe('again');
    await ok.release();
  });

  it('drops a tunnel whose SSH connection closed, so the next acquire opens a new one', async () => {
    const pool = createTunnelPool();
    const tunnel = await pool.acquire(config());
    for (const connection of connections) connection.end();
    await until(() => connections.size === 0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const next = await pool.acquire(config());
    expect(next.port).not.toBe(tunnel.port);
    expect(await roundTrip(next.port, 'reopened')).toBe('reopened');
    await next.release();
    await tunnel.release();
    pool.dispose();
  });
});
