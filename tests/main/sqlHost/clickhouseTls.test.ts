import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openClickHouse } from '../../../src/main/sqlHost/clickhouse';
import type { HostSessionConfig } from '../../../src/main/sqlHost/protocol';

const hasOpenssl = (() => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasOpenssl)('ClickHouse TLS identity', () => {
  let dir = '';
  let server: https.Server;
  let port = 0;

  beforeAll(async () => {
    // A certificate whose only name is localhost, trusted through caPath.
    dir = mkdtempSync(path.join(os.tmpdir(), 'lingua-ch-tls-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem')], { stdio: 'ignore' });
    server = https.createServer({ key: readFileSync(path.join(dir, 'key.pem')), cert: readFileSync(path.join(dir, 'cert.pem')) }, (_request, response) => {
      response.setHeader('Content-Type', 'application/x-ndjson');
      response.end('{"1":1}\n');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const config = (servername: string): HostSessionConfig => ({
    connectionId: 'ch-tls',
    engine: 'clickhouse',
    address: '127.0.0.1',
    servername,
    port,
    user: 'reader',
    password: 'never-sent',
    ssl: { mode: 'verify-full', caPath: path.join(dir, 'cert.pem') },
    readOnly: false,
  });

  it('checks a certificate against an IP-literal host, never against localhost', async () => {
    await expect(openClickHouse(config('127.0.0.1'))).rejects.toThrow(/IP|altnames|does not match/i);
  });

  it('accepts the same certificate for the name it was issued to', async () => {
    const session = await openClickHouse(config('localhost'));
    expect(session.encrypted?.()).toBe(true);
    await session.close();
  });
});
