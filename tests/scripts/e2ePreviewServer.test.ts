// @vitest-environment node
import { readFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  deriveE2ePreviewPort,
  resolveE2ePreviewServer,
} from '../../scripts/lib/e2ePreviewServer.mjs';

const INDEX_HTML = '<script src="/assets/index-own.js"></script>';
const FOREIGN_HTML = '<script src="/assets/index-foreign.js"></script>';

const servers: net.Server[] = [];
const sockets = new Set<net.Socket>();

afterEach(async () => {
  const closed = servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve)));
  sockets.forEach((socket) => socket.destroy());
  sockets.clear();
  await Promise.all(closed);
});

function listen(server: net.Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.on('connection', (socket) => {
      socket.on('error', () => undefined);
      sockets.add(socket);
    });
    server.listen(port, 'localhost', () => {
      servers.push(server);
      resolve((server.address() as net.AddressInfo).port);
    });
  });
}

function servingHtml(html: string): http.Server {
  return http.createServer((_request, response) => response.end(html));
}

/** Listens on the derived port of a throwaway root, skipping ports already in use. */
async function occupyDerivedPort(server: net.Server): Promise<{ repoRoot: string; port: number }> {
  for (let attempt = 0; ; attempt += 1) {
    const repoRoot = `/worktrees/e2e-preview-${process.pid}-${attempt}`;
    const port = await listen(server, deriveE2ePreviewPort(repoRoot)).catch(() => null);
    if (port !== null) return { repoRoot, port };
  }
}

describe('deriveE2ePreviewPort', () => {
  it('is stable for a path and differs across worktrees', () => {
    const first = deriveE2ePreviewPort('/worktrees/a');
    expect(deriveE2ePreviewPort('/worktrees/a')).toBe(first);
    expect(deriveE2ePreviewPort('/worktrees/b')).not.toBe(first);
    expect(first).toBeGreaterThanOrEqual(20000);
    expect(first).toBeLessThan(30000);
  });
});

describe('resolveE2ePreviewServer', () => {
  it('reuses a server that serves this checkout', async () => {
    const { repoRoot, port } = await occupyDerivedPort(servingHtml(INDEX_HTML));
    await expect(
      resolveE2ePreviewServer({ repoRoot, indexHtml: INDEX_HTML, env: {} })
    ).resolves.toEqual({ port, reuse: true });
  });

  it('moves off a derived port held by another checkout', async () => {
    const { repoRoot, port } = await occupyDerivedPort(servingHtml(FOREIGN_HTML));
    const resolved = await resolveE2ePreviewServer({ repoRoot, indexHtml: INDEX_HTML, env: {} });
    expect(resolved.port).not.toBe(port);
    expect(resolved.reuse).toBe(false);
  });

  it('moves off a derived port held by something that does not speak HTTP', async () => {
    const garbage = net.createServer((socket) => socket.end('not http\r\n\r\n'));
    const { repoRoot, port } = await occupyDerivedPort(garbage);
    const resolved = await resolveE2ePreviewServer({ repoRoot, indexHtml: INDEX_HTML, env: {} });
    expect(resolved.port).not.toBe(port);
  });

  it('moves off a derived port held by something that never answers', async () => {
    const { repoRoot, port } = await occupyDerivedPort(net.createServer());
    const resolved = await resolveE2ePreviewServer({ repoRoot, indexHtml: INDEX_HTML, env: {} });
    expect(resolved.port).not.toBe(port);
  });

  it('starts a new server on a free override', async () => {
    const free = http.createServer();
    const port = await listen(free, 0);
    servers.splice(servers.indexOf(free), 1);
    await new Promise((resolve) => free.close(resolve));

    await expect(
      resolveE2ePreviewServer({
        repoRoot: '/worktrees/a',
        indexHtml: INDEX_HTML,
        env: { LINGUA_E2E_PORT: String(port) },
      })
    ).resolves.toEqual({ port, reuse: false });
  });

  it('reuses this checkout on an override and refuses anything else', async () => {
    const own = await listen(servingHtml(INDEX_HTML), 0);
    await expect(
      resolveE2ePreviewServer({
        repoRoot: '/worktrees/a',
        indexHtml: INDEX_HTML,
        env: { LINGUA_E2E_PORT: String(own) },
      })
    ).resolves.toEqual({ port: own, reuse: true });

    const foreign = await listen(servingHtml(FOREIGN_HTML), 0);
    await expect(
      resolveE2ePreviewServer({
        repoRoot: '/worktrees/a',
        indexHtml: INDEX_HTML,
        env: { LINGUA_E2E_PORT: String(foreign) },
      })
    ).rejects.toThrow(`LINGUA_E2E_PORT=${foreign}`);
  });

  it.each(['abc', '0', '70000', '41.5'])('rejects the invalid override %s', async (value) => {
    await expect(
      resolveE2ePreviewServer({
        repoRoot: '/worktrees/a',
        indexHtml: INDEX_HTML,
        env: { LINGUA_E2E_PORT: value },
      })
    ).rejects.toThrow('must be a port number');
  });

  it('keeps CI on the fixed port without reuse, even when it serves this checkout', async () => {
    await expect(
      resolveE2ePreviewServer({ repoRoot: '/worktrees/a', indexHtml: INDEX_HTML, env: { CI: '1' } })
    ).resolves.toEqual({ port: 4175, reuse: false });

    const own = await listen(servingHtml(INDEX_HTML), 0);
    await expect(
      resolveE2ePreviewServer({
        repoRoot: '/worktrees/a',
        indexHtml: INDEX_HTML,
        env: { CI: 'true', LINGUA_E2E_PORT: String(own) },
      })
    ).resolves.toEqual({ port: own, reuse: false });
  });
});

describe('web e2e Playwright config', () => {
  it('takes the port and the reuse decision from the wrapper', () => {
    const config = readFileSync(
      path.join(__dirname, '..', '..', 'playwright.license-web.config.mts'),
      'utf8'
    );
    expect(config).toContain('const port = process.env.LINGUA_E2E_PORT;');
    expect(config).toContain("reuseExistingServer: process.env.LINGUA_E2E_REUSE_SERVER === '1',");
  });
});
