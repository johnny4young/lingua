import { execFile } from 'node:child_process';
import { rmSync } from 'node:fs';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';
import {
  MAX_PYTHON_DEBUG_ARGS,
  MAX_PYTHON_DEBUG_ARG_LENGTH,
  MAX_PYTHON_DEBUG_BREAKPOINTS,
  MAX_PYTHON_DEBUG_SOURCE_BYTES,
  MAX_PYTHON_DEBUG_WATCHES,
  MAX_PYTHON_DEBUG_WATCH_LENGTH,
  type PythonDebuggerFailureReason,
  type PythonDebuggerPauseFrame,
  type PythonDebuggerResponse,
  type PythonDebuggerStartRequest,
  type PythonDebuggerStepCommand,
} from '../../shared/pythonDebugger';
import {
  PythonDebugSession,
  parsePdbStack,
  type PdbCommandResult,
  type PdbLocation,
} from '../pythonDebugger';
import { buildNativeRunnerEnv, combinedAllowlist } from '../runners/nativeEnv';
import { resolveCapabilityPath } from './projectCapabilities';
import { typedHandle } from './typedHandle';

const PYTHON_PROBE_TIMEOUT_MS = 5_000;
const MAX_INSPECTED_LOCALS = 100;
const MAX_WATCH_RESULT_LENGTH = 4_096;
const MAX_USER_ENV_VARS = 100;
const MAX_USER_ENV_KEY_LENGTH = 128;
const MAX_USER_ENV_VALUE_LENGTH = 32_768;

interface PythonDebuggerRecord {
  readonly id: string;
  readonly ownerId: number;
  readonly tabId: string;
  readonly tempDir: string;
  readonly scriptPath: string;
  readonly session: PythonDebugSession;
  breakpoints: Set<number>;
  watches: string[];
  location: PdbLocation | null;
  pauseReason: PythonDebuggerPauseFrame['reason'];
}

const sessions = new Map<string, PythonDebuggerRecord>();
const observedOwners = new WeakSet<WebContents>();

function errorResponse(
  reason: PythonDebuggerFailureReason,
  message?: string,
  details?: { output?: string; outputTruncated?: boolean }
): PythonDebuggerResponse {
  return {
    kind: 'error',
    reason,
    ...(message ? { message: message.slice(0, 1_024) } : {}),
    ...(details?.output ? { output: extractProgramOutput(details.output) } : {}),
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
    .slice(0, MAX_PYTHON_DEBUG_BREAKPOINTS);
}

function normalizeWatches(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const watches: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== 'string') continue;
    const expression = candidate.trim().slice(0, MAX_PYTHON_DEBUG_WATCH_LENGTH);
    if (!expression || /[\r\n]/u.test(expression) || seen.has(expression)) continue;
    seen.add(expression);
    watches.push(expression);
    if (watches.length >= MAX_PYTHON_DEBUG_WATCHES) break;
  }
  return watches;
}

function normalizeStringMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  let acceptedCount = 0;
  for (const [key, candidate] of Object.entries(value as Record<string, unknown>)) {
    if (acceptedCount >= MAX_USER_ENV_VARS) break;
    if (
      typeof candidate !== 'string' ||
      key.length === 0 ||
      key.length > MAX_USER_ENV_KEY_LENGTH ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)
    ) {
      continue;
    }
    result[key] = candidate.slice(0, MAX_USER_ENV_VALUE_LENGTH);
    acceptedCount += 1;
  }
  return acceptedCount > 0 ? result : undefined;
}

function normalizeProgramArgs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((candidate): candidate is string => typeof candidate === 'string')
    .slice(0, MAX_PYTHON_DEBUG_ARGS)
    .map(candidate => candidate.slice(0, MAX_PYTHON_DEBUG_ARG_LENGTH));
}

function safeScriptName(value: unknown): string {
  const base = typeof value === 'string' ? path.basename(value) : 'debug.py';
  const safe = base.replace(/[^a-zA-Z0-9_.-]/gu, '_').slice(0, 120);
  if (!safe || safe === '.' || safe === '..') return 'debug.py';
  return safe.toLowerCase().endsWith('.py') ? safe : `${safe}.py`;
}

async function probePython(binary: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  return new Promise(resolve => {
    execFile(binary, ['--version'], { env, timeout: PYTHON_PROBE_TIMEOUT_MS }, error => {
      resolve(error === null);
    });
  });
}

/** Prefer a project venv, then fall back to the platform PATH. */
async function findPythonDebuggerBinary(
  cwd: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform
): Promise<string | null> {
  const projectCandidates =
    platform === 'win32'
      ? [
          path.join(cwd, '.venv', 'Scripts', 'python.exe'),
          path.join(cwd, 'venv', 'Scripts', 'python.exe'),
        ]
      : [path.join(cwd, '.venv', 'bin', 'python'), path.join(cwd, 'venv', 'bin', 'python')];
  const pathCandidates = platform === 'win32' ? ['python'] : ['python3', 'python'];
  for (const candidate of [...projectCandidates, ...pathCandidates]) {
    if (await probePython(candidate, env)) return candidate;
  }
  return null;
}

function parseLocals(output: string): Record<string, string> {
  const lines = output.split(/\r?\n/u).reverse();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      const locals: Record<string, string> = {};
      for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === 'string') locals[name] = value.slice(0, MAX_WATCH_RESULT_LENGTH);
      }
      return locals;
    } catch {
      // Keep scanning: user stdout may contain unrelated brace-delimited lines.
    }
  }
  return {};
}

function isSameScript(left: string, right: string): boolean {
  return path.normalize(left) === path.normalize(right);
}

function extractProgramOutput(output: string): string {
  const lines = output.split(/\r?\n/u);
  const visible: string[] = [];
  let skipSourceLine = false;
  for (const line of lines) {
    if (/^> .+\(\d+\)[^()]*\(\)$/u.test(line)) {
      skipSourceLine = true;
      continue;
    }
    if (skipSourceLine && line.startsWith('-> ')) {
      skipSourceLine = false;
      continue;
    }
    skipSourceLine = false;
    if (/^Breakpoint \d+ at /u.test(line)) continue;
    if (/^Deleted breakpoint \d+/u.test(line)) continue;
    if (line.includes('The program finished and will be restarted')) continue;
    visible.push(line);
  }
  return visible.join('\n').trim();
}

async function inspectPausedFrame(
  record: PythonDebuggerRecord,
  reason: PythonDebuggerPauseFrame['reason']
): Promise<PythonDebuggerPauseFrame> {
  const location = record.location;
  if (!location) throw new Error('Python debugger has no active pause location');

  const localsResult = await record.session.sendCommand(
    `!print(__import__('json').dumps({k: __import__('reprlib').repr(v) for k,v in list(locals().items())[:${MAX_INSPECTED_LOCALS}] if not k.startswith('__')}, ensure_ascii=False))`
  );
  const stackResult = await record.session.sendCommand('where');
  const callStack = parsePdbStack(stackResult.output)
    .filter(frame => isSameScript(frame.file, record.scriptPath))
    .reverse()
    .map(frame => ({ functionName: frame.func, line: frame.line }));

  const watchResults: Record<string, { value?: string; error?: string }> = {};
  for (const expression of record.watches) {
    try {
      const evaluated = await record.session.evaluate(expression);
      const value = evaluated.trim().slice(0, MAX_WATCH_RESULT_LENGTH);
      if (value.startsWith('***')) {
        watchResults[expression] = { error: value.slice(3).trim() || 'Evaluation failed' };
      } else {
        watchResults[expression] = { value };
      }
    } catch (error) {
      watchResults[expression] = {
        error: error instanceof Error ? error.message : 'Evaluation failed',
      };
    }
  }

  return {
    tabId: record.tabId,
    line: location.line,
    reason,
    locals: parseLocals(localsResult.output),
    callStack,
    watchResults,
  };
}

async function removeRecord(record: PythonDebuggerRecord): Promise<void> {
  sessions.delete(record.id);
  record.session.terminate();
  await rm(record.tempDir, { recursive: true, force: true }).catch(() => undefined);
}

function observeOwner(sender: WebContents): void {
  if (observedOwners.has(sender)) return;
  observedOwners.add(sender);
  sender.once('destroyed', () => {
    disposePythonDebuggerSessionsForOwner(sender.id);
  });
}

function disposePythonDebuggerSessionsForOwner(ownerId: number): void {
  for (const record of [...sessions.values()]) {
    if (record.ownerId !== ownerId) continue;
    void removeRecord(record);
  }
}

export function disposePythonDebuggerSessions(): void {
  for (const record of [...sessions.values()]) {
    sessions.delete(record.id);
    record.session.terminate();
    try {
      // before-quit does not await promises; remove synchronously so the
      // private source cannot survive a normal application shutdown.
      rmSync(record.tempDir, { recursive: true, force: true });
    } catch {
      // Best effort during process teardown; other owner paths await cleanup.
    }
  }
}

async function responseForResult(
  record: PythonDebuggerRecord,
  result: PdbCommandResult,
  reason: PythonDebuggerPauseFrame['reason']
): Promise<PythonDebuggerResponse> {
  const output = extractProgramOutput(result.output);
  if (result.finished) {
    if (
      /Uncaught exception|Traceback \(most recent call last\)|SyntaxError:/u.test(result.output)
    ) {
      await removeRecord(record);
      return errorResponse('process-exited', 'Python exited with an exception.', {
        output: result.output,
        outputTruncated: result.outputTruncated,
      });
    }
    const response: PythonDebuggerResponse = {
      kind: 'finished',
      sessionId: record.id,
      output,
      ...(result.outputTruncated ? { outputTruncated: true } : {}),
    };
    await removeRecord(record);
    return response;
  }
  if (!result.location) {
    await removeRecord(record);
    return errorResponse('process-exited', 'Python exited without a debugger pause.');
  }
  record.location = result.location;
  record.pauseReason = reason;
  const frame = await inspectPausedFrame(record, reason);
  return {
    kind: 'paused',
    sessionId: record.id,
    frame,
    output,
    ...(result.outputTruncated ? { outputTruncated: true } : {}),
  };
}

async function approvedWorkingDirectory(
  request: PythonDebuggerStartRequest
): Promise<{ ok: true; cwd: string } | { ok: false }> {
  if (request.rootId === undefined && request.relativePath === undefined) {
    return { ok: true, cwd: '' };
  }
  if (request.rootId === undefined || request.relativePath === undefined) {
    return { ok: false };
  }
  const resolved = await resolveCapabilityPath(request.rootId, request.relativePath, 'read');
  if (!resolved.ok) return { ok: false };
  return { ok: true, cwd: path.dirname(resolved.absolutePath) };
}

async function startSession(ownerId: number, rawRequest: unknown): Promise<PythonDebuggerResponse> {
  if (!rawRequest || typeof rawRequest !== 'object' || Array.isArray(rawRequest)) {
    return errorResponse('invalid-request');
  }
  const request = rawRequest as PythonDebuggerStartRequest;
  if (
    typeof request.tabId !== 'string' ||
    request.tabId.length === 0 ||
    typeof request.source !== 'string'
  ) {
    return errorResponse('invalid-request');
  }
  if (Buffer.byteLength(request.source, 'utf8') > MAX_PYTHON_DEBUG_SOURCE_BYTES) {
    return errorResponse('source-too-large');
  }
  const breakpoints = normalizeBreakpoints(request.breakpoints);
  if (breakpoints.length === 0) return errorResponse('no-breakpoints');
  const approved = await approvedWorkingDirectory(request);
  if (!approved.ok) return errorResponse('unapproved-path');

  disposePythonDebuggerSessionsForOwner(ownerId);
  let tempDir: string | null = null;
  let scriptPath: string;
  try {
    tempDir = await mkdtemp(path.join(tmpdir(), 'lingua-python-debug-'));
    const target = path.join(tempDir, safeScriptName(request.fileName));
    await writeFile(target, request.source, { encoding: 'utf8', mode: 0o600 });
    scriptPath = await realpath(target);
  } catch (error) {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    return errorResponse(
      'command-failed',
      error instanceof Error ? error.message : 'Could not prepare Python debugger source'
    );
  }
  const cwd = approved.cwd || tempDir;
  const userEnv = normalizeStringMap(request.userEnv);
  const env = buildNativeRunnerEnv(combinedAllowlist([]), userEnv, {
    PYTHONUNBUFFERED: '1',
    ...(cwd !== tempDir
      ? {
          PYTHONPATH: userEnv?.PYTHONPATH ? `${cwd}${path.delimiter}${userEnv.PYTHONPATH}` : cwd,
        }
      : {}),
  });
  const pythonPath = await findPythonDebuggerBinary(cwd, env);
  if (!pythonPath) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    return errorResponse('binary-missing');
  }

  const id = randomUUID();
  const session = new PythonDebugSession({
    scriptPath,
    pythonPath,
    cwd,
    env,
    programArgs: normalizeProgramArgs(request.programArgs),
  });
  const record: PythonDebuggerRecord = {
    id,
    ownerId,
    tabId: request.tabId,
    tempDir,
    scriptPath,
    session,
    breakpoints: new Set(),
    watches: normalizeWatches(request.watches),
    location: null,
    pauseReason: 'user-breakpoint',
  };
  sessions.set(id, record);

  try {
    const initial = await session.start();
    if (
      /Uncaught exception|Traceback \(most recent call last\)|SyntaxError:/u.test(initial.output)
    ) {
      await removeRecord(record);
      return errorResponse('process-exited', 'Python could not start the script.', {
        output: initial.output,
        outputTruncated: initial.outputTruncated,
      });
    }
    for (const line of breakpoints) {
      const result = await session.setBreakpoint(line);
      if (!/^Breakpoint \d+ at /mu.test(result.output)) continue;
      record.breakpoints.add(line);
    }
    if (record.breakpoints.size === 0) {
      await removeRecord(record);
      return errorResponse('no-breakpoints');
    }
    const firstStop = await session.continue();
    const reason = /Uncaught exception|Traceback \(most recent call last\)/u.test(firstStop.output)
      ? 'exception'
      : 'user-breakpoint';
    return responseForResult(record, firstStop, reason);
  } catch (error) {
    await removeRecord(record);
    return errorResponse(
      'command-failed',
      error instanceof Error ? error.message : 'Failed to start Python debugger'
    );
  }
}

function ownedRecord(ownerId: number, sessionId: unknown): PythonDebuggerRecord | null {
  if (typeof sessionId !== 'string') return null;
  const record = sessions.get(sessionId);
  return record?.ownerId === ownerId ? record : null;
}

function isStepCommand(value: unknown): value is PythonDebuggerStepCommand {
  return (
    value === 'continue' || value === 'step-over' || value === 'step-into' || value === 'step-out'
  );
}

async function runCommand(
  record: PythonDebuggerRecord,
  command: PythonDebuggerStepCommand
): Promise<PythonDebuggerResponse> {
  try {
    const result =
      command === 'continue'
        ? await record.session.continue()
        : command === 'step-over'
          ? await record.session.stepOver()
          : command === 'step-into'
            ? await record.session.stepInto()
            : await record.session.stepOut();
    const reason = /Uncaught exception|Traceback \(most recent call last\)/u.test(result.output)
      ? 'exception'
      : command === 'continue'
        ? 'user-breakpoint'
        : 'step';
    return responseForResult(record, result, reason);
  } catch (error) {
    await removeRecord(record);
    return errorResponse(
      'command-failed',
      error instanceof Error ? error.message : 'Python debugger command failed'
    );
  }
}

async function syncBreakpoints(
  record: PythonDebuggerRecord,
  value: unknown
): Promise<PythonDebuggerResponse> {
  const next = new Set(normalizeBreakpoints(value));
  try {
    for (const line of [...record.breakpoints]) {
      if (next.has(line)) continue;
      await record.session.clearBreakpoint(line);
      record.breakpoints.delete(line);
    }
    for (const line of next) {
      if (record.breakpoints.has(line)) continue;
      const result = await record.session.setBreakpoint(line);
      if (!/^Breakpoint \d+ at /mu.test(result.output)) {
        throw new Error(`Python could not set a breakpoint on line ${line}.`);
      }
      record.breakpoints.add(line);
    }
    return { kind: 'synced', sessionId: record.id };
  } catch (error) {
    await removeRecord(record);
    return errorResponse(
      'command-failed',
      error instanceof Error ? error.message : 'Could not update breakpoints'
    );
  }
}

async function syncWatches(
  record: PythonDebuggerRecord,
  value: unknown
): Promise<PythonDebuggerResponse> {
  record.watches = normalizeWatches(value);
  if (!record.location) return { kind: 'synced', sessionId: record.id };
  try {
    return {
      kind: 'paused',
      sessionId: record.id,
      frame: await inspectPausedFrame(record, record.pauseReason),
      output: '',
    };
  } catch (error) {
    await removeRecord(record);
    return errorResponse(
      'command-failed',
      error instanceof Error ? error.message : 'Could not evaluate watches'
    );
  }
}

export function registerPythonDebuggerHandlers(): void {
  typedHandle('debugger:python:start', async (event, request: unknown) => {
    observeOwner(event.sender);
    return startSession(event.sender.id, request);
  });
  typedHandle('debugger:python:command', async (event, sessionId: unknown, command: unknown) => {
    const record = ownedRecord(event.sender.id, sessionId);
    if (!record) return errorResponse('session-not-found');
    if (!isStepCommand(command)) return errorResponse('invalid-request');
    return runCommand(record, command);
  });
  typedHandle(
    'debugger:python:sync-breakpoints',
    async (event, sessionId: unknown, breakpoints: unknown) => {
      const record = ownedRecord(event.sender.id, sessionId);
      if (!record) return errorResponse('session-not-found');
      return syncBreakpoints(record, breakpoints);
    }
  );
  typedHandle(
    'debugger:python:sync-watches',
    async (event, sessionId: unknown, watches: unknown) => {
      const record = ownedRecord(event.sender.id, sessionId);
      if (!record) return errorResponse('session-not-found');
      return syncWatches(record, watches);
    }
  );
  typedHandle('debugger:python:stop', async (event, sessionId: unknown) => {
    const record = ownedRecord(event.sender.id, sessionId);
    if (!record) return errorResponse('session-not-found');
    await removeRecord(record);
    return { kind: 'stopped', sessionId: record.id };
  });
}
