import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

vi.mock('electron', () => ({
  app: { isPackaged: false },
}));

import {
  _resetLocalMcpForTests,
  disposeLocalMcpServerForRoot,
  getLocalMcpState,
  startLocalMcpServer,
  stopLocalMcpServer,
} from '../../src/main/localMcp';
import { clearRegistryForTests, mintRootCapability } from '../../src/main/ipc/projectCapabilities';
import { isLocalMcpSensitivePath, registerLocalMcpTools } from '../../src/main/localMcpTools';
import type { McpServer } from '@modelcontextprotocol/server';
import { LOCAL_MCP_TOOL_NAMES } from '../../src/shared/localMcp';

let projectRoot: string;

beforeEach(async () => {
  clearRegistryForTests();
  projectRoot = await mkdtemp(path.join(process.cwd(), '.tmp-local-mcp-'));
  await mkdir(path.join(projectRoot, 'src'), { recursive: true });
  await writeFile(
    path.join(projectRoot, 'src', 'index.ts'),
    'export const greeting = "hello from Lingua";\n',
    'utf8'
  );
  await writeFile(path.join(projectRoot, '.env'), 'API_TOKEN=must-not-leak\n', 'utf8');
  await writeFile(path.join(projectRoot, 'binary.bin'), Buffer.from([0, 1, 2, 3]));
});

afterEach(async () => {
  await _resetLocalMcpForTests();
  clearRegistryForTests();
  await rm(projectRoot, { recursive: true, force: true });
});

function start(rootId: ReturnType<typeof mintRootCapability>['rootId'], ownerId = 41) {
  return startLocalMcpServer({
    rootId,
    ownerId,
    appVersion: '0.15.0-test',
    acknowledged: true,
    isOwnerAlive: () => true,
    onStateChanged: vi.fn(),
  });
}

describe('local MCP policy', () => {
  it('recognizes common secret-bearing project paths without blocking ordinary source', () => {
    expect(isLocalMcpSensitivePath('.env')).toBe(true);
    expect(isLocalMcpSensitivePath('.env.production')).toBe(true);
    expect(isLocalMcpSensitivePath('config/service-account.json')).toBe(true);
    expect(isLocalMcpSensitivePath('certs/signing.pem')).toBe(true);
    expect(isLocalMcpSensitivePath('.ssh/config')).toBe(true);
    expect(isLocalMcpSensitivePath('src/index.ts')).toBe(false);
    expect(isLocalMcpSensitivePath('src/secretParser.ts')).toBe(false);
  });
});

describe('local MCP HTTP server', () => {
  it('requires explicit acknowledgement and a live project capability', async () => {
    const { rootId } = mintRootCapability(projectRoot);
    await expect(
      startLocalMcpServer({
        rootId,
        ownerId: 41,
        appVersion: 'test',
        acknowledged: false,
        isOwnerAlive: () => true,
        onStateChanged: vi.fn(),
      })
    ).resolves.toEqual({ ok: false, reason: 'invalid-acknowledgement' });

    clearRegistryForTests();
    await expect(start(rootId)).resolves.toEqual({ ok: false, reason: 'invalid-project' });
  });

  it('rejects unauthenticated and non-loopback-origin requests before protocol dispatch', async () => {
    const { rootId } = mintRootCapability(projectRoot);
    const result = await start(rootId);
    if (!result.ok) throw new Error(`server start failed: ${result.reason}`);

    const unauthenticated = await fetch(result.state.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get('cache-control')).toBe('no-store');

    const rebound = await fetch(result.state.endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${result.state.accessToken}`,
        'content-type': 'application/json',
        origin: 'https://attacker.example',
      },
      body: '{}',
    });
    expect(rebound.status).toBe(403);

    const oversized = await fetch(result.state.endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${result.state.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ value: 'x'.repeat(1024 * 1024) }),
    });
    expect(oversized.status).toBe(413);
  });

  it('serves the bounded read-only tool surface through the official SDK client', async () => {
    const { rootId } = mintRootCapability(projectRoot);
    const result = await start(rootId);
    if (!result.ok) throw new Error(`server start failed: ${result.reason}`);

    const transport = new StreamableHTTPClientTransport(new URL(result.state.endpoint), {
      authProvider: { token: async () => result.state.accessToken },
    });
    const client = new Client({ name: 'lingua-test', version: '1.0.0' });
    await client.connect(transport);
    try {
      const listed = await client.listTools();
      expect(listed.tools.map(tool => tool.name)).toEqual(LOCAL_MCP_TOOL_NAMES);
      expect(
        listed.tools.every(
          tool =>
            tool.annotations?.readOnlyHint === true &&
            tool.annotations?.destructiveHint === false &&
            tool.annotations?.openWorldHint === false
        )
      ).toBe(true);

      const info = await client.callTool({ name: 'lingua_project_info', arguments: {} });
      expect(info.structuredContent).toMatchObject({
        projectName: path.basename(projectRoot),
        access: 'read-only',
      });

      const tree = await client.callTool({
        name: 'lingua_list_files',
        arguments: { depth: 3 },
      });
      expect(tree.structuredContent).toMatchObject({
        entries: expect.arrayContaining([
          { path: 'src', type: 'directory' },
          { path: 'src/index.ts', type: 'file' },
        ]),
      });
      expect(JSON.stringify(tree.structuredContent)).not.toContain('.env');

      const read = await client.callTool({
        name: 'lingua_read_file',
        arguments: { path: 'src/index.ts', maxBytes: 12 },
      });
      expect(read.structuredContent).toMatchObject({
        path: 'src/index.ts',
        content: 'export const',
        truncated: true,
        nextOffset: 12,
      });

      const secret = await client.callTool({
        name: 'lingua_read_file',
        arguments: { path: '.env' },
      });
      expect(secret.isError).toBe(true);
      expect(JSON.stringify(secret)).not.toContain('must-not-leak');

      const binary = await client.callTool({
        name: 'lingua_read_file',
        arguments: { path: 'binary.bin' },
      });
      expect(binary.isError).toBe(true);

      const search = await client.callTool({
        name: 'lingua_search_project',
        arguments: { query: 'hello', maxResults: 20 },
      });
      expect(search.structuredContent).toMatchObject({
        matches: [expect.objectContaining({ path: 'src/index.ts', line: 1 })],
      });
      expect(JSON.stringify(search.structuredContent)).not.toContain('must-not-leak');

      const state = getLocalMcpState(41);
      expect(state).toMatchObject({ status: 'running', toolCallCount: 6 });
      if (state.status === 'running') expect(state.requestCount).toBeGreaterThan(6);
    } finally {
      await client.close();
    }
  });

  it('revokes the endpoint on owner stop and project revoke', async () => {
    const first = mintRootCapability(projectRoot);
    const started = await start(first.rootId, 51);
    if (!started.ok) throw new Error(`server start failed: ${started.reason}`);
    await expect(stopLocalMcpServer(999)).resolves.toEqual({ status: 'stopped' });
    expect(getLocalMcpState(51).status).toBe('running');
    await expect(stopLocalMcpServer(51)).resolves.toEqual({ status: 'stopped', reason: 'user' });
    expect(getLocalMcpState(51).status).toBe('stopped');

    const second = mintRootCapability(projectRoot);
    const restarted = await start(second.rootId, 51);
    if (!restarted.ok) throw new Error(`server start failed: ${restarted.reason}`);
    await expect(disposeLocalMcpServerForRoot(second.rootId)).resolves.toEqual({
      status: 'stopped',
      reason: 'project-revoked',
    });
    await expect(
      fetch(restarted.state.endpoint, {
        headers: { authorization: `Bearer ${restarted.state.accessToken}` },
      })
    ).rejects.toThrow();
  });
});


describe('MCP canonical path and UTF-8 boundaries', () => {
  async function withClient(run: (client: Client) => Promise<void>, selectedRoot = projectRoot) {
    const { rootId } = mintRootCapability(selectedRoot);
    const started = await start(rootId);
    if (!started.ok) throw new Error(started.reason);
    const client = new Client({ name: 'boundary-test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(started.state.endpoint), {
      authProvider: { token: async () => started.state.accessToken },
    }));
    try { await run(client); } finally { await client.close(); }
  }

  it('refuses file and directory aliases to excluded targets but allows ordinary aliases', async () => {
    await mkdir(path.join(projectRoot, '.ssh'));
    await writeFile(path.join(projectRoot, '.ssh', 'config'), 'SYNTHETIC_EXCLUDED_CONTENT');
    await symlink(path.join(projectRoot, '.env'), path.join(projectRoot, 'notes.txt'));
    await symlink(path.join(projectRoot, '.ssh'), path.join(projectRoot, 'docs'), 'junction');
    await symlink(path.join(projectRoot, 'src'), path.join(projectRoot, 'source'), 'junction');
    await withClient(async (client) => {
      for (const [name, args] of [
        ['lingua_read_file', { path: 'notes.txt' }],
        ['lingua_read_file', { path: 'docs/config' }],
        ['lingua_list_files', { path: 'docs' }],
        ['lingua_search_project', { path: 'docs', query: 'SYNTHETIC' }],
      ] as const) {
        const result = await client.callTool({ name, arguments: args });
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result)).not.toContain('must-not-leak');
        expect(JSON.stringify(result)).not.toContain('SYNTHETIC_EXCLUDED_CONTENT');
      }
      const normal = await client.callTool({ name: 'lingua_read_file', arguments: { path: 'source/index.ts' } });
      expect(normal.isError).not.toBe(true);
      expect(normal.structuredContent).toMatchObject({ content: 'export const greeting = "hello from Lingua";\n' });
      const listed = await client.callTool({ name: 'lingua_list_files', arguments: { path: 'source' } });
      expect(listed.structuredContent).toMatchObject({ entries: [{ path: 'source/index.ts', type: 'file' }] });
      const searched = await client.callTool({ name: 'lingua_search_project', arguments: { path: 'source', query: 'greeting' } });
      expect(searched.structuredContent).toMatchObject({ matches: [expect.objectContaining({ path: 'source/index.ts' })] });
    });
  });

  it('resolves an approved symlink root without masking a secret destination', async () => {
    const selectedRoot = path.join(projectRoot, 'project-alias');
    await symlink(projectRoot, selectedRoot, 'junction');
    await symlink(path.join(projectRoot, '.env'), path.join(projectRoot, 'notes.txt'));
    await withClient(async (client) => {
      const normal = await client.callTool({ name: 'lingua_read_file', arguments: { path: 'src/index.ts' } });
      expect(normal.isError).not.toBe(true);
      const secret = await client.callTool({ name: 'lingua_read_file', arguments: { path: 'notes.txt' } });
      expect(secret.isError).toBe(true);
    }, selectedRoot);
  });

  it('enforces canonical policy and revocation at the direct handler boundary', async () => {
    await symlink(path.join(projectRoot, '.env'), path.join(projectRoot, 'notes.txt'));
    const { rootId } = mintRootCapability(projectRoot);
    type Handler = (args: Record<string, unknown>) => Promise<{ isError?: boolean }>;
    const handlers = new Map<string, Handler>();
    const registration = { registerTool: (name: string, _schema: unknown, handler: Handler) => handlers.set(name, handler) };
    registerLocalMcpTools(registration as unknown as McpServer, {
      rootId, projectName: 'fixture', appVersion: 'test', onToolCall: vi.fn(),
    });
    const read = handlers.get('lingua_read_file')!;
    expect((await read({ path: 'notes.txt', offset: 0, maxBytes: 100 })).isError).toBe(true);
    expect((await read({ path: 'src/index.ts', offset: 0, maxBytes: 100 })).isError).not.toBe(true);
    clearRegistryForTests();
    expect((await read({ path: 'src/index.ts', offset: 0, maxBytes: 100 })).isError).toBe(true);
  });

  it('rejects malformed and incomplete UTF-8 at EOF rather than truncating it away', async () => {
    await writeFile(path.join(projectRoot, 'incomplete.txt'), Buffer.from([0x41, 0xc3]));
    await writeFile(path.join(projectRoot, 'invalid.txt'), Buffer.from([0xc3, 0x28]));
    await withClient(async (client) => {
      for (const name of ['incomplete.txt', 'invalid.txt']) {
        const result = await client.callTool({ name: 'lingua_read_file', arguments: { path: name, maxBytes: 4 } });
        expect(result.isError).toBe(true);
      }
    });
  });

  it('returns a lossless sequence of byte-bounded UTF-8 chunks including a BOM', async () => {
    const content = '\uFEFFAé🙂中Z';
    await writeFile(path.join(projectRoot, 'unicode.txt'), content);
    await withClient(async (client) => {
      let offset: number | null = 0;
      let collected = '';
      for (let i = 0; offset !== null && i < 20; i++) {
        const result = await client.callTool({ name: 'lingua_read_file', arguments: { path: 'unicode.txt', offset, maxBytes: 5 } });
        expect(result.isError).not.toBe(true);
        const chunk = result.structuredContent as { content: string; bytesRead: number; nextOffset: number | null };
        expect(chunk.bytesRead).toBe(Buffer.byteLength(chunk.content));
        expect(chunk.bytesRead).toBeGreaterThan(0);
        expect(chunk.bytesRead).toBeLessThanOrEqual(5);
        if (chunk.nextOffset !== null) expect(chunk.nextOffset).toBe(offset + chunk.bytesRead);
        collected += chunk.content;
        offset = chunk.nextOffset;
      }
      expect(offset).toBeNull();
      expect(collected).toBe(content);
    });
  });

  it('rejects a mid-codepoint offset and an insufficient budget without a looping continuation', async () => {
    await writeFile(path.join(projectRoot, 'unicode.txt'), '🙂');
    await withClient(async (client) => {
      for (const args of [{ offset: 1, maxBytes: 4 }, { offset: 0, maxBytes: 1 }]) {
        const result = await client.callTool({ name: 'lingua_read_file', arguments: { path: 'unicode.txt', ...args } });
        expect(result.isError).toBe(true);
      }
      const end = await client.callTool({ name: 'lingua_read_file', arguments: { path: 'unicode.txt', offset: 4, maxBytes: 4 } });
      expect(end.structuredContent).toMatchObject({ content: '', bytesRead: 0, nextOffset: null, truncated: false });
    });
  });
});
