import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http';
import path from 'node:path';
import type { Socket } from 'node:net';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from '@modelcontextprotocol/node';
import {
  LOCAL_MCP_TOOL_NAMES,
  type LocalMcpRunningState,
  type LocalMcpStartResult,
  type LocalMcpState,
  type LocalMcpStopReason,
} from '../shared/localMcp';
import type { RootId } from '../shared/fs/brandedIds';
import { lookupRoot, resolveCapabilityPath } from './ipc/projectCapabilities';
import { registerLocalMcpTools } from './localMcpTools';

const LOOPBACK_HOST = '127.0.0.1';
const MCP_PATH = '/mcp';
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_CONCURRENT_REQUESTS = 16;
const REQUEST_TIMEOUT_MS = 35_000;

interface StartLocalMcpOptions {
  readonly rootId: RootId;
  readonly ownerId: number;
  readonly appVersion: string;
  readonly acknowledged: boolean;
  readonly isOwnerAlive: () => boolean;
  readonly onStateChanged: (state: LocalMcpState) => void;
}

interface ActiveLocalMcpServer {
  readonly rootId: string;
  readonly ownerId: number;
  readonly projectName: string;
  readonly endpoint: string;
  readonly accessToken: string;
  readonly startedAt: string;
  readonly httpServer: HttpServer;
  readonly sockets: Set<Socket>;
  readonly closeHandler: () => Promise<void>;
  readonly onStateChanged: (state: LocalMcpState) => void;
  requestCount: number;
  toolCallCount: number;
  activeRequests: number;
}

let activeServer: ActiveLocalMcpServer | null = null;
let lifecycleQueue: Promise<unknown> = Promise.resolve();

function enqueueLifecycle<T>(operation: () => Promise<T>): Promise<T> {
  const next = lifecycleQueue.then(operation, operation);
  lifecycleQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

function runningState(server: ActiveLocalMcpServer): LocalMcpRunningState {
  return {
    status: 'running',
    endpoint: server.endpoint,
    accessToken: server.accessToken,
    projectName: server.projectName,
    startedAt: server.startedAt,
    requestCount: server.requestCount,
    toolCallCount: server.toolCallCount,
    tools: LOCAL_MCP_TOOL_NAMES,
  };
}

function emitRunningState(server: ActiveLocalMcpServer): void {
  if (activeServer !== server) return;
  try {
    server.onStateChanged(runningState(server));
  } catch {
    // Renderer lifecycle is authoritative; a failed notification must not
    // keep the local server alive or leak the token through logs.
  }
}

function unauthorized(response: import('node:http').ServerResponse): void {
  response.writeHead(401, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'www-authenticate': 'Bearer realm="Lingua local MCP"',
  });
  response.end(JSON.stringify({ error: 'unauthorized' }));
}

function isAuthorized(request: IncomingMessage, expectedToken: string): boolean {
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const suppliedToken = header.slice('Bearer '.length);
  const expectedDigest = createHash('sha256').update(expectedToken).digest();
  const suppliedDigest = createHash('sha256').update(suppliedToken).digest();
  return timingSafeEqual(expectedDigest, suppliedDigest);
}

function answerJsonError(
  response: import('node:http').ServerResponse,
  status: number,
  message: string
): void {
  response.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  });
  response.end(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32600, message },
      id: null,
    })
  );
}

async function readBoundedJsonBody(request: IncomingMessage): Promise<unknown> {
  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new Error('body-too-large');
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > MAX_BODY_BYTES) throw new Error('body-too-large');
    chunks.push(bytes);
  }
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks, total).toString('utf8')) as unknown;
  } catch {
    throw new Error('invalid-json');
  }
}

async function closeHttpServer(server: ActiveLocalMcpServer): Promise<void> {
  await server.closeHandler().catch(() => undefined);
  await new Promise<void>(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    server.httpServer.close(finish);
    const timer = setTimeout(() => {
      for (const socket of server.sockets) socket.destroy();
      finish();
    }, 1_000);
    timer.unref();
  });
}

async function stopActiveServer(reason: LocalMcpStopReason): Promise<LocalMcpState> {
  const server = activeServer;
  if (!server) return { status: 'stopped', reason };
  activeServer = null;
  await closeHttpServer(server);
  const state: LocalMcpState = { status: 'stopped', reason };
  try {
    server.onStateChanged(state);
  } catch {
    // Expected when the owning renderer is already gone.
  }
  return state;
}

async function listen(server: HttpServer): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen({ host: LOOPBACK_HOST, port: 0, exclusive: true }, () => {
      server.off('error', onError);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('listen-failed'));
        return;
      }
      resolve(address.port);
    });
  });
}

async function startActiveServer(options: StartLocalMcpOptions): Promise<LocalMcpStartResult> {
  if (!options.acknowledged) {
    return { ok: false, reason: 'invalid-acknowledgement' };
  }
  if (!options.isOwnerAlive()) return { ok: false, reason: 'owner-destroyed' };

  const root = lookupRoot(options.rootId);
  if (!root) return { ok: false, reason: 'invalid-project' };
  const rootResolution = await resolveCapabilityPath(options.rootId, '', 'read');
  if (!rootResolution.ok) return { ok: false, reason: 'invalid-project' };

  if (activeServer) await stopActiveServer('replaced');
  if (!options.isOwnerAlive()) return { ok: false, reason: 'owner-destroyed' };

  const projectName = path.basename(root.rootPath) || 'project';
  const accessToken = randomBytes(32).toString('base64url');
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();
  let candidate: ActiveLocalMcpServer;

  const mcpHandler = createMcpHandler(() => {
    const server = new McpServer(
      { name: 'lingua-local', version: options.appVersion },
      {
        instructions:
          'Read-only access to the single project explicitly approved in Lingua. Never assume write, execution, network, binary, or secret-file access.',
      }
    );
    registerLocalMcpTools(server, {
      rootId: options.rootId,
      projectName,
      appVersion: options.appVersion,
      onToolCall: () => {
        if (activeServer !== candidate) return;
        candidate.toolCallCount += 1;
        emitRunningState(candidate);
      },
    });
    return server;
  });
  const nodeHandler = toNodeHandler(mcpHandler);

  const httpServer = createServer((request, response) => {
    void (async () => {
      const requestUrl = new URL(request.url ?? '/', `http://${LOOPBACK_HOST}`);
      if (requestUrl.pathname !== MCP_PATH) {
        answerJsonError(response, 404, 'Not found');
        return;
      }
      if (!validateHost(request, response) || !validateOrigin(request, response)) return;
      if (!isAuthorized(request, accessToken)) {
        unauthorized(response);
        return;
      }
      if (candidate.activeRequests >= MAX_CONCURRENT_REQUESTS) {
        answerJsonError(response, 429, 'Too many concurrent requests');
        return;
      }

      candidate.activeRequests += 1;
      candidate.requestCount += 1;
      emitRunningState(candidate);
      try {
        const parsedBody =
          request.method === 'POST' ? await readBoundedJsonBody(request) : undefined;
        await nodeHandler(request, response, parsedBody);
      } catch (error) {
        if (response.headersSent) {
          response.end();
          return;
        }
        const reason = error instanceof Error ? error.message : '';
        answerJsonError(
          response,
          reason === 'body-too-large' ? 413 : 400,
          reason === 'body-too-large' ? 'Request body too large' : 'Invalid JSON request'
        );
      } finally {
        candidate.activeRequests = Math.max(0, candidate.activeRequests - 1);
      }
    })();
  });
  httpServer.maxConnections = 32;
  httpServer.requestTimeout = REQUEST_TIMEOUT_MS;
  httpServer.headersTimeout = 10_000;
  httpServer.keepAliveTimeout = 2_000;

  const sockets = new Set<Socket>();
  httpServer.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  try {
    const port = await listen(httpServer);
    candidate = {
      rootId: options.rootId,
      ownerId: options.ownerId,
      projectName,
      endpoint: `http://${LOOPBACK_HOST}:${port}${MCP_PATH}`,
      accessToken,
      startedAt: new Date().toISOString(),
      httpServer,
      sockets,
      closeHandler: () => mcpHandler.close(),
      onStateChanged: options.onStateChanged,
      requestCount: 0,
      toolCallCount: 0,
      activeRequests: 0,
    };
  } catch {
    await mcpHandler.close().catch(() => undefined);
    for (const socket of sockets) socket.destroy();
    return { ok: false, reason: 'listen-failed' };
  }

  if (!options.isOwnerAlive()) {
    await closeHttpServer(candidate);
    return { ok: false, reason: 'owner-destroyed' };
  }

  activeServer = candidate;
  const state = runningState(candidate);
  emitRunningState(candidate);
  return { ok: true, state };
}

export function startLocalMcpServer(options: StartLocalMcpOptions): Promise<LocalMcpStartResult> {
  return enqueueLifecycle(() => startActiveServer(options));
}

export function getLocalMcpState(ownerId: number): LocalMcpState {
  if (!activeServer || activeServer.ownerId !== ownerId) return { status: 'stopped' };
  return runningState(activeServer);
}

export function stopLocalMcpServer(ownerId: number): Promise<LocalMcpState> {
  return enqueueLifecycle(async () => {
    if (!activeServer || activeServer.ownerId !== ownerId) return { status: 'stopped' };
    return stopActiveServer('user');
  });
}

export function disposeLocalMcpServerForOwner(ownerId: number): Promise<LocalMcpState> {
  return enqueueLifecycle(async () => {
    if (!activeServer || activeServer.ownerId !== ownerId) return { status: 'stopped' };
    return stopActiveServer('owner-destroyed');
  });
}

export function disposeLocalMcpServerForRoot(rootId: string): Promise<LocalMcpState> {
  return enqueueLifecycle(async () => {
    if (!activeServer || activeServer.rootId !== rootId) return { status: 'stopped' };
    return stopActiveServer('project-revoked');
  });
}

export function disposeLocalMcpServer(): Promise<LocalMcpState> {
  return enqueueLifecycle(() => stopActiveServer('app-quit'));
}

/** Test-only reset; callers must await it before clearing capability state. */
export async function _resetLocalMcpForTests(): Promise<void> {
  await enqueueLifecycle(async () => {
    if (activeServer) await stopActiveServer('user');
  });
}
