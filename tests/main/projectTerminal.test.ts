import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IPty } from 'node-pty';
import {
  _resetProjectTerminalSessionsForTests,
  buildProjectTerminalEnv,
  disposeProjectTerminalSessions,
  disposeProjectTerminalSessionsForOwner,
  disposeProjectTerminalSessionsForRoot,
  resizeProjectTerminal,
  resolveProjectShell,
  startProjectTerminal,
  stopProjectTerminal,
  writeProjectTerminal,
} from '../../src/main/projectTerminal';
import type {
  ProjectTerminalDataEvent,
  ProjectTerminalExitEvent,
} from '../../src/shared/projectTerminal';

class FakePty extends EventEmitter {
  readonly pid = 4321;
  readonly process = '/bin/sh';
  readonly write = vi.fn();
  readonly resize = vi.fn();
  readonly clear = vi.fn();
  readonly pause = vi.fn();
  readonly resume = vi.fn();
  readonly kill = vi.fn();

  onData(listener: (data: string) => void) {
    this.on('data', listener);
    return { dispose: () => this.off('data', listener) };
  }

  onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
    this.on('exit', listener);
    return { dispose: () => this.off('exit', listener) };
  }
}

function harness(ownerId = 7) {
  const pty = new FakePty();
  const spawn = vi.fn(() => pty as unknown as IPty);
  const data: ProjectTerminalDataEvent[] = [];
  const exits: ProjectTerminalExitEvent[] = [];
  const start = (rootId = 'root-a', rootPath = '/trusted/project') =>
    startProjectTerminal(rootId, rootPath, ownerId, 100, 30, {
      onData: event => data.push(event),
      onExit: event => exits.push(event),
    }, {
      platform: 'linux',
      hostEnv: {
        SHELL: '/bin/sh',
        HOME: '/Users/test',
        USER: 'test',
        PATH: '/usr/bin:/bin',
        GH_TOKEN: 'must-not-leak',
        OPENAI_API_KEY: 'must-not-leak',
        NODE_OPTIONS: '--inspect',
      },
      spawn,
    });
  return { ownerId, pty, spawn, data, exits, start };
}

afterEach(() => {
  _resetProjectTerminalSessionsForTests();
});

describe('project terminal shell and environment', () => {
  it('resolves an absolute configured shell and ignores a project-relative shell', async () => {
    await expect(resolveProjectShell('linux', { SHELL: '/bin/sh' })).resolves.toEqual({
      executable: '/bin/sh',
      args: ['-l'],
      name: 'sh',
    });

    const fallback = await resolveProjectShell('linux', { SHELL: './planted-shell' });
    expect(fallback?.executable).toMatch(/^\/bin\/(?:bash|sh)$/u);
    expect(fallback?.executable).not.toContain('planted-shell');
  });

  it('keeps shell essentials and strips inherited secrets and Node injection flags', () => {
    const env = buildProjectTerminalEnv('linux', {
      HOME: '/Users/test',
      USER: 'test',
      PATH: '/usr/bin:/bin',
      SHELL: '/bin/sh',
      LANG: 'en_US.UTF-8',
      GH_TOKEN: 'secret',
      OPENAI_API_KEY: 'secret',
      NODE_OPTIONS: '--require planted.js',
    });

    expect(env).toMatchObject({
      HOME: '/Users/test',
      USER: 'test',
      PATH: '/usr/bin:/bin',
      SHELL: '/bin/sh',
      LANG: 'en_US.UTF-8',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'Lingua',
    });
    expect(env).not.toHaveProperty('GH_TOKEN');
    expect(env).not.toHaveProperty('OPENAI_API_KEY');
    expect(env).not.toHaveProperty('NODE_OPTIONS');
  });
});

describe('project terminal lifecycle', () => {
  it('starts in the approved root and forwards PTY data and natural exit', async () => {
    const { pty, spawn, data, exits, start } = harness();
    const result = await start();
    expect(result).toEqual(expect.objectContaining({ ok: true, shellName: 'sh' }));
    if (!result.ok) throw new Error('expected terminal start');

    expect(spawn).toHaveBeenCalledWith(
      '/bin/sh',
      ['-l'],
      expect.objectContaining({
        cwd: '/trusted/project',
        cols: 100,
        rows: 30,
        name: 'xterm-256color',
        handleFlowControl: true,
      })
    );

    pty.emit('data', 'project-ready\r\n');
    pty.emit('exit', { exitCode: 0, signal: 0 });
    expect(data).toEqual([{ sessionId: result.sessionId, data: 'project-ready\r\n' }]);
    expect(exits).toEqual([{ sessionId: result.sessionId, exitCode: 0, signal: 0, reason: 'exited' }]);
    expect(writeProjectTerminal(result.sessionId, 7, 'ignored')).toBe(false);
  });

  it('validates dimensions, payload sizes, and renderer ownership', async () => {
    const h = harness();
    const invalid = await startProjectTerminal('root-a', '/trusted/project', 7, 1, 30, {
      onData: vi.fn(),
      onExit: vi.fn(),
    });
    expect(invalid).toEqual({ ok: false, reason: 'invalid-dimensions' });

    const result = await h.start();
    if (!result.ok) throw new Error('expected terminal start');
    expect(writeProjectTerminal(result.sessionId, 99, 'pwd\r')).toBe(false);
    expect(writeProjectTerminal(result.sessionId, 7, 'x'.repeat(64 * 1024 + 1))).toBe(false);
    expect(writeProjectTerminal(result.sessionId, 7, 'pwd\r')).toBe(true);
    expect(h.pty.write).toHaveBeenCalledWith('pwd\r');
    h.pty.write.mockImplementationOnce(() => {
      throw new Error('pty exited during write');
    });
    expect(writeProjectTerminal(result.sessionId, 7, 'late\r')).toBe(false);

    expect(resizeProjectTerminal(result.sessionId, 99, 120, 40)).toBe(false);
    expect(resizeProjectTerminal(result.sessionId, 7, 501, 40)).toBe(false);
    expect(resizeProjectTerminal(result.sessionId, 7, 120, 40)).toBe(true);
    expect(h.pty.resize).toHaveBeenCalledWith(120, 40);
    expect(stopProjectTerminal(result.sessionId, 99)).toBe(false);
    expect(stopProjectTerminal(result.sessionId, 7)).toBe(true);
    expect(h.pty.kill).toHaveBeenCalledOnce();
    expect(h.exits.at(-1)?.reason).toBe('stopped');
  });

  it('caps active sessions per renderer owner', async () => {
    const sessions = Array.from({ length: 5 }, () => harness(11));
    for (const entry of sessions.slice(0, 4)) {
      await expect(entry.start()).resolves.toEqual(expect.objectContaining({ ok: true }));
    }
    await expect(sessions[4]!.start()).resolves.toEqual({ ok: false, reason: 'session-limit' });
  });

  it('tears down only sessions matching the revoked root or renderer, then all on quit', async () => {
    const rootA = harness(1);
    const rootB = harness(1);
    const ownerB = harness(2);
    await rootA.start('root-a');
    await rootB.start('root-b');
    await ownerB.start('root-c');

    expect(disposeProjectTerminalSessionsForRoot('root-a')).toBe(1);
    expect(rootA.exits.at(-1)?.reason).toBe('root-revoked');
    expect(rootB.pty.kill).not.toHaveBeenCalled();
    expect(ownerB.pty.kill).not.toHaveBeenCalled();

    expect(disposeProjectTerminalSessionsForOwner(1)).toBe(1);
    expect(rootB.exits.at(-1)?.reason).toBe('owner-destroyed');
    disposeProjectTerminalSessions();
    expect(ownerB.exits.at(-1)?.reason).toBe('app-quit');
  });
});
