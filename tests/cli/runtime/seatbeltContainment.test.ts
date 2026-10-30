/**
 * Adversarial fixtures for the macOS Seatbelt backend.
 *
 * Each program runs under the real sandbox. Every assertion that matters is
 * made from the host: listeners count connections, canary files and staged
 * bytes are inspected after the run. What the program prints is only a hint.
 */

import { createServer as createTcpServer, type Server } from 'node:net';
import { createSocket, type Socket as UdpSocket } from 'node:dgram';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { runReproReviewCommand, runReproRunCommand } from '../../../src/cli/commands/repro';
import {
  resolveReproNodeRuntime,
  type ReproNodeRuntime,
} from '../../../src/cli/runtime/containment';
import {
  disposeReproStaging,
  stageReproEnvelope,
  type ReproStaging,
} from '../../../src/cli/runtime/reproStaging';
import { seatbeltBackend } from '../../../src/cli/runtime/seatbelt';
import { buildReproEnvelope } from '../../../src/shared/reproEnvelope';
import { DEFAULT_REPRO_REQUEST, type ReproPolicyV1 } from '../../../src/shared/reproPolicy';
import { computeContentHash, type RunCapsuleV1 } from '../../../src/shared/runCapsule';
import { FIXTURE_MINIMAL_JS } from '../../shared/runCapsule.fixtures';
import { createFakeIo } from '../io-fake';

const CANARY = 'LINGUA-CANARY-7f3a';
const SLOW = 20_000;

/** Prints one JSON line per attempted operation; the host never trusts it alone. */
const ATTEMPT = `
const attempt = async (name, fn) => {
  try {
    const value = await fn();
    console.log(JSON.stringify({ name, allowed: true, value: String(value).slice(0, 80) }));
  } catch (error) {
    console.log(JSON.stringify({ name, allowed: false, code: error?.code ?? String(error) }));
  }
};
`;

async function capsuleFor(source: string, stdout = ''): Promise<RunCapsuleV1> {
  return {
    ...FIXTURE_MINIMAL_JS,
    source: { content: source, contentHash: await computeContentHash(source) },
    result: { status: 'success', durationMs: 1, stdout },
  };
}

function attempts(
  stdout: string
): Record<string, { allowed: boolean; code?: string; value?: string }> {
  return Object.fromEntries(
    stdout
      .split('\n')
      .filter(line => line.startsWith('{'))
      .map(line => JSON.parse(line) as { name: string; allowed: boolean })
      .map(entry => [entry.name, entry])
  );
}

describe.runIf(process.platform === 'darwin')('Seatbelt containment (macOS)', () => {
  let node: ReproNodeRuntime;
  let host: string;
  let canaryPath: string;
  let staged: ReproStaging[] = [];

  beforeAll(async () => {
    expect(await seatbeltBackend.probe()).not.toBeNull();
    const resolved = await resolveReproNodeRuntime(process.execPath);
    if (!resolved) throw new Error('the test Node.js runtime could not be resolved');
    node = resolved;
    host = await realpath(await mkdtemp(path.join(os.tmpdir(), 'seatbelt-host-')));
    canaryPath = path.join(host, 'secret.txt');
    await writeFile(canaryPath, CANARY);
  });

  afterEach(async () => {
    await Promise.all(staged.map(staging => disposeReproStaging(staging)));
    staged = [];
  });

  afterAll(async () => {
    if (host) await rm(host, { recursive: true, force: true });
  });

  async function launch(
    source: string,
    options: {
      policy?: ReproPolicyV1;
      args?: string[];
      files?: Array<{ path: string; content: string }>;
    } = {}
  ) {
    const built = await buildReproEnvelope({
      capsule: await capsuleFor(source),
      entry: 'main.mjs',
      runtime: { name: 'node', major: Number(node.version.split('.')[0]) },
      files: (options.files ?? []).map(file => ({ ...file, language: 'javascript' })),
      request: options.policy ?? DEFAULT_REPRO_REQUEST,
    });
    if (!built.ok) throw new Error(`fixture envelope rejected: ${built.reason}`);
    const staging = await stageReproEnvelope(built.value);
    staged.push(staging);
    const outcome = await seatbeltBackend.launch({
      staging,
      policy: options.policy ?? DEFAULT_REPRO_REQUEST,
      node,
      args: options.args ?? [],
    });
    return { staging, outcome, results: attempts(outcome.result.stdout) };
  }

  it(
    'positive control: imports staged modules, writes scratch and output, and prints deterministically',
    async () => {
      const { staging, outcome, results } = await launch(
        `${ATTEMPT}
import fs from 'node:fs';
import { sum } from './lib/sum.mjs';
await attempt('import', () => sum(1, 2));
await attempt('write-scratch', () => fs.writeFileSync(process.env.TMPDIR + '/s.txt', 'ok'));
await attempt('write-output', () => fs.writeFileSync(new URL('../output/result.txt', import.meta.url), 'done'));
`,
        { files: [{ path: 'lib/sum.mjs', content: 'export const sum = (a, b) => a + b;\n' }] }
      );

      expect(outcome.result.status).toBe('success');
      expect(results.import).toMatchObject({ allowed: true, value: '3' });
      expect(results['write-scratch']?.allowed).toBe(true);
      expect(await readFile(path.join(staging.output, 'result.txt'), 'utf8')).toBe('done');
      expect(outcome.evidence).toEqual({ coverage: 'unavailable', denials: [] });
    },
    SLOW
  );

  it(
    '1. cannot read a secret outside staging by absolute path, alias or a symlink it creates',
    async () => {
      const aliased = canaryPath.replace('/private/', '/private/./');
      const { outcome, results } = await launch(
        `${ATTEMPT}
import fs from 'node:fs';
const [secret, alias] = process.argv.slice(2);
await attempt('absolute', () => fs.readFileSync(secret, 'utf8'));
await attempt('alias', () => fs.readFileSync(alias, 'utf8'));
await attempt('symlink', () => { fs.symlinkSync(secret, 'link.txt'); return fs.readFileSync('link.txt', 'utf8'); });
`,
        { args: [canaryPath, aliased] }
      );

      expect(outcome.result.stdout).not.toContain(CANARY);
      expect(results.absolute?.allowed).toBe(false);
      expect(results.alias?.allowed).toBe(false);
      expect(results.symlink?.allowed).toBe(false);
    },
    SLOW
  );

  it(
    '2. cannot modify a staged input or write outside its areas',
    async () => {
      const outside = path.join(host, 'escape-2.txt');
      const { staging, results } = await launch(
        `${ATTEMPT}
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
await attempt('overwrite-entry', () => fs.writeFileSync(fileURLToPath(import.meta.url), 'pwned'));
await attempt('new-input', () => fs.writeFileSync(new URL('./added.mjs', import.meta.url), 'x'));
await attempt('outside', () => fs.writeFileSync(process.argv[2], 'x'));
`,
        { args: [outside] }
      );

      expect(await readFile(staging.entry, 'utf8')).not.toBe('pwned');
      expect(await readdir(staging.inputs)).toEqual(['main.mjs']);
      expect(existsSync(outside)).toBe(false);
      expect(results['overwrite-entry']?.allowed).toBe(false);
    },
    SLOW
  );

  it(
    '3. cannot escape through traversal or a symlink planted in scratch',
    async () => {
      const outside = path.join(host, 'escape-3.txt');
      const { staging } = await launch(
        `${ATTEMPT}
import fs from 'node:fs';
await attempt('traversal', () => fs.writeFileSync(new URL('../../escape-3.txt', import.meta.url), 'x'));
await attempt('planted-link', () => { fs.symlinkSync(process.argv[2], 'out.txt'); fs.writeFileSync('out.txt', 'x'); });
`,
        { args: [outside] }
      );

      expect(existsSync(outside)).toBe(false);
      expect(existsSync(path.join(path.dirname(staging.root), 'escape-3.txt'))).toBe(false);
    },
    SLOW
  );

  it(
    '4. cannot reach TCP over IPv4 or IPv6, UDP, or DNS',
    async () => {
      let tcpConnections = 0;
      let udpMessages = 0;
      const tcp4: Server = createTcpServer(socket => {
        tcpConnections += 1;
        socket.destroy();
      });
      const tcp6: Server = createTcpServer(socket => {
        tcpConnections += 1;
        socket.destroy();
      });
      const udp: UdpSocket = createSocket('udp4').on('message', () => {
        udpMessages += 1;
      });
      await new Promise<void>(resolve => tcp4.listen(0, '127.0.0.1', resolve));
      await new Promise<void>(resolve => tcp6.listen(0, '::1', resolve));
      await new Promise<void>(resolve => udp.bind(0, '127.0.0.1', resolve));
      const port = (server: Server) => (server.address() as { port: number }).port;
      try {
        const { results } = await launch(
          `${ATTEMPT}
import net from 'node:net';
import dgram from 'node:dgram';
import dns from 'node:dns/promises';
const [p4, p6, pu] = process.argv.slice(2).map(Number);
const connect = (host, port) => new Promise((resolve, reject) => {
  const socket = net.connect(port, host, () => { socket.destroy(); resolve('connected'); });
  socket.on('error', reject);
});
await attempt('tcp4', () => connect('127.0.0.1', p4));
await attempt('tcp6', () => connect('::1', p6));
await attempt('udp', () => new Promise((resolve, reject) => {
  const socket = dgram.createSocket('udp4');
  socket.on('error', error => { socket.close(); reject(error); });
  socket.send('x', pu, '127.0.0.1', error => { socket.close(); error ? reject(error) : resolve('sent'); });
}));
await attempt('dns', () => dns.lookup('example.com'));
`,
          { args: [String(port(tcp4)), String(port(tcp6)), String(udp.address().port)] }
        );
        await new Promise(resolve => setTimeout(resolve, 200));

        expect(tcpConnections).toBe(0);
        expect(udpMessages).toBe(0);
        expect(results.tcp4?.allowed).toBe(false);
        expect(results.tcp6?.allowed).toBe(false);
        expect(results.udp?.allowed).toBe(false);
        expect(results.dns?.allowed).toBe(false);
      } finally {
        tcp4.close();
        tcp6.close();
        udp.close();
      }
    },
    SLOW
  );

  it(
    '5. cannot connect to a local Unix socket',
    async () => {
      const socketDir = await mkdtemp(path.join('/tmp', 'lr-'));
      const socketPath = path.join(socketDir, 's.sock');
      let connections = 0;
      const server = createTcpServer(socket => {
        connections += 1;
        socket.destroy();
      });
      await new Promise<void>(resolve => server.listen(socketPath, resolve));
      try {
        const { results } = await launch(
          `${ATTEMPT}
import net from 'node:net';
await attempt('unix', () => new Promise((resolve, reject) => {
  const socket = net.connect(process.argv[2], () => { socket.destroy(); resolve('connected'); });
  socket.on('error', reject);
}));
`,
          { args: [socketPath] }
        );
        await new Promise(resolve => setTimeout(resolve, 200));

        expect(connections).toBe(0);
        expect(results.unix?.allowed).toBe(false);
      } finally {
        server.close();
        await rm(socketDir, { recursive: true, force: true });
      }
    },
    SLOW
  );

  it(
    '6. cannot start a child or grandchild process',
    async () => {
      const marker = path.join(host, 'child-ran.txt');
      const { results } = await launch(
        `${ATTEMPT}
import cp from 'node:child_process';
const marker = process.argv[2];
await attempt('shell', () => cp.execFileSync('/bin/sh', ['-c', 'echo x > ' + marker]));
await attempt('node', () => cp.execFileSync(process.execPath, ['-e', 'require("fs").writeFileSync(' + JSON.stringify(marker) + ', "x")']));
await attempt('spawn-async', () => new Promise((resolve, reject) => {
  const child = cp.spawn('/bin/sh', ['-c', 'echo x > ' + marker]);
  child.on('error', reject);
  child.on('exit', code => resolve('exit ' + code));
}));
`,
        { args: [marker] }
      );

      expect(existsSync(marker)).toBe(false);
      expect(results.shell?.allowed).toBe(false);
      expect(results.node?.allowed).toBe(false);
      expect(results['spawn-async']?.allowed).toBe(false);
    },
    SLOW
  );

  it(
    '7. sees no inherited environment and cannot look into the real home directory',
    async () => {
      process.env.LINGUA_REPRO_TEST_SECRET = CANARY;
      try {
        const { staging, outcome, results } = await launch(
          `${ATTEMPT}
import fs from 'node:fs';
console.log(JSON.stringify({ name: 'env', allowed: true, value: JSON.stringify(process.env) }));
await attempt('home-stat', () => fs.statSync(process.argv[2]).isDirectory());
`,
          // The home directory itself may be an ancestor of the Node binary; its contents are not.
          { args: [path.join(os.homedir(), 'Library')] }
        );

        expect(outcome.result.stdout).not.toContain(CANARY);
        const env = JSON.parse(outcome.result.stdout.split('\n')[0]!).value as string;
        expect(Object.keys(JSON.parse(env)).sort()).toEqual(['HOME', 'TMPDIR']);
        expect(JSON.parse(env).HOME).toBe(staging.scratch);
        expect(results['home-stat']?.allowed).toBe(false);
      } finally {
        delete process.env.LINGUA_REPRO_TEST_SECRET;
      }
    },
    SLOW
  );

  it(
    '8. is clipped at the output limit and stopped at the wall-clock limit',
    async () => {
      const tight: ReproPolicyV1 = {
        ...DEFAULT_REPRO_REQUEST,
        limits: { ...DEFAULT_REPRO_REQUEST.limits, outputBytes: 4096, wallClockMs: 500 },
      };
      const flood = await launch(`process.stdout.write('x'.repeat(100_000));`, { policy: tight });
      const started = Date.now();
      const spin = await launch(`for (;;) {}`, { policy: tight });

      expect(flood.outcome.result.truncated?.stdout).toBe(true);
      expect(Buffer.byteLength(flood.outcome.result.stdout)).toBeLessThanOrEqual(4096);
      expect(spin.outcome.result.status).toBe('timeout');
      expect(Date.now() - started).toBeLessThan(10_000);
    },
    SLOW
  );

  it(
    '9. cannot write next to its areas, where the supervisor keeps its own state',
    async () => {
      const { staging, results } = await launch(
        `${ATTEMPT}
import fs from 'node:fs';
await attempt('root', () => fs.writeFileSync(new URL('../receipt.json', import.meta.url), '{}'));
`
      );

      expect((await readdir(staging.root)).sort()).toEqual(['inputs', 'output', 'scratch']);
      expect(results.root?.allowed).toBe(false);
    },
    SLOW
  );

  it(
    '10. a program that catches a denial and prints the expected output is never reported clean',
    async () => {
      const source = `import fs from 'node:fs';\ntry { fs.readFileSync(${JSON.stringify(canaryPath)}); } catch {}\nconsole.log(3);\n`;
      const built = await buildReproEnvelope({
        capsule: await capsuleFor(source, '3\n'),
        entry: 'main.mjs',
        runtime: { name: 'node', major: Number(node.version.split('.')[0]) },
        files: [],
        request: DEFAULT_REPRO_REQUEST,
      });
      if (!built.ok) throw new Error(`fixture envelope rejected: ${built.reason}`);
      const files = { '/work/repro.json': built.json };
      const review = createFakeIo({ files });
      await runReproReviewCommand(
        {
          json: true,
          quiet: false,
          envelopePath: '/work/repro.json',
          resolveNode: async () => node,
        },
        review.io
      );
      const token = (JSON.parse(review.state.stdout) as { approval: { token: string } }).approval
        .token;
      const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'seatbelt-run-')));
      const { io, state } = createFakeIo({ files });

      try {
        await runReproRunCommand(
          {
            json: true,
            quiet: false,
            envelopePath: '/work/repro.json',
            approve: token,
            linguaVersion: 'test',
            resolveNode: async () => node,
            stagingParent: parent,
          },
          io
        );
        const body = JSON.parse(state.stdout) as { verdict: Record<string, string> };

        expect(body.verdict).toEqual({
          overall: 'pass',
          output: 'pass',
          enforcement: 'enforced',
          compliance: 'not-observed',
          evidence: 'unavailable',
        });
        expect(await readdir(parent)).toEqual([]);
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    },
    SLOW
  );

  it('refuses a policy that requires memory or disk limits or denial evidence', async () => {
    const probe = await seatbeltBackend.probe();

    expect(probe?.controls).toMatchObject({
      'memory-limit': 'unsupported',
      'disk-limit': 'unsupported',
      'denial-evidence': 'unsupported',
    });
  });
});

describe.skipIf(process.platform === 'darwin')('Seatbelt containment (non-macOS)', () => {
  it('reports no Seatbelt backend', async () => {
    expect(await seatbeltBackend.probe()).toBeNull();
  });
});
