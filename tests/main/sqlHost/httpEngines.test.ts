import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openLibsqlHost } from '../../../src/main/sqlHost/httpEngines';
import type { HostSessionConfig } from '../../../src/main/sqlHost/protocol';

const version = JSON.stringify({ baton: null, base_url: null, results: [{ type: 'ok', response: { type: 'execute', result: { cols: [{ name: 'v' }], rows: [[{ type: 'text', value: '3.45.1' }]], affected_row_count: 0 } } }, { type: 'ok', response: { type: 'close' } }] });

const hasOpenssl = (() => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const config = (port: number, servername: string, mode: 'disable' | 'verify-full'): HostSessionConfig => ({
  connectionId: 'turso',
  engine: 'libsql',
  address: '127.0.0.1',
  servername,
  port,
  ssl: { mode },
  password: 'token',
  readOnly: false,
});

describe('pinned HTTP transport', () => {
  let server: http.Server;
  let port = 0;
  const seen: Array<{ host?: string; url?: string; authorization?: string }> = [];

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      seen.push({ host: request.headers.host, url: request.url, authorization: request.headers.authorization });
      response.setHeader('content-type', 'application/json');
      response.end(version);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => server.close());

  it('connects to the pinned address and names the host in the Host header, whatever the name resolves to', async () => {
    const session = await openLibsqlHost(config(port, 'db.does-not-resolve.test', 'disable'));
    expect(await session.version()).toBe('libSQL (SQLite 3.45.1)');
    expect(seen.at(-1)).toEqual({ host: `db.does-not-resolve.test:${port}`, url: '/v2/pipeline', authorization: 'Bearer token' });
    expect(session.encrypted?.()).toBe(false);
    await session.close();
  });
});

describe.skipIf(!hasOpenssl)('pinned HTTPS transport', () => {
  let dir = '';
  let server: https.Server;
  let port = 0;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'lingua-http-tls-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem')], { stdio: 'ignore' });
    server = https.createServer({ key: readFileSync(path.join(dir, 'key.pem')), cert: readFileSync(path.join(dir, 'cert.pem')) }, (_request, response) => response.end(version));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses a certificate no system root signs, so a libSQL token never goes to an unverified server', async () => {
    await expect(openLibsqlHost(config(port, 'localhost', 'verify-full'))).rejects.toThrow(/self[- ]signed|unable to verify/i);
  });
});
