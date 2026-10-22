import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HostKeyStore } from '../../../src/main/sqlSsh/hostKeyStore';
import { createSshTargets, readSmallText, SshGuardError } from '../../../src/main/sqlSsh/sshTargets';
import type { SqlConnectionV1 } from '../../../src/shared/sqlConnections';

const HOME = '/home/me';
const FP = (letter: string) => `SHA256:${letter.repeat(43)}`;

function memoryStore(): HostKeyStore {
  const keys = new Map<string, Array<{ type: string; fingerprint: string }>>();
  return {
    list: async (host, port) => keys.get(`${host}:${port}`) ?? [],
    trust: async (host, port, key) => {
      keys.set(`${host}:${port}`, [key]);
      return true;
    },
  };
}

const entry = (ssh: NonNullable<SqlConnectionV1['ssh']>): SqlConnectionV1 => ({
  version: 1,
  id: 'c_1',
  name: 'orders-prod',
  engine: 'postgres',
  host: 'db.internal',
  port: 5432,
  readOnly: true,
  passwordMode: 'keychain',
  ssh,
  createdAt: '',
  updatedAt: '',
});

describe('SSH targets', () => {
  let files: Record<string, string>;
  let store: HostKeyStore;
  let agent: string | undefined;
  let reads: string[];
  const targets = () =>
    createSshTargets({
      hostKeys: store,
      home: HOME,
      readText: async (file) => {
        reads.push(file);
        return files[file] ?? null;
      },
      blockedPath: (file) => (file.startsWith(`${HOME}/.ssh/`) || file.startsWith(`${HOME}/.aws/`) ? 'credentials' : null),
      agentSocket: () => agent,
    });

  beforeEach(() => {
    files = {};
    store = memoryStore();
    agent = undefined;
    reads = [];
  });

  it('builds the hops from the pinned first address, with keys from known_hosts and Lingua', async () => {
    files[`${HOME}/.ssh/known_hosts`] = '';
    await store.trust('bastion.example.net', 22, { type: 'ssh-ed25519', fingerprint: FP('b') });
    agent = '/tmp/agent.sock';
    const config = await targets().configFor(
      entry({ host: 'bastion.example.net', port: 22, user: 'deploy', auth: 'agent', secretMode: 'none', jumps: [{ host: 'jump.example.net', port: 2222, user: 'deploy' }] }),
      '203.0.113.7',
      undefined
    );
    expect(config).toEqual({
      hops: [
        { host: '203.0.113.7', port: 2222, user: 'deploy', known: [], label: { host: 'jump.example.net', port: 2222 } },
        { host: 'bastion.example.net', port: 22, user: 'deploy', known: [{ type: 'ssh-ed25519', fingerprint: FP('b') }], label: { host: 'bastion.example.net', port: 22 } },
      ],
      auth: 'agent',
      agent: '/tmp/agent.sock',
      target: { host: 'db.internal', port: 5432 },
    });
    expect(reads.filter((file) => file.endsWith('known_hosts'))).toHaveLength(1);
  });

  it('reads a key under ~/.ssh with its passphrase, refuses other protected folders, and needs an agent for agent sign-in', async () => {
    files[`${HOME}/.ssh/id_ed25519`] = 'PRIVATE KEY';
    files[`${HOME}/.aws/key`] = 'NOT FOR SSH';
    const key = (keyPath: string) => entry({ host: 'b', port: 22, user: 'u', auth: 'key', keyPath, secretMode: 'keychain' });
    expect(await targets().configFor(key(`${HOME}/.ssh/id_ed25519`), '198.51.100.1', 'pass')).toMatchObject({ privateKey: 'PRIVATE KEY', passphrase: 'pass' });
    await expect(targets().configFor(key(`${HOME}/.aws/key`), '198.51.100.1', 'pass')).rejects.toMatchObject({ fix: 'ssh-key' });
    await expect(targets().configFor(key(`${HOME}/.ssh/missing`), '198.51.100.1', 'pass')).rejects.toBeInstanceOf(SshGuardError);
    await expect(targets().configFor(entry({ host: 'b', port: 22, user: 'u', auth: 'agent', secretMode: 'none' }), '198.51.100.1', undefined)).rejects.toMatchObject({ fix: 'ssh-auth' });
  });

  it('lets a draft name a key inside ~/.ssh only once the user chose it or ~/.ssh/config named it', async () => {
    const ssh = targets();
    const key = `${HOME}/.ssh/id_work`;
    expect(ssh.keyAllowed(key, [])).toBe(false);
    expect(ssh.keyAllowed(key, [key])).toBe(true);
    expect(ssh.keyAllowed('/opt/keys/deploy', [])).toBe(true);
    expect(ssh.keyAllowed(`${HOME}/.aws/key`, [])).toBe(false);
    ssh.chooseKey(key);
    expect(ssh.keyAllowed(key, [])).toBe(true);
    files[`${HOME}/.ssh/config`] = `Host bastion\n  IdentityFile ~/.ssh/id_config\n`;
    await ssh.info('bastion');
    expect(ssh.keyAllowed(`${HOME}/.ssh/id_config`, [])).toBe(true);
  });

  it('refuses to trust a pending key once another key became known for the host', async () => {
    const ssh = targets();
    ssh.remember({ message: 'unknown', fix: 'ssh-host-unknown', hostKey: { host: 'bastion', port: 22, type: 'ssh-ed25519', fingerprint: FP('a') } });
    await store.trust('bastion', 22, { type: 'ssh-rsa', fingerprint: FP('r') });
    expect(await ssh.trust('bastion', 22, FP('a'))).toBe(false);
  });

  it('trusts only the key a hop presented in its last failed sign-in', async () => {
    const ssh = targets();
    expect(await ssh.trust('bastion', 22, FP('a'))).toBe(false);
    ssh.remember({ message: 'unknown', fix: 'ssh-host-unknown', hostKey: { host: 'bastion', port: 22, type: 'ssh-ed25519', fingerprint: FP('a') } });
    expect(await ssh.trust('bastion', 22, FP('c'))).toBe(false);
    expect(await ssh.trust('bastion', 22, FP('a'))).toBe(true);
    expect(await store.list('bastion', 22)).toEqual([{ type: 'ssh-ed25519', fingerprint: FP('a') }]);
    // Once trusted, the same fingerprint cannot be replayed.
    expect(await ssh.trust('bastion', 22, FP('a'))).toBe(false);
  });

  describe('info', () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(path.join(tmpdir(), 'lingua-agent-'));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('reads the alias from ~/.ssh/config and counts the agent keys over the agent protocol', async () => {
      files[`${HOME}/.ssh/config`] = 'Host bastion\n  HostName bastion.example.net\n  User deploy\n';
      agent = path.join(dir, 'agent.sock');
      const server = net.createServer((socket) =>
        socket.once('data', (request) => {
          expect([...request]).toEqual([0, 0, 0, 1, 11]);
          socket.end(Buffer.from([0, 0, 0, 5, 12, 0, 0, 0, 2]));
        })
      );
      await new Promise<void>((resolve) => server.listen(agent, resolve));
      try {
        expect(await targets().info('bastion')).toEqual({
          config: { alias: 'bastion', hostName: 'bastion.example.net', user: 'deploy' },
          agent: { available: true, keys: 2 },
        });
      } finally {
        server.close();
      }
      agent = path.join(dir, 'missing.sock');
      expect((await targets().info('nope')).agent).toEqual({ available: false });
    });
  });

  describe('reading small files', () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(path.join(tmpdir(), 'lingua-read-'));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('reads a regular file within the cap and refuses folders, larger files and FIFOs without blocking', async () => {
      writeFileSync(path.join(dir, 'small'), 'Host x');
      writeFileSync(path.join(dir, 'large'), 'x'.repeat(65));
      expect(await readSmallText(path.join(dir, 'small'), 64)).toBe('Host x');
      expect(await readSmallText(path.join(dir, 'large'), 64)).toBeNull();
      expect(await readSmallText(dir, 64)).toBeNull();
      expect(await readSmallText(path.join(dir, 'missing'), 64)).toBeNull();
      if (process.platform !== 'win32') {
        execFileSync('mkfifo', [path.join(dir, 'fifo')]);
        expect(await readSmallText(path.join(dir, 'fifo'), 64)).toBeNull();
      }
    });
  });
});

