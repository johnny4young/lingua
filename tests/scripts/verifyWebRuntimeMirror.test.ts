import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyWebRuntimeMirror } from '../../scripts/verify-web-runtime-mirror.mjs';

const APP_ORIGIN = 'https://app.linguacode.dev';
const execFileAsync = promisify(execFile);
const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
const altered = Buffer.from([0, 97, 115, 109, 1, 0, 0, 1]);
let server: Server;
let root: string;
let filePath: string;
let origin: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'lingua-runtime-mirror-'));
  filePath = path.join(root, 'runtime.wasm');
  await writeFile(filePath, wasm);
  server = createServer((request, response) => {
    const pathname = request.url ?? '/';
    if (pathname === '/redirect') {
      response.writeHead(302, { Location: '/good' }).end();
      return;
    }
    const status = pathname === '/missing' ? 404 : pathname === '/challenge' ? 403 : 200;
    const body = pathname === '/tampered' ? altered : wasm;
    response.writeHead(status, {
      'Access-Control-Allow-Origin': pathname === '/no-cors' ? 'https://other.example' : APP_ORIGIN,
      'Content-Type': pathname === '/html' ? 'text/html' : 'application/wasm',
      ...(pathname === '/challenge' ? { 'cf-mitigated': 'challenge' } : {}),
    });
    response.end(body);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server');
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close(error => (error ? reject(error) : resolve()))
  );
  await rm(root, { recursive: true, force: true });
});

describe('web runtime mirror verification', () => {
  it('streams matching bytes and reports the source digest', async () => {
    const result = await verifyWebRuntimeMirror(filePath, `${origin}/good`);
    expect(result.sha256).toBe(createHash('sha256').update(wasm).digest('hex'));
    expect(result.bytes).toBe(wasm.length);
  });

  it('rejects tampered bytes even when status, CORS, and MIME look valid', async () => {
    await expect(verifyWebRuntimeMirror(filePath, `${origin}/tampered`)).rejects.toThrow(
      /digest mismatch/i
    );
    expect(await readFile(filePath)).toEqual(wasm);
  });

  it.each([
    ['/missing', /HTTP 404/i],
    ['/challenge', /Cloudflare challenge/i],
    ['/no-cors', /CORS/i],
    ['/html', /application\/wasm/i],
    ['/redirect', /redirect/i],
  ])('rejects invalid mirror response %s', async (route, message) => {
    await expect(verifyWebRuntimeMirror(filePath, `${origin}${route}`)).rejects.toThrow(message);
  });

  it('runs verification after upload and before Pages promotion', async () => {
    const workflow = await readFile('.github/workflows/deploy-web.yml', 'utf8');
    const upload = workflow.indexOf('"${ruby_src}"');
    const verifier = workflow.indexOf('node scripts/verify-web-runtime-mirror.mjs');
    const deploy = workflow.indexOf('- name: Deploy to Cloudflare Pages');
    expect(upload).toBeGreaterThan(0);
    expect(verifier).toBeGreaterThan(upload);
    expect(deploy).toBeGreaterThan(verifier);
    expect(workflow).toContain(
      '"${duckdb_src}" "${runtime_base}/duckdb/${duckdb_version}/duckdb-mvp.wasm"'
    );
    expect(workflow).toContain(
      '"${ruby_src}" "${runtime_base}/ruby/${ruby_version}/ruby+stdlib.wasm"'
    );
  });

  it('makes the CLI fail closed on altered public bytes', async () => {
    const script = 'scripts/verify-web-runtime-mirror.mjs';
    const good = await execFileAsync(process.execPath, [script, filePath, `${origin}/good`]);
    expect(good.stdout).toContain('runtime mirror verified:');
    await expect(
      execFileAsync(process.execPath, [script, filePath, `${origin}/tampered`])
    ).rejects.toMatchObject({ code: 1 });
  });
});
