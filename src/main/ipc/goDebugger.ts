import { rmSync } from 'node:fs';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';
import {
  MAX_GO_DEBUG_ARGS,
  MAX_GO_DEBUG_ARG_LENGTH,
  MAX_GO_DEBUG_BREAKPOINTS,
  MAX_GO_DEBUG_SOURCE_BYTES,
  MAX_GO_DEBUG_WATCHES,
  MAX_GO_DEBUG_WATCH_LENGTH,
  type GoDebuggerFailureReason,
  type GoDebuggerPauseFrame,
  type GoDebuggerResponse,
  type GoDebuggerStartRequest,
  type GoDebuggerStepCommand,
} from '../../shared/goDebugger';
import {
  GoDebugSession,
  resolveDelveBinary,
  type GoDebuggerTransition,
} from '../goDebugger';
import {
  GO_TOOLCHAIN_KEYS,
  buildNativeRunnerEnv,
  combinedAllowlist,
} from '../runners/nativeEnv';
import { resolveCapabilityPath } from './projectCapabilities';
import { typedHandle } from './typedHandle';

const MAX_USER_ENV_VARS = 100;
const MAX_USER_ENV_KEY_LENGTH = 128;
const MAX_USER_ENV_VALUE_LENGTH = 32_768;

interface GoDebuggerRecord {
  readonly id: string;
  readonly ownerId: number;
  readonly tabId: string;
  readonly tempDir: string;
  readonly session: GoDebugSession;
  breakpoints: Set<number>;
  watches: string[];
  paused: boolean;
  pauseReason: GoDebuggerPauseFrame['reason'];
  pauseGeneration: number;
  watchGeneration: number;
}

const sessions = new Map<string, GoDebuggerRecord>();
const observedOwners = new WeakSet<WebContents>();

function errorResponse(
  reason: GoDebuggerFailureReason,
  message?: string,
  details?: { output?: string; outputTruncated?: boolean }
): GoDebuggerResponse {
  return {
    kind: 'error',
    reason,
    ...(message ? { message: message.slice(0, 1_024) } : {}),
    ...(details?.output ? { output: details.output } : {}),
    ...(details?.outputTruncated ? { outputTruncated: true } : {}),
  };
}

function normalizeBreakpoints(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (line): line is number => typeof line === 'number' && Number.isInteger(line) && line > 0
      )
    ),
  ]
    .sort((left, right) => left - right)
    .slice(0, MAX_GO_DEBUG_BREAKPOINTS);
}

function normalizeWatches(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const watches: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== 'string') continue;
    const expression = candidate.trim().slice(0, MAX_GO_DEBUG_WATCH_LENGTH);
    if (!expression || /[\r\n]/u.test(expression) || seen.has(expression)) continue;
    seen.add(expression);
    watches.push(expression);
    if (watches.length >= MAX_GO_DEBUG_WATCHES) break;
  }
  return watches;
}

function normalizeStringMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  let accepted = 0;
  for (const [key, candidate] of Object.entries(value as Record<string, unknown>)) {
    if (accepted >= MAX_USER_ENV_VARS) break;
    if (
      typeof candidate !== 'string' ||
      key.length === 0 ||
      key.length > MAX_USER_ENV_KEY_LENGTH ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)
    ) {
      continue;
    }
    result[key] = candidate.slice(0, MAX_USER_ENV_VALUE_LENGTH);
    accepted += 1;
  }
  return accepted > 0 ? result : undefined;
}

function normalizeProgramArgs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((candidate): candidate is string => typeof candidate === 'string')
    .slice(0, MAX_GO_DEBUG_ARGS)
    .map(candidate => candidate.slice(0, MAX_GO_DEBUG_ARG_LENGTH));
}

function safeGoFileName(value: unknown): string {
  const base = typeof value === 'string' ? path.basename(value) : 'main.go';
  const safe = base.replace(/[^a-zA-Z0-9_.-]/gu, '_').slice(0, 120);
  if (!safe || safe === '.' || safe === '..') return 'main.go';
  return safe.toLowerCase().endsWith('.go') ? safe : `${safe}.go`;
}

async function approvedWorkingDirectory(
  request: GoDebuggerStartRequest
): Promise<{ ok: true; cwd: string } | { ok: false }> {
  if (request.rootId === undefined && request.relativePath === undefined) {
    return { ok: true, cwd: '' };
  }
  if (request.rootId === undefined || request.relativePath === undefined) return { ok: false };
  const resolved = await resolveCapabilityPath(request.rootId, request.relativePath, 'read');
  if (!resolved.ok) return { ok: false };
  return { ok: true, cwd: path.dirname(resolved.absolutePath) };
}

async function removeRecord(record: GoDebuggerRecord): Promise<void> {
  sessions.delete(record.id);
  record.session.terminate();
  await rm(record.tempDir, { recursive: true, force: true }).catch(() => undefined);
}

function disposeForOwner(ownerId: number): void {
  for (const record of [...sessions.values()]) {
    if (record.ownerId === ownerId) void removeRecord(record);
  }
}

function observeOwner(sender: WebContents): void {
  if (observedOwners.has(sender)) return;
  observedOwners.add(sender);
  sender.once('destroyed', () => disposeForOwner(sender.id));
}

export function disposeGoDebuggerSessions(): void {
  for (const record of [...sessions.values()]) {
    sessions.delete(record.id);
    record.session.terminate();
    try {
      rmSync(record.tempDir, { recursive: true, force: true });
    } catch {
      // Best effort during process teardown; owner paths await cleanup.
    }
  }
}

function ownedRecord(ownerId: number, sessionId: unknown): GoDebuggerRecord | null {
  if (typeof sessionId !== 'string') return null;
  const record = sessions.get(sessionId);
  return record?.ownerId === ownerId ? record : null;
}

function pauseReason(
  transition: Extract<GoDebuggerTransition, { kind: 'stopped' }>,
  command?: GoDebuggerStepCommand
): GoDebuggerPauseFrame['reason'] {
  if (/exception|panic|fatal/u.test(transition.reason)) return 'exception';
  return command && command !== 'continue' ? 'step' : 'user-breakpoint';
}

async function responseForTransition(
  record: GoDebuggerRecord,
  transition: GoDebuggerTransition,
  command?: GoDebuggerStepCommand
): Promise<GoDebuggerResponse> {
  const output = record.session.drainOutput();
  if (transition.kind === 'finished') {
    const response: GoDebuggerResponse = {
      kind: 'finished',
      sessionId: record.id,
      output: output.output,
      ...(output.outputTruncated ? { outputTruncated: true } : {}),
    };
    await removeRecord(record);
    return response;
  }
  record.paused = true;
  record.pauseReason = pauseReason(transition, command);
  record.pauseGeneration += 1;
  const frame = await record.session.inspect(record.tabId, record.watches, record.pauseReason);
  return {
    kind: 'paused',
    sessionId: record.id,
    frame,
    output: output.output,
    ...(output.outputTruncated ? { outputTruncated: true } : {}),
  };
}

export function classifyGoDebuggerStartFailure(
  error: unknown,
  platform: NodeJS.Platform = process.platform
): GoDebuggerFailureReason {
  const message = error instanceof Error ? error.message : String(error);
  if (
    platform === 'darwin' &&
    /initialized event timed out|launch timed out|transition timed out|developer mode|developer tools|operation not permitted|could not attach/iu.test(
      message
    )
  ) {
    return 'permission-required';
  }
  return 'command-failed';
}

async function startSession(ownerId: number, rawRequest: unknown): Promise<GoDebuggerResponse> {
  if (!rawRequest || typeof rawRequest !== 'object' || Array.isArray(rawRequest)) {
    return errorResponse('invalid-request');
  }
  const request = rawRequest as GoDebuggerStartRequest;
  if (
    typeof request.tabId !== 'string' ||
    request.tabId.length === 0 ||
    typeof request.source !== 'string'
  ) {
    return errorResponse('invalid-request');
  }
  if (Buffer.byteLength(request.source, 'utf8') > MAX_GO_DEBUG_SOURCE_BYTES) {
    return errorResponse('source-too-large');
  }
  const breakpoints = normalizeBreakpoints(request.breakpoints);
  if (breakpoints.length === 0) return errorResponse('no-breakpoints');
  const approved = await approvedWorkingDirectory(request);
  if (!approved.ok) return errorResponse('unapproved-path');

  disposeForOwner(ownerId);
  let tempDir: string | null = null;
  let scriptPath: string;
  try {
    tempDir = await realpath(await mkdtemp(path.join(tmpdir(), 'lingua-go-debug-')));
    scriptPath = path.join(tempDir, safeGoFileName(request.fileName));
    await writeFile(scriptPath, request.source, { encoding: 'utf8', mode: 0o600 });
    await writeFile(path.join(tempDir, 'go.mod'), 'module lingua_debug\n\ngo 1.21\n', {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch (error) {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    return errorResponse(
      'command-failed',
      error instanceof Error ? error.message : 'Could not prepare Go debugger source'
    );
  }

  const userEnv = normalizeStringMap(request.userEnv);
  const env = buildNativeRunnerEnv(combinedAllowlist(GO_TOOLCHAIN_KEYS), userEnv);
  const delve = await resolveDelveBinary(env);
  if (!delve) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    return errorResponse('binary-missing');
  }

  const id = randomUUID();
  const session = new GoDebugSession({
    dlvPath: delve.command,
    scriptPath,
    programDir: tempDir,
    cwd: approved.cwd || tempDir,
    env,
    programArgs: normalizeProgramArgs(request.programArgs),
  });
  const record: GoDebuggerRecord = {
    id,
    ownerId,
    tabId: request.tabId,
    tempDir,
    session,
    breakpoints: new Set(breakpoints),
    watches: normalizeWatches(request.watches),
    paused: false,
    pauseReason: 'user-breakpoint',
    pauseGeneration: 0,
    watchGeneration: 0,
  };
  sessions.set(id, record);
  try {
    const transition = await session.start(breakpoints);
    return responseForTransition(record, transition);
  } catch (error) {
    const output = session.drainOutput();
    await removeRecord(record);
    return errorResponse(
      classifyGoDebuggerStartFailure(error),
      error instanceof Error ? error.message : String(error),
      output
    );
  }
}

function isStepCommand(value: unknown): value is GoDebuggerStepCommand {
  return (
    value === 'continue' || value === 'step-over' || value === 'step-into' || value === 'step-out'
  );
}

async function runCommand(
  record: GoDebuggerRecord,
  command: GoDebuggerStepCommand
): Promise<GoDebuggerResponse> {
  try {
    record.paused = false;
    record.pauseGeneration += 1;
    return responseForTransition(record, await record.session.command(command), command);
  } catch (error) {
    const output = record.session.drainOutput();
    await removeRecord(record);
    return errorResponse('command-failed', error instanceof Error ? error.message : String(error), output);
  }
}

async function syncBreakpoints(
  record: GoDebuggerRecord,
  value: unknown
): Promise<GoDebuggerResponse> {
  const requested = normalizeBreakpoints(value);
  try {
    const verified = await record.session.setBreakpoints(requested);
    if (requested.length > 0 && verified.length === 0) {
      throw new Error('Delve did not verify any requested breakpoint');
    }
    record.breakpoints = new Set(verified);
    return { kind: 'synced', sessionId: record.id };
  } catch (error) {
    await removeRecord(record);
    return errorResponse('command-failed', error instanceof Error ? error.message : String(error));
  }
}

async function syncWatches(
  record: GoDebuggerRecord,
  value: unknown
): Promise<GoDebuggerResponse> {
  record.watches = normalizeWatches(value);
  const watchGeneration = ++record.watchGeneration;
  if (!record.paused) return { kind: 'synced', sessionId: record.id };
  const pauseGeneration = record.pauseGeneration;
  try {
    const frame = await record.session.inspect(record.tabId, record.watches, record.pauseReason);
    if (
      !record.paused ||
      pauseGeneration !== record.pauseGeneration ||
      watchGeneration !== record.watchGeneration
    ) {
      return { kind: 'synced', sessionId: record.id };
    }
    return {
      kind: 'paused',
      sessionId: record.id,
      frame,
      output: '',
    };
  } catch (error) {
    if (
      !record.paused ||
      pauseGeneration !== record.pauseGeneration ||
      watchGeneration !== record.watchGeneration
    ) {
      return { kind: 'synced', sessionId: record.id };
    }
    await removeRecord(record);
    return errorResponse('command-failed', error instanceof Error ? error.message : String(error));
  }
}

export function registerGoDebuggerHandlers(): void {
  typedHandle('debugger:go:start', async (event, request: unknown) => {
    observeOwner(event.sender);
    return startSession(event.sender.id, request);
  });
  typedHandle('debugger:go:command', async (event, sessionId: unknown, command: unknown) => {
    const record = ownedRecord(event.sender.id, sessionId);
    if (!record) return errorResponse('session-not-found');
    if (!isStepCommand(command)) return errorResponse('invalid-request');
    if (!record.paused) return errorResponse('invalid-request');
    return runCommand(record, command);
  });
  typedHandle('debugger:go:sync-breakpoints', async (event, sessionId: unknown, value: unknown) => {
    const record = ownedRecord(event.sender.id, sessionId);
    if (!record) return errorResponse('session-not-found');
    return syncBreakpoints(record, value);
  });
  typedHandle('debugger:go:sync-watches', async (event, sessionId: unknown, value: unknown) => {
    const record = ownedRecord(event.sender.id, sessionId);
    if (!record) return errorResponse('session-not-found');
    return syncWatches(record, value);
  });
  typedHandle('debugger:go:stop', async (event, sessionId: unknown) => {
    const record = ownedRecord(event.sender.id, sessionId);
    if (!record) return errorResponse('session-not-found');
    await removeRecord(record);
    return { kind: 'stopped', sessionId: record.id };
  });
}
