import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
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
import { isLocalMcpSensitivePath } from '../../src/main/localMcpTools';
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
