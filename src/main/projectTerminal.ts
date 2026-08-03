/**
 * Main-process ownership for project-scoped pseudoterminal sessions.
 *
 * A terminal is deliberately more privileged than Lingua's worker runners:
 * it is the user's real login shell and can reach anything that OS user can.
 * Main therefore accepts only an already-resolved project capability, limits
 * sessions and payload sizes, filters inherited environment variables, and
 * tears sessions down with their root capability or renderer owner.
 */

import { constants as fsConstants } from 'node:fs';
import { access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { IPty, IPtyForkOptions } from 'node-pty';
import type {
  ProjectTerminalDataEvent,
  ProjectTerminalExitEvent,
  ProjectTerminalStartResult,
} from '../shared/projectTerminal';
import {
  buildNativeRunnerEnv,
  combinedAllowlist,
} from './runners/nativeEnv';

const MIN_COLUMNS = 2;
const MAX_COLUMNS = 500;
const MIN_ROWS = 2;
const MAX_ROWS = 300;
const MAX_SESSIONS_PER_OWNER = 4;
const MAX_INPUT_CHARS = 64 * 1024;

interface ProjectShell {
  readonly executable: string;
  readonly args: readonly string[];
  readonly name: string;
}

interface ProjectTerminalCallbacks {
  readonly onData: (event: ProjectTerminalDataEvent) => void;
  readonly onExit: (event: ProjectTerminalExitEvent) => void;
}

interface ProjectTerminalRuntimeOptions {
  readonly platform?: NodeJS.Platform;
  readonly hostEnv?: NodeJS.ProcessEnv;
  readonly spawn?: (
    file: string,
    args: string[] | string,
    options: IPtyForkOptions
  ) => IPty;
}

interface ActiveProjectTerminal {
  readonly sessionId: string;
  readonly rootId: string;
  readonly ownerId: number;
  readonly process: IPty;
  readonly callbacks: ProjectTerminalCallbacks;
  exited: boolean;
}

const sessions = new Map<string, ActiveProjectTerminal>();

function isValidDimension(
  value: unknown,
  minimum: number,
  maximum: number
): value is number {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

async function isExecutable(filePath: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    await access(filePath, platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Resolve only an absolute OS/user-configured shell, never from project cwd. */
export async function resolveProjectShell(
  platform: NodeJS.Platform = process.platform,
  hostEnv: NodeJS.ProcessEnv = process.env
): Promise<ProjectShell | null> {
  const candidates: string[] = [];
  if (platform === 'win32') {
    if (typeof hostEnv.COMSPEC === 'string' && path.isAbsolute(hostEnv.COMSPEC)) {
      candidates.push(hostEnv.COMSPEC);
    }
    if (typeof hostEnv.SYSTEMROOT === 'string' && path.isAbsolute(hostEnv.SYSTEMROOT)) {
      candidates.push(path.join(hostEnv.SYSTEMROOT, 'System32', 'cmd.exe'));
    }
  } else {
    if (typeof hostEnv.SHELL === 'string' && path.isAbsolute(hostEnv.SHELL)) {
      candidates.push(hostEnv.SHELL);
    }
    candidates.push(...(platform === 'darwin' ? ['/bin/zsh', '/bin/bash', '/bin/sh'] : ['/bin/bash', '/bin/sh']));
  }

  for (const executable of [...new Set(candidates)]) {
    if (!(await isExecutable(executable, platform))) continue;
    const name = path.basename(executable);
    const loginShells = new Set(['bash', 'fish', 'ksh', 'sh', 'zsh']);
    return {
      executable,
      args: platform !== 'win32' && loginShells.has(name) ? ['-l'] : [],
      name,
    };
  }
  return null;
}

/** Build a useful shell environment without forwarding inherited secrets. */
export function buildProjectTerminalEnv(
  platform: NodeJS.Platform = process.platform,
  hostEnv: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const keys = combinedAllowlist(
    ['USER', 'LOGNAME', 'LC_ALL', 'LC_CTYPE', 'SHELL', 'COMSPEC'],
    platform
  );
  return buildNativeRunnerEnv(
    keys,
    undefined,
    {
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'Lingua',
    },
    hostEnv
  ) as Record<string, string>;
}

function ownerSessionCount(ownerId: number): number {
  let count = 0;
  for (const session of sessions.values()) {
    if (session.ownerId === ownerId) count += 1;
  }
  return count;
}

function killSession(
  session: ActiveProjectTerminal,
  reason: Exclude<ProjectTerminalExitEvent['reason'], 'exited'>
): boolean {
  if (session.exited) return false;
  session.exited = true;
  sessions.delete(session.sessionId);
  try {
    session.process.kill();
  } catch {
    // The PTY may already have exited between the map lookup and kill.
  }
  session.callbacks.onExit({
    sessionId: session.sessionId,
    exitCode: null,
    signal: null,
    reason,
  });
  return true;
}

export async function startProjectTerminal(
  rootId: string,
  rootPath: string,
  ownerId: number,
  columns: unknown,
  rows: unknown,
  callbacks: ProjectTerminalCallbacks,
  options: ProjectTerminalRuntimeOptions = {}
): Promise<ProjectTerminalStartResult> {
  if (
    !isValidDimension(columns, MIN_COLUMNS, MAX_COLUMNS) ||
    !isValidDimension(rows, MIN_ROWS, MAX_ROWS)
  ) {
    return { ok: false, reason: 'invalid-dimensions' };
  }
  if (ownerSessionCount(ownerId) >= MAX_SESSIONS_PER_OWNER) {
    return { ok: false, reason: 'session-limit' };
  }

  const platform = options.platform ?? process.platform;
  const hostEnv = options.hostEnv ?? process.env;
  const shell = await resolveProjectShell(platform, hostEnv);
  if (!shell) return { ok: false, reason: 'shell-not-found' };

  let spawn = options.spawn;
  if (!spawn) {
    try {
      const nodePty = await import('node-pty');
      spawn = nodePty.spawn;
    } catch {
      return { ok: false, reason: 'spawn-failed' };
    }
  }

  const sessionId = randomUUID();
  try {
    const terminal = spawn(shell.executable, [...shell.args], {
      name: 'xterm-256color',
      cols: columns,
      rows,
      cwd: rootPath,
      env: buildProjectTerminalEnv(platform, hostEnv),
      handleFlowControl: true,
    });
    const session: ActiveProjectTerminal = {
      sessionId,
      rootId,
      ownerId,
      process: terminal,
      callbacks,
      exited: false,
    };
    sessions.set(sessionId, session);
    terminal.onData(data => {
      if (session.exited || sessions.get(sessionId) !== session) return;
      callbacks.onData({ sessionId, data });
    });
    terminal.onExit(({ exitCode, signal }) => {
      if (session.exited) return;
      session.exited = true;
      sessions.delete(sessionId);
      callbacks.onExit({
        sessionId,
        exitCode,
        signal: signal ?? null,
        reason: 'exited',
      });
    });
    return { ok: true, sessionId, shellName: shell.name };
  } catch {
    return { ok: false, reason: 'spawn-failed' };
  }
}

export function writeProjectTerminal(
  sessionId: unknown,
  ownerId: number,
  data: unknown
): boolean {
  if (
    typeof sessionId !== 'string' ||
    typeof data !== 'string' ||
    data.length === 0 ||
    data.length > MAX_INPUT_CHARS
  ) {
    return false;
  }
  const session = sessions.get(sessionId);
  if (!session || session.ownerId !== ownerId || session.exited) return false;
  try {
    session.process.write(data);
    return true;
  } catch {
    // The PTY can exit between the ownership lookup and the write call.
    return false;
  }
}

export function resizeProjectTerminal(
  sessionId: unknown,
  ownerId: number,
  columns: unknown,
  rows: unknown
): boolean {
  if (
    typeof sessionId !== 'string' ||
    !isValidDimension(columns, MIN_COLUMNS, MAX_COLUMNS) ||
    !isValidDimension(rows, MIN_ROWS, MAX_ROWS)
  ) {
    return false;
  }
  const session = sessions.get(sessionId);
  if (!session || session.ownerId !== ownerId || session.exited) return false;
  try {
    session.process.resize(columns, rows);
    return true;
  } catch {
    return false;
  }
}

export function stopProjectTerminal(sessionId: unknown, ownerId: number): boolean {
  if (typeof sessionId !== 'string') return false;
  const session = sessions.get(sessionId);
  if (!session || session.ownerId !== ownerId) return false;
  return killSession(session, 'stopped');
}

export function disposeProjectTerminalSessionsForRoot(rootId: string): number {
  const owned = [...sessions.values()].filter(session => session.rootId === rootId);
  for (const session of owned) killSession(session, 'root-revoked');
  return owned.length;
}

export function disposeProjectTerminalSessionsForOwner(ownerId: number): number {
  const owned = [...sessions.values()].filter(session => session.ownerId === ownerId);
  for (const session of owned) killSession(session, 'owner-destroyed');
  return owned.length;
}

export function disposeProjectTerminalSessions(): void {
  for (const session of [...sessions.values()]) killSession(session, 'app-quit');
}

export function _resetProjectTerminalSessionsForTests(): void {
  disposeProjectTerminalSessions();
}
