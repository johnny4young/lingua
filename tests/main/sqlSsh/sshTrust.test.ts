import { createHmac, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { utils } from 'ssh2';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHostKeyStore } from '../../../src/main/sqlSsh/hostKeyStore';
import { judgeHostKey, knownHostKeys, sshFingerprint, sshKeyType } from '../../../src/main/sqlSsh/knownHosts';
import { resolveSshConfig } from '../../../src/main/sqlSsh/sshConfig';

const publicLine = (type: 'ed25519' | 'ecdsa') => utils.generateKeyPairSync(type, type === 'ecdsa' ? { bits: 256 } : {}).public;
const keyBuffer = (line: string) => Buffer.from(line.split(' ')[1]!, 'base64');
const hashed = (token: string) => {
  const salt = randomBytes(20);
  return `|1|${salt.toString('base64')}|${createHmac('sha1', salt).update(token).digest('base64')}`;
};

describe('known_hosts', () => {
  const ed = publicLine('ed25519');
  const ec = publicLine('ecdsa');
  const [edType, edKey] = ed.split(' ');

  it('fingerprints a key as ssh-keygen does and reads its type', () => {
    expect(sshFingerprint(keyBuffer(ed))).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
    expect(sshKeyType(keyBuffer(ed))).toBe('ssh-ed25519');
    expect(sshKeyType(Buffer.from([0, 0, 0, 9, 1]))).toBeNull();
  });

  it('matches plain, hashed, globbed and bracketed hosts, and honours negation and revocation', () => {
    const text = [
      '# comment',
      `bastion.example.net,10.0.0.5 ${edType} ${edKey}`,
      `${hashed('[jump.example.net]:2222')} ${ec}`,
      `*.corp.example,!secret.corp.example ${edType} ${edKey}`,
      `@revoked old.example.net ${edType} ${edKey}`,
      `@cert-authority *.example.net ${edType} ${edKey}`,
      `broken.example.net ssh-rsa not-base64-of-rsa`,
    ].join('\n');
    expect(knownHostKeys(text, 'BASTION.example.net', 22)).toEqual([{ type: 'ssh-ed25519', fingerprint: sshFingerprint(keyBuffer(ed)) }]);
    expect(knownHostKeys(text, 'bastion.example.net', 2200)).toEqual([]);
    expect(knownHostKeys(text, 'jump.example.net', 2222)).toEqual([{ type: 'ecdsa-sha2-nistp256', fingerprint: sshFingerprint(keyBuffer(ec)) }]);
    expect(knownHostKeys(text, 'db.corp.example', 22)).toHaveLength(1);
    expect(knownHostKeys(text, 'secret.corp.example', 22)).toEqual([]);
    expect(knownHostKeys(text, 'old.example.net', 22)).toEqual([{ type: 'ssh-ed25519', fingerprint: sshFingerprint(keyBuffer(ed)), revoked: true }]);
    expect(knownHostKeys(text, 'broken.example.net', 22)).toEqual([]);
  });

  it('calls a key changed only when another key of its type is known', () => {
    const known = [{ type: 'ssh-ed25519', fingerprint: 'SHA256:a' }];
    expect(judgeHostKey(known, 'ssh-ed25519', 'SHA256:a')).toBe('trusted');
    expect(judgeHostKey(known, 'ssh-ed25519', 'SHA256:b')).toBe('changed');
    expect(judgeHostKey(known, 'ecdsa-sha2-nistp256', 'SHA256:c')).toBe('unknown');
    expect(judgeHostKey([{ ...known[0]!, revoked: true }], 'ssh-ed25519', 'SHA256:a')).toBe('revoked');
  });
});

describe('ssh config', () => {
  const text = [
    'User fallback',
    'Host bastion prod-*',
    '  HostName bastion.example.net',
    '  Port 2222',
    '  IdentityFile ~/.ssh/id_ed25519',
    '  ProxyJump deploy@jump.example.net:2200,edge',
    'Match host *',
    '  User ignored',
    'Host *',
    '  User everyone',
    '  IdentityFile ~/.ssh/%h',
  ].join('\n');

  it('resolves a named alias with the first value of each keyword', () => {
    expect(resolveSshConfig(text, 'bastion', '/home/me')).toEqual({
      alias: 'bastion',
      hostName: 'bastion.example.net',
      user: 'fallback',
      port: 2222,
      identityFile: '/home/me/.ssh/id_ed25519',
      proxyJump: [{ host: 'jump.example.net', user: 'deploy', port: 2200 }, { host: 'edge' }],
    });
  });

  it('says nothing for a host only wildcards cover', () => {
    expect(resolveSshConfig(text, 'db.internal', '/home/me')).toBeNull();
    expect(resolveSshConfig(text, 'prod-eu', '/home/me')).toBeNull();
  });
});

describe('host key store', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'lingua-hostkeys-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('keeps trusted keys per host and port in a private file, one per key type', async () => {
    const file = path.join(dir, 'sql-ssh-host-keys.json');
    const store = createHostKeyStore(file);
    const fingerprint = sshFingerprint(keyBuffer(publicLine('ed25519')));
    expect(await store.trust('Bastion', 2222, { type: 'ssh-ed25519', fingerprint })).toBe(true);
    expect(await store.trust('bastion', 2222, { type: 'ssh-ed25519', fingerprint: 'not a fingerprint' })).toBe(false);
    expect(await createHostKeyStore(file).list('bastion', 2222)).toEqual([{ type: 'ssh-ed25519', fingerprint }]);
    expect(await createHostKeyStore(file).list('bastion', 22)).toEqual([]);
    expect(JSON.parse(readFileSync(file, 'utf-8')).keys).toHaveProperty(['[bastion]:2222']);
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});
