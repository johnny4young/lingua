import { rmSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import type { WebContents } from 'electron';
import {
  MAX_RUST_DEBUG_ARGS,
  MAX_RUST_DEBUG_ARG_LENGTH,
  MAX_RUST_DEBUG_BREAKPOINTS,
  MAX_RUST_DEBUG_SOURCE_BYTES,
  MAX_RUST_DEBUG_WATCHES,
  MAX_RUST_DEBUG_WATCH_LENGTH,
  type RustDebuggerFailureReason,
  type RustDebuggerPauseFrame,
  type RustDebuggerResponse,
  type RustDebuggerStartRequest,
  type RustDebuggerStepCommand,
} from '../../shared/rustDebugger';
import {
  RustDebugSession,
  resolveLldbDapBinary,
  resolveRustCompiler,
  type RustDebuggerTransition,
} from '../rustDebugger';
import {
  RUST_TOOLCHAIN_KEYS,
  RUST_DEBUGGER_TOOLCHAIN_KEYS,
  buildNativeRunnerEnv,
  combinedAllowlist,
} from '../runners/nativeEnv';
import { resolveCapabilityPath } from './projectCapabilities';
import { typedHandle } from './typedHandle';
import { MAX_COMPILE_OUTPUT_BYTES, truncateBytes } from '../../shared/runnerLimits';

const execFileAsync = promisify(execFile);
const RUST_COMPILE_TIMEOUT_MS = 60_000;

const MAX_USER_ENV_VARS = 100;
const MAX_USER_ENV_KEY_LENGTH = 128;
const MAX_USER_ENV_VALUE_LENGTH = 32_768;

interface RustDebuggerRecord {
  readonly id: string;
  readonly ownerId: number;
  readonly tabId: string;
  readonly tempDir: string;
  readonly session: RustDebugSession;
  breakpoints: Set<number>;
  watches: string[];
  paused: boolean;
  pauseReason: RustDebuggerPauseFrame['reason'];
  pauseGeneration: number;
  watchGeneration: number;
}

const sessions = new Map<string, RustDebuggerRecord>();
const observedOwners = new WeakSet<WebContents>();

function errorResponse(
  reason: RustDebuggerFailureReason,
  message?: string,
  details?: { output?: string; outputTruncated?: boolean }
): RustDebuggerResponse {
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
    .slice(0, MAX_RUST_DEBUG_BREAKPOINTS);
}

function normalizeWatches(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const watches: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== 'string') continue;
    const expression = candidate.trim().slice(0, MAX_RUST_DEBUG_WATCH_LENGTH);
    if (!expression || /[\r\n]/u.test(expression) || seen.has(expression)) continue;
    seen.add(expression);
    watches.push(expression);
    if (watches.length >= MAX_RUST_DEBUG_WATCHES) break;
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
    .slice(0, MAX_RUST_DEBUG_ARGS)
    .map(candidate => candidate.slice(0, MAX_RUST_DEBUG_ARG_LENGTH));
}

function safeRustFileName(value: unknown): string {
  const base = typeof value === 'string' ? path.basename(value) : 'main.rs';
  const safe = base.replace(/[^a-zA-Z0-9_.-]/gu, '_').slice(0, 120);
  if (!safe || safe === '.' || safe === '..') return 'main.rs';
  return safe.toLowerCase().endsWith('.rs') ? safe : `${safe}.rs`;
}

async function approvedWorkingDirectory(
  request: RustDebuggerStartRequest
): Promise<{ ok: true; cwd: string } | { ok: false }> {
  if (request.rootId === undefined && request.relativePath === undefined) {
    return { ok: true, cwd: '' };
  }
  if (request.rootId === undefined || request.relativePath === undefined) return { ok: false };
  const resolved = await resolveCapabilityPath(request.rootId, request.relativePath, 'read');
  if (!resolved.ok) return { ok: false };
  return { ok: true, cwd: path.dirname(resolved.absolutePath) };
}

async function removeRecord(record: RustDebuggerRecord): Promise<void> {
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

export function disposeRustDebuggerSessions(): void {
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

function ownedRecord(ownerId: number, sessionId: unknown): RustDebuggerRecord | null {
  if (typeof sessionId !== 'string') return null;
  const record = sessions.get(sessionId);
  return record?.ownerId === ownerId ? record : null;
}

function pauseReason(
  transition: Extract<RustDebuggerTransition, { kind: 'stopped' }>,
  command?: RustDebuggerStepCommand
): RustDebuggerPauseFrame['reason'] {
  if (/exception|panic|fatal/u.test(transition.reason)) return 'exception';
  return command && command !== 'continue' ? 'step' : 'user-breakpoint';
}

async function responseForTransition(
  record: RustDebuggerRecord,
  transition: RustDebuggerTransition,
  command?: RustDebuggerStepCommand
): Promise<RustDebuggerResponse> {
  const output = record.session.drainOutput();
  if (transition.kind === 'finished') {
    const response: RustDebuggerResponse = {
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

export function classifyRustDebuggerStartFailure(
  error: unknown,
  platform: NodeJS.Platform = process.platform
): RustDebuggerFailureReason {
  const message = error instanceof Error ? error.message : String(error);
  if (
    platform === 'darwin' &&
    /initialized event timed out|launch timed out|transition timed out|developer mode|developer tools|operation not permitted|could not attach|not allowed to attach|attach failed/iu.test(
      message
    )
  ) {
    return 'permission-required';
  }
  return 'command-failed';
}

async function startSession(ownerId: number, rawRequest: unknown): Promise<RustDebuggerResponse> {
  if (!rawRequest || typeof rawRequest !== 'object' || Array.isArray(rawRequest)) {
    return errorResponse('invalid-request');
  }
  const request = rawRequest as RustDebuggerStartRequest;
  if (
    typeof request.tabId !== 'string' ||
    request.tabId.length === 0 ||
    typeof request.source !== 'string'
  ) {
    return errorResponse('invalid-request');
  }
  if (Buffer.byteLength(request.source, 'utf8') > MAX_RUST_DEBUG_SOURCE_BYTES) {
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
    tempDir = await realpath(await mkdtemp(path.join(tmpdir(), 'lingua-rust-debug-')));
    scriptPath = path.join(tempDir, safeRustFileName(request.fileName));
    await writeFile(scriptPath, request.source, { encoding: 'utf8', mode: 0o600 });
  } catch (error) {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    return errorResponse(
      'command-failed',
      error instanceof Error ? error.message : 'Could not prepare Rust debugger source'
    );
  }

  const userEnv = normalizeStringMap(request.userEnv);
  const env = buildNativeRunnerEnv(
    combinedAllowlist([...RUST_TOOLCHAIN_KEYS, ...RUST_DEBUGGER_TOOLCHAIN_KEYS]),
    userEnv
  );
  const compiler = await resolveRustCompiler(env);
  if (!compiler) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    return errorResponse('rustc-missing');
  }
  const lldbDap = await resolveLldbDapBinary(env);
  if (!lldbDap) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    return errorResponse('lldb-dap-missing');
  }

  const binaryPath = path.join(tempDir, process.platform === 'win32' ? 'lingua-debug.exe' : 'lingua-debug');
  try {
    await execFileAsync(
      compiler.command,
      [
        '--edition',
        '2021',
        '--crate-name',
        'lingua_debug',
        '-g',
        scriptPath,
        '-o',
        binaryPath,
      ],
      {
        cwd: tempDir,
        env,
        timeout: RUST_COMPILE_TIMEOUT_MS,
        maxBuffer: MAX_COMPILE_OUTPUT_BYTES,
      }
    );
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr;
    const stdout = (error as { stdout?: string }).stdout;
    const raw = [stderr, stdout, error instanceof Error ? error.message : String(error)]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .join('\n');
    const outputTruncated = Buffer.byteLength(raw, 'utf8') > MAX_COMPILE_OUTPUT_BYTES;
    const output = truncateBytes(raw, MAX_COMPILE_OUTPUT_BYTES, '\n[Compile output truncated]');
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    return errorResponse('compile-failed', undefined, { output, outputTruncated });
  }

  const id = randomUUID();
  const session = new RustDebugSession({
    lldbDapPath: lldbDap.command,
    scriptPath,
    binaryPath,
    cwd: approved.cwd || tempDir,
    env,
    programArgs: normalizeProgramArgs(request.programArgs),
  });
  const record: RustDebuggerRecord = {
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
      classifyRustDebuggerStartFailure(error),
      error instanceof Error ? error.message : String(error),
      output
    );
  }
}

function isStepCommand(value: unknown): value is RustDebuggerStepCommand {
  return (
    value === 'continue' || value === 'step-over' || value === 'step-into' || value === 'step-out'
  );
}

async function runCommand(
  record: RustDebuggerRecord,
  command: RustDebuggerStepCommand
): Promise<RustDebuggerResponse> {
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
  record: RustDebuggerRecord,
  value: unknown
): Promise<RustDebuggerResponse> {
  const requested = normalizeBreakpoints(value);
  try {
    const verified = await record.session.setBreakpoints(requested);
    if (requested.length > 0 && verified.length === 0) {
      throw new Error('LLDB did not verify any requested breakpoint');
    }
    record.breakpoints = new Set(verified);
    return { kind: 'synced', sessionId: record.id };
  } catch (error) {
    await removeRecord(record);
    return errorResponse('command-failed', error instanceof Error ? error.message : String(error));
  }
}

async function syncWatches(
  record: RustDebuggerRecord,
  value: unknown
): Promise<RustDebuggerResponse> {
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

export function registerRustDebuggerHandlers(): void {
  typedHandle('debugger:rust:start', async (event, request: unknown) => {
    observeOwner(event.sender);
    return startSession(event.sender.id, request);
  });
  typedHandle('debugger:rust:command', async (event, sessionId: unknown, command: unknown) => {
    const record = ownedRecord(event.sender.id, sessionId);
    if (!record) return errorResponse('session-not-found');
    if (!isStepCommand(command)) return errorResponse('invalid-request');
    if (!record.paused) return errorResponse('invalid-request');
    return runCommand(record, command);
  });
  typedHandle('debugger:rust:sync-breakpoints', async (event, sessionId: unknown, value: unknown) => {
    const record = ownedRecord(event.sender.id, sessionId);
    if (!record) return errorResponse('session-not-found');
    return syncBreakpoints(record, value);
  });
  typedHandle('debugger:rust:sync-watches', async (event, sessionId: unknown, value: unknown) => {
    const record = ownedRecord(event.sender.id, sessionId);
    if (!record) return errorResponse('session-not-found');
    return syncWatches(record, value);
  });
  typedHandle('debugger:rust:stop', async (event, sessionId: unknown) => {
    const record = ownedRecord(event.sender.id, sessionId);
    if (!record) return errorResponse('session-not-found');
    await removeRecord(record);
    return { kind: 'stopped', sessionId: record.id };
  });
}
